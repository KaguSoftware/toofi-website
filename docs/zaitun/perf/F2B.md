# F2B: detail streaming and asset diet

Optimization track F2B, 2026-11-22, worktree `zaitun/F2B` (from d36d779). The queue is section 4 of [FINDINGS.md](FINDINGS.md). The code is written and tested. Approved by the owner on 2026-11-23 and merged **before the look gates and the rig measurements**, which still have to run after the P0 rig pass (the owner's decision D16).

## What changed, row by row

| Row | Change | Where | Bytes (gzip, as `next start` sends) |
|---|---|---|---|
| T6 | AO maps and `TEXCOORD_1` removed from the Zaitun compound, full and far, both tiers, except on the two court lattices. A mesh that keeps its lightmap UVs gets a `TEXCOORD_1` with no bytes behind it (glTF requires UV sets with no gap); the loader drops it before upload | `scripts/blender/diet.mjs` (step `ao`), `compoundModel.ts` `prepareCompound` | full high 7.14 → 3.17 (with T42), full low 3.10 → 2.04, far high 2.43 → 2.35, far low 1.36 → 1.33 |
| T14 | Through a hide (Next's Activity), the model, plants and life are kept, not freed. They are freed after 3 minutes, or at once if the canvas has left the page. On a reveal the hook always re-renders its users (see "The black hero") | `useTimedAsset.ts` (`keep`), `useCompoundModel.ts` | Home → Compounds or Residences → back: no request, scene drawn and moving (checked in the dev server) |
| T23 | Every node of the model has its matrix composed once (`matrixAutoUpdate = false`) | `compoundModel.ts` `prepareCompound` | — |
| T30 | The finder's scene asks for the far set only and never fetches the full file | `SceneRoot.tsx`, `useCompoundModel(…, "far")`, `loadCompound(…, detail)` | Residences on desktop: the 3.17 MB full file is no longer fetched (7.14 MB before T6) |
| T32 | Every file the scene fetches from `public/sawad/` has a content hash in its name. The Basis transcoder sits in a folder named by its hash. The scene reads the addresses through `assetUrl()` and a generated map | `scripts/blender/version-assets.mjs`, `components/sawad/scene/assetUrl.ts`, `assetVersions.json` | — (repeat visits once F5 sets the lifetimes) |
| T36 | On the high tier the first frame takes the day buildings page at half size: its own KTX2 without the top mip level, so the same tile layout. The full page replaces it after the poster hold, on its own frames | `diet.mjs` (step `half`), `compoundModel.ts` `upgradeDayPage`, `bakedLight.ts` `setBakedDayPage` | first frame, desktop: 0.72 → 0.26 MB |
| T38 | The high tier's vegetation atlas goes from 2048² to 1024² (top mip dropped). Approved by the owner (D6) | `diet.mjs` (step `vegetation`) | 1.07 → 0.51 MB, before the live scene on desktop |
| T42 | The high tier's atlas goes one mip lower: base colour and ORM 1024², normal map 512² | `diet.mjs` (step `atlas`) | in the full-high figure above |
| T48 | Baked surfaces read the sun's shadow from three's own lookup in the light loop instead of looking it up a second time | `bakedLight.ts` `lightsWithSunShadow` | — (up to 0.5 ms a frame at stop 1, per S4) |
| T49 | The PNG lightmap masters moved to `scripts/blender/lightmaps/zaitun/`. Only the two dusk ground pages stay in `public/`, because the scene does fetch those (see F2B-1) | `bake-lightmaps.sh`, `export-final.sh` | deploy: `public/sawad/lightmaps/zaitun` 27.6 → 3.6 MB |
| T52, T53 | Deferred (D3; RS) | | |
| T57 | Not checked: the site has no Vercel project yet. See "Open" | | |

**Transfer before the live scene, desktop (sum of the files above, not measured):** far set −0.08, vegetation −0.56, day page −0.46, so about **−1.10 MB**, from 6.11 to about 5.0 MB. F1's rows (T2, T8, T28) come on top of that. **Phone:** only the far set, −0.03 MB; the phone's remaining rows are F1's.

All the edits are byte-exact: every kept buffer view is copied byte for byte, and a dropped mip level is exactly what the GPU already samples one level down. The methods are S3's, and S3 put each saving through the look gate one at a time (V1 for T6, V2 and V5 for T42, V3 for T38). **The files that ship are not those files:** the high model carries T6 and both halves of T42 together, every stripped mesh has the zero-byte `TEXCOORD_1`, and the far set, the half-size day page (T36) and the shadow reuse (T48) were never gated at all. The far set was rebuilt from the new full file with `far-set.mjs`, and its triangle counts match F2A's exactly (high 180,455 of 222,941; low 104,529 of 124,423).

## The pipeline now

```
bake-lightmaps.sh  → scripts/blender/lightmaps/zaitun/*.png, public/…/lightmaps.json
export-final.sh    → encode the models and pages → diet.mjs → export-final.mjs (checks, budgets) → version-assets.mjs
export-far.sh      → far-set.mjs (from the dieted full file, ends with the diet's AO pass) → version-assets.mjs
build.sh (7 ha)    → … → finalize-manifest.mjs → version-assets.mjs
```

The pipelines keep writing stable names. `version-assets.mjs` then renames each file (`name.<hash>.ext`), removes the version it replaces and rewrites `components/sawad/scene/assetVersions.json`. Scripts that read a shipped file go through `shippedPath()`: a fresh stable-named output if one exists, otherwise the versioned file. `node scripts/blender/version-assets.mjs --check` and the test `version-assets.test.ts` fail when a file is unversioned or the map is stale.

## Verified so far

- `npm run check` passes on the merged tree (with F1, F4 and F6). One assertion in S6's `scripts/perf/S6/delivery.test.ts` was changed to the versioned transcoder path, with the owner's permission. The three lint warnings are in files of S3 and F6.
- glTF validator: no errors on the dieted files (the tangent-space warnings were there before).
- Dev server, desktop profile (not a measurement): no shader or console errors. The scene goes live with the versioned names, half page first, then the full page and the full model after the first frame. The finder fetches no full file. A round trip from the top of Home to Residences or Compounds and back (4 s and 12 s away) fetches nothing, and the hero draws and moves as it does without this track.

## The black hero, found before the merge

T14's first version left Home black (frozen, once F1 was merged) after a visit to another page, at the top of the page. It was missed at first because the check used a scrolled page, where scrolling repairs it. The base does not do it.

- **Cause.** On a reveal `EffectComposer` builds a new composer, but `PostFX.tsx` hands it to the render pass only when `PostFX` itself renders again. Reloading any asset used to force that render. With everything kept, the hook returned the same state object, nothing rendered again, and the render pass drew through the old, emptied composer (0 draw calls in 2 s).
- **Fix here.** The hook sets a new state object when it takes an asset back, so its users render again. Regression test in `useTimedAsset.test.tsx` (fails without the fix).
- **For F3.** The fragile part is in `PostFX.tsx` (F3's file): the hand-over should happen whenever the composer changes (a ref callback), not only when `PostFX` renders. Until then anything that reveals the scene without a render there can do this again.

## Still to run (after the P0 rig pass, D16)

One change per gate, against the reference frames, on the visitor path (`node scripts/blender/far/gate.mjs mixed`). The candidates are kept in `scripts/blender/out/f2b/<step>/`:

1. T6 (`ao`): every camera, both tiers. S3 measured ≤ 0.34/255 grain-free.
2. T42 (`atlas`, stacked on T6): every camera plus the new close-up camera (`gate.mjs … --shots close --width 1440`, captured on main and on the change, compared with `scripts/perf/S3/compare.mjs --against`). The camera's frames need tuning on its first run.
3. T38 (`vegetation`): new high-tier reference frames afterwards (D6).
4. T36 (`half`): the poster, the opening and the aerial, plus the handover against the poster.
5. T48: every camera; expected identical.
6. T30: the finder's views, for the owner (D12).
7. The rig: trace and frames for the numbers above (bytes and live scene on both profiles, memory over five round trips for T14).

## New finding

| ID | Where | Finding | Proposed fix | Gain | Look | Owner of the fix |
|---|---|---|---|---|---|---|
| F2B-1 | `experience/ExperienceWorld.tsx`, `experience/lightmaps.ts` | The dusk ground page is fetched as a PNG through a `TextureLoader`: 0.77 MB (high) and 0.24 MB (low) the first time dusk is asked for. S3 thought only KTX2 pages were fetched. Its KTX2 already ships beside it (0.16 / 0.05 MB) | Load the KTX2 through the model's loader (`withKtx2`), then drop the two PNGs from `public/` | −0.61 MB (high), −0.18 MB (low) per dusk visit | ETC1S against PNG on the lamp pools: gate on the `dusk` camera | `ExperienceWorld.tsx` is in no track's list; F2B owns `lightmaps.ts` |

## Hand-offs

- **F5:** long lifetimes only for `VERSIONED_PATTERN` in `scripts/blender/version-assets.mjs` (models, lightmap pages and `lightmaps.<hash>.json`, `basis/<hash>/`). The model reports (`*.manifest.json`, `zaitun-*.json`), posters and stills are not versioned, so a blanket `/sawad/**` rule would serve them stale.
- **F1:** `experience/early.ts` repeated the addresses instead of reading the table, so its preloads would have gone to files that no longer exist. With the owner's word it now goes through `assetUrl()` (four lines, and two assertions in `ZaitunExperience.test.tsx`). `LIVE_DOWNLOAD_MB` there still holds the numbers from before this track; RS updates it.
- **F3:** new data files (T25, T34, T35) under `public/sawad/` should be added to `SCOPE` in `version-assets.mjs` (F2B's file) so they are versioned too.
- **Docs no track owns:** `docs/SAWAD.md` ("replace the files in `public/sawad/models/`"), `docs/zaitun/LIGHTING.md` and `docs/zaitun/EXPORT.md` still name stable paths and the PNGs in `public/`.
- **Edited outside the list:** one assertion in `components/sawad/experience/ExperienceWorld.test.tsx` now expects the versioned dusk page addresses (`ExperienceWorld.tsx` is unchanged and in no track's list).
- **One-off search scripts** (`scripts/perf/S3/glb-cost.mjs` examples, `S6/delivery.mjs`, `S6/variants.mjs`, `S7/request.mjs`) name stable paths. They did their job; RS reruns the rig, which classifies files by extension.

## Open

- **T57:** whether Vercel compresses `.glb`. The site has no Vercel project yet; checking needs a preview deployment (`curl -sI -H 'Accept-Encoding: br, gzip' <preview>/sawad/models/compound-zaitun-far-low.<hash>.glb`). If it doesn't, the far set goes over the wire at 2.62 MB instead of 1.33 MB on the phone. The fix (pre-compressed files unpacked in the browser) would fit the versioned layout as it is.
