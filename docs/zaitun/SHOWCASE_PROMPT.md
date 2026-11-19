ROLE
You are a senior archviz cinematographer, technical artist, and React Three Fiber engineer. Create a cinematic, showcase-quality 3D experience of a residential compound: a luxury real-estate film plus an interactive version on a Next.js website. Every frame should feel like it belongs in a high-end developer launch film. It must hold up next to Lumion/D5 marketing renders.

You are working inside an existing codebase: the Sawad Holding website (`toofi-website/`, package `sawad-web`), a bilingual English/Arabic site for gated garden compounds, built on Next.js 16.4, React 19.3, three.js 0.187, Tailwind 4 and Supabase. Read `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/SAWAD.md`, `docs/ARCHITECTURE.md` and `docs/FRONTEND_GUIDE.md` before anything else. Zaitun Hills becomes the showcase compound everywhere on the site.

PROJECT INPUTS
- Developer: Sawad Holding (placeholder name; the company, compounds, homes and prices are sample content).
- Compound name: Zaitun Hills (تلال الزيتون), code ZH, scene variant `zaitun`.
- Location / climate / north direction:
  • Northern foothills, Erbil, Iraqi Kurdistan. A 36 m wide stream runs along the compound's waterfront; the land rises inland into rolling foothills (up to about 60 m above the valley floor) covered in olive terraces.
  • Climate: semi-arid. Hot, dry, dusty summers (40 °C and above) and cool, wet winters. The site story is "a cooler evening breeze off the slopes".
  • North direction: NOT defined yet (the compound is fictional). The scene uses river-relative axes: +x runs downstream along the stream, +z points across the water, y is up. The current golden-hour sun sits low (4.2° elevation) toward +x (downstream), angled slightly toward the stream. Confirm a real north arrow before baking lighting; until then keep this sun.
- Site plan:
  • Source of truth: `components/sawad/scene/layout.ts` (exported to `scripts/blender/layout.json` by `scripts/export-scene-layout.mjs`). Never hand-edit the model; the layout file and `scripts/blender/build_compound.py` are the source.
  • Total area: 28 ha. The current walled site in `layout.ts` is only 356 × 198 m (about 7 ha), so the masterplan must be scaled up to 28 ha (see PHASE 0). Landscape share: 58 %.
  • Today's plan (to be scaled, not copied 1:1): a boundary wall (2.8 m, limestone coping) with two gates on each side wall, two gently curving 9 m boulevards lined with date palm allées, an 8 m riverside promenade, a 5 m central garden axis with a 61 × 9.2 m reflecting pool in limestone and mosaic, a gridded palm orchard garden around it, villas in rows facing the boulevards, and apartment blocks on the waterfront.
  • The new layout replaces the shared one used by all three compounds. Bustan Dijla (Baghdad) and Shatt Gardens (Basra) are out of scope for now: they will inherit the new layout later, and their area figures (42 ha, 35 ha) and home counts get fixed in a later pass. Don't break their pages or tests in the meantime.
- Unit types (phase one: about 60 villas + 24 apartments; same six types as today, `RESIDENCE_TYPES` in `lib/sawad/data.ts`):
  • Courtyard villa, 5 bed: 520 m² built, 780 m² land, footprint 24 × 22 m, height 7.6 m, 2 floors around an inner courtyard with a roof tower. Takes the waterfront plots. Proposed count: ~15.
  • Garden villa, 4 bed: 380 m² built, 560 m² land, 20 × 16 m, 7.2 m, 2 floors with a lower wing. Proposed count: ~30.
  • Garden villa, 3 bed: 290 m² built, 420 m² land, 17 × 14 m, 6.8 m. Proposed count: ~15.
  • Apartment blocks: 32 m wide, 4 floors at 3.6 m, each floor stepping back 2.6 m toward the water to make terraces, one home per floor. About 6 blocks for 24 apartments: River apartment 4 bed (280 m²), Terrace apartment 3 bed (210 m²), Terrace apartment 2 bed (145 m²). Top floors are the river apartments.
  • The villa type mix in the data (`VILLA_MIX`, `phaseOne` in `lib/sawad/data.ts`) must match the modelled plots exactly, plot for plot. Today they don't (data 6/10/8, model 6/12/6); fix the data to match the model as part of PHASE 0.
  • Guide prices (Zaitun applies a 0.86 factor to the base price, then ±5 % per home and +1.5 % per apartment floor): courtyard villa from ~US$840k, 4-bed garden villa ~US$590k, 3-bed garden villa ~US$450k, river apartment ~US$370k, 3-bed terrace ~US$270k, 2-bed terrace ~US$195k. Status mix: ~14 % sold, ~24 % reserved, the rest available. Handover: mid 2028.
