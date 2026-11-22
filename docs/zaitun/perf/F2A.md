# F2A: the far set

Fix track F2A of the [optimization plan](../OPTIMIZATION_PLAN.md) (ledger rows K2, K3, K7). 2026-11-22.

The first frame of Zaitun Hills used to wait for the whole compound model: 10.26 MB on the high tier, 4.97 MB on the low tier. It now waits for a far set, the same site at far-view detail: **4.69 MB high, 2.69 MB low**. The full files still load right after it and replace it in place, so nothing else changes yet. F2B builds on this: mid and near detail streamed by tour stop, and distance levels per copy.

## Result on the P0 rig

| Measure (section 1 of the plan) | Baseline | With the far set | Target |
|---|---|---|---|
| Live scene, phone profile (Fast 4G, 4× CPU), cold | 7.10 s | **5.34 s** (5.30 warm) | 5 s |
| Transfer before the live scene, phone (low tier) | 5.34 MB | **3.60 MB** | 3 MB |
| Live scene, desktop (high tier), cold | 1.46 s | **1.04 s** | – |
| Transfer before the live scene, desktop (high tier) | 10.83 MB | **6.11 MB** | 5 MB |
| First content, phone | 532 ms | 528 ms | no worse |
| Blocking to live scene, phone (median) | 684 ms | 660 ms | < 300 ms (F1) |
| Triangles on the poster frame, high / low | 1.45 M / 378 k | 1.35 M / 354 k | 300 k (F2B) |
| Look: all 22 reference cameras, the path a visitor gets | – | **all pass**, 0.33–1.22/255 | ≤ 2/255 |
| Poster-to-scene handover | 13.18 / 12.18 (rig) | 13.17 / 12.19 | no worse |

Runs: `scripts/perf/trace.mjs` (3 cold + 3 warm per profile), `scripts/blender/far/gate.mjs mixed` (11 cameras × 2 tiers), `scripts/perf/frames.mjs`. The rig was on AC power with Low Power Mode off. Raw results are in `scripts/perf/results/2026-11-22T07-21-50-trace/` and `scripts/blender/out/far-gate/` (both git-ignored).

The two transfer targets are not met yet. What remains before the live scene is now mostly other files: on the phone, 2.69 MB far set (gzip on the wire is less), 1.02 MB JavaScript, 0.25 MB lightmaps and 0.25 MB texture decoder. F2B (small lightmap first, the vegetation and life files) and F5 (brotli, decoder fetch) take it further.

## What ships

| File | What |
|---|---|
| `public/sawad/models/compound-zaitun-far-{high,low}.glb` | The far set |
| `public/sawad/models/zaitun-far.json` | Sizes, triangles, settings, and the structure check against the full file (`passed: true`) |
| `scripts/blender/export-far.sh`, `scripts/blender/far/far-set.mjs` | Builds it: `scripts/blender/export-far.sh` (its own package: `pnpm install --dir scripts/blender/far --ignore-workspace`) |
| `components/sawad/scene/compoundModel.ts` | Far set first, then the full file swapped in place |
| `scripts/blender/far/gate.mjs` | The look gate for it, on the P0 rig (see below) |

## How the far set is made

- **Same structure as the full file.** The far set is built straight from the shipped full GLB, in its quantized space. Nodes, instance transforms, quantization frames, materials and texture slots are never touched. The vertices that set each primitive's bounding box and sphere are locked, and kept if no triangle uses them any more. So the bounds are the full file's too. The script reads back what it wrote, compares it with the full file, and fails on any difference.
- **Textures at far-view sizes.** Re-encoded from track 4's lit raw GLB with export-final.sh's settings: ETC1S, and UASTC for the normal map. High tier: 512 atlas, 256 normal, 64 AO. Low tier: 256 / 128 / 32. Together 190 KB and 65 KB, against 3.94 MB of full-tier textures.
- **AO UVs flattened on baked surfaces.** A baked surface multiplies its AO map by 0 (bakedLight.ts), so its AO UVs carry nothing. They are set to one constant, the centre of the AO map's brightest texel at far-view size. The constant compresses to almost nothing (−1.05 MB high, −0.63 MB low). If the bake fails to load, an unbaked far set is not darkened: the AO maps' corners are black, so zeros would have darkened it. Lattices, screens and clear glass keep their real AO UVs.
- **UVs stored a little coarser**: atlas UVs to 1/2000, lightmap UVs to 1/4000 of their range (−1.5%).
- **Simplified only where it cannot show: the parking courts, the playground and the tennis courts.** Within 5 cm (high) or 8 cm (low), with meshoptimizer's permissive mode, pricing lightmap UVs and normals. Buildings, the site and the carports keep their triangles (high tier: 180 k of 223 k in the file, 1.09 M of 1.18 M placed).

