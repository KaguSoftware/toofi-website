# The Zaitun Hills experience

The showcase on Home: an opening shot that plays by itself, a scroll-driven tour of five stops with bilingual captions, then free exploring (orbit, walk, clickable homes, day and dusk, sound). The opening and the tour are video, "the reel", recorded from the live scene; the live scene itself, built on [`../scene/`](../scene/README.md), is fetched only when a visitor asks to explore. It adds nothing to the scene folder: the world, the model loading and the capability rules are imported from there.

Stack, all pinned in `package.json`: React Three Fiber 9.8, `@react-three/postprocessing` 3.2 on `postprocessing` 6.39, Theatre.js core 0.7 (camera keyframes; Studio is a dev dependency), GSAP 3.15 with ScrollTrigger and `@gsap/react` 2.1. The reel needs none of them except GSAP.

## What a visitor gets

| Visitor | What they see |
| --- | --- |
| No JavaScript, Save-Data, a 2g link, or the owner setting `tweaks.experience = explorer` | The stills: the poster behind the hero, then one full-screen still per stop with its caption. This is also what the server renders, so nothing shifts when the page hydrates. |
| Nearly everyone else, whatever the GPU or the memory | The reel on top of the same markup: the stage stays put while the page scrolls, the opening plays under a letterbox, the scroll moves the picture from stop to stop. No 3D code, model or WebGL context is involved. |
| The same visitor pressing "Explore" | The live 3D scene, fetched then, opening on the shot the reel was showing: orbit, walk, the homes, day and dusk. "Back" lets the scene go and returns to the reel. |
| A link the browser reports as 3g, under 4 GB of memory, or under 4 threads | The reel, and an Explore button that names the download ("Load the 3D tour (about 3.6 MB)"). |
| No WebGL2, or a software renderer | The reel without an Explore button. |
| Reduced motion | The stills, plus an "Explore in 3D" button. Nothing moves unasked: the explorer opens on request and only the visitor moves the camera (flights become cuts). |
| A browser that will not play video unasked (iOS in Low Power Mode) | The poster until the first touch, then the reel. |
| Anyone whose browser takes the GPU context away while exploring (it happens to tabs in the background) | The reel comes back with a note; Explore starts the scene again. Reported once, with `severity: "warning"`. |
| A device that stays under 20 frames a second at its tier's lowest level for ten seconds while exploring (high tier only, see `monitor.ts`) | The reel, without the Explore button, for the rest of the visit. |
| A reel that fails to play in every codec | The stills, with the "Explore in 3D" button where the device can draw the scene. Reported as `StoryReel`. |
| An editor in edit mode | The stills, so every caption is on the page and can be edited. |

The reel and the canvas are hidden from assistive technology. The captions, in document order, are the story; the link under the last caption leads to the residence finder, which stays the accessible way through the homes.

## How it is put together

```
ZaitunExperience.tsx   the only component a page uses: stills, capability, the stage, state
├─ StoryReel.tsx       the story as video: the opening plays, the scroll seeks the tour
├─ ExperienceHud.tsx   controls: pause, sound, explore; back, orbit or walk, zoom, day or dusk
├─ UnitPanel.tsx       the home that was clicked: type, size, status, price, links
├─ Joystick.tsx        touch stick for walk mode
├─ StoryScroll.tsx     GSAP ScrollTrigger: scroll progress and caption fades        (lazy chunk)
└─ ExperienceCanvas.tsx   the <Canvas> and the quality level                        (lazy chunk, after three.js; on "Explore" only)
   └─ ExperienceRoot.tsx  everything inside the canvas, the frame-rate monitor and the render pass
      ├─ ExperienceWorld.tsx  the scene's world + day and dusk + light shafts
      ├─ StoryRig.tsx         the camera: orbit, walk, flights between them; the story, for recording
      ├─ UnitTargets.tsx      the homes as click targets, hover and selection veils
      ├─ ReelCapture.tsx      development only: draws the reel's frames when the capture script asks
      └─ PostFX.tsx           the effect chain                                      (lazy chunk)
```

The 3D code arrives as three chunks that are evaluated one after another, so no single task is long: three.js, then the canvas with the scene, then the effect chain (`loadPostFX` in `ExperienceRoot.tsx`). The explorer's first frame waits for all three. None of it is asked for until a visitor presses "Explore".

Plain modules:

