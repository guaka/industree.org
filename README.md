# IndusTree static archive

This repository contains a static archive that can be served by GitHub Pages.

## Editing

- `site/index.html` is the app shell.
- `site/assets/index.js` renders pages and handles clean internal navigation such as `/audio/`.
- `site/assets/site-data.json` contains the frozen Drupal archive data plus small hand-maintained app data.
- `site/assets/site.css` and `site/files/` contain the styling and static assets.
- `site/assets/impulse-player.js` and `site/assets/impulse-player.css` contain the browser IT file player used by `/impulse/`.

`site/` is the source of truth. Edit these files directly; normal development does not use a generation or build step for the site. The GitHub Pages workflow copies `site/index.html` to `404.html` in its deployment artifact so old deep links still load the app shell.

The app intentionally avoids one HTML file per Drupal page. Most archive content lives in the JSON file and is rendered in the browser. Clean path-style URLs are preferred, and old hash URLs such as `/#/audio/` still work as compatibility links.

The Music page groups playable tracks first, then lists archive entries that still do not have audio attached.

Audio links in `site/assets/site-data.json` point to `https://audio.industree.org/audio/...`. Impulse Tracker files point to `https://audio.industree.org/itfiles/...`.

## Tests

The npm/Playwright tooling runs in Docker so local development does not need `node_modules` or npm cache writes on the host:

```sh
./scripts/test_docker.sh
```

The container runs JavaScript syntax checks and Playwright smoke tests against `dev.sh`. If Docker is not already running, start Docker Desktop or the local Docker daemon first.

## GitHub Pages

In the repository settings, set Pages to deploy from GitHub Actions. The `.github/workflows/pages.yml` workflow prepares a Pages artifact from `site/` and generates `404.html` from `index.html`. The `site/.nojekyll` file is included so GitHub Pages serves the archive as plain static files.

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
3. Copy recovered files into `site/bobimages/` and update any references directly in `site/assets/site-data.json` if needed.
