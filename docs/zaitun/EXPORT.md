# Zaitun Hills final export (track 6B)

`scripts/blender/export-final.sh` turns track 4's lit raw GLBs and lightmap PNGs into the files the
site ships, then `scripts/blender/export-final.mjs` checks them. The checks also run as tests
(`scripts/blender/export-final.test.ts`) against the files in `public/sawad/`.

## What ships

| File | High | Low |
|---|---|---|
| `public/sawad/models/compound-zaitun-<tier>.glb` (meshopt, KTX2, UV2 kept as `TEXCOORD_2`) | 10.26 MB | 4.97 MB |
| `vegetation-<tier>.glb`, `life-<tier>.glb` (3A, unchanged) | 1.23 + 0.24 MB | 0.41 + 0.22 MB |
| Lightmap set, day: `public/sawad/lightmaps/zaitun/day-{buildings,site,ground}-<tier>.ktx2` | 0.94 MB | 0.31 MB |
| Lightmap set, dusk: `dusk-{buildings,site,ground}-<tier>.ktx2` | 0.91 MB | 0.29 MB |
| `public/sawad/models/zaitun-export.json` | sizes, budgets, checks, the KTX2 file list per tier and the lightmap UV set | |

Lightmaps are separate files, not part of the initial load: the web loads them after the first frame.
The PNG masters stay next to them (see section 6).

## 1. Budgets

6A proposed 7.0 / 2.8 MB per compound file and 8.5 / 4.0 MB for all models of a tier, estimated
before the 28 ha model existed (`EXPORT_BUDGETS.md` section 2). The real files measure more, and
the owner chose on 2026-11-19 to keep the baked AO channel and raise the caps. These are the
caps in force for the Zaitun files (`ZAITUN_BUDGETS` in `export-final.mjs`); 6A's other caps are unchanged.

| | Measured | Cap | Was (6A) |
|---|---|---|---|
| compound, high | 10.26 MB | 10.5 MB | 7.0 MB |
| compound, low | 4.97 MB | 5.2 MB | 2.8 MB |
| all models, high (initial load) | 11.73 MB | 12.0 MB | 8.5 MB |
| all models, low (initial load) | 5.61 MB | 5.8 MB | 4.0 MB |
| lightmap set, high / low | 0.94 / 0.31 MB | 2.0 / 0.8 MB | same |
| whole page estimate, high | 14.03 MB | 15 MB | about 10.8 MB |

The page estimate is the models plus 6A's 2.3 MB for the transcoder, the 3D JavaScript, the poster,
fonts and app JavaScript. It is an estimate: QA measures the real load. On the high tier it leaves
under 1 MB of the 15 MB limit, so any growth elsewhere (a heavier poster, more JavaScript) needs a
matching cut here.

### Where the bytes are (high tier, compressed)

Geometry attributes 6.2 MB (position 1.37, UV0 1.21, UV2 1.15, AO UV 1.14, colour 0.72, normal
0.37, indices 0.22), trim-sheet textures 1.8 MB, AO textures 2.2 MB, instancing 0.01 MB.

### The measured alternative: drop the AO channel

The lightmaps hold the occlusion (`LIGHTING.md` tells the web to set `aoMap = null` wherever a
lightmap is applied), so the AO textures and their UV set are redundant once the lightmaps load.
Dropping them gives **6.86 MB high / 3.60 MB low**: the high tier then meets 6A's original 7.0 and
8.5 MB caps, the low tier still misses 2.8 MB. It was not chosen because it needs edits in other
tracks (1B's manifest test asserts AO on every atlas material, and glTF forbids a gap in TEXCOORD
indices, so the lightmap UVs would move from `TEXCOORD_2` to `TEXCOORD_1`, changing track 4's
`lightmaps.json`, its test and `LIGHTING.md`), and because the first frame, before the lightmaps
arrive, would then have no occlusion at all. It also needs a custom transform chain: after the AO
textures go, `gltf-transform optimize` sees the 17 atlas materials as identical, merges them and
joins the single-instance meshes (site, mosque, playground, parking courts) into their neighbours,
which breaks the per-page, per-copy lightmap assignment. The chain was prototyped (material dedup and
cross-mesh joins left out); the lightmap texel density of every mesh stayed within 2.3% (most within 0.5%)
after simplification. If budget pressure returns, this is the first lever.

## 2. Decisions

