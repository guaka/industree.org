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

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$(dirname "$report")"

python3 - "$mode" "$manifest" "$report" "$stagedir" "$url_list" "$itfiles_source" <<'PY'
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
itfiles_source = Path(sys.argv[6])

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
PY

quote_sh() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

if [ "$dry_run" -eq 0 ]; then
  case "$dest" in
    *:*)
      host=${dest%%:*}
      remote_dir=${dest#*:}
      remote_audio_q=$(quote_sh "$remote_dir/audio")
      remote_itfiles_q=$(quote_sh "$remote_dir/itfiles")
      if [ "$mode" = "itfiles" ]; then
        ssh "$host" "mkdir -p $remote_itfiles_q && chmod 755 $remote_itfiles_q"
      else
        ssh "$host" "mkdir -p $remote_audio_q && chmod 755 $remote_audio_q"
      fi
      ;;
    *)
      if [ "$mode" = "itfiles" ]; then
        mkdir -p "$dest/itfiles"
        chmod 755 "$dest/itfiles"
      else
        mkdir -p "$dest/audio"
        chmod 755 "$dest/audio"
      fi
      ;;
  esac
fi

rsync_flags="-avP --omit-dir-times --no-perms"
if [ "$dry_run" -eq 1 ]; then
  rsync_flags="$rsync_flags --dry-run"
fi
if [ "$delete_extra" -eq 1 ]; then
  rsync_flags="$rsync_flags --delete"
fi

if [ "$mode" = "itfiles" ]; then
  rsync $rsync_flags -L "$stagedir/itfiles/" "$dest/itfiles/"
else
  rsync $rsync_flags -L "$stagedir/" "$dest/"
fi

if [ "$dry_run" -eq 0 ]; then
  case "$dest" in
    *:*)
      host=${dest%%:*}
      remote_dir=${dest#*:}
      remote_audio_q=$(quote_sh "$remote_dir/audio")
      remote_itfiles_q=$(quote_sh "$remote_dir/itfiles")
      if [ "$mode" = "itfiles" ]; then
        ssh "$host" "chmod -R a+rX $remote_itfiles_q"
      else
        ssh "$host" "chmod -R a+rX $remote_audio_q"
      fi
      ;;
    *)
      if [ "$mode" = "itfiles" ]; then
        chmod -R a+rX "$dest/itfiles"
      else
        chmod -R a+rX "$dest/audio"
      fi
      ;;
  esac
fi

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
