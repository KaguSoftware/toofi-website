# Findings ledger

Merged and ranked by track T on 2026-11-22 from the nine search files ([S1](findings/S1.md), [S2](findings/S2.md), [S3](findings/S3.md), [S4](findings/S4.md), [S5](findings/S5.md), [S6](findings/S6.md), [S7](findings/S7.md), [S8](findings/S8.md), [S9](findings/S9.md)), the rows P0 seeded (K1–K8, P1–P8) and what [F2A](F2A.md) changed. Every number comes from the rig ([scripts/perf/](../../../scripts/perf/README.md)) unless a row says otherwise; the baseline is [BASELINE.md](BASELINE.md). The search files keep the full evidence and the method; this file is the list the fix tracks work from.

**Status: approved by the owner on 2026-11-22**, with no row struck and all 18 decisions answered (section 2). A fix track takes only the rows that name it, in the order of its queue (section 4). Section 11 lists what is still open.

## 1. Where the targets stand

"Now" is after F2A, which is approved and merged. "With the list" adds up what the rows below measured one at a time, with the owner's answers applied, so it is a sum of parts, not a measurement; RS measures it. The targets are held on the rig's standard load, where the system already has the shaders compiled (D2).

| Measure (plan, section 1) | Target | Now | With the list | Outcome |
|---|---|---|---|---|
| Lighthouse performance, mobile, `/` and `/ar` | 80 | 62 and 58 | About 77 from the stall rows alone (S1's estimate), then T2 (all of the unused JavaScript), T5 (the poster's priority) and the font rows | Likely, to be measured in F1 |
| Main-thread stall, phone profile | under 0.3 s, no task over 200 ms | 0.66–0.68 s, longest task 0.27 s | About 0.3 s, longest about 146 ms (T13, T25, T34, T35) | Met |
| First content on 4G, phone profile | no worse than 0.53 s | 0.53 s | unchanged | Met |
| Live scene on 4G, phone profile | 5 s | 5.34 s (5.43 s in S6's runs) | 5.18 s with T1, measured on `next start`; less with T2's 201 KB gone (not timed). About 1.2 s more if Vercel sends the models uncompressed (T57) | Close; depends on T57 |
| Transfer before the live scene, desktop | 5 MB | 6.11 MB | About 4.4 MB: T2 −0.20, T38 −0.56, T36 −0.49 (estimate), T8 −0.23, T28 −0.10, T24 −0.08, T43 −0.08 | Met on paper, with one estimate in it; depends on T57 |
| Transfer before the live scene, phone | 3 MB | 3.60 MB | About 3.0 MB: T2 −0.20, T16 −0.14 (brotli on scripts and the decoder, estimate), T28 −0.10, T24 −0.08, T8 −0.07, T43 −0.03. About 4.5 MB if Vercel sends the models uncompressed | On the line; depends on T57 |
| Triangles the camera sees | 300k, phone tier only (D3) | 0.29–0.47 M low tier (1.43–1.46 M high tier, no longer a target) | No row closes the last 0.17 M on the phone tier (T52, deferred) | Not met on the phone tier's widest shots |
| Desktop frame rate, top level | 60 held, no frame over 20 ms | 60 held; a level-3 frame is 13.3–14.5 ms; one 217–267 ms frame at start; a 33 ms frame on each level change | Level 3 about 11 ms at the tour stops and 9 ms in the explorer, occlusion kept (T10, T26, T9, T47). The long start frame moves behind the poster (T13); level changes compile ahead (T31) | Met |
| Real mid-range Android phone | 30 fps, no frame over 50 ms | not measured | T18, T11, T12 are aimed at it; T44 and T45 wait for it | Open: the session is postponed (D18) |
| Response to taps and clicks | under 200 ms | 32–48 ms (S8) | no work needed | Met |
| Memory after five open and close cycles | no growth | JS heap levels off (no leak). +46 MB of array buffers after the first return to Home; 215–244 MB of GPU memory held while Home is hidden | T14, T3 | Met after those two |
| The look | 2/255 or less per frame, except what the owner approved (D14) | 22 reference frames | Approved changes: softer shadow edges (D5), the vegetation atlas (D6), the pixel budget on large screens (D7), fonts (D11), the finder's model (D12). New reference frames are taken after each | The gate (see rig note R1) |
| Poster-to-scene handover | no worse | 13.17 high, 12.19 low | no row changes it | Met |
| `npm run check` | passes | passes | each fix track runs it | Met |

**Tracked, not a gate (D2): the first-ever visit**, when the device compiles the scene's shaders once.

| Measure | Line to hold | Now | With the list |
|---|---|---|---|
| Live scene, phone profile | 7.5 s | about 9.4 s (estimate: S1's 4.1 s of shader links on top of 5.34 s) | about 7 s with T13 |
| Longest main-thread task | 1 s | 4.19 s | 0.76 s (measured what-if), until the first uses are spread over frames |

Three things the search changed about the plan:

- **The 2–3 s stall is named and it is larger than the baseline shows.** It is the first-ever link of the scene's shaders, on the main thread (T13). The baseline's 0.68 s is the case where the system already has them. A first-time visitor waits 4.1–4.2 s on the phone profile.
- **Since F2A, the largest asset finding no longer shortens the wait for the scene.** The first frame waits for the far set, so removing the unused occlusion maps (T6) now saves bytes after the scene is live, not before. What stands between 3.60 MB and 3 MB on the phone is JavaScript, fonts, stills and compression.
- **Triangles are not what limits the frame on desktop, and the model cannot be simplified by a tool.** The 300k target now holds for the phone tier only (D3).

## 2. The owner's decisions

Answered on 2026-11-22 on the review page. "Differs" marks an answer other than the recommendation.

| # | Decision | Answer | What follows |
|---|---|---|---|
| D1 | Where the site is hosted | **Vercel** | T16 closes for scripts, JSON and the decoder (the CDN serves them brotli); T41 closes (the platform shares the cache); T43 becomes one line in `next.config.ts` and moves to F5; T32's lifetimes are set with `headers()` there. **New: T57**, the models may go out uncompressed |
| D2 | Which load the 5 s and the stall targets are measured on | **The standard load; the first visit is tracked** | "Under 5 s" stays the live scene, so F2B stays ahead of F3. First-ever visit: live scene 7.5 s, no task over 1 s. Revisit after a real phone |
| D3 | The 300k triangle target | **Phone tier only** | T52 is deferred: lower-detail buildings are authored only if a real phone shows it limited by vertex work |
| D4 | Ambient occlusion at the top level | **Keep it at the top level only** (differs: the recommendation was to drop it) | T24: stays at level 3, its code loads on demand. T10 and T47 are now unconditional. Level 3 stays about twice level 2, so T27 has to re-space the steps with occlusion in |
| D5 | Shadow map at 2048² with a fitted box | **Accept** | T26 |
| D6 | Vegetation atlas at half size | **Take it now** (differs: the recommendation was to hold it in reserve) | T38: −0.56 MB before the live scene on desktop. New reference frames for the high tier afterwards |
| D7 | A pixel budget on large monitors | **Accept** | T39, set to what a 2560 × 1440 window draws at each level |
| D8 | Visitors the device check refuses | **Offer the 3D tour, with its download size** | T37: 3g links and every refused visitor get the offer; only 2g and Save-Data are refused outright |
| D9 | A real 404 for unknown addresses | **Yes** | T40 |
| D10 | Weak GPUs in the desktop tier | **All of it now** (differs: the recommendation was to wait for a real laptop for the last two parts) | T51: weak GPU names to the low tier (F1); a level 0 for the high tier and a fall back to the stills (F3). The thresholds start from an estimate, since no such laptop was measured |
| D11 | Fonts | **Fix both** | T28 (F1), T29 (F6). The owner looks at the Arabic pages before approving F6 |
| D12 | The finder stays on the far set | **Accept, and show the finder's views** | T30: the views go in F2B's review |
| D13 | Music as AAC at 96 kbps | **Accept after listening once** | T54: F4 encodes it; it ships after the owner has heard it |
| D14 | May the look change at all? | **Nothing over 2/255, except what was approved here** | The approved exceptions are D5, D6, D7, D11 and D12 |
| D15 | F3 starts its geometry-independent rows in wave 4 | **Yes** | Rows T9, T10, T11, T18, T25, T34, T35, as F3's first part in the plan |
| D16 | A short rig pass before the fix wave | **Yes** | R1–R4 of section 8, as P0 reopened, before wave 4 measures anything |
| D17 | Is the admin panel in scope? | **No** | Closed |
| D18 | The real-phone session | **Not yet: continue on the rig** | T44, T45 and T52 stay deferred. Every phone number remains this Mac's GPU until the session happens |

## 3. The ranked list

Ranked by gain over effort and risk: **score = gain ÷ (effort + risk)**.

- **Gain**, 1 to 5. 5: closes half or more of what is missing on a section 1 target, or saves seconds for every first-time visitor. 4: a quarter to a half, or removes something every visitor can see go wrong. 3: a tenth to a quarter, or a clear gain for a class of devices. 2: under a tenth, or a gain this Mac cannot time (a phone's GPU). 1: housekeeping.
- **Effort**: 1 small, 2 medium, 3 large.
- **Risk**: 0 none. 1: passes the look gate but wants the owner's glance, is gated with a known hazard, or depends on the host. 2: changes the look or the behaviour, so the owner decides.

Ties go to the larger gain. "Look" is the risk to the picture. T-numbers are this ledger's IDs from now on; the Source column gives the search rows they merge. The order is the one the owner reviewed; where an answer changed a row, its text and status say so, and its number stays. T57 was added after the hosting answer.

| ID | Source | Finding and evidence | Fix | Gain against | Look | Effort | Score | Fix track | Status |
|---|---|---|---|---|---|---|---|---|---|
| T1 | S6-1 (P6, S1-7) | **The model is requested 2.6 s into the load.** Phone profile: the far model request starts at 2.62 s, after the 3D code has arrived and run. With a preload hint for the tier's far model and the texture decoder, tried from outside: live scene 5.43 → 5.18 s. | A small inline script in the head picks the tier the way `capability.ts` does and adds `<link rel=preload as=fetch crossorigin>` for that tier's far model and the decoder. Addresses come from the table in `compoundModel.ts`, so F2B's new names flow through. | Live scene on the phone: −0.25 s of the 0.34 s still missing | none | small | 5 ÷ (1 + 0) = 5.00 | F1 | approved |
| T2 | S2-1 (P3, S1-10) | **The admin editor ships to every public page.** One 165 KB gzip chunk (tiptap, ProseMirror, dnd-kit) is named in the HTML of `/`, `/ar` and `/compounds`. With the fix tried: first-render JavaScript 370 → 169 KB gzip (−201 KB, −54%); the 66 editor tests pass. | `components/editable/lazy.tsx` wraps each editor island and `EditorRoot` in `next/dynamic`; `client.ts` re-exports from it (the 39-line patch is in `scripts/perf/S2/`). Check edit mode in a browser, which the search did not. | Phone transfer: −0.20 MB of the 0.60 MB missing. Lighthouse: this is all of its 1.06 s of unused JavaScript | none | small | 4 ÷ (1 + 0) = 4.00 | F1 | approved |
| T3 | S5-1 (P1) | **The hidden Home scene keeps drawing on every other page.** After a move from Home to Compounds: 60 `render()` calls a second, 215–244 MB of GPU memory held, in all six cycles. Next hides the route in React Activity; React Three Fiber's loop runs outside React, so no prop change reaches it. | A layout effect in `ZaitunExperience.tsx` whose cleanup pauses the scene through the experience API (`setFrameloop("never")` from inside the canvas, in `ExperienceRoot.tsx`) and whose setup resumes it. | Battery and heat on every page after Home; memory | none | small | 4 ÷ (1 + 0) = 4.00 | F1 | approved |
| T4 | S8-1 (P5) | **Residences: the footer jumps when the finder mounts.** Layout shift 0.71 on the phone and 0.51 on desktop, from one move of `footer.site-footer`: the Suspense fallback holds only the title. | Give the fallback in `templates/residences.tsx` the finder's height (a stage and panel skeleton). | Layout shift to about 0; Residences' Lighthouse score 65 → about 95 | none | small | 4 ÷ (1 + 0) = 4.00 | F6 | approved |
| T5 | S1-8, S3-5 | **The poster, Home's largest paint, is fetched at low priority.** The request goes out at priority Low, behind the fonts. Next 16 deprecated `priority`; Lighthouse fails its LCP discovery check on it. LCP 4.30 s against first content 1.54 s. | `fetchPriority="high"` on the poster image (`ZaitunExperience.tsx:310`). | Lighthouse (LCP is a quarter of the score); not measured, needs the change | none | small | 3 ÷ (1 + 0) = 3.00 | F1 | approved |
| T6 | S3-1 | **The full model ships 15 occlusion maps that the baked light switches off.** `bakedLight.ts:193` sets their strength to 0. Removed everywhere except the two court lattices: full file 7.14 → 4.41 MB on the wire (high), 3.10 → 2.04 MB (low); 0.0% of pixels moved on all 22 frames. | Drop `occlusionTexture` and `TEXCOORD_1` in `export-final.sh` for Zaitun, except `-lattice` materials. Rebuild the far set afterwards. Bustan and Shatt keep theirs. | Since F2A the first frame no longer waits for this file, so the gain is after the scene is live: −2.73 MB (high) and −1.06 MB (low) per visit, 15 textures less GPU memory, and Residences on desktop | none measured (≤ 0.34/255) | small | 3 ÷ (1 + 0) = 3.00 | F2B | approved |
| T7 | S5-2 | **After a round trip the sound is off but its button says on.** Sound on → Compounds → back: the audio context is closed, the music rewound to 0:00, the button still reads "Turn the sound off". | On hide call the sound's `stop()` (it keeps the position) instead of `dispose()`, and resume on return if it was on. Same layout effect as S5-1. | A visible bug; no target | none | small | 3 ÷ (1 + 0) = 3.00 | F1 | approved |
| T8 | S3-6 | **Story stills download on the live path, where they are never shown.** One still on the phone (72 KB) and two on desktop (230 KB) are fetched before the model request. | Skip the still images (or hide them with `display: none`) once the state is `story`; keep them for stills, reduced motion and no JavaScript. | Transfer before the live scene: −72 KB phone, −230 KB desktop | none | small | 3 ÷ (1 + 0) = 3.00 | F1 | approved |
| T9 | S4-4 | **Depth of field runs its 11 passes with the blur at zero.** The whole explorer and the last tour stop: 2.2 ms of a 14.2 ms frame (16%), and about 70 MB of render targets. | Leave the effect out of the chain while `rig.blur` is 0 (`PostFX.tsx`). | Desktop frame at levels 2 and 3: −2.2 ms where visitors spend open-ended time | none expected, confirm on the reference frames | small | 3 ÷ (1 + 0) = 3.00 | F3 | approved |
| T10 | S4-1 | **The occlusion pass redraws the scene twice a frame, and the shadow map with it.** Three shadow passes and three scene passes per level-3 frame: 1.5–1.7 ms (10–13%) by day and 56 MB. Not drawing the extra two moves the picture by 0.00–0.07/255. | Set `autoDetectTransparency = false` on the n8ao pass. | Desktop frame at level 3: −1.5 to −1.7 ms | none (≤ 0.07/255) | small | 3 ÷ (1 + 0) = 3.00 | F3 | approved |
| T11 | S5-5 | **Every plant re-sort uploads every plant buffer in full.** 4.07 MB (high) and 1.47 MB (low) per re-sort, up to 200 MB a second while dragging; the top JavaScript cost whenever the camera moves, and 21–64 MB a second of garbage. | Upload only the range that is drawn (`addUpdateRange`), copy with an index loop instead of `subarray`, `Math.sqrt` instead of `Math.hypot` (`vegetation.ts`). | Phone frame time and GPU bandwidth; most of the garbage in moving shots | none | small | 3 ÷ (1 + 0) = 3.00 | F3 | approved |
| T12 | S9-1 | **A phone held sideways gets the desktop tier.** `width < 768` is the only phone test. A Pixel 7 in landscape is 915 px wide and takes the 10 MB model, the 4096² shadow map and levels 1–3. From device specifications, to confirm on the real phone. | Judge by the screen's short side or a coarse pointer (`capability.ts`). | The phone targets hold in either orientation | none | small | 3 ÷ (1 + 0) = 3.00 | F1 | approved |
| T13 | S1-1 (K1, P7, S4-13) | **Every shader program is linked inside the first frame, on the main thread.** This is the 2–3 s stall. First-frame task: 0.3 s when the system has the shaders cached, 4.1–4.2 s on a first-ever visit (phone profile; 6.7–6.9 s on desktop). Compiling ahead, tried from outside: longest task 4.19 → 0.76 s, live scene 2.2 s sooner. | While the poster is still up, compile the scene and each effect pass with `renderer.compileAsync`, then spread the first uses over a few hidden warm-up frames (`ExperienceRoot.tsx`). The helper must take any pass list, because F3 changes the chain later. | Stall: first-frame task to about 100 ms cached. First-ever visits: 3.4 s less blocking and the scene 2.2 s sooner (3.8 s on desktop). Lighthouse blocking time | none | medium | 5 ÷ (2 + 0) = 2.50 | F1 | approved |
| T14 | S5-13 | **Returning to Home rebuilds the whole scene and shows the site without its buildings.** On every return the model, plants, people, lightmaps and decoder are fetched and decoded again; the compound is missing for about 0.7 s on desktop (seconds on a phone). Array-buffer memory 53.8 → 100.1 MB after the first return, then flat. | Keep loaded assets alive across a hide: a cache per tier and variant in `useTimedAsset.ts` / `useCompoundModel.ts`, released on a real unmount. | No empty site on return; memory −46 MB (all of the growth the target forbids) | better | medium | 5 ÷ (2 + 0) = 2.50 | F2B | approved |
| T15 | S5-3, S9-4 | **The quality monitor steps every fast device down after 11 s and then stops for good.** drei counts a window above the upper bound as a flip even at the top level; the fourth sets its fallback, which the code maps to a step down. Measured: level 3 → 2 at 10.7–16 s in every adaptive run; with the CPU slowed 12× later, 35.9 fps for 50 s and the level never moved. | Own the loop in `ExperienceRoot.tsx`: count a flip only when the level really changed, hold on fallback, keep sampling with a cooldown after a failed level. Land it together with S5-9, or level 3 keeps level 2's pixel ratio. | Capable desktops keep their best look; long sessions and hot devices get a step down | better on fast devices | small | 4 ÷ (1 + 1) = 2.00 | F1 | approved |
| T16 | S6-3 (P4) | **Models, decoder and scripts are served gzip at best.** Brotli on the same files: phone bytes before the live scene 3.60 → 3.39 MB, live scene −0.16 s. | Nothing for `.js`, `.json` and `.wasm`: Vercel's CDN serves them brotli. `.glb` is not on Vercel's documented list: see T57. | Phone transfer: about −0.14 MB of S6's −0.21 MB comes without work (estimate); the rest is the models | none | small | 4 ÷ (1 + 1) = 2.00 | F5 | closed: D1: Vercel compresses scripts, JSON and the decoder with brotli by itself; the models are T57 |
| T17 | S5-9 (P2) | **The start level's pixel ratio is re-applied on every re-render.** The Canvas gets a fixed `dpr` and React Three Fiber re-applies it over the level's own. Pinning level 1 left the buffer at 1.5× instead of 1.25×. | Pass the current level's ratio to the Canvas (`ExperienceCanvas.tsx`). Needed by S5-3. | The step down works on weak devices; level 3 gets its 1.75× | none | small | 2 ÷ (1 + 0) = 2.00 | F4 | approved |
| T18 | S4-7 | **Draw order shades 2.2–2.7 screens of opaque pixels to show one.** Sky first, land second, buildings last, on both tiers. With sky, land and water last: 1.2–1.6 screens, picture identical (0.00–0.01/255). Worth 0–1.0 ms on this Mac, which discards hidden pixels by itself; most Android GPUs do not. | Three `renderOrder` values (`SceneWorld.tsx`, `world.ts`). | Phone frame rate (to be timed on the real phone); desktop up to 6% | none (identical) | small | 2 ÷ (1 + 0) = 2.00 | F3 | approved |
| T19 | S9-3 | **A software renderer passes the 3D check.** Chrome gives a WebGL2 context on SwiftShader, also with `failIfMajorPerformanceCaveat`. Virtual machines and remote desktops start the scene. | Read the renderer string in the same probe and refuse software rasterizers (pattern tested in `scripts/perf/S9/software-gl.mjs`). | No minutes-long stall for those visitors | none | small | 2 ÷ (1 + 0) = 2.00 | F1 | approved |
| T20 | S5-10 | **A lost GPU context ends the 3D for the rest of the visit.** The loss is handled cleanly (stills come back, memory freed), but it is reported as an error and there is no way back in. Phones drop contexts of background tabs often. | Report it as a warning and offer the "Load 3D" button once the tab is visible again. | Robustness on phones; cleaner error reports | none | small | 2 ÷ (1 + 0) = 2.00 | F1 | approved |
| T21 | S8-3 | **The finder poster is fetched 3840 px wide on desktop.** `sizes="100vw"` for a stage about 60% of the width: 535 KB, and it is that page's largest paint. | A `sizes` value that matches the layout (`SceneViewport.tsx:130`). | Desktop Residences: about −200 KB (estimate) | none | small | 2 ÷ (1 + 0) = 2.00 | F6 | approved |
| T22 | S5-6 | **People and cars make garbage on every frame, in view or not.** `samplePath` copies each route's point list and re-measures it per walker per frame: 4.8–5.3 MB a second, the steadiest allocation in every held shot. | Cache each route's closed list and lengths once; write poses into reused objects (`landscape.ts`, `lifeMotion.ts`, `SceneLife.tsx`). | Fewer collector pauses on phones | none | small | 2 ÷ (1 + 0) = 2.00 | F4 | approved |
| T23 | S5-8 | **three recomposes every static object's matrix every frame.** `updateMatrixWorld` is the second-largest JavaScript cost in every profile: 0.25–0.37 ms a frame at 4× CPU. | `matrixAutoUpdate = false` on the model (F2B, `compoundModel.ts`) and on the plants and the world (F3). | About 0.3 ms a frame on the phone profile | none | small | 2 ÷ (1 + 0) = 2.00 | F2B and F3, each in its own files | approved |
| T24 | S4-5 (S2-2, S4-10) | **Ambient occlusion is the largest single cost of the top level and adds little.** 5.1 ms of a 13.4–14.5 ms frame (35–38%). The baked lightmap already holds the occlusion; the pass moves the picture by 1.0–1.6/255 (2.12 raw at tour stop 1, over the gate). Its library is 81 KB gzip that every device downloads and phones never use. | Keep it at level 3 only. Remove its two wasted redraws (S4-1) and the extra copy (S4-10), and load its code on demand in `PostFX.tsx`, so phones never download it (S2-2). | Transfer before the live scene: −81 KB on every device, since the code loads only when level 3 is reached. The frame gains are its two companion rows, about −2 ms together | unchanged: the owner keeps it | small | 5 ÷ (1 + 2) = 1.67 | F3 | approved: D4: kept at the top level only |
| T25 | S1-3 | **The sky reflection map is generated at start-up.** 57 ms of the mount task cached; on a first-ever visit its four programs link on the spot and the mount task grows from about 300 to 592 ms. | Ship the prefiltered map as a file made at build time (the sky is fixed), or make it after the first frame. | Stall: −57 ms cached, about −290 ms on a first-ever visit | gated: reflections on glass, brass and pools | small | 3 ÷ (1 + 1) = 1.50 | F3 | approved |
| T26 | S4-2 (K6) | **The shadow map is 4096², 128 MB, and its size is its cost.** At 2048²: −1.1 to −1.3 ms (9%) and −96 MB. Picture 0.00–0.10/255 at five cameras, 0.69/255 at tour stop 1 where long shadow edges soften. The map covers 660 × 660 m for a site of 860 × 326 m. | 2048² with the frustum fitted to the plan and turned to the sun, which gives about today's texel size inside the walls (`world.ts`). | Desktop frame: −1.1 to −1.3 ms; GPU memory −96 MB | ≤ 0.69/255, accepted by the owner (D5) | small | 3 ÷ (1 + 1) = 1.50 | F3 | approved |
| T27 | S4-6, S9-5 | **The step from level 2 to level 3 doubles the frame.** Level 1: 3.4–4.7 ms, level 2: 6.5–7.5, level 3: 13.4–14.5. A desktop that holds level 2 at 12 ms is moved up, lands near 25 ms and is moved back. Level 3 holds only on GPUs within about 1.3× of this Mac's. | Even out the steps in `quality.ts` once D4 is settled (the pixel ratio and occlusion as separate steps, or no occlusion), and remember the best level that held. | No flip-flop on desktops between an M1 and an M3 Pro; each flip drops a frame | per level | small | 3 ÷ (1 + 1) = 1.50 | F3 | approved |
| T28 | S1-9 (English) | **English Home downloads a 100 KB Arabic display font for one word.** Amiri 700 at the highest priority, for the name band in `templates/home.tsx`. | Draw the word as a small SVG, or set it in a font already loaded. | Transfer before the live scene: −100 KB on the English page, and less competing with the poster | typography: owner's glance | small | 3 ÷ (1 + 1) = 1.50 | F1 | approved: D11: the owner looks at the Arabic pages before approving F6 |
| T29 | S1-9 (Arabic), S8-4 | **Arabic pages load 8–10 font files, 267–396 KB, none preloaded.** English pages load 44 KB. Lighthouse mobile `/ar` scores 58 against 62 for `/`. Plex Arabic 300 and 700 are declared and never requested. | In `app/layout.tsx`: preload the two files the hero uses, drop the weights no page uses, check which Amiri weight the headings need. | Lighthouse on `/ar`; −100 to −210 KB on Arabic pages | typography: owner's glance at the Arabic pages | small | 3 ÷ (1 + 1) = 1.50 | F6 | approved: D11: the owner looks at the Arabic pages before approving F6 |
| T30 | S8-2 | **The finder fetches the whole 10 MB model for a stage card.** Desktop Residences transfers 12.7 MB: far set 2.43 MB, then the full file 7.15 MB. | The finder's scene (`SceneRoot.tsx`) asks for the far set only; the full file waits for a close view. Look gate on the finder's views. | Desktop Residences: −7.1 MB (−56%) | the finder's close views show far-view textures: owner's glance | small | 3 ÷ (1 + 1) = 1.50 | F2B | approved: D12: show the finder's views in F2B's review |
| T31 | S1-2, S5-4 | **Each quality level change drops a frame, and the first one compiles its shaders blocking.** A 33 ms frame on every level change. On a first-ever visit the step 2.5 s into the opening is one task of 311 ms (phone) or 862 ms (desktop). | Compile the next level's effect chain ahead with S1-1's helper before switching, and keep render targets at the tier's largest size. | No frame over 20 ms (desktop) or 50 ms (phone) during the opening | none | medium | 3 ÷ (2 + 0) = 1.50 | F3 | approved |
| T32 | S6-2 (K8) | **Nothing under `public/sawad/` is cached past a revalidation.** A repeat visit on the phone profile makes 24 conditional round trips before the scene can start. With long lifetimes: 2 round trips, live scene 1.77 → 1.49 s. | F2B puts a content hash in every file name; then F5 sets `Cache-Control: public, max-age=31536000, immutable` for `/sawad/**` through `headers()` in `next.config.ts` (Vercel's default is `max-age=0, must-revalidate`). Not before the names change. | Repeat visits: −0.28 s (−16%) and 22 requests fewer | none | medium | 3 ÷ (2 + 0) = 1.50 | F2B, then F5 | approved |
| T33 | S1-6 | **Evaluating the 3D code is one 146 ms task.** 143–150 ms on the phone profile, and it delays the model request. | Split what the first frame does not need (the effect chain, the tour camera library) into a chunk evaluated afterwards. Do it after D4, which may remove 81 KB by itself. | Stall: about −100 ms of blocking | none | medium | 3 ÷ (2 + 0) = 1.50 | F1 | approved |
| T34 | S1-4 | **The ground mesh is built in code on every visit.** 154 ms of the 357 ms canvas-mount task on the phone profile. | Write positions, colours and normals to a binary at build time and load it (`planWorld.ts`, `SceneWorld.tsx`). `layout.ts` stays untouched. | Stall: the mount task falls to about 200 ms, and with S1-3 to about 146 ms (no task over 200 ms) | none if the data is identical: gated | medium | 4 ÷ (2 + 1) = 1.33 | F3 | approved |
| T35 | S1-5 | **The position of every plant is worked out on every visit.** 146 ms of a 190 ms task when the plant library arrives (phone profile). | One binary of instance transforms per tier, written at build time by the same `planLandscape`, loaded by `vegetation.ts`. | Stall: the task falls from 190 to about 45 ms | none if the data is identical: gated | medium | 4 ÷ (2 + 1) = 1.33 | F3 | approved |
| T36 | K5 | **The high tier's day lightmap (0.72 MB) is in the first load.** Halving it for good fails the gate (S3: 2.27/255 at stop 1), so the saving has to be a swap: the low tier's page (0.23 MB) for the poster hold, the full page after it, like the far set. | Reuse F2A's swap for the lightmap page. Gate on the poster, the opening and the aerial. | Desktop transfer before the live scene: about −0.49 MB of the 1.11 MB missing (estimate, not measured) | gated | medium | 4 ÷ (2 + 1) = 1.33 | F2B | approved |
| T37 | S9-11, S9-6 | **An ordinary 4G link with a long round trip is refused the 3D, with no way to ask for it.** Measured: 5 Mbps at 300 ms is reported as `3g` and gets the stills only. Save-Data, under 4 GB and under 4 threads are refused too, with no button; reduced-motion visitors do get a "Load 3D" offer. | Let `3g` through with the offer (the download size in its label); refuse outright only `2g` and Save-Data without it. Reuse the offer for every refused case. | The 3D reaches visitors on typical cellular links in Iraq | behaviour: approved by the owner (D8) | small | 4 ÷ (1 + 2) = 1.33 | F1 | approved |
| T38 | S3-4 | **The vegetation atlas at half size saves half the plant file but moves leaf edges.** −0.56 MB on the high tier, before the live scene. It passes the gate, yet 1–2.7% of pixels move: frond and leaf edges, the groves' texture. | Export the high tier's vegetation atlas at 1024² (`ktx2-mip.mjs` produced the tested file). | Desktop transfer before the live scene: −0.56 MB of the 1.11 MB missing | leaf and frond edges move: accepted by the owner (D6) | small | 4 ÷ (1 + 2) = 1.33 | F2B | approved |
| T39 | S9-7 | **Only the pixel ratio is capped, not the pixel count.** A 4K monitor at 100% draws 8 megapixels: 3.5× a laptop's cost at level 2, and 30 fps at level 3. | A pixel budget per level in `quality.ts`, set to what a 2560 × 1440 window draws at that level. | Steady frame rate on large monitors | softer than native on 4K screens: accepted by the owner (D7) | small | 3 ÷ (1 + 2) = 1.00 | F3 | approved |
| T40 | S7-1, S7-2 | **An unknown address answers 200, not 404, when the site runs on Supabase.** `notFound()` fires after streaming has started; the response is uncached, and every distinct junk address is one database call. | Look the page up before the Suspense and answer 404 there, keeping draft previews working for editors; cap the slug length. | Search engines stop indexing missing pages; the database is protected from scans | none | medium | 3 ÷ (2 + 1) = 1.00 | F6 | approved |
| T41 | S7-3 | **Publishing may not reach other servers or a CDN in front.** Cache entries live in each server's memory, and pages carry a 30-day `s-maxage`. Read from code; not reproducible on one machine. | On Vercel the platform handles it. Elsewhere: a shared cache handler and a purge, or a short `s-maxage`. | Published changes show up everywhere | none | medium | 3 ÷ (2 + 1) = 1.00 | F5, F6 | closed: D1: on Vercel the platform shares the cache and purges on publish. Check once after the first deploy |
| T42 | S3-2, S3-3 | **The high tier's normal, colour and roughness textures can go one size lower.** −0.50 MB and −0.74 MB; 0.00–0.07/255 at the reference cameras, also at 1440 px. Walking right up to a wall in the explorer is not covered. | Export the high tier's atlas one mip lower. F2B adds one close-up camera to the gate first. | After the scene is live: −1.2 MB per desktop visit; GPU memory | gated, plus a close-up check | small | 2 ÷ (1 + 1) = 1.00 | F2B | approved |
| T43 | S3-7, S7-4 | **Posters and stills are re-encoded on demand, as WebP.** The first request per width pays 24–120 ms of encoding; AVIF would be 25–30% smaller. | On Vercel: `images.formats: ['image/avif', 'image/webp']` in `next.config.ts`. The CDN keeps the encodes, so no pre-encoded files are needed. | −25 KB phone, −80 KB desktop before the live scene; no cold encode on the poster | encoder change: owner's glance | small | 2 ÷ (1 + 1) = 1.00 | F5 | approved |
| T44 | S4-8 | **Light shafts cover the screen up to 1.8 times with blended pixels.** 1.64–1.77 screens at tour stop 3, on at the phone tier's level 1. 0.2 ms on this Mac. | Shorter, narrower quads; off on the low tier if the phone shows the cost. | Phone frame rate (cannot be timed here) | gated | small | 2 ÷ (1 + 1) = 1.00 | F3 | deferred: after the real-phone session |
| T45 | S4-9 | **Bloom is 16 passes on phones, the last four under 20 px wide.** 16 of the low tier's 18–20 passes a frame. | Five blur levels instead of eight on the low tier. | Phone frame rate (cannot be timed here) | gated | small | 2 ÷ (1 + 1) = 1.00 | F3 | deferred: after the real-phone session |
| T46 | S6-5, S7-5 | **`proxy.ts` runs on models, textures, the decoder and the music.** 30 public files, 11 requests on a Home load; 0.3 ms each locally, a session check each when deployed on Supabase. | Exclude `sawad/` and those file types in the matcher, and write `\\.` in the pattern. | On Vercel each matched request runs the proxy before the file is served, so this now saves an invocation per asset, 11 on a Home load | none | small | 1 ÷ (1 + 0) = 1.00 | F5 | approved |
| T47 | S4-10 | **Level 3 ends with an extra full-screen copy.** 0.4 ms and one more full-size pass. | Order the chain so the last pass draws to the screen. | Desktop frame at level 3: −0.4 ms | none | small | 1 ÷ (1 + 0) = 1.00 | F3 | approved |
| T48 | S4-12 | **Baked surfaces look the sun's shadow up twice.** 0.5 ms at tour stop 1, 0–0.1 ms elsewhere. | Reuse the value three already computed (`bakedLight.ts`). | Desktop frame: up to −0.5 ms | none if reused | small | 1 ÷ (1 + 0) = 1.00 | F2B | approved |
| T49 | S3-9 | **11.6 MB of lightmap PNG masters deploy with the site and are never fetched.** 12 files in `public/sawad/lightmaps/zaitun/`. | Move them out of `public/`. | Deploy size only | none | small | 1 ÷ (1 + 0) = 1.00 | F2B | approved |
| T50 | S7-6, S7-7 | **Edit mode and the first visit after a publish chain their database round trips.** About four sequential round trips per editor page view; two in a row for the first visitor after a publish. Counted from the code. | Start the reads that do not depend on each other together. | Editors, and one visitor per publish | none | small | 1 ÷ (1 + 0) = 1.00 | F6 | approved |
| T51 | S9-2 | **Threads and memory say nothing about the GPU, so weak laptops get the high tier.** A 4-core Intel UHD laptop reports 8 threads and 8 GB and starts at level 2. Estimate, not measured: level 1 would take 30–55 ms there. The high tier cannot go below level 1. | All three parts now. F1: send known weak GPU names to the low tier (`capability.ts`). F3: a level 0 for the high tier with shadows off, and a fall back to the stills when frames stay under about 20 fps at the floor (`quality.ts`). No laptop of that class has been measured, so the thresholds start from S9's estimate and are named constants. | Playable on mainstream laptops | what weak laptops see: approved by the owner (D10) | medium | 3 ÷ (2 + 2) = 0.75 | F1, then F3 | approved: D10: all of it now, sized from an estimate |
| T52 | K3, K4 (S3-10) | **No distance levels: 1.43–1.46 M triangles in the high tier's wide shots against a target of 300k.** F2A found the model cannot be simplified by a tool without smearing windows (it is faceted, every quad has its own UVs). S4 found triangles are under a tenth of this GPU's frame: hiding every building saves 0.5–1.4 ms. The phone tier is at 0.29–0.47 M. | If the real phone shows it is limited by vertex work: lower-detail templates authored in `build_compound.py`, switched per copy by distance. Not by simplifying the shipped meshes. | The triangle target; phone frame rate if the phone is vertex-bound | gated | large | 3 ÷ (3 + 1) = 0.75 | F2B | deferred: D3: the target holds for the phone tier only; build this only if a real phone shows it limited by vertex work |
| T53 | S4-3 (K6) | **The shadow map is redrawn every frame although buildings and plants do not move.** Not redrawing saves 2.4–2.5 ms, about 1.3 ms once S4-2 is in. A plain freeze fails the look (2.55/255), because the casters are culled to the camera's view. | Draw it once from a caster set that does not depend on the view; a small second map or blobs for people and cars. Crosses three tracks' files. | Desktop frame: about −1.3 ms after S4-2 | gated; the simple version fails | large | 3 ÷ (3 + 1) = 0.75 | F3, with F2B and F4 | deferred: only if RS finds level 3 still short |
| T54 | S3-8 | **The music is a 4.47 MB MP3.** Fetched only once sound is on. AAC at 96 kbps: 3.74 MB and plays everywhere. | Re-encode from the WAV master; the address is in `audio.ts`. | −0.73 MB per listener | listening test | small | 1 ÷ (1 + 1) = 0.50 | F4 | approved: D13: the owner listens once before it ships |
| T55 | S1-10 (rest), S2-5 | **One shared chunk for every template, and both languages' dictionaries on every page.** A 32 KB chunk holds the experience shell, the finder, the contact form and the sound engine; the dictionaries are about 8 KB. | Split by template; pass one locale's strings from the server. | A few KB of first-render JavaScript | none | medium | 1 ÷ (2 + 0) = 0.50 | F1, F6 | deferred: measure again in RS, after S2-1 |
| T56 | S2-3 | **Theatre.js evaluates one fixed camera path at run time.** 31 KB gzip for cubic Hermite segments. | About 40 lines in `storySheet.ts`; the camera must come out the same, and the Studio retiming workflow changes. | Transfer before the live scene: −31 KB | the path must be identical | medium | 1 ÷ (2 + 1) = 0.33 | F1 | deferred: only if the phone transfer still misses after the rest |
| T57 | new, from D1 | **On Vercel the models may go out uncompressed.** Vercel compresses only the content types on its list. The list has `application/wasm`, JavaScript and JSON, and no `model/` type (docs: vercel.com/docs/how-vercel-cdn-works/compression; the page says the list is not exhaustive). Every number so far comes from `next start`, which gzips `.glb`: the low far set is 2.69 MB as a file and 1.36 MB on the wire. | First check one deployed file: `curl -sI -H 'Accept-Encoding: br, gzip' <preview>/sawad/models/compound-zaitun-far-low.glb` and look for `content-encoding`. If there is none: ship the models pre-compressed and unpack them in the browser (`DecompressionStream`, in the loader's worker) before parsing, in `compoundModel.ts`. | If uncompressed, the phone would transfer about 1.5 MB more before the live scene (4.5 MB against a target of 3) and the scene would come about 1.2 s later. Estimates from file sizes | none | small | 5 ÷ (1 + 1) = 2.50 | F5 to check, F2B if a fix is needed | approved: check on a Vercel preview before F2B fixes its file layout |

## 4. Each fix track's queue

In rank order. A track works down its queue. Deferred rows wait for the condition they name.

### F1: Main thread and bundles (17 rows)

1. T1 The model is requested 2.6 s into the load
2. T2 The admin editor ships to every public page
3. T3 The hidden Home scene keeps drawing on every other page
4. T5 The poster, Home's largest paint, is fetched at low priority
5. T7 After a round trip the sound is off but its button says on
6. T8 Story stills download on the live path, where they are never shown
7. T12 A phone held sideways gets the desktop tier
8. T13 Every shader program is linked inside the first frame, on the main thread
9. T15 The quality monitor steps every fast device down after 11 s and then stops for good
10. T19 A software renderer passes the 3D check
11. T20 A lost GPU context ends the 3D for the rest of the visit
12. T28 English Home downloads a 100 KB Arabic display font for one word *(approved: D11: the owner looks at the Arabic pages before approving F6)*
13. T33 Evaluating the 3D code is one 146 ms task
14. T37 An ordinary 4G link with a long round trip is refused the 3D, with no way to ask for it
15. T51 Threads and memory say nothing about the GPU, so weak laptops get the high tier *(approved: D10: all of it now, sized from an estimate)*
16. T55 One shared chunk for every template, and both languages' dictionaries on every page *(deferred: measure again in RS, after S2-1)*
17. T56 Theatre.js evaluates one fixed camera path at run time *(deferred: only if the phone transfer still misses after the rest)*

### F2B: Detail streaming and asset diet (13 rows)

1. T6 The full model ships 15 occlusion maps that the baked light switches off
2. T14 Returning to Home rebuilds the whole scene and shows the site without its buildings
3. T23 three recomposes every static object's matrix every frame
4. T30 The finder fetches the whole 10 MB model for a stage card *(approved: D12: show the finder's views in F2B's review)*
5. T32 Nothing under `public/sawad/` is cached past a revalidation
6. T36 The high tier's day lightmap (0.72 MB) is in the first load
7. T38 The vegetation atlas at half size saves half the plant file but moves leaf edges
8. T42 The high tier's normal, colour and roughness textures can go one size lower
9. T48 Baked surfaces look the sun's shadow up twice
10. T49 11.6 MB of lightmap PNG masters deploy with the site and are never fetched
11. T52 No distance levels: 1.43–1.46 M triangles in the high tier's wide shots against a target of 300k *(deferred: D3: the target holds for the phone tier only; build this only if a real phone shows it limited by vertex work)*
12. T53 The shadow map is redrawn every frame although buildings and plants do not move *(deferred: only if RS finds level 3 still short)*
13. T57 On Vercel the models may go out uncompressed *(approved: check on a Vercel preview before F2B fixes its file layout)*

### F4: Work per frame and memory (4 rows)

1. T17 The start level's pixel ratio is re-applied on every re-render
2. T22 People and cars make garbage on every frame, in view or not
3. T53 The shadow map is redrawn every frame although buildings and plants do not move *(deferred: only if RS finds level 3 still short)*
4. T54 The music is a 4.47 MB MP3 *(approved: D13: the owner listens once before it ships)*

### F6: Server, data and the rest of the site (7 rows)

1. T4 Residences: the footer jumps when the finder mounts
2. T21 The finder poster is fetched 3840 px wide on desktop
3. T29 Arabic pages load 8–10 font files, 267–396 KB, none preloaded *(approved: D11: the owner looks at the Arabic pages before approving F6)*
4. T40 An unknown address answers 200, not 404, when the site runs on Supabase
5. T41 Publishing may not reach other servers or a CDN in front *(closed: D1: on Vercel the platform shares the cache and purges on publish. Check once after the first deploy)*
6. T50 Edit mode and the first visit after a publish chain their database round trips
7. T55 One shared chunk for every template, and both languages' dictionaries on every page *(deferred: measure again in RS, after S2-1)*

### F3: Drawing each frame (18 rows)

1. T9 Depth of field runs its 11 passes with the blur at zero
2. T10 The occlusion pass redraws the scene twice a frame, and the shadow map with it
3. T11 Every plant re-sort uploads every plant buffer in full
4. T18 Draw order shades 2.2–2.7 screens of opaque pixels to show one
5. T23 three recomposes every static object's matrix every frame
6. T24 Ambient occlusion is the largest single cost of the top level and adds little *(approved: D4: kept at the top level only)*
7. T25 The sky reflection map is generated at start-up
8. T26 The shadow map is 4096², 128 MB, and its size is its cost
9. T27 The step from level 2 to level 3 doubles the frame
10. T31 Each quality level change drops a frame, and the first one compiles its shaders blocking
11. T34 The ground mesh is built in code on every visit
12. T35 The position of every plant is worked out on every visit
13. T39 Only the pixel ratio is capped, not the pixel count
14. T44 Light shafts cover the screen up to 1.8 times with blended pixels *(deferred: after the real-phone session)*
15. T45 Bloom is 16 passes on phones, the last four under 20 px wide *(deferred: after the real-phone session)*
16. T47 Level 3 ends with an extra full-screen copy
17. T51 Threads and memory say nothing about the GPU, so weak laptops get the high tier *(approved: D10: all of it now, sized from an estimate)*
18. T53 The shadow map is redrawn every frame although buildings and plants do not move *(deferred: only if RS finds level 3 still short)*

### F5: Delivery (6 rows)

1. T16 Models, decoder and scripts are served gzip at best *(closed: D1: Vercel compresses scripts, JSON and the decoder with brotli by itself; the models are T57)*
2. T32 Nothing under `public/sawad/` is cached past a revalidation
3. T41 Publishing may not reach other servers or a CDN in front *(closed: D1: on Vercel the platform shares the cache and purges on publish. Check once after the first deploy)*
4. T43 Posters and stills are re-encoded on demand, as WebP
5. T46 `proxy.ts` runs on models, textures, the decoder and the music
6. T57 On Vercel the models may go out uncompressed *(approved: check on a Vercel preview before F2B fixes its file layout)*

RS takes what the search could not explain or finish: the two long frames in one scroll sweep with under 4 ms of JavaScript in them (S5-12), which material three re-checks every frame (S5-7, after T11 and T22), and the deferred rows above.

## 5. Files no track owned, and hand-offs

The plan's track table leaves these files unowned. Each goes to the track whose row needs it; no other track edits it.

| File | Goes to | For |
|---|---|---|
| `components/editable/**` | F1 | T2 |
| `components/sawad/scene/capability.ts` | F1 | T1, T12, T19, T37, T51 |
| `components/sawad/experience/types.ts` | F1 | T3 (the pause in the experience API) |
| `scene/useTimedAsset.ts`, `scene/useCompoundModel.ts`, `scene/SceneRoot.tsx` | F2B | T14, T30 |
| `scene/planWorld.ts` | F3 | T34 |
| `scene/landscape.ts`, `scene/lifeMotion.ts` | F4 | T22 |
| `public/sawad/audio/**` | F4 (from F6) | T54: the file's address is in F4's `audio.ts` |
| `scene/layout.ts` | nobody | Only track 0 changes it. T34 and T35 build their data ahead instead of adding an index to it |
| `scripts/perf/**` (the rig's own files) | the rig pass (P0 reopened, D16) | R1–R4 now; R5–R9 as it sees fit |

Where a row crosses tracks:

| Rows | Hand-off |
|---|---|
| T13 | The plan lists "compile shaders before the first frame" under F3. It goes to F1, which owns `ExperienceRoot.tsx` where the first frame is drawn, so the largest row does not wait for wave 5. If it needs the frame-loop prop in `ExperienceCanvas.tsx`, that edit is F4's |
| T13 → T31 | F1's compile-ahead helper takes any list of passes. F3 calls it before each level change, after it has changed the chain |
| T15 + T17 | F1's monitor and F4's pixel ratio are merged together. With only the first, level 3 runs at level 2's ratio |
| T15 → T27 | F1 fixes the monitor's logic now; F3 re-spaces the levels after D4. F3 owns the thresholds in `quality.ts` |
| T6, T42 | Any change to the full model is followed by `scripts/blender/export-far.sh`, or the in-place swap fails its structure check |
| T32 | F2B puts content hashes in the names; F5 sets the long lifetimes only after that is merged. F3's new data files (T34, T35, T25) follow the same naming |
| T1 | F1 reads the addresses from the table in `compoundModel.ts`, so F2B's renaming needs no second edit |
| T23 | Two separate edits: the model in F2B's `compoundModel.ts`, the plants and the world in F3's files |
| T24 | Occlusion stays at level 3 (D4). F3 moves its code out of the first 3D chunk, so F1 splits the chunk (T33) after that, or leaves n8ao to F3 and splits the rest |
| T51 | F1 does the GPU names in `capability.ts`; F3 adds the high tier's level 0 and the fall back to stills in `quality.ts`. F1's monitor (T15) must be able to step to that floor |
| T57 | F5 owns the check on a Vercel preview, but it is wave 5. Whoever has a preview first runs the one command; if a fix is needed it lands in F2B's `compoundModel.ts` |
| T53 | Needs a view-independent caster list from `instanceCulling.ts` (F2B) and a shadow for people and cars (`SceneLife.tsx`, F4). Deferred for that reason |

## 6. Not recommended

Measured, with a gain too small for what they put at risk. Left as they are unless the owner asks.

| Candidate | Measured | Why it stays |
|---|---|---|
| Replace GSAP's scroll driver (S2-4) | −16 KB gzip | The scroll feel the owner tuned in 7D would have to be rebuilt for under 0.6% of the phone target |
| Day lightmap at half size for good (S3-L1) | −0.45 MB | Fails the gate at tour stop 1 (2.27/255); baked shading smears across façades. T36 uses it only during the poster hold |
| Shadow map at 1024² | 0.3 ms more than 2048² | Twice the look change |
| Sky light on surfaces off | 0.3–0.5 ms | The picture gets 0.5–1.3/255 darker |
| Streaming the local-mode media route (S7-8) | read from code | Only matters if local mode is the production backend |

## 7. Ruled out ("no gain")

Measured as no gain, so nobody repeats them. The search file has the numbers.

| Candidate | Result | Track |
|---|---|---|
| Hydration as the cause of the stall (QA's first diagnosis) | No task over 77 ms before the 3D code arrives | S1 |
| The browser's own shader cache as the explanation | A fresh browser still reads the system's cache; only shaders the system has never seen are slow | S1 |
| Turning off three's shader error check | The wait moves to the next call: 127 ms against 141 ms | S1 |
| Model parsing and geometry decoding in a worker | 25 ms on the main thread at 4× CPU | S1 |
| Texture and buffer uploads as the cause of the first frame | 10–12 ms and 5–10 ms | S1, S4 |
| Server-rendering the experience shell | The shared chunk costs 31 ms of script at 4× CPU | S1 |
| The scroll driver's cost at start-up | 37 ms of script at 4× CPU | S1 |
| `await import()` of the editor inside server components | 379.0 → 379.0 KB; only a client wrapper with `next/dynamic` moves it | S2 |
| Polyfills, duplicate packages, unused parts of three, drei, postprocessing | A `nomodule` script browsers skip; one version of everything; every part used | S2 |
| Lossless geometry cleanup | 91–98% of triangles kept at 0.2–5 cm: UV and colour seams pin the vertices | S3 |
| Simplifying the buildings for the far set | Under the 2/255 mean yet windows smear on sight; with seams kept nothing is removed | F2A |
| Re-encoding the posters and stills | Already WebP at screen sizes through `next/image` | S3 |
| meshopt on the life models (P4's guess) | Already on; 49 KB brotli in all | S3 |
| Fewer triangles for desktop frame rate | Hiding every building saves 0.5–1.4 ms (4–9%) | S4 |
| The sky, water and plant shaders; people and cars on the GPU | 0.0–0.5 ms each | S4 |
| SMAA | 0.4–0.7 ms, and it is the only antialiasing | S4 |
| A plain freeze of the shadow map | Fails the look, 2.55/255 (the fix that works is T53) | S4 |
| React re-renders driven by frame or scroll state | None per frame | S5 |
| The walk's key handlers on other pages; the explorer leaking on close | Clean; heap growth is compiled code and levels off | S5 |
| Per-copy building culling; the tour driver; birds; GSAP's ticker | Each ≤ 0.13–0.6 ms a frame at 4× CPU | S5 |
| A leak in the JS heap over route cycles (P8) | 1.24 of 1.83 MB is V8 code; flat by the sixth cycle | S5 |
| Preloading every file instead of the first model and the decoder | 5.16 s against 5.18 s | S6 |
| Brotli for KTX2 and JPEG | Already compressed | S6 |
| The music file at load | Not fetched until used; range requests work | S6 |
| Time to first byte, database calls per page, `instrumentation.ts` | 1–3 ms; 0 calls at run time; no cost | S7 |
| `proxy.ts` per request for anonymous visitors | No network call, under the measurement noise | S6, S7 |
| Tap response in the finder | 32–48 ms median at 4× CPU | S8 |
| Compounds, Contact, the story pages; switching Bustan and Shatt; the admin panel | No main-thread work worth a fix; shared model; no long task | S8 |
| `failIfMajorPerformanceCaveat` as the software-rendering test | Chrome returns a SwiftShader context regardless | S9 |
| Re-deciding the tier on resize; the Battery Status API; background tabs | The model is fixed at mount; Chromium only; already handled | S9 |

## 8. The rig

Faults and gaps the search tracks found in the rig. R1–R4 affect how every fix is judged.

| # | Note | Found by |
|---|---|---|
| R1 | **The stored reference frames carry up to 1.04/255 of film-grain noise** against a fresh capture of the same build, because the level is pinned after a 100 ms real-time wait. Pinned on fixed frames, captures repeat at 0.000/255. Until fixed, compare with 4 × 4 block averages (`scripts/perf/S3/compare.mjs --block 4`) and against a capture from the same run | S3, S4 |
| R2 | **Frame times paced at 60 Hz mislead.** The GPU clocks down between frames; the same frame reads 17–18 ms paced and 14–15 ms drawn back to back. Use back-to-back frames and a before-and-after pair in one page load (`scripts/perf/S4/probe.js`) | S4 |
| R3 | **The load trace's "cold" label is a cached load.** A fresh browser still reads the system's shader cache. The first-ever visit is `scripts/perf/S1/startup.mjs --modes gl+salt` | S1 |
| R4 | **The rig fails in a worktree without its own `node_modules`** (`rig.mjs:73`). Install in the worktree first | S1, S3, S4 |
| R5 | The measurement lock is not first come, first served: a session that chains rig scripts keeps the others waiting | S1 |
| R6 | `frames.mjs` keeps the network throttling on low-tier runs although the README says it drops it | S4 |
| R7 | The admin script needs `AUTH_SECRET`; there is no Supabase-mode build (S7 made its own) | S7, S8 |
| R8 | No viewport option on `frames.mjs`; the phone profile reports 6 threads where real phones report 8 | S9 |
| R9 | The rig's browser keeps its cache in memory, so a second desktop visit downloads the 7 MB model again whatever the headers say (S6-6). Check on a real browser profile | S6 |

## 9. What only the real phone can answer

The session is postponed (D18). When it happens, on a mid-range Android phone:

1. Load Home twice and note the pause before the scene appears each time (the first-ever shader compile, and what the phone keeps for the second visit).
2. Frame rate and the worst frame at the opening, the five tour stops and while walking, at the phone tier's two levels (sizes T18, T44, T45, T11).
3. Hold the phone sideways and load again (T12).
4. On mobile data: what the browser reports as the connection type, and whether the 3D is offered (T37).
5. Visit twice and look at the second visit's network panel: are the large files served from cache (R9)?
6. Ten minutes in the explorer: does the frame rate fall as the phone warms (T15)?

## 10. The seeded rows, closed

| Seed | Outcome |
|---|---|
| K1, P7 (the stall, the long first frame) | Named: T13. The mount and plant tasks are T25, T34, T35 |
| K2 (whole model before the first frame) | Done by F2A: live scene 7.10 → 5.34 s on the phone profile |
| K3, K4 (detail levels, triangles) | T52, decision D3 |
| K5 (day lightmap in the first load) | T36: as a swap after the poster hold. It cannot be halved for good |
| K6 (shadow map) | Corrected by S4: up to three passes a frame (T10), its size is the cost (T26), and drawing it on demand is medium effort with a look hazard (T53) |
| K7 (the opening is the slowest desktop moment) | Not so: every camera is 13.3–14.5 ms at level 3. The weight is level 3's chain (T24) |
| K8, P6 (decoder on every cold visit, the model waits for the 3D code) | T1, T32 |
| P1 (the scene draws on other pages) | T3, cause found |
| P2 (pixel ratio undone by a re-render) | T17 |
| P3 (admin editor on public pages) | T2, fix tried |
| P4 (gzip at best) | T16. Its guess about the life models was wrong: they are already meshopt |
| P5 (Residences shifts) | T4, T30, T21 |
| P8 (heap grows per route cycle) | No leak in the JS heap. The 46 MB of array buffers is T14 |

## 11. What the answers still need

**T57 first.** One command on a Vercel preview decides whether the transfer targets are in reach as planned: `curl -sI -H 'Accept-Encoding: br, gzip' <preview>/sawad/models/compound-zaitun-far-low.glb`. With a `content-encoding` line, nothing changes. Without one, F2B ships the models pre-compressed and unpacks them in the browser, and that belongs in its file layout from the start.

**The plan file.** [OPTIMIZATION_PLAN.md](../OPTIMIZATION_PLAN.md) carries these answers since 2026-11-22, on the owner's word: the amended targets (section 1), the file assignments and F3's two-part prerequisites (section 3), shader compiling moved to F1 (section 6), the rig pass as P0 reopened and F3's first part in wave 4 (session order), and the answered owner decisions (section 8).

**Thresholds without a device (D10, D18).** The low-tier rows aimed at phones (T18, T11, T12) and the weak-laptop floor (T51) ship without a time from the hardware they are for. Each keeps its thresholds as named constants, so the first real measurement can change a number, not the code.
