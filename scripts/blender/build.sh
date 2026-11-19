#!/usr/bin/env bash
# Rebuilds the baked compound model end to end:
#   layout.ts -> layout.json -> Blender (model, trim sheet, AO bake) -> glTF Transform -> public/sawad/models
#
#   scripts/blender/build.sh            # needs Blender 4.2+ and KTX-Software's `ktx` CLI on PATH
#   BLENDER=/path/to/blender scripts/blender/build.sh
#
# Budgets (28 ha site; see docs/zaitun/EXPORT_BUDGETS.md): compound-high.glb <= 7 MB,
# compound-low.glb <= 2.8 MB, checked by finalize-manifest.mjs and compoundModel.manifest.test.ts.
# Geometry stays meshopt (measured against Draco: 8-11% bigger over the wire, but no extra
# decoder, faster decode, and it compresses the instancing and UV2 attributes too).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
GT=(npx -y @gltf-transform/cli@4.2.1)
OUT=scripts/blender/out
MODELS=public/sawad/models

command -v ktx >/dev/null || {
  echo "KTX2 textures need KTX-Software's ktx CLI (4.3+): https://github.com/KhronosGroup/KTX-Software/releases" >&2
  exit 1
}

node scripts/export-scene-layout.mjs
scripts/blender/fetch_textures.sh
for tier in high low; do
  "$BLENDER" -b --factory-startup -P scripts/blender/build_compound.py -- --tier "$tier" --samples "${SAMPLES:-512}"
done

mkdir -p "$MODELS"
# KTX2 per texture slot. `optimize --texture-compress ktx2` encodes normal, ORM and AO maps as
# UASTC (~1 byte per texel), which alone is ~8 MB here. Instead: UASTC + zstd for the normal map
# only, ETC1S for base colour, ORM and the smooth single-channel AO. Meshopt runs last, because
# every texture command rewrites the file and drops the geometry compression.
#   tier  atlas (base, ORM)  normal  AO
#   high  2048               1024    1024
#   low   1024               512     512 (baked at 512)
# High-tier simplification is off so the bevels survive as modelled; the low tier is its own
# Blender pass (no bevels, window trims, mashrabiya screens or benches) and is simplified too.
encode() { # tier atlasSize normalSize simplifyArgs...
  local tier=$1 atlas=$2 normal=$3; shift 3
  local raw="$OUT/compound-$tier.raw.glb" tmp="$OUT/compound-$tier"
  "${GT[@]}" resize "$raw" "$tmp.1.glb" --width "$atlas" --height "$atlas"
  "${GT[@]}" resize "$tmp.1.glb" "$tmp.2.glb" --pattern "atlas-normal*" --width "$normal" --height "$normal"
  "${GT[@]}" uastc "$tmp.2.glb" "$tmp.3.glb" --slots "normalTexture" --level 2 --zstd 18
  "${GT[@]}" etc1s "$tmp.3.glb" "$tmp.4.glb" --quality 255
  "${GT[@]}" optimize "$tmp.4.glb" "$MODELS/compound-$tier.glb" \
    --compress meshopt --texture-compress false --palette false --instance-min 2 "$@"
}
encode high 2048 1024 --simplify false
encode low 1024 512 --simplify true --simplify-error 0.0005

# Structural gate: the official glTF validator must report no errors (UNUSED_OBJECT is info).
for tier in high low; do
  "${GT[@]}" validate "$MODELS/compound-$tier.glb" --ignore UNUSED_OBJECT >"$OUT/validate-$tier.txt" || { cat "$OUT/validate-$tier.txt" >&2; exit 1; }
done

# Basis Universal transcoder for KTX2Loader.
mkdir -p public/sawad/basis
cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm} public/sawad/basis/

node scripts/blender/finalize-manifest.mjs

# Optional: typed JSX for the React Three Fiber scene.  JSX=1 scripts/blender/build.sh
[ "${JSX:-0}" = 1 ] && scripts/blender/gltfjsx.sh
