# IndusTree static archive

This repository contains a Drupal 6 export and a generated static version that can be served by GitHub Pages.

## Build

```sh
python3 scripts/build_static.py
```

The generated site is written to `docs/`. The current build is a small static app:

- `docs/index.html` is the app shell.
- `docs/404.html` uses the same shell so GitHub Pages can still load the app for old deep links.
- `docs/assets/index.js` renders pages and handles internal navigation.
- `docs/assets/site-data.json` contains the generated Drupal archive data.
- `docs/assets/site.css` and `docs/files/` contain the styling and static assets.

The build intentionally avoids generating one HTML file per Drupal page. Most archive content now lives in the JSON file and is rendered in the browser.

Audio links are generated from `media/audio_manifest.json`. Restored audio points to `https://audio.industree.org/audio/...` by default. To override the media host for a temporary deployment, rebuild with:

```sh
MEDIA_BASE_URL=https://example.org python3 scripts/build_static.py
```

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

## Missing images

Some old pages still reference images from `industree.org/bobimages/`, which are not included in this checkout. To restore them later:

1. Search the missing image URLs in Archive.org / Wayback Machine.
2. Save recovered files in a local `bobimages/` folder at the repository root, preserving the original filenames.
3. Run `python3 scripts/build_static.py` again.

The build script will copy `bobimages/` into `docs/bobimages/` and rewrite matching old image links to local static files.
