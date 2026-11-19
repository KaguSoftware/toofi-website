#!/usr/bin/env bash
# Downloads the CC0 source textures for the compound trim sheet into scripts/blender/textures/
# (git-ignored). Every source is CC0 (public domain):
#   Poly Haven  https://polyhaven.com/license
#   ambientCG   https://docs.ambientcg.com/license/
# The hedge leaves and the mashrabiya lattice are generated procedurally in build_compound.py.
set -euo pipefail
cd "$(dirname "$0")"
DEST=textures
mkdir -p "$DEST"

polyhaven() { # id
  local id=$1 dir="$DEST/$1"
  mkdir -p "$dir"
  # File names vary per asset (diff/col), so resolve them through the public API.
  curl -fsSL "https://api.polyhaven.com/files/${id}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for key, name in (("Diffuse", "color"), ("nor_gl", "normal"), ("Rough", "rough")):
    print(name, d[key]["1k"]["jpg"]["url"])' | while read -r name url; do
    [ -f "$dir/$name.jpg" ] || curl -fsSL -o "$dir/$name.jpg" "$url"
  done
}

ambientcg() { # id
  local id=$1 dir="$DEST/$1"
  [ -d "$dir" ] && return
  mkdir -p "$dir"
  curl -fsSL -o "$dir/src.zip" "https://ambientcg.com/get?file=${id}_1K-JPG.zip"
  unzip -q -o "$dir/src.zip" "*_Color.jpg" "*_NormalGL.jpg" "*_Roughness.jpg" -d "$dir"
  rm "$dir/src.zip"
  mv "$dir"/*_Color.jpg "$dir/color.jpg"
  mv "$dir"/*_NormalGL.jpg "$dir/normal.jpg"
  mv "$dir"/*_Roughness.jpg "$dir/rough.jpg"
}

polyhaven white_stucco        # https://polyhaven.com/a/white_stucco        plaster
polyhaven fine_grained_wood   # https://polyhaven.com/a/fine_grained_wood   timber
ambientcg Travertine009       # https://ambientcg.com/view?id=Travertine009 limestone coping, slab, plinth
ambientcg PavingStones128     # https://ambientcg.com/view?id=PavingStones128 boulevards, courtyards
ambientcg Tiles070            # https://ambientcg.com/view?id=Tiles070       pool mosaic
ls -R "$DEST" | grep -c jpg | xargs echo "source maps:"
