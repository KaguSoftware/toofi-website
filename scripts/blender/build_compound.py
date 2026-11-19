"""
Sawad compound: scripted, reproducible Blender build of the baked architecture model.

    node scripts/export-scene-layout.mjs
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        -P scripts/blender/build_compound.py -- --tier high|low [--no-bake] [--samples 512] [--preview]

Reads scripts/blender/layout.json (written from components/sawad/scene/layout.ts) and the
CC0 source textures in scripts/blender/textures (scripts/blender/fetch_textures.sh), and
writes scripts/blender/out/:

    compound-high.raw.glb   --tier high: every asset, bevels, 2048 trim sheet, 1024 AO per asset type
    compound-low.raw.glb    --tier low: no bevels, window trims, mashrabiya screens or benches; 512 AO
    build-report-<tier>.json  villa empties, palette check, triangle counts

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
  seamless. Ambient occlusion only, baked in Cycles onto UV1 (Smart UV Project, see lightmap_uv).
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
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


# The `C` palette in components/sawad/scene/world.ts. Region means must match these.
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

# Trim-sheet regions: square (x, y, size) in pixels from the bottom-left, the CC0 source,
# the palette colour, world size of one tile in metres, mean roughness, detail contrast.
REGIONS = {
    "plaster_cream": dict(rect=(0, 0, 1024), src="white_stucco", color="cream", cell=4.0, rough=0.88, contrast=0.55),
    "plaster_shade": dict(rect=(1024, 0, 1024), src="white_stucco", color="creamShade", cell=4.0, rough=0.88, contrast=0.55),
    "paving": dict(rect=(0, 1024, 1024), src="PavingStones128", color="stone", cell=4.0, rough=0.82, contrast=0.4),
    "limestone": dict(rect=(1024, 1024, 512), src="Travertine009", color="parapet", cell=3.0, rough=0.62, contrast=0.45),
    "hedge": dict(rect=(1024, 1536, 512), src="@hedge", color="hedge", cell=1.5, rough=0.9, contrast=1.0),
    "wall": dict(rect=(1536, 1024, 256), src="white_stucco", color="wall", cell=4.0, rough=0.9, contrast=0.55),
    "courtyard": dict(rect=(1792, 1024, 256), src="PavingStones128", color="courtyard", cell=2.0, rough=0.8, contrast=0.5),
    "lattice": dict(rect=(1536, 1280, 256), src="@lattice", color="wood", cell=0.6, rough=0.7, contrast=0.0),
    "stone": dict(rect=(1792, 1280, 256), src="Travertine009", color="stone", cell=3.0, rough=0.7, contrast=0.6),
    "slab": dict(rect=(1536, 1536, 256), src="Travertine009", color="slab", cell=2.0, rough=0.62, contrast=0.35),
    "timber": dict(rect=(1792, 1536, 256), src="fine_grained_wood", color="wood", cell=1.5, rough=0.58, contrast=0.8),
    "mosaic": dict(rect=(1536, 1792, 256), src="Tiles070", color="pool", cell=1.0, rough=0.12, contrast=0.6),
}
REGION_NAMES = list(REGIONS)


def pad_for(size):
    return 16 if size >= 1024 else 8


def inner_rect_uv(name):
    x, y, s = REGIONS[name]["rect"]
    p = pad_for(s)
    return (x + p) / ATLAS, (y + p) / ATLAS, (s - 2 * p) / ATLAS


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
    color = np.repeat(shade[..., None], 3, -1)
    rough = 0.9 - 0.15 * hf
    return color, normals_from_height(hf, 3.0), rough


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
    return color, normals_from_height(hf * 2.0, 1.0), np.full((n, n), 0.7, np.float32), alpha


def build_atlas():
    base = np.zeros((ATLAS, ATLAS, 4), np.float32)
    orm = np.zeros((ATLAS, ATLAS, 4), np.float32)
    nrm = np.zeros((ATLAS, ATLAS, 4), np.float32)
    base[..., 3] = orm[..., 3] = nrm[..., 3] = 1
    nrm[..., :3] = (0.5, 0.5, 1.0)
    orm[..., 0] = 1
    orm[..., 1] = 0.9
    base[..., :3] = srgb(PALETTE["cream"])  # unused cells: a neutral colour, so mips never bleed black
    cache = {}
    report = {}
    for name, r in REGIONS.items():
        x, y, s = r["rect"]
        p = pad_for(s)
        n = s - 2 * p
        alpha = None
        if r["src"] == "@hedge":
            color, normal, rough = procedural_hedge(n)
        elif r["src"] == "@lattice":
            color, normal, rough, alpha = procedural_lattice(n)
        else:
            if r["src"] not in cache:
                folder = os.path.join(TEXTURES, r["src"])
                cache[r["src"]] = {k: load_pixels(os.path.join(folder, f"{k}.jpg")) for k in ("color", "normal", "rough")}
            src = cache[r["src"]]
            color = resize(src["color"], n)[..., :3]
            normal = resize(src["normal"], n)[..., :3]
            nv = normal * 2 - 1
            nv /= np.maximum(np.linalg.norm(nv, axis=-1, keepdims=True), 1e-6)
            normal = nv * 0.5 + 0.5
            rough = resize(src["rough"], n)[..., 0]
        # Tint: palette colour times a luminance detail map with mean 1, so the region's
        # average base colour is the palette colour (in sRGB, like the C palette).
        lum = color @ np.array([0.2126, 0.7152, 0.0722])
        detail = 1 + r["contrast"] * (lum / max(lum.mean(), 1e-6) - 1)
        target = srgb(PALETTE[r["color"]])
        tinted = np.clip(target[None, None, :] * detail[..., None], 0, 1)
        weights = alpha if alpha is not None else np.ones_like(lum)
        for _ in range(4):  # undo clipping drift so the mean lands on the palette
            mean = (tinted * weights[..., None]).sum((0, 1)) / weights.sum()
            tinted = np.clip(tinted * (target / np.maximum(mean, 1e-6)), 0, 1)
        mean = (tinted * weights[..., None]).sum((0, 1)) / weights.sum()
        report[name] = {"key": r["color"], "palette": PALETTE[r["color"]], "mean": "#" + "".join(f"{round(c * 255):02x}" for c in mean)}
        rmap = np.clip(r["rough"] + (rough - rough.mean()) * 0.6, 0.05, 1)
        if alpha is not None:
            # Transparent texels keep the lattice colour so filtering never darkens the edges.
            tinted = np.where(alpha[..., None] > 0, tinted, target[None, None, :])
        tile_base = np.concatenate([tinted, (alpha if alpha is not None else np.ones_like(lum))[..., None]], -1)
        tile_orm = np.stack([np.ones_like(rmap), rmap, np.zeros_like(rmap), np.ones_like(rmap)], -1)
        tile_nrm = np.concatenate([normal, np.ones_like(lum)[..., None]], -1)
        base[y : y + s, x : x + s] = wrap_pad(tile_base, p)
        orm[y : y + s, x : x + s] = wrap_pad(tile_orm, p)
        nrm[y : y + s, x : x + s] = wrap_pad(tile_nrm, p)
    images = {}
    for key, data, colorspace in (("base", base, "sRGB"), ("orm", orm, "Non-Color"), ("normal", nrm, "Non-Color")):
        img = bpy.data.images.new(f"atlas-{key}", ATLAS, ATLAS, alpha=True)
        img.colorspace_settings.name = colorspace
        img.pixels.foreach_set(data.astype(np.float32).ravel())
        img.filepath_raw = os.path.join(OUT, f"atlas-{key}.png")
        img.file_format = "PNG"
        img.save()
        images[key] = img
    log("atlas written", {k: v["mean"] for k, v in report.items()})
    return images, report


# ------------------------------------------------------------------ modelling helpers

# Material slots used while modelling: one per atlas region, then the special materials.
SPECIAL = ["glass", "clear", "brass", "bronze", "emissive"]
SLOTS = REGION_NAMES + SPECIAL
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


def hedge(asset, w, d):
    """Low trimmed hedge on three sides of the plot (open toward the boulevard)."""
    pw, pd = w + 6, d + 12
    s = asset.solid(0.14, 2)
    s.box(pw, 0.9, 0.7, 0, 0, -pd / 2 + 2, "hedge")
    s.box(0.7, 0.9, pd - 4, pw / 2, 0, -2, "hedge")
    s.box(0.7, 0.9, pd - 4, -pw / 2, 0, -2, "hedge")


def mass(asset, w, h, d, cx, cz, slot, y=0.0):
    s = asset.solid(0.05)
    s.box(w, h, d, cx, y, cz, slot)
    return s


# ------------------------------------------------------------------ villas

def villa_courtyard(w, d, h, screens):
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
    hedge(a, w, d)
    return a


def villa_garden(w, d, h, screens, kind):
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
    hedge(a, w, d)
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
    """Cut every face on its region's world grid, then planar-project UV0 into the atlas
    cell, so each region tiles seamlessly inside the trim sheet."""
    eps = 1e-4
    for slot_index, name in enumerate(REGION_NAMES):
        cell = REGIONS[name]["cell"]
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
        if f.material_index >= len(REGION_NAMES):
            for l in f.loops:
                l[uv].uv = (0.0, 0.0)
            continue
        name = REGION_NAMES[f.material_index]
        cell = REGIONS[name]["cell"]
        ux, uy, us = inner_rect_uv(name)
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


def atlas_material(name, atlas, ao_image, mask=False):
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
    nt.links.new(tex_base.outputs["Color"], bsdf.inputs["Base Color"])
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


# ------------------------------------------------------------------ objects, transforms

TO_BLENDER = Matrix.Rotation(math.radians(90), 4, "X")  # three (x, y, z) -> blender (x, -z, y)


def to_blender_co(x, y, z):
    return Vector((x, -z, y))


def finish_mesh(asset_name, bm, ground_y=0.0):
    bm.normal_update()
    drop_hidden_bottoms(bm, ground_y)
    cell_split_and_uv(bm)
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
    """Map modelling slots (regions + specials) to the asset's final materials."""
    lattice = SLOT["lattice"]
    remap = []
    for i, name in enumerate(SLOTS):
        if i == lattice:
            remap.append(1)
        elif i < len(REGION_NAMES):
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
    plane_me = bpy.data.meshes.new("ground")
    s, gz = 400.0, ground_y_three  # three.js height = Blender z
    plane_me.from_pydata([(-s, -s, gz), (s, -s, gz), (s, s, gz), (-s, s, gz)], [], [(0, 1, 2, 3)])
    plane = bpy.data.objects.new("ground", plane_me)
    bpy.context.scene.collection.objects.link(plane)
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

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_asset(name, build, shared, atlas, screens=None):
    """Model, UV, bake and return the template object (Blender space, at the origin)."""
    asset = build()
    bm = asset.build()
    me = finish_mesh(name, bm, PAD_Y if name == "site" else 0.0)
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
    ground = 0.0 if name != "site" else PAD_Y
    ao_img = bake_ao(obj, name, AO_SIZE, ground)
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
    shared = [
        plain_material("glass", PALETTE["glass"], 0.05, 0.0),
        plain_material("glass-clear", "#a9b7b0", 0.05, 0.0, alpha=0.28),
        plain_material("brass", PALETTE["brass"], 0.35, 1.0),
        plain_material("bronze", "#3d3128", 0.42, 0.85),
        plain_material("lamp-glow", "#ffd9a8", 0.6, 0.0, emissive="#ffc987"),
    ]
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


if __name__ == "__main__":
    main()
