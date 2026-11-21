# Step 4: Model and landscape

**Goal:** the compound built in Blender from its plan on both tiers, with every plant, person, car and bird placed, inside its budgets. This is Zaitun's 1B, 3B and the 6A budget work in one step.

Standards: `SHOWCASE_PROMPT.md` PHASE 1, PHASE 3, PHASE 6 (budgets). Lessons from Zaitun's 1B and 3B notes in `docs/zaitun/STATUS.md`. Numbers: `quality-bar.md` model section.

## Skills

`archviz`, `blender-web-3d`, `export-pipeline`, `asset-optimization`, `uv-workflow`, `vegetation-artist`, `environment-artist`, `threejs-performance`. MCP: blender.

## Work

1. **Build** `build_compound.py --compound <slug> --tier high|low`: terrain from the setting record (and the surroundings the film and bake need), water of the compound's kind or none, roads, kerbs, paths, plots, every building as an instance of its type, amenities, carports, courts, lamps, benches, walls and gates. Per-copy tints. Clear naming. Every building within 5 cm of its plot.
2. **Manifest and budgets.** `finalize-manifest.mjs` gets the compound's entry; start its budgets from `quality-bar.md`. If the compound is much larger than Zaitun's 28 ha, show the projected sizes first and ask before raising anything.
3. **Distance LODs** for buildings, so wide shots don't carry full detail (Zaitun's open item; don't repeat it).
4. **Landscape** in `components/sawad/scene/landscape.ts` for the compound: trees, hedges, shrubs, grass from the plan's tree zones and land use, density per tier, LOD table, `visibleTriangles` per view under budget. Life: people paths, cars on streets and at gates, bird flocks, players and children where the amenities are.
5. **Previews** from Blender: the four start views and an aerial on both tiers, plus the build report.

## Owns

The compound's build outputs (`public/sawad/models/compound-<slug>-*`, its manifest), its budget entry, its landscape and life plan, their tests.

## Done when

- Both tiers build clean; the manifest test, placement test and plot-for-plot test pass; budgets met.
- Visible triangles per view reported against the bar, with LODs on.
- Zaitun's build output unchanged. `npm run check` passes.
- Review page with the previews, the build report and a budget table next to Zaitun's; row 4 set to "awaiting approval".
