# Zaitun Hills film: shot list and storyboard

The 87 s launch film, as cameras on the 28 ha masterplan. Track 5A of [docs/zaitun/PARALLEL_PLAN.md](../../../docs/zaitun/PARALLEL_PLAN.md).

| File | What it is |
|---|---|
| `shots.mjs` | The shot list as code: every camera placed from `components/sawad/scene/layout.ts` (the hero villa, the gate, the pool and so on), with lens, aperture, timing, light and the vertical-cut picks |
| `shots.json` | Generated from `shots.mjs`. Track 5B's Cycles film reads it, so the approved frames are the frames the film renders |
| `storyboard.py` | Blender script: builds a greybox of the masterplan (from `scripts/blender/layout.json`), adds the cameras and renders the boards |
| `storyboard/` | The boards (start, middle and end of each move) and `frames.json` |
| `*.test.ts` | Checks the shot list (length, lenses, clearance, speed, easing, level verticals, vertical cut) and that the boards match it |

## Rebuild

```sh
node scripts/export-scene-layout.mjs          # layout.json from layout.ts
node scripts/blender/film/shots.mjs           # shots.json + scripts/blender/out/film/greybox.json
blender -b --factory-startup -P scripts/blender/film/storyboard.py -- --boards
```

Options after `--`: `--only 04,06a` renders just those shots, `--width 1600`, `--samples 32`, `--haze 0.0005` (distance haze per metre, 0 for none), `--save` writes `scripts/blender/out/film/storyboard.blend`, and `--animatic` renders the whole film as greybox frames into `scripts/blender/out/film/animatic/`.

To change a shot, edit its keys in `shots.mjs`, regenerate, re-render that shot with `--only`, and run `npx vitest run scripts/blender/film`. The tests fail if `shots.json` or the boards are out of date.

## Conventions

- Positions use the scene's axes: +x downstream (toward the low evening sun), +z across the stream, y up, metres; the water surface is y = 0. Blender gets `(x, -z, y)`, as in `build_compound.py`.
- A shot is two or more keys (`eye`, `target`, optional `focus`) at fractions of its length. Moves are eased in and out (Bezier, flat at the ends); nothing is linear.
- `level: true` keeps the camera's pitch at 0 and frames up or down with vertical lens shift, so architecture keeps straight verticals.
- Full-frame 36 mm sensor fitted to the width, so lens values are real-world lenses. Frames are 16:9 (4K for the film); the optional 2.39:1 letterbox crops top and bottom.
- `light` is `day` (golden hour, sun 4.2° high toward +x), `day-to-dusk` (the time-lapse) or `dusk` (blue hour, lights on).

## Shot list

| Shot | Name | Time | Lens | Move | Light | Vertical cut |
|---|---|---|---|---|---|---|
| 01 | Aerial reveal | 0–12 s | 24 mm f/8 | Drone descent and push toward the compound | day | 3 s |
| 02 | Crane over the gate | 12–21 s | 28 mm f/5.6 | Crane up with tilt down | day | |
| 03 | Palm allée dolly | 21–31 s | 35 mm f/4 | Lateral dolly at walking pace | day | 3 s |
| 04 | Hero villa push-in | 31–41 s | 40 mm f/5.6 | Slow push-in | day | |
| 05a | Detail: mashrabiya | 41–44 s | 85 mm f/2 | Slow lateral drift | day | |
| 05b | Detail: brass canopy | 44–47 s | 85 mm f/2.8 | Slow push-in | day | |
| 05c | Detail: pool edge | 47–50 s | 85 mm f/2.8 | Slow slide along the rim | day | |
| 05d | Detail: olive leaves | 50–53 s | 85 mm f/2 | Slow arc around the branch | day | 2 s |
| 06a | Courts and gym across the pool | 53–58 s | 40 mm f/5.6 | Slow truck along the pool rim | day | 2 s |
| 06b | Playground under the sails | 58–63 s | 40 mm f/5.6 | Slow truck along the pool rim | day | 1 s |
| 07 | Day to dusk | 63–73 s | 35 mm f/8 | Locked off, time-lapse | golden to blue hour | 2 s |
| 08 | Blue-hour pull-back and end card | 73–87 s | 24 mm f/8 | Pull back and crane up | dusk | 2 s |

Each shot's purpose is in `shots.mjs`. The choices that aren't obvious from the brief:

- **The east gate, not the main gate, for the crane (02).** Its brass lintel faces downstream, into the low sun, so the shot opens on lit brass with the sun behind the camera. Seen from outside, the main gate's lintel is in shadow at this hour.
- **The hero is villa-14**, the last waterfront courtyard villa downstream: its flank is open to the sun and the east lawn. The push-in (04) is square on from the riverside lawn and passes between two trunks of the palm row, which frame the villa and then slide out of frame.
- **The lifestyle shot is two angles (06a, 06b)** across the reflecting pool: courts and gym front-lit, then the playground backlit with the sails glowing. One wide down the garden axis made both too small.
- **The olive detail (05d) looks into the sun**, so the leaves are backlit and their silver undersides can flash.
- **Sun glitter on the stream** is a lighting job for track 5B: at 4.2° the glint sits about 13× the camera height away along the sun line, so 01 and 07 may need the sun turned a few degrees in Cycles once the real north is known.

## Greybox limits

The boards show framing and movement, not look. Buildings are massing with window panes; trees are the masterplan drawing's indicative planting (track 3B places the real ones); haze is a distance fade in the materials (EEVEE's world volume renders black with this sun). Nothing here is a model asset: the film renders the real compound from `build_compound.py` in track 5B.
