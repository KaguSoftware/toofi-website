# Step 8: Wiring and performance

**Goal:** the final files in place and tuned: baked light on the live scene, the poster-to-scene handover, performance by device tier, all inside the bar. This is Zaitun's 7D.

Standards: `SHOWCASE_PROMPT.md` PHASE 7 and ACCEPTANCE CRITERIA; the 7D notes in `docs/zaitun/STATUS.md`. Numbers: `quality-bar.md` web and model sections.

## Skills

`threejs-performance`, `threejs-loaders`, `threejs-react-three-fiber`, `next-bundle-optimizer`, `next-dev-loop`, `vercel-react-best-practices`, `webapp-testing`. MCP: playwright, chrome-devtools.

## Work

1. **Baked light** for the compound through `scene/bakedLight.ts`: day with the model, dusk on first request, blended with the sky; real-time shadows kept for plants, people and cars.
2. **Handover:** the opening holds on the poster frame for 2 s, then settles over 3.5 s; measure the mean diff at the cut.
3. **Performance:** per-copy culling, people and car distances, quality levels driven by frame rate; measure fps, draw calls and triangles at the opening and every stop on desktop and the phone profile; the page weight per tier.
4. Fix what misses the bar here. A fix that needs another step's files goes back to that step (say which), it doesn't get patched around.

## Owns

The compound's wiring and its performance settings; shared performance code only where the change keeps Zaitun's frames and numbers the same or better.

## Done when

- Every web and model number in `quality-bar.md` measured and met, in a table next to Zaitun's.
- Zaitun's frames and numbers unchanged or better. `npm run check` passes.
- Review page published; row 8 set to "awaiting approval".
