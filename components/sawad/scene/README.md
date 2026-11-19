# The compound scene

The 3D view of a compound: a film on Home and an explorer in the residence finder. It is built on three.js 0.187 with React Three Fiber 9.8 (`@react-three/fiber`, pinned in `package.json`). The page-level description, the model pipeline and the owner settings are in [docs/SAWAD.md](../../../docs/SAWAD.md).

**Two site plans.** Zaitun Hills is drawn on the 28 ha masterplan (the `plan…` half of `layout.ts`, drawing in `docs/zaitun/masterplan.svg`) with its own baked model and runtime-placed plants, people, cars and birds. Bustan Dijla and Shatt Gardens stay on the 7 ha layout until they inherit the new one. `site.ts` is the switch: everything that asks "where" (ground height, the stream, markers, the orbit pivot) goes through `siteFor(variant)`, and `usesPlan(variant)` picks the 28 ha branch elsewhere.

## How it is put together

```
SceneViewport.tsx     the only component pages use: poster, capability gate, buttons, status
└─ SceneCanvas.tsx    the <Canvas>: renderer settings per quality tier, frame loop on/off   (lazy chunk)
   └─ SceneRoot.tsx   everything inside the canvas, plus the render pass
      ├─ SceneWorld.tsx       haze, sky, lights, terrain, water, planting, life, buildings
      │  ├─ SceneVegetation.tsx  28 ha plan: olives, palms, citrus, hedges, grass from the plant library
      │  └─ SceneLife.tsx        28 ha plan: people, cars and birds from the life library
      ├─ SceneMarkers.tsx     one status marker per home (explorer only)
      ├─ CameraRig.tsx        film camera, orbit controls, flights, zoom and reset
      └─ useCompoundModel.ts  loads the baked model (and, on the plan, the two libraries) and decides when the first frame may show
```

Plain modules with no React in them:

