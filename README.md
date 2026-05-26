# IndusTree static archive

This repository contains a Drupal 6 export and a generated static version that can be served by GitHub Pages.

## Build

```sh
python3 scripts/build_static.py
```

The generated site is written to `docs/`.

## GitHub Pages

In the repository settings, set Pages to serve from the `docs/` folder on the default branch. The `docs/.nojekyll` file is included so GitHub Pages serves the archive as plain static files.

The Drupal database references many MP3 files, but the audio binaries are not included in this checkout. If those files are recovered, place them under `docs/files/audio/` and rebuild; pages will automatically show audio players for files that exist locally.

## Missing images

Some old pages still reference images from `industree.org/bobimages/`, which are not included in this checkout. To restore them later:

1. Search the missing image URLs in Archive.org / Wayback Machine.
2. Save recovered files in a local `bobimages/` folder at the repository root, preserving the original filenames.
3. Run `python3 scripts/build_static.py` again.

The build script will copy `bobimages/` into `docs/bobimages/` and rewrite matching old image links to local static files.
