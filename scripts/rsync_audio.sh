#!/bin/sh
set -eu

usage() {
  status=${1:-2}
  cat >&2 <<'EOF'
Usage: scripts/rsync_audio.sh [options] [user@host:/var/www/audio.industree.org/]

Options:
  --dry-run          Show what would be transferred.
  --delete           Remove destination files that are not in the manifest.
  --itfiles          Upload Impulse Tracker files instead of audio manifest entries.
  --no-verify        Skip URL checks after upload.
  --manifest PATH    Read a different audio manifest.
  --report PATH      Write the transfer report somewhere else.
  --source PATH      Read .it files from a different directory in --itfiles mode.

Environment:
  AUDIO_DEPLOY_DEST  Default destination.
  AUDIO_MANIFEST     Default manifest path.
  AUDIO_RSYNC_REPORT Default report path.
  ITFILES_SOURCE     Default --itfiles source path.
  ITFILES_RSYNC_REPORT Default --itfiles report path.
EOF
  exit "$status"
}

dry_run=0
delete_extra=0
verify_urls=1
mode=audio
report_set=0
dest=${AUDIO_DEPLOY_DEST:-d7.bfr.ee:/var/www/audio.industree.org/}
manifest=${AUDIO_MANIFEST:-media/audio_manifest.json}
report=${AUDIO_RSYNC_REPORT:-media/rsync_audio_manifest.tsv}
itfiles_source=${ITFILES_SOURCE:-../midi.guaka.org/itfiles}
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/industree-rsync-audio.XXXXXX")
stagedir=$tmpdir/stage
url_list=$tmpdir/urls.txt
file_list=$tmpdir/files-from.txt

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --delete)
      delete_extra=1
      ;;
    --itfiles)
      mode=itfiles
      if [ "$report_set" -eq 0 ]; then
        report=${ITFILES_RSYNC_REPORT:-media/rsync_itfiles.tsv}
      fi
      ;;
    --no-verify)
      verify_urls=0
      ;;
    --manifest)
      shift
      [ "${1:-}" ] || usage
      manifest=$1
      ;;
    --report)
      shift
      [ "${1:-}" ] || usage
      report=$1
      report_set=1
      ;;
    --source)
      shift
      [ "${1:-}" ] || usage
      itfiles_source=$1
      ;;
    -h|--help)
      usage 0
      ;;
    -*)
      usage
      ;;
    *)
      dest=$1
      ;;
  esac
  shift
done

dest=${dest%/}
rsync_source=$stagedir/
rsync_dest=$dest/

if [ "$mode" = "itfiles" ]; then
  rsync_source=$stagedir/itfiles/
  rsync_dest=$dest/itfiles/
fi

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$(dirname "$report")"

python3 - "$mode" "$manifest" "$report" "$stagedir" "$url_list" "$file_list" "$itfiles_source" <<'PY'
import csv
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

mode = sys.argv[1]
manifest_path = Path(sys.argv[2])
report_path = Path(sys.argv[3])
stage_dir = Path(sys.argv[4])
url_list_path = Path(sys.argv[5])
file_list_path = Path(sys.argv[6])
itfiles_source = Path(sys.argv[7])

missing = []
rows = []
seen_paths = {}

if mode == "audio":
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    media_base_url = (payload.get("media_base_url", "") if isinstance(payload, dict) else "").rstrip("/")
    tracks = payload.get("tracks", payload) if isinstance(payload, dict) else payload

    for entry in tracks:
        source = Path(entry["source_path"])
        server_path = entry["server_path"].lstrip("/")
        if not source.exists():
            missing.append(str(source))
        if server_path in seen_paths:
            print(
                f"Duplicate server_path: {server_path} "
                f"({seen_paths[server_path]} and {entry.get('node_id')})",
                file=sys.stderr,
            )
            sys.exit(1)
        seen_paths[server_path] = entry.get("node_id")
        rows.append(
            {
                "node_id": entry["node_id"],
                "title": entry.get("title", ""),
                "source_path": str(source),
                "server_path": server_path,
                "format": entry.get("format", ""),
                "match_type": entry.get("match_type", ""),
            }
        )
else:
    media_base_url = "https://audio.industree.org"
    if not itfiles_source.is_dir():
        print(f"Missing IT files source directory: {itfiles_source}", file=sys.stderr)
        sys.exit(1)

    sources = sorted(
        (path for path in itfiles_source.iterdir() if path.is_file() and path.suffix.lower() == ".it"),
        key=lambda path: path.name.lower(),
    )
    if not sources:
        print(f"No .it files found in {itfiles_source}", file=sys.stderr)
        sys.exit(1)

    for source in sources:
        server_path = f"itfiles/{source.name}"
        if server_path in seen_paths:
            print(f"Duplicate server_path: {server_path}", file=sys.stderr)
            sys.exit(1)
        seen_paths[server_path] = source.name
        rows.append(
            {
                "filename": source.name,
                "source_path": str(source),
                "server_path": server_path,
                "size_bytes": source.stat().st_size,
            }
        )

