# The measurement rig

Every number in the optimization plan ([docs/zaitun/OPTIMIZATION_PLAN.md](../../docs/zaitun/OPTIMIZATION_PLAN.md)) is taken here, the same way each time, so a before and an after can be compared. The baseline it produced is [docs/zaitun/perf/BASELINE.md](../../docs/zaitun/perf/BASELINE.md); the ledger of findings is [docs/zaitun/perf/FINDINGS.md](../../docs/zaitun/perf/FINDINGS.md).

## Set-up (once)

```bash
pnpm install --dir scripts/perf --ignore-workspace
```

The rig has its own small package (playwright-core, Lighthouse, gltf-transform, pngjs), so the app's dependencies and lockfile stay untouched. It drives your installed Google Chrome.

## Use

Run from the checkout you want to measure (the main checkout or a track's worktree):

| Command | What it does |
|---|---|
| `node scripts/perf/rig.mjs status` | Who holds the measurement lock |
| `node scripts/perf/rig.mjs build` | Production build of this checkout (cached until a file changes) |
| `node scripts/perf/rig.mjs serve` | Build and serve it until Ctrl-C (holds the lock meanwhile) |
| `node scripts/perf/rig.mjs all [--quick]` | Every report below, into `scripts/perf/results/<time>-all/` |
| `node scripts/perf/lighthouse.mjs` | Official Lighthouse, mobile and desktop, on `/`, `/ar`, `/compounds`, `/residences`, `/contact`, median of five |
| `node scripts/perf/trace.mjs` | Cold loads of Home on the phone and desktop profiles: first content, live scene, long tasks, waterfall, bytes per type |
| `node scripts/perf/frames.mjs` | Every fixed camera at every quality level on both tiers: frame times, JavaScript per frame, GPU timer, draw calls, triangles, passes |
| `node scripts/perf/frames.mjs reference` | The look gate: captures every camera and compares with `reference/` (mean difference of 2/255 or less) |
| `node scripts/perf/bundles.mjs` | First-render JavaScript per page, chunks loaded on demand, package shares |
| `node scripts/perf/assets.mjs` | Every GLB by mesh and texture; every image, KTX2, audio and wasm file with gzip and brotli sizes |
| `node scripts/perf/memory.mjs` | Heap, DOM, WebGL contexts and GPU memory over five close/reopen cycles of the scene and of the explorer |

Most scripts take `--tiers high,low`, `--shots stop-1,aerial`, `--levels adaptive,3`, `--profiles phone,desktop`, `--routes /,/ar`, `--runs N` to narrow a run. Each writes a JSON result (all the raw numbers) and prints a Markdown table.

## Rules it enforces

- **One measurement at a time on this machine.** Every script that builds or times anything waits for `~/.cache/sawad-perf/rig.lock`, so parallel sessions queue. Don't time anything outside the rig, and don't run `npm run check` or another heavy job while it holds the lock.
- **On the charger, Low Power Mode off.** On battery or in Low Power Mode macOS throttles the CPU and GPU and frames pin at 30 fps, so the rig refuses to time (override with `SAWAD_PERF_ALLOW_BATTERY=1` only to try something out, never for a number you keep). While it times, `caffeinate` keeps the display and the machine awake. The power state is saved with every build's metadata.
- **The build is the production build of what is in the checkout**, uncommitted changes included. It runs from a snapshot under `~/.cache/sawad-perf/work/`, so your `.next` and a running `next dev` are untouched, and `.env*` never applies: the server runs in local mode with sample data, as QA did. The rig's own files and `docs/` don't trigger a rebuild.
- **The look is a gate.** Every fix reruns `frames.mjs reference`. A frame over 2/255 fails, and the run folder gets the new frame next to the reference with a heat map under them, for the owner. Replace the references (`reference --update`) only when the owner approves a change to the look.

## How it measures (and the limits)

- **The probe** ([probe.js](probe.js)) is injected before any page script. It measures the shipped build from outside, with no product code changed: three.js announces its renderer on `__THREE_DEVTOOLS__`, and the probe wraps `render()` to count draw calls, triangles and passes per frame and time the frame's JavaScript. It tallies the WebGL allocation calls per context to estimate GPU memory.
- **Fixed cameras** ([shots.mjs](shots.mjs)) are frame-exact plans run from the scene's first frame: scroll to a tour stop, click Explore and Reset, hold W, drag, switch to dusk. Each shot is a fresh load.
- **Quality levels** are pinned through React's fiber tree, because the `?level=` switch only works in development. The probe sets ExperienceCanvas's level and its Canvas pixel ratio, and disables the monitor's callback. A changed hook order in ExperienceCanvas would break the pin; the run then says `PIN FAILED`.
- **Reference frames repeat exactly.** Under virtual time (performance.now, Date.now and rAF stand still until the first frame, then advance 1/60 s per frame), two captures of the same build differ by 0/255. Any difference you see is the change.
- **Device tiers** are forced through `navigator.deviceMemory` and `hardwareConcurrency` (capability.ts thresholds). The phone profile is QA's: 412 × 915, 4× CPU, Fast 4G. Frame runs on the low tier keep the CPU slowdown but not the network throttling.
- **The GPU is this Mac's** (Apple M3 Pro through ANGLE on Metal). No phone number from the rig is a phone number. That needs the real-phone session.
- **Frame rate is capped at 60 Hz** in headless Chrome. "60 fps" means at least 60. Turning vsync off stalls React Three Fiber's loop in headless Chrome, so headroom is read from JavaScript time per frame and the GPU timer instead.
- **The GPU timer is a relative number.** `EXT_disjoint_timer_query_webgl2` on ANGLE/Metal reports more than the frame interval at a steady 60 fps (overlapping command buffers), so compare it between runs on this machine, never against a budget. `--gpu pass` times each render pass (shadow split out); those per-pass numbers carry more driver overhead still.
- **Lighthouse SEO reads 85 here** because the local server has no `NEXT_PUBLIC_SITE_URL`, so canonical and hreflang links stay relative (QA got 100 with it set).
- **The bundle report's package shares** come from `next analyze`, which builds in memory and attributes unminified bytes. Read them as shares; the chunk sizes in the report are the real files.

## Adding a camera

Add it to `SHOTS` in [shots.mjs](shots.mjs) (steps by frame, a recording window, a capture frame), check it with `node scripts/perf/frames.mjs reference --shots <name>`, look at the frame it wrote, then `reference --update --shots <name>` and add its row to BASELINE.md.
