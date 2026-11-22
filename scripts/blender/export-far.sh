#!/usr/bin/env bash
# Zaitun Hills far set (optimization track F2A): the whole site at far-view detail, loaded before the
# first frame. The full files (export-final.sh) still load right after it and replace it in place.
#
#   scripts/blender/export-far.sh            # needs KTX-Software's `ktx` CLI (4.3+) on PATH
#   pnpm install --dir scripts/blender/far --ignore-workspace     # once, for far-set.mjs
#
# In:   public/sawad/models/compound-zaitun-<tier>.glb           the shipped full model (geometry source)
#       scripts/blender/out/compound-zaitun-<tier>.lit.raw.glb   track 4's lit raw GLB (texture source)
# Out:  public/sawad/models/compound-zaitun-far-<tier>.glb
#       public/sawad/models/zaitun-far.json                      sizes, triangles, checks
#
# The geometry is simplified straight from the shipped file, in its quantized space: every node,
# instance transform and quantization frame stays byte for byte the full file's, so the loader can
# swap each mesh's geometry and textures in place (compoundModel.ts). The textures are re-encoded from
# the raw masters at far-view sizes with the same settings as export-final.sh (ETC1S, UASTC normal map).
# Docs: docs/zaitun/perf/F2A.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
GT=(npx -y @gltf-transform/cli@4.2.1)
OUT=scripts/blender/out

command -v ktx >/dev/null || {
  echo "KTX2 textures need KTX-Software's ktx CLI (4.3+): https://github.com/KhronosGroup/KTX-Software/releases" >&2
  exit 1
}
[ -d scripts/blender/far/node_modules ] || {
  echo "run: pnpm install --dir scripts/blender/far --ignore-workspace" >&2
  exit 1
}

# Far-view texture sizes (the full sizes are in export-final.sh):
#   tier  atlas (base, ORM)  normal  AO
#   high  512                256     64
#   low   256                128     32
# Nothing in a far view is seen closer than a quarter of the full atlas's texel density, so these
# are the mip levels the GPU samples there anyway. The AO maps are only read where the baked
# lightmap is missing (lattices, screens), so they keep a token size: the slot stays, and with it
# the material's shader, so the swap to the full textures compiles nothing.
far_textures() { # tier atlas normal ao
  local tier=$1 atlas=$2 normal=$3 ao=$4
  local raw="$OUT/compound-zaitun-$tier.lit.raw.glb" tmp="$OUT/far-$tier"
  [ -f "$raw" ] || { echo "missing $raw: run scripts/blender/bake-lightmaps.sh first" >&2; exit 1; }
  "${GT[@]}" resize "$raw" "$tmp.t1.glb" --width "$atlas" --height "$atlas"
  "${GT[@]}" resize "$tmp.t1.glb" "$tmp.t2.glb" --pattern "atlas-normal*" --width "$normal" --height "$normal"
  "${GT[@]}" resize "$tmp.t2.glb" "$tmp.t3.glb" --pattern "ao-*" --width "$ao" --height "$ao"
  "${GT[@]}" uastc "$tmp.t3.glb" "$tmp.t4.glb" --slots "normalTexture" --level 2 --zstd 18
  "${GT[@]}" etc1s "$tmp.t4.glb" "$tmp.textures.glb" --quality 255
  rm -f "$tmp.t1.glb" "$tmp.t2.glb" "$tmp.t3.glb" "$tmp.t4.glb"
}

if [ "${SKIP_TEXTURES:-0}" != 1 ]; then
  far_textures high 512 256 64
  far_textures low 256 128 32
fi
[ "${SKIP_BUILD:-0}" = 1 ] || node scripts/blender/far/far-set.mjs
