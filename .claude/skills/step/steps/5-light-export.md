# Step 5: Light and export

**Goal:** day and dusk light baked for the compound's real orientation, and the final web files (GLBs and KTX2 lightmaps) exported and inside budget. This is Zaitun's tracks 4 and 6B.

**Blocks without the real north direction.** If the brief doesn't have it, ask for it and stop.

Standards: `SHOWCASE_PROMPT.md` PHASE 4 and PHASE 6. The lightmap contract in `docs/zaitun/LIGHTING.md` and the export notes in `docs/zaitun/EXPORT.md` apply unchanged. Numbers: `quality-bar.md` light and model sections.

## Skills

`lighting`, `rendering`, `lookdev`, `archviz`, `threejs-lighting`, `threejs-textures`, `threejs-asset-pipeline`, `export-pipeline`, `asset-optimization`. MCP: blender.

## Work

1. **Sun and sky** worked out from the compound's own latitude, real north, date and time of day, with the brief's sky and air (clear, hazy, dusty, humid). The compound's setting record gets them. Don't start from Zaitun's 4.2° Erbil sun or its dusty-rose sky unless the brief asks for that look.
2. **Bake** with `lighting.py` and `bake-lightmaps.sh` for the compound, both tiers: day and dusk rigs, lights at every modelled fitting (windows room by room, street lamps, gates, amenities, pools, courts), diffuse irradiance on UV2, the page layout Zaitun uses. Check for seams, leaks and blotches; Zaitun's dusk bake came out blotchy, so look hard at dusk before calling it done.
3. **Match Cycles:** web day frames within 2% median of the Cycles reference.
4. **Export** with `export-final.sh --compound <slug>`: meshopt + KTX2, UV2 kept as `TEXCOORD_2`, ETC1S lightmap pages, glTF validator and `ktx validate` clean, lit copies match their tiles, budgets met.
5. Lightmap PNG masters stay out of `public/` (keep them in the git-ignored build output).

## Owns

The compound's lighting record, its bake outputs, its exported GLBs and lightmaps, its export report and their tests.

## Done when

- Day and dusk renders from the four start views, Cycles against web comparisons with their numbers, the size table against the bar.
- Zaitun's exports and lightmaps unchanged. `npm run check` passes.
- Review page published; row 5 set to "awaiting approval".
