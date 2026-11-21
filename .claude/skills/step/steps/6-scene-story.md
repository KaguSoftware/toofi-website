# Step 6: Scene and story

**Goal:** the compound live in the web scene and its own showcase: opening, scroll story, captions in English and Arabic, explore modes, homes panel, day and dusk. This is Zaitun's 7B and 7C, on the components step 0 made generic, so the work here is the compound's config, story and copy, not new engine code.

Standards: `SHOWCASE_PROMPT.md` PHASE 7 and CINEMATIC PRINCIPLES. `components/sawad/experience/README.md`. Numbers: `quality-bar.md` web section.

## Skills

`threejs-react-three-fiber`, `threejs-interaction`, `threejs-loaders`, `threejs-performance`, `gsap-scrolltrigger`, `gsap-react`, `gsap-timeline`, `theatre-js`, `threejs-animation`, `threejs-postprocessing`, `design-motion-principles`, `frontend-design`, `impeccable`, `web-design-guidelines`, `arabic-writing`, `vercel-react-best-practices`, `next-dev-loop`, `webapp-testing`. MCP: playwright, chrome-devtools.

## Work

1. **Scene.** The compound's site in its own setting (ground, water of its kind or none, surroundings to the horizon, ground cover, sky and haze), ground under every road and step, the fallback compound, markers on every home, vegetation and life from step 4, the four start views, the tour and the orbit limits. The first frame waits for the model and the plant and life libraries.
2. **Story.** The compound's config file in `components/sawad/experience/compounds/`: a 14 s opening per start view, five scroll stops from the brief's story, camera paths that pass the clearance, pan-rate and easing tests, the ambient circuit for visitors who don't scroll.
3. **Captions** in English and Arabic, with numbers from the data (`lib/sawad/i18n.ts` keys, editable inline like the rest of the site). Arabic written with `arabic-writing`, not translated word for word. Show the owner both before calling the step done.
4. **Explore:** orbit, walk with the touch joystick (walk bounds and water from the site), clickable homes with the panel, day and dusk.
5. **Sound:** an ambience that fits the site (water, wind, birds, life). Music only if the owner gives a track with its licence and credit.
6. **Stills** for no-3D, no-JS and reduced motion with `render-story-stills.mjs --compound <slug>`.
7. **Where it shows:** mount it where the owner chose in step 0; the compound's page, finder and links point at it; other compounds' pages unchanged.

## Owns

The compound's experience config, its caption keys, its stills, its scene tests, its page wiring.

## Done when

- The experience runs end to end in EN and AR on desktop and the phone profile; recordings or screenshots of every stop, both languages, day and dusk.
- Fps and draw calls measured at the opening and each stop against the bar.
- Zaitun's showcase unchanged (its frames and tests). `npm run check` passes.
- Review page published; row 6 set to "awaiting approval".