| File | What it holds |
| --- | --- |
| `layout.ts` | Where everything is. The single source of truth for both site plans (track 0 owns it). |
| `site.ts` | The plan a variant is drawn on: ground, stream, markers, bounds, orbit pivot. |
| `landscape.ts` | Where every plant stands and the routes people, cars and birds follow on the 28 ha plan (track 3B), with the LOD table and triangle budget. |
| `world.ts` | Factories for the procedural world (sky, terrain, water, palms, trees, fallback buildings), the palette, sun and haze settings. Dispatches to `planWorld.ts` for the 28 ha plan. |
| `planWorld.ts` | The 28 ha ground (a grid laid out so it never rises above the model's roads and steps), the stream and the pool water. |
| `vegetation.ts` | Instancing the plant library: one InstancedMesh per species, level and primitive, re-sorted by distance and view cone as the camera moves. |
| `lifeMotion.ts` | Maths for people, cars and birds: clip speed, poses along routes, wheel spin, wing beats. |
| `useTimedAsset.ts` | The load-or-give-up rule every baked asset follows: the first frame waits up to 8 s, a late asset is freed. |
| `markers.ts` | Marker drawing, materials, size, draw order and picking. |
| `viewpoints.ts` | The four named views, the film path and easing. |
| `flight.ts` | Explorer camera maths: flight arc, zoom step, marker framing, orbit limits. |
| `compoundModel.ts` | Loading the baked `.glb` (KTX2 + meshopt), shadows, disposal. |
| `capability.ts` | Whether a device gets 3D at all, and which quality tier. |

## Behaviours and where they live

| Behaviour | Where |
| --- | --- |
| The poster paints first; the 3D code is a separate chunk fetched only on a capable device | `SceneViewport.tsx` (`next/dynamic`, `ssr: false`) |
| No 3D on weak devices, with Save-Data, on slow connections, or for the film under reduced motion | `capability.ts` |
| On phones the finder waits for a tap on "Show the 3D view" | `autoLoad` in `SceneViewport.tsx` |
| Nothing is drawn until the model is in, so the poster hands over to the finished compound | `SceneCanvas.tsx` holds the frame loop at `never` until `SceneRoot` reports ready |
| Model missing, or not ready after 8 seconds: procedural buildings, reported as `sawad-scene`; a late model is freed, never swapped in | `useTimedAsset.ts`, `useCompoundModel.ts`, `Architecture` in `SceneWorld.tsx` |
| 28 ha plan: the first frame also waits for the plant and life libraries; no plant library means procedural trees at the same spots, no life library means no people | `useSceneLibrary` in `useCompoundModel.ts`, `Planting` in `SceneWorld.tsx` |
| Orbiting camera never goes into the ground (the foothills rise 60 m) | `keepAboveGround` in `flight.ts`, `CameraRig.tsx` |
| A failed start, a failed draw or a lost WebGL context: reported as `SceneViewport`, back to the poster | `RenderPass` in `SceneRoot.tsx`, the error boundary in `SceneViewport.tsx` |
| Paused, offscreen or in a hidden tab: no frames are drawn | `playing` in `SceneCanvas.tsx` (frame loop `demand`) |
| The film holds its opening shot (the poster frame), then circles the compound, shifted clear of the headline (mirrored in Arabic) | `CameraRig.tsx`, `viewpoints.ts` |
| Explorer: damped orbit that cannot leave the site or go underground, eased flights, a press interrupts a flight | `CameraRig.tsx`, `flight.ts` |
| Status markers by shape and colour; selection is an ink ring, never brass; a drag is not a click | `markers.ts`, `SceneMarkers.tsx` |
| The canvas is hidden from screen readers; the residence list is the accessible route | `SceneViewport.tsx` |
| Capture mode for stills (`?capture=1`, development only) | `SceneViewport.tsx`, `scripts/render-scene-stills.mjs` |

## Working on it

- **Three.js objects are mutated in helpers, not in components.** The lint rules forbid writing to values that come from hooks. Camera, scene and material writes therefore sit in small module-level functions (`applyPose`, `setSceneEnvironment`, `advanceTime`, `setCursor`).
- **Whoever creates a resource frees it.** Parts built by the factories in `world.ts` are mounted with `<primitive>` and disposed by the component that built them. The baked model belongs to `useCompoundModel`.
- **`RenderPass` owns the draw call** (`useFrame` at priority 1). A post-processing composer must replace that draw, not add a second one.
- **Frame time is clamped to 0.1 s** (`MAX_FRAME_SECONDS`), so a stalled tab resumes without a jump. Animate from the frame delta, not from the wall clock.
- **To swap one part of the world**, replace its component in `SceneWorld.tsx`. Each part (sky, terrain, water, planting, life, buildings) is independent.
- **Libraries are shared, never mutated per mount.** `prepareVegetationLibrary` bakes the plant geometry and patches the wind once per loaded library and keeps the wind on it; components create instances and clones and free only those. The loader frees the library.
- **Frame order:** the camera rig moves the camera (priority 0), the plants re-sort for it (0.5), the render pass draws (1).

## Tests

Every file has its test beside it. Components inside the canvas are tested with `@react-three/test-renderer`: it mounts the React Three Fiber tree on a stand-in WebGL context and steps the frame loop by hand.

```sh
npx vitest run components/sawad/scene
npm run check
```

Two things to know when writing these tests:

- The test renderer cannot draw. Tests that reach `gl.render` replace it with a spy (see `SceneRoot.test.tsx`), and PMREM is stubbed (see `SceneWorld.test.tsx`).
- React Three Fiber is loaded as CommonJS in tests while the scene code imports three as an ES module, so two copies of three exist in the test process. Pass arrays (not `Vector3` instances) as JSX props, and compare objects by flags such as `isMesh`, not with `instanceof`.

After changing how the scene looks, re-render the stills with `node scripts/render-scene-stills.mjs`. Zaitun Hills' four posters must be framed from the 28 ha viewpoints in `viewpoints.ts` (track 5B renders the final ones in Cycles).