| File | What it holds |
| --- | --- |
| `reel.ts` | The reel's timeline and files: how long the opening is, where a sequence position is in the tour file, the two shapes (wide, tall) and their addresses. Safe to import on the page side. |
| `beats.ts` | The timeline without geometry: the five stops, the scroll-to-sequence mapping, the playhead easing. Safe to import on the page side. |
| `story.ts` | The camera keys, placed from `layout.ts`: four openings (one per start view) and the scroll path. |
| `storySheet.ts` | The keys as a Theatre.js sheet; `storyPose(view, position)` is what the rig plays. |
| `story.theatre.json` | `null`, or a state exported from Theatre Studio (see below). |
| `early.ts` | What runs before any of this code has arrived: an inline script after the reel's video elements that decides as `capability.ts` `playsReel` does, gives the opening its file and plays it, and keeps the stills from being fetched where the reel is coming. Also the explorer's first files (preloaded when it is asked for) and the download sizes named on its button. |
| `compileAhead.ts` | Shader programs made ready before the frame that needs them: `compileAhead` (a dry frame handed to `compileAsync`) and `warmUp` (first uses spread over hidden frames). Both take a `draw` function, so they work for any effect chain. |
| `monitor.ts` | The frame-rate monitor behind the quality levels: when to step down or up, cooldowns for a level that failed, and when to give up. |
| `quality.ts` | The four quality levels and which effects each runs. |
| `daylight.ts` | The dusk look and the control that blends the live scene toward it. |
| `lightmaps.ts` | The baked ground page from track 4, projected top-down onto the terrain at dusk (the model's own `buildings` and `site` pages are in `../scene/bakedLight.ts`). |
| `practicals.ts` | Windows and lamps found in the model; windows glow room by room. |
| `godrays.ts` | Light-shaft planes through the palms. |
| `walk.ts` | Walk mode: movement, collisions, where a walk starts. |
| `units.ts` | The homes as boxes for clicking and highlighting. |
| `audio.ts` | The sound: ambience synthesised with Web Audio, and the music bed (one streamed file). |
| `links.ts` | The link from a home to the residence finder. |

## The story

The story is one Theatre.js sequence, 86 units long (`beats.ts`). Visitors see it as the reel; the live camera plays it only when the reel is recorded (see "The reel" below), so what follows describes both.

- **0 to 14, the opening.** Holds still on its poster frame for 2 seconds (`INTRO_HOLD_SECONDS`), then plays by the clock under a 2.39:1 letterbox, which opens at the visitor's first scroll, key or touch. Each owner start view (`tweaks.startView`) has its own opening: it starts on that view's poster frame and ends outside the main gate. A scroll during the opening cuts to the tour (the reel) or fast-forwards the live camera along its path (a recording).
- **14 to 86, the tour.** Follows the scroll: entrance, boulevard, courtyard villa (home ZH-V05), garden and amenities, aerial. Each stop's panel adds one fifth to the progress as it rises to fill the screen. The camera stays with the captions: the playhead closes on the scroll with momentum (`glide` in `beats.ts`): it eases away, and after the visitor stops it slows along a curve for about a second to a stop, which smooths wheel notches too; the recording's live camera uses the plainer `approach` (a flick through the whole tour is caught up within about two seconds), always gliding along the authored path, never jumping. Only one caption shows at a time, however fast the scroll. The last stop holds the final aerial for almost half a screen more; its caption leaves just before the stage does.
- **A visitor who stays at the top**: the reel rests on the gate. (The live story drifted into the scene's slow circuit after five seconds, `tourPose` in `../scene/viewpoints.ts`; the reel does not record it.)

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
- `TEXCOORD_2` and the node names of single copies, for the baked light (`../scene/bakedLight.ts`); without them the model shows on real-time light;
- materials named `site-atlas` and `garden-atlas` for ground-level surfaces, which take the projected ground page at dusk only where the model has no baked `site` page.

## The poster handover

The poster is a Cycles frame (track 5B): its sun is a lamp the camera cannot see, its sky reads brighter, its vignette is lighter and the stream shows a narrow streak where the web scene glitters. So the story's live scene takes over dressed as the poster (no sun disc, sky lifted, light vignette, calm water: `HANDOVER` in `daylight.ts`), holds that for the 2 seconds the opening camera holds still (the poster's fade takes 0.9 of them), then settles into its own look over 3.5 s as the camera starts to move. A capture, or an explorer opened on request, starts in the live look. Asking for dusk during the settle finishes it first.

To check a handover: `?story=0&view=<flight|street|terrace|aerial>` (development only) holds that start view's opening on its first frame over its own poster.

## Day and dusk

The day look is the scene's own, lit by the baked day lightmaps that load with the model. The first request for dusk captures the day values from the live scene and blends over five seconds: the sun sinks five degrees under the horizon, sky, haze, lights, water and exposure follow, then windows and lamps come on. The model's baked dusk pages (lamp pools, window spill, the dusk sky on every wall) and the terrain's dusk ground page are fetched on that first request only and blend in with the sky.

## Sound and music

The sound button plays two things. The ambience (wind, the stream, birds by day, crickets at dusk) is synthesised, follows where the camera is, and downloads nothing. Under the music it is held at half the music's loudness (`AMBIENCE_VS_MUSIC` in `audio.ts`, measured with two analysers five times a second, so it rises and falls with the piece: the wind and the stream are filtered noise, which at a fixed level sounded like surf over the quiet opening; set it to 0 for the music alone); with no music, or if the music file fails, it plays in full. The music bed is one file, `public/sawad/audio/with-these-hands.m4a` (AAC at 96 kbps, 3.7 MB, encoded from the WAV master), streamed by an `<audio>` element and looped. Nothing is fetched until the visitor turns the sound on; switching it off pauses the piece, and it picks up from the same place.

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

`?level=0..3` (development only) pins the level, to measure frame times without the monitor moving it.

The monitor (`monitor.ts`) judges 2.5 s windows of frame-rate samples against `fpsBounds` in `quality.ts`. Mostly under the lower bound steps down; mostly over the upper bound steps up, unless that level failed recently: a failed level waits a minute before it is tried again, and twice as long each time it fails again (up to ten minutes). It never stops watching, so a device that heats up minutes in is stepped down and comes back when it cools. Frame rates are measured over whole frame intervals, so the bounds mean what they say (drei's monitor read 60 fps as 64).

The render pass in `ExperienceRoot.tsx` owns the draw call (the composer is built with `enabled={false}`), so a failed frame is caught, reported as `ZaitunExperience`, and the page falls back to the stills. A lost context is not a failure: see the table at the top.

### Before the first frame

Nothing is drawn to the screen until the scene's shaders are ready. While the poster is up and the model downloads, `ExperienceRoot` compiles whatever has arrived in the background (`compileAhead`), then spreads each program's first use over a few hidden frames (`warmUp`), and only then lets the frame loop start. Both run one frame of the real loop at a standstill (`advance(0)`), so the scene is in the state its own code keeps it in. Left alone, every program was linked inside the first frame, on the main thread: 0.3 s when the system had the shaders cached and over 4 s on a first-ever visit. A change of effect chain (a quality step) can use the same two helpers with its own `draw`.

### A page Next keeps hidden

Next keeps the page it navigates away from, hidden in React Activity, and shows it again on the way back. React Three Fiber's loop runs outside React and no prop reaches a hidden canvas, so `ZaitunExperience` pauses the scene from a layout effect's cleanup (`ExperienceControl`, implemented by `sceneControl` in `ExperienceRoot.tsx`) and resumes it when the page is shown again. The sound is stopped the same way and picks up where it was; it is closed only once the page has left the document.

## The reel

`public/sawad/reel/` holds ten clips in three codecs (30 files), 30 frames a second, no audio, with a content hash in each name (`reelSources()` in `reel.ts` gives the address):

- `zaitun-opening-<flight|street|terrace|aerial>-<wide|tall>.mp4`: the 16-second opening for each owner start view. The clock plays it. It has a key frame every 60 frames.
- `zaitun-tour-<wide|tall>.mp4`: the tour, 1,441 frames (48 seconds, twenty frames for each sequence second; the plants stand still in it, because the scroll plays it backwards too). It is never played, only sought by the scroll, so it has a key frame every 20 frames, and all its frames are of one quality (`flat` in `ENCODE`): ordinary settings make the colour jump at every key frame. Its first frame is the frame every opening ends on.
- The codec is in the name: `-av1`, `-hevc`, and no suffix for H.264. The opening is played in the first of those the browser says it "probably" plays (`playableCodecs`; the early script asks the same question); the tour prefers HEVC, then AV1 (`TOUR_CODECS`). A file that fails all the same is replaced by the next codec and reported as a warning; only H.264 failing ends the reel and brings the stills back.
- Wide is 1920 x 1080. Tall is 720 x 1280, the middle strip of the wide frame, for screens taller than they are wide (`reelShape`).

Every frame is drawn by the live scene in its capture mode (`ReelCapture.tsx`, `/?reel=1&view=<view>`), at 3840 x 2160, with every plant at its finest level (`SceneDetail` context "max" in `../scene/SceneVegetation.tsx`; it applies to the capture only). Nothing changes detail as the camera comes closer, and two recordings of the same frame are byte-identical.

To record again:

```sh
npm run dev:lan                                        # capture mode is development-only; use localhost
pnpm install --dir scripts/perf --ignore-workspace     # once
node scripts/render-story-reel.mjs http://localhost:3000 [--views flight,street] [--codecs av1,hevc] [--no-tour] [--encode-only] [--no-encode]
node scripts/blender/version-assets.mjs                # the content hashes in the file names
```

Frames go to `scripts/blender/out/reel/frames/` (not in git); a stopped run resumes. ffmpeg with libsvtav1, libx265 and libx264 must be on the PATH (or set `FFMPEG`). The encode settings are `ENCODE` and `codecArgs` in the script. VMAF, wide: the AV1 flight opening 90; the tour 90 in HEVC and AV1, 85 in H.264. Change them there.

Record the reel again after any change to the story camera (`story.ts`, or `story.theatre.json`), to the scene's look (light, sky, water, plants, the dusk settle) or to the model. Until then the reel shows the old world and the explorer the new one. `story.test.ts` does not see the difference.

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
