# Zaitun Hills and the Sawad site: optimization plan

Written 2026-11-20, after tracks 7D and QA. It covers the whole site, not only the 3D hero. Amended 2026-11-22 with the owner's answers at triage (track T): the amended targets, file ownership, F3's early start and the rig pass. The ranked work list is [perf/FINDINGS.md](perf/FINDINGS.md).

The plan has four stages. **Measure** builds one repeatable rig. **Search** audits every layer and logs each finding with a number. **Fix** works through the ranked list in parallel tracks. **Lock** repeats the search once, then turns the results into budgets that fail the build. The work is finished when every target below is met and no remaining finding is worth more than 5% on any of them.

Start a track in a new Claude Code session by saying **`masterplan phase <id>`**, for example `masterplan phase P0` or `masterplan phase S4`. Progress and approvals are kept in [STATUS.md](STATUS.md), in the optimization table. Starting numbers come from [QA.md](QA.md) and STATUS.md.

## 1. Finish line

The owner amended the targets on 2026-11-22 (decisions D2 and D3 of the ledger); the other lines stand as proposed. "Now" is the state before any optimization; current numbers are in section 1 of [perf/FINDINGS.md](perf/FINDINGS.md).

The stall and the live scene are measured on the rig's **standard load**, where the system already has the scene's shaders compiled. A **first-ever visit**, when the device compiles them once, is tracked beside them and is not a gate: live scene 7.5 s, no task over 1 s. Revisit both after a real phone has been measured.

| Measure | Now | Target |
|---|---|---|
| Lighthouse performance, mobile, `/` and `/ar` | not measured, likely under 80 | 80 or more on an official run |
| Main-thread stall while the 3D starts, phone profile (4× CPU), standard load | 2–3 s, variable | under 0.3 s, no task over 200 ms |
| First content on 4G, phone profile | 0.65 s | no worse |
| Live scene on 4G, phone profile, standard load (this is what "loads under 5 s" means) | about 9.6 s | 5 s |
| Transfer before the live scene, desktop high tier | 8.65 MB | 5 MB |
| Transfer before the live scene, phone tier | 5.06 MB | 3 MB |
| Visible triangles, every tour stop and the aerial, phone tier only (no target on the high tier) | about 794k in wide shots | 300k |
| Desktop frame rate, top quality level | opening 65–70 fps, stops 91–120 | 60 held, no frame over 20 ms |
| Real mid-range Android phone | not measured | 30 fps or more, no frame over 50 ms |
| Response to taps and clicks (finder, explore controls) | not measured | under 200 ms |
| Memory after five open and close cycles of the scene | not measured | no growth |
| The look | reference frames from P0 | mean difference of 2/255 or less per frame, except the changes the owner approved at triage (ledger D5, D6, D7, D11, D12); new reference frames are taken after each |
| Poster-to-scene handover | 11.3/255 | no worse |
| `npm run check` | passes (1,036 tests) | passes, no threshold lowered |

## 2. Rules for every track

- **Measure before and after, on the P0 rig.** A change with no number is not a finding and not a fix.
- **One measurement at a time on this machine.** The rig takes a lock (`~/.cache/sawad-perf/rig.lock`) while it times anything, so parallel sessions queue instead of slowing each other's numbers. Never time anything outside the rig.
- **One change per measurement.** Two changes measured together count as one, and both are reverted if the look breaks.
- **The look is a gate.** Every fix reruns the reference frames. A difference over 2/255 goes to the owner with both frames side by side.
- **Search tracks change no product code.** They may add scripts under `scripts/perf/<id>/` and write their findings file, nothing else.
- **Keep what the audit rules out.** A candidate that measures as no gain is logged as "no gain" so nobody repeats it.
- **Findings files live in the main checkout.** Each search track writes `docs/zaitun/perf/findings/<id>.md` there by absolute path, even from a worktree, like STATUS.md.
- **Each wave starts from a committed main.** A worktree is cut from the last commit, so approved work must be committed and merged before the next wave (the owner asks for it; no track commits on its own).
- **Repo rules apply** ([CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md)): a test beside every changed source file, `reportError`, no bypassing the pre-commit hook.

## 3. Tracks

