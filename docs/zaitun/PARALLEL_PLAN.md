# Zaitun Hills showcase: phases, dependencies and parallel tracks

The work is defined in [SHOWCASE_PROMPT.md](SHOWCASE_PROMPT.md) (phases 0–7). This file splits some phases into tracks so independent work can run at the same time, and says what each track needs first. Progress and approvals are kept in [STATUS.md](STATUS.md).

Start a track in a new Claude Code session by saying **`masterplan phase <id>`**, for example `masterplan phase 0` or `masterplan phase 7A`. Saying just a number (`masterplan phase 1`) starts the first track of that phase whose prerequisites are met.

## Tracks

| ID | Track | Prompt phase | Needs approved first | Owns (only this track edits these) |
|---|---|---|---|---|
| **0** | 28 ha masterplan: plan drawing, `layout.ts`, residence data, their tests | PHASE 0 | nothing | `components/sawad/scene/layout.ts` (+ test), `lib/sawad/data.ts` (+ test), `scripts/export-scene-layout.mjs`, `scripts/blender/layout.json`, residence-count tests in `components/sawad/finder/` |
| **1A** | New amenity assets: gym + padel/tennis courts, playground, mosque, parking. Parametric, sized by arguments, placed nowhere yet | PHASE 1 (assets) | nothing (uses default sizes; 0 confirms them later) | new `scripts/blender/amenities.py`, imported by `build_compound.py` (one import line and one call only) |
| **2** | Materials: trim-sheet regions for the new surfaces, imperfection (dirt, roughness breakup, per-instance variation), dust film | PHASE 2 | nothing | `REGIONS`, `build_atlas` and material functions in `scripts/blender/build_compound.py`, `scripts/blender/fetch_textures.sh` |
| **3A** | Vegetation and life assets: olive, date palm, citrus, hedges, LODs and distance cards, wind sway, people, cars, birds | PHASE 3 (assets) | nothing | new `scripts/blender/vegetation.py`, new `scripts/blender/life.py`, their output GLBs |
| **7A** | R3F migration at parity: port the current engine to React Three Fiber with today's layout and model, keeping every behaviour and test | PHASE 7 (migration) | nothing | `components/sawad/scene/**` except `layout.ts`, `package.json`, lockfiles |
| **1B** | Rebuild the compound model at 28 ha: place every asset from the new layout, both tiers, manifest + test | PHASE 1 (placement) | 0, 1A, 2 | the placement section of `build_compound.py`, `scripts/blender/finalize-manifest.mjs`, `compoundModel.manifest.test.ts`, `public/sawad/models/compound-*` |
| **3B** | Landscape placement: tree, hedge and lawn scatter across the 28 ha site and foothills, life paths (people, cars, birds) | PHASE 3 (placement) | 0, 3A | scatter functions (`palmPositions`, `treePositions` successors) and their tests |
| **5A** | Shot list as storyboard frames (greybox renders from the new layout) | PHASE 5 (storyboard) | 0 (1B makes the frames nicer, not required) | `scripts/blender/film/` cameras and storyboard |
| **6A** | Export pipeline and budgets: Draco vs meshopt decision, LODs, new per-tier budgets for 28 ha, gltfjsx setup | PHASE 6 (pipeline) | 0 | `scripts/blender/build.sh`, budget constants in `finalize-manifest.mjs` |
| **7B** | Put the R3F scene on the new layout and model; update viewpoints, markers and their tests | PHASE 7 | 0, 7A, 1B | `components/sawad/scene/**` |
| **4** | Lighting: golden-hour sun, sky, haze, day + dusk lightmap bakes (UV2), dusk practicals | PHASE 4 | 1B, 2, 3B (and the real north direction) | lighting/bake code in `scripts/blender/`, lightmap outputs |
| **7C** | Web experience: intro sequence, letterbox, scroll story (GSAP + Theatre.js), captions in EN/AR, orbit, walk mode, unit panel, day/dusk toggle, audio, post-processing, adaptive quality | PHASE 7 | 7B (uses placeholder lightmaps until 4 lands) | new story/explore components, `lib/sawad/i18n.ts` caption keys |
| **6B** | Final export: optimized GLBs + KTX2 lightmap sets, budgets met | PHASE 6 | 4, 6A | `public/sawad/models/**` |
| **5B** | Film: Cycles render, grade, sound, 4K film, 15 s vertical cut, 8–10 stills, the four web poster stills | PHASE 5 | 4, 5A approved, music + logo from you | film outputs, `public/sawad/scene-zaitun-*.jpg` |
| **7D** | Final wiring: final GLBs + lightmaps + posters, poster-to-scene handover, performance tuning by device tier | PHASE 7 | 6B, 7C, 5B (posters) | `components/sawad/scene/**` |
| **QA** | Acceptance: Lighthouse > 80, 4G load < 5 s, fps on desktop and a mid-range phone, EN + AR end to end, `npm run check` | ACCEPTANCE | 7D | reports only |

