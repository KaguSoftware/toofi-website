# Zaitun Hills export: decision and budgets (track 6A, for approval)

Constants live in `scripts/blender/finalize-manifest.mjs`. `build.sh` fails the build when any of them is broken.

## 1. Meshopt or Draco: keep meshopt

Measured on today's model (textures already KTX2, same `optimize` flags, only `--compress` changed):

| File | meshopt | Draco | meshopt + brotli | Draco + brotli |
|---|---|---|---|---|
| compound-high | 4.08 MB | 2.89 MB | 3.06 MB | 2.79 MB |
| compound-low | 1.48 MB | 0.94 MB | 0.99 MB | 0.88 MB |

Draco is 29–36% smaller on disk, but only 9–11% smaller once the server compresses the response. Reasons to stay on meshopt:

- Meshopt is built to stay small under gzip or brotli, so the transfer gap is small. Draco output is already entropy-coded.
- It is already wired (`compoundModel.ts`, 7A's R3F scene) and needs no decoder files. Draco adds a WASM decoder (hosted in `public/`, or fetched from a CDN by `useGLTF`'s default).
- It decodes much faster, which matters on mid-range phones (not measured here; this is the documented trade-off).
- It also compresses the attributes this plan adds: `_COLOR_0` instance tints, UV2 lightmap coordinates and instancing data. Draco compresses triangle meshes only.
- Switch to Draco only if a measured 4G load misses the 5 s target by about the 1 MB it would save.

Open to verify in 6B/QA: that the host serves `.glb` with brotli or gzip (the "with brotli" columns assume it does).

## 2. Proposed budgets (28 ha)

Assumed starting point: today's 7 ha model is 4.08 / 1.48 MB. The 28 ha site adds the amenities (7 templates from 1A), a site mesh about 4× larger, more AO bakes and the `_COLOR_0` tints. Vegetation and life are the 3A files (1.23 / 0.41 and 0.24 / 0.22 MB today).

| File | High tier | Low tier |
|---|---|---|
| compound | 7.0 MB | 2.8 MB |
| vegetation | 1.6 MB | 0.7 MB |
| life | 0.4 MB | 0.3 MB |
| **Models together (initial load)** | **8.5 MB** (caps sum to 9.0, so the total binds) | **4.0 MB** |
| Lightmap set, KTX2 (day and dusk each, after the first frame, outside the initial load) | 2.0 MB | 0.8 MB |

Whole-page initial load, high tier, estimated: models 8.5 + transcoder 0.6 + 3D JS about 0.4 gzip + poster 0.3 + fonts and app JS about 1.0 = about 10.8 MB, under the 15 MB limit with about 4 MB spare. The low tier is about 6.3 MB and loads the 3D only after the content, which is how the 4G < 5 s target is kept (poster and content first).

Textures: high tier 2048 atlas (1024 normal and AO), low tier 1024 atlas (512 normal and AO), as today. That already meets "2K max, 1K on mobile".

## 3. Triangles: under 300k visible

Instanced homes multiply: the 28 ha site without LODs is **about 794k triangles on the high tier** (15 courtyard × 15.7k, 30 × 9.8k, 15 × 8.6k, 6 blocks × 22.5k), and about 246k even on the low-tier meshes. So distance LODs are required, not optional:

| LOD | Mesh | Used |
|---|---|---|
| LOD0 | high-tier mesh | within about 60 m, so at most about 6 homes |
| LOD1 | low-tier mesh (4.1k / 3.1k / 2.7k / 8.3k) | to about 180 m |
| LOD2 | simplified proxy, about 1k triangles per home, about 2k per block | beyond that |

Budget split for what is visible at once: architecture 180k, vegetation 90k, life 15k, site 15k = 300k. Estimate for a street view: 6 × LOD0 (about 65k) + 20 × LOD1 (about 68k) + 40 × LOD2 (about 40k) = about 173k. An aerial view with every building at LOD2 is about 62k. These are estimates until 1B has the real meshes and 7B/7D measure on a device. LOD2 meshes come from 1B (Blender build) and are switched in 7B/7D. 6A adds no mesh code.

## 4. gltfjsx

`scripts/blender/gltfjsx.sh` (or `JSX=1 scripts/blender/build.sh`) writes typed components to `scripts/blender/out/jsx/*.tsx.txt`, using gltfjsx 6.5.3 (current). Findings:

- `npx gltfjsx` is broken in 6.5.3 (`jsdom-global` is missing from its dependencies), so the script installs it with `jsdom-global` and `jsdom` into `~/.cache/sawad-gltfjsx`. Nothing is added to `package.json`.
- `--transform` and `--instance` both re-encode the GLB: on compound-low it grew from 1.48 to 2.15 MB and lost meshopt and KTX2. The script never passes them; the shipped GLB comes untouched from `build.sh`.
- Output is `.tsx.txt` on purpose, so this repo's typecheck and lint ignore it. 7B copies what it needs. `useGLTF` needs a KTX2 loader and the transcoder at `/sawad/basis/` (meshopt is handled by drei).
- The generated nodes use `scripts/blender` names (`villa-courtyard_1` …). Regenerate after 1B changes the naming.

## 5. Other changes in this track

- `build.sh` now runs the official glTF validator on both outputs (errors fail the build) and states the new budgets.
- The KTX2 transcoder stays at `public/sawad/basis/` (copied from `three/examples/jsm/libs/basis/` by `build.sh`); not moved.

## 6. Hand-offs

- **1B** (owns `compoundModel.manifest.test.ts`): the test still asserts the old 5 / 2 MB `budgets` in the committed `compound.manifest.json`. It passes today because the manifest is unchanged. After 1B's rebuild regenerates the manifest, update those two numbers to 7 000 000 and 2 800 000 in that test.
- **1B**: emit LOD1 and LOD2 meshes per home type, and keep the high file at or under 7 MB.
- **3A / 1B**: `vegetation-*.glb` and `life-*.glb` are checked only when present in `public/sawad/models/`; they are in the 3A worktree and not yet in main.
