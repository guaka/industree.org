#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 [--dry-run] user@host:/var/www/audio.industree.org/" >&2
  exit 2
}

dry_run=0
if [ "${1:-}" = "--dry-run" ]; then
  dry_run=1
  shift
fi

[ "$#" -eq 1 ] || usage

dest=${1%/}
manifest=${AUDIO_MANIFEST:-media/audio_manifest.json}
report=${AUDIO_RSYNC_REPORT:-media/rsync_audio_manifest.tsv}
tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/industree-rsync-audio.XXXXXX")

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

mkdir -p "$(dirname "$report")"

python3 - "$manifest" "$report" "$tmpdir" <<'PY'
import csv
import json
import os
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
report_path = Path(sys.argv[2])
stage_dir = Path(sys.argv[3])
payload = json.loads(manifest_path.read_text(encoding="utf-8"))
tracks = payload.get("tracks", payload)

missing = []
rows = []
for entry in tracks:
    source = Path(entry["source_path"])
    server_path = entry["server_path"].lstrip("/")
    if not source.exists():
        missing.append(str(source))
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

for row in rows:
    target = stage_dir / row["server_path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    os.symlink(row["source_path"], target)
PY

rsync_flags="-av"
if [ "$dry_run" -eq 1 ]; then
  rsync_flags="$rsync_flags --dry-run"
fi

rsync $rsync_flags -L "$tmpdir/" "$dest/"

echo "Wrote transfer report to $report"
