"""
Sawad compound: scripted, reproducible Blender build of the baked architecture model.

    node scripts/export-scene-layout.mjs
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        -P scripts/blender/build_compound.py -- --tier high|low [--plan legacy|zaitun] \
        [--no-bake] [--samples 512] [--preview] [--blend PATH]

Reads scripts/blender/layout.json (written from components/sawad/scene/layout.ts) and the
CC0 source textures in scripts/blender/textures (scripts/blender/fetch_textures.sh), and
writes scripts/blender/out/:

    compound-high.raw.glb   --tier high: every asset, bevels, 2048 trim sheet, 1024 AO per asset type
    compound-low.raw.glb    --tier low: no bevels, window trims, mashrabiya screens or benches; 512 AO
    build-report-<tier>.json  villa empties, palette check, triangle counts

--plan zaitun builds the 28 ha Zaitun Hills masterplan (layout.json `masterplan`) instead of the
7 ha layout, which Bustan Dijla and Shatt Gardens still use:

    compound-zaitun-<tier>.raw.glb, build-report-zaitun-<tier>.json
    preview-zaitun-<shot>-<tier>.png   with --preview
    PATH                               with --blend: the generated scene in collections (Villas,
                                       Apartments, Amenities, Parking, Site, Fixtures, Markers, and
                                       Film: terrain and water, which are not exported)

scripts/blender/build.sh then optimises both into public/sawad/models/. Never hand-edit a
.blend: this file is the source.

Conventions
- Geometry is modelled in three.js space (x, y up, z toward the entrance or the river) and
  converted once to Blender space with (x, y, z) -> (x, -z, y). The glTF exporter's +Y up
  converts it back exactly.
- Each asset type is modelled once with its origin on the pad (y = PAD_Y) and placed with
  linked duplicates, so the instanced copies share one AO bake.
- One shared 2048 trim-sheet atlas (base colour, ORM, normal) on UV0. Large faces are cut
  on a world-space grid so every face maps inside its atlas cell, keeping the trim sheet
  seamless. Every CC0 source shows at its real-world scale, at 200-285 px/m (REGIONS).
  Ambient occlusion only, baked in Cycles onto UV1 (Smart UV Project, see lightmap_uv).
- Surfaces (SURFACES, the names the modelling code uses) sample an atlas region; the vertex
  colour COLOR_0 carries each surface's palette tint and its dust (dirt at wall bases, a film
  on upward faces), and glTF multiplies it into the base colour in the browser and in Cycles.
"""

import json
import math
import os
import sys
import time
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # Blender's -P does not put the script's folder on sys.path
import amenities  # noqa: E402  (scripts/blender/amenities.py: gym, courts, playground, mosque, parking)
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg_value(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


LAYOUT = json.load(open(arg_value("--layout", os.path.join(HERE, "layout.json"))))
TEXTURES = arg_value("--textures", os.path.join(HERE, "textures"))
OUT = arg_value("--out", os.path.join(HERE, "out"))
BAKE = "--no-bake" not in ARGS
SAMPLES = int(arg_value("--samples", "512"))
PREVIEW = "--preview" in ARGS
TIER = arg_value("--tier", "high")
assert TIER in ("high", "low"), TIER
# --plan legacy: the 7 ha layout (compound-<tier>, still used by Bustan Dijla and Shatt Gardens).
# --plan zaitun: the 28 ha masterplan (compound-zaitun-<tier>), LAYOUT["masterplan"].
PLAN = arg_value("--plan", "legacy")
assert PLAN in ("legacy", "zaitun"), PLAN
BLEND = arg_value("--blend", None)  # also save the generated scene as a .blend (never hand-edit it)
HIGH = TIER == "high"
AO_SIZE = 1024 if HIGH else 512
PAD_Y = LAYOUT["padY"]
T0 = time.time()


def log(*a):
    print(f"[compound {time.time() - T0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------------ palette and atlas

ATLAS = 2048


def srgb(hexstr):
    h = hexstr.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)])


def to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hex_of(c):
    return "#" + "".join(f"{round(float(v) * 255):02x}" for v in c)


# The `C` palette in components/sawad/scene/world.ts. Surface means must match these.
PALETTE = {
    "cream": "#ecdfc7",
    "creamShade": "#dccaa8",
    "parapet": "#f3e9d6",
    "stone": "#d2c3a2",
    "wall": "#d6c29c",
    "brass": "#c9a24a",
    "wood": "#6b5038",
    "hedge": "#56692f",
    "glass": "#6d5d4e",
    "pool": "#4f9a9a",
    "courtyard": "#9b8466",
    "slab": "#efe6d5",
}

# The amenities' own colours (gym, courts, playground). world.ts has no entry for them because
# the procedural scene never draws them, so they are reported apart (materials.amenityPalette)
# and checked here, by the same 2/255 rule.
AMENITY_PALETTE = {
    "court": "#5f7a62",  # sage acrylic: the olive family of the hedges, quiet beside the cream
    "courtLine": "#ece6d8",  # warm white line paint, never a pure-white trap
    "rubber": "#b07a55",  # terracotta poured rubber under the play structures
    "fence": "#3d3128",  # dark bronze powder coat, like the window frames
    "net": "#2f2b27",  # charcoal polyester
}
COLORS = {**PALETTE, **AMENITY_PALETTE}

# Dust is the site's own dry earth (world.ts `earthDry`), carried onto walls and paving by the
# summer wind: it settles in crevices, rises up the walls from the ground and films the tops.
DUST = "#b89c72"

# Atlas regions: the texture content. Square rect (x, y, size) in pixels from the bottom-left;
# the CC0 source (or @procedural); the source's real tile size in metres (`real`) and how many
# source tiles span one cell per side (`repeat`), so every source shows at its true scale; the
# cell's world size in metres; mean roughness; detail contrast; `dust` (0..1) settling into the
# source's crevices; `breakup` (roughness noise) and `mottle` (colour noise); `streaks` (vertical
# dust run-off below ledges, on walls) and `stains` (sparse soft-edged patches: water marks,
# scuffs, oil and gum on paving), both pulling toward GRIME, a darker dust.
# Texel density, (size - 2 * pad) / cell, is 200..285 px/m for every opaque surface on the 2048
# sheet (half that on the low tier). Only the alpha-cut screens and meshes go higher, because
# their thin bars need the pixels. Free: three 128 cells at (1920, 1792), (1792, 1920), (1920, 1920).
REGIONS = {
    "plaster": dict(rect=(0, 0, 1024), src="white_stucco", real=2.0, repeat=2, cell=4.0, color="cream", rough=0.88, contrast=0.55, dust=0.25, streaks=0.6, stains=0.15),
    "paving": dict(rect=(1024, 0, 1024), src="PavingStones128", real=3.5, repeat=1, cell=3.5, color="stone", rough=0.82, contrast=0.4, dust=0.6, breakup=0.035, stains=0.5),
    "travertine": dict(rect=(0, 1024, 512), src="Travertine009", real=1.2, repeat=2, cell=2.4, color="parapet", rough=0.62, contrast=0.45, dust=0.3, streaks=0.45, stains=0.15),
    # The boulevard pavers at 4/7 scale: smaller setts for the courtyards.
    "courtyard": dict(rect=(512, 1024, 512), src="PavingStones128", real=3.5, repeat=1, cell=2.0, color="courtyard", rough=0.8, contrast=0.5, dust=0.6, stains=0.5),
    "hedge": dict(rect=(0, 1536, 512), src="@hedge", cell=2.0, color="hedge", rough=0.9, contrast=1.0, mottle=0.0),
    "court": dict(rect=(512, 1536, 512), src="Asphalt031", real=2.0, repeat=1, cell=2.0, color="court", rough=0.78, contrast=0.3, dust=0.2, mottle=0.004, stains=0.3),
    "rubber": dict(rect=(1024, 1024, 512), src="rubberized_track", real=2.0, repeat=1, cell=2.0, color="rubber", rough=0.92, contrast=0.45, dust=0.25, stains=0.35),
    "mosque_floor": dict(rect=(1536, 1024, 512), src="patterned_terracotta_tiling", real=2.15, repeat=1, cell=2.15, color="slab", rough=0.55, contrast=0.5, dust=0.4, stains=0.35),
    "lattice": dict(rect=(1024, 1536, 256), src="@lattice", cell=0.6, color="wood", rough=0.7, contrast=0.0),
    "timber": dict(rect=(1280, 1536, 256), src="fine_grained_wood", real=0.6, repeat=2, cell=1.2, color="wood", rough=0.58, contrast=0.45, streaks=0.3, stains=0.2),
    "mosaic": dict(rect=(1024, 1792, 256), src="Tiles070", real=0.6, repeat=2, cell=1.2, color="pool", rough=0.12, contrast=0.6, breakup=0.03),
    "zellige": dict(rect=(1280, 1792, 256), src="@zellige", cell=1.0, color="pool", rough=0.2, contrast=0.7, dust=0.3, breakup=0.03, stains=0.15),
    "fence": dict(rect=(1536, 1536, 256), src="@fence", cell=0.5, color="fence", rough=0.5, contrast=0.0),
    "net": dict(rect=(1792, 1536, 256), src="@net", cell=0.54, color="net", rough=0.85, contrast=0.0),
    "jali": dict(rect=(1536, 1792, 256), src="@jali", cell=0.6, color="parapet", rough=0.62, contrast=0.0),
    "paint": dict(rect=(1792, 1792, 128), src="@paint", cell=0.5, color="courtLine", rough=0.6, contrast=0.0),
}
ALPHA_SOURCES = ("@lattice", "@jali", "@fence", "@net")

# Modelling surfaces: what the modelling code puts on faces (SLOT["..."]). Each samples one atlas
# region. Surfaces that share a region with a lighter one (shade plaster and the boundary wall on
# the cream stucco; slab and plinth stone on the travertine) reach their own palette colour
# through the vertex colour COLOR_0, which glTF multiplies into the base colour. `grime` is how
# far dust darkens a wall toward the dust colour at ground level (fading out by GRIME_HEIGHT).
# The first twelve keep their historic order, so their slot indices never move.
SURFACES = {
    "plaster_cream": dict(region="plaster", color="cream", grime=0.6),
    "plaster_shade": dict(region="plaster", color="creamShade", grime=0.6),
    "paving": dict(region="paving", color="stone", grime=0.35),
    "limestone": dict(region="travertine", color="parapet", grime=0.45),
    "hedge": dict(region="hedge", color="hedge"),
    "wall": dict(region="plaster", color="wall", grime=0.65),
    "courtyard": dict(region="courtyard", color="courtyard", grime=0.35),
    "lattice": dict(region="lattice", color="wood"),
    "stone": dict(region="travertine", color="stone", grime=0.75),
    "slab": dict(region="travertine", color="slab", grime=0.22),
    "timber": dict(region="timber", color="wood", grime=0.3),
    "mosaic": dict(region="mosaic", color="pool"),
    # The amenities (track 1A): sports surface, line paint, playground rubber, court fence and
    # net, the mosque's glazed star tile band, forecourt floor and pierced limestone screen.
    "court": dict(region="court", color="court"),
    "court_line": dict(region="paint", color="courtLine"),
    "rubber": dict(region="rubber", color="rubber"),
    "fence": dict(region="fence", color="fence"),
    "net": dict(region="net", color="net"),
    "zellige": dict(region="zellige", color="pool", grime=0.15),
    "mosque_floor": dict(region="mosque_floor", color="slab", grime=0.2),
    "jali": dict(region="jali", color="parapet"),
}
SURFACE_NAMES = list(SURFACES)
# Alpha-cut surfaces take the asset's second (MASK) material.
MASKED = {name for name, s in SURFACES.items() if REGIONS[s["region"]]["src"] in ALPHA_SOURCES}
# Linear COLOR_0 multiplier per surface (palette tint), filled in by build_atlas().
SLOT_TINT = {name: np.ones(3) for name in SURFACE_NAMES}
GRIME_HEIGHT = 1.2  # m above the ground where splash-back dust has faded out
GRIME_KNEE = 0.45  # m: a second edge loop, so the dust hugs the ground instead of fading linearly
GRIME_CURVE = 1.8  # falloff exponent between the ground and GRIME_HEIGHT
DUST_FILM = 0.16  # dust on the upward faces above the ground: copings, sills, roofs, terraces
AO_DIRT = 0.45  # how far the darkest baked corners (reveals, wall feet, under copings) go toward GRIME
GRIME = "#7d6648"  # dust darkened by damp and time: streaks, stains, corner dirt
MATERIALS_REPORT = {}


def region_of(surface):
    return REGIONS[SURFACES[surface]["region"]]


def pad_for(size):
    return 16 if size >= 1024 else 8


def inner_rect_uv(region):
    x, y, s = REGIONS[region]["rect"]
    p = pad_for(s)
    return (x + p) / ATLAS, (y + p) / ATLAS, (s - 2 * p) / ATLAS


def texel_density(region):
    """Atlas pixels per metre on the 2048 sheet."""
    r = REGIONS[region]
    s = r["rect"][2]
    return (s - 2 * pad_for(s)) / r["cell"]


def load_pixels(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)