| ID | Track | Stage | Needs approved first | Owns (only this track edits these) |
|---|---|---|---|---|
| **P0** | Measurement rig and baseline | Measure | nothing (main committed) | new `scripts/perf/**`, `docs/zaitun/perf/BASELINE.md`, `docs/zaitun/perf/FINDINGS.md` (seed) |
| **S1** | Search: page load and 3D start-up on the main thread | Search | P0 | `docs/zaitun/perf/findings/S1.md`, `scripts/perf/S1/` |
| **S2** | Search: JavaScript bundles | Search | P0 | `findings/S2.md`, `scripts/perf/S2/` |
| **S3** | Search: 3D assets and media | Search | P0 | `findings/S3.md`, `scripts/perf/S3/` |
| **S4** | Search: drawing each frame (GPU) | Search | P0 | `findings/S4.md`, `scripts/perf/S4/` |
| **S5** | Search: work per frame and memory | Search | P0 | `findings/S5.md`, `scripts/perf/S5/` |
| **S6** | Search: delivery | Search | P0 | `findings/S6.md`, `scripts/perf/S6/` |
| **S7** | Search: server and data | Search | P0 | `findings/S7.md`, `scripts/perf/S7/` |
| **S8** | Search: the rest of the site | Search | P0 | `findings/S8.md`, `scripts/perf/S8/` |
| **S9** | Search: device tiers and gating | Search | P0 | `findings/S9.md`, `scripts/perf/S9/` |
| **F2A** | Far set: the whole site at far-view detail before the first frame | Fix | P0 | `scripts/blender/**`, `public/sawad/models/**`, `components/sawad/scene/compoundModel.ts` (+ tests) |
| **T** | Triage: merge and rank the findings, review page | Search | S1–S9 | `docs/zaitun/perf/FINDINGS.md` |
| **F1** | Main thread and bundles | Fix | T | `components/sawad/experience/ZaitunExperience.tsx`, `ExperienceRoot.tsx`, `StoryScroll.tsx`, `ExperienceHud.tsx`, `storySheet.ts`, `story.ts`, `types.ts`, `components/sawad/scene/capability.ts`, `components/editable/**`, `templates/home.tsx`, `package.json`, lockfiles |
| **F2B** | Detail streaming and asset diet | Fix | T, F2A | everything F2A owns, plus `public/sawad/lightmaps/**`, `scene/instanceCulling.ts`, `scene/bakedLight.ts`, `scene/useTimedAsset.ts`, `scene/useCompoundModel.ts`, `scene/SceneRoot.tsx`, `experience/lightmaps.ts`, versioned asset names in `finalize-manifest.mjs` |
| **F4** | Work per frame and memory | Fix | T | `scene/SceneLife.tsx`, `SceneMarkers.tsx`, `scene/landscape.ts`, `scene/lifeMotion.ts`, `experience/StoryRig.tsx`, `walk.ts`, `audio.ts`, `UnitTargets.tsx`, `ExperienceCanvas.tsx`, `public/sawad/audio/**` |
| **F6** | Server, data and the rest of the site | Fix | T | `app/**`, `lib/**`, `templates/**` except `home.tsx`, `components/sawad/finder/**`, `scene/SceneViewport.tsx`, `SceneCanvas.tsx`, posters and story stills |
| **F3** | Drawing each frame | Fix | First part (ledger rows T9, T10, T11, T18, T25, T34, T35): T. The rest: T, F2B | `scene/world.ts`, `SceneWorld.tsx`, `SceneVegetation.tsx`, `vegetation.ts`, `scene/planWorld.ts`, `experience/PostFX.tsx`, `quality.ts`, `godrays.ts`, `daylight.ts` |
| **F5** | Delivery | Fix | T, F2B | `next.config.ts`, `proxy.ts`, Vercel settings |
| **RS** | Second search on the fixed site | Lock | F1, F2B, F3, F4, F5, F6 | `docs/zaitun/perf/findings/RS.md`, `BASELINE.md` (new column) |
| **L1** | Budgets that fail the build | Lock | RS | new budget tests under `scripts/perf/`, budget constants in `finalize-manifest.mjs` |
| **QA2** | Final acceptance | Lock | L1 | reports only (`QA.md`, review page) |

