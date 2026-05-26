# IndusTree static archive

This repository contains a Drupal 6 export and a generated static version that can be served by GitHub Pages.

## Build

```sh
python3 scripts/build_static.py
```

The generated site is written to `docs/`.

Audio links are generated from `media/audio_manifest.json`. By default restored audio points to the temporary host `https://d7.bfr.ee/audio/...`. After `audio.industree.org` DNS is ready, rebuild with:

```sh
MEDIA_BASE_URL=https://audio.industree.org python3 scripts/build_static.py
```

## GitHub Pages

In the repository settings, set Pages to serve from the `docs/` folder on the default branch. The `docs/.nojekyll` file is included so GitHub Pages serves the archive as plain static files.

The Drupal database references many MP3 files, but the audio binaries are not committed to this repository. Restored tracks live on an external static host and are listed in `media/audio_manifest.json`.

## Audio restore workflow

Recovered audio files can stay on the mounted media share. To sync the selected manifest entries to the server:

```sh
scripts/rsync_audio.sh d7.bfr.ee:/var/www/audio.industree.org/
```

For a dry run:

```sh
scripts/rsync_audio.sh --dry-run d7.bfr.ee:/var/www/audio.industree.org/
```

The script reads `media/audio_manifest.json`, rsyncs each `source_path` to its `server_path`, and writes an ignored transfer report to `media/rsync_audio_manifest.tsv`.

## Missing images

Some old pages still reference images from `industree.org/bobimages/`, which are not included in this checkout. To restore them later:

1. Search the missing image URLs in Archive.org / Wayback Machine.
2. Save recovered files in a local `bobimages/` folder at the repository root, preserving the original filenames.
3. Run `python3 scripts/build_static.py` again.

The build script will copy `bobimages/` into `docs/bobimages/` and rewrite matching old image links to local static files.
