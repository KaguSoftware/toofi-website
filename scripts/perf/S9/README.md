# Track S9: device tiers and gating

Scripts for search track S9 of the optimization plan ([docs/zaitun/OPTIMIZATION_PLAN.md](../../../docs/zaitun/OPTIMIZATION_PLAN.md)). They run on the P0 rig ([../README.md](../README.md)) and change no product code. Findings: `docs/zaitun/perf/findings/S9.md`.

| Command | What it does | Lock |
|---|---|---|
| `node scripts/perf/S9/devices.mjs` | Runs the shipped `canRender3D`, `qualityTier` and quality ranges on 18 device archetypes. Inputs come from vendor specs, not hardware | no (no timing) |
| `node scripts/perf/S9/software-gl.mjs` | Asks Chrome for WebGL2 on the GPU and on SwiftShader, with and without `failIfMajorPerformanceCaveat` | no |
| `node scripts/perf/S9/live.mjs adapt [--scenario heat,slow-desktop,weak-phone]` | The adaptive quality over 90–120 s while the CPU slowdown changes: level and fps every 500 ms | yes |
| `node scripts/perf/S9/live.mjs pixels [--viewports 2560x1440@1,…] [--levels 2,3]` | Same camera and pinned level at larger canvases: drawing buffer, fps, relative GPU timer | yes |
| `node scripts/perf/S9/live.mjs network [--presets fast-4g,iraq-4g,fast-3g,slow-3g]` | What `navigator.connection` reports under each network preset and whether the scene started | yes |

The CPU slowdown stands in for a hot or slow device (the GPU is this Mac's). Read levels against each other, not against a phone.
