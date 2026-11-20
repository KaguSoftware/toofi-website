# Zaitun Hills film, stills and posters (track 5B)

The Cycles film, the 15 s vertical cut, the 4K stills and the four web posters, rendered from the real
28 ha model with the approved storyboard cameras (track 5A, [README.md](README.md)). Track 5B of
[docs/zaitun/PARALLEL_PLAN.md](../../../docs/zaitun/PARALLEL_PLAN.md).

| File | What it is |
|---|---|
| `scene.mjs` | Exports the scene data film.py needs from the web scene's own code: every tree and hedge (`landscape.ts`, `vegetation.ts`), people, cars and birds sampled per frame (`lifeMotion.ts`), the web's ground mesh, stream and pool (`planWorld.ts`), the poster views (`viewpoints.ts`), the stills and the vertical-cut plan |
| `ts-loader.mjs`, `ts-register.mjs` | Let plain Node import the scene's TypeScript (extensionless imports, `@/`) |
| `film.py` | Blender: dresses `out/zaitun-high.blend` (track 1B's model) with track 4's light rigs, the track 3A libraries at 3B's places, the web's land and water, the haze and the cameras; renders posters, stills and film frames; writes `film.report.json` |
| `endcard.html` | The English and Arabic end card, rendered by headless Chrome |
| `edit.mjs` | ffmpeg: grade, vignette, grain, letterbox, end card, sound; the film, the vertical cut and the graded stills |
| `render.sh` | The whole chain |
| `*.test.ts` | Check the scene export against the web scene, the edit plan, and film.py's report and posters against the viewpoints and the shot list |

## Run

```sh
scripts/blender/film/render.sh preview   # posters, stills, film at 960 x 540, edit  (about 3.5 h on an M3 Pro)
scripts/blender/film/render.sh final     # film at 3840 x 2160, edit                   (about 30 h; resumable)
scripts/blender/film/render.sh edit --music bed.wav --logo logo.png   # re-cut with the owner's music and logo
```

Needs Blender 4.2+ (built on 5.3), Node 24, ffmpeg with libx264, Google Chrome (for the end card), and the
raw 3A libraries `scripts/blender/out/vegetation-high.raw.glb` and `life-high.raw.glb`
(`vegetation.py` / `life.py --tier high`). The model `.blend` is built by `build_compound.py` if missing.
Frames on disk are skipped, so `final` can stop and resume, or run in several terminals at once.
`FRAMES=600-900 render.sh final` renders part of the film.

Outputs (all in `scripts/blender/out/film/`, not in git): `frames/` (16-bit PNG, the film), `frames-25/`
(the preview), `stills/` (16-bit PNG masters), `deliver/` (the films as H.264 MP4 with AAC, the graded stills
as JPEG). The posters go straight to `public/sawad/scene-zaitun-{flight,street,terrace,aerial}.jpg`.

## Look

- **Light** is track 4's, unchanged: `lighting.py`'s day rig (sun 4.2° up at a bearing of 279°, the
  art-directed sky as an HDRI) and dusk rig (every modelled fitting, 72 % of villa windows lit). Shot 07
  is a time-lapse between them (sun sets, sky blends, lamps then windows come on, exposure opens up);
  08 is blue hour.
- **Haze** is the web's FogExp2 (`world.ts`'s colour and density), applied in every shader on camera
  rays. A compositor fog from the mist pass was tried first and dropped: on alpha-cut leaves and on the
  skyline the pass averages a leaf's depth with the sky's, and the olive groves glowed.
- **Leaves** are rougher and less specular than the web materials, with a little translucency: as
  exported, thousands of olive leaf cards seen edge-on mirror the sky and read white from a distance.
  The 3A atlas colours are unchanged.
- **Film and stills**: AgX, Medium High Contrast, exposure −0.2 (day) to +1.9 (dusk); depth of field
  and focus from `shots.json`; motion blur at 0.35 of a frame; a soft glow on bright lights and a
  touch of lens dispersion. Then in `edit.mjs`: teal-leaning shadows, warm highlights, a soft S-curve,
  +10 % saturation, a gentle vignette, light grain, the 2.39:1 letterbox and fades.
- **Posters** are rendered without depth of field, motion blur or grade, then fogged and tone mapped
  exactly as the web canvas is (three.js ACES filmic at exposure 0.5: `lighting.fog`, `lighting.aces`),
  so the poster hands over to the live scene without a jump in framing or tone.

## Cost

Measured on an M3 Pro (Metal, OIDN): a 4K film frame at 16 samples takes about 40 s, so the film's
2,088 frames at the final 64 samples with adaptive sampling take roughly a day and a half. The preview
(960 x 540, 16 samples) takes about 4 s a frame. A poster takes 1–1.5 min, a 4K still about 5 min.

## Open

- **Logo and music** (owner): the end card uses a typeset placeholder (the site's fonts, "Sawad Holding /
  السواد القابضة"); the films carry a silent track. `render.sh edit --music … --logo …` re-cuts them.
- **Framing on the real model** (track 5A): the storyboard was placed on the greybox. On the real model,
  shot 04 ends with a palm trunk in the middle of the frame (3B's riverside palms don't stand where the
  greybox's indicative trees did), 05a frames a plain window rather than a mashrabiya, and 05b's lattice
  window is cut by the top edge. Small camera changes in `shots.mjs`, then `render.sh` again.
- **Web handover** (track 7D): the posters match the web's framing and tone mapping exactly; the live
  scene's lighting (until the lightmaps are wired) will still differ in detail.