## Skills and tools per track

Every track invokes **all** of its listed skills with the Skill tool before it starts work, and uses the listed MCP servers. Project skills live in `.claude/skills/`; the ones marked (user) are installed globally. MCP servers are in `.mcp.json` (`blender` needs Blender open with the MCP add-on running; the headless build scripts don't).

Always, in every track: `read-the-damn-docs` (user) before using any third-party API, library or CLI.

| ID | Skills to invoke | MCP servers |
|---|---|---|
| 0 | `archviz`, `environment-artist`, `visual-plan` (user), `camera-cinematography` | blender |
| 1A | `archviz`, `blender-web-3d`, `uv-workflow`, `materials`, `asset-optimization` | blender |
| 2 | `materials`, `lookdev`, `uv-workflow`, `blender-web-3d` | blender |
| 3A | `vegetation-artist`, `environment-artist`, `asset-optimization`, `blender-web-3d`, `threejs-shaders` | blender |
| 7A | `threejs-react-three-fiber`, `threejs-fundamentals`, `threejs-loaders`, `threejs-lighting`, `threejs-materials`, `threejs-textures`, `threejs-shaders`, `threejs-postprocessing`, `threejs-performance`, `vercel-react-best-practices`, `next-dev-loop`, `webapp-testing` | playwright |
| 1B | `archviz`, `blender-web-3d`, `export-pipeline`, `asset-optimization`, `uv-workflow` | blender |
| 3B | `vegetation-artist`, `environment-artist`, `threejs-performance` | blender |
| 5A | `camera-cinematography`, `archviz`, `rendering`, `visual-plan` (user) | blender |
| 6A | `export-pipeline`, `asset-optimization`, `threejs-asset-pipeline`, `threejs-loaders`, `blender-web-3d` | — |
| 7B | `threejs-react-three-fiber`, `threejs-interaction`, `threejs-loaders`, `threejs-performance`, `vercel-react-best-practices`, `next-dev-loop`, `webapp-testing` | playwright |
| 4 | `lighting`, `rendering`, `lookdev`, `archviz`, `threejs-lighting`, `threejs-textures` | blender |
| 7C | `gsap-scrolltrigger`, `gsap-react`, `gsap-timeline`, `gsap-core`, `gsap-plugins`, `gsap-utils`, `gsap-performance`, `theatre-js`, `threejs-animation`, `threejs-interaction`, `threejs-postprocessing`, `threejs-shaders`, `threejs-performance`, `design-motion-principles` (user), `frontend-design` (user), `impeccable` (user), `web-design-guidelines`, `arabic-writing` (user), `vercel-react-best-practices`, `next-dev-loop`, `webapp-testing` | playwright, chrome-devtools |
| 6B | `threejs-asset-pipeline`, `export-pipeline`, `asset-optimization` | — |
| 5B | `rendering`, `compositing`, `camera-cinematography`, `lighting`, `lookdev`, `ffmpeg-skill` | blender |
| 7D | `threejs-performance`, `threejs-loaders`, `threejs-react-three-fiber`, `next-bundle-optimizer`, `next-dev-loop`, `vercel-react-best-practices`, `webapp-testing` | playwright, chrome-devtools |
| QA | `webapp-testing`, `web-design-guidelines`, `next-bundle-optimizer`, `threejs-performance`, `arabic-writing` (user) | playwright, chrome-devtools |

If a listed skill is missing or fails to load, say so and continue with the others; don't silently skip it.

## Session order

Open one new Claude Code session per track in `toofi-website/`, pick the model (`/model`, or `claude --model <id>`), and say `masterplan phase <id>`. "Done" means you said `approve phase <id>`. A round starts when everything it waits for is done; tracks still running from earlier rounds keep going.

Models: **Fable 5.2** (`claude-fable-5-2`) for the hardest judgment calls, **Opus 5.5** (`claude-opus-5-5`) for skilled build work, **Sonnet 5.5** (`claude-sonnet-5-5`) for well-defined, rule-driven work. Haiku 5.5 is not used for a track; sessions may use it for small subagent jobs.

### Round 1: start now (5 sessions)

| Session | Track | Model | Why this model |
|---|---|---|---|
| 1 | `0` 28 ha masterplan | Fable 5.2 | Every later track builds on it; site planning and data consistency need the best judgment |
| 2 | `7A` R3F migration at parity | Fable 5.2 | Largest and riskiest refactor; must keep every behaviour and test |
| 3 | `1A` Amenity assets | Opus 5.5 | Architectural modelling in Blender scripts with real design sense |
| 4 | `2` Materials | Opus 5.5 | Look quality and trim-sheet technique |
| 5 | `3A` Vegetation and life assets | Opus 5.5 | Trees, LODs, wind shaders and people need craft |

### Round 2: when 0, 1A, 2 and 3A are done (4 sessions; 7A keeps running)

| Session | Track | Model | Why |
|---|---|---|---|
| 6 | `1B` Model rebuild at 28 ha | Opus 5.5 | Large scripted rebuild, two tiers, manifest and budgets |
| 7 | `3B` Landscape placement | Sonnet 5.5 | Rule-driven scatter with clear constraints |
| 8 | `5A` Storyboard | Opus 5.5 | Cinematic composition and lens choices |
| 9 | `6A` Export pipeline and budgets | Sonnet 5.5 | Well-defined pipeline work with measurable targets |

### Round 3: when 1B and 3B are done (2 sessions)

| Session | Track | Model | Waits also for | Why |
|---|---|---|---|---|
| 10 | `4` Lighting and lightmaps | Opus 5.5 | the real north direction from you | Bake quality (no seams or leaks) and matching web to Cycles |
| 11 | `7B` R3F scene on new layout | Opus 5.5 | 7A done | Integration on the new architecture with test updates |

### Round 4: when 4 and 7B are done (3 sessions)

| Session | Track | Model | Waits also for | Why |
|---|---|---|---|---|
| 12 | `7C` Web experience features | Fable 5.2 | — | The showcase itself: motion, story, explore modes, bilingual UI, performance tiers |
| 13 | `5B` Film, stills, posters | Opus 5.5 | 5A done, music and logo from you | Render setup, grade and edit; long renders mostly wait |
| 14 | `6B` Final export | Sonnet 5.5 | 6A done | Runs the agreed pipeline and checks budgets |

### Round 5: when 5B, 6B and 7C are done (1 session)

| Session | Track | Model | Why |
|---|---|---|---|
| 15 | `7D` Final wiring and performance | Opus 5.5 | Poster handover, profiling and tuning across device tiers |

### Round 6: when 7D is done (1 session)

| Session | Track | Model | Why |
|---|---|---|---|
| 16 | `QA` Acceptance | Sonnet 5.5 | Runs the checklist and measurements; escalate failures to an Opus session |

### Shortcuts (optional, for speed)

- `5A` and `6A` need only 0: start them as soon as 0 is approved.
- `3B` needs only 0 and 3A.
- `7C` needs only 7B: start it as soon as 7B is approved, without waiting for 4.

**Critical path:** 0 → 1B → 4 → 6B → 7D → QA. 7A runs alongside it and becomes critical if it is not done by the time 1B is.

If budget matters more than speed, Opus 5.5 can stand in for Fable 5.2 on any track; don't go below Sonnet 5.5 on a track marked Opus.

**Things only you can provide:** the real north direction (needed by 4), reference images (useful from 0 on), the logo and music (needed by 5B), final names and prices (needed by QA). Each one blocks only the track named.

## Rules for parallel sessions

- Each track runs in its own git worktree on branch `zaitun/<id>` (for example `zaitun/7A`) whenever any other track is in progress, so sessions never edit the same checkout.
- A track edits only the files it owns (table above). If it needs a change in another track's file, it stops and says so instead of making it.
- Nothing is committed, merged or pushed unless you ask.
- Every track ends by showing its result (screenshots, renders, a plan drawing or test output) and waiting for your approval, then records the outcome in STATUS.md (its own row only).
- `npm run check` must pass before a code track asks for approval.
