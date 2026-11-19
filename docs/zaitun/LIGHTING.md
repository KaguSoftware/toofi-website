# Zaitun Hills lighting and lightmaps (track 4)

Built by `scripts/blender/lighting.py`, run for both tiers by `scripts/blender/bake-lightmaps.sh`
(about 15 minutes on an M-series Mac). Checked by `scripts/blender/lighting.test.ts`.

## Orientation

The owner gave north on 2026-11-19: **the stream lies to the north**. In scene space, +z is north
and +x (downstream) is west. The scene's golden-hour sun (`world.ts`: 4.2° up, toward +x and a little
toward the stream) therefore stands at a compass bearing of **279°**, a real evening sun just north
of west (late April or mid-August at Erbil). Nothing in the approved art direction moves.

Two follow-ups for other tracks, now that north is known:

- The masterplan drawing (`scripts/draw-masterplan.mjs`, track 0) still says "North: not confirmed yet".
- The qibla from Erbil is **195°** (a little west of south), direction `(0.26, 0, -0.97)` in scene
  space. The mosque's qibla wall is its local −z side (due south now), so it needs a turn of about 15° (track 0 in
  `layout.ts`, then 1B rebuilds).

## Light rigs (Cycles; also for the film, track 5B)

| State | Sun | Sky | Practicals |
|---|---|---|---|
| day | 4.2° up, lit 4.5° higher (as the web), `#ffa65c` at 4.2, 1° disc | world.ts's sky shader ported to an HDRI (`out/lighting/sky-day.exr`), no sun disc, scaled so open ground gets the web hemisphere light's irradiance | none |
| dusk | 5° below the horizon | deep blue overhead, afterglow low in the west (`sky-dusk.exr`), 3 % of the day's ambient | windows (72 % of villas lit, all apartments and amenities), every modelled lamp-glow fitting, plus layout-placed flush fittings |

Dusk fittings are read from the model: each `lamp-glow` face group becomes a light of its kind
(street lamps, entrance canopies, carports, court floodlights tilted onto the court, the mosque's
portico strip and minaret lantern). Fittings with no modelled fixture are placed from `layout.json`:
the gate lintel downlight, in-ground uplights at the gate pavilions and the mosque, underwater
lights along the reflecting pool, and lights on the playground's sail masts.

Haze is not baked: it depends on distance from the camera. The web keeps `FogExp2`; the validation
frames apply the same formula.

## What is baked

Diffuse irradiance, without albedo: direct sun or practicals, sky, and bounce light, so GI, AO and
soft shadows are all in it. That is what three.js `lightMap` expects.

| Page | High | Low | Holds |
|---|---|---|---|
| `buildings` | 2048² | 1024² | one tile per placed copy (60 villas, 6 blocks, gym, courts, playground, mosque, gallery, 60 carports, 7 parking courts) |
| `site` | 1024² | 512² | streets, kerbs, sidewalks, walls, gates and the central garden, packed together |
| `ground` | 2048 × 1024 | 1024 × 512 | the terrain, projected top-down over the terrain grid's bounds |

Copies of one template share their mesh, but not their light (their neighbours shade them), so
every copy gets its own tile, and the manifest gives each copy's UV2 scale and offset.

Not lightmapped: street lamps, benches, mashrabiya screens, and every alpha-cut or clear material
(`*-lattice`, `*-screen`, `glass-clear`: fences, nets, lattices, the padel glass). Those are single
faces seen from both sides, and one texel can't hold the light on both faces, so they keep
real-time light. They still cast shadows and bounce light in the bake. Water, sky, vegetation and
people are not lightmapped either.

## Files

| File | For |
|---|---|
| `public/sawad/lightmaps/zaitun/<state>-<page>-<tier>.png` | 8-bit sRGB-encoded irradiance; 6B encodes them as KTX2 |
| `public/sawad/lightmaps/zaitun/lightmaps.json` | pages, intensities, each copy's UV2 scale/offset and placement |
| `scripts/blender/out/compound-zaitun-<tier>.lit.raw.glb` | the model with UV2 as `TEXCOORD_2`, for 6B's export (it otherwise equals 1B's raw GLB) |
| `scripts/blender/out/lightmaps/*.exr` | float masters |
| `scripts/blender/out/lighting/` | sky HDRIs, validation strips (`*-compare.png`: Cycles · web reconstruction · error) and beauty frames |

## Web contract (7B / 7C / 7D)

For each mesh of the lit GLB whose material is lightmapped (the `*-atlas` materials, `glass`,
`brass`, `bronze`, `lamp-glow`):

```ts
texture.colorSpace = SRGBColorSpace; // KTX2 from 6B carries this itself
texture.flipY = false;               // glTF convention; KTX2 is always unflipped
texture.channel = 2;                 // uv2 (TEXCOORD_2)
material.lightMap = texture;
material.lightMapIntensity = manifest.states[state].intensity;
material.aoMap = null;               // the lightmap already holds the occlusion
```

- **Per-copy tiles.** GPU instancing merges the copies, so pass `instances[name].scaleOffset` as a
  per-instance attribute, and use `uv2 * scaleOffset.xy + scaleOffset.zw` for the lightmap lookup
  (one `onBeforeCompile` replacement of `vLightMapUv`). Match instances by `position` (scene space)
  if node names are gone after `gltf-transform instance`. Unique objects (`site`, `garden`) have
  `scaleOffset` `[1, 1, 0, 0]`.
- **Ground page.** The web terrain samples `ground` at `((x - minX) / (maxX - minX), (z - minZ) / (maxZ - minZ))`
  from `pages.ground.projection.bounds`, with `flipY = false`; outside the bounds, keep today's look.
- **Don't light twice.** The lightmap already has the sun and sky in it. Lightmapped materials
  should not also take the directional and hemisphere lights' diffuse term (patch it out in the
  same `onBeforeCompile`, or zero their contribution on those materials). Keep the environment
  map for reflections (brass, glass, water). Trees, people, lamps and lattices keep the real-time
  lights and shadows.
- **Day/dusk blend.** Sample both pages and mix by the toggle, or swap textures at the end of the
  sky transition. Dusk previews use exposure 2.4 (day: 0.5). Lit windows: `windowsLit` per copy
  (the same windows glowed in the bake); window glow radiance 1.1, colour `#ffc98a`.

## Export (6B)

6A's budget per lightmap set (`LIGHTMAP_BUDGET` in `finalize-manifest.mjs`): 2 MB high, 0.8 MB low,
loaded after the first frame.

## How it was checked

- **Sky:** the day sky gives open ground the same irradiance as the web's hemisphere light (test).
- **Against Cycles:** for each storyboard camera (`film/shots.json`), Cycles renders its own diffuse
  lighting and then the baked lightmap is rendered from the same view. Both are compared on 8 × 8
  block means, so the reference's path-tracing noise doesn't count as error. Lattice and clear
  glass are made camera-transparent in both renders.
- **Seams:** none possible on flat surfaces. No UV2 seam splits a wall or roof of 1 m² or more,
  because Smart UV Project keeps each one a single island. Islands are padded by 3 px and tiles by 2 px; gutters
  are dilated, then push-pull filled, so mip levels never pull black into a tile.
- **Leaks:** the ground page bakes 0.35 m above the terrain so the hardscape slabs don't black it out;
  the bake denoiser never mixes texels across islands (it is guided by world position and normal).
