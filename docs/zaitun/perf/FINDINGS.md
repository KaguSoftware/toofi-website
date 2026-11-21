# Findings ledger

Seeded by P0 on 2026-11-20, numbers from the baseline of 2026-11-21. Search tracks S1–S9 write their rows to `findings/<id>.md`; track T merges them here, ranks them by gain over effort and risk, and the owner approves the list. Numbers come from the rig ([scripts/perf/](../../../scripts/perf/README.md)) unless a row says otherwise; the baseline is [BASELINE.md](BASELINE.md).

A row has: where it is, the evidence as a number, the proposed fix, the expected gain against a target in section 1 of the [plan](../OPTIMIZATION_PLAN.md), the risk to the look, the effort and the fix track. "Status" is open until T ranks it.

## Known before P0

From 7D, QA and the model inspection, as listed in the plan. P0 re-measured each one where the rig can.

| ID | Where | Finding | Evidence | Proposed fix | Gain against | Look risk | Effort | Fix track | Status |
|---|---|---|---|---|---|---|---|---|---|
| K1 | 3D start-up (`experience/**`, three.js) | Main thread blocks after first paint while three.js starts on the phone profile. QA's first diagnosis (hydration) was wrong | Phone profile: 0.68 s of blocking to the live scene (0.66–0.78 over 6 loads), longest task 0.27 s, 2 tasks over 200 ms. A single 3.0 s (phone) / 4.3 s (desktop) task on the first load after start-up in one run, never in twelve fresh-browser loads after. Lighthouse mobile `/` TBT 1.04 s, JS boot-up 2.9 s | S1 names the cause; then spread, defer or move to a worker | Stall < 0.3 s, Lighthouse ≥ 80 | none | ? | F1 | open |
| K2 | `scene/compoundModel.ts` | The whole compound model loads before the first frame (one `loadAsync`) | Files: 10.26 MB high, 4.97 MB low; 8.28 / 3.52 MB of models on the wire before the live scene (live scene 7.1 s on the phone profile; the model alone is 2.55–6.71 s of it) | Far set first (F2A), detail streamed later (F2B) | Live scene 5 s, transfer 5 / 3 MB | gated by reference frames | large | F2A | open |
| K3 | `compound-zaitun-*.glb` | 21 instanced meshes: splitting by place saves nothing, splitting by detail does | Geometry 11.81 MB decoded (high), textures 3.94 MB, 223k triangles in the file, 1.18M placed | Detail levels per template | Triangles, transfer | gated | large | F2A, F2B | open |
| K4 | Buildings | No distance levels | Triangles the camera sees: 1.43–1.46 M in the high tier's wide shots, 0.47 M low tier (rig count) | Per-copy distance levels in the culling code | 300k visible triangles | gated | large | F2B | open |
| K5 | Day lightmap | Added to the first load | day-buildings-high.ktx2 723 KB + day-site-high 65 KB = 0.79 MB | Small lightmap first, full one after | Transfer | gated | small | F2B | open |
| K6 | `scene/world.ts:111` | 4096 shadow map over 330 m, redrawn every frame | Shadow pass draws 1.19 M triangles in 56 calls in every wide day shot (high tier), as many as the scene itself | Update only when something moves; lower size per level | Frame time | low | small | F3 | open |
| K7 | Opening shot | The slowest desktop moment | At 60 Hz the opening holds 60 at every level; its frames carry 1.45 M scene + 1.20 M shadow triangles (headroom is not measurable at the cap; GPU timer 29 relative at level 3) | F2A (far set), F3 | Frame time | gated | – | F2A, F3 | open |
| K8 | `public/sawad/basis/` | Texture decoder (wasm) fetched on every cold visit | 527 KB file; 249 KB on the wire before every live scene, gzip (brotli would be 204 KB), fetched 3.0–4.0 s on the phone profile | Fetch beside the model, long cache once versioned | Live scene, repeat visits | none | small | F5 | open |

## Found by P0

Things the rig showed while it was being built. Each still needs its search track to confirm the cause and size the fix.