A track that needs a file it does not own stops and says so. F5 waits for F2B because long cache lifetimes are only safe once F2B's file names carry a version. F3's tuning rows wait for F2B because frame cost should be tuned on the final geometry; its first part does not depend on the geometry and touches no file F2B owns, so it starts with wave 4 (the owner's decision D15). `scene/layout.ts` stays with track 0: no optimization track edits it.

Each fix track's work is its queue in section 4 of [perf/FINDINGS.md](perf/FINDINGS.md), in that order; section 5 there lists the hand-offs where a row crosses two tracks.

**The rig pass.** P0 is reopened once, after T, for rig notes R1–R4 of the ledger (section 8 there): reference frames that repeat exactly, frame times drawn back to back, a first-ever-visit load, and a worktree install. It is complete when P0's row in STATUS.md says so. Fix tracks may start their code work before that, but take no measurement and run no look gate until it is (the owner's decision D16).

## 4. Stage 1: measure (P0)

One track, run alone. It produces the rig and the baseline that every later track uses.

| Piece | What it does | Lives in |
|---|---|---|
| Lock and server | Builds for production, serves on a free port, holds the machine-wide lock while timing | `scripts/perf/rig.mjs` |
| Lighthouse runner | Official mobile and desktop runs on `/`, `/ar`, Compounds, Residences, Contact; median of five | `scripts/perf/lighthouse.mjs` |
| Load trace | The QA phone profile (cold cache, Fast 4G, 4× CPU) and a desktop profile: long tasks, waterfall, time to live scene, bytes per file type | `scripts/perf/trace.mjs` |
| Frame capture | Fixed cameras (poster hold, opening, the five tour stops, aerial, a walk path, orbit, dusk): frame times, draw calls, triangles, GPU time per pass, at each quality level and both tiers | `scripts/perf/frames.mjs` |
| Reference frames | The same cameras saved as images, plus a compare script that reports the mean difference | `scripts/perf/reference/`, `scripts/perf/diff.mjs` |
| Bundle report | Size of every chunk per route, eager or lazy, and which packages are in it | `scripts/perf/bundles.mjs` |
| Asset report | Every GLB broken down by mesh and texture, every image, audio and wasm file with its transfer size | `scripts/perf/assets.mjs` |
| Memory check | Heap and GPU memory after opening and closing the scene five times | `scripts/perf/memory.mjs` |

Outputs: `docs/zaitun/perf/BASELINE.md` (all numbers, with machine and build named) and the ledger `docs/zaitun/perf/FINDINGS.md` seeded with the known items below. P0 also asks the owner for one real-phone session, since every phone number so far used the Mac's GPU.

## 5. Stage 2: search (S1–S9, F2A, T)

Each search track reads its area end to end, measures on the rig, and writes rows to its findings file. A row has: where, the evidence as a number, the proposed fix, the expected gain against a section 1 target, the risk to the look, and the effort.

| ID | What it looks for | Where |
|---|---|---|
| **S1** | What blocks the main thread for 2–3 s while three.js starts on a phone (shader compiles, texture decode and upload, model parse, the first frame); what could move to a worker, be spread over frames, or wait; which of the 38 client files must be client code; fonts, CSS and layout shift on the critical path | `components/sawad/experience/**`, `scene/compoundModel.ts`, `app/(site)/**`, `templates/**` |
| **S2** | What is in the 161 KB app chunk; whether admin packages (tiptap, dnd-kit) reach public routes; unused parts of three, drei, postprocessing and GSAP; Theatre's share of the 227 KB chunk and whether the fixed tour path needs it at run time; duplicates | `package.json`, every route's chunks |
| **S3** | Per-mesh geometry cost (the site mesh is the largest); whether per-template AO maps (about 2.1 MB) add anything over the baked lightmap; texture format and size per page; vegetation and life files; posters and story stills as AVIF or WebP at screen sizes; the 4.5 MB music file | `public/sawad/**`, `scripts/blender/**` |
| **S4** | GPU time per pass at every stop and level; the 4096 shadow map redrawn every frame; the post chain at the top level; overdraw from leaf and frond cards; cost of the sky, water and baked-light shaders; resolution per level; texture memory | `components/sawad/scene/**`, `experience/PostFX.tsx`, `quality.ts`, `godrays.ts` |
| **S5** | JavaScript per frame (culling, vegetation sort, people and cars, the tour driver, scroll); objects created inside frame loops; React re-renders caused by frame state; hitches after the first frame; leaks on close and on route change; behaviour when the GPU context is lost | `scene/instanceCulling.ts`, `SceneVegetation.tsx`, `SceneLife.tsx`, `experience/StoryRig.tsx`, `storySheet.ts`, `walk.ts`, `audio.ts` |
| **S6** | Compression on `.glb`, `.ktx2`, `.wasm`; cache lifetimes (files in `public/` have no version in their names); what is fetched in what order and whether the model waits for the 3D code; preload hints; repeat-visit cost; what the host adds or strips | `next.config.ts`, `proxy.ts`, the host's settings |
| **S7** | Time to first byte on the catch-all route; database calls per page and what is cached; the media route; image sizing; cost of `proxy.ts` and `instrumentation.ts` on each request | `app/(site)/[[...slug]]/page.tsx`, `lib/content/**`, `lib/supabase/**`, `lib/media/**`, `app/api/media/**` |
| **S8** | Compounds, Residences, Contact and the story pages: load, tap response in the finder, the older scene viewport used for Bustan Dijla and Shatt, Arabic font loading; the admin panel only where it is slow to use | `templates/**`, `components/sawad/finder/**`, `scene/SceneViewport.tsx`, `app/admin/**` |
| **S9** | Whether the capability check puts real devices in the right tier; the frame-rate steps between levels; Save-Data, slow networks, low battery, background tabs, heat on long sessions | `experience/quality.ts`, `scene/capability.ts` |