def resize(a, n):
    """Box-filter down by halves, then wrap-around bilinear to n x n (sources are tileable)."""
    while a.shape[0] >= 2 * n and a.shape[0] % 2 == 0:
        a = (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4
    h, w = a.shape[:2]
    ys = (np.arange(n) + 0.5) * h / n - 0.5
    xs = (np.arange(n) + 0.5) * w / n - 0.5
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = (ys - y0)[:, None, None]
    fx = (xs - x0)[None, :, None]
    y0m, y1m = y0 % h, (y0 + 1) % h
    x0m, x1m = x0 % w, (x0 + 1) % w
    top = a[y0m][:, x0m] * (1 - fx) + a[y0m][:, x1m] * fx
    bot = a[y1m][:, x0m] * (1 - fx) + a[y1m][:, x1m] * fx
    return top * (1 - fy) + bot * fy


def wrap_pad(tile, p):
    return np.pad(tile, ((p, p), (p, p), (0, 0)), mode="wrap")


def normals_from_height(hf, strength):
    dx = (np.roll(hf, -1, 1) - np.roll(hf, 1, 1)) * 0.5 * strength
    dy = (np.roll(hf, -1, 0) - np.roll(hf, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(hf)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def periodic_noise(n, lo, hi, seed, slope=1.0):
    """Tileable fractal noise, about N(0, 1): white noise shaped in the frequency domain to
    lo..hi whole cycles per tile with a 1/f^slope falloff. Only whole cycles, so it wraps
    seamlessly inside its atlas cell."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n) * n
    r = np.hypot(f[:, None], f[None, :])
    amp = np.where((r >= lo) & (r <= hi), 1 / np.maximum(r, 1) ** slope, 0.0)
    field = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * amp))
    return (field - field.mean()) / max(field.std(), 1e-9)


def crevice_mask(maps, lum):
    """0 on the open surface, rising to 1 deep in grout lines and pores: from the source's AO,
    else its height map, else (at half strength) its darkest colour."""
    if "ao" in maps:
        c, weight = 1 - maps["ao"], 1.0
    elif "height" in maps:
        c, weight = -maps["height"], 1.0
    else:
        c, weight = -lum, 0.5
    # High-pass (wrap-around blur, 1/24 of the tile): dust fills pores and joints, not the
    # broad shading some AO maps carry, which would read as cloudy blotches.
    n = c.shape[0]
    f = np.fft.fftfreq(n)
    sigma = n / 24
    blur = np.exp(-2 * (math.pi * sigma) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    c = c - np.real(np.fft.ifft2(np.fft.fft2(c) * blur))
    p50, p98 = np.percentile(c, [50, 98])
    # The floor keeps a source without real pores from being stretched to a full mask.
    return np.clip((c - p50) / max(p98 - p50, 0.1), 0, 1) * weight


def weighted_mean(rgb, weights):
    return (rgb * weights[..., None]).sum((0, 1)) / weights.sum()


def solve_tint(texels, weights, target_hex, iterations=8):
    """The linear COLOR_0 multiplier that moves a region's mean colour (measured in sRGB, like
    the palette) onto another palette colour. Returns (multiplier, resulting mean)."""
    lin = to_linear(texels)
    goal = to_linear(srgb(target_hex))
    ratio = np.ones(3)
    for _ in range(iterations):
        mean = weighted_mean(to_srgb(lin * ratio), weights)
        ratio = ratio * goal / np.maximum(to_linear(mean), 1e-9)
    return ratio, weighted_mean(to_srgb(lin * ratio), weights)


def procedural_hedge(n):
    """Clipped leafy hedge: overlapping leaf domes on a torus (tileable)."""
    rng = np.random.default_rng(7)
    hf = np.zeros((n, n), np.float32)
    tint = np.zeros((n, n), np.float32)
    yy, xx = np.mgrid[-16:17, -16:17]
    for _ in range(int(n * n / 90)):
        cx, cy = rng.integers(0, n, 2)
        r = rng.uniform(4.0, 9.0) * n / 512
        ang = rng.uniform(0, math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        u = (xx * ca + yy * sa) / r
        v = (-xx * sa + yy * ca) / (r * 0.55)
        d = 1 - (u * u + v * v)
        dome = np.where(d > 0, np.sqrt(np.clip(d, 0, 1)), 0) * rng.uniform(0.6, 1.0)
        rows = (cy + yy[:, 0]) % n
        cols = (cx + xx[0]) % n
        block = hf[np.ix_(rows, cols)]
        top = dome > block
        block[top] = dome[top]
        hf[np.ix_(rows, cols)] = block
        tb = tint[np.ix_(rows, cols)]
        tb[top] = rng.uniform(-1, 1)
        tint[np.ix_(rows, cols)] = tb
    shade = 0.55 + 0.45 * hf + 0.12 * tint
    return dict(color=np.repeat(shade[..., None], 3, -1), normal=normals_from_height(hf, 3.0), rough=0.9 - 0.15 * hf, crevice=1 - hf)


def unit_coords(n, per_side):
    """Pixel-centre coordinates in [-0.5, 0.5) of a per_side x per_side grid of units, plus each
    pixel's unit index (for per-tile variation)."""
    v, u = (np.mgrid[0:n, 0:n] + 0.5) / n * per_side
    return u % 1 - 0.5, v % 1 - 0.5, np.floor(u).astype(int), np.floor(v).astype(int)


def star_distance(x, y, r):
    """Signed distance to an eight-point star (two squares, one turned 45 degrees), < 0 inside."""
    return np.minimum(np.maximum(np.abs(x), np.abs(y)) - r, (np.abs(x) + np.abs(y)) / math.sqrt(2) - r)


def procedural_lattice(n):
    """Mashrabiya: square grid, diagonals and an octagram ring per tile (alpha-cut)."""
    v, u = (np.mgrid[0:n, 0:n] + 0.5) / n
    cu, cv = np.abs(u - 0.5), np.abs(v - 0.5)
    d = np.minimum.reduce(
        [
            np.minimum(u, 1 - u),
            np.minimum(v, 1 - v),
            np.abs(u - v) / math.sqrt(2),
            np.abs(u + v - 1) / math.sqrt(2),
            np.abs(np.maximum(cu, cv) - 0.25),
            np.abs((cu + cv) / math.sqrt(2) - 0.25),
        ]
    )
    w = 0.03
    alpha = (d < w).astype(np.float32)
    hf = np.clip(1 - d / w, 0, 1)
    color = np.repeat((0.85 + 0.15 * hf)[..., None], 3, -1)
    return dict(color=color, normal=normals_from_height(hf * 2.0, 1.0), rough=np.full((n, n), 0.7, np.float32), alpha=alpha)


def procedural_jali(n):
    """Pierced limestone screen for the mosque: an eight-point star opening per 0.3 m unit and a
    small diamond where four units meet, with chamfered (bevelled) stone around each opening."""
    x, y, _, _ = unit_coords(n, 2)
    star = star_distance(x, y, 0.27)
    diamond = (np.abs(np.abs(x) - 0.5) + np.abs(np.abs(y) - 0.5)) / math.sqrt(2) - 0.07
    d = np.minimum(star, diamond)  # < 0: open
    alpha = (d > 0).astype(np.float32)
    hf = np.clip(d / 0.05, 0, 1)
    color = np.repeat((0.9 + 0.1 * hf)[..., None], 3, -1)
    return dict(color=color, normal=normals_from_height(hf, 2.5), rough=0.66 - 0.06 * hf, alpha=alpha, crevice=1 - hf)


def wire_grid(n, per_side, width):
    """Distance field and round wire profile of a square grid of wires (`width` in unit fractions)."""
    x, y, _, _ = unit_coords(n, per_side)
    d = np.minimum(0.5 - np.abs(x), 0.5 - np.abs(y))  # 0 on a wire's centre line
    profile = np.sqrt(np.clip(1 - (d / (width / 2)) ** 2, 0, 1))
    return d, profile


def procedural_fence(n):
    """Welded square mesh for the court fences: 50 mm squares, 6 mm wire (alpha-cut)."""
    d, profile = wire_grid(n, 10, 0.12)
    alpha = (profile > 0).astype(np.float32)
    return dict(color=np.repeat((0.8 + 0.2 * profile)[..., None], 3, -1), normal=normals_from_height(profile, 3.0), rough=np.full((n, n), 0.5, np.float32), alpha=alpha)


def procedural_net(n):
    """Knotted square net: 45 mm squares, 3 mm cord, a knot at every crossing (alpha-cut)."""
    x, y, _, _ = unit_coords(n, 12)
    d, profile = wire_grid(n, 12, 0.08)
    knot = np.sqrt(np.clip(1 - (np.hypot(np.abs(x) - 0.5, np.abs(y) - 0.5) / 0.09) ** 2, 0, 1))
    hf = np.maximum(profile, knot)
    alpha = (hf > 0).astype(np.float32)
    return dict(color=np.repeat((0.75 + 0.25 * hf)[..., None], 3, -1), normal=normals_from_height(hf, 3.0), rough=np.full((n, n), 0.85, np.float32), alpha=alpha)


def procedural_zellige(n):
    """Glazed star tiles (khatam) for the mosque band: a 0.25 m eight-point star tile and the
    cross tile between, in two glaze depths, each tile its own slightly different firing, with
    sunken grout joints. No CC0 library has an Islamic geometric tile, so it is drawn here."""
    x, y, iu, iv = unit_coords(n, 4)
    star = star_distance(x, y, 0.3)
    edge = np.minimum(0.5 - np.abs(x), 0.5 - np.abs(y))
    grout_d = np.minimum(np.abs(star), edge)
    grout = np.clip(1 - grout_d / 0.025, 0, 1)
    rng = np.random.default_rng(11)
    firing = rng.uniform(-1, 1, (4, 4, 2))[iv % 4, iu % 4]  # per tile: star, cross
    glaze = np.where(star < 0, 0.62 + 0.07 * firing[..., 0], 1.0 + 0.06 * firing[..., 1])
    shade = glaze * (1 - 0.55 * grout)
    hf = 1 - grout
    return dict(color=np.repeat(shade[..., None], 3, -1), normal=normals_from_height(hf, 2.0), rough=0.12 + 0.7 * grout, crevice=grout)


def procedural_paint(n):
    """Line paint: flat, with a faint brushed grain."""
    grain = periodic_noise(n, 8, 48, 5) * 0.02
    return dict(color=np.repeat((1 + grain)[..., None], 3, -1), normal=normals_from_height(grain, 2.0), rough=np.full((n, n), 0.6, np.float32))


PROCEDURAL = {
    "@hedge": procedural_hedge,
    "@lattice": procedural_lattice,
    "@jali": procedural_jali,
    "@fence": procedural_fence,
    "@net": procedural_net,
    "@zellige": procedural_zellige,
    "@paint": procedural_paint,
}


def source_maps(src, n, repeat, cache):
    """A CC0 source tiled `repeat` x `repeat` and resized to n: color, normal, rough and the
    optional ao and height maps."""
    if src not in cache:
        folder = os.path.join(TEXTURES, src)
        cache[src] = {k: load_pixels(os.path.join(folder, f"{k}.jpg")) for k in ("color", "normal", "rough", "ao", "height") if os.path.exists(os.path.join(folder, f"{k}.jpg"))}
    maps = {}
    for k, a in cache[src].items():
        tiled = np.tile(a, (repeat, repeat, 1)) if repeat > 1 else a
        maps[k] = resize(tiled, n)
    normal = maps["normal"][..., :3] * 2 - 1
    normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-6)
    out = dict(color=maps["color"][..., :3], normal=normal * 0.5 + 0.5, rough=maps["rough"][..., 0])
    for k in ("ao", "height"):
        if k in maps:
            out[k] = maps[k][..., 0]
    return out


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def weathering(n, seed, streaks, stains):
    """0..1 weathering mask, tileable: vertical run-off streaks (long in v, narrow in u: dust
    washed down a wall by the winter rain), gathered in a few bands rather than everywhere, plus
    sparse soft-edged stains. Rows are v, so streaks get low frequencies down axis 0."""
    out = np.zeros((n, n))
    if streaks:
        # Individual run-off streaks: sharp where the water leaves a ledge, thinning and fading
        # as they run down, a little wavy; gathered in a few bands. Rows grow with v (up).
        rng = np.random.default_rng(seed + 11)
        bands = smoothstep(-0.3, 1.0, periodic_noise(n, 1, 3, seed + 12))
        rows = np.arange(n)
        for _ in range(int(120 * streaks)):
            x0, top = rng.uniform(0, n, 2)
            length = rng.uniform(0.12, 0.45) * n
            width = rng.uniform(0.005, 0.016) * n
            strength = rng.uniform(0.35, 0.8) * bands[int(top) % n, int(x0) % n]
            t = ((top - rows) % n) / length  # 0 at the ledge, 1 at the tail
            along = np.where(t <= 1, (1 - np.clip(t, 0, 1)) ** 1.6 * smoothstep(0, 0.03, t), 0.0)
            x = x0 + 0.0015 * n * np.sin(rows * rng.uniform(0.01, 0.03) + rng.uniform(0, 6.3))
            cols = np.arange(int(-4 * width) - 3, int(4 * width) + 4)
            grid = (np.floor(x)[:, None] + cols[None, :]).astype(int)
            du = grid - x[:, None]
            across = np.exp(-((du / np.maximum(width * (1 - 0.5 * np.clip(t, 0, 1)), 0.6)[:, None]) ** 2))
            np.add.at(out, (np.repeat(rows, len(cols)), (grid % n).ravel()), (strength * along[:, None] * across).ravel())
        out = np.clip(out, 0, 1) * streaks
    if stains:
        patches = smoothstep(0.6, 2.4, periodic_noise(n, 2, 9, seed + 13, slope=1.4))
        speckle = smoothstep(2.2, 3.0, periodic_noise(n, 12, 60, seed + 14, slope=0.5))
        out += stains * (patches + 0.6 * speckle)
    return np.clip(out, 0, 1)


def region_tile(name, r, n, cache):
    """One region's tile, n x n: tinted base colour (+ alpha), ORM and normal, with the
    imperfection pass (colour mottling, roughness breakup, dust in the crevices)."""
    seed = zlib.crc32(name.encode())
    if r["src"].startswith("@"):
        maps = PROCEDURAL[r["src"]](n)
    else:
        maps = source_maps(r["src"], n, r.get("repeat", 1), cache)
    color, normal, rough = maps["color"], maps["normal"], maps["rough"]
    alpha = maps.get("alpha")
    weights = alpha if alpha is not None else np.ones((n, n))
    lum = color @ np.array([0.2126, 0.7152, 0.0722])
    crevice = maps["crevice"] if "crevice" in maps else crevice_mask(maps, lum)
    # Tint: the palette colour times a luminance detail map with mean 1, mottled by low-frequency
    # colour noise (stains, uneven weathering), so nothing is CG-uniform within a cell.
    detail = 1 + r["contrast"] * (lum / max(lum.mean(), 1e-6) - 1)
    mottle = 1 + r.get("mottle", 0.007) * periodic_noise(n, 3, 24, seed)
    target = srgb(COLORS[r["color"]])
    tinted = np.clip(target[None, None, :] * (detail * mottle)[..., None], 0, 1)
    # Dust settles into grout lines and pores, filling them (shallower normals, rougher).
    k = (crevice * r.get("dust", 0.0) * 0.7)[..., None]
    tinted = tinted * (1 - k) + srgb(DUST)[None, None, :] * k
    # Weathering: streaks and stains toward the darker GRIME, a little rougher where they are.
    wmask = weathering(n, seed, r.get("streaks", 0.0), r.get("stains", 0.0))
    kw = (wmask * 0.4)[..., None]
    tinted = tinted * (1 - kw) + srgb(GRIME)[None, None, :] * kw
    flat = np.array([0.5, 0.5, 1.0])
    normal = normal * (1 - 0.5 * k) + flat * 0.5 * k
    normal = (normal * 2 - 1) / np.maximum(np.linalg.norm(normal * 2 - 1, axis=-1, keepdims=True), 1e-6) * 0.5 + 0.5
    for _ in range(4):  # undo clipping drift so the mean lands on the palette
        mean = weighted_mean(tinted, weights)
        tinted = np.clip(tinted * (target / np.maximum(mean, 1e-6)), 0, 1)
    breakup = r.get("breakup", 0.05) * periodic_noise(n, 1, 5, seed + 1)
    rmap = np.clip(r["rough"] + (rough - rough.mean()) * 0.6 + breakup + 0.12 * k[..., 0] + 0.08 * wmask, 0.05, 1)
    if alpha is not None:
        # Transparent texels keep the surface colour so filtering never darkens the edges.
        tinted = np.where(alpha[..., None] > 0, tinted, target[None, None, :])
    one = np.ones((n, n))
    return dict(
        base=np.concatenate([tinted, (alpha if alpha is not None else one)[..., None]], -1),
        orm=np.stack([one, rmap, np.zeros((n, n)), one], -1),
        normal=np.concatenate([normal, one[..., None]], -1),
        weights=weights,
    )


def check_atlas_layout():
    """Regions inside the sheet, never overlapping; every surface on an existing region."""
    taken = np.zeros((ATLAS // 128, ATLAS // 128), bool)
    for name, r in REGIONS.items():
        x, y, s = r["rect"]
        assert x % 128 == 0 and y % 128 == 0 and s % 128 == 0 and x + s <= ATLAS and y + s <= ATLAS, name
        block = taken[y // 128 : (y + s) // 128, x // 128 : (x + s) // 128]
        assert not block.any(), f"atlas region {name} overlaps another"
        block[:] = True
    for name, s in SURFACES.items():
        assert s["region"] in REGIONS, name
        assert s["color"] in COLORS, name
    return int(taken.sum()) * 128 * 128 / ATLAS**2


def build_atlas():
    usage = check_atlas_layout()
    base = np.zeros((ATLAS, ATLAS, 4), np.float32)
    orm = np.zeros((ATLAS, ATLAS, 4), np.float32)
    nrm = np.zeros((ATLAS, ATLAS, 4), np.float32)
    base[..., 3] = orm[..., 3] = nrm[..., 3] = 1
    nrm[..., :3] = (0.5, 0.5, 1.0)
    orm[..., 0] = 1
    orm[..., 1] = 0.9
    base[..., :3] = srgb(PALETTE["cream"])  # unused cells: a neutral colour, so mips never bleed black
    cache = {}
    tiles = {}
    for name, r in REGIONS.items():
        x, y, s = r["rect"]
        p = pad_for(s)
        tile = region_tile(name, r, s - 2 * p, cache)
        tiles[name] = tile
        base[y : y + s, x : x + s] = wrap_pad(tile["base"], p)
        orm[y : y + s, x : x + s] = wrap_pad(tile["orm"], p)
        nrm[y : y + s, x : x + s] = wrap_pad(tile["normal"], p)
    # Each surface's mean colour; surfaces sharing a lighter region get a COLOR_0 tint.
    palette, amenity = {}, {}
    for name, s in SURFACES.items():
        r = REGIONS[s["region"]]
        tile = tiles[s["region"]]
        texels, weights = tile["base"][::2, ::2, :3], tile["weights"][::2, ::2]
        if s["color"] == r["color"]:
            tint, mean = np.ones(3), weighted_mean(texels, weights)
        else:
            tint, mean = solve_tint(texels, weights, COLORS[s["color"]])
            assert (tint <= 1.0005).all(), f"{name} needs a lighter region than {s['region']} (tint {tint})"
            tint = np.minimum(tint, 1.0)
        SLOT_TINT[name] = tint
        off = np.abs(np.round(mean * 255) - np.round(srgb(COLORS[s["color"]]) * 255)).max()
        assert off <= 2, f"{name} mean {hex_of(mean)} is {off}/255 off its palette colour {COLORS[s['color']]}"
        entry = {"key": s["color"], "palette": COLORS[s["color"]], "mean": hex_of(mean), "region": s["region"]}
        if s["color"] != r["color"]:
            entry["tint"] = [round(float(c), 4) for c in tint]
        (palette if s["color"] in PALETTE else amenity)[name] = entry
    MATERIALS_REPORT.clear()
    MATERIALS_REPORT.update(
        amenityPalette=amenity,
        dust=DUST,
        atlasUsage=round(usage, 3),
        regions={name: {"rect": list(r["rect"]), "src": r["src"], "cell": r["cell"], "texelDensity": round(texel_density(name), 1)} for name, r in REGIONS.items()},
    )
    images = {}
    for key, data, colorspace in (("base", base, "sRGB"), ("orm", orm, "Non-Color"), ("normal", nrm, "Non-Color")):
        img = bpy.data.images.new(f"atlas-{key}", ATLAS, ATLAS, alpha=True)
        img.colorspace_settings.name = colorspace
        img.pixels.foreach_set(data.astype(np.float32).ravel())
        img.filepath_raw = os.path.join(OUT, f"atlas-{key}.png")
        img.file_format = "PNG"
        img.save()
        images[key] = img
    log("atlas written", {k: v["mean"] for k, v in {**palette, **amenity}.items()})
    return images, palette


# ------------------------------------------------------------------ modelling helpers

# Material slots used while modelling: one per surface (SURFACES), then the special materials.
SPECIAL = ["glass", "clear", "brass", "bronze", "emissive"]
SLOTS = SURFACE_NAMES + SPECIAL
SLOT = {name: i for i, name in enumerate(SLOTS)}
TMP_MATS = []


def tmp_materials():
    if not TMP_MATS:
        for name in SLOTS:
            TMP_MATS.append(bpy.data.materials.new(f"tmp-{name}"))
    return TMP_MATS


def add_box(bm, w, h, d, x, y, z, slot):
    """Axis-aligned box: centre (x, z), base at y. Three.js space."""
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    for v in verts:
        v.co = Vector((x + v.co.x * w, y + (v.co.y + 0.5) * h, z + v.co.z * d))
    faces = {f for v in verts for f in v.link_faces}
    for f in faces:
        f.material_index = SLOT[slot]
    return faces


def add_cylinder(bm, r, h, x, y, z, slot, segments=12):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r, depth=h)
    rot = Matrix.Rotation(math.pi / 2, 4, "X")
    for v in res["verts"]:
        v.co = rot @ v.co
        v.co += Vector((x, y + h / 2, z))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = SLOT[slot]


def add_quad(bm, corners, slot):
    verts = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(verts)
    f.material_index = SLOT[slot]
    return f


class Solid:
    """One modelled piece: boxes, optional cutters (boolean difference) and a bevel."""

    def __init__(self, bevel=0.05, segments=2):
        self.bm = bmesh.new()
        self.cut = bmesh.new()
        self.bevel = bevel
        self.segments = segments
        self.has_cut = False

    def box(self, *a, **k):
        return add_box(self.bm, *a, **k)

    def cutter(self, w, h, d, x, y, z, slot):
        add_box(self.cut, w, h, d, x, y, z, slot)
        self.has_cut = True

    def to_mesh(self):
        me = bpy.data.meshes.new("solid")
        self.bm.to_mesh(me)
        for m in tmp_materials():
            me.materials.append(m)
        obj = bpy.data.objects.new("solid", me)
        bpy.context.scene.collection.objects.link(obj)
        cut_obj = None
        if self.has_cut:
            cme = bpy.data.meshes.new("cut")
            self.cut.to_mesh(cme)
            for m in tmp_materials():
                cme.materials.append(m)
            cut_obj = bpy.data.objects.new("cut", cme)
            bpy.context.scene.collection.objects.link(cut_obj)
            cut_obj.hide_render = True
            mod = obj.modifiers.new("cut", "BOOLEAN")
            mod.operation = "DIFFERENCE"
            mod.solver = "EXACT"
            mod.material_mode = "INDEX"
            mod.object = cut_obj
        if self.bevel > 0 and HIGH:
            mod = obj.modifiers.new("bevel", "BEVEL")
            mod.width = self.bevel
            mod.segments = self.segments
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(30)
            mod.use_clamp_overlap = True
            mod.material = -1
        dg = bpy.context.evaluated_depsgraph_get()
        result = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        bpy.data.objects.remove(obj)
        bpy.data.meshes.remove(me)
        if cut_obj:
            bpy.data.objects.remove(cut_obj)
            bpy.data.meshes.remove(cme)
        self.bm.free()
        self.cut.free()
        return result


class Asset:
    """Collects solids and loose geometry for one asset type, in three.js local space."""

    def __init__(self, name):
        self.name = name
        self.meshes = []
        self.loose = bmesh.new()

    def solid(self, bevel=0.05, segments=2):
        s = Solid(bevel, segments)
        self.meshes.append(s)
        return s

    def box(self, *a, **k):
        return add_box(self.loose, *a, **k)

    def build(self):
        bm = bmesh.new()
        for s in self.meshes:
            me = s.to_mesh()
            bm.from_mesh(me)
            bpy.data.meshes.remove(me)
        me = bpy.data.meshes.new("loose")
        self.loose.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        self.loose.free()
        return bm


# ------------------------------------------------------------------ architectural pieces

def parapet(asset, w, d, y, cx=0.0, cz=0.0, slot="plaster_cream", skip=()):
    """0.7 m high, 0.35 m thick parapet ring with a limestone coping cap overhanging 0.05 m."""
    t, h, cap = 0.35, 0.7, 0.08
    s = asset.solid(0.03)
    sides = {
        "front": (w, t, cx, cz + d / 2 - t / 2),
        "back": (w, t, cx, cz - d / 2 + t / 2),
        "right": (t, d - 2 * t, cx + w / 2 - t / 2, cz),
        "left": (t, d - 2 * t, cx - w / 2 + t / 2, cz),
    }
    for key, (sw, sd, sx, sz) in sides.items():
        if key in skip:
            continue
        s.box(sw, h - cap, sd, sx, y, sz, slot)
        if key in ("front", "back"):
            s.box(sw + 0.1, cap, t + 0.1, sx, y + h - cap, sz, "limestone")
        else:
            s.box(t + 0.1, cap, sd, sx, y + h - cap, sz, "limestone")
    return s


def window(solid, asset, face_z, sign, x, y, w, h, screens=None, frame=True):
    """A window recessed 0.25 m into a wall face at z=face_z (outward normal sign*z).
    Reveals come from the boolean cut, then a dark glass pane, a slim bronze frame and a
    projecting limestone sill. `screens` (a bmesh) receives a mashrabiya plane."""
    depth = 0.25
    solid.cutter(w, h, depth * 2, x, y, face_z, solid_slot(solid))
    back = face_z - sign * depth
    asset.box(w, h, 0.04, x, y, back + sign * 0.02, "glass")
    if frame and HIGH:
        f = 0.06
        fz = back + sign * 0.06
        asset.box(w, f, 0.08, x, y, fz, "bronze")
        asset.box(w, f, 0.08, x, y + h - f, fz, "bronze")
        asset.box(f, h, 0.08, x - w / 2 + f / 2, y, fz, "bronze")
        asset.box(f, h, 0.08, x + w / 2 - f / 2, y, fz, "bronze")
        if h > 1.6:
            asset.box(f * 0.7, h, 0.06, x, y, fz, "bronze")  # mullion
    # Sill: projects 0.07 m beyond the face.
    asset.box(w + 0.2, 0.07, depth + 0.07, x, y - 0.07, face_z - sign * (depth - 0.07) / 2, "limestone")
    if screens is not None:
        z = face_z - sign * 0.07
        corners = [(x - w / 2, y, z), (x + w / 2, y, z), (x + w / 2, y + h, z), (x - w / 2, y + h, z)]
        add_quad(screens, corners if sign > 0 else corners[::-1], "lattice")


def solid_slot(solid):
    """The region a solid's cut faces (reveals) take: the slot of its first face."""
    for f in solid.bm.faces:
        return SLOTS[f.material_index]
    return "plaster_cream"


def window_row(solid, asset, width, face_z, sign, y, h, spacing, cx=0.0, skip=None, screens=None):
    n = max(1, int((width - 3) // spacing))
    start = cx - (n - 1) * spacing / 2
    for i in range(n):
        x = start + i * spacing
        if skip and skip(x):
            continue
        window(solid, asset, face_z, sign, x, y, 0.95, h, screens=screens)


def plinth(asset, w, d, cx=0.0, cz=0.0, cutters=()):
    """0.4 m stone plinth course around a wall footprint."""
    s = asset.solid(0.03)
    s.box(w + 0.06, 0.4, d + 0.06, cx, 0, cz, "stone")
    for c in cutters:
        s.cutter(*c, "stone")
    return s


def ac_unit(asset, x, y, z, rot=False):
    w, d = (0.9, 0.42) if not rot else (0.42, 0.9)
    asset.box(w, 0.62, d, x, y, z, "slab")
    if not rot:
        asset.box(0.7, 0.45, 0.02, x, y + 0.08, z + d / 2 + 0.01, "bronze")
    else:
        asset.box(0.02, 0.45, 0.7, x + w / 2 + 0.01, y + 0.08, z, "bronze")
    asset.box(w + 0.1, 0.1, d + 0.1, x, y - 0.1, z, "slab")


def drain_spout(asset, x, y, z, sign):
    asset.box(0.14, 0.1, 0.5, x, y, z + sign * 0.25, "limestone")


def entrance(solid_front, asset, face_z, x, plinth_cutters, canopy_w=4.4):
    """Recessed dark timber door (1.8 x 2.8) under a slim brass canopy with a warm downlight strip."""
    solid_front.cutter(1.8, 2.8, 0.7, x, 0, face_z, solid_slot(solid_front))
    plinth_cutters.append((1.8, 2.8, 0.9, x, 0, face_z))
    asset.box(1.8, 2.8, 0.08, x, 0, face_z - 0.3, "timber")
    asset.box(0.05, 0.6, 0.05, x + 0.6, 1.0, face_z - 0.24, "brass")  # pull
    asset.box(canopy_w, 0.14, 1.8, x, 3.2, face_z + 0.9, "brass")
    asset.box(canopy_w - 0.8, 0.02, 0.3, x, 3.185, face_z + 1.2, "emissive")


def hedge(asset, w, d, plot=None):
    """Low trimmed hedge on three sides of the plot (open toward the boulevard). `plot` is the
    plot in the villa's own axes, (half width, front z, back z): the hedge then runs inside its
    back and side lines (28 ha masterplan); without it, the 7 ha layout's generic plot."""
    s = asset.solid(0.14, 2)
    if plot:
        hw, front, back = plot
        s.box(2 * hw, 0.9, 0.7, 0, 0, back + 0.35, "hedge")
        for sx in (-1, 1):
            s.box(0.7, 0.9, front - back - 0.7, sx * (hw - 0.35), 0, (front + back + 0.7) / 2, "hedge")
        return
    pw, pd = w + 6, d + 12
    s.box(pw, 0.9, 0.7, 0, 0, -pd / 2 + 2, "hedge")
    s.box(0.7, 0.9, pd - 4, pw / 2, 0, -2, "hedge")
    s.box(0.7, 0.9, pd - 4, -pw / 2, 0, -2, "hedge")


def mass(asset, w, h, d, cx, cz, slot, y=0.0):
    s = asset.solid(0.05)
    s.box(w, h, d, cx, y, cz, slot)
    return s


# ------------------------------------------------------------------ villas

def villa_courtyard(w, d, h, screens, plot=None):
    a = Asset("villa-courtyard")
    wing = 6.0
    pc = []
    front = mass(a, w, h, wing, 0, d / 2 - wing / 2, "plaster_cream")
    back = mass(a, w, h - 0.6, wing, 0, -d / 2 + wing / 2, "plaster_shade")
    right = mass(a, wing, h - 0.3, d - 2 * wing, w / 2 - wing / 2, 0, "plaster_cream")
    left = mass(a, wing, h - 0.3, d - 2 * wing, -w / 2 + wing / 2, 0, "plaster_shade")
    # Front facade: ground slots, upper windows with mashrabiya, entrance.
    window_row(front, a, w, d / 2, 1, 1.0, 2.3, 3.4, skip=lambda x: abs(x) < 1.2)
    window_row(front, a, w, d / 2, 1, 4.4, 1.9, 3.4, screens=screens)
    entrance(front, a, d / 2, 0, pc)
    # Back facade: upper windows every 4.2 m.
    window_row(back, a, w, -d / 2, -1, 4.4, 1.9, 4.2)
    # Courtyard-facing glazing on the ground floor.
    window_row(front, a, w - 2 * wing, d / 2 - wing, -1, 0.4, 2.6, 3.4)
    window_row(back, a, w - 2 * wing, -d / 2 + wing, 1, 0.4, 2.6, 3.4)
    plinth(a, w, wing, 0, d / 2 - wing / 2, pc)
    plinth(a, w, wing, 0, -d / 2 + wing / 2)
    plinth(a, wing, d - 2 * wing, w / 2 - wing / 2, 0)
    plinth(a, wing, d - 2 * wing, -w / 2 + wing / 2, 0)
    # Parapets on each wing's own roof.
    parapet(a, w, wing, h, 0, d / 2 - wing / 2)
    parapet(a, w, wing, h - 0.6, 0, -d / 2 + wing / 2, "plaster_shade")
    parapet(a, wing, d - 2 * wing, h - 0.3, w / 2 - wing / 2, 0, skip=("front", "back"))
    parapet(a, wing, d - 2 * wing, h - 0.3, -w / 2 + wing / 2, 0, "plaster_shade", skip=("front", "back"))
    # Courtyard paving and a 2.2 m fountain basin.
    a.box(w - 2 * wing, 0.12, d - 2 * wing, 0, 0, 0, "courtyard")
    basin = a.solid(0.04)
    basin.box(2.2, 0.5, 2.2, 0, 0, 0, "limestone")
    basin.cutter(1.8, 0.5, 1.8, 0, 0.22, 0, "mosaic")
    a.box(0.18, 0.5, 0.18, 0, 0.2, 0, "limestone")  # spout
    # Stair tower (4.2 x 4.2 x 2.6 above the main roof line) at the back-right corner.
    tx, tz = w / 2 - 3, -d / 2 + 3
    tower = mass(a, 4.2, 2.6 + 0.6, 4.2, tx, tz, "plaster_cream", y=h - 0.6)
    tower.cutter(0.6, 2.2, 0.9, tx - 2.1, h - 0.6, tz, "plaster_cream")  # roof door, courtyard side
    a.box(0.06, 2.2, 0.9, tx - 2.1 + 0.22, h - 0.6, tz, "timber")
    parapet(a, 4.2, 4.2, h + 2.6, tx, tz)
    # Rooftop: two condensers and drain spouts.
    ac_unit(a, -6.0, h, d / 2 - 3.2)
    ac_unit(a, -8.0, h - 0.6, -d / 2 + 3.0)
    drain_spout(a, -w / 2 + 2.0, h - 0.05, -d / 2, -1)
    drain_spout(a, w / 2 - 6.5, h - 0.65, -d / 2, -1)
    hedge(a, w, d, plot)
    return a


def villa_garden(w, d, h, screens, kind, plot=None):
    a = Asset(f"villa-{kind}")
    low_w = w * 0.42
    main_w = w - low_w
    mx = -low_w / 2
    lx, lz, lh, ld = (w - low_w) / 2, -d * 0.1, h * 0.55, d * 0.8
    pc = []
    main = mass(a, main_w, h, d, mx, 0, "plaster_cream")
    low = mass(a, low_w, lh, ld, lx, lz, "plaster_shade")
    door_x = mx
    window_row(main, a, main_w, d / 2, 1, 1.0, 2.3, 3.4, cx=mx, skip=lambda x: abs(x - door_x) < 1.6)
    window_row(main, a, main_w, d / 2, 1, 4.4, 1.9, 3.4, cx=mx, screens=screens)
    window_row(main, a, main_w, -d / 2, -1, 4.4, 1.9, 4.2, cx=mx)
    window_row(main, a, main_w, -d / 2, -1, 1.0, 2.3, 3.4, cx=mx)
    window_row(low, a, low_w + 2, lz + ld / 2, 1, 1.0, 2.3, 3.4, cx=lx)
    window_row(low, a, low_w + 2, lz - ld / 2, -1, 1.0, 2.3, 3.4, cx=lx)
    entrance(main, a, d / 2, door_x, pc)
    plinth(a, main_w, d, mx, 0, pc)
    plinth(a, low_w, ld, lx, lz)
    parapet(a, main_w, d, h, mx, 0)
    # Roof terrace on the low wing (open to the main mass) with a timber pergola.
    parapet(a, low_w, ld, lh, lx, lz, "plaster_shade", skip=("left",))
    a.box(low_w - 0.8, 0.04, ld - 0.8, lx + 0.2, lh, lz, "timber")  # deck
    beam_len = ld * 0.7
    for i in range(6):
        bx = lx - low_w / 2 + 0.6 + i * (low_w / 6)
        a.box(0.18, 0.18, beam_len, bx, lh + 2.4, lz, "timber")
    post_z = lz + d * 0.33
    for sx in (-1, 1):
        a.box(0.25, 2.4, 0.25, lx + sx * (low_w / 2 - 0.5), lh, post_z, "timber")
    a.box(low_w - 0.6, 0.22, 0.22, lx, lh + 2.18, post_z, "timber")  # header on the posts
    # Rooftop: condensers, a water tank on a stand, drain spouts.
    ac_unit(a, mx - main_w / 2 + 2.0, h, d / 2 - 2.5)
    tank_x, tank_z = mx + main_w / 2 - 2.0, -d / 2 + 2.2
    for sx in (-1, 1):
        for sz in (-1, 1):
            a.box(0.08, 0.75, 0.08, tank_x + sx * 0.42, h, tank_z + sz * 0.42, "bronze")
    a.box(1.05, 0.06, 1.05, tank_x, h + 0.75, tank_z, "bronze")
    add_cylinder(a.loose, 0.55, 1.15, tank_x, h + 0.81, tank_z, "slab")
    drain_spout(a, mx - main_w / 2 + 1.2, h - 0.05, -d / 2, -1)
    drain_spout(a, lx + low_w / 2 - 1.0, lh - 0.05, lz - ld / 2, -1)
    # Garden pool behind, with a limestone coping and mosaic tile. It stops 3.6 m out so the
    # back hedge and the garden trees (placed by layout.ts) stay on dry land.
    pool_w, pool_d = w * 0.5, 3.6
    px, pz = -w * 0.15, -d / 2 - pool_d / 2 - 0.05
    # The basin floor stays above the pad: the terrain mesh is the ground at PAD_Y.
    pool = a.solid(0.03)
    pool.box(pool_w + 0.6, 0.32, pool_d, px, 0, pz, "limestone")
    pool.cutter(pool_w, 0.4, pool_d - 0.6, px, 0.06, pz, "mosaic")
    hedge(a, w, d, plot)
    return a


# ------------------------------------------------------------------ apartments

def apartment():
    """Apartment block in local space: origin at (cx, PAD_Y, APARTMENT_BACK_Z), +z to the river."""
    ap = LAYOUT["apartments"]
    a = Asset("apartment")
    w, fh = ap["width"], ap["floorHeight"]
    for f, depth in enumerate(ap["floorDepths"]):
        y = f * fh
        wall_d = depth - 2.6
        slab = a.solid(0.03)
        slab.box(w + 0.8, 0.38, depth + 0.4, 0, y, depth / 2, "stone" if f == 0 else "slab")
        vol = mass(a, w, fh - 0.38, wall_d, 0, wall_d / 2, "plaster_shade" if f % 2 else "plaster_cream", y=y + 0.38)
        # Full-width river glazing band, recessed.
        vol.cutter(w - 3, 2.5, 0.5, 0, y + 0.7, wall_d, solid_slot(vol))
        a.box(w - 3, 2.5, 0.04, 0, y + 0.7, wall_d - 0.23, "glass")
        for k in range(9 if HIGH else 0):
            a.box(0.05, 2.5, 0.06, -(w - 3) / 2 + k * (w - 3) / 8, y + 0.7, wall_d - 0.19, "bronze")
        # Eight vertical cream fins.
        for i in range(8):
            a.box(0.35, fh - 0.38, 0.5, -w / 2 + 1 + i * ((w - 2) / 7), y + 0.38, wall_d + 0.2, "plaster_cream")
        # Garden facade window rhythm (skipping the stair core).
        for k in range(9):
            x = -w / 2 + 2 + k * 3.5
            if abs(x - 9) < 3.2 or (f == 0 and abs(x) < 3.6):
                continue
            window(vol, a, 0, -1, x, y + 0.38 + 0.8, 1.2, 1.8)
        # Terrace: glass balustrade with a brass handrail and a planter with low shrubs.
        front = depth
        a.box(w - 0.2, 1.0, 0.03, 0, y + 0.38, front - 0.1, "clear")
        a.box(w - 0.2, 0.05, 0.07, 0, y + 1.38, front - 0.1, "brass")
        for k in range(5 if HIGH else 0):
            a.box(0.05, 1.0, 0.05, -w / 2 + 0.2 + k * (w - 0.4) / 4, y + 0.38, front - 0.1, "brass")
        planter = a.solid(0.03)
        planter.box(w - 4, 0.6, 0.7, 0, y + 0.38, front - 0.7, "stone")
        shrubs = a.solid(0.12, 1)  # soft shrubs: one segment is enough
        run = w - 4.6
        for k in range(6):
            shrubs.box(run / 6 - 0.3, 0.42, 0.55, -run / 2 + (k + 0.5) * run / 6, y + 0.98, front - 0.7, "hedge")
        if f == 0:
            # Ground floor entrance on the garden side: glazed doors under the brass canopy.
            vol.cutter(2.6, 2.7, 0.7, 0, y + 0.38, 0, solid_slot(vol))
            a.box(2.6, 2.7, 0.04, 0, y + 0.38, 0.27, "glass")
            a.box(0.08, 2.7, 0.08, 0, y + 0.38, 0.25, "bronze")
    roof_y = 4 * fh
    d3 = ap["floorDepths"][3]
    roof = a.solid(0.03)
    roof.box(w + 0.8, 0.38, d3 + 0.4, 0, roof_y, d3 / 2, "slab")
    parapet(a, w + 0.8, d3 + 0.4, roof_y + 0.38, 0, d3 / 2)
    ac_unit(a, -10, roof_y + 0.38, 2.0)
    ac_unit(a, -7.6, roof_y + 0.38, 2.0)
    # Stair core on the garden facade, rising above the roof.
    core = mass(a, 4.5, roof_y + 1.6, 3.0, 9, -1.5, "plaster_shade")
    core.cutter(0.6, roof_y - 1.6, 0.5, 9, 1.0, -3.0, "plaster_shade")
    a.box(0.6, roof_y - 1.6, 0.04, 9, 1.0, -2.8, "glass")
    parapet(a, 4.5, 3.0, roof_y + 1.6, 9, -1.5, "plaster_shade")
    plinth(a, 4.5, 3.0, 9, -1.5)
    # Brass entrance canopy (6 x 2.4 at y 3.0) on the garden side, with a downlight strip.
    a.box(6, 0.22, 2.4, 0, 3.0, -1.2, "brass")
    a.box(5.2, 0.02, 0.3, 0, 2.985, -1.6, "emissive")
    return a


# ------------------------------------------------------------------ site

def ribbon(bm, pts, width, y_top, y_bottom, slot, offset=0.0, sides=True):
    """A solid strip along an [x, z] polyline (three.js space), `offset` metres to its left."""
    left, right = [], []
    n = len(pts)
    for i, (x, z) in enumerate(pts):
        nx, nz = pts[min(n - 1, i + 1)]
        px, pz = pts[max(0, i - 1)]
        dx, dz = nx - px, nz - pz
        ln = math.hypot(dx, dz) or 1
        ox, oz = -dz / ln, dx / ln
        c = offset
        left.append((x + ox * (c + width / 2), z + oz * (c + width / 2)))
        right.append((x + ox * (c - width / 2), z + oz * (c - width / 2)))
    top_l = [bm.verts.new((x, y_top, z)) for x, z in left]
    top_r = [bm.verts.new((x, y_top, z)) for x, z in right]
    bot_l = [bm.verts.new((x, y_bottom, z)) for x, z in left]
    bot_r = [bm.verts.new((x, y_bottom, z)) for x, z in right]
    faces = []
    for i in range(n - 1):
        faces.append(bm.faces.new((top_l[i], top_r[i], top_r[i + 1], top_l[i + 1])))
        if sides:
            faces.append(bm.faces.new((bot_l[i], bot_l[i + 1], top_l[i + 1], top_l[i])))
            faces.append(bm.faces.new((bot_r[i + 1], bot_r[i], top_r[i], top_r[i + 1])))
    if sides:
        faces.append(bm.faces.new((bot_l[0], top_l[0], top_r[0], bot_r[0])))
        faces.append(bm.faces.new((bot_r[-1], top_r[-1], top_l[-1], bot_l[-1])))
    for v in top_l + top_r + bot_l + bot_r:
        if not v.link_faces:
            bm.verts.remove(v)
    for f in faces:
        f.material_index = SLOT[slot]
        f.normal_update()
        # Make sure the top faces point up.
        if f.normal.y < -0.5:
            f.normal_flip()


def split_polyline(pts, keep):
    """Split a polyline into runs where keep(x, z) holds (for kerb gaps)."""
    runs, cur = [], []
    for p in pts:
        if keep(*p):
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) > 1]


def site():
    a = Asset("site")
    s = LAYOUT["site"]
    y0 = PAD_Y
    bw = LAYOUT["boulevards"]["width"]
    for path in LAYOUT["boulevards"]["paths"]:
        ribbon(a.loose, path, bw - 0.6, y0 + 0.06, y0 - 0.12, "paving", sides=False)  # edges hide behind the kerbs
        for side in (-1, 1):
            for run in split_polyline(path, lambda x, z: abs(x) > 3.2):
                ribbon(a.loose, run, 0.3, y0 + 0.21, y0 - 0.12, "limestone", offset=side * (bw / 2 - 0.15))
    ribbon(a.loose, LAYOUT["promenade"]["path"], LAYOUT["promenade"]["width"], y0 + 0.06, y0 - 0.12, "paving")
    ribbon(a.loose, LAYOUT["gardenAxis"]["path"], LAYOUT["gardenAxis"]["width"], y0 + 0.07, y0 - 0.12, "paving")
    # Boundary wall (2.8 x 0.6) with the gate gaps, a plinth course and a limestone coping.
    h, t = 2.8, 0.6

    def wall_run(w, d, x, z):
        # Plain boxes: a bevel on ~750 m of wall, cut on the trim grid, would cost more than the
        # whole villa set, and it is never seen closer than the street view.
        a.box(w, h - 0.1, d, x, y0, z, "wall")
        a.box(w + (0.1 if w == t else 0), 0.1, d + (0.1 if d == t else 0), x, y0 + h - 0.1, z, "limestone")
        a.box(w + (0.08 if w == t else 0), 0.4, d + (0.08 if d == t else 0), x, y0, z, "stone")

    for side, x in (("minX", s["minX"]), ("maxX", s["maxX"])):
        g0, g1 = LAYOUT["gates"][side]
        zs = [s["minZ"], g1 - 9, g1 + 9, g0 - 9, g0 + 9, s["maxZ"] - 8]
        for i in range(0, len(zs), 2):
            ln = zs[i + 1] - zs[i]
            wall_run(t, ln, x, zs[i] + ln / 2)
        # Gate pavilions flank each gate, joined by a brass lintel.
        for gz in (g0, g1):
            for sgn in (-1, 1):
                pav = mass(a, 4.5, 5, 4.5, x, gz + sgn * 9.5, "plaster_cream", y=y0)
                pav.box(4.56, 0.4, 4.56, x, y0, gz + sgn * 9.5, "stone")
                a.box(4.6, 0.12, 4.6, x, y0 + 5 - 0.06, gz + sgn * 9.5, "limestone")
            a.box(1.2, 0.5, 23.5, x, y0 + 5, gz, "brass")
    wall_run(s["maxX"] - s["minX"], t, 0, s["minZ"])
    # Reflecting pool rim in limestone (the water plane stays in code).
    pr = LAYOUT["poolRim"]
    rim = a.solid(0.04)
    rim.box(pr["width"], pr["height"], pr["depth"], pr["x"], y0, pr["z"], "limestone")
    rim.cutter(pr["width"] - 1.2, 0.5, pr["depth"] - 1.0, pr["x"], y0 + 0.12, pr["z"], "mosaic")
    return a


def lamp():
    """Slim bronze street lamp, 5.4 m, with a warm emissive head (arm points along local +z)."""
    a = Asset("lamp")
    add_cylinder(a.loose, 0.16, 0.35, 0, 0, 0, "bronze", 10)
    add_cylinder(a.loose, 0.065, 5.2, 0, 0.35, 0, "bronze", 8)
    a.box(0.06, 0.06, 0.9, 0, 5.4, 0.42, "bronze")
    a.box(0.24, 0.1, 0.5, 0, 5.32, 0.85, "bronze")
    a.box(0.2, 0.02, 0.44, 0, 5.30, 0.85, "emissive")
    return a


def bench():
    a = Asset("bench")
    sol = a.solid(0.03)
    sol.box(2.2, 0.12, 0.55, 0, 0.38, 0, "limestone")
    sol.box(0.3, 0.38, 0.5, -0.8, 0, 0, "limestone")
    sol.box(0.3, 0.38, 0.5, 0.8, 0, 0, "limestone")
    return a


# ------------------------------------------------------------------ UVs

def drop_hidden_bottoms(bm, ground_y):
    """Delete downward faces resting on the ground: never seen, but they cost triangles and AO texels."""
    gone = [f for f in bm.faces if f.normal.y < -0.99 and f.calc_center_median().y < ground_y + 0.02]
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")


def cell_split_and_uv(bm):
    """Cut every face on its surface's world grid (the atlas region's cell), then planar-project
    UV0 into that cell, so each region tiles seamlessly inside the trim sheet."""
    eps = 1e-4
    for slot_index, name in enumerate(SURFACE_NAMES):
        cell = region_of(name)["cell"]
        for axis in range(3):
            faces = [f for f in bm.faces if f.material_index == slot_index]
            if not faces:
                break
            lo = min(v.co[axis] for f in faces for v in f.verts)
            hi = max(v.co[axis] for f in faces for v in f.verts)
            for k in range(math.floor(lo / cell) + 1, math.ceil(hi / cell)):
                c = k * cell
                cut = [
                    f
                    for f in bm.faces
                    if f.material_index == slot_index
                    and min(v.co[axis] for v in f.verts) < c - eps
                    and max(v.co[axis] for v in f.verts) > c + eps
                ]
                if not cut:
                    continue
                geom = list({e for f in cut for e in f.edges}) + cut + list({v for f in cut for v in f.verts})
                no = Vector((0, 0, 0))
                no[axis] = 1
                co = Vector((0, 0, 0))
                co[axis] = c
                bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        f.normal_update()
        if f.material_index >= len(SURFACE_NAMES):
            for l in f.loops:
                l[uv].uv = (0.0, 0.0)
            continue
        name = SURFACE_NAMES[f.material_index]
        cell = region_of(name)["cell"]
        ux, uy, us = inner_rect_uv(SURFACES[name]["region"])
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        if ax == 1:
            pu, pv = 0, 2
        elif ax == 0:
            pu, pv = 2, 1
        else:
            pu, pv = 0, 1
        c = f.calc_center_median()
        cu, cv = math.floor(c[pu] / cell), math.floor(c[pv] / cell)
        for l in f.loops:
            u = min(1.0, max(0.0, l.vert.co[pu] / cell - cu))
            v = min(1.0, max(0.0, l.vert.co[pv] / cell - cv))
            l[uv].uv = (ux + u * us, uy + v * us)


# ------------------------------------------------------------------ surface colour: tint and dust

def grime_cuts(bm, ground_y):
    """Horizontal edge loops at GRIME_KNEE and GRIME_HEIGHT across the walls that cross them,
    so the dust at their base has vertex rows to follow its curve and fade out on."""
    grimy = {SLOT[n] for n, s in SURFACES.items() if s.get("grime")}
    for h in (GRIME_KNEE, GRIME_HEIGHT):
        c = ground_y + h
        cut = [
            f
            for f in bm.faces
            if f.material_index in grimy
            and abs(f.normal.y) < 0.5
            and min(v.co.y for v in f.verts) < c - 1e-4
            and max(v.co.y for v in f.verts) > c + 1e-4
        ]
        if cut:
            geom = list({e for f in cut for e in f.edges}) + cut + list({v for f in cut for v in f.verts})
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=Vector((0, c, 0)), plane_no=Vector((0, 1, 0)))


def dust_weight(surface, normal_y, height):
    """How far (0..1) a face corner moves toward the dust colour: splash-back dust on walls,
    strongest at the ground and gone by GRIME_HEIGHT (curved by GRIME_CURVE), and a light film on upward faces above
    the ground. Hedges, pool mosaic and the alpha-cut screens stay clean."""
    s = SURFACES[surface]
    if abs(normal_y) < 0.5:
        return s.get("grime", 0.0) * min(1.0, max(0.0, 1 - height / GRIME_HEIGHT)) ** GRIME_CURVE
    if normal_y > 0.7 and height > 0.3 and surface not in MASKED and s["region"] not in ("hedge", "mosaic"):
        return DUST_FILM
    return 0.0


def surface_colors(bm, ground_y):
    """COLOR_0 per face corner: the surface's palette tint times its dust. glTF multiplies base
    colour by COLOR_0, so the browser and Cycles show the same dirt. A multiply can only darken,
    so dust moves each channel toward the dust colour where that is darker (it always is for
    the light stone and plaster that carry grime). Glass, metals and lights stay white."""
    layer = bm.loops.layers.float_color.get("Color") or bm.loops.layers.float_color.new("Color")
    dust = to_linear(srgb(DUST))
    toward = {}
    for name, s in SURFACES.items():
        albedo = to_linear(srgb(COLORS[s["color"]]))
        toward[name] = 1 - np.clip(dust / np.maximum(albedo, 1e-6), 0, 1)
    n_surfaces = len(SURFACE_NAMES)
    for f in bm.faces:
        if f.material_index >= n_surfaces:
            for loop in f.loops:
                loop[layer] = (1.0, 1.0, 1.0, 1.0)
            continue
        name = SURFACE_NAMES[f.material_index]
        tint = SLOT_TINT[name]
        for loop in f.loops:
            w = dust_weight(name, f.normal.y, loop.vert.co.y - ground_y)
            c = tint * (1 - w * toward[name])
            loop[layer] = (float(c[0]), float(c[1]), float(c[2]), 1.0)


def instance_tint(key):
    """Deterministic per-copy colour multiplier (linear RGB): value 1 ± 5 % and a slight
    warm/cool shift of ± 1.8 %, centred on 1 so the palette means hold on average. Keyed by a
    stable name (e.g. "villa-07"), so a rebuild never reshuffles which house is lighter."""
    h = zlib.crc32(key.encode())
    a = (h & 0xFFFF) / 0xFFFF * 2 - 1
    b = (h >> 16) / 0xFFFF * 2 - 1
    value, warm = 1 + 0.05 * a, 0.018 * b
    return (value * (1 + warm), value, value * (1 - warm))


def apply_instance_tint(obj, key=None):
    """Stores the copy's tint as the object colour, which the atlas materials read through
    Object Info in Cycles/EEVEE renders (use_instance_tint). glTF has no per-object colour:
    for the web the same values ship as EXT_mesh_gpu_instancing `_COLOR_0`, which three's
    GLTFLoader turns into instanceColor."""
    tint = instance_tint(key or obj.name)
    obj.color = (*tint, 1.0)
    return tint


def ao_dirt(me, ao_image):
    """Dirt where the baked AO is dark: window reveals, wall feet, corners and the undersides of
    copings collect grime. Multiplies COLOR_0 of the atlas faces (material 0) toward GRIME by up
    to AO_DIRT, from the AO sampled at each corner's UV1. Run after the bake."""
    if ao_image is None or "Color" not in me.color_attributes or "UV1" not in me.uv_layers:
        return
    w, h = ao_image.size
    px = np.empty(w * h * 4, np.float32)
    ao_image.pixels.foreach_get(px)
    ao = px.reshape(h, w, 4)[..., 0]
    n = len(me.loops)
    uv = np.empty(n * 2, np.float32)
    me.uv_layers["UV1"].data.foreach_get("uv", uv)
    uv = uv.reshape(n, 2)
    a = ao[np.clip((uv[:, 1] * h).astype(int), 0, h - 1), np.clip((uv[:, 0] * w).astype(int), 0, w - 1)]
    mat = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", mat)
    counts = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_total", counts)
    atlas = np.repeat(mat == 0, counts)
    weight = AO_DIRT * smoothstep(0.85, 0.35, a) * atlas
    colours = me.color_attributes["Color"]
    c = np.empty(n * 4, np.float32)
    colours.data.foreach_get("color", c)
    c = c.reshape(n, 4)
    # The step from the light cream toward grime; darker surfaces get the same relative darkening.
    toward = 1 - np.clip(to_linear(srgb(GRIME)) / to_linear(srgb(PALETTE["cream"])), 0, 1)
    c[:, :3] *= 1 - weight[:, None] * toward[None, :]
    colours.data.foreach_set("color", c.ravel())


# ------------------------------------------------------------------ materials

def gltf_output_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    ng.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True  # single-sided in glTF, unless set otherwise below
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    return m, nt, bsdf


def plain_material(name, color, rough, metal, emissive=None, alpha=None):
    m, nt, bsdf = principled(name)
    c = [*(srgb(color) ** 2.2), 1]
    bsdf.inputs["Base Color"].default_value = c
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emissive:
        bsdf.inputs["Emission Color"].default_value = [*(srgb(emissive) ** 2.2), 1]
        bsdf.inputs["Emission Strength"].default_value = 1.6
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
        m.use_backface_culling = False
    return m


def socket(sockets, identifier):
    """A node socket by identifier (Mix nodes repeat names such as "A" across data types)."""
    return next(s for s in sockets if s.identifier == identifier)


def multiply_node(nt, a, b, name):
    """RGBA multiply at factor 1: the form the glTF exporter reads as factor x COLOR_0 x texture."""
    mix = nt.nodes.new("ShaderNodeMix")
    mix.name = name
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    socket(mix.inputs, "Factor_Float").default_value = 1.0
    nt.links.new(a, socket(mix.inputs, "A_Color"))
    nt.links.new(b, socket(mix.inputs, "B_Color"))
    return socket(mix.outputs, "Result_Color")


def atlas_material(name, atlas, ao_image, mask=False):
    """Trim-sheet material: base colour = atlas x COLOR_0 (palette tint and dust), roughness and
    metallic from the ORM atlas, the shared normal atlas, and the asset's AO bake on UV1.
    An unlinked `instance-tint` multiply (x Object Info colour) waits for use_instance_tint()."""
    m, nt, bsdf = principled(name)
    uv0 = nt.nodes.new("ShaderNodeUVMap")
    uv0.uv_map = "UVMap"
    tex_base = nt.nodes.new("ShaderNodeTexImage")
    tex_base.image = atlas["base"]
    tex_orm = nt.nodes.new("ShaderNodeTexImage")
    tex_orm.image = atlas["orm"]
    tex_nrm = nt.nodes.new("ShaderNodeTexImage")
    tex_nrm.image = atlas["normal"]
    for t in (tex_base, tex_orm, tex_nrm):
        nt.links.new(uv0.outputs["UV"], t.inputs["Vector"])
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Color"
    surface = multiply_node(nt, tex_base.outputs["Color"], vc.outputs["Color"], "surface-color")
    nt.links.new(surface, bsdf.inputs["Base Color"])
    info = nt.nodes.new("ShaderNodeObjectInfo")
    multiply_node(nt, surface, info.outputs["Color"], "instance-tint")
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex_orm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.uv_map = "UVMap"
    nt.links.new(tex_nrm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if mask:
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"
        nt.links.new(tex_base.outputs["Alpha"], rnd.inputs[0])
        nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
        m.use_backface_culling = False
        m.surface_render_method = "DITHERED"
    if ao_image is not None:
        uv1 = nt.nodes.new("ShaderNodeUVMap")
        uv1.uv_map = "UV1"
        tex_ao = nt.nodes.new("ShaderNodeTexImage")
        tex_ao.image = ao_image
        nt.links.new(uv1.outputs["UV"], tex_ao.inputs["Vector"])
        sep_ao = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex_ao.outputs["Color"], sep_ao.inputs["Color"])
        out = nt.nodes.new("ShaderNodeGroup")
        out.node_tree = gltf_output_group()
        nt.links.new(sep_ao.outputs["Red"], out.inputs["Occlusion"])
    return m


def shared_materials():
    """The scalar materials every asset shares, in SPECIAL order. They stay untextured: the web
    scene gives full sky reflections only to scalar metals and polished glass (world.ts
    applyReflections), which is what makes the brass, bronze and glass read as real."""
    return [
        plain_material("glass", PALETTE["glass"], 0.05, 0.0),
        plain_material("glass-clear", "#a9b7b0", 0.05, 0.0, alpha=0.28),
        plain_material("brass", PALETTE["brass"], 0.35, 1.0),
        plain_material("bronze", "#3d3128", 0.42, 0.85),
        plain_material("lamp-glow", "#ffd9a8", 0.6, 0.0, emissive="#ffc987"),
    ]


def use_instance_tint(materials, enabled=True):
    """Switches the atlas materials between the exported graph (atlas x COLOR_0) and the render
    graph that also multiplies each copy's object colour (apply_instance_tint). Turn it on only
    for Cycles/EEVEE renders (film, stills, lookdev) and off before a glTF export: the exporter
    cannot read Object Info and would drop the base colour texture."""
    for m in materials:
        nt = m.node_tree
        tint = nt.nodes.get("instance-tint")
        if tint is None:
            continue
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        source = socket(tint.outputs, "Result_Color") if enabled else socket(nt.nodes["surface-color"].outputs, "Result_Color")
        nt.links.new(source, bsdf.inputs["Base Color"])


# ------------------------------------------------------------------ objects, transforms

TO_BLENDER = Matrix.Rotation(math.radians(90), 4, "X")  # three (x, y, z) -> blender (x, -z, y)


def to_blender_co(x, y, z):
    return Vector((x, -z, y))


def finish_mesh(asset_name, bm, ground_y=0.0):
    bm.normal_update()
    drop_hidden_bottoms(bm, ground_y)
    grime_cuts(bm, ground_y)
    cell_split_and_uv(bm)
    surface_colors(bm, ground_y)
    for f in bm.faces:
        f.smooth = False
    me = bpy.data.meshes.new(asset_name)
    bm.to_mesh(me)
    bm.free()
    me.uv_layers[0].name = "UVMap"
    me.transform(TO_BLENDER)
    me.uv_layers.new(name="UV1")
    return me


def lightmap_uv(obj):
    """UV1 for the AO bake."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.uv_layers.active = obj.data.uv_layers["UV1"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    # Smart UV Project rather than Lightmap Pack: Lightmap Pack makes every face (and so every
    # trim-sheet cell) its own island, which shows as a grid of seams in the AO. Here each flat
    # wall stays one island, so the AO runs continuously across the cells.
    bpy.ops.uv.smart_project(angle_limit=math.radians(30), island_margin=0.01, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]


def assign_final_materials(me, mats):
    """Map modelling slots (surfaces + specials) to the asset's final materials: the atlas
    material, its alpha-cut twin for the MASKED surfaces, then the specials."""
    remap = []
    for i, name in enumerate(SLOTS):
        if name in MASKED:
            remap.append(1)
        elif i < len(SURFACE_NAMES):
            remap.append(0)
        else:
            remap.append(2 + SPECIAL.index(name))
    idx = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", idx)
    me.materials.clear()  # (this resets the face indices, so remap afterwards)
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", np.array(remap, dtype=np.int32)[idx])
    me.update()


def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ------------------------------------------------------------------ baking

def setup_cycles():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = False
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
        log("cycles device: Metal GPU")
    except Exception as e:  # noqa: BLE001 - CPU is a valid fallback for a build tool
        log("cycles device: CPU", e)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake-world")
    scene.world.light_settings.distance = 6.0


def denoise_ao(px, size):
    """Edge-preserving bilateral filter on the baked AO (luma only, island-safe)."""
    a = px.reshape(size, size, 4)[..., 0].astype(np.float64)
    out = np.zeros_like(a)
    wsum = np.zeros_like(a)
    sigma_s, sigma_r = 1.2, 0.06
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            sh = np.roll(np.roll(a, dy, 0), dx, 1)
            w = math.exp(-(dx * dx + dy * dy) / (2 * sigma_s**2)) * np.exp(-((sh - a) ** 2) / (2 * sigma_r**2))
            out += sh * w
            wsum += w
    a = out / wsum
    res = np.ones((size, size, 4), np.float32)
    res[..., 0] = res[..., 1] = res[..., 2] = a
    return res.ravel()


def bake_ao(obj, name, size, ground_y_three):
    """AO only (no sun, no direct light), the asset alone on a ground plane at its real height."""
    img = bpy.data.images.new(f"ao-{name}", size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.generated_color = (1, 1, 1, 1)
    if not BAKE:
        return img
    plane = BAKE_GROUND.get(name)  # the real graded terrain, for assets modelled in place on it
    plane_me = None
    if plane is None:
        plane_me = bpy.data.meshes.new("ground")
        s, gz = 400.0, ground_y_three  # three.js height = Blender z
        plane_me.from_pydata([(-s, -s, gz), (s, -s, gz), (s, s, gz), (-s, s, gz)], [], [(0, 1, 2, 3)])
        plane = bpy.data.objects.new("ground", plane_me)
        bpy.context.scene.collection.objects.link(plane)
    plane.hide_render = False
    # Every material on the object bakes into this asset's AO image.
    temp = []
    for m in {m for m in obj.data.materials if m}:
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        m.node_tree.nodes.active = node
        temp.append((m, node))
    # Bake in isolation: every other template also sits at the origin.
    hidden = [o for o in bpy.context.scene.objects if o not in (obj, plane) and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    t = time.time()
    bpy.ops.object.bake(type="AO", margin=8, use_clear=True, uv_layer="UV1", target="IMAGE_TEXTURES")
    for o in hidden:
        o.hide_render = False
    for m, node in temp:
        m.node_tree.nodes.remove(node)
    if plane_me is not None:
        bpy.data.objects.remove(plane)
        bpy.data.meshes.remove(plane_me)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    img.pixels.foreach_set(denoise_ao(px, size))
    img.filepath_raw = os.path.join(OUT, f"ao-{name}-{size}.png")
    img.file_format = "PNG"
    img.save()
    log(f"baked AO {name} {size}px in {time.time() - t:.1f}s")
    return img


# ------------------------------------------------------------------ main

WORLD_ASSETS = {"site", "garden"}  # modelled in place in world coordinates; the rest at the origin
BAKE_GROUND = {}  # asset name -> ground object its AO bakes against (default: a plane at its ground)
AO_SIZES = {}  # asset name -> AO bake size, where it differs from AO_SIZE


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_asset(name, build, shared, atlas, screens=None):
    """Model, UV, bake and return the template object (Blender space, at the origin)."""
    asset = build()
    bm = asset.build()
    world = name in WORLD_ASSETS  # modelled in place (world coordinates), not at the origin
    me = finish_mesh(name, bm, PAD_Y if world else 0.0)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    lightmap_uv(obj)
    ao = bpy.data.images.new(f"ao-{name}-placeholder", 4, 4)
    mats = [
        atlas_material(f"{name}-atlas", atlas, ao),
        atlas_material(f"{name}-lattice", atlas, ao, mask=True),
        *shared,
    ]
    assign_final_materials(me, mats)
    ground = PAD_Y if world else 0.0
    ao_img = bake_ao(obj, name, AO_SIZES.get(name, AO_SIZE), ground)
    if BAKE:
        ao_dirt(me, ao_img)
    for m in mats[:2]:
        for node in m.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image == ao:
                node.image = ao_img
    bpy.data.images.remove(ao)
    screen_obj = None
    if HIGH and screens is not None and len(screens.faces):
        sme = finish_mesh(f"{name}-screens", screens)
        assign_final_materials(sme, [atlas_material(f"{name}-screens-atlas", atlas, None), atlas_material(f"{name}-screen", atlas, None, mask=True), *shared])
        screen_obj = bpy.data.objects.new(f"{name}-screens", sme)
        bpy.context.scene.collection.objects.link(screen_obj)
    log(f"{name}: {tri_count(me)} tris")
    return obj, screen_obj, ao_img


def build_amenities(shared, atlas, triangles, sizes=None):
    """The one hook into scripts/blender/amenities.py (both plans build through it)."""
    return amenities.build_all(sys.modules[__name__], shared, atlas, triangles, sizes)


def place(template, name, x, y, z, rot_y=0.0):
    obj = bpy.data.objects.new(name, template.data)
    obj.location = to_blender_co(x, y, z)
    obj.rotation_euler = (0, 0, rot_y)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def main():
    os.makedirs(OUT, exist_ok=True)
    reset_scene()
    setup_cycles()
    atlas, palette_report = build_atlas()
    shared = shared_materials()
    sizes = {p["type"]: p for p in LAYOUT["villas"]}
    templates = {}
    triangles = {}
    for kind in ("courtyard", "garden-4", "garden-3"):
        p = sizes[kind]
        screens = bmesh.new()
        if kind == "courtyard":
            build = lambda p=p, s=screens: villa_courtyard(p["width"], p["depth"], p["height"], s)  # noqa: E731
        else:
            build = lambda p=p, s=screens, k=kind: villa_garden(p["width"], p["depth"], p["height"], s, k)  # noqa: E731
        obj, scr, _ = make_asset(f"villa-{kind}", build, shared, atlas, screens)
        templates[kind] = (obj, scr)
        triangles[f"villa-{kind}"] = tri_count(obj.data)
    apt, _, _ = make_asset("apartment", apartment, shared, atlas)
    triangles["apartment"] = tri_count(apt.data)
    site_obj, _, _ = make_asset("site", site, shared, atlas)
    triangles["site"] = tri_count(site_obj.data)
    # Lamps and benches: small, many copies; no AO of their own.
    lamp_me = finish_mesh("lamp", lamp().build())
    assign_final_materials(lamp_me, [atlas_material("lamp-atlas", atlas, None), atlas_material("lamp-lattice", atlas, None, mask=True), *shared])
    bench_me = finish_mesh("bench", bench().build())
    assign_final_materials(bench_me, [atlas_material("bench-atlas", atlas, None), atlas_material("bench-lattice", atlas, None, mask=True), *shared])
    triangles["lamp"] = tri_count(lamp_me)
    triangles["bench"] = tri_count(bench_me)
    build_amenities(shared, atlas, triangles)  # templates only: the 7 ha layout places none

    # The templates were baked at the origin; now place the linked copies.
    for obj in [t[0] for t in templates.values()] + [t[1] for t in templates.values() if t[1]] + [apt]:
        bpy.context.scene.collection.objects.unlink(obj)
    placed = []
    empties = []
    for v in LAYOUT["villas"]:
        obj, scr = templates[v["type"]]
        rot = 0.0 if v["facing"] == 1 else math.pi
        placed.append(place(obj, f"villa-{v['index']:02d}-{v['type']}", v["x"], PAD_Y, v["z"], rot))
        if scr:
            placed.append(place(scr, f"villa-{v['index']:02d}-screens", v["x"], PAD_Y, v["z"], rot))
        e = bpy.data.objects.new(f"villa-{v['index']:02d}", None)
        e.location = to_blender_co(v["x"], PAD_Y, v["z"])
        e.rotation_euler = (0, 0, rot)
        bpy.context.scene.collection.objects.link(e)
        empties.append(e)
    ap = LAYOUT["apartments"]
    for i, cx in enumerate(ap["x"]):
        placed.append(place(apt, f"apartment-{i}", cx, PAD_Y, ap["backZ"]))
    placed.append(site_obj)
    s = LAYOUT["site"]
    bw = LAYOUT["boulevards"]["width"]
    lamp_tpl = bpy.data.objects.new("lamp-template", lamp_me)
    k = 0
    for path in LAYOUT["boulevards"]["paths"]:
        px, pz = np.array(path).T
        x = s["minX"] + 8 + 6.5  # midway between the 13 m palm allée
        while x <= s["maxX"] - 8:
            zc = float(np.interp(x, px, pz))  # centre line (sampled every 6 m)
            for side in (-1, 1):
                placed.append(place(lamp_tpl, f"lamp-{k:02d}", x, PAD_Y + 0.06, zc + side * (bw / 2 + 0.55), 0.0 if side == -1 else math.pi))
                k += 1
            x += 26
    bench_tpl = bpy.data.objects.new("bench-template", bench_me)
    for i, bx in enumerate((-150, -121, -62, -33, 33, 62, 121, 150) if HIGH else ()):
        placed.append(place(bench_tpl, f"bench-{i:02d}", bx, PAD_Y + 0.06, 59.4))
    log(f"placed {len(placed)} objects, {k} lamps")

    if PREVIEW:
        render_previews()

    report = {
        "villas": [
            {"name": e.name, "position": [round(e.location.x, 4), round(e.location.z, 4), round(-e.location.y, 4)]} for e in empties
        ],
        "palette": palette_report,
        "materials": MATERIALS_REPORT,
        "triangles": triangles,
        "lamps": k,
        "tier": TIER,
        "aoSize": AO_SIZE,
        "blender": bpy.app.version_string,
    }

    def export(path):
        bpy.ops.object.select_all(action="DESELECT")
        for o in placed + empties:
            o.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_texcoords=True,
            export_normals=True,
            export_materials="EXPORT",
            export_image_format="AUTO",
            export_extras=False,
            export_animations=False,
        )
        log(f"exported {path} ({os.path.getsize(path) / 1e6:.2f} MB)")

    export(os.path.join(OUT, f"compound-{TIER}.raw.glb"))
    json.dump(report, open(os.path.join(OUT, f"build-report-{TIER}.json"), "w"), indent=2)
    log("done")


def render_previews():
    """Quick EEVEE stills of the model for eyeballing the modelling (not shipped)."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(60), 0, math.radians(-60))
    scene.collection.objects.link(sun)
    scene.world.color = (0.6, 0.55, 0.5)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = {
        "villa": ((-152 + 28, 2 - 36, 1.2 + 16), (-152, 11, 4)),
        "street": ((-168, 8 - 5, 1.2 + 1.7), (-40, -8, 5.7)),
        "apartment": ((-95 + 35, 40 + 45, 22), (-95, 48, 6)),
        "garden": ((92 - 26, -107 - 30, 18), (92, -107 + 10, 3)),
    }
    for name, (pos, target) in shots.items():
        cam.location = to_blender_co(*pos)
        d = to_blender_co(*target) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, f"preview-{name}.png")
        bpy.ops.render.render(write_still=True)
    scene.render.engine = "CYCLES"


# ------------------------------------------------------------------ 28 ha masterplan (Zaitun Hills)
#
# Everything below builds LAYOUT["masterplan"] (layout.ts `plan...` exports) with the same asset
# templates: 60 villas on four rows (the two terrace rows 6 m up), 6 apartment blocks, the
# amenities (scripts/blender/amenities.py), the sales gallery, 60 carports, 7 parking courts,
# lamps and benches, plus two assets modelled in place: `site` (streets, kerbs, sidewalks,
# drives, the promenade, walks, the boundary wall following the ground, gates) and `garden` (the
# central axis: terrace, reflecting pool rim, garden steps, belvedere, stream plaza).
#
# What stays procedural in the web scene (world.ts), and why:
# - Terrain: 984 x 452 m graded ground blending into endless foothills, coloured by land use.
#   It is a height function (layout.ts planTerrainHeight) the scene already evaluates; baking it
#   would add megabytes for a surface that is mostly vertex colour. Here it is built from the
#   exported 4 m grid only as the AO bake's ground and for the film/storyboard .blend.
# - Stream and pool water: animated shaders (ripples, sun glitter) the GLB cannot carry.
# - Sky and haze: shader + prefiltered environment, and they change with day/dusk.
# - Palms, olives, citrus, people, cars: instanced at runtime from the vegetation/life GLBs
#   (tracks 3A/3B) so they sway and move, and scale per device tier.
# - Markers: interactive, status-driven UI.

MP = LAYOUT.get("masterplan")
ROAD_TOP = 0.06  # carriageway and promenade above the ground line
KERB_TOP = 0.21
SIDEWALK_TOP = 0.18
WALK_TOP = 0.07
DRIVE_TOP = 0.1
TERRACE_TOP = 0.09
SINK = -0.12  # how far hardscape reaches below the ground line


class TerrainGrid:
    """layout.json masterplan.terrain: ground heights on a regular grid (three.js x, z)."""

    def __init__(self, t):
        self.x0, self.z0, self.step = t["minX"], t["minZ"], t["step"]
        self.h = np.array(t["heightsCm"], np.float64) / 100  # rows along z, columns along x

    def y(self, x, z):
        fx, fz = (x - self.x0) / self.step, (z - self.z0) / self.step
        rows, cols = self.h.shape
        i = min(max(int(math.floor(fx)), 0), cols - 2)
        j = min(max(int(math.floor(fz)), 0), rows - 2)
        tx, tz = min(max(fx - i, 0.0), 1.0), min(max(fz - j, 0.0), 1.0)
        h = self.h
        return float((h[j, i] * (1 - tx) + h[j, i + 1] * tx) * (1 - tz) + (h[j + 1, i] * (1 - tx) + h[j + 1, i + 1] * tx) * tz)


def inside(r, x, z, pad_x=0.0, pad_z=0.0):
    return r["minX"] - pad_x <= x <= r["maxX"] + pad_x and r["minZ"] - pad_z <= z <= r["maxZ"] + pad_z


def arc_lengths(pts):
    s = [0.0]
    for (x0, _, z0), (x1, _, z1) in zip(pts, pts[1:]):
        s.append(s[-1] + math.hypot(x1 - x0, z1 - z0))
    return s


def point_at(pts, s_list, s):
    """The point at arc length s (in plan) along an [(x, y, z)] polyline."""
    s = min(max(s, 0.0), s_list[-1])
    k = max(0, min(len(pts) - 2, int(np.searchsorted(s_list, s, side="right")) - 1))
    span = (s_list[k + 1] - s_list[k]) or 1.0
    t = (s - s_list[k]) / span
    return tuple(a + (b - a) * t for a, b in zip(pts[k], pts[k + 1]))


def clip(pts, s0, s1):
    """The part of a polyline between arc lengths s0 and s1, cut exactly at both ends."""
    s_list = arc_lengths(pts)
    if s1 - s0 < 0.05:
        return []
    mid = [p for p, s in zip(pts, s_list) if s0 + 1e-6 < s < s1 - 1e-6]
    return [point_at(pts, s_list, s0), *mid, point_at(pts, s_list, s1)]


def runs_outside(pts, blocked, step=0.25):
    """Split a polyline into the runs where blocked(x, z) is false (kerb gaps at drives and
    junctions), cut exactly at the gap edges (bisection), keeping the original vertices."""
    s_list = arc_lengths(pts)
    total = s_list[-1]
    n = max(2, int(total / step) + 1)
    ss = np.linspace(0.0, total, n)
    flags = [blocked(p[0], p[2]) for p in (point_at(pts, s_list, s) for s in ss)]

    def edge(a, b, fa):
        for _ in range(12):
            m = (a + b) / 2
            p = point_at(pts, s_list, m)
            if blocked(p[0], p[2]) == fa:
                a = m
            else:
                b = m
        return (a + b) / 2

    runs, start = [], None if flags[0] else 0.0
    for k in range(1, n):
        if flags[k] != flags[k - 1]:
            e = edge(ss[k - 1], ss[k], flags[k - 1])
            if flags[k]:  # entering a gap
                runs.append((start, e))
                start = None
            else:
                start = e
    if start is not None:
        runs.append((start, total))
    return [r for r in (clip(pts, a, b) for a, b in runs) if len(r) > 1 and arc_lengths(r)[-1] > 0.3]


def offset_line(pts, off):
    """The polyline `off` metres to the left of travel (to +z when travelling +x), same heights."""
    out = []
    n = len(pts)
    for i, (x, y, z) in enumerate(pts):
        nx, _, nz = pts[min(n - 1, i + 1)]
        px, _, pz = pts[max(0, i - 1)]
        dx, dz = nx - px, nz - pz
        ln = math.hypot(dx, dz) or 1.0
        out.append((x - dz / ln * off, y, z + dx / ln * off))
    return out


def ribbon3(bm, pts, width, top, bottom, slot, sides=True):
    """A solid strip along an [(x, y, z)] centre line that follows the ground: its top `top` and
    its underside `bottom` metres above each point (ribbon() for sloping streets and walls)."""
    left = offset_line(pts, width / 2)
    right = offset_line(pts, -width / 2)
    top_l = [bm.verts.new((x, y + top, z)) for x, y, z in left]
    top_r = [bm.verts.new((x, y + top, z)) for x, y, z in right]
    bot_l = [bm.verts.new((x, y + bottom, z)) for x, y, z in left]
    bot_r = [bm.verts.new((x, y + bottom, z)) for x, y, z in right]
    faces = []
    for i in range(len(pts) - 1):
        faces.append(bm.faces.new((top_l[i], top_r[i], top_r[i + 1], top_l[i + 1])))
        if sides:
            faces.append(bm.faces.new((bot_l[i], bot_l[i + 1], top_l[i + 1], top_l[i])))
            faces.append(bm.faces.new((bot_r[i + 1], bot_r[i], top_r[i], top_r[i + 1])))
    if sides:
        faces.append(bm.faces.new((bot_l[0], top_l[0], top_r[0], bot_r[0])))
        faces.append(bm.faces.new((bot_r[-1], top_r[-1], top_l[-1], bot_l[-1])))
    for v in top_l + top_r + bot_l + bot_r:
        if not v.link_faces:
            bm.verts.remove(v)
    for f in faces:
        f.material_index = SLOT[slot]
        f.normal_update()
        if f.normal.y < -0.5:  # tops point up
            f.normal_flip()


def extend(pts, before, after):
    """A polyline lengthened straight on at both ends, at the end points' heights."""
    (x0, y0, z0), (x1, _, z1) = pts[0], pts[1]
    (xa, _, za), (xb, yb, zb) = pts[-2], pts[-1]
    l0, l1 = math.hypot(x1 - x0, z1 - z0) or 1, math.hypot(xb - xa, zb - za) or 1
    return [(x0 - (x1 - x0) / l0 * before, y0, z0 - (z1 - z0) / l0 * before), *pts, (xb + (xb - xa) / l1 * after, yb, zb + (zb - za) / l1 * after)]


def flat_line(x0, z0, x1, z1, ground, step=4.0):
    """A straight [(x, y, z)] line sampled every ~step metres, on the terrain."""
    n = max(1, round(math.hypot(x1 - x0, z1 - z0) / step))
    return [(x0 + (x1 - x0) * i / n, ground.y(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n), z0 + (z1 - z0) * i / n) for i in range(n + 1)]


def rect_box(bm, r, y, top, bottom, slot, inset=0.0):
    w, d = r["maxX"] - r["minX"] - 2 * inset, r["maxZ"] - r["minZ"] - 2 * inset
    return add_box(bm, w, top - bottom, d, (r["minX"] + r["maxX"]) / 2, y + bottom, (r["minZ"] + r["maxZ"]) / 2, slot)


def plan_site(ground):
    """Streets, kerbs, sidewalks, drives, the promenade and walks, the boundary wall and the gates,
    modelled in place on the graded ground (world coordinates)."""
    a = Asset("site")
    bm = a.loose
    st, lk = MP["street"], MP["link"]
    roads = {r["id"]: [tuple(p) for p in r["path"]] for r in MP["roads"]}
    widths = {r["id"]: r["width"] for r in MP["roads"]}
    half = st["carriageway"] / 2
    sidewalk_off = half + st["verge"] + st["sidewalk"] / 2
    link_half = lk["carriageway"] / 2
    link_xs = [roads["link-west"][0][0], roads["link-east"][0][0]]
    drives = [v["driveway"] for v in MP["villas"]] + [p["driveway"] for p in MP["parking"]]
    gate_x = MP["site"]["maxX"]
    in_drive = lambda x, z, pz=0.0: any(inside(d, x, z, 0.0, pz) for d in drives)  # noqa: E731
    near_link = lambda x, w: any(abs(x - lx) < w for lx in link_xs)  # noqa: E731
    belvedere = next(m for m in MP["amenities"] if m["kind"] == "belvedere")["footprint"]

    def kerbs(path, h, blocked):
        for side in (-1, 1):
            for run in runs_outside(offset_line(path, side * (h - 0.15)), lambda x, z, s=side: blocked(x, z, s)):
                ribbon3(bm, run, 0.3, KERB_TOP, SINK, "limestone")

    def sidewalks(path, off, width, blocked):
        for side in (-1, 1):
            for run in runs_outside(offset_line(path, side * off), lambda x, z, s=side: blocked(x, z, s)):
                ribbon3(bm, run, width, SIDEWALK_TOP, SINK, "paving")

    # Boulevard A: valley floor, gate to gate and 30 m beyond. A pedestrian crossing on the garden
    # axis, drop kerbs at every drive, the west and east link streets leave it inland (side -1).
    A = roads["boulevard-a"]
    ribbon3(bm, A, st["carriageway"] - 0.6, ROAD_TOP, SINK, "paving", sides=False)  # edges hide behind the kerbs
    kerbs(A, half, lambda x, z, s: in_drive(x, z, 1.0) or abs(x) < 4 or (s == -1 and near_link(x, link_half)))
    sidewalks(A, sidewalk_off, st["sidewalk"], lambda x, z, s: abs(x) > gate_x - 2.6 or in_drive(x, z) or (s == -1 and near_link(x, link_half)))
    a_zero = A[min(range(len(A)), key=lambda i: abs(A[i][0]))]
    for side in (-1, 1):  # the crossing's verge strips (from the paving edge), paved like the sidewalk
        add_box(bm, 8, SIDEWALK_TOP - SINK, st["verge"] + 0.3, 0, a_zero[1] + SINK, a_zero[2] + side * (half - 0.3 + (st["verge"] + 0.3) / 2), "paving")
    # Boulevard B: on the terrace between the link streets, lengthened over each junction.
    B = extend(roads["boulevard-b"], link_half, link_half)
    ribbon3(bm, B, st["carriageway"] - 0.6, ROAD_TOP, SINK, "paving", sides=False)
    kerbs(B, half, lambda x, z, s: in_drive(x, z, 1.0) or (s == 1 and near_link(x, link_half)))
    for p, q in ((B[0], B[1]), (B[-1], B[-2])):  # kerbs across both ends, between the side kerbs
        ln = math.hypot(p[0] - q[0], p[2] - q[2])
        ux, uz = (p[0] - q[0]) / ln, (p[2] - q[2]) / ln  # outward
        cx, cz = p[0] - ux * 0.15, p[2] - uz * 0.15
        e = half - 0.3
        ribbon3(bm, [(cx + uz * e, p[1], cz - ux * e), (cx - uz * e, p[1], cz + ux * e)], 0.3, KERB_TOP, SINK, "limestone")
    sidewalks(B, sidewalk_off, st["sidewalk"], lambda x, z, s: near_link(x, link_half + lk["sidewalk"]) or not (link_xs[0] < x < link_xs[1]) or in_drive(x, z) or (s == 1 and inside(belvedere, x, z, 0.0, 2.0)))
    # Link streets: from boulevard A's kerb up the olive bank to boulevard B's kerb.
    for lid in ("link-west", "link-east"):
        L = roads[lid]
        length = arc_lengths(L)[-1]
        ribbon3(bm, clip(L, half, length - half), lk["carriageway"] - 0.6, ROAD_TOP, SINK, "paving", sides=False)
        kerbs(clip(L, half, length - half), link_half, lambda x, z, s: False)
        sidewalks(clip(L, half + st["verge"] + st["sidewalk"], length - half - st["verge"] - st["sidewalk"]), link_half + lk["sidewalk"] / 2, lk["sidewalk"], lambda x, z, s: False)
    # Drives across the verge and the sidewalk (a parking court's runs on to the court).
    for d in drives:
        court = any(d is p["driveway"] for p in MP["parking"])
        cx, cz = (d["minX"] + d["maxX"]) / 2, (d["minZ"] + d["maxZ"]) / 2
        road_z = next(r for r in (A, B) if abs(float(np.interp(cx, [p[0] for p in r], [p[2] for p in r])) - cz) < 12)
        rz = float(np.interp(cx, [p[0] for p in road_z], [p[2] for p in road_z]))
        toward_road = 1 if rz > cz else -1
        r = dict(d)
        far = 1.0 if court else 0.3
        if toward_road == 1:
            r["maxZ"] += 0.3
            r["minZ"] -= far
        else:
            r["minZ"] -= 0.3
            r["maxZ"] += far
        rect_box(bm, r, ground.y(cx, cz), DRIVE_TOP, SINK, "paving")
    # The riverside promenade and the garden walks. A walk stops where an earlier one crosses it,
    # so no two paved surfaces lie in the same plane.
    ribbon3(bm, roads["promenade"], widths["promenade"], ROAD_TOP, SINK, "paving")
    done = []
    for wid in ("plaza-walk", "garden-walk", "courts-walk", "gym-walk", "lawn-walk", "orchard-walk"):
        w = roads[wid]
        if wid == "plaza-walk":  # from boulevard A's sidewalk to the stream plaza
            start = a_zero[2] + half + st["verge"] + st["sidewalk"]
            w = [(0.0, w[0][1], start), *[p for p in w if p[2] > start]]
        x0, x1 = min(p[0] for p in w), max(p[0] for p in w)
        z0, z1 = min(p[2] for p in w), max(p[2] for p in w)
        hw = widths[wid] / 2
        along_x = abs(x1 - x0) > abs(z1 - z0)
        rect = {"minX": x0 - (0 if along_x else hw), "maxX": x1 + (0 if along_x else hw), "minZ": z0 - (hw if along_x else 0), "maxZ": z1 + (hw if along_x else 0)}
        for run in runs_outside(w, lambda x, z: any(inside(r, x, z) for r in done)):
            ribbon3(bm, run, widths[wid], WALK_TOP, SINK, "paving")
        done.append(rect)
    # Boundary wall (2.8 x 0.6, limestone coping, stone plinth course) following the ground,
    # stopping inside the gate pavilions. The back wall runs on past the side walls' centre lines.
    wl = MP["wall"]
    t, h = wl["thickness"], wl["height"]
    for w in MP["walls"]:
        (x0, z0), (x1, z1) = w["from"], w["to"]
        if w["id"] == "back":
            x0, x1 = x0 - t / 2, x1 + t / 2
        line = flat_line(x0, z0, x1, z1, ground)
        ribbon3(bm, line, t, h - 0.1, -0.3, "wall")
        ribbon3(bm, line, t + 0.1, h, h - 0.1, "limestone")
        ribbon3(bm, line, t + 0.08, 0.4, -0.3, "stone")
    # Gate pavilions (4.5 x 4.5 x 5) flanking each gate, joined by the brass lintel.
    g = MP["gate"]
    for gate in MP["gates"]:
        y0 = gate["y"]
        for p in gate["pavilions"]:
            pav = mass(a, g["pavilion"], g["pavilionHeight"] + 0.3, g["pavilion"], p["x"], p["z"], "plaster_cream", y=y0 - 0.3)
            pav.box(g["pavilion"] + 0.06, 0.7, g["pavilion"] + 0.06, p["x"], y0 - 0.3, p["z"], "stone")
            add_box(bm, g["pavilion"] + 0.1, 0.12, g["pavilion"] + 0.1, p["x"], y0 + g["pavilionHeight"] - 0.06, p["z"], "limestone")
        add_box(bm, 1.2, 0.5, g["lintelLength"], gate["x"], y0 + g["pavilionHeight"], gate["z"], "brass")
    return a


STEP_RISE = 0.15
STEP_TREAD = 0.35  # 2 risers + 1 tread = 0.65 m: an easy outdoor garden stair


STEP_LANDING = 2.0


def stair_profile(z_foot, z_head, rise, flights=(13, 13, 14)):
    """The garden steps as [(z, y above the foot)] corners, plus each tread and landing as
    (z front, z back, y): flights of 0.15 m risers on 0.35 m treads with 2 m landings, and a
    level head landing for the rest of the run. The flights climb faster than the bank's slope
    and the landings are short, so the stair rides on the ground and never dips into it."""
    assert abs(sum(flights) * STEP_RISE - rise) < 1e-6, rise
    run = abs(z_head - z_foot)
    head = run - sum(flights) * STEP_TREAD - (len(flights) - 1) * STEP_LANDING
    assert head >= STEP_LANDING, head
    z, y, prof, steps = z_foot, 0.0, [(z_foot, 0.0)], []
    for fi, n in enumerate(flights):
        for _ in range(n):
            y += STEP_RISE
            steps.append((z, z - STEP_TREAD, y))
            z -= STEP_TREAD
        prof.append((z, y))
        landing = STEP_LANDING if fi < len(flights) - 1 else head
        steps.append((z, z - landing, y))
        z -= landing
        prof.append((z, y))
    return prof, steps


def carve_stair(ground, steps, clearance=0.25):
    """Lower the terrain grid under the garden steps (one grid step either side), so its 4 m
    bilinear surface, which rounds off the foot of the bank, never covers a tread. Only the
    film/bake terrain uses the grid; the web scene draws its own ground (see track 7B)."""
    f = steps["footprint"]
    _, treads = stair_profile(f["maxZ"], f["minZ"], steps["size"]["rise"])
    t = MP["terrain"]
    rows, cols = ground.h.shape
    for r in range(rows):
        z = t["minZ"] + r * t["step"]
        if not (f["minZ"] - t["step"] <= z <= f["maxZ"] + t["step"]):
            continue
        # The lowest tread within a grid step of this row.
        near = [y for z0, z1, y in treads if z1 - t["step"] <= z <= z0 + t["step"]] or [0.0]
        cap = steps["y"] + min(near) - clearance
        for c in range(cols):
            x = t["minX"] + c * t["step"]
            if f["minX"] - t["step"] <= x <= f["maxX"] + t["step"]:
                ground.h[r, c] = min(ground.h[r, c], cap)


def plan_garden():
    """The central garden axis, in place: the paved terrace around the 72 x 12 m reflecting pool
    (limestone rim, mosaic basin; the water stays in code), the garden steps up the bank, the
    belvedere at the top and the stream plaza at the foot."""
    a = Asset("garden")
    bm = a.loose
    am = {m["id"]: m for m in MP["amenities"]}
    pool, terrace, steps, bel, plaza = (am[k] for k in ("pool", "garden-terrace", "garden-steps", "belvedere", "stream-plaza"))
    y0 = terrace["y"]
    # Terrace paving around the pool, with a limestone border.
    t, p = terrace["footprint"], pool["footprint"]
    for r in (
        {"minX": t["minX"], "maxX": p["minX"], "minZ": t["minZ"], "maxZ": t["maxZ"]},
        {"minX": p["maxX"], "maxX": t["maxX"], "minZ": t["minZ"], "maxZ": t["maxZ"]},
        {"minX": p["minX"], "maxX": p["maxX"], "minZ": p["maxZ"], "maxZ": t["maxZ"]},
        {"minX": p["minX"], "maxX": p["maxX"], "minZ": t["minZ"], "maxZ": p["minZ"]},
    ):
        rect_box(bm, r, y0, TERRACE_TOP, SINK, "paving")
    tw, td = t["maxX"] - t["minX"], t["maxZ"] - t["minZ"]
    tx, tz = (t["minX"] + t["maxX"]) / 2, (t["minZ"] + t["maxZ"]) / 2
    border = a.solid(0.02, 1)
    for sx in (-1, 1):
        border.box(0.3, 0.12 - SINK, td, tx + sx * (tw / 2 - 0.15), y0 + SINK, tz, "limestone")
    border.box(tw - 0.6, 0.12 - SINK, 0.3, tx, y0 + SINK, t["maxZ"] - 0.15, "limestone")
    for sx in (-1, 1):  # the south border leaves the foot of the steps open
        sw = (tw - (steps["footprint"]["maxX"] - steps["footprint"]["minX"])) / 2 - 0.3
        border.box(sw, 0.12 - SINK, 0.3, tx + sx * (tw / 2 - 0.3 - sw / 2), y0 + SINK, t["minZ"] + 0.15, "limestone")
    # Reflecting pool rim (as on the 7 ha plan, at the masterplan's size).
    s = pool["size"]
    rim = a.solid(0.04)
    rim.box(s["width"], s["height"], s["depth"], pool["x"], y0, pool["z"], "limestone")
    rim.cutter(s["width"] - 1.2, 0.5, s["depth"] - 1.0, pool["x"], y0 + 0.12, pool["z"], "mosaic")
    # Garden steps: three flights and two landings up the bank, between stone cheek walls.
    sf = steps["footprint"]
    sw = sf["maxX"] - sf["minX"] - 0.6
    prof, treads = stair_profile(sf["maxZ"], sf["minZ"], steps["size"]["rise"])
    stair = a.solid(0.015, 1)
    for z_front, z_back, y in treads:
        stair.box(sw, y + 0.3, z_front - z_back, 0, y0 - 0.3, (z_front + z_back) / 2, "limestone")
    cheek = [(z, y0 + y) for z, y in prof]
    for sx in (-1, 1):
        line = [(sx * (sw / 2 + 0.15), y, z) for z, y in cheek]
        ribbon3(bm, line, 0.3, 0.6, -0.6 - (cheek[-1][1] - y0), "stone")
        ribbon3(bm, line, 0.4, 0.68, 0.6, "limestone")
    # Belvedere: a travertine platform at the top with a balustrade toward the valley (open to
    # the steps) and a timber pergola.
    bf, by = bel["footprint"], bel["y"]
    bw, bd = bf["maxX"] - bf["minX"], bf["maxZ"] - bf["minZ"]
    bx, bz = (bf["minX"] + bf["maxX"]) / 2, (bf["minZ"] + bf["maxZ"]) / 2
    rect_box(bm, bf, by, 0.15, -0.4, "slab")
    rail = a.solid(0.02, 1)
    open_w = sf["maxX"] - sf["minX"]
    for sx in (-1, 1):
        seg = (bw - open_w) / 2
        rail.box(seg, 0.95, 0.3, bx + sx * (open_w / 2 + seg / 2), by + 0.15, bf["maxZ"] - 0.15, "limestone")
        rail.box(0.3, 0.95, bd - 0.3, bx + sx * (bw / 2 - 0.15), by + 0.15, bz - 0.15, "limestone")
    for sx in (-1, 1):
        a.box((bw - open_w) / 2 + 0.06, 0.08, 0.4, bx + sx * (open_w / 2 + (bw - open_w) / 4), by + 1.1, bf["maxZ"] - 0.15, "limestone")
        a.box(0.4, 0.08, bd - 0.24, bx + sx * (bw / 2 - 0.15), by + 1.1, bz - 0.12, "limestone")
    post_x = [bx - bw / 2 + 1.5 + k * (bw - 3) / 3 for k in range(4)]
    post_z = [bf["maxZ"] - 1.2, bf["minZ"] + 1.2]
    for px in post_x:
        for pz in post_z:
            a.box(0.25, 2.8, 0.25, px, by + 0.15, pz, "timber")
    for pz in post_z:
        a.box(bw - 2.4, 0.24, 0.2, bx, by + 2.95, pz, "timber")
    for k in range(int((bw - 3) / (0.6 if HIGH else 1.2)) + 1):
        a.box(0.08, 0.14, bd - 1.4, bx - (bw - 3) / 2 + k * (0.6 if HIGH else 1.2), by + 3.19, bz, "timber")
    # Stream plaza: paving with a limestone border and four stone planters with clipped hedges.
    pf = plaza["footprint"]
    py = plaza["y"]
    rect_box(bm, pf, py, TERRACE_TOP, SINK, "paving")
    pw, pd = pf["maxX"] - pf["minX"], pf["maxZ"] - pf["minZ"]
    pcx, pcz = (pf["minX"] + pf["maxX"]) / 2, (pf["minZ"] + pf["maxZ"]) / 2
    pb = a.solid(0.02, 1)
    for sx in (-1, 1):
        pb.box(0.3, 0.12 - SINK, pd, pcx + sx * (pw / 2 - 0.15), py + SINK, pcz, "limestone")
    for px in (-19, -9, 9, 19):
        planter = a.solid(0.03)
        planter.box(3.2, 0.6, 1.6, pcx + px, py, pcz, "stone")
        shrub = a.solid(0.12, 1)
        shrub.box(2.8, 0.5, 1.2, pcx + px, py + 0.6, pcz, "hedge")
    return a


def terrain_object(ground):
    """The graded ground as a mesh (Blender space), from the exported 4 m grid: the ground the
    in-place assets bake their AO against, and the land in the film .blend. Not exported."""
    t = MP["terrain"]
    rows, cols = ground.h.shape
    verts = [to_blender_co(t["minX"] + c * t["step"], ground.h[r, c], t["minZ"] + r * t["step"]) for r in range(rows) for c in range(cols)]
    faces = [(r * cols + c, r * cols + c + 1, (r + 1) * cols + c + 1, (r + 1) * cols + c) for r in range(rows - 1) for c in range(cols - 1)]
    me = bpy.data.meshes.new("terrain")
    me.from_pydata(verts, [], faces)
    for f in me.polygons:
        f.use_smooth = True
    me.update()
    for f in me.polygons:  # face up (+z in Blender)
        if f.normal.z < 0:
            f.flip()
    me.update()
    obj = bpy.data.objects.new("terrain", me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def water_object(name, x0, x1, z0, z1, y):
    me = bpy.data.meshes.new(name)
    me.from_pydata([to_blender_co(x0, y, z0), to_blender_co(x1, y, z0), to_blender_co(x1, y, z1), to_blender_co(x0, y, z1)], [], [(0, 3, 2, 1)])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def local_plot(villas):
    """A villa type's plot in its own axes (x right, z toward the street): (half width, front z,
    back z). The same for every villa of the type; checked here."""
    out = None
    for v in villas:
        p = v["plot"]
        if v["facing"] == 1:
            front, back = p["maxZ"] - v["z"], p["minZ"] - v["z"]
        else:
            front, back = v["z"] - p["minZ"], v["z"] - p["maxZ"]
        mine = (round((p["maxX"] - p["minX"]) / 2, 3), round(front, 3), round(back, 3))
        assert out is None or all(abs(a - b) < 0.01 for a, b in zip(out, mine)), (v["name"], out, mine)
        out = mine
    return out


def extra_amenity(name, key, params, shared, atlas, triangles):
    """Another size of an amenities.py template (the parking courts come in three lengths),
    built the same way as amenities.build_all builds the defaults."""
    screens = bmesh.new()
    fn = amenities.BUILDERS[key]
    obj, scr, ao = make_asset(name, lambda: fn(screens, **params), shared, atlas, screens)
    amenities.apply_smooth(obj.data)
    for o in (obj, scr):
        if o and o.name in bpy.context.scene.collection.objects:
            bpy.context.scene.collection.objects.unlink(o)
    triangles[name] = tri_count(obj.data) + (tri_count(scr.data) if scr else 0)
    return {"object": obj, "screens": scr, "ao": ao, "params": params}


def collection(name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


def place_in(col, template, name, x, y, z, rot_y=0.0):
    obj = bpy.data.objects.new(name, template.data)
    obj.location = to_blender_co(x, y, z)
    obj.rotation_euler = (0, 0, rot_y)
    col.objects.link(obj)
    return obj


def move_to(col, obj):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def main_plan():
    """The 28 ha Zaitun Hills model: compound-zaitun-<tier>.raw.glb + build-report-zaitun-<tier>.json."""
    assert MP, "layout.json has no masterplan: run node scripts/export-scene-layout.mjs"
    os.makedirs(OUT, exist_ok=True)
    reset_scene()
    setup_cycles()
    ground = TerrainGrid(MP["terrain"])
    carve_stair(ground, next(m for m in MP["amenities"] if m["id"] == "garden-steps"))
    atlas, palette_report = build_atlas()
    shared = shared_materials()
    terrain = terrain_object(ground)
    for name in WORLD_ASSETS:
        BAKE_GROUND[name] = terrain
    # Smaller AO for the small amenities: the same texels per metre as a villa's at a quarter or
    # less of the bytes (a 7 m carport at 256 px is still sharper than a 24 m villa at 1024).
    for name, div in {"amenity-carport": 4, "amenity-padel": 2, "amenity-tennis": 2, "amenity-playground": 2, "amenity-parking": 2, "amenity-parking-8": 2, "amenity-parking-6": 2}.items():
        AO_SIZES[name] = AO_SIZE // div
    villas = MP["villas"]
    templates, triangles = {}, {}
    for kind in ("courtyard", "garden-4", "garden-3"):
        mine = [v for v in villas if v["type"] == kind]
        p, plot = mine[0], local_plot(mine)
        screens = bmesh.new()
        if kind == "courtyard":
            build = lambda p=p, s=screens, pl=plot: villa_courtyard(p["width"], p["depth"], p["height"], s, pl)  # noqa: E731
        else:
            build = lambda p=p, s=screens, k=kind, pl=plot: villa_garden(p["width"], p["depth"], p["height"], s, k, pl)  # noqa: E731
        obj, scr, _ = make_asset(f"villa-{kind}", build, shared, atlas, screens)
        templates[kind] = (obj, scr)
        triangles[f"villa-{kind}"] = tri_count(obj.data)
    apt, _, _ = make_asset("apartment", apartment, shared, atlas)
    triangles["apartment"] = tri_count(apt.data)
    site_obj, _, _ = make_asset("site", lambda: plan_site(ground), shared, atlas)
    triangles["site"] = tri_count(site_obj.data)
    garden_obj, _, _ = make_asset("garden", plan_garden, shared, atlas)
    triangles["garden"] = tri_count(garden_obj.data)
    lamp_me = finish_mesh("lamp", lamp().build())
    assign_final_materials(lamp_me, [atlas_material("lamp-atlas", atlas, None), atlas_material("lamp-lattice", atlas, None, mask=True), *shared])
    bench_me = finish_mesh("bench", bench().build())
    assign_final_materials(bench_me, [atlas_material("bench-atlas", atlas, None), atlas_material("bench-lattice", atlas, None, mask=True), *shared])
    triangles["lamp"] = tri_count(lamp_me)
    triangles["bench"] = tri_count(bench_me)
    sizes = {k: dict(v) for k, v in MP["assetSizes"].items()}
    court_bays = sorted({p["baysPerSide"] for p in MP["parking"]}, reverse=True)
    sizes["parking"]["bays"] = court_bays[0]
    amen = build_amenities(shared, atlas, triangles, sizes)
    parking_tpl = {court_bays[0]: amen["parking"]}
    for bays in court_bays[1:]:
        parking_tpl[bays] = extra_amenity(f"amenity-parking-{bays}", "parking", {**amen["parking"]["params"], "bays": bays}, shared, atlas, triangles)

    # Templates were baked at the origin; now the scene: linked copies in named collections.
    for obj in [t[0] for t in templates.values()] + [t[1] for t in templates.values() if t[1]] + [apt]:
        bpy.context.scene.collection.objects.unlink(obj)
    cols = {k: collection(k) for k in ("Villas", "Apartments", "Amenities", "Parking", "Site", "Fixtures", "Markers", "Film")}
    placed, empties, counts = [], [], {}
    for v in villas:
        obj, scr = templates[v["type"]]
        rot = 0.0 if v["facing"] == 1 else math.pi
        placed.append(place_in(cols["Villas"], obj, f"villa-{v['index']:02d}-{v['type']}", v["x"], v["y"], v["z"], rot))
        if scr:
            placed.append(place_in(cols["Villas"], scr, f"villa-{v['index']:02d}-screens", v["x"], v["y"], v["z"], rot))
        e = bpy.data.objects.new(f"villa-{v['index']:02d}", None)
        e.location = to_blender_co(v["x"], v["y"], v["z"])
        e.rotation_euler = (0, 0, rot)
        cols["Markers"].objects.link(e)
        empties.append(e)
        c = v["carport"]
        placed.append(place_in(cols["Parking"], amen["carport"]["object"], f"carport-{v['index']:02d}", c["x"], v["y"], c["z"], c["rotation"]))
    for b in MP["apartments"]:
        placed.append(place_in(cols["Apartments"], apt, f"apartment-{b['index']}", b["x"], b["y"], b["backZ"]))
    amenity_names = []
    for m in MP["amenities"]:
        if m["kind"] in amen:
            tpl = amen[m["kind"]]
            placed.append(place_in(cols["Amenities"], tpl["object"], m["id"], m["x"], m["y"], m["z"], m["rotation"]))
            if tpl["screens"]:
                placed.append(place_in(cols["Amenities"], tpl["screens"], f"{m['id']}-screens", m["x"], m["y"], m["z"], m["rotation"]))
            amenity_names.append(m["id"])
        elif m.get("asset") == "villa-courtyard":  # the sales gallery: the show villa
            obj, scr = templates["courtyard"]
            placed.append(place_in(cols["Amenities"], obj, f"{m['id']}-courtyard", m["x"], m["y"], m["z"], m["rotation"]))
            if scr:
                placed.append(place_in(cols["Amenities"], scr, f"{m['id']}-screens", m["x"], m["y"], m["z"], m["rotation"]))
            amenity_names.append(m["id"])
    for p in MP["parking"]:
        placed.append(place_in(cols["Parking"], parking_tpl[p["baysPerSide"]]["object"], f"parking-{p['id']}", p["x"], p["y"], p["z"], p["rotation"]))
    for o in (site_obj, garden_obj):
        move_to(cols["Site"], o)
        placed.append(o)
    lamp_tpl = bpy.data.objects.new("lamp-template", lamp_me)
    for k, f in enumerate(MP["lamps"]):
        placed.append(place_in(cols["Fixtures"], lamp_tpl, f"lamp-{k:03d}", f["x"], f["y"] + 0.06, f["z"], f["rotation"]))
    bench_tpl = bpy.data.objects.new("bench-template", bench_me)
    for k, f in enumerate(MP["benches"] if HIGH else ()):
        placed.append(place_in(cols["Fixtures"], bench_tpl, f"bench-{k:02d}", f["x"], f["y"] + 0.06, f["z"], f["rotation"]))
    counts = {
        "villas": len(villas),
        "apartmentBlocks": len(MP["apartments"]),
        "carports": len(villas),
        "parkingCourts": len(MP["parking"]),
        "lamps": len(MP["lamps"]),
        "benches": len(MP["benches"]) if HIGH else 0,
    }
    # The film/storyboard land and water (kept out of the web model; world.ts draws its own).
    move_to(cols["Film"], terrain)
    r = MP["river"]
    stream =water_object("stream-water", MP["terrain"]["minX"], -MP["terrain"]["minX"], r["near"] - 6, r["near"] + r["width"] + 6, 0.0)
    pool = next(m for m in MP["amenities"] if m["id"] == "pool")
    pf = pool["footprint"]
    pool_water = water_object("pool-water", pf["minX"] + 0.6, pf["maxX"] - 0.6, pf["minZ"] + 0.5, pf["maxZ"] - 0.5, pool["y"] + pool["size"]["height"] - 0.06)
    for o in (stream, pool_water):
        move_to(cols["Film"], o)
    placed_tris = sum(tri_count(o.data) for o in placed if o.type == "MESH")
    log(f"placed {len(placed)} objects ({placed_tris} triangles), {counts}")

    if PREVIEW:
        render_plan_previews(terrain, [stream, pool_water])

    pos = lambda o: [round(o.location.x, 4), round(o.location.z, 4), round(-o.location.y, 4)]  # noqa: E731
    report = {
        "plan": "zaitun",
        "villas": [{"name": e.name, "type": v["type"], "position": pos(e)} for e, v in zip(empties, villas)],
        "apartments": [{"name": f"apartment-{b['index']}", "position": [b["x"], b["y"], b["backZ"]]} for b in MP["apartments"]],
        "amenities": amenity_names,
        "counts": counts,
        "palette": palette_report,
        "materials": MATERIALS_REPORT,
        "triangles": triangles,
        "placedTriangles": placed_tris,
        "lamps": counts["lamps"],
        "tier": TIER,
        "aoSize": AO_SIZE,
        "aoSizes": dict(AO_SIZES),
        "blender": bpy.app.version_string,
    }

    bpy.ops.object.select_all(action="DESELECT")
    for o in placed + empties:
        o.select_set(True)
    path = os.path.join(OUT, f"compound-zaitun-{TIER}.raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_extras=False,
        export_animations=False,
    )
    log(f"exported {path} ({os.path.getsize(path) / 1e6:.2f} MB)")
    json.dump(report, open(os.path.join(OUT, f"build-report-zaitun-{TIER}.json"), "w"), indent=2)
    if BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND), check_existing=False)
        log(f"saved {BLEND}")
    log("done")


def render_plan_previews(terrain, water):
    """Quick EEVEE stills of the 28 ha model on its terrain (not shipped): the low golden-hour
    sun toward +x, a dry-earth ground and flat water, just enough to judge the modelling."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    earth = plain_material("preview-earth", "#a89068", 0.95, 0.0)
    terrain.data.materials.append(earth)
    wet = plain_material("preview-water", "#3f6f73", 0.08, 0.0)
    for w in water:
        w.data.materials.append(wet)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.color = (1.0, 0.82, 0.62)
    sun.data.angle = math.radians(1.5)
    # Toward +x and slightly toward the stream (layout PLAN_SUN), raised a little so streets read.
    sun_dir = Vector((MP["sun"]["azimuthX"], -MP["sun"]["azimuthZ"], math.tan(math.radians(22))))
    sun.rotation_euler = (-sun_dir).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)
    scene.world.color = (0.55, 0.5, 0.48)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_end = 3000
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = {
        "aerial": ((-260, 230, 330), (-40, 0, -70), 28),
        "gate": ((-452, 2.9, 1.0), (-330, 3.6, 4.5), 35),
        "garden": ((0, 22, 66), (0, 2, -80), 30),
        "terrace": ((-300, 26, -110), (-160, 8, -160), 35),
        "amenities": ((50, 28, -8), (-25, 0, -72), 32),
        "waterfront": ((-250, 14, 150), (-250, 4, 20), 35),
        "mosque": ((-370, 9, -2), (-404, 6, -26), 32),
        "steps": ((22, 9, -112), (0, 5, -140), 30),
        "link": ((-352, 12, -40), (-370, 5, -120), 32),
        "villa": ((-300, 12.5, -122), (-321, 9, -140.6), 30),
    }
    for name, (pos, target, lens) in shots.items():
        cam.data.lens = lens
        cam.location = to_blender_co(*pos)
        d = to_blender_co(*target) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, f"preview-zaitun-{name}-{TIER}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(sun)
    bpy.data.objects.remove(cam)
    terrain.data.materials.clear()
    for w in water:
        w.data.materials.clear()
    scene.render.engine = "CYCLES"


if __name__ == "__main__":
    main_plan() if PLAN == "zaitun" else main()
