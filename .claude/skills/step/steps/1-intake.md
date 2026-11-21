# Step 1: Intake and brief

**Goal:** one brief that holds everything the later steps need, written from what the owner uploads, with every gap listed and every new asset flagged. Nothing is modelled here.

## Start

1. Ask for the compound's name in English and Arabic and a two-letter code if the owner has not given them. Make a slug from the English name (lowercase, hyphens; the scene id may be a shorter single word, e.g. `nakheel`).
2. Create `docs/compounds/<slug>/` with `inputs/`, `review/`, `BRIEF.md` (from `templates/brief.md`) and `STATUS.md` (from `templates/status.md`). Write the slug to `docs/compounds/ACTIVE`. Add the compound's row to `docs/compounds/STATUS.md`.
3. Tell the owner, in one short list, what to send (the brief template's inputs table), and that they can attach files in chat, give paths, or drop them in `docs/compounds/<slug>/inputs/`. Partial is fine: the step works with what it gets and lists the rest.

## Reading the uploads

- **DXF:** read with `ezdxf` in a virtual environment in the scratchpad (ask before installing). List every layer with its entity counts, then map layers to meaning (boundary, plots, roads, buildings, levels/contours, trees, water) and confirm the mapping with the owner. Units: check `$INSUNITS` and a known dimension.
- **DWG:** ask the owner to export DXF (or PDF) from their CAD program. Converting DWG locally needs the ODA File Converter; only install it if the owner asks.
- **PDF plans and elevations:** read the pages; take dimensions only from dimension lines or a stated scale, never by eye.
- **Images and references:** read each one and note what it shows (style, material, mood, framing).
- **The setting, for a real place:** with the owner's permission (the coordinates go to an outside service), get open elevation data (Copernicus GLO-30 or SRTM) for the site and its surroundings out to about 5 km, so the land and the horizon in the wide shots are the real ones. Use the owner's site photos, and public map and satellite views if they allow, to describe what lies around the site on each side. Work out the sun for the coordinates and the chosen date and time.
- **The setting, for an invented place:** the owner describes it (land, water, surroundings, climate). Propose the details that make it believable, with references, and confirm them.
- Record every value in the brief with its source (file, layer or page). A value without a source is marked "assumed" and listed as a gap.

## Deciding what is new (sets step 3's scope)

Compare the brief with what already exists and mark each part of step 3 as needed or not, with the reason:

- **Building types:** against `RESIDENCE_TYPES` in `lib/sawad/data.ts` and the villa and apartment builders in `scripts/blender/build_compound.py`. A different footprint, height or layout is a new type, unless it is just a scaled version the builder already supports.
- **Amenities:** against the 7 templates in `scripts/blender/amenities.py` (gym, padel, tennis, playground, mosque, carport, parking) and the gate pavilions, sales gallery and pool.
- **Materials:** against the atlas regions and palette in `build_compound.py` and `world.ts`.
- **Plants and life:** against `scripts/blender/vegetation.py` (olive, date palm, citrus, hedges, grass) and `life.py` (people, cars, birds), including clothing for the region. Plants must suit the climate: a coast, a desert or a cold highland won't reuse Zaitun's olive slopes.
- **Setting:** against what step 0's setting record can already draw. A water kind with no look yet (a sea with waves and a shoreline, a lake, a canal with hard edges), surroundings that need assets (a town, a skyline, dunes, mountains, farmland), new ground cover (sand, rock, snow) or a sky the shader can't make are new.

If nothing is new, mark step 3 "skipped (not needed)" in STATUS.md.

## Skills

`archviz`, `environment-artist`, `visual-plan`, `arabic-writing` (for the Arabic name and story lines). MCP: none required.

## Done when

- `BRIEF.md` is filled in: every section has values with sources or is listed under gaps, each gap names the step that needs it and whether it blocks.
- A first plan sketch from the CAD or drawings (SVG, boundary, plots, roads, levels) checks that the inputs were read correctly.
- Review page: the brief summary, the plan sketch, a reference board, the asset-needs table with reasons, the gaps table.
- Row 1 set to "awaiting approval".
