# Zaitun Hills showcase: status

Each track updates its own row only. Status is one of: not started, in progress, awaiting approval, approved, blocked.
A track counts as done for its dependants only when it says **approved**, and only the owner marks a track approved.

| ID | Track | Status | Branch / worktree | Last update | Notes |
|---|---|---|---|---|---|
| 0 | 28 ha masterplan | approved | main (main checkout, uncommitted) | 2026-11-19 | Drawing: `docs/zaitun/masterplan.svg` (`node scripts/draw-masterplan.mjs`). 860 × 326 m, 60 villas (15/30/15) + 6 blocks, valley floor + terrace 6 m up, 58% landscape. The plan is the `plan…` exports in `layout.ts` and `masterplan` in `layout.json` (homes, streets, gates, walls, amenities, parking, lamps, tree zones, ground on a 4 m grid); the 7 ha layout beside it is unchanged and still drives the scene and the shipped model until 1B and 7B switch over. Zaitun data: 84 homes, matched plot for plot. Amenities use 1A's default sizes (parking courts of 10, 8 and 6 bays a side); the sales gallery is a `villa-courtyard` instance. Check passes with `.claude/` excluded (361 tests); plain `npm run check` here stops at lint on the other worktrees. Open: site copy still says 96 homes (i18n.ts, seed, SAWAD.md) |
| 1A | Amenity assets | approved | zaitun/1A (worktree) | 2026-11-19 | 7 parametric templates in `scripts/blender/amenities.py` (gym, padel, tennis, playground, mosque, carport, parking), baked but unplaced; report + test; `npm run check` green |
| 2 | Materials | approved | zaitun/2 (worktree) | 2026-11-19 | Atlas re-packed at real scale (200–285 px/m), 8 new amenity surfaces, dust/grime/run-off streaks/stains/AO corner dirt (round 2 after review), per-copy tint API; GLB 4.79/1.81 MB; check passes. 1B: call apply_instance_tint per copy; 6A: ship tints as _COLOR_0 |
| 3A | Vegetation and life assets | approved | zaitun/3A (worktree) | 2026-11-19 | vegetation.py, life.py, lib/sawad/wind.ts; 4 GLBs in public/sawad/models (1.23 MB / 412 KB veg, 239 / 224 KB life); far-palm frond fix in; not committed |
| 7A | R3F migration at parity | approved | zaitun/7A (worktree, uncommitted) | 2026-11-19 | Engine ported to React Three Fiber 9.8.2; frames match the old engine (mean diff under 1/255); `npm run check` passes (375 tests). Lazy 3D chunk grew from 208 to 305 KB gzip. |
| 1B | Model rebuild at 28 ha | approved | zaitun/1B (worktree, uncommitted) | 2026-11-19 | `build_compound.py --plan zaitun` → `compound-zaitun-{high,low}.glb` 9.01/4.26 MB + `compound-zaitun.manifest.json` (7 ha files kept for Bustan/Shatt); 60 villas, 6 blocks, 7 amenities + gallery, 60 carports, 7 courts, 164 lamps; tris 1.18M high / 456k low (over 300k visible: LODs for 6A); provisional budgets 10/5 MB in finalize-manifest (6A to confirm); build.sh needs a `--plan zaitun` pass (6A's file); web terrain must sit under the garden steps (7B); worktree also carries 0+1A+2 changes; check passes (391 tests) Open after approval: reconcile with 6A (6A budgets key `compound-*.glb` at 7 / 2.8 MB; 1B ships `compound-zaitun-*.glb` at 9.01 / 4.26 MB; both edited finalize-manifest.mjs) |
| 3B | Landscape placement | approved | zaitun/3B (worktree, uncommitted) | 2026-11-19 | New `components/sawad/scene/landscape.ts` + test (layout.ts untouched): `planLandscape(tier)` (palms, olives, citrus, hedges, shrubs, grass in 64 m cells, all from `planTreeZones()`/`planLandUseAt()`), `planLife(tier)` (people, cars, bird flocks; `samplePath`, `birdPosition`), LOD table + `visibleTriangles` (street/aerial/hills/terrace all under 90k on both tiers). High: 1,365 palms, 11.6k olives (3.1k inside the walls), 165 citrus, 742 hedge modules, 2.6k tufts; low thins only outside the walls. `npm run check` passes (395 tests). 7B wires it into the scene and loads vegetation/life GLBs (still only in the zaitun-3A worktree) |
| 5A | Storyboard | approved | main (main checkout, uncommitted) | 2026-11-19 | 12 shots, 87 s, cameras placed from layout.ts in `scripts/blender/film/shots.mjs` → `shots.json` (5B reads it); 36 greybox boards via `storyboard.py`; east gate for the crane, hero villa-14; tests check clearance, speed, easing and level verticals; `npm run check` green (387 tests) |
| 6A | Export pipeline and budgets | approved | main (main checkout, uncommitted) | 2026-11-19 | Proposal: `docs/zaitun/EXPORT_BUDGETS.md`. Keep meshopt (Draco measured: 9–11% smaller on the wire only). Budgets in `finalize-manifest.mjs`: compound 7 / 2.8 MB, veg 1.6 / 0.7, life 0.4 / 0.3, models 8.5 MB high / 4 MB low, 300k visible triangles (needs distance LODs: 794k without). `gltfjsx.sh` added (npx gltfjsx 6.5.3 is broken; --transform/--instance bloat the GLB). tsc, eslint and 364 tests pass with `.claude/` excluded. 1B must update the manifest test's old 5/2 MB after its rebuild |
| 7B | R3F scene on new layout | not started | | | |
| 4 | Lighting and lightmaps | not started | | | |
| 7C | Web experience features | not started | | | |
| 6B | Final export | not started | | | |
| 5B | Film, stills, posters | not started | | | |
| 7D | Final wiring and performance | not started | | | |
| QA | Acceptance | not started | | | |

## Owner inputs

| Input | Needed by | Status |
|---|---|---|
| Real north direction | 4 | missing |
| Reference images (5–10) | 0 onward | missing |
| Logo for the end card | 5B | missing |
| Music | 5B | missing |
| Final names, prices, availability | QA | sample data in use |