### Already in the ledger

These came out of 7D, QA and the model inspection.

| Finding | Evidence | Fix track |
|---|---|---|
| Main thread waits 2–3 s on the GPU during three.js start-up on the phone profile (QA's first diagnosis, hydration, was wrong) | QA trace, variable | F1, after S1 names the cause |
| The whole compound model loads before the first frame | 10.26 MB high, 4.97 MB low, one `loadAsync` | F2A |
| The model is 21 instanced meshes, so splitting by place saves nothing; splitting by detail does | Geometry 6.18 MB, textures 3.94 MB, placement 4.5 KB | F2A, F2B |
| No distance levels for buildings | About 794k triangles in wide shots against 300k | F2B |
| Day lightmap added to the first load | +0.79 MB high tier | F2B |
| Shadow map of 4096 over 330 m, redrawn each frame | `scene/world.ts:111` | F3 |
| Opening is the slowest desktop moment | 65–70 fps against 91–120 at the stops | F2A, F3 |
| Texture decoder fetched on every cold visit | 0.58 MB | F5 |

### F2A: the far set

It runs beside the search because its evidence is already in hand and it is the largest single download saving.

- Simplified meshes are derived from the high meshes, so the atlas and lightmap coordinates carry over and materials match.
- The first frame waits for the far set only. The current full files still load right after it, so nothing else changes yet.
- Gate: the aerial and the poster handover compared against the reference frames.

### T: triage

One short session merges the nine findings files into `FINDINGS.md`, ranks them by gain over effort and risk, and publishes a review page. The owner approves the list, strikes what should not change, and settles every finding that would alter the look. Each approved row names the fix track that takes it.

## 6. Stage 3: fix (F1–F6)

| ID | Main work |
|---|---|
| **F1** | Compile the shaders ahead of the first frame, behind the poster (the stall S1 found; moved here from F3 because F1 owns the file that draws the first frame); ask for the model early; keep the admin editor out of public pages; pause the hidden scene; the quality monitor's logic; the device and network checks; split the 3D chunk |
| **F2B** | Mid and near detail per template, fetched one tour stop ahead; per-copy distance levels in the culling code, with a fade and no swaps during the poster hold; small lightmap first; versioned file names; then every S3 saving. Each step passes the reference frames before the next |
| **F4** | Remove per-frame allocation and re-renders; fix leaks and dispose paths; handle a lost GPU context |
| **F6** | Catch-all route and data caching; media and images; finder response; the older scene viewport; the music file |
| **F3** | First part: depth of field only where used, occlusion's wasted redraws, draw order, plant buffer uploads, and the ground, plant placement and reflection map made ahead. After F2B: the shadow map at 2048² with a fitted box, even level steps with occlusion kept at the top level, the pixel budget, a lower floor for weak GPUs, each level's effects compiled ahead with F1's helper |
| **F5** | On Vercel: check that the models are compressed on a preview (ledger row T57); long cache lifetimes on versioned files through `headers()`; AVIF for images; `proxy.ts` kept off asset files |

## 7. Stage 4: lock (RS, L1, QA2)

| ID | What it does |
|---|---|
| **RS** | Reruns the P0 rig on the fixed site and repeats the search in every area with an open target. Fixing the largest cost usually exposes the next one. A finding worth more than 5% on a target reopens its fix track for one more round; the rest are logged and left |
| **L1** | A test per budget: chunk sizes per route, file sizes in `finalize-manifest.mjs`, triangles per reference camera, transfer before the live scene. Each is set just above the achieved number |
| **QA2** | The section 1 table, measured on the rig and on the real phone, in English and Arabic, with a review page and an updated `QA.md` |

## Skills and tools per track

Every track invokes all of its listed skills before it starts work, plus `read-the-damn-docs` before any third-party API, and reads the Next docs in `node_modules/next/dist/docs/` before Next code.

| ID | Skills to invoke | MCP servers |
|---|---|---|
| P0, RS, QA2 | `webapp-testing`, `next-bundle-optimizer`, `threejs-performance`, `next-dev-loop` | playwright, chrome-devtools |
| S1, F1 | `vercel-react-best-practices`, `next-bundle-optimizer`, `threejs-performance`, `threejs-loaders`, `gsap-performance`, `theatre-js`, `next-dev-loop` | playwright, chrome-devtools |
| S2 | `next-bundle-optimizer`, `vercel-react-best-practices` | — |
| S3, F2A, F2B | `threejs-asset-pipeline`, `threejs-loaders`, `threejs-textures`, `asset-optimization`, `export-pipeline`, `blender-web-3d`, `threejs-performance` | playwright; blender only if a simplified mesh needs hand correction |
| S4, F3 | `threejs-performance`, `threejs-postprocessing`, `threejs-shaders`, `threejs-lighting`, `threejs-react-three-fiber` | playwright, chrome-devtools |
| S5, F4 | `threejs-performance`, `threejs-react-three-fiber`, `vercel-react-best-practices`, `gsap-performance` | playwright, chrome-devtools |
| S9 | `threejs-performance`, `webapp-testing` | chrome-devtools |
| S6, S7, S8, F5, F6 | `vercel-react-best-practices`, `next-dev-loop`, `web-design-guidelines` | playwright, chrome-devtools |
| T | `visual-plan` (user) | — |
| L1 | `next-bundle-optimizer`, `threejs-asset-pipeline`, `webapp-testing` | — |

## Session order

One session per track in `toofi-website/`. Set the model and effort when opening it, for example `claude --model claude-opus-5-5 --effort high`, then say `masterplan phase <id>`. "Done" means the owner said `approve phase <id>`.

### Wave 0: before anything (owner)

Commit the uncommitted work in the main checkout, so every worktree starts from it. Answer the hosting question in section 8.

### Wave 1: start now (1 session)

| Track | Model · effort | Why |
|---|---|---|
| `P0` Rig and baseline | Opus 5.5 · high | Every later number depends on it |

**Wait:** approve P0, have it committed to main, and do the real-phone session it asks for.

### Wave 2: when P0 is done (10 sessions, or two batches of five)

Timing runs queue on the rig lock, so ten sessions at once gain little over two batches. Batch A carries the findings the fix tracks need most.

| Batch | Track | Model · effort | Why |
|---|---|---|---|
| A | `S1` Load and 3D start-up | Fable 5.2 · high | The cause of the phone stall is still unknown, and one diagnosis was already wrong |
| A | `S4` Drawing each frame | Fable 5.2 · high | GPU cost per pass needs careful attribution |
| A | `S5` Work per frame and memory | Opus 5.5 · high | Profiling and leak hunting across the scene code |
| A | `S3` Assets and media | Opus 5.5 · medium | Judging what detail the eye needs |
| A | `F2A` Far set | Opus 5.5 · high | Export and loader work with a look gate |
| B | `S2` Bundles | Sonnet 5.5 · medium | Measurable and rule-driven |
| B | `S6` Delivery | Sonnet 5.5 · medium | Checklist against headers and the waterfall |
| B | `S7` Server and data | Sonnet 5.5 · medium | Reading the request path and counting calls |
| B | `S8` Rest of the site | Sonnet 5.5 · medium | The rig on the other pages |
| B | `S9` Device tiers | Sonnet 5.5 · medium | Thresholds against measured numbers |

**Wait:** approve S1–S9. F2A may still be running.

### Wave 3: when S1–S9 are done (1 session)

| Track | Model · effort | Why |
|---|---|---|
| `T` Triage | Fable 5.2 · high | Ranking trade-offs between speed and the look |

**Wait:** approve the ranked list and settle the look decisions. Approve F2A and have it merged into main. (Done 2026-11-22.)

### Before wave 4: the rig pass (1 short session)

| Track | Model · effort | Why |
|---|---|---|
| `P0` reopened, rig notes R1–R4 | Opus 5.5 · medium | Every fix is judged by the rig, and the search found faults in it |

Say `masterplan phase P0` and name the rig pass. **Wait:** approve it before any fix track measures or runs a look gate. Wave 4's sessions may be opened meanwhile.

### Wave 4: when T and F2A are done (5 sessions)

| Track | Model · effort | Why |
|---|---|---|
| `F1` Main thread and bundles | Fable 5.2 · high | Restructuring start-up without changing behaviour |
| `F2B` Detail streaming and asset diet | Opus 5.5 · xhigh | The largest change, and the one most able to break the look |
| `F4` Work per frame and memory | Opus 5.5 · high | Careful edits in frame loops |
| `F6` Server, data, rest of site | Sonnet 5.5 · medium | Well-defined caching and media work |
| `F3` Drawing each frame, first part | Opus 5.5 · high | Seven rows that do not depend on the final geometry, three of them stall fixes |

**Wait:** approve F2B and have it merged into main. That alone opens wave 5; F1, F4 and F6 may still be running. F3's first part is shown for review and merged before its second part starts, so F3 is approved once, at the end of wave 5.

### Wave 5: when F2B is done (2 sessions)

| Track | Model · effort | Why |
|---|---|---|
| `F3` Drawing each frame, the rest | Opus 5.5 · high | Shader and pass work tuned on the final geometry |
| `F5` Delivery | Sonnet 5.5 · medium | Headers and fetch order on the final file names |

**Wait:** approve all six fix tracks and have them merged into main.

### Wave 6: when F1–F6 are done (1 session)

| Track | Model · effort | Why |
|---|---|---|
| `RS` Second search | Opus 5.5 · medium | Reruns the rig and judges what is still worth fixing |

**Wait:** approve RS. If it reopens a fix track, run that track once more and approve it before wave 7.

### Wave 7: when RS is done (1 session)

| Track | Model · effort | Why |
|---|---|---|
| `L1` Budgets | Sonnet 5.5 · medium | Turns achieved numbers into tests |

**Wait:** approve L1 and have it merged into main.

### Wave 8: when L1 is done (1 session)

| Track | Model · effort | Why |
|---|---|---|
| `QA2` Final acceptance | Sonnet 5.5 · medium | Runs the checklist; escalate failures to an Opus session |

**Wait:** the real-phone session, then approve QA2.

**Critical path:** P0 → S1–S9 → T → F2B → F3 → RS → L1 → QA2.

If budget matters more than speed, Opus 5.5 can stand in for Fable 5.2 on any track; don't go below Sonnet 5.5 on a track marked Opus.

## 8. Owner decisions

Answered at triage on 2026-11-22. All 18 decisions and what follows from each are in section 2 of [perf/FINDINGS.md](perf/FINDINGS.md).

| Decision | Why it matters | Answer |
|---|---|---|
| Where the site is hosted | S6 and F5 depend on what the host compresses and caches | Vercel. Whether it compresses the models is still to be checked (ledger row T57) |
| The targets in section 1 | They define when the work stops | Amended: the standard load, the first-ever visit tracked, triangles for the phone tier only |
| A real mid-range Android phone, on a 4G connection in Iraq if possible | Every phone number so far is emulated | Postponed: continue on the rig. Rows that need it stay deferred |
| Is the admin panel in scope? | It is left out unless it is slow to use | No. S8 measured it: nothing slow |
| Does "loads under 5 s" mean the content or the live scene? | Content already passes; if that is the bar, F2B drops below F3 | The live scene, on the standard load. F2B stays ahead of F3 |
| May the look change at all? | Dropping per-template AO or using cards for far trees may differ by more than 2/255 | Nothing over 2/255, except the softer shadow edges, the half-size vegetation atlas, the pixel budget on large screens, the fonts and the finder's model |