### Ruled out (measured)

| Candidate | Size high / low | Why not |
|---|---|---|
| Simplify everything, seams kept | 6.3 / 3.8 MB (223 k → 204 k triangles) | The model is faceted: nearly every quad has its own trim-sheet UVs, so a seam-keeping simplifier removes almost nothing |
| Simplify everything across seams (permissive, no prices) | 1.33 / 1.03 MB | Fails the gate: poster 2.39, opening 2.58/255 high, 3.36 / 4.64 low |
| Same, pricing lightmap UVs, normals and/or trim-sheet UVs | 3.0–4.9 / 2.0–2.8 MB | Passes the 2/255 mean, but window reveals smear across the mosque's and the gym's walls, visible at 3× (the buildings are small in the frame, so the mean hides it). Area-weighted attribute error lets small high-contrast features go |
| Protect only seams where UVs really jump | 5.9–6.2 MB | Nearly every seam in this model is a real jump: nothing left to remove |
| Carports simplified too | −0.02 MB | Their roofs visibly change shape |
| Positions rounded to 4 mm | no gain | And it moves bounding spheres |

## How it loads

`loadCompound` for Zaitun Hills:

1. **First frame.** The far set and the day lightmaps load together. One KTX2 loader serves the far set, the light and the full file. Meshopt geometry decodes in two workers.
2. **Full file fetched.** It starts once the far set has been drawn (the renderer's frame counter moved), so on a slow line it never shares bandwidth with what the first frame waits for.
3. **Swap.** It happens when the full file has arrived *and* 150 frames have passed since the first frame (the 2 s poster hold and a margin). It is spread over frames: one full texture uploaded per frame, then one mesh per frame. Each far mesh keeps its object, materials and per-copy attributes (lightmap tile). It takes the full geometry, and its materials take the full textures. So the culling, the baked light, the reflections and the group the caller holds keep working, and no shader compiles.
4. **Failures.**
   - The far set fails: the first frame waits for the full file, as before.
   - The full file fails or doesn't match: reported (`sawad-scene`, stage `compound-detail`), and the far set stays.
   - The model is freed meanwhile: the full file is freed when it arrives, and never fetched if the far set was never shown.

**Cost of the swap.** The uploads and the per-mesh swaps make no long frame on either tier. The only long frame the full file adds is one 33 ms frame on the phone profile (4× CPU), when it arrives: GLTFLoader building it on the main thread. Measured by timing every WebGL upload call per frame on the rig. The start-up frames that run long (P7) do so with or without the full file.

## The look gate

`node scripts/blender/far/gate.mjs far|full|mixed [--candidates …] [--capture-at N]` runs the rig's cameras and probe under its lock. It adds what `frames.mjs reference` has no switch for: which compound files the page may fetch. It also prints a grain-free number (4 × 4-pixel block means), because the post chain's film grain shifts whenever three's random stream does (S3).

| Mode | What it shows | Result |
|---|---|---|
| `far` | The far set alone (full files refused), poster, opening, aerial, orbit | High 1.22 / 0.98 / 0.47 / 0.46, low 0.91 / 0.75 / 0.50 / 0.45 (grain-free 0.17–0.38). Handover 13.17 / 12.19 |
| `full` | Far files refused: the full file first, as before F2A | All 22 cameras within grain: changed 0.0%, worst pixel ≤ 16 |
| `mixed` | What a visitor gets | All 22 pass (0.33–1.22/255); poster-hold is the far set, every later camera the full model |

**At frame 900, the mixed path is pixel-identical to the full-only path** on three cameras (high opening and orbit, low walk), grain included. On the other three it differs in 11–51 pixels (worst 61/255), the same in repeated runs. The spots are lattice holes, a doorway and small blobs between palms. The likely cause is draw order on surfaces that tie in depth: three.js sorts opaque draws by material id, and the far set's materials are created at a different moment than a direct full load's. This is unconfirmed. The buildings themselves match.

## For later tracks

- **`frames.mjs reference` now captures the far set on `poster-hold`** (frame 60, during the hold), and the full model on every later camera. The swap lands at a frame-exact point under the rig's virtual time, as long as the full file arrives within the hold (it does, by about a second on the rig). To compare full detail on the poster frame, use `gate.mjs full`.
- **The far set is derived from the shipped full file.** Rebuild it (`scripts/blender/export-far.sh`) after any change to `compound-zaitun-{high,low}.glb`. Otherwise the structure check, and with it the in-place swap, fails. The swap reports and keeps the far set on a mismatch.
- **For F2B:** the swap machinery (`upgradeToFull`, `pairDetail`) works for any pair of files with the same structure, so mid and near levels can reuse it. The courts setting (`byMesh`) is where per-template rules go.
