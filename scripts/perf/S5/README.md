# Track S5: work per frame and memory

Scripts for search track S5 of the optimization plan ([docs/zaitun/OPTIMIZATION_PLAN.md](../../../docs/zaitun/OPTIMIZATION_PLAN.md)). They run on the P0 rig: the same production build, the same lock, the same browser profiles ([../README.md](../README.md)). They change no product code. The findings are in `docs/zaitun/perf/findings/S5.md`.

| Command | What it measures |
|---|---|
| `node scripts/perf/S5/frameloop.mjs [--tiers high,low] [--shots …] [--levels adaptive,2] [--runs 2]` | Per recorded frame: the whole requestAnimationFrame callback, each `useFrame` subscriber by name, the other rAF callbacks of the frame, bytes uploaded to the GPU, React commits (page and scene) and the components they rendered, quality level changes, and every frame over 20 ms with what it held |
| `node scripts/perf/S5/frameloop.mjs cpu [--shots …]` | A V8 CPU profile over the same windows: self time per function per frame, with a snippet of the minified source at each site |
| `node scripts/perf/S5/frameloop.mjs alloc [--shots …]` | V8's sampling heap profiler and a GC trace over the same windows: bytes allocated per second and per frame, the top allocation sites, minor and major GC count and pause time |
| `node scripts/perf/S5/leaks.mjs [--only route,sound,walk-away,explorer] [--cycles 6]` | Heap snapshots diffed by constructor over route and explorer cycles; what the hidden Home keeps doing on another page (renders and main-thread time per second, the frame loop's setting); the sound across a route change; the walk's key handlers on another page |
| `node scripts/perf/S5/context-loss.mjs` | The GPU context dropped on purpose (story and exploring) and offered back: what is reported, shown and left running |

## How it sees inside a minified build

- [probe-s5.js](probe-s5.js) is injected next to the rig's probe. It installs a minimal React DevTools hook, so every commit of react-dom and of React Three Fiber's reconciler is seen; components that rendered are found by comparing each fiber's props and hook state with the last commit.
- React Three Fiber keeps its frame callbacks in `state.internal.subscribers` (store found through the scene's `__r3f` handle). Each subscriber's ref is wrapped in place to time it. The owner component is found through the hook that holds that ref, and [labels.mjs](labels.mjs) names it from its props (component names are minified).
- GPU uploads are tallied by wrapping `bufferSubData`, `bufferData`, `texSubImage2D/3D` and `texImage2D`.
- `performance.now()` is coarsened to 0.1 ms in a page that is not cross-origin isolated, so per-subscriber numbers are means over hundreds of frames; the CPU profile (`cpu`) gives the finer split.

## Cameras

[shots-s5.mjs](shots-s5.mjs): `stop-2` (held still), `opening`, `scroll-sweep` (6 s from the top to the last beat), `fling` (a jump to the last beat), `circuit` (the idle tour at the top), `orbit-drag`, `walk-long` (5 s with a turn), `explore-idle`.
