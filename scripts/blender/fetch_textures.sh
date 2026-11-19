#!/usr/bin/env bash
# Downloads the CC0 source textures for the compound trim sheet into scripts/blender/textures/
# (git-ignored). Every source is CC0 (public domain):
#   Poly Haven  https://polyhaven.com/license
#   ambientCG   https://docs.ambientcg.com/license/
# Each source gives color, normal (OpenGL) and rough maps, plus ao and height where the source
# has them (build_compound.py uses them to settle dust into crevices and falls back to the
# colour's luminance when neither exists). The hedge leaves, the mashrabiya lattice, the jali
# screen, the court fence and net, and the zellige star tile are generated in build_compound.py.
# Idempotent: re-running only fetches the maps that are missing.
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
for key, name in (("Diffuse", "color"), ("nor_gl", "normal"), ("Rough", "rough"), ("AO", "ao"), ("Displacement", "height")):
    if key in d and "jpg" in d[key].get("1k", {}):
        print(name, d[key]["1k"]["jpg"]["url"])' | while read -r name url; do
    [ -f "$dir/$name.jpg" ] || curl -fsSL -o "$dir/$name.jpg" "$url"
  done
}

ambientcg() { # id
  local id=$1 dir="$DEST/$1"
  [ -f "$dir/color.jpg" ] && [ -f "$dir/.complete" ] && return
  mkdir -p "$dir"
  curl -fsSL -o "$dir/src.zip" "https://ambientcg.com/get?file=${id}_1K-JPG.zip"
  local suffix name
  for pair in Color:color NormalGL:normal Roughness:rough AmbientOcclusion:ao Displacement:height; do
    suffix=${pair%%:*} name=${pair##*:}
    # Optional maps (ao, height) are missing from some sources: unzip fails quietly for those.
    if unzip -q -o -j "$dir/src.zip" "*_${suffix}.jpg" -d "$dir/tmp" 2>/dev/null; then
      mv "$dir"/tmp/*_"${suffix}".jpg "$dir/$name.jpg"
    fi
  done
  rm -rf "$dir/src.zip" "$dir/tmp"
  touch "$dir/.complete"
}

polyhaven white_stucco                 # https://polyhaven.com/a/white_stucco                 2.0 m  plaster, boundary wall
polyhaven fine_grained_wood            # https://polyhaven.com/a/fine_grained_wood            0.6 m  timber
polyhaven rubberized_track             # https://polyhaven.com/a/rubberized_track             2.0 m  playground soft surfacing
polyhaven patterned_terracotta_tiling  # https://polyhaven.com/a/patterned_terracotta_tiling  2.15 m mosque forecourt floor
ambientcg Travertine009                # https://ambientcg.com/view?id=Travertine009          1.2 m  limestone coping, slab, plinth
ambientcg PavingStones128              # https://ambientcg.com/view?id=PavingStones128        3.5 m  boulevards, courtyards
ambientcg Tiles070                     # https://ambientcg.com/view?id=Tiles070               0.6 m  pool mosaic
ambientcg Asphalt031                   # https://ambientcg.com/view?id=Asphalt031             fine grain: acrylic court surface
ls -R "$DEST" | grep -c jpg | xargs echo "source maps:"
