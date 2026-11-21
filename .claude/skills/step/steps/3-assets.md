# Step 3: New assets

**Goal:** every building type, amenity, material, plant and figure the compound needs that the library does not have yet, at Zaitun's level of detail. Only the parts step 1 flagged as needed; the rest is reused as is.

Standards: `SHOWCASE_PROMPT.md` PHASE 1 (modelling), PHASE 2 (materials), PHASE 3 (landscaping and life). Inputs: the brief's building types, palette, finishes, species, references.

Work the flagged parts in this order and get each one approved before the next, in the same session where possible: **3a buildings, 3b amenities, 3c materials, 3d plants and life, 3e setting.** Record each part in the compound's STATUS.md notes.

## Skills

`archviz`, `blender-web-3d`, `uv-workflow`, `materials`, `lookdev`, `asset-optimization`, plus `vegetation-artist`, `environment-artist`, `threejs-shaders` for 3d, and `environment-artist`, `threejs-shaders`, `threejs-materials`, `threejs-performance` for 3e. MCP: blender.

## 3a Building types

- A parametric builder per new type (new module under `scripts/blender/`, imported by `build_compound.py`), driven by the dimensions in the owner's elevations and plans: real wall thickness, window frames, glass, railings, parapets and copings, roof details (AC units, drain spouts), bevelled edges, curtains and interior hints behind the glass.
- Both tiers: high with bevels, trims, screens; low without, as Zaitun's.
- Names follow the manifest's scheme. Footprint and height match the brief exactly.

## 3b Amenities

- New templates in `scripts/blender/amenities.py`, sized by arguments, in the compound's style and palette, following the existing seven.

## 3c Materials

- New atlas regions from the same CC0 libraries (Poly Haven, ambientCG), tinted into the brief's palette, at real scale (200–285 px/m like Zaitun's), with the same imperfection pass (dust, grime, run-off, stains, AO corner dirt) and per-copy tint variation. If the palette differs from Zaitun's, the palette test gets the compound's own palette, not Zaitun's loosened.

## 3d Plants and life

- New species in `scripts/blender/vegetation.py` with LODs, distance cards and wind sway (`lib/sawad/wind.ts`); new figures or clothing in `life.py` dressed for the region.

## 3e Setting

- **New water kinds:** the look in the scene (a water material per kind: sea with swell, foam at the shore and a horizon; lake; hard-edged canal) and in Blender for the bake and the film, at the same standard as Zaitun's stream (reflections, sun glitter, movement).
- **Surroundings:** what the wide shots see beyond the wall (a town, a skyline, dunes, mountains, farmland, a coast), as cheap distance assets or cards that hold up in the aerials, with LODs.
- **Ground cover and sky:** new ground looks (sand, rock, snow, salt flats) and any sky the current shader can't make (humid coast, clear desert, overcast highland).
- Everything is driven by the setting record from step 2, so the next compound with the same kind reuses it.

## Proof of quality

For each new asset: a turntable or three fixed views on both tiers, and a side-by-side with the closest Zaitun asset at the same camera and light, so the owner can see the detail level matches. Triangle and texture counts next to Zaitun's.

## Owns

The new modules, the new templates in `amenities.py`, new regions in the atlas code, new species and figures, their tests and reports.

## Done when

- Every flagged part approved by the owner. Zaitun's build output unchanged (same build report).
- `npm run check` passes. Review page with all parts; row 3 set to "awaiting approval" after the last part.
