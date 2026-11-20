# The Zaitun Hills experience

The showcase on Home: an opening shot that plays by itself, a scroll-driven tour of five stops with bilingual captions, then free exploring (orbit, walk, clickable homes, day and dusk, sound). It is built on the scene in [`../scene/`](../scene/README.md) and adds nothing to it: the world, the model loading and the capability rules are imported from there unchanged.

Stack, all pinned in `package.json`: React Three Fiber 9.8, `@react-three/postprocessing` 3.2 on `postprocessing` 6.39, `@react-three/drei` 10.7 (the performance monitor only), Theatre.js core 0.7 (camera keyframes; Studio is a dev dependency), GSAP 3.15 with ScrollTrigger and `@gsap/react` 2.1.

## What a visitor gets

| Visitor | What they see |
| --- | --- |
| No JavaScript, a weak device, Save-Data, a slow connection, or the owner setting `tweaks.experience = explorer` | The stills: the poster behind the hero, then one full-screen still per stop with its caption. This is also what the server renders, so nothing shifts when the page hydrates. |
| A capable device | The live story on top of the same markup: the stage stays put while the page scrolls. |
| A capable device with reduced motion | The stills, plus an "Explore in 3D" button. Nothing moves unasked: the explorer opens on request and only the visitor moves the camera (flights become cuts). |
| An editor in edit mode | The stills, so every caption is on the page and can be edited. |

The canvas is hidden from assistive technology. The captions, in document order, are the story; the link under the last caption leads to the residence finder, which stays the accessible way through the homes.

## How it is put together

```
ZaitunExperience.tsx   the only component a page uses: stills, capability, the stage, state
├─ ExperienceHud.tsx   controls: pause, day or dusk, sound, explore; back, orbit or walk, zoom
├─ UnitPanel.tsx       the home that was clicked: type, size, status, price, links
├─ Joystick.tsx        touch stick for walk mode
├─ StoryScroll.tsx     GSAP ScrollTrigger: scroll progress and caption fades        (lazy chunk)
└─ ExperienceCanvas.tsx   the <Canvas> and the quality level                        (lazy chunk)
   └─ ExperienceRoot.tsx  everything inside the canvas, and the render pass
      ├─ ExperienceWorld.tsx  the scene's world + day and dusk + light shafts
      ├─ StoryRig.tsx         the camera: story, orbit, walk, flights between them
      ├─ UnitTargets.tsx      the homes as click targets, hover and selection veils
      └─ PostFX.tsx           the effect chain
```

Plain modules:

| File | What it holds |
| --- | --- |
| `beats.ts` | The timeline without geometry: the five stops, the scroll-to-sequence mapping, the playhead easing. Safe to import on the page side. |
| `story.ts` | The camera keys, placed from `layout.ts`: four openings (one per start view) and the scroll path. |
| `storySheet.ts` | The keys as a Theatre.js sheet; `storyPose(view, position)` is what the rig plays. |
| `story.theatre.json` | `null`, or a state exported from Theatre Studio (see below). |
| `quality.ts` | The four quality levels and which effects each runs. |
| `daylight.ts` | The dusk look and the control that blends the live scene toward it. |
| `lightmaps.ts` | The baked ground light from track 4, projected top-down and blended in at dusk. |
| `practicals.ts` | Windows and lamps found in the model; windows glow room by room. |
| `godrays.ts` | Light-shaft planes through the palms. |
| `walk.ts` | Walk mode: movement, collisions, where a walk starts. |
| `units.ts` | The homes as boxes for clicking and highlighting. |
| `audio.ts` | The sound: ambience synthesised with Web Audio, and the music bed (one streamed file). |
| `links.ts` | The link from a home to the residence finder. |

## The story

The camera plays one Theatre.js sequence, 86 units long (`beats.ts`):

- **0 to 14, the opening.** Plays by the clock under a 2.39:1 letterbox, which opens at the visitor's first scroll, key or touch. Each owner start view (`tweaks.startView`) has its own opening: it starts on that view's poster frame and ends outside the main gate. A scroll during the opening fast-forwards it along its path.
- **14 to 86, the tour.** Follows the scroll: entrance, boulevard, courtyard villa (home ZH-V05), garden and amenities, aerial. Each stop's panel adds one fifth to the progress as it rises to fill the screen. The playhead eases toward the scroll and has a top speed, so a flung scroll becomes a glide along the authored path, never a jump.
- **A visitor who stays at the top** and does nothing for five seconds after the opening gets the scene's slow circuit (`tourPose` in `../scene/viewpoints.ts`); the first scroll brings the camera back.

`story.test.ts` flies the whole sequence and fails if the camera passes through the ground, a building, a lamp or a tree crown, pans faster than 32 degrees per sequence second, or fails to ease into a resting frame.

### Editing the camera in Theatre.js

The keys live in `story.ts` as typed poses built from `layout.ts`, and are converted to a Theatre project state at run time. To change a shot, either edit the key in `story.ts`, or use Studio:

1. Run the site in development and open Home with `?studio=1`. Theatre Studio opens over the page on the story sheet. Studio never ships: `@theatre/studio` is a dev dependency, and both the switch and `openStoryStudio` do nothing in production.
2. The sheet "Story" has five objects: `Story camera` (the tour) and `Intro flight`, `Intro street`, `Intro terrace`, `Intro aerial`. Each animates `position`, `target`, `fov`, `focus` (metres to the subject) and `blur` (0 to 1).
3. Export the project from Studio and save the file as `story.theatre.json`. From then on that state is what plays, and the keys in `story.ts` are only the seed. Put `null` back in the file to return to them.
4. Run `npx vitest run components/sawad/experience/story.test.ts`. It checks whatever the sheet plays.

Captions and their numbers are separate from the camera: the text is in `lib/sawad/i18n.ts` (`showcase`, English and Arabic) and editable inline on the page (`showcase.<stop>.eyebrow`, `.title`, `.body`); the numbers come from `lib/sawad/data.ts` and `layout.ts` through `lib/sawad/format.ts` (`beatFigures` in `templates/home.tsx`).

## Updating the homes

The explorer shows the same sample homes as the residence finder: `residencesIn("zaitun-hills")` from `lib/sawad/data.ts`. Change a price, a status or the type mix there and both follow. A home's click target and marker come from its `slot` on the masterplan (`layout.ts`, track 0), so homes and plots stay matched one for one; `data.test.ts` checks that.

## Swapping the model

Nothing here names a model file. The compound, plants and life load through `useCompoundModel` and `useSceneLibrary` from the scene folder, on its terms (the first frame waits for them; after 8 seconds the procedural compound shows and the error is reported as `sawad-scene`). To ship a new model, replace the files in `public/sawad/models/` as described in `docs/SAWAD.md`. What this folder expects of the model:

- materials named `glass` (windows that light up at dusk) and `lamp-glow` (lamp heads and fittings);
- materials named `site-atlas` and `garden-atlas` for ground-level surfaces, which receive the baked ground light;
- when the model gains `TEXCOORD_2` (the final export, track 6B), wire the `buildings` and `site` lightmap pages through `material.lightMap` as `docs/zaitun/LIGHTING.md` describes; `lightmaps.ts` says where.

## Day and dusk

By day nothing is touched, so frames keep matching the scene and its posters. The first request for dusk captures the day values from the live scene and blends over five seconds: the sun sinks five degrees under the horizon, sky, haze, lights, water and exposure follow, then windows and lamps come on and the baked dusk ground page (lamp pools, pool lights, window spill) fades in. That page is fetched on that first request only.

## Sound and music

The sound button starts two things. The ambience (wind, the stream, birds by day, crickets at dusk) is synthesised, follows where the camera is, and downloads nothing. The music bed is one file, `public/sawad/audio/with-these-hands.mp3` (4.5 MB), streamed by an `<audio>` element and looped. Nothing is fetched until the visitor turns the sound on; switching it off pauses the piece, and it picks up from the same place.

The piece is "With These Hands" by Scott Buckley, from https://www.scottbuckley.com.au/library/with-these-hands/, licensed CC BY 4.0: free to use, commercially too, as long as he is credited. So:

- The credit shows under the controls whenever the sound is on (`showcase.musicCredit` in `lib/sawad/i18n.ts`, English and Arabic). Do not remove it while this piece plays.
- The file is the whole piece as released, only re-encoded (`ffmpeg -i WithTheseHands.mp3 -c:a libmp3lame -q:a 5`), not cut or re-levelled. If you edit it, the licence asks you to say so in the credit.
- A film that uses it on YouTube must carry the credit in the video description.

To change the music, replace the file, then update `MUSIC_BED` in `audio.ts` and the credit text. `MUSIC_GAIN` sets its level against the ambience. If the file fails to load, the error is reported as `ZaitunExperience` (stage `music`) and the ambience plays on without it.

## Quality

`capability.ts` in the scene folder still decides whether a device gets 3D and which model tier. Within a tier the frame rate moves the experience between levels (`quality.ts`):

| Level | Pixel ratio | Runs | Used by |
| --- | --- | --- | --- |
| 0 | 1 | bloom, vignette, grain | low tier (phones), start |
| 1 | 1.25 | + edge smoothing, light shafts | low tier at most; high tier at least |
| 2 | 1.5 | + depth of field | high tier, start |
| 3 | 1.75 | + ambient occlusion | high tier with headroom |

The render pass in `ExperienceRoot.tsx` owns the draw call (the composer is built with `enabled={false}`), so a failed frame or a lost context is caught, reported as `ZaitunExperience`, and the page falls back to the stills.

## Stills

`public/sawad/story/zaitun-<stop>.jpg` are rendered from the live experience:

```sh
npm run dev:lan                    # capture mode is development-only; use localhost
node scripts/render-story-stills.mjs http://localhost:3000
```

`?story=<position>` holds the story at a sequence position and hides the controls; `&dusk=1` renders it at dusk. The opening poster is the scene's own poster for the start view (`public/sawad/scene-zaitun-<view>.jpg`).

## Tests

Every file has its test beside it. The in-canvas components use `@react-three/test-renderer` with the same caveats as the scene (it cannot draw; two copies of three live in the test process).

```sh
npx vitest run components/sawad/experience
npm run check
```
