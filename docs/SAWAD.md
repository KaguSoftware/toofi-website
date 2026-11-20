# Sawad Holding site

A bilingual (English and Arabic) demo site for a fictional developer of gated garden compounds in Baghdad, Erbil and Basra. Every company fact, home and price is sample content.

## Pages

Each page exists twice: English at `/…` and Arabic at `/ar/…`. They are separate CMS pages that share one template. The template reads the locale from the slug.

| Page | English | Arabic | Template |
| --- | --- | --- | --- |
| Home | `/` | `/ar` | `home` |
| Find a residence | `/residences` | `/ar/residences` | `residences` |
| Compounds | `/compounds` | `/ar/compounds` | `compounds` |
| What we do | `/what-we-do` | `/ar/what-we-do` | `what-we-do` |
| Our story | `/our-story` | `/ar/our-story` | `story` |
| Contact | `/contact` | `/ar/contact` | `contact` |

## Where content lives

| What | File | Editable inline |
| --- | --- | --- |
| Headlines, intros and section titles | Template fallbacks from `lib/sawad/i18n.ts` | Yes, per page and per language |
| Header and footer text | Global blocks; Arabic keys start with `ar.` | Yes |
| Compounds, residence types, the 96 homes, prices, galleries | `lib/sawad/data.ts` | No (sample data) |
| Operations, buying steps, partners, timeline, principles, leadership | `lib/sawad/content.ts` | No |

Arabic pages use Arabic-Indic digits (٠–٩) everywhere, through `lib/sawad/format.ts`, which also handles Arabic plural forms.

## Owner settings (Tweaks)

Sign in as an editor and open Home or Find a residence in edit mode. A "Site settings" strip appears that visitors never see:

- `tweaks.experience`: `both` (default), `film` (no interactive scene in the finder) or `explorer` (the Zaitun Hills tour on Home is shown as stills instead of the live scene).
- `tweaks.startView`: `flight` (default), `street`, `terrace` or `aerial`. This is the opening shot of the tour on Home (it matches the poster). The camera then travels to the main gate in about 14 seconds, and the scroll takes it from there. A visitor who does not scroll gets one slow circuit of the compound every four minutes.

Typos fall back to the default.

## The Zaitun Hills experience (Home)

Home opens on Zaitun Hills, the showcase compound: an opening shot under a letterbox, a scroll-driven tour of five stops (entrance, boulevard, courtyard villa, garden and amenities, aerial) with captions in English and Arabic, then free exploring: orbit, walk (arrow keys or a touch joystick), clickable homes with a details panel, a day and dusk switch, and ambient sound (off until asked for). It lives in `components/sawad/experience/`; its [README](../components/sawad/experience/README.md) covers updating the homes, editing the camera in Theatre.js, swapping the model, the quality levels and the stills.

- Captions: `showcase` in `lib/sawad/i18n.ts`, editable inline (`showcase.<stop>.eyebrow`, `.title`, `.body`). Numbers come from `lib/sawad/data.ts` and the masterplan.
- Visitors without 3D (no JavaScript, weak devices, Save-Data, slow connections) and editors in edit mode see the tour as stills with the same captions. With reduced motion nothing moves unasked: the stills, plus a button that opens the explorer.
- Stills: `public/sawad/story/`, rendered with `node scripts/render-story-stills.mjs` (instructions are in the file).

## The 3D scene

The scene lives in `components/sawad/scene/` and uses three.js with React Three Fiber. The residence finder shows it as an explorer; the Home experience above is built on the same world. Its film mode (a slow flight around the compound, `tourPose` in `viewpoints.ts`) is what the Home experience falls into for a visitor who does not scroll. It loads only after a still poster has painted. It does not load at all on weak devices, with Save-Data on, on slow connections, or for film under reduced motion. On phones the finder waits for a tap on "Show the 3D view". The residence list is always the accessible way through the homes, and the 3D canvas is hidden from screen readers.

Status is shown by shape as well as colour, in the scene, the legend and the list: available is a filled disc, reserved a half-filled ring, sold a grey disc with a cross. Brass is never used for status or selection.

The stills in `public/sawad` are rendered from the scene. After changing the scene, re-render them with `node scripts/render-scene-stills.mjs` (instructions are in the file).