- **Geometry stays meshopt** (6A's decision, unchanged): it also compresses the UV2, colour and instancing
  attributes, which Draco would not.
- **Lightmaps are KTX2 ETC1S** at the top quality level (`--qlevel 255 --clevel 5`), sRGB, full mip chain.
  Against the PNG, the 2048 × 2048 buildings page has a mean error of 3.6 / 255 (PSNR 30.5 dB). UASTC is
  closer, but one buildings page alone is 2.9 MB (2.4 MB with RDO), which does not fit a 2 MB set. Move the
  buildings page to UASTC only if the budget is raised by about 3 MB.
- **`--prune-attributes false`** is the one flag added to `build.sh`'s encode. `optimize` prunes vertex
  attributes that no glTF texture slot references, and `TEXCOORD_2` (the lightmap UVs) is one of them.
- **High tier is not simplified** (as `build.sh`): the bevels survive as modelled. The low tier is simplified
  at error 0.0005, as before; the lightmap UVs of both tiers are the ones track 4 baked against.
- **The model is one named mesh per template.** The lightmap contract needs it: the `site` and `buildings`
  pages and each copy's tile are applied per mesh. The test counts the lit building copies in the GLB (instanced
  nodes plus single meshes) against the tiles in `lightmaps.json` (140 on both tiers), so a merged mesh fails.

## 3. Checks

Run by `export-final.sh` and by the tests:

- the official glTF validator reports no errors (it ignores `IMAGE_UNRECOGNIZED_FORMAT`, because it does not
  decode KTX2 images; see section 5);
- `ktx validate` passes for every lightmap page, and each page is sRGB, has a mip chain and is the size
  `lightmaps.json` lists;
- meshopt, KTX2 and GPU instancing are used, nothing else is required, TEXCOORD sets are continuous, every atlas
  primitive has `TEXCOORD_2`, lamps and benches have none, AO maps read the AO UV set;
- every size against its cap, including a whole-tier initial-load total.

Not checked here: how the lightmaps look in the browser (track 7D wires them in), the real 4G load time and
whether the host serves `.glb` with brotli or gzip (the sizes above are on disk, before transfer compression).

## 4. For track 7D

- Models: `compound-zaitun-{high,low}.glb`, `vegetation-*`, `life-*` in `public/sawad/models/`. The
  `compoundModel.ts` loader already wires meshopt and the KTX2 transcoder (`public/sawad/basis/`).
- Lightmaps: `zaitun-export.json` has `lightmaps[tier][page].files[state] = { file, bytes }`, for the pages
  `buildings`, `site` and `ground`. The same KTX2Loader loads them. Wiring per `LIGHTING.md`: `texture.channel = 2`
  (`TEXCOORD_2`, `uv2`), `flipY = false`, per-copy `scaleOffset` from `lightmaps.json`.
- `compound-zaitun.manifest.json` keeps 1B's content; only `files` and `budgets` are rewritten.

## 5. Findings for other tracks

- **6A, `build.sh` validate gate:** `gltf-transform validate` reports every KTX2 texture as
  `IMAGE_UNRECOGNIZED_FORMAT` (an error), so the gate fails on any GLB with KTX2 textures, including the
  shipped 7 ha ones. It needs `--ignore UNUSED_OBJECT,IMAGE_UNRECOGNIZED_FORMAT`. Not changed here (6A's file).
- **6A / 1B, `build.sh` has no `--plan zaitun` pass.** The 28 ha files come from `bake-lightmaps.sh` (raw lit
  GLBs) and this track's `export-final.sh`; `build.sh` only rebuilds the 7 ha model.
- **Triangles:** the high compound file is 1.18 M placed triangles; the 300 k visible budget still needs the
  distance LODs from `EXPORT_BUDGETS.md` section 3 (1B / 7D). Nothing in this track changes that.

## 6. Open items

- **PNG masters in `public/`:** the 12 lightmap PNGs (22.9 MB) are committed beside the KTX2 files and are
  deployed with the site although nothing loads them. They are track 4's output and the only copy besides the
  15-minute bake. Suggest moving them out of `public/` (for example to `docs/zaitun/lightmap-masters/` or
  git LFS); `lighting.test.ts` reads them from `public/` today, so that is a change for track 4.
- **Mosque qibla turn** (track 4's follow-up): after layout.ts turns the mosque, rerun `bake-lightmaps.sh`
  and then `export-final.sh`.

## 7. Rebuilding

```bash
scripts/blender/bake-lightmaps.sh      # track 4: ~15 min, writes out/*.lit.raw.glb and the PNG pages
scripts/blender/export-final.sh        # this track: ~2 min, needs the `ktx` CLI (4.3+) on PATH
```

`SKIP_MODELS=1` or `SKIP_LIGHTMAPS=1` re-encodes only the other half.