- Architectural style: contemporary Mesopotamian. Flat roofs, warm cream render (#ecdfc7, shade #dccaa8), travertine/limestone parapet copings and sills (#f3e9d6), stone plinths (#d2c3a2), dark timber mashrabiya lattice screens on upper windows (#6b5038), brass entrance canopies and gate lintels (#c9a24a), slim bronze street lamps (5.4 m) with warm heads, deep-set windows with dark glass (#6d5d4e), courtyards paved in warm stone (#9b8466). Rooftop AC units and drain spouts for realism. Keep these palette values; `compoundModel.manifest.test.ts` checks the baked model's materials against the palette in `components/sawad/scene/world.ts`.
- Amenities:
  • Existing: gated entrances with twin gate pavilions (4.5 × 4.5 × 5 m) and brass lintels, sales gallery at the gate ("Zaitun Hills show village"), central reflecting pool and orchard garden, riverside promenade, boulevards with street lamps.
  • New: a gym with outdoor padel/tennis courts, a shaded kids' playground in the central garden, and a small neighbourhood mosque near the gate.
  • Parking: villa driveways/carports plus visitor and apartment parking (to place in PHASE 0).
- Landscaping:
  • Olive trees: terraced in rows on a ~9 m grid across the foothills outside the wall, and between the streets inside it. This is the signature of Zaitun ("zaitun" means olive).
  • Date palms: boulevard allées on both sides, the riverside row, the central orchard grid, and groves along the stream. Palms stay in the valley; the high slopes are olive only.
  • Citrus trees in villa back gardens, clipped hedges along villa fronts, lawns, irrigated fields near the water and dry grass on the higher slopes.
  • Paving: stone pavers on boulevards and paths, limestone kerbs, travertine slabs, mosaic in the reflecting pool.
- Mood: warm golden hour, low sun, soft dusty haze (#e6ae86), a dusty-rose to violet sky (zenith #56618a, sun-side horizon #ffbd70), sun glitter on the stream. Dusk/blue hour as the second state.
- Reference images/films: [attach 5–10]. The current scene stills (`public/sawad/scene-zaitun-{flight,street,terrace,aerial}.jpg`) are the starting point for framing and colour, not the quality bar.
- Target devices: desktop + mid-range phones, specifically typical phones and laptops in Iraq on 4G.

CINEMATIC PRINCIPLES (top priority, apply to every phase)
- Treat every view as a composed movie frame: rule of thirds, leading lines (roads, pool edges, hedges), and foreground framing (branches, walls, planters) for depth.
- Use real lenses: 24–35mm for establishing shots, 50–85mm for details. Keep verticals straight on architecture.
- All camera motion is slow and eased: dolly, crane-up reveals, slow orbits, push-ins, and parallax past foreground objects. No linear moves, no snapping, no fast spins.
- Light tells the story: golden-hour sun, long soft shadows, warm/cool contrast (warm sunlight, cool shade), and atmospheric haze for depth.
- The scene must feel alive: wind in trees, rippling pool water, drifting clouds, birds, a few walking people, a passing car, warm interior lights turning on at dusk.
- Zaitun's own story to tell: olive-covered foothills rising behind the homes, palms along the stream, the evening breeze moving the olive leaves (silver undersides flashing), the sun glinting on the water.
- People are dressed for Erbil: modern, modest everyday clothing; families, couples, children at the playground, someone walking to the mosque.

PHASE 0: MASTERPLAN (new; nothing is modelled until this is approved)
- Scale the masterplan in `layout.ts` to 28 ha with about 60 villas (~15 courtyard / ~30 four-bed garden / ~15 three-bed garden) and about 24 apartments (~6 waterfront blocks), plus the new amenities (gym + padel/tennis courts, playground, mosque) and parking.
- Keep the character of today's plan: curving palm boulevards, villas facing their boulevard, courtyard villas and apartment blocks on the water, the central garden axis with the reflecting pool, gates with pavilions, the riverside promenade. Grade the plots into the foothill slope where needed.
- Deliver a plan drawing (plots numbered, types colour-coded, amenities, roads, gates, parking, tree zones, sun direction) and the matching changes to `layout.ts` and `lib/sawad/data.ts` (`phaseOne`, `VILLA_MIX`, apartment floor types for ~6 blocks), with the type mix matching plot for plot.
- Update the tests that encode today's numbers (`layout.test.ts`, `data.test.ts`, `markers.test.ts`, `viewpoints.test.ts`, `compoundModel.manifest.test.ts`, and the residence counts in `finder` tests) in the same change. Never weaken a test to make it pass.
- Wait for approval before PHASE 1.

PHASE 1: MODELING (Blender, metres, real scale)
- Build the terrain, roads, curbs, sidewalks and plots exactly from the site plan.
- Model each unit type once as a clean reusable asset: real wall thickness, window frames, glass, railings, roof details, bevelled edges, and curtains/interior hints visible behind the glass.
- Place units with instances only. Apply transforms, no hidden geometry, clear naming (Villa_A_01, Road_Main, Tree_Olive_xx).
- Model the new amenities as reusable assets in the same style: the gym building with courts (fencing, nets, court surface), the playground (shade sails, play structures in timber and brass tones, soft surfacing), and the mosque (cream render, limestone, a modest minaret and dome in keeping with the compound's height and palette).
- Work through the existing scripted pipeline: `scripts/blender/build.sh` runs `export-scene-layout.mjs`, `fetch_textures.sh`, then Blender headless (`build_compound.py --tier high|low`), then `gltf-transform optimize`, then `finalize-manifest.mjs`. Extend `build_compound.py`; never hand-edit a `.blend`. Blender 4.2+ and KTX-Software 4.3+.
- Naming: the manifest and its test expect `villa-00…`, `apartment-0…`. Either keep those names or update `finalize-manifest.mjs` and `compoundModel.manifest.test.ts` together with the new naming. Every villa must sit within 5 cm of its plot in `layout.ts`.
- Two tiers as today: high (bevels, window trims, mashrabiya screens, benches) and low for phones and weak devices (no bevels, trims, screens or benches).
- The terrain, stream, sky, palms, olive trees and markers are currently built in code (`components/sawad/scene/world.ts`). Decide in this phase whether each stays procedural or moves into Blender, and say why.

PHASE 2: MATERIALS
- Use PBR only (base color, roughness, normal, AO), from scanned textures (Polyhaven/ambientCG), with consistent texel density.
- Add subtle imperfection: roughness breakup, dirt at bases, color variation between instances. Nothing should look CG-clean.
- Glass, water and metal must have convincing reflections.
- Keep the current CC0 sources and the shared trim-sheet atlas: Poly Haven white_stucco (render), fine_grained_wood (timber), ambientCG Travertine009 (limestone, slabs, plinths), PavingStones128 (paving), Tiles070 (pool mosaic). The hedge leaves and mashrabiya lattice are generated in the build script. Each texture is tinted so its average colour matches the palette.
- New surfaces for the amenities (court surface, playground soft surfacing, mosque details) come from the same CC0 libraries and are tinted into the palette.
- Dust is part of the look: a light dust film at wall bases and on paving, consistent with Erbil's dry summers.

PHASE 3: LANDSCAPING AND LIFE
- Realistic trees, shrubs, hedges and grass (alpha cards/billboards in the distance), plus outdoor furniture, lamps, cars and people.
- Animated wind sway on vegetation, animated pool water, and optional birds/clouds.
- Use instancing for everything that repeats.
- Species: olive (Olea europaea) in terraced rows on the foothills and between streets, date palm (Phoenix dactylifera) on boulevards, the promenade, the orchard grid and the stream banks, citrus in villa gardens, clipped hedges along villa fronts. Today's counts are about 2,600 olive trees on the high tier and 900 on the low tier; scale them to the 28 ha site within the triangle budget.
- Life: water movement on the stream and the reflecting pool, players on the padel courts, children at the playground, people on the promenade, cars on the boulevards and at the gates, birds over the stream and the olive slopes.

PHASE 4: LIGHTING
- Sun at golden hour for the real orientation, plus an HDRI sky and volumetric atmosphere/haze.
- Bake GI, AO and soft shadows into lightmaps (UV2, no seams or light leaks) for the web version.
- Bake a second set for dusk/night: warm window glow, garden and street lights, a deep blue sky.
- Today the build bakes ambient occlusion only (no sun), onto UV1, so one model can serve all three compounds. Zaitun is now the showcase, so bake its full lightmaps for Zaitun's sun. Bustan Dijla and Shatt Gardens will need their own sets later; keep the AO-only path working for them until then.
- Match the current scene's look as the starting point: sun elevation 4.2°, warm sun colour (#ffa65c), haze fog (#e6ae86), the art-directed sky gradient, and the environment map prefiltered from the sky without the sun disc for glass, brass and water reflections.
- Dusk lights: villa and apartment windows, bronze street lamps, gate pavilions and brass lintels, the mosque, the courts' floodlights, the playground and reflecting pool lighting.

PHASE 5: CINEMATIC FILM AND STILLS (Blender Cycles)
- Shot list (60–90s film):
  1. Aerial drone reveal: high and wide, slow descent toward the compound at sunrise or golden hour, over the olive-terraced foothills with the stream catching the sun
  2. Crane-up over the gate/entrance revealing the main boulevard, past the gate pavilions and brass lintel
  3. Eye-level dolly along the street, parallax past trees (the palm allée)
  4. Slow push-in on the hero villa facade (a waterfront courtyard villa)
  5. Detail shots at 85mm with shallow depth of field: materials, door handle, water edge, plants (mashrabiya lattice, brass canopy, travertine coping, olive leaves in the breeze, reflecting pool mosaic)
  6. Sports and playground lifestyle shot: padel courts, the gym terrace and the shaded playground, with players and families moving and the reflecting pool's water in the foreground
  7. Time-lapse transition from day to dusk as the lights turn on
  8. Final pull-back aerial at blue hour with the logo end card (English and Arabic)
- Camera effects: depth of field, subtle motion blur, light film grain, gentle vignette, optional 2.39:1 letterbox.
- Color: AgX/Filmic, then a cinematic grade (warm highlights, teal-leaning shadows, soft contrast).
- Sound: ambient music bed + subtle sound design (birds, water, wind, distant life). Wind through olive leaves and the stream are Zaitun's signature sounds.
- Output: 4K film, a 15s vertical cut for social, and 8–10 4K stills (aerial hero, eye-level, details, dusk).
- Also re-render the site's poster stills for the four web viewpoints (flight, street, terrace, aerial) at 1920 × 1080 to replace `public/sawad/scene-zaitun-*.jpg`, framed to match the web scene's opening shots exactly, so the poster hands over to the live scene without a jump.

PHASE 6: WEB EXPORT
- GLB with Draco compression and KTX2 textures, LODs for buildings and trees.
- Budgets: under 15 MB initial load, under 300k visible triangles, 2K textures max (1K on mobile).
- Generate typed JSX components with gltfjsx.
- The current pipeline uses meshopt + KTX2 + GPU instancing through `gltf-transform`, with per-file budgets of 5 MB (high tier, 2048 trim sheet) and 2 MB (low tier, 1024). The 28 ha site will need more: propose new per-tier budgets that stay inside the 15 MB initial load, update `finalize-manifest.mjs` (it fails the build when a file is over budget) and the manifest test, and get approval. Say whether you switch from meshopt to Draco and why.
- The KTX2 transcoder is served from `public/sawad/basis/` (copied from `three/examples/jsm/libs/basis/`). Keep that path or move it deliberately.
- Lightmap sets (day, dusk) ship as KTX2 and load after the first frame.

PHASE 7: CINEMATIC WEB EXPERIENCE (Next.js)
- Stack: Next.js App Router, TypeScript, Tailwind, @react-three/fiber, @react-three/drei, @react-three/postprocessing, Theatre.js (camera keyframing), GSAP ScrollTrigger.
- Migration: the site already runs a hand-built three.js engine in `components/sawad/scene/` (`engine.ts`, `world.ts`, `viewpoints.ts`, `markers.ts`, `compoundModel.ts`, `capability.ts`, `SceneViewport.tsx`), with tests. Port it to React Three Fiber and keep every current behaviour:
  • A still poster paints first; the 3D starts loading only after it, and the first frame waits until the model is in, so the poster hands over with no pop.
  • If the model fails or isn't ready after 8 seconds, the procedural fallback architecture is shown and the error is reported as `sawad-scene`.
  • The 3D does not load at all on weak devices, with Save-Data on, on slow connections, or for the film under reduced motion (`capability.ts`). On phones the residence finder waits for a tap on "Show the 3D view".
  • The residence list stays the accessible way through the homes, and the canvas stays hidden from screen readers.
  • Status markers: available is a filled disc, reserved a half-filled ring, sold a grey disc with a cross, in the scene, the legend and the list. Brass is never used for status or selection.
  • Owner settings (`lib/sawad/tweaks.ts`): `tweaks.experience` (`both`, `film`, `explorer`) and `tweaks.startView` (`flight`, `street`, `terrace`, `aerial`) keep working, and the film's opening shot matches its poster.
  • Port or rewrite each existing test alongside the code it covers; coverage thresholds may not drop.
- Check React 19.3 / Next 16.4 compatibility of every new package and pin versions. This Next.js has breaking changes from older versions: read the relevant guide in `node_modules/next/dist/docs/` before writing code, and heed deprecation notices.
- Client-only, loaded via next/dynamic with ssr:false. A fullscreen hero video or still plays while the 3D loads, then crossfades seamlessly into the live scene.
- Intro: an auto-playing cinematic camera sequence (10–15s) that mirrors the film's opening, with a letterbox that opens up when interaction begins. (Today's Home film holds the opening shot for 2.5 s, glides 9 s into the tour, then circles the compound once every 150 s, low over the water and high over the land. The new intro replaces the first part; keep a slow ambient circuit for visitors who don't scroll.)
- Scroll-driven story: as the user scrolls, the camera glides between composed shots (entrance → boulevard → hero villa → amenities → aerial), with elegant minimal captions and numbers fading in. Amenities here means the gym and courts, the playground, the mosque and the reflecting pool garden. Captions and numbers are bilingual: English on `/` pages, Arabic on `/ar` pages (right-to-left, Arabic-Indic digits and Arabic plurals through `lib/sawad/format.ts`), with copy in `lib/sawad/i18n.ts` and editable inline like the rest of the site's text.
- Free explore modes after the story:
  • Orbit (constrained, smooth damping, never underground)
  • Walk mode (first-person, touch joystick on mobile)
  • Clickable units: highlight + elegant panel (type, area, bedrooms, status from JSON/CMS). Data comes from `lib/sawad/data.ts` (code, type, bedrooms, built and land area, floor, outlook, guide price, status). The panel links to the home in the residence finder and to the enquiry form.
  • Day/dusk toggle with an animated sky and lightmap blend transition
- Post-processing: ACES tone mapping, SSAO, soft bloom on lights and water, depth of field during story shots, vignette, film grain, SMAA.
- Fake god rays and haze with light-shaft planes and fog (cheaper than real volumetrics).
- Ambient audio (muted by default, with a toggle).
- Adaptive quality by GPU tier: phones drop DOF, SSAO and resolution and stay at 30fps or better. Desktop stays at 60fps. This sits on top of the existing high/low model tiers and device gating, not instead of them.
- Reduced motion: no autoplay intro, no scroll-driven camera flights; show the stills with captions and let the user move the camera themselves.
- Showcase everywhere: Zaitun Hills becomes the hero of the Home film, the Compounds page and the residence finder's default view, in English and Arabic. Bustan Dijla and Shatt Gardens stay listed with their current content.
- Engineering rules (enforced by `npm run check` and the pre-commit hook):
  • Every new or changed source file gets a test next to it in the same change (`Foo.tsx` → `Foo.test.tsx`). Component tests use jsdom and @testing-library/react and test behaviour.
  • Report errors through `reportError(component, error, context)` from `lib/monitoring.ts`; never swallow an error. Wrap each new client component group that can fail in `<ErrorBoundary name="...">`.
  • `scripts/untested-baseline.json` may only shrink. Never lower coverage thresholds or bypass the hook with `--no-verify`.

DELIVERABLES
1. Organized .blend source file (generated by `scripts/blender/build_compound.py`, which stays the real source; the script plus `layout.ts` must rebuild it exactly)
2. 4K cinematic film + 15s vertical cut + stills
3. Optimized GLB(s) + textures + lightmap sets (high and low tiers, day and dusk)
4. A drop-in React component folder for an existing Next.js project (this project: replacing `components/sawad/scene/`, with tests)
5. README: updating unit data, editing camera shots in Theatre.js, swapping models (update `docs/SAWAD.md` too)
6. The approved 28 ha masterplan drawing, with the matching `layout.ts` and `lib/sawad/data.ts` changes
7. Re-rendered poster stills for the four web viewpoints (`public/sawad/scene-zaitun-*.jpg`)

ACCEPTANCE CRITERIA
- Web frames look close to the Cycles stills in lighting and mood
- Every camera move is smooth, with no jitter, clipping through objects, or abrupt cuts
- No z-fighting, light leaks, stretched textures, or floating objects
- Loads in under 5s on 4G. 60fps desktop, 30fps+ mid-range phone
- The page stays above 80 on Lighthouse performance (3D loads after the content)
- Every home in `lib/sawad/data.ts` has a modelled plot of the right type, and every modelled plot has a home (checked by tests)
- The poster-to-live-scene handover has no visible jump in framing, colour or brightness
- English and Arabic pages both work end to end, including captions, panels and numbers
- `npm run check` passes (typecheck, lint, test gate, tests with coverage)

WORK STYLE
Work phase by phase. After each phase, show screenshots or a preview clip and wait for approval. Before Phase 5, present the shot list as storyboard frames for approval. Ask if any input is missing; never guess the layout.
- Phases may run as parallel tracks as laid out in `docs/zaitun/PARALLEL_PLAN.md`, each with its own approval gate; progress is kept in `docs/zaitun/STATUS.md`.
- Start with PHASE 0. `layout.ts` is the layout's source of truth; propose changes to it, never assume them.
- Open items to confirm with the owner when you reach them: the real north direction; reference images; the logo for the end card; the music; final names, prices and availability (all current values are sample content).