### The architecture model

The buildings, walls, gates, boulevards and lamps are a baked model made in Blender. Everything else is still built in code: the terrain, river, sky, palms, trees and markers.

| Tier | File | Trim sheet | Ambient occlusion | Budget |
| --- | --- | --- | --- | --- |
| High | `public/sawad/models/compound-high.glb` | 2048 | 1024 per building type | 5 MB |
| Low (phones, small or weak devices) | `public/sawad/models/compound-low.glb` | 1024 | 512 | 2 MB |

The low tier has no bevels, window trims, mashrabiya screens or benches.

How it loads (`compoundModel.ts`, `engine.ts`):

- The engine starts loading the model as soon as it is created.
- The first frame waits until the model is in, so the poster hands over to the finished compound with no pop.
- If the model fails to load, or is not ready after 8 seconds, the procedural boxes in `world.ts` (`buildArchitecture`) are shown instead and the error is reported as `sawad-scene`.
- Textures are KTX2. The transcoder lives in `public/sawad/basis/`, copied from `three/examples/jsm/libs/basis/`.
- Glass, brass and pools reflect the golden-hour sky through an environment map, which is prefiltered once from the sky shader without the sun disc.
- `ENVIRONMENT_INTENSITY` in `world.ts` is tuned so the frames keep the brightness of the original posters.

**Rebuilding the model.** `layout.ts` stays the single source of truth. After changing it, or anything in `scripts/blender/`, run:

```sh
scripts/blender/build.sh
```

You need Blender 4.2 or later (`brew install --cask blender`) and KTX-Software's `ktx` CLI 4.3 or later ([releases](https://github.com/KhronosGroup/KTX-Software/releases)). The script runs these steps:

1. `node scripts/export-scene-layout.mjs` writes `scripts/blender/layout.json` from `layout.ts`.
2. `scripts/blender/fetch_textures.sh` downloads the CC0 source textures. They are git-ignored.
3. Blender runs headless, once per tier: `Blender -b --factory-startup -P scripts/blender/build_compound.py -- --tier high|low`. The script models every asset once, builds the trim sheet and bakes ambient occlusion only (no sun), so one model serves all three compounds.
4. `npx @gltf-transform/cli optimize` applies meshopt, KTX2 and GPU instancing, then writes the two `.glb` files.
5. `scripts/blender/finalize-manifest.mjs` writes `compound.manifest.json` (villa positions, palette check, file sizes) and fails if a file is over budget.

`compoundModel.manifest.test.ts` checks the shipped files against `layout.ts` (every villa within 5 cm of its plot), the budgets and the scene palette. Never hand-edit a `.blend` file: `build_compound.py` is the source. Re-render the posters afterwards.

Texture sources (all CC0):

| Use | Source |
| --- | --- |
| Plaster | [Poly Haven: white_stucco](https://polyhaven.com/a/white_stucco) |
| Timber | [Poly Haven: fine_grained_wood](https://polyhaven.com/a/fine_grained_wood) |
| Limestone coping, slabs and plinths | [ambientCG: Travertine009](https://ambientcg.com/view?id=Travertine009) |
| Stone paving | [ambientCG: PavingStones128](https://ambientcg.com/view?id=PavingStones128) |
| Pool mosaic | [ambientCG: Tiles070](https://ambientcg.com/view?id=Tiles070) |

The hedge leaves and the mashrabiya lattice are generated in the build script. Each texture is tinted so its average colour equals the palette in `world.ts`.

## Before launch

- [ ] Replace the Sawad Holding placeholder name, then rename `sawad_*` cookies and env vars if needed
- [ ] Replace the company history, compounds, figures, residence availability and guide prices (`lib/sawad/*`)
- [ ] Add leadership names (`LEADERSHIP` in `lib/sawad/content.ts`)
- [ ] Add sales gallery phone numbers and confirm addresses and hours (`GALLERIES` in `lib/sawad/data.ts`)
- [ ] Connect the enquiry form (`components/sawad/ContactForm.tsx`). Until then it says plainly that nothing was sent.
- [ ] Replace the rendered stills with architectural renders or photos
- [ ] Test 3D performance on typical phones and laptops in Iraq
