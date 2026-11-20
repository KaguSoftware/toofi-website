# Zaitun Hills: acceptance report (track QA)

Run 2026-11-20 on main at f73a6a8, against a production build (`next build` + `next start`, local mode, built from a throwaway worktree so `.env.local` did not apply). Chrome through the chrome-devtools and Playwright MCP servers. Machine: Apple-silicon Mac, 120 Hz display. After the first report the owner asked for the fixes; they were re-measured the same way.

## Result per criterion

| Criterion | Result | Evidence |
|---|---|---|
| `npm run check` passes | **Pass** | typecheck, lint (0 errors, 0 warnings), test gate (71 legacy files in baseline), 108 files / 1,036 tests (12 new), coverage thresholds met |
| Lighthouse performance above 80 | **Not measured; likely fails on mobile** | The MCP Lighthouse run excludes performance, and `npx lighthouse` was blocked by the sandbox. Phone profile (cold cache, Fast 4G, 4× CPU): LCP 0.65 to 1.4 s, CLS 0, but 2.0 to 3.1 s of main-thread blocking after first paint (see "What the blocking is"). Desktop: LCP 0.11 s, about 0.64 s of blocking |
| Loads under 5 s on 4G | **Content: pass. Live 3D: no** | Phone profile (cold, Fast 4G, 4× CPU, low tier): LCP 0.65 s, load event 1.3 s. The live scene is in at about 9.6 s (low-tier model 3.0 MB, vegetation 0.34 MB, day lightmap 0.23 MB, basis transcoder). 5.06 MB transferred in total. Whether "loads" means the content or the live scene is the owner's call |
| 60 fps desktop | **Pass** | Opening 65–70 fps, tour stops 91–120 fps, orbit and dusk toggle smooth, 0 console errors |
| 30 fps or better on a mid-range phone | **Pass on emulation only** | Low tier with 4× CPU throttle: 60 fps at the opening, 72–76 in the 3D stops, worst frame 26 ms. The GPU is the Mac's, so this is not a phone number. Needs a real phone |
| English and Arabic end to end | **Pass** | `/` is ltr, `/ar` is rtl with `lang=ar`; captions, numbers, tour stops and cards follow. Arabic-Indic digits and no Latin digits in the Arabic viewport; pool length agrees (72 m / ٧٢ مترًا) |
| Clickable homes | **Pass** | Real mouse click flies the camera to the home and opens the panel: ZH-V32 (sold) shows type, status, bedrooms, built area, land, outlook, handover, guide price and a finder link; ZH-V48 (available) adds "Enquire about this home". Arabic panel is RTL with Arabic-Indic digits and an `/ar/residences?...` link |
| Poster-to-scene handover | **Not re-measured** | 7D measured 11.3/255 mean diff at the cut; that path is unchanged |
| Reduced motion | **Pass** | No canvas, no models fetched, stills with an "Explore in 3D" button |
| Lighthouse accessibility / best practices / SEO | **100 / 100 / 100** | Was 100 / 100 / 77 (`/`) and 83 (`/ar`) before the fixes |
| Weak device, Save-Data, slow network gating; walk mode and touch joystick | **Not browser-tested** | Gating is covered by `capability.test.ts`; walk mode and the joystick were not driven |

## What the blocking is (corrected)

The first report blamed React hydration. That was wrong: the trace's call-site URL pointed at the React chunk, but the CPU profile shows hydration is about 0.13 s of the load. With source maps (built only in the throwaway copy) the blocking is the 3D start-up on the main thread, at 4× CPU:

- three.js internals, about 2.4 to 2.6 s of self time in three of four runs: `getExtension` (a synchronous round trip to the GPU process) and shader link checks. This is the main thread waiting on the GPU. It varies a lot between identical runs (longest task 0.9 s in one baseline run, 1.8 s in another, 1.7 and 1.9 s in the two fixed runs), so TBT after first paint was 2.0 and 3.1 s before the fixes and 2.6 and 2.8 s after: no measurable change.
- `layout.ts`: 433 ms before, about 215 to 240 ms after (fixed, see below).
- `capability.ts`: 250 ms before, about 180 to 210 ms after (the rest is the first, unavoidable WebGL context).
- gsap `CSSPlugin` start-up about 130 ms, the bundler runtime about 190 ms, React hydration about 120 ms.

So the GPU wait is the open item. It was not reduced by these fixes, and it is not clear it can be from the app side; a real phone is the right place to measure it.

## Fixed

| What | Change | Verified |
|---|---|---|
| `/robots.txt` returned the 404 page | New `app/robots.ts` (allow `/`, disallow `/admin` and `/api/`, host when the site address is known) | Served as valid text; SEO audit passes |
| Canonical and hreflang links were relative | `metadataBase` in `app/layout.tsx` from new `lib/site-url.ts` (`NEXT_PUBLIC_SITE_URL`, or Vercel's production domain). **Set `NEXT_PUBLIC_SITE_URL` in production**; without it the links stay relative. Documented in `docs/ARCHITECTURE.md` | Links absolute in the build (`http://localhost:3417/ar`), SEO 100 |
| Brand link name did not contain its visible text | A space between "Sawad" and "Holding" in `SiteHeader.tsx` (the flex gap keeps the look) | Accessibility audit clean; test added |
| Hero card ran 49 px past the fold at 1440 × 900 | `experience.css`: the card sits in a grid row that ends 32 px above the stage bottom and grows upward | 32 px clearance at 1440 × 900 and on a 412 × 915 phone in Arabic |
| Drive list rebuilt on every land-use lookup | `layout.ts`: `builtDrives` is built once (`once()`) | `layout.ts` time 433 → about 220 ms at 4×; test added |
| WebGL2 probe made a context on every read | `capability.ts`: asked once, probe context released; `resetWebGL2Probe()` for tests | Tests added; 250 → about 190 ms at 4× |
| Lint warning | Unused variable removed in `scripts/blender/export-final.mjs` | Lint has 0 warnings |

Files touched outside the QA track's own area (by the owner's request): `layout.ts` (track 0), `capability.ts`, `experience.css`, `SiteHeader.tsx`, `app/layout.tsx`, `export-final.mjs`.

## Not changed

- The "space before the colon in the Arabic screen-reader text" finding was a false alarm: JSX trims the line break, so the accessible name has no space.
- Dusk clouds read as flat lens-shaped discs (the sky shader's cloud streaks in `world.ts`), and far status markers stack into clumps (they are constant-size sprites, `sizeAttenuation: false`). Both are art-direction changes to approved visuals; left for the owner.
- `THREE.Clock` deprecation warning on each load comes from React Three Fiber 9.8.2, not app code.

## Left for the owner

- Real phone: fps, 4G load, walk mode and the touch joystick on an actual mid-range Android phone in Iraq. This is also where the GPU wait should be measured.
- Official Lighthouse performance score: `npx lighthouse` was denied by the sandbox in this session. Run it once yourself or allow it.
- What "loads under 5 s" means (the content or the live scene).
- `NEXT_PUBLIC_SITE_URL` for production.
- Final names, prices and availability (still sample data).
- Another process (PID 1165) was serving port 3100 when QA started; it is not part of this work. An untracked `docs/zaitun/OPTIMIZATION_PLAN.md` appeared in the repo during QA; it is not QA's.
