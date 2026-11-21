# Step 2: Site plan

**Goal:** the compound's masterplan as data, matching the owner's drawings, with the homes in `lib/sawad/data.ts` matching the plots one for one. This is what track 0 did for Zaitun; every later step builds on it.

Standards: `SHOWCASE_PROMPT.md` PHASE 0 and CINEMATIC PRINCIPLES. Inputs: the brief.

## Skills

`archviz`, `environment-artist`, `visual-plan`, `camera-cinematography`. MCP: blender (optional, for a quick massing check).

## Work

1. **The setting record:** the ground grid for the site and the surroundings out to the horizon (from the elevation data for a real place, from the brief for an invented one), the water of the brief's kind (or none), what stands around the site on each side, ground cover zones, and the plan's origin and north angle.
2. **The plan record** (`masterplans[<slug>]`, through the plan code step 0 made generic): boundary, area, levels, streets and their curves, gates, walls, every plot with its type and orientation, apartment blocks, amenities with sizes (step 3's new ones at their intended size), parking, lamps, benches, tree zones, land use, ground on the 4 m grid, the sun for the real north if known.
3. **Match the drawings.** Plot corners within 0.5 m of the CAD (or the scale stated on the PDF). Where the drawing is unbuildable as given (a plot off the slope, a road too steep, an overlap), propose the fix and ask; don't change the owner's plan silently.
4. **Homes.** The compound's entry and its residences in `lib/sawad/data.ts`: types, counts, mix, floors, outlooks, prices from the brief's pricing rule, status mix, handover, site area, landscape share. Plot for plot with the model.
5. **The drawing:** `docs/compounds/<slug>/masterplan.svg` from `scripts/draw-masterplan.mjs --compound <slug>`: plots numbered, types colour coded, amenities, roads, gates, parking, tree zones, water, contours, what lies beyond each side, north and sun direction, scale bar. Plus a wide setting drawing showing the site in its surroundings.
6. **Viewpoints to aim for:** propose the four start views and five story stops on the plan (entrance, a street, the hero home, the amenities, an aerial), drawn on the plan. Step 6 sets them exactly.
7. **Tests:** the compound's plan, setting and data tests (counts, plot-for-plot match, slopes, no overlaps, every plot reachable from a street), and the finder counts.

## Owns

The compound's plan and setting records and their tests, the compound's entries in `lib/sawad/data.ts` and their tests, `docs/compounds/<slug>/masterplan.svg`.

## Done when

- The drawing, an overlay on the owner's CAD or PDF showing the match, and a numbers table (area, landscape share, counts per type, amenities, parking bays, street lengths).
- Zaitun's plan, data and frames unchanged. `npm run check` passes.
- Review page published; row 2 set to "awaiting approval".