if missing:
    for path in missing:
        print(f"Missing source file: {path}", file=sys.stderr)
    sys.exit(1)

with report_path.open("w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=rows[0].keys(), delimiter="\t")
    writer.writeheader()
    writer.writerows(rows)

with url_list_path.open("w", encoding="utf-8") as handle:
    for row in rows:
        if media_base_url:
            handle.write(f"{media_base_url}/{quote(row['server_path'], safe='/')}\n")

for row in rows:
    target = stage_dir / row["server_path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(Path(row["source_path"]).resolve(), target)

with file_list_path.open("wb") as handle:
    extension_order = {".ogg": 0, ".mp3": 1, ".m4a": 2}

    def extension_priority(row):
        suffix = Path(row["server_path"]).suffix.lower()
        return extension_order.get(suffix, 3)

    for row in sorted(enumerate(rows), key=lambda item: (extension_priority(item[1]), item[0])):
        row = row[1]
        path = row["server_path"]
        if mode == "itfiles":
            path = path.removeprefix("itfiles/")
        handle.write(path.encode("utf-8") + b"\0")
PY

python3 - "$file_list" "$rsync_source" "$rsync_dest" "$dry_run" "$delete_extra" "$tmpdir" <<'PY'
import shlex
import subprocess
import sys
import os
from pathlib import Path

file_list_path = Path(sys.argv[1])
rsync_source = sys.argv[2]
rsync_dest = sys.argv[3]
dry_run = sys.argv[4] == "1"
delete_extra = sys.argv[5] == "1"
tmpdir = Path(sys.argv[6])

paths = [path for path in file_list_path.read_bytes().split(b"\0") if path]
extension_order = {".ogg": 0, ".mp3": 1, ".m4a": 2}
path_groups = [[], [], [], []]

for path in paths:
    suffix = Path(path.decode("utf-8", "surrogateescape")).suffix.lower()
    path_groups[extension_order.get(suffix, 3)].append(path)

base_cmd = [
    "rsync",
    "-avP",
    "--omit-dir-times",
    "--chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r",
    "-L",
]

if dry_run:
    base_cmd.append("--dry-run")

if ":" in rsync_dest:
    control_path = Path("/tmp") / f"industree-rsync-{os.getpid()}-%C"
    rsync_rsh = (
        "ssh "
        "-o ControlMaster=auto "
        f"-o ControlPath={shlex.quote(str(control_path))} "
        "-o ControlPersist=60"
    )
    base_cmd.extend(["-e", rsync_rsh])

for path_group in path_groups:
    if not path_group:
        continue
    subprocess.run(
        base_cmd + ["--from0", "--files-from=-", rsync_source, rsync_dest],
        input=b"\0".join(path_group) + b"\0",
        check=True,
    )

if delete_extra:
    subprocess.run(
        base_cmd + ["--delete", "--ignore-existing", rsync_source, rsync_dest],
        check=True,
    )
PY

echo "Wrote transfer report to $report"

if [ "$dry_run" -eq 0 ] && [ "$verify_urls" -eq 1 ] && [ -s "$url_list" ]; then
  python3 - "$url_list" <<'PY'
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

urls = [line.strip() for line in open(sys.argv[1], encoding="utf-8") if line.strip()]
failed = []

for url in urls:
    try:
        request = Request(url, method="HEAD")
        with urlopen(request, timeout=20) as response:
            status = response.status
    except HTTPError as exc:
        if exc.code == 405:
            try:
                request = Request(url, headers={"Range": "bytes=0-0"})
                with urlopen(request, timeout=20) as response:
                    status = response.status
            except (HTTPError, URLError, TimeoutError) as fallback_exc:
                failed.append((url, str(fallback_exc)))
                continue
        else:
            failed.append((url, f"HTTP {exc.code}"))
            continue
    except (URLError, TimeoutError) as exc:
        failed.append((url, str(exc)))
        continue

    if status not in {200, 206}:
        failed.append((url, f"HTTP {status}"))

if failed:
    print("URL verification failed:", file=sys.stderr)
    for url, reason in failed:
        print(f"{url}\t{reason}", file=sys.stderr)
    sys.exit(1)

print(f"Verified {len(urls)} published audio URLs.")
PY
fi
