# Step 7: Posters, stills, film

**Goal:** posters that hand over to the live scene without a jump, 4K stills, and (if the brief asks for one) the film and its vertical cut. This is Zaitun's 5A and 5B. Runs after step 6 because the posters are framed on the web opening shots.

Standards: `SHOWCASE_PROMPT.md` PHASE 5 and CINEMATIC PRINCIPLES; `scripts/blender/film/FILM.md`. Numbers: `quality-bar.md` film section.

This step has two approvals: the storyboard first, then the renders.

## Skills

`camera-cinematography`, `archviz`, `rendering`, `compositing`, `lighting`, `lookdev`, `visual-plan`, `ffmpeg-skill`. MCP: blender.

## Work

1. **Storyboard** (film only): shots placed from the compound's plan with `shots.mjs --compound <slug>`, greybox boards with `storyboard.py`. Shot list after the prompt's PHASE 5, adapted to the compound's own story and amenities. Tests for clearance, speed, easing and level verticals. **Stop for approval.**
2. **Posters:** one per web start view at 1920 × 1080, framed and tone mapped as the web opening shots, dressed as the 7D handover expects. Measure the mean diff at the cut against the bar.
3. **Stills:** 8–10 at 4K (aerial hero, eye level, details, dusk).
4. **Film:** preview render first (960 × 540) and the 15 s vertical cut, with the owner's music and logo (`render.sh edit --music ... --logo ...`). The music's credit goes where its licence says. Fix any shot the owner flags before the final render.
5. **Final 4K render** (`render.sh final`, ~30 h for Zaitun) only after the owner approves the preview. Tell them the expected time before starting.

## Owns

The compound's shots and storyboard, `public/sawad/scene-<slug>-*.jpg`, its stills and film outputs.

## Done when

- Storyboard approved; posters, stills and preview delivered; handover diff against the bar.
- The final render started or done, as the owner chose.
- Zaitun's posters and film files unchanged. `npm run check` passes.
- Review page published; row 7 set to "awaiting approval".
