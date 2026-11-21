# Quality bar

Every new compound must meet these numbers. They are what Zaitun Hills measured at acceptance (`docs/zaitun/QA.md`, `docs/zaitun/EXPORT.md`, the 7D notes in `docs/zaitun/STATUS.md`). Measure the same way Zaitun did: production build (`next build` + `next start`), Chrome through the chrome-devtools and Playwright MCP servers, Apple-silicon Mac at 120 Hz, quality level 2 unless stated.

A number that is missed means the step is not done. Raising a budget is the owner's call, with the options and their costs laid out (as 6B did), never the step's.

When the optimization plan (`docs/zaitun/OPTIMIZATION_PLAN.md`) lands its fixes and QA2 records better numbers, those replace the numbers here.

## Code

| Check | Bar |
|---|---|
| `npm run check` | passes; 0 lint errors and 0 warnings; coverage thresholds not lowered |
| Test gate | every new or changed source file has a test; `untested-baseline.json` not grown |
| Data matches model | every home in `lib/sawad/data.ts` has a modelled plot of the right type and every plot has a home (tests) |
| Placement | every building within 5 cm of its plot in the layout data (manifest test) |
| Zaitun | Zaitun's reference frames within 1/255 mean diff of step 0's capture; Zaitun's tests unchanged |

## Model and assets

| Check | Bar | Zaitun measured |
|---|---|---|
| Compound GLB, high / low | ≤ 10.5 / 5.2 MB | 10.26 / 4.97 MB |
| All models at first load, high / low | ≤ 12.0 / 5.8 MB | 11.73 / 5.61 MB |
| Page initial load, high tier | ≤ 15 MB | ~14.8 MB |
| Lightmap set per state (day, dusk), high / low | ≤ 1.0 / 0.35 MB | 0.94 / 0.31 MB |
| Textures | 2K max (1K low tier), KTX2 | same |
| Validation | glTF validator and `ktx validate` clean | clean |
| Detail level | both tiers carry the same features as Zaitun's: high has bevels, trims, lattices or screens, benches; low drops them | |
| Visual faults | no z-fighting, light leaks, stretched textures, floating objects, seams | none |

## Setting

| Check | Bar |
|---|---|
| Own setting | land, water, surroundings, plants, ground cover, sky, sun and sound all from the brief; nothing of Zaitun's setting appears unless the brief asks for it |
| Horizon | every wide shot shows the compound's own surroundings out to the horizon, with no edge of the world, no empty ground and no repeated tiles in view |
| Real place | the land matches the elevation data and the sun matches the coordinates, date and time |
| Water | each kind present looks as good as Zaitun's stream: reflections, sun glitter, movement, a believable edge |

## Light

| Check | Bar | Zaitun measured |
|---|---|---|
| Web day lightmap vs Cycles | median within 2% | 1.7% |
| States | day and dusk baked, dusk practicals at every modelled fitting | yes |
| Orientation | baked for the real north from the owner | yes |

## Web experience

| Check | Bar | Zaitun measured |
|---|---|---|
| Desktop fps | opening ≥ 65, tour stops ≥ 90 | 65–70, 91–120 |
| Draw calls at the opening (desktop level 2) | ≤ 350 | 313 |
| Triangles at the heaviest stop | ≤ 0.9M desktop, ≤ 150k phone tier | 0.89M, 150k |
| Phone emulation (low tier, 4× CPU) | ≥ 30 fps, worst frame ≤ 33 ms | 60–76 fps, 26 ms |
| Content load, phone profile (Fast 4G, 4× CPU, cold) | LCP ≤ 1.4 s, CLS 0 | 0.65–1.4 s, 0 |
| Poster-to-scene handover | mean diff at the cut ≤ 11.3/255, 2 s hold then a 3.5 s settle | 11.3/255 |
| Scroll sync | camera within a fraction of a second of the scroll; one caption at a time on fast scrolls | yes |
| Camera paths | tests for clearance, pan rate and easing on every path | yes |
| Lighthouse accessibility / best practices / SEO | 100 / 100 / 100 on every page that shows the compound, EN and AR | 100 / 100 / 100 |
| Bilingual | EN ltr and AR rtl end to end: captions, panels, numbers in Arabic-Indic digits, no Latin digits in the Arabic viewport | pass |
| Homes | real clicks fly to the home and open the panel with type, status, bedrooms, areas, outlook, handover, price, finder link; enquiry link when available | pass |
| Reduced motion | no canvas, no models fetched, stills with an "Explore in 3D" button | pass |
| Errors | 0 console errors | 0 |

## Film and stills (when the brief asks for a film)

| Check | Bar |
|---|---|
| Storyboard | approved before any final render |
| Posters | one per web start view at 1920 × 1080, framed and tone mapped as the web opening shots |
| Stills | 8–10 at 4K: aerial hero, eye level, details, dusk |
| Film | 60–90 s at 4K, plus a 15 s vertical cut; AgX, grade, grain, vignette; music with its credit |

## Still open on Zaitun too (not yet a bar)

Lighthouse performance above 80 on mobile, the live 3D under 5 s on 4G, 300k visible triangles in wide shots, real-phone fps. Measure them for every compound and report them next to Zaitun's; they become a bar once the optimization plan meets them.
