#!/usr/bin/env bash
# Zaitun Hills film (track 5B): the whole chain, from the layout to the delivered films.
#
#   scripts/blender/film/render.sh preview    posters, stills, the film at 960 x 540 (16 samples), the edit
#   scripts/blender/film/render.sh final      the film at 3840 x 2160 (64 samples), the edit   (~1-1.5 days on an M3 Pro)
#   scripts/blender/film/render.sh posters    just the four web posters (public/sawad/scene-zaitun-*.jpg)
#   scripts/blender/film/render.sh stills     just the 4K stills
#   scripts/blender/film/render.sh edit       just the edit (add --music bed.wav / --logo logo.png after it)
#
# Frames already on disk are skipped, so `final` can be stopped and run again, or run in several
# terminals at once (film.py writes placeholders). FRAMES=1-600 limits a run to those frames.
# BLENDER=/path/to/blender picks the Blender binary (4.2+; built and tested on 5.3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
BLENDER="${BLENDER:-$(command -v blender || echo /Applications/Blender.app/Contents/MacOS/Blender)}"
OUT=scripts/blender/out
STAGE="${1:-preview}"
shift || true

need() { [ -f "$1" ] || { echo "missing $1: $2" >&2; exit 1; }; }

prepare() {
  node scripts/export-scene-layout.mjs
  node scripts/blender/film/shots.mjs
  node --import ./scripts/blender/film/ts-register.mjs scripts/blender/film/scene.mjs
  if [ ! -f "$OUT/zaitun-high.blend" ] || [ scripts/blender/layout.json -nt "$OUT/zaitun-high.blend" ]; then
    scripts/blender/fetch_textures.sh
    "$BLENDER" -b --factory-startup -P scripts/blender/build_compound.py -- --plan zaitun --tier high --blend "$OUT/zaitun-high.blend"
  fi
  need "$OUT/vegetation-high.raw.glb" "build it with scripts/blender/vegetation.py --tier high (track 3A)"
  need "$OUT/life-high.raw.glb" "build it with scripts/blender/life.py --tier high (track 3A)"
}

film() { "$BLENDER" -b "$OUT/zaitun-high.blend" --python-exit-code 1 -P scripts/blender/film/film.py -- "$@"; }
range() { [ -n "${FRAMES:-}" ] && echo "--frames $FRAMES" || true; }

case "$STAGE" in
  preview)
    prepare
    film --posters
    film --stills
    film --shots --scale 25 --samples 16 $(range)
    node scripts/blender/film/edit.mjs --preview "$@"
    ;;
  final)
    prepare
    film --shots $(range)
    node scripts/blender/film/edit.mjs "$@"
    ;;
  posters) prepare; film --posters ;;
  stills) prepare; film --stills ;;
  edit) node scripts/blender/film/edit.mjs "$@" ;;
  *) echo "usage: $0 preview|final|posters|stills|edit [edit options]" >&2; exit 2 ;;
esac
