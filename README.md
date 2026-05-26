# IndusTree static archive

This repository contains a static archive that can be served by GitHub Pages.

## Editing

- `docs/index.html` is the app shell.
- `docs/404.html` uses the same shell so GitHub Pages can still load the app for old deep links.
- `docs/assets/index.js` renders pages and handles hash-based internal navigation such as `/#/audio/`.
- `docs/assets/site-data.json` contains the frozen Drupal archive data plus small hand-maintained app data.
- `docs/assets/site.css` and `docs/files/` contain the styling and static assets.
- `docs/assets/impulse-player.js` and `docs/assets/impulse-player.css` contain the browser IT file player used by `/#/impulse/`.

`docs/` is now the source of truth. Edit these files directly; do not regenerate the site with `scripts/build_static.py` during normal development.

The app intentionally avoids one HTML file per Drupal page. Most archive content lives in the JSON file and is rendered in the browser. Old path-style URLs are treated as a light compatibility fallback, but the preferred navigation format is hash links.

The Music page groups playable tracks first, then lists archive entries that still do not have audio attached.

Audio links in `docs/assets/site-data.json` point to `https://audio.industree.org/audio/...`. Impulse Tracker files point to `https://audio.industree.org/itfiles/...`.

`scripts/build_static.py` is deprecated and exits with a warning so it cannot overwrite `docs/` by accident.

## GitHub Pages

In the repository settings, set Pages to serve from the `docs/` folder on the default branch. The `docs/.nojekyll` file is included so GitHub Pages serves the archive as plain static files.

The Drupal database references many MP3 files, but the audio binaries are not committed to this repository. Restored tracks live on an external static host and are listed in `media/audio_manifest.json`.

## Audio restore workflow

Recovered audio files can stay on the mounted media share. To sync the selected manifest entries to the server:

```sh
scripts/rsync_audio.sh
```

For a dry run:

```sh
scripts/rsync_audio.sh --dry-run
```

The script reads `media/audio_manifest.json`, stages all restored tracks into their final `server_path`, uploads them with one rsync, fixes readable permissions, verifies the published audio URLs, and writes an ignored transfer report to `media/rsync_audio_manifest.tsv`. Use `--delete` only when the remote audio folder should exactly match the manifest.

To sync Impulse Tracker files from the sibling MIDI repo to `audio.industree.org/itfiles/`:

```sh
scripts/rsync_audio.sh --itfiles
```

For a dry run:

```sh
scripts/rsync_audio.sh --itfiles --dry-run
```

## Missing images

Some old pages still reference images from `industree.org/bobimages/`, which are not included in this checkout. To restore them later:

1. Search the missing image URLs in Archive.org / Wayback Machine.
2. Save recovered files in a local `bobimages/` folder at the repository root, preserving the original filenames.
3. Copy recovered files into `docs/bobimages/` and update any references directly in `docs/assets/site-data.json` if needed.
