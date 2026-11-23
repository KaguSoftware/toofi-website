#!/usr/bin/env bash
# Zaitun Hills final export (track 6B): turns track 4's lit raw GLBs and lightmap PNGs into the
# files the site ships, then checks them against the budgets and the lightmap contract.
#
#   scripts/blender/export-final.sh              # needs KTX-Software's `ktx` CLI (4.3+) on PATH
#
# In:   scripts/blender/out/compound-zaitun-<tier>.lit.raw.glb    (scripts/blender/bake-lightmaps.sh)
#       scripts/blender/lightmaps/zaitun/<state>-<page>-<tier>.png (same bake: the PNG masters)
# Out:  public/sawad/models/compound-zaitun-<tier>.<hash>.glb     meshopt + KTX2, UV2 kept as TEXCOORD_2
#       public/sawad/lightmaps/zaitun/<state>-<page>-<tier>.<hash>.ktx2
#       public/sawad/lightmaps/zaitun/dusk-ground-<tier>.<hash>.png   the one page the scene fetches as PNG
#       public/sawad/models/zaitun-export.json                    sizes, budgets, checks
#       public/sawad/models/compound-zaitun.manifest.json         `files` and `budgets` updated in place
#       components/sawad/scene/assetVersions.json                 stable → versioned names (version-assets.mjs)
#
# After the encode, the asset diet (diet.mjs: AO only on the court lattices, the high tier's atlas one
# mip lower, the half-size day page) and the versioned names (version-assets.mjs). Then rebuild the far
# set from the new full model: scripts/blender/export-far.sh.
#
# The model is encoded exactly as scripts/blender/build.sh encodes the 7 ha model, with one flag
# added: `optimize` prunes unused vertex attributes by default, and TEXCOORD_2 (the lightmap UVs) is
# referenced by no glTF texture slot, so it needs --prune-attributes false. Docs: docs/zaitun/EXPORT.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
GT=(npx -y @gltf-transform/cli@4.2.1)
OUT=scripts/blender/out
MODELS=public/sawad/models
LIGHTMAPS=public/sawad/lightmaps/zaitun
MASTERS=scripts/blender/lightmaps/zaitun

command -v ktx >/dev/null || {
  echo "KTX2 textures need KTX-Software's ktx CLI (4.3+): https://github.com/KhronosGroup/KTX-Software/releases" >&2
  exit 1
}
mkdir -p "$OUT" "$MODELS"

# KTX2 per texture slot, as build.sh: UASTC + zstd for the normal map only, ETC1S for the rest.
# Meshopt runs last, because every texture command rewrites the file and drops the geometry compression.
#   tier  atlas (base, ORM)  normal  AO
#   high  2048               1024    1024
#   low   1024               512     512
# The high tier is not simplified, so the bevels survive as modelled; the low tier is its own Blender
# pass and is simplified too.
encode_model() { # tier atlasSize normalSize simplifyArgs...
  local tier=$1 atlas=$2 normal=$3; shift 3
  local raw="$OUT/compound-zaitun-$tier.lit.raw.glb" tmp="$OUT/final-$tier"
  [ -f "$raw" ] || { echo "missing $raw: run scripts/blender/bake-lightmaps.sh first" >&2; exit 1; }
  "${GT[@]}" resize "$raw" "$tmp.1.glb" --width "$atlas" --height "$atlas"
  "${GT[@]}" resize "$tmp.1.glb" "$tmp.2.glb" --pattern "atlas-normal*" --width "$normal" --height "$normal"
  "${GT[@]}" uastc "$tmp.2.glb" "$tmp.3.glb" --slots "normalTexture" --level 2 --zstd 18
  "${GT[@]}" etc1s "$tmp.3.glb" "$tmp.4.glb" --quality 255
  "${GT[@]}" optimize "$tmp.4.glb" "$MODELS/compound-zaitun-$tier.glb" \
    --compress meshopt --texture-compress false --palette false --instance-min 2 --prune-attributes false "$@"
  # The glTF validator does not decode KHR_texture_basisu images and reports every one as
  # IMAGE_UNRECOGNIZED_FORMAT (the same call in build.sh fails for the same reason), so that code is
  # ignored. Geometry, accessor and index errors still fail the export.
  "${GT[@]}" validate "$MODELS/compound-zaitun-$tier.glb" --ignore UNUSED_OBJECT,IMAGE_UNRECOGNIZED_FORMAT >"$OUT/validate-zaitun-$tier.txt" ||
    { cat "$OUT/validate-zaitun-$tier.txt" >&2; exit 1; }
}

# Lightmap pages as KTX2: ETC1S at top quality, sRGB, full mip chain. The day and dusk pages of a
# tier are each one set (6A budget: 2.0 MB high, 0.8 MB low). UASTC is closer to the PNG, but a
# single 2048 x 2048 buildings page is about 2.9 MB, so it does not fit.
encode_lightmaps() {
  local png out
  for png in "$MASTERS"/*.png; do
    out="$LIGHTMAPS/$(basename "${png%.png}").ktx2"
    ktx create --format R8G8B8_SRGB --encode basis-lz --qlevel 255 --clevel 5 --generate-mipmap "$png" "$out"
    ktx validate "$out" >/dev/null
  done
  # The dusk ground page is blended in as a PNG (experience/lightmaps.ts): it ships as it is.
  cp "$MASTERS"/dusk-ground-*.png "$LIGHTMAPS/"
}

if [ "${SKIP_MODELS:-0}" != 1 ]; then
  encode_model high 2048 1024 --simplify false
  encode_model low 1024 512 --simplify true --simplify-error 0.0005
fi
[ "${SKIP_LIGHTMAPS:-0}" = 1 ] || encode_lightmaps
node scripts/blender/diet.mjs
node scripts/blender/export-final.mjs
node scripts/blender/version-assets.mjs
