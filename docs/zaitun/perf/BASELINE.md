# Baseline (optimization track P0)

Taken 2026-11-21 with the rig in [scripts/perf/](../../../scripts/perf/README.md), before any optimization. Every later track measures the same way and compares with these numbers. The raw results (every run, every request, every frame) are in `scripts/perf/results/2026-11-21T18-31-03-all/` on the machine that took them (git-ignored); this page is the record.

| | |
|---|---|
| Build | `main` at 85b07fa (the rig's own files were the only uncommitted change, and they are not part of the build), production `next build`, Next 16.4.6 (Turbopack), local mode (sample data), served by `next start` |
| Machine | MacBook Pro, Apple M3 Pro (12 cores, 36 GB), macOS 26 (Darwin 25.6), on the charger, Low Power Mode off |
| Browser | Google Chrome 157, headless, real GPU (ANGLE on Metal), frame rate capped at 60 Hz |
| Lighthouse | 13.6.0, its own mobile and desktop configurations |
| Phone profile | QA's: 412 × 915 at 2.625×, 4× CPU slowdown, DevTools "Fast 4G" (9 Mbps, 165 ms), 4 GB / 6 cores reported, so the **low tier** |
| Desktop profile | 1440 × 900 at 2×, no throttling, 8 GB / 12 cores reported, so the **high tier** |

Rerun everything with `node scripts/perf/rig.mjs all` (about an hour; see the README for single reports).

## Against the finish line

The targets are section 1 of the [plan](../OPTIMIZATION_PLAN.md), still proposals until the owner confirms them.

| Measure | Before P0 (QA, 7D) | **Baseline** | Target | |
|---|---|---|---|---|
| Lighthouse performance, mobile, `/` and `/ar` | not measured | **62 and 58** (median of 5) | 80 or more | fails |
| Main-thread blocking while the 3D starts, phone profile | 2–3 s, variable | **0.68 s** (0.66–0.78 over 6 loads), longest task 0.27 s, 2 tasks over 200 ms. One earlier run had a single 3.0 s task on its first load (see the note under the trace) | under 0.3 s, no task over 200 ms | fails |
| First content on 4G, phone profile | 0.65 s | **0.53 s** | no worse | passes |
| Live scene on 4G, phone profile | about 9.6 s | **7.1 s** | 5 s | fails |
| Transfer before the live scene, desktop (high tier) | 8.65 MB | **10.83 MB** (all bytes, see below) | 5 MB | fails |
| Transfer before the live scene, phone (low tier) | 5.06 MB | **5.34 MB** | 3 MB | fails |
| Triangles the camera sees, widest shots | about 794k | **1.43–1.46 M** high tier, **0.47 M** low tier, plus **1.19 M** in the high tier's shadow pass | 300k | fails |
| Desktop frame rate, top level (3) | opening 65–70 fps, stops 91–120 (headed, 120 Hz) | **60 held at every camera** (the rig's cap); 2 of 2,389 frames over 20 ms, both in the first frames (worst 217 ms) | 60 held, no frame over 20 ms | fails on start-up frames only |
| Real mid-range Android phone | not measured | **not measured** (needs the owner's session) | 30 fps, no frame over 50 ms | open |
| Response to taps and clicks | not measured | **not measured** (the rig has no tap-response script yet; S8 adds one) | under 200 ms | open |
| Memory after five close/reopen cycles | not measured | JS heap **+2.8 MB** over five Home → Compounds → back cycles (about 0.7 MB each); GPU memory, contexts and DOM flat. Explorer open/close: +0.3 MB, flat GPU | no growth | small growth |
| The look | – | **22 reference frames** (11 cameras × 2 tiers); two captures of the same build differ by **0/255** | 2/255 or less per frame | the gate |
| Poster-to-scene handover | 11.3/255 (7D's own measure) | **13.2/255** high, **12.2/255** low (the rig's measure: poster drawn object-fit cover vs. the first frame) | no worse | baseline set |
| `npm run check` | passes (1,036 tests) | passes (1,104 tests) | passes, no threshold lowered | passes |

Why the transfer and triangle numbers are higher than the plan's "now" column: the rig counts every byte the browser fetched before the first frame (including 1.02 MB of JavaScript, 145 KB of fonts and the poster), and every triangle the camera's pass draws across vegetation, life and markers, not only the compound model. 7D's 794k came from a different count; the rig's method is the one later tracks compare with.

## Lighthouse

Median run of five, each in a fresh Chrome.

| Form | Page | Performance (all five) | FCP | LCP | TBT | CLS | Speed Index | Bytes | A11y / BP / SEO |
|---|---|---|---|---|---|---|---|---|---|
| mobile | `/` | **62** (62, 62, 62, 60, 61) | 1.54 s | 4.30 s | 1.04 s | 0 | 3.25 s | 5.35 MB | 100 / 100 / 85 |
| mobile | `/ar` | **58** (52, 54, 58, 61, 60) | 1.71 s | 4.68 s | 1.02 s | 0 | 3.95 s | 5.60 MB | 100 / 100 / 85 |
| mobile | `/compounds` | **100** | 1.54 s | 1.54 s | 11 ms | 0 | 1.72 s | 0.53 MB | 100 / 100 / 85 |
| mobile | `/residences` | **65** (63–66) | 0.90 s | 3.98 s | 21 ms | **0.676** | 0.90 s | 0.51 MB | 100 / 100 / 85 |
| mobile | `/contact` | **100** | 0.91 s | 0.91 s | 10 ms | 0 | 0.91 s | 0.48 MB | 100 / 100 / 83 |
| desktop | `/` | **92** | 0.37 s | 0.86 s | 204 ms | 0 | 1.12 s | 10.97 MB | 100 / 100 / 85 |
| desktop | `/ar` | **91** | 0.42 s | 1.30 s | 192 ms | 0 | 1.13 s | 11.22 MB | 100 / 100 / 85 |
| desktop | `/compounds` | **100** | 0.38 s | 0.38 s | 0 | 0 | 0.47 s | 0.53 MB | 100 / 100 / 85 |
| desktop | `/residences` | **70** (46, 70, 70, 70, 70) | 0.24 s | 0.83 s | 236 ms | **0.484** | 0.27 s | 10.26 MB | 100 / 100 / 85 |
| desktop | `/contact` | **100** | 0.24 s | 0.24 s | 0 | 0 | 0.24 s | 0.49 MB | 100 / 100 / 83 |

- Home's mobile score is held down by main-thread work (Lighthouse's JavaScript boot-up 2.9 s, main thread 3.8 s at its 4× CPU) and LCP 4.3 s; its top opportunity is unused JavaScript (about 1.1 s).
- **Residences** loses 30–35 points to layout shift (CLS 0.68 mobile, 0.48 desktop), and on desktop it loads 10.3 MB (the older scene viewport loads the high-tier model).
- SEO reads 85 (83 on Contact) only because the local server has no `NEXT_PUBLIC_SITE_URL`, so canonical and hreflang links stay relative; QA measured 100 with it set. Not a finding.

## Load trace (Home)

Each run is a fresh Chrome. "Cold" is its first load (empty HTTP cache, nothing compiled in the GPU process); "warm" is a second load in a new context of the same browser (empty HTTP cache, GPU program cache warm). Three runs each; medians.

| Profile | Shaders | TTFB | First content | Live scene | Blocking to live (range) | Longest task | Tasks > 200 ms | Bytes before live |
|---|---|---|---|---|---|---|---|---|
| phone (low tier) | cold | 165 ms | 532 ms | **7.10 s** | 684 ms (683–775) | 273 ms | 2 | **5.34 MB** |
| phone (low tier) | warm | 165 ms | 524 ms | 7.12 s | 698 ms (662–729) | 274 ms | 2 | 5.34 MB |
| desktop (high tier) | cold | 4 ms | 388 ms | **1.46 s** | 317 ms (315–330) | 277 ms | 1 | **10.83 MB** |
| desktop (high tier) | warm | 4 ms | 368 ms | 1.42 s | 276 ms (266–277) | 228 ms | 1 | 10.83 MB |

"Blocking" is the part of each long task beyond 50 ms, from first content until one second after the live scene.

**The 2–3 s stall QA saw** appeared once more and then not again. In the first baseline run (each profile's first load right after the build and server came up, three loads sharing one browser), the first load had a single task of **3.0 s (phone) and 4.3 s (desktop)**; the other four loads had 0.25–0.31 s. In the final run, twelve loads, each in a fresh browser, never showed it. So it is real, rare and not explained by the browser's own shader cache; it may be the operating system's GPU pipeline cache or a first-ever compile. S1 has to reproduce it and name it.

Bytes before the live scene, by type (median):

| Type | Phone (low) | Desktop (high) |
|---|---|---|
| Models (`.glb`) | 3.52 MB | 8.28 MB |
| JavaScript | 1.02 MB | 1.02 MB |
| Lightmap textures (`.ktx2`) | 253 KB | 788 KB |
| Texture decoder (`.wasm`) | 249 KB | 249 KB |
| Fonts | 145 KB | 145 KB |
| Images (poster) | 97 KB | 283 KB |
| CSS, document, data, other | 58 KB | 58 KB |
| **Total** | **5.34 MB** | **10.83 MB** |

The phone waterfall (cold run 1): the 3D code (two chunks, 336 and 231 KB gzip) arrives 1.26–2.03 s; the model request starts only at **2.55 s** and takes until **6.71 s** (`compound-zaitun-low.glb`, 3.10 MB gzip on the wire); the live scene follows at 7.1 s. The models and the wasm are served gzip; nothing is brotli.

## Frames

Each camera is a fresh load of Home and a frame-exact plan from the scene's first frame ([shots.mjs](../../../scripts/perf/shots.mjs)). Frame rate is capped at 60 by headless Chrome, so "60" means at least 60. JavaScript per frame is the whole requestAnimationFrame callback that drew the frame. The GPU timer is **relative only** (on ANGLE/Metal it reads above the frame interval at a steady 60 fps); compare it between runs on this machine, never with a budget.

### High tier at its best level (3), desktop profile

| Camera | fps | Frames > 20 ms | Worst frame | JS / frame | GPU timer | Draw calls (scene / all) | Triangles the camera sees | Shadow-pass triangles | Buffer |
|---|---|---|---|---|---|---|---|---|---|
| poster-hold | 60 | 2/109 | 217 ms | 3.1 ms | 32.2 | 273 / 374 | **1,446,635** | 1,190,113 | 2520 × 1456 |
| opening | 60 | 0/710 | 16.8 ms | 2.1 ms | 29.4 | 227 / 330 | **1,450,264** (max 1,473,900) | 1,198,884 | 2520 × 1456 |
| stop-1 entrance | 60 | 0/180 | 16.8 ms | 3.3 ms | 34.7 | 319 / 485 | **1,462,190** | 1,211,506 | 2520 × 1456 |
| stop-2 boulevard | 60 | 0/180 | 16.8 ms | 1.9 ms | 31.8 | 254 / 491 | **1,327,824** | 1,122,287 | 2520 × 1456 |
| stop-3 courtyard villa | 60 | 0/180 | 16.8 ms | 2.4 ms | 26.8 | 46 / 208 | 469,232 | 374,587 | 2520 × 1456 |
| stop-4 garden, amenities | 60 | 0/180 | 16.8 ms | 2.0 ms | 27.7 | 126 / 320 | 618,512 | 451,179 | 2520 × 1456 |
| stop-5 aerial (tour) | 60 | 0/180 | 16.8 ms | 1.6 ms | 30.7 | 216 / 311 | **1,207,974** | 988,129 | 2520 × 1456 |
| aerial (explorer) | 60 | 0/180 | 16.8 ms | 1.6 ms | 29.2 | 148 / 328 | **1,426,197** | 1,184,291 | 2520 × 1456 |
| orbit | 60 | 0/180 | 16.8 ms | 1.9 ms | 28.4 | 143 / 319 | **1,417,005** | 1,183,751 | 2520 × 1456 |
| walk | 60 | 0/130 | 16.8 ms | 2.3 ms | 30.6 | 103 / 304 | 688,210 | 503,165 | 2520 × 1456 |
| dusk (boulevard) | 60 | 0/180 | 16.8 ms | 3.0 ms | 23.7 | 253 / 297 | **1,327,754** | 0 (no shadows at dusk) | 2520 × 1456 |

### Low tier at its best level (1), phone profile (4× CPU)

| Camera | fps | Frames > 20 ms | Worst frame | JS / frame | GPU timer | Draw calls (scene / all) | Triangles the camera sees | Buffer |
|---|---|---|---|---|---|---|---|---|
| poster-hold | 60 | 2/109 | 250 ms | 3.7 ms | 3.9 | 106 / 125 | 378,443 | 515 × 1058 |
| opening | 60 | 0/710 | 16.8 ms | 3.5 ms | 4.4 | 107 / 126 | **466,244** (max 474,440) | 515 × 1058 |
| stop-1 | 60 | 0/180 | 16.8 ms | 3.5 ms | 4.4 | 145 / 164 | 412,706 | 515 × 1058 |
| stop-2 | 60 | 0/180 | 16.8 ms | 3.4 ms | 3.9 | 135 / 154 | 358,380 | 515 × 1058 |
| stop-3 | 60 | 0/180 | 16.8 ms | 2.2 ms | 2.9 | 30 / 49 | 149,517 | 515 × 1058 |
| stop-4 | 60 | 0/180 | 16.8 ms | 3.4 ms | 3.2 | 45 / 64 | 176,684 | 515 × 1058 |
| stop-5 | 60 | 0/180 | 16.8 ms | 4.2 ms | 3.4 | 58 / 77 | 208,224 | 515 × 1058 |
| aerial | 60 | 0/180 | 16.8 ms | 2.2 ms | 4.1 | 95 / 114 | 332,808 | 515 × 1058 |
| orbit | 60 | 0/180 | 16.8 ms | 2.7 ms | 3.6 | 82 / 101 | 290,694 | 515 × 1058 |
| walk | 60 | 0/130 | 16.8 ms | 2.2 ms | 2.9 | 35 / 54 | 171,628 | 515 × 1058 |
| dusk | 60 | 0/180 | 16.8 ms | 2.5 ms | 3.1 | 138 / 157 | 358,466 | 515 × 1058 |

### Per level (median over the eleven cameras)

Levels are read from what each run drew (render passes per frame: 20, 31 and 43 at high-tier levels 1–3; 18 and 20 at low-tier levels 0–1), not from React's state. "Adaptive" is the shipped behaviour: the monitor starts at the tier's start level and moves.

| Tier | Level | Drew at (runs) | Pixel ratio | Frames > 20 ms | Worst frame | JS / frame | GPU timer (relative) |
|---|---|---|---|---|---|---|---|
| high | adaptive | L3 × 9, L2 × 2 | 1.5 and 1.75 | 79 / 2,389 | 267 ms | 3.2 ms | 32.0 |
| high | 1 | L1 × 11 | 1.25 | 60 / 2,389 | 250 ms | 2.4 ms | 8.4 |
| high | 2 | L2 × 11 | 1.5 | 1 / 2,389 | 250 ms | 1.7 ms | 14.8 |
| high | 3 | L3 × 11 | 1.75 | 2 / 2,389 | 217 ms | 2.1 ms | 29.4 |
| low | adaptive | L1 × 10, L0 × 1 | 1 and 1.25 | 1 / 2,389 | 250 ms | 3.5 ms | 3.4 |
| low | 0 | L0 × 11 | 1 | 2 / 2,389 | 267 ms | 3.7 ms | 2.7 |
| low | 1 | L1 × 11 | 1.25 | 2 / 2,389 | 250 ms | 3.4 ms | 3.6 |

The GPU timer roughly doubles per high-tier level (8 → 15 → 29): the pixel ratio and the effect chain (ambient occlusion and depth of field at level 3) cost more than the geometry, which is the same at every level. Frames over 20 ms outside the first frames came from the walk and orbit cameras in some runs (high tier adaptive: walk 61/130, orbit 8/180; level 1: walk 48/130, orbit 11/180) and never at pinned levels 2 and 3, so they are not a level cost; S5 should repeat them and find the hitch.

- Every tier and level holds 60 at every camera on this Mac's GPU; JavaScript per frame stays at 1.3–4.2 ms even at 4× CPU. The budget pressure is triangles and GPU passes, and the start-up frames.
- **The first frames** after the scene appears include one frame of 217–267 ms at every level on both tiers (517 ms once, in a run discarded for a failed pin), most likely shader compiles and texture uploads on the first draw (finding P7).
- Draw calls of the scene pass reach 319 on the high tier; the rest of each frame (up to 491) is the shadow pass and the effect chain (20 passes at level 1, 31 at level 2, 43 at level 3).
- In adaptive runs the level's pixel ratio was sometimes not applied (level 3 drawing at 1.5×, low-tier level 1 at 1×): finding P2.

## Reference frames

`scripts/perf/reference/{high,low}/<camera>.png`, 22 frames (960 px wide on the high tier, 412 px on the low tier, 13 MB in all), taken at each tier's best level under virtual time. Two complete captures of the same build differed by **0.000/255 on every frame** (worst pixel 0), so any difference the gate reports is the change, not noise. The handover check draws the poster as the stage shows it (object-fit cover) and compares it with the scene's first frame: **13.2/255** high, **12.2/255** low.

## Bundles

Real files from the production build (gzip -9, brotli -11); package shares from Next's analyzer.

| Page | First-render JS gzip | brotli | raw | Files | CSS gzip |
|---|---|---|---|---|---|
| Public site, `/(site)/[[...slug]]` (Home, Compounds, Residences, Contact, story pages) | **379 KB** | 325 KB | 1.24 MB | 13 | 21.8 KB |
| Admin panel pages | 181–215 KB | 157–187 KB | 0.60–0.72 MB | 10–12 | 19.4 KB |
| Admin login | 146 KB | 127 KB | 497 KB | 9 | 15.9 KB |
| Not found, global error | 132 KB | 114 KB | 444 KB | 6 | – |

Loaded on demand (no page loads them at first render): **334 KB** gzip (1.20 MB raw: three.js 51%, React Three Fiber 9%, n8ao 9%, postprocessing 9%, app 7%, GSAP 6%, Theatre 5%) and **230 KB** gzip (532 KB raw), then 45 KB, 40 KB (polyfills) and small chunks.

The public route's first render is 76% Next and React by the analyzer's share, then zod 5%, the app 8%, and **the admin editor: prosemirror, tiptap and dnd-kit** (finding P3).

## Assets

`public/` holds 45.8 MB: GLB 22.9 MB, PNG 11.7 MB (lightmap sources), MP3 4.5 MB, JPEG 3.6 MB, KTX2 2.4 MB, wasm 0.5 MB.

| Model | File | gzip | brotli | Meshes | Triangles in file | Placed (instancing) | Geometry decoded | Textures |
|---|---|---|---|---|---|---|---|---|
| compound-zaitun-high.glb | **10.26 MB** | 7.14 MB | 6.79 MB | 21 | 222,941 | **1,184,159** | 11.81 MB | 3.94 MB |
| compound-zaitun-low.glb | **4.97 MB** | 3.10 MB | 2.88 MB | 16 | 124,423 | 417,865 | 6.87 MB | 1.25 MB |
| vegetation-high.glb | 1.23 MB | 1.07 MB | 1.05 MB | 20 | 16,224 | (placed in code) | 0.61 MB | 0.87 MB |
| vegetation-low.glb | 412 KB | 352 KB | 345 KB | 16 | 3,938 | (placed in code) | 0.16 MB | 0.29 MB |
| life-high.glb | 239 KB | 56 KB | **49 KB** | 21 | 18,351 | 19,179 | 0.37 MB | 2 KB |
| life-low.glb | 224 KB | 58 KB | **50 KB** | 21 | 12,245 | 12,713 | 0.30 MB | 2 KB |
| compound-high.glb (Bustan, Shatt) | 4.08 MB | 3.14 MB | 3.06 MB | 10 | 78,418 | 361,446 | 2.98 MB | 2.47 MB |
| compound-low.glb (Bustan, Shatt) | 1.48 MB | 1.03 MB | 0.99 MB | 6 | 33,662 | 122,170 | 1.30 MB | 0.75 MB |

Largest meshes of the high compound (geometry decoded): site 69,444 triangles (3.78 MB), apartment 22,534 × 6 copies (1.20 MB), garden 18,754 (0.98 MB), mosque 18,111, gym 17,058, villa-courtyard 16,366 × 16, villa-garden-4 10,674 × 30, villa-garden-3 9,140 × 15. Largest textures: atlas normal 706 KB (1024²), atlas base 655 KB (2048²), atlas ORM 416 KB (2048²), then per-template AO maps of about 220 KB each (1024²).

Other first-load files: day-buildings lightmap 723 KB high / 230 KB low (KTX2, already compressed), basis transcoder 527 KB (248 KB gzip, 204 KB brotli), the music 4.47 MB (streamed when sound is turned on), posters and story stills 1920 × 1080 JPEG at 0.2–0.32 MB each.

## Memory

Desktop profile, garbage collected before each reading. Next keeps Home mounted (hidden) after a client-side move to Compounds, so "closed" does not unmount the scene.

| Reading | JS heap | DOM nodes | Listeners | WebGL contexts | GPU memory (est.) | `render()` calls/s on the other page |
|---|---|---|---|---|---|---|
| Home open (1st) | 21.5 MB | 731 | 420 | 1 | 654 MB | |
| On Compounds (1st) | 20.6 MB | 1,372 | 457 | 1 | 215 MB | **60** |
| On Compounds (5th) | 23.4 MB | 1,372 | 458 | 1 | 215 MB | **60** |
| Home open (6th) | 28.4 MB | 1,375 | 462 | 1 | 396 MB | |
| Explorer closed (1st → 5th) | 28.4 → 28.7 MB | 1,375 | 462 | 1 | 396 MB | |

- Heap +2.8 MB over five route cycles (about 0.7 MB each), contexts and DOM flat; explorer cycles flat. S5 to find what holds the 0.7 MB.
- The hidden scene keeps rendering **60 times a second** on the other page (finding P1).
- The GPU estimate (from the WebGL allocation calls) is 654 MB at level 3 with the full effect chain and 396 MB once the monitor has moved; treat it as relative.

## Not measured here (owner)

- **A real mid-range Android phone**, on 4G in Iraq if possible: frame rate, worst frame, live-scene time, and whether the stall appears. Every phone number above uses this Mac's GPU.
- **Tap response** (finder, explore controls): no script yet; S8 adds it to the rig.
- **The host**: compression and caching depend on it (S6, F5).
