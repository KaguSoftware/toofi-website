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
| 1B | Model rebuild at 28 ha | in progress | zaitun/1B (worktree) | 2026-11-19 | Base = approved 0 (main) + 1A + 2 worktree changes applied into the 1B worktree |
| 3B | Landscape placement | in progress | main (main checkout) | 2026-11-19 | |
| 5A | Storyboard | in progress | main (main checkout, uncommitted) | 2026-11-19 | Started |
| 6A | Export pipeline and budgets | in progress | main (main checkout) | 2026-11-19 | |
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
