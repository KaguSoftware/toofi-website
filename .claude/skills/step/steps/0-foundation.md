# Step 0: Foundation (once)

**Goal:** make "which compound" a parameter everywhere, so every new compound runs through the exact code path that produced Zaitun Hills, and Zaitun's output stays identical.

Runs once. Afterwards, `docs/compounds/STATUS.md` shows step 0 as approved and every compound starts at step 1.

## Before starting

- Read `docs/zaitun/STATUS.md`. If a Zaitun track is in progress and owns a file this step changes, stop and say which. If the optimization fixes (F1–F6) are not approved yet, tell the owner in one line what a compound started now would miss (start-up stall, wide-shot triangles, 4G load) and ask whether to go ahead or wait.
- Ask the owner where a new compound's showcase appears: its own compound page (recommended), Home, or both. Home stays on Zaitun unless they say otherwise.
- Create `docs/compounds/STATUS.md` from `templates/pipeline-status.md` if it does not exist.

## Skills

`threejs-react-three-fiber`, `threejs-loaders`, `blender-web-3d`, `export-pipeline`, `vercel-react-best-practices`, `next-dev-loop`, `webapp-testing`. MCP: playwright.

## Work

1. **Capture Zaitun first.** Before changing anything: frames of each poster view and each story stop, both tiers, day and dusk (the 7D / QA capture method); the build reports and manifest for both tiers; `lightmaps.json`; the layout JSON; the test count. Store them under `docs/compounds/_reference/zaitun/` (large images git-ignored) with the commit they came from.
2. **Plans as data.** The `plan...` functions in `components/sawad/scene/layout.ts` read one record per compound (`masterplans[slug]` in the layout JSON) instead of Zaitun's constants. Streets, plots and boulevards become data on that record (curves, grids, parameters), not Zaitun-shaped code. Plan coordinates stop being measured from the river (today +x is "downstream"): each plan has its own origin and its own north angle.
3. **The setting as data, with nothing assumed.** Today the scene assumes Zaitun's setting everywhere: a stream through the site (`buildPlanStream`, `planIsRiver`, `riverCenterZ`, river banks, walk mode's water test), a valley with foothills (`buildTerrain`, `planTerrainHeight`), river-fed green ground (`planGroundColor`), and one sky, haze, fog and hemisphere light for every compound (`HAZE_COLOR`, `HEMISPHERE_LIGHT`, `fogDensity`, `buildSky`). Make each one a part of a per-compound setting record:
   - **Ground:** any height grid (flat, sloping, hills, dunes), covering the site and the surroundings out to the horizon the wide shots see.
   - **Water: optional, and one of several kinds.** None, river or stream, canal, lake, sea with a shoreline, or pools only. Each kind has its own shape data and water look. Code that asks "is this water?" works when there is none.
   - **Surroundings beyond the wall:** what fills the wide shots (open land, farmland, desert, a neighbouring town, mountains), as data the scene draws.
   - **Climate and ground cover:** which plants grow where, ground colours (irrigated, dry, sand, snow), dust and haze.
   - **Sky and light:** sky colours, haze colour and density, fog, hemisphere light, and the sun from latitude, real north, date and time of day.
   - **Sound:** the ambience layers.
   The `variant === "zaitun"` branches in `world.ts` (sun, grass, water colour and chop, crown colour, counts) become fields of the same record. Zaitun's record carries today's values exactly.
4. **A compound registry.** `SceneVariant` comes from a registry of compounds instead of a fixed union, keeping type safety (a typed union generated from the registry). `siteFor`, `usesPlan`, viewpoints, markers, landscape, vegetation, life, baked light and culling all take the slug. Bustan Dijla and Shatt Gardens stay on the 7 ha layout and draw what they draw today.
5. **Scripts take the compound.** `build_compound.py --compound <slug>`, `lighting.py`, `bake-lightmaps.sh`, `export-final.{sh,mjs}`, `finalize-manifest.mjs`, `draw-masterplan.mjs`, `export-scene-layout.mjs`, `render-story-stills.mjs` and the film scripts (`scene.mjs`, `shots.mjs`, `film.py`, `render.sh`) write `compound-<slug>-*`, `lightmaps/<slug>/`, `story/<slug>-*`, with budgets in a per-compound table. Zaitun's file names stay as they are.
6. **One experience component.** `ZaitunExperience` becomes `CompoundExperience` taking the slug; story stops, caption keys, sound, music, posters, stills and start views come from a per-compound config file (`components/sawad/experience/compounds/<slug>.ts`). Home keeps showing Zaitun. Mount it where the owner chose.
7. **Prove a second compound works, in a different setting.** Add two small test compounds used only by tests, each deliberately unlike Zaitun: one on flat dry land with no water and a town beside it, one on a coast with a sea. Each has two villas, one block and a few trees. Run both through the plan, site, ground, water, surroundings, sky, landscape, markers, viewpoints, walk mode and experience config. They must never ship to the site.
8. **Guard it.** A test that fails when a `"zaitun"` string literal appears in shared code outside Zaitun's own data and config files, and one that fails when shared code calls river or foothill functions without checking that the compound has them.
9. Update `components/sawad/scene/README.md` and `components/sawad/experience/README.md` with how a compound plugs in.

## Owns

Everything under `components/sawad/scene/`, `components/sawad/experience/`, the scripts named above, `lib/sawad/data.ts` (registry only), `docs/compounds/`.

## Done when

- Zaitun's frames match the step-1 capture (mean diff under 1/255), its build reports show the same triangles, materials and instance counts, and the GLB budgets and manifest test still pass.
- Both test compounds run through every part of the pipeline in tests, with no stream, foothills or Zaitun sky showing up in either.
- The literal guard passes. `npm run check` passes with as many tests or more.
- Review page: Zaitun before/after frames side by side with their diffs, both test compounds' plans and scenes, the list of per-compound fields (plan and setting).
- Mark step 0 in `docs/compounds/STATUS.md` as "awaiting approval".