| ID | Where | Finding | Evidence | Proposed fix | Gain against | Look risk | Effort | Fix track | Status |
|---|---|---|---|---|---|---|---|---|---|
| P1 | `ZaitunExperience.tsx`, `ExperienceCanvas.tsx` | **The scene keeps drawing on other pages.** After a client-side move from Home to Compounds, Next keeps Home mounted but hidden, and the experience keeps rendering: about 60 `render()` calls a second on the Compounds page. Nothing pauses it (the visibility and intersection checks don't fire for a hidden route) | memory.mjs: 60 `render()` calls a second while on Compounds, in all five cycles; GPU estimate 215 MB still held | Pause the frame loop (and audio) when the route is hidden; release the GPU memory if it stays hidden | Battery and heat on every page after Home, tap response elsewhere (S8), memory | none | small | F4 (with F1 for `ZaitunExperience.tsx`) | open |
| P2 | `ExperienceCanvas.tsx` | **A level's pixel ratio is undone by the next re-render.** The Canvas gets a fixed `dpr` (the start level's), and React Three Fiber re-applies it whenever the Canvas re-renders (`@react-three/fiber` events build, line 1659), overriding the `setDpr` ExperienceRoot made for the new level. A desktop that steps down to level 1 can stay at 1.5× instead of 1.25× | Pinning level 1 alone left the drawing buffer at 2160 × 1248 (1.5×); it reached 1800 × 1040 only when the rig also changed the Canvas prop | Pass the current level's ratio to the Canvas (or no fixed `dpr`) | Frame time on weak devices: the monitor's step down is the safety net | none | small | F4 | open |
| P3 | `/(site)/[[...slug]]` first render | **Admin editor packages ship to every public page.** Next's analyzer puts tiptap, prosemirror and dnd-kit in the first-render JavaScript of the public catch-all route | First-render JS of the public route: 379 KB gzip (13 files); analyzer shares: prosemirror-view 1.6%, @tiptap/core 1.4%, prosemirror-model 0.7%, dnd-kit 0.6%, plus tiptap/react, starter-kit, extension-link. Lighthouse mobile `/` lists 1.06 s of unused JavaScript | Load the inline editor only in edit mode (dynamic import behind the edit switch) | Lighthouse (TBT, bytes), first content | none | small | F1 | open |
| P4 | Delivery of `.glb` | **Models compress well but are served gzip at best.** `next start` gzips GLB (the high model goes 10.26 → 7.14 MB on the wire); brotli would give 6.79 MB. The life models shrink about fivefold (239 → 49 KB brotli), which suggests their geometry is not meshopt-compressed | assets.mjs: gzip / brotli per file | Brotli for `.glb`/`.ktx2`/`.wasm` at the host (S6); meshopt on the life and vegetation exports (S3) | Transfer before the live scene | none | small | F5, F2B | open |
| P5 | `/residences` | **Residences shifts layout heavily while loading** | Lighthouse CLS 0.676 mobile, 0.484 desktop (performance 65 / 70, the only pages below 90 apart from Home); desktop also loads 10.3 MB there (the older scene viewport takes the high-tier model) | Reserve the stage's and the list's space before they fill; check which model the finder viewport needs | Lighthouse, the rest of the site | none | small | F6 (S8 to find the cause) | open |
| P6 | Fetch order on Home | **The model waits for the 3D code.** On the phone profile the lazy 3D chunks arrive 1.26–2.03 s, and the model request starts only at 2.55 s, finishing at 6.71 s; the live scene follows at 7.1 s | trace.mjs waterfall, cold run 1 | Start the model (and the decoder) fetch alongside the 3D code, or preload it once the device is known to be capable | Live scene on 4G (about 1 s) | none | small | F5 (S6 to confirm) | open |
| P7 | First frames | **One long frame when the scene appears**, at every level on both tiers: 217–267 ms in the poster-hold window | frames.mjs: worst frame per run (poster-hold), 2 of 109 frames over 20 ms | Compile shaders and upload textures before the first frame (`compileAsync`, warm-up render) | Frame target (no frame over 20 ms), the handover | low | medium | F3 (S1/S4 to attribute) | open |
| P8 | Leaving and returning to Home | **The JS heap grows about 0.7 MB per Home → Compounds → back cycle** | memory.mjs: 20.6 → 23.4 MB on Compounds over five cycles; contexts, DOM and GPU flat | S5 to find what is retained | Memory target | none | ? | F4 | open |

## Ruled out ("no gain")

Nothing yet. Search tracks add here what they measured as no gain, so nobody repeats it.

| Candidate | Measured | Track |
|---|---|---|
