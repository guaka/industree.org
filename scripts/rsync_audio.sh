#!/bin/sh
set -eu

usage() {
  status=${1:-2}
  cat >&2 <<'EOF'
Usage: scripts/rsync_audio.sh [options] [user@host:/var/www/audio.industree.org/]

Options:
  --dry-run          Show what would be transferred.
  --delete           Remove destination files that are not in the manifest.
  --no-verify        Skip URL checks after upload.
  --manifest PATH    Read a different audio manifest.
  --report PATH      Write the transfer report somewhere else.

Environment:
  AUDIO_DEPLOY_DEST  Default destination.
  AUDIO_MANIFEST     Default manifest path.
  AUDIO_RSYNC_REPORT Default report path.
EOF
  exit "$status"
}

dry_run=0
delete_extra=0
verify_urls=1
dest=${AUDIO_DEPLOY_DEST:-d7.bfr.ee:/var/www/audio.industree.org/}
manifest=${AUDIO_MANIFEST:-media/audio_manifest.json}
report=${AUDIO_RSYNC_REPORT:-media/rsync_audio_manifest.tsv}
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

python3 - "$manifest" "$report" "$stagedir" "$url_list" <<'PY'
import csv
import json
import os
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
report_path = Path(sys.argv[2])
stage_dir = Path(sys.argv[3])
url_list_path = Path(sys.argv[4])
payload = json.loads(manifest_path.read_text(encoding="utf-8"))
media_base_url = (payload.get("media_base_url", "") if isinstance(payload, dict) else "").rstrip("/")
tracks = payload.get("tracks", payload) if isinstance(payload, dict) else payload

missing = []
rows = []
seen_paths = {}
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
            handle.write(f"{media_base_url}/{row['server_path']}\n")

for row in rows:
    target = stage_dir / row["server_path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(row["source_path"], target)
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
      ssh "$host" "mkdir -p $remote_audio_q && chmod 755 $remote_audio_q"
      ;;
    *)
      mkdir -p "$dest/audio"
      chmod 755 "$dest/audio"
      ;;
  esac
fi

rsync_flags="-avP"
if [ "$dry_run" -eq 1 ]; then
  rsync_flags="$rsync_flags --dry-run"
fi
if [ "$delete_extra" -eq 1 ]; then
  rsync_flags="$rsync_flags --delete"
fi

rsync $rsync_flags -L "$stagedir/" "$dest/"

if [ "$dry_run" -eq 0 ]; then
  case "$dest" in
    *:*)
      host=${dest%%:*}
      remote_dir=${dest#*:}
      remote_audio_q=$(quote_sh "$remote_dir/audio")
      ssh "$host" "chmod -R a+rX $remote_audio_q"
      ;;
    *)
      chmod -R a+rX "$dest/audio"
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
