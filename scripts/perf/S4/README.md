# Track S4: drawing each frame (GPU)

The scripts behind [docs/zaitun/perf/findings/S4.md](../../../docs/zaitun/perf/findings/S4.md). They run on the rig ([../README.md](../README.md)): the production build of this checkout, served locally, under the measurement lock. No product code is changed; every experiment is a change made to the live scene from an injected script.

| File | What it is |
|---|---|
| [probe.js](probe.js) | In-page probe, installed after the rig's. Times frames to the point the GPU has finished, draws several frames per tick, labels render passes, applies knock-outs, counts overdraw, lists texture memory, times the first frames' WebGL calls |
| [experiments.mjs](experiments.mjs) | The knock-outs as data, and the arithmetic on results (pairs, pass families, block averages) |
| [run.mjs](run.mjs) | The commands: `describe`, `knockouts`, `levels`, `passes`, `overdraw`, `memory`, `startup`, `look` |
| [report.mjs](report.mjs) | A results folder to the Markdown tables of the findings |
| [all.sh](all.sh) | Every measurement in the findings, about 100 minutes on the charger |

```bash
pnpm install --dir scripts/perf --ignore-workspace
sh scripts/perf/S4/all.sh
node scripts/perf/S4/report.mjs
```

## How frame time is taken here, and why

- **To GPU-done.** After a frame is drawn, one pixel is read back; that call returns when the GPU has finished. (`gl.finish()` returns at once in Chrome.)
- **Back to back** (`--repeat`, default 6). At one frame per 60 Hz tick the GPU idles between frames and clocks down, so a lighter frame is not proportionally faster. While the rig records, the page's frame callback is run several times per tick; a frame's cost is the tick's time over the count.
- **Paired** (`knockouts`, `levels`). The machine's load drifts between page loads when other sessions work on it. Each page load times the shipped frame, makes one change, lets it settle and times the changed frame. "Nothing changed" timed the same way is the noise.
- **Passes** are read back one by one, which costs about 0.3 ms each; `report.mjs` takes the smallest pass's time off every pass. Use them for shares.

## Using it from a fix track

- A before-and-after for one change: add a variant to `VARIANTS` in `experiments.mjs` (a probe action and its arguments) and run `node scripts/perf/S4/run.mjs knockouts --variants <id> --shots stop-1,stop-3`.
- A look check that repeats exactly: `run.mjs look --variants <id>`. It pins the quality level on fixed frames (the rig's own pin waits 100 ms of real time, which moves the film grain between captures) and compares with the shipped scene captured in the same run, per pixel and with the grain averaged out.
- Overdraw after a change of draw order or materials: `run.mjs overdraw --shots <camera> --variants base,<id>`.

The probe finds things by the names the scene gives them (`sky`, `terrain`, `river`, `vegetation`, `life`, `architecture-model`, `god-rays`, `sun`) and by postprocessing's material names. If a name changes, the run reports the mutation's result (`hidden: 0`) in its JSON; check `done` there when a knock-out saves nothing.
