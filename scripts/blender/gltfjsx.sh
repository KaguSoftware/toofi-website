#!/usr/bin/env bash
# Typed React Three Fiber components for the shipped GLBs, written to scripts/blender/out/jsx/<Name>.tsx.txt.
#
#   scripts/blender/gltfjsx.sh [model.glb ...]     (default: compound-high + compound-low)
#
# The output is a typed reference for the scene code (track 7B copies what it needs into
# components/sawad/scene/). Three things to know, all checked against gltfjsx 6.5.3:
#   * Never pass --transform or --instance: both re-encode the GLB (a bigger file, no meshopt,
#     no KTX2). We ship the GLB from build.sh untouched and only take the TSX.
#   * `npx gltfjsx` fails ("Cannot find package 'jsdom-global'"), so it is installed with
#     jsdom-global and jsdom into ~/.cache/sawad-gltfjsx, outside the repo and its package.json.
#   * The URL in the TSX is the bare file name; it is rewritten to /sawad/models/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENV="${GLTFJSX_ENV:-$HOME/.cache/sawad-gltfjsx}" # outside the repo: eslint and tsc would pick it up
OUT=scripts/blender/out/jsx
MODELS=public/sawad/models

if [ ! -x "$ENV/node_modules/.bin/gltfjsx" ]; then
  mkdir -p "$ENV"
  (cd "$ENV" && npm init -y >/dev/null && npm i --silent gltfjsx@6.5.3 jsdom-global@3.0.2 jsdom@29.1.1)
fi

mkdir -p "$OUT"
models=("$@")
[ ${#models[@]} -gt 0 ] || models=("$MODELS/compound-high.glb" "$MODELS/compound-low.glb")
for glb in "${models[@]}"; do
  name="$(basename "$glb" .glb)"
  # compound-high -> CompoundHigh
  component="$(echo "$name" | awk -F- '{for (i = 1; i <= NF; i++) printf toupper(substr($i,1,1)) substr($i,2)}')"
  "$ENV/node_modules/.bin/gltfjsx" "$glb" --types --keepnames --shadows -o "$OUT/$component.tsx"
  sed -i.bak "s#'/$name.glb'#'/sawad/models/$name.glb'#g" "$OUT/$component.tsx" && rm "$OUT/$component.tsx.bak"
  # .tsx.txt keeps it out of this project's typecheck and lint (the scene code copies from it).
  mv "$OUT/$component.tsx" "$OUT/$component.tsx.txt"
  echo "$OUT/$component.tsx.txt"
done
