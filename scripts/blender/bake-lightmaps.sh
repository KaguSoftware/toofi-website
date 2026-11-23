#!/usr/bin/env bash
# Zaitun Hills lighting (track 4): builds both tiers of the 28 ha model as generated .blend files,
# then lights them and bakes the day and dusk lightmaps onto UV2 (scripts/blender/lighting.py).
#
#   scripts/blender/bake-lightmaps.sh                 # 512 samples, with validation frames
#   SAMPLES=128 scripts/blender/bake-lightmaps.sh     # faster draft
#   BLENDER=/path/to/blender scripts/blender/bake-lightmaps.sh
#
# Writes scripts/blender/lightmaps/zaitun/ (the PNG pages, masters for export-final.sh), the stable
# public/sawad/lightmaps/zaitun/lightmaps.json, scripts/blender/lighting.report.json and
# scripts/blender/out/compound-zaitun-<tier>.lit.raw.glb (the model with UV2, for track 6B's
# KTX2 + meshopt export). About 15 minutes on an M-series Mac (Metal). Then run export-final.sh,
# which encodes the pages and versions every file (version-assets.mjs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUT=scripts/blender/out

node scripts/export-scene-layout.mjs
scripts/blender/fetch_textures.sh
mkdir -p "$OUT"
for tier in high low; do
  "$BLENDER" -b --factory-startup -P scripts/blender/build_compound.py -- --plan zaitun --tier "$tier" --blend "$OUT/zaitun-$tier.blend"
  "$BLENDER" -b "$OUT/zaitun-$tier.blend" --python-exit-code 1 -P scripts/blender/lighting.py -- --tier "$tier" --samples "${SAMPLES:-512}" --validate
done

# lighting.py writes its PNG pages beside lightmaps.json in public/. They are masters, never fetched
# (the site ships their KTX2 files), so they move out of public/ (ledger T49); export-final.sh puts
# back the two the scene does fetch (the dusk ground pages).
mkdir -p scripts/blender/lightmaps/zaitun
mv public/sawad/lightmaps/zaitun/*.png scripts/blender/lightmaps/zaitun/
