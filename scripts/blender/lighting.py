"""
Zaitun Hills lighting (track 4): the golden-hour and dusk light rigs, and the web lightmaps.

    # 1. The model, kept as a generated .blend (build_compound.py stays the model's source):
    blender -b --factory-startup -P scripts/blender/build_compound.py -- --plan zaitun --tier high \
        --blend scripts/blender/out/zaitun-high.blend
    # 2. Light it, bake the day and dusk lightmaps onto UV2, export the model with UV2:
    blender -b scripts/blender/out/zaitun-high.blend -P scripts/blender/lighting.py -- --tier high \
        [--samples 512] [--states day,dusk] [--validate] [--quick]

scripts/blender/bake-lightmaps.sh runs both steps for both tiers.

Writes
    public/sawad/lightmaps/zaitun/<state>-<page>-<tier>.png  irradiance, 8-bit sRGB-encoded (6B makes KTX2)
    public/sawad/lightmaps/zaitun/lightmaps.json             pages, per-instance UV2 scale/offset, intensities
    scripts/blender/out/compound-zaitun-<tier>.lit.raw.glb   the model with UV2 (TEXCOORD_2), for 6B
    scripts/blender/out/lightmaps/<state>-<page>-<tier>.exr  float masters
    scripts/blender/out/lighting/                            sky HDRIs, validation and preview frames
    scripts/blender/lighting.report.json                     what scripts/blender/lighting.test.ts checks
--quick (quarter-size pages, 32 samples; --div 1 for full size) writes only to scripts/blender/out/quick/.

What is baked
- Diffuse irradiance (direct sun or practicals + sky + bounce, so GI, AO and soft shadows), no
  albedo: a lightmap texel is the light arriving at the surface, as three.js `lightMap` expects.
- Pages: `buildings` (villas, apartment blocks, amenities, the sales gallery, carports, parking
  courts: one tile per placed copy, because copies share their mesh but not their light), `site`
  (streets, kerbs, walls, gates and the central garden: unique objects, packed together) and
  `ground` (the terrain, projected top-down over the terrain grid, because the web scene draws
  its own ground mesh without UVs; it samples this page by world x, z).
- Not baked: street lamps, benches and mashrabiya screens (thin, many, lit in real time), water,
  sky, vegetation and people. They still cast shadows and bounce light in the bake.

Light rigs (also for the film, track 5B)
- day: the scene's golden-hour sun (world.ts: 4.2 deg up, lit 4.5 deg higher so the ground reads,
  #ffa65c at 4.2), the art-directed sky as an HDRI (world.ts's sky shader, ported, without the
  sun disc), strength matched to the web scene's hemisphere light.
- dusk: sun 5 deg below the horizon, a deep blue sky with the afterglow downstream (west), warm
  windows, and lights at every modelled fitting: street lamps, entrance canopies, carports, the
  courts' floodlights, the mosque's portico and minaret lantern, plus layout-placed in-ground
  uplights at the gate pavilions and the mosque, the gate lintel downlight, pool and playground lights.
- North (owner, 2026-11-19): the stream lies to the north, so +z is north and +x (downstream) is
  west. The sun stands at a compass bearing of about 279 deg: a real evening sun.
"""

import hashlib
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

try:
    import OpenImageIO as oiio  # bundled with Blender
except ImportError:  # pragma: no cover - only outside Blender
    oiio = None

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg_value(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


TIER = arg_value("--tier", "high")
assert TIER in ("high", "low"), TIER
QUICK = "--quick" in ARGS
SAMPLES = int(arg_value("--samples", "32" if QUICK else "512"))
STATES = arg_value("--states", "day,dusk").split(",")
VALIDATE = "--validate" in ARGS
OUT = os.path.join(HERE, "out", "quick") if QUICK else arg_value("--out", os.path.join(HERE, "out"))
WEB_OUT = os.path.join(OUT, "web") if QUICK else os.path.join(ROOT, "public", "sawad", "lightmaps", "zaitun")
REPORT = os.path.join(HERE, "lighting.report.json")
LAYOUT = json.load(open(os.path.join(HERE, "layout.json")))
MP = LAYOUT["masterplan"]
T0 = time.time()


def log(*a):
    print(f"[lighting {time.time() - T0:7.1f}s]", *a, flush=True)


# ------------------------------------------------------------------ art direction
# Mirrors components/sawad/scene/world.ts (the Zaitun sun, light lift, hemisphere, haze, sky);
# scripts/blender/lighting.test.ts checks the two stay equal.

SUN = {"elevationDeg": 4.2, "azimuthX": 0.97, "azimuthZ": 0.16, "liftDeg": 4.5, "color": "#ffa65c", "intensity": 4.2}
SUN_ANGLE_DEG = 1.0  # the sun's disc is 0.53 deg; a little wider for golden-hour softness in 50 m shadows
HEMI = {"sky": "#ffe0bf", "ground": "#6f6446", "intensity": 1.8}
HAZE = {"color": "#e6ae86", "density": 0.00072}
EXPOSURE = 0.5  # engine.ts: ACES filmic tone mapping at exposure 0.5
DUSK_EXPOSURE = 2.4  # suggested web exposure for the dusk state (blue hour is ~5x darker than golden hour)
SKY_DAY = {
    "zenith": ("#56618a", 1.5),
    "horizonAway": ("#e2ae98", 1.7),
    "horizonSun": ("#ffbd70", 1.9),
    "ground": ("#c99a72", 1.4),
    "sunColor": ((1.0, 0.6, 0.28), 1.6),
    "cloud": (0.95, 0.62, 0.55),
    "elevationDeg": SUN["elevationDeg"],
}
# Blue hour: deep blue overhead, the afterglow low over the downstream (west) horizon.
SKY_DUSK = {
    "zenith": ("#1d2850", 1.0),
    "horizonAway": ("#3d4470", 1.0),
    "horizonSun": ("#e0915f", 1.0),
    "ground": ("#2b2a33", 1.0),
    "sunColor": ((1.0, 0.42, 0.22), 0.5),
    "cloud": (0.36, 0.28, 0.4),
    "elevationDeg": -5.0,
}
DUSK_AMBIENT = 0.03  # the dusk sky's irradiance on open ground, as a fraction of the web day's hemisphere light
NORTH = {"three": [0.0, 0.0, 1.0], "given": "2026-11-19", "note": "the stream lies to the north; downstream (+x) is west"}
ERBIL = (36.19, 44.01)
MECCA = (21.4225, 39.8262)

# Pages: (width, height) on the high tier; the low tier halves both.
PAGES = {"buildings": (2048, 2048), "site": (1024, 1024), "ground": (2048, 1024)}
BAKE_COLLECTIONS = {"buildings": ("Villas", "Apartments", "Amenities", "Parking"), "site": ("Site",)}
EXPORT_COLLECTIONS = ("Villas", "Apartments", "Amenities", "Parking", "Site", "Fixtures", "Markers")
GROUND_LIFT = 0.35  # m: the ground page bakes on a copy of the terrain lifted clear of the hardscape slabs
TILE_PAD = 2  # px between tiles on a page
ISLAND_GUTTER = 3  # px between UV2 islands inside a tile
GLASS_GLOW = 1.1  # radiance of a lit window at dusk
WINDOWS_LIT = 72  # percent of villas with lights on at dusk (apartments, amenities and the gallery: all)

# Dusk fittings. E: target irradiance on axis at distance d (web units: three.js light intensity).
FIXTURES = {
    "street-lamp": {"type": "AREA", "E": 1.4, "d": 5.3, "color": "#ffcf94", "spread": 150},
    "entrance": {"type": "AREA", "E": 2.2, "d": 3.1, "color": "#ffd2a0", "spread": 150},
    "carport": {"type": "AREA", "E": 1.0, "d": 2.4, "color": "#ffd2a0", "spread": 150},
    "floodlight": {"type": "AREA", "E": 4.0, "d": 12.0, "color": "#fff1dc", "spread": 80, "tiltDeg": 50},
    "portico": {"type": "AREA", "E": 2.0, "d": 3.0, "color": "#ffcf94", "spread": 150},
    "lantern": {"type": "POINT", "E": 0.5, "d": 8.0, "color": "#ffcf94"},
    "fixture": {"type": "AREA", "E": 1.0, "d": 3.0, "color": "#ffd2a0", "spread": 150},
}
WARM = "#ffcf94"


def lightmapped(material):
    """Whether the web puts the lightmap on this material. Alpha-cut lattices, fences, nets and
    screens and the clear glass are single faces seen from both sides: one texel can't hold the
    light on both, so they keep real-time light (three.js flips their normal per side)."""
    n = material.name if material else ""
    return bool(n) and not (n.endswith("-lattice") or n.endswith("-screen") or n == "glass-clear")


# ------------------------------------------------------------------ colour and space helpers

def srgb_to_linear(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, np.float64), 0.0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def hex_linear(h):
    return srgb_to_linear([int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)])


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def to_blender(v):
    """three.js (x, y up, z) -> Blender (x, -z, y), as build_compound.py."""
    return Vector((v[0], -v[2], v[1]))


def to_three(v):
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


def sun_direction(elevation_deg, lift_deg=0.0):
    """Unit vector toward the sun in three.js space (world.ts sunDirection)."""
    el = math.radians(elevation_deg + lift_deg)
    h = math.cos(el)
    n = math.hypot(SUN["azimuthX"], SUN["azimuthZ"])
    return np.array([SUN["azimuthX"] / n * h, math.sin(el), SUN["azimuthZ"] / n * h])


def bearing_of(x, z):
    """Compass bearing (deg clockwise from north) of a three.js direction: +z north, -x east."""
    return math.degrees(math.atan2(-x, z)) % 360


def three_of_bearing(deg):
    b = math.radians(deg)
    return [round(-math.sin(b), 5), 0.0, round(math.cos(b), 5)]


def great_circle_bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return math.degrees(math.atan2(y, x)) % 360


def set_enum(owner, prop, preferred):
    """Sets the first identifier the running Blender accepts (enum names drift between versions)."""
    items = [i.identifier for i in owner.bl_rna.properties[prop].enum_items]
    for p in preferred:
        if p in items:
            setattr(owner, prop, p)
            return p
    raise ValueError(f"{prop}: none of {preferred} in {items}")


# ------------------------------------------------------------------ sky (HDRI) and sun

def sky_equirect(sky, width, height):
    """world.ts's sky shader (without the sun disc, as its environment map) as an equirectangular
    float image in Blender's layout: row 0 at the bottom, u = 0.5 looking along +x."""
    u = (np.arange(width) + 0.5) / width
    v = (np.arange(height) + 0.5) / height
    phi = (0.5 - u) * 2 * math.pi
    th = (v - 0.5) * math.pi
    ct = np.cos(th)[:, None]
    bx, by, bz = ct * np.cos(phi)[None, :], ct * np.sin(phi)[None, :], np.sin(th)[:, None] * np.ones((1, width))
    dx, dy, dz = bx, bz, -by  # three.js direction
    s = sun_direction(sky["elevationDeg"])
    col = lambda key: hex_linear(sky[key][0]) * sky[key][1]  # noqa: E731
    zen, away, toward, ground = col("zenith"), col("horizonAway"), col("horizonSun"), col("ground")
    sun_c = np.array(sky["sunColor"][0]) * sky["sunColor"][1]
    h = dy
    sun_cos = dx * s[0] + dy * s[1] + dz * s[2]
    hl = np.sqrt((dx + 1e-5) ** 2 + (dz + 1e-5) ** 2)
    sxz = np.array([s[0], s[2]]) / math.hypot(s[0], s[2])
    az = np.clip(((dx + 1e-5) / hl * sxz[0] + (dz + 1e-5) / hl * sxz[1]) * 0.5 + 0.5, 0, 1)
    mix = lambda a, b, t: a * (1 - t[..., None]) + b * t[..., None]  # noqa: E731
    horizon = mix(away[None, None, :], toward[None, None, :], az**2.2)
    t = np.clip(h, 0, 1) ** 0.36
    out = mix(horizon, zen[None, None, :], t)
    out += sun_c[None, None, :] * (np.maximum(sun_cos, 0) ** 10 * 0.55 * (1 - t * 0.7))[..., None]
    # Thin high streaks of cloud catching the light (uTime = 0).
    hp = np.maximum(h, 0) + 0.06
    px, pz = dx / hp, dz / hp
    band = (np.sin(px * 0.9 + np.sin(pz * 0.45 + 1.7) * 2.6) * 0.5 + 0.5) * (np.sin(pz * 2.3 + px * 0.3) * 0.5 + 0.5)

    def smooth(e0, e1, x):
        k = np.clip((x - e0) / (e1 - e0), 0, 1)
        return k * k * (3 - 2 * k)

    c = smooth(0.62, 0.95, band) * smooth(0.02, 0.1, h) * (1 - smooth(0.18, 0.5, h))
    cloud = mix(np.array(sky["cloud"])[None, None, :], (sun_c * 1.15)[None, None, :], az**3)
    above = mix(out, cloud, c * 0.45)
    below = mix(horizon, ground[None, None, :], smooth(0.0, -0.06, h))
    out = np.where((h > 0)[..., None], above, below)
    return np.clip(out, 0, 16).astype(np.float32)


def irradiance_up(rgb):
    """B (irradiance / pi, Blender's diffuse-bake unit) on an upward plane under this sky."""
    height, width = rgb.shape[:2]
    th = ((np.arange(height) + 0.5) / height - 0.5) * math.pi
    w = np.cos(th) * np.maximum(np.sin(th), 0) * (math.pi / height) * (2 * math.pi / width)
    return (rgb * w[:, None, None]).sum(axis=(0, 1)) / math.pi


def hemi_target():
    """The web day's hemisphere light on open ground, as B."""
    return hex_linear(HEMI["sky"]) * HEMI["intensity"] / math.pi


def make_world(state):
    sky = SKY_DAY if state == "day" else SKY_DUSK
    w, h = (1024, 512) if QUICK else (2048, 1024)
    rgb = sky_equirect(sky, w, h)
    b_up = luminance(irradiance_up(rgb))
    target = luminance(hemi_target()) * (1.0 if state == "day" else DUSK_AMBIENT)
    strength = float(target / b_up)
    img = bpy.data.images.new(f"sky-{state}", w, h, alpha=False, float_buffer=True)
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb
    img.pixels.foreach_set(px.ravel())
    write_image(os.path.join(OUT, "lighting", f"sky-{state}.exr"), rgb, half=True)
    world = bpy.data.worlds.new(f"sky-{state}")
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = img
    nt.links.new(env.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = strength
    return world, {"strength": round(strength, 5), "irradianceUp": round(float(b_up * strength * math.pi), 5)}


def add_sun(col):
    light = bpy.data.lights.new("LGT_Sun_GoldenHour", "SUN")
    light.energy = SUN["intensity"]
    light.color = tuple(hex_linear(SUN["color"]))
    light.angle = math.radians(SUN_ANGLE_DEG)
    obj = bpy.data.objects.new("LGT_Sun_GoldenHour", light)
    d = to_blender(sun_direction(SUN["elevationDeg"], SUN["liftDeg"]))
    obj.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    col.objects.link(obj)
    return obj


# ------------------------------------------------------------------ dusk practicals

def new_light(col, name, kind, power, color, location, aim=None, size=(0.2, 0.2), spread=None, spot=None):
    light = bpy.data.lights.new(name, kind)
    light.energy = power
    light.color = tuple(hex_linear(color))
    if kind == "AREA":
        light.shape = "RECTANGLE"
        light.size, light.size_y = max(size[0], 0.02), max(size[1], 0.02)
        if spread is not None:
            light.spread = math.radians(spread)
    else:
        light.shadow_soft_size = 0.08
    if kind == "SPOT" and spot:
        light.spot_size = math.radians(spot)
        light.spot_blend = 0.4
    obj = bpy.data.objects.new(name, light)
    obj.location = location
    if aim is not None:
        obj.rotation_euler = Vector(aim).normalized().to_track_quat("-Z", "Y").to_euler()
    col.objects.link(obj)
    return obj


def area_power(e, d):
    return e * math.pi * d * d  # area light on axis: E = P / (pi d^2)


def point_power(e, d):
    return e * 4 * math.pi * d * d  # point and spot: E = P / (4 pi d^2)


def emissive_clusters(me):
    """The lamp-glow faces of a mesh, grouped into fittings: [(down, centroid, size_x, size_y)]."""
    glow = {i for i, m in enumerate(me.materials) if m and m.name.startswith("lamp-glow")}
    faces = [p for p in me.polygons if p.material_index in glow]
    if not faces:
        return []
    # One fitting = one connected group of glowing faces (faces sharing a vertex).
    parent = list(range(len(faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for i, p in enumerate(faces):
        for v in p.vertices:
            if v in owner:
                parent[find(i)] = find(owner[v])
            else:
                owner[v] = i
    groups = {}
    for i in range(len(faces)):
        groups.setdefault(find(i), []).append(faces[i])
    out = []
    for fs in groups.values():
        down = [p for p in fs if p.normal.z < -0.7]
        use = down or fs
        co = np.array([me.vertices[v].co[:] for p in use for v in p.vertices])
        lo, hi = co.min(0), co.max(0)
        out.append((bool(down), Vector(((lo + hi) / 2).tolist()), float(hi[0] - lo[0]), float(hi[1] - lo[1])))
    return out


def fixture_kind(mesh_name, down):
    if mesh_name == "lamp":
        return "street-lamp"
    if mesh_name in ("amenity-padel", "amenity-tennis"):
        return "floodlight"
    if mesh_name == "amenity-carport":
        return "carport"
    if mesh_name == "amenity-mosque":
        return "portico" if down else "lantern"
    if mesh_name.startswith("villa-") or mesh_name in ("apartment", "amenity-gym"):
        return "entrance"
    return "fixture"


def add_dusk_lights(col):
    counts = {}
    cache = {}
    k = 0
    for obj in sorted(scene_objects(EXPORT_COLLECTIONS), key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        if obj.data.name not in cache:
            cache[obj.data.name] = emissive_clusters(obj.data)
        for down, local, sx, sy in cache[obj.data.name]:
            kind = fixture_kind(obj.data.name, down)
            f = FIXTURES[kind]
            world = obj.matrix_world @ (local + Vector((0, 0, -0.03 if down else 0)))
            name = f"LGT_{kind}_{k:04d}"
            if f["type"] == "POINT":
                new_light(col, name, "POINT", point_power(f["E"], f["d"]), f["color"], world)
            else:
                aim = Vector((0, 0, -1))
                if kind == "floodlight":  # tilt toward the court's centre
                    to_c = obj.matrix_world.translation - world
                    to_c.z = 0
                    t = math.radians(f["tiltDeg"])
                    aim = to_c.normalized() * math.sin(t) + Vector((0, 0, -math.cos(t)))
                o = new_light(col, name, "AREA", area_power(f["E"], f["d"]), f["color"], world, aim, (sx, sy), f["spread"])
                if kind != "floodlight":
                    o.rotation_euler = (0, 0, obj.matrix_world.to_euler().z)
            counts[kind] = counts.get(kind, 0) + 1
            k += 1
    counts.update(add_layout_lights(col))
    return counts


def add_layout_lights(col):
    """In-ground uplights, the gate lintel downlight, pool and playground lights (no modelled
    fitting to read them from: flush fittings), placed from layout.json."""
    counts = {"gate-lintel": 0, "pavilion-uplight": 0, "mosque-uplight": 0, "pool": 0, "playground": 0}
    g = MP["gate"]
    for i, gate in enumerate(MP["gates"]):
        y0 = gate["y"]
        new_light(
            col, f"LGT_GateLintel_{i}", "AREA", 900.0, WARM, to_blender((gate["x"], y0 + g["pavilionHeight"] - 0.03, gate["z"])),
            (0, 0, -1), (0.8, g["lintelLength"] - 1.0), 140,
        )
        counts["gate-lintel"] += 1
        half = g["pavilion"] / 2
        for j, p in enumerate(gate["pavilions"]):
            for side, (ox, oz) in enumerate(((1, 0), (-1, 0), (0, 1), (0, -1))):
                base = (p["x"] + ox * (half + 0.6), y0 + 0.05, p["z"] + oz * (half + 0.6))
                aim = Vector((-ox * 0.18, oz * 0.18, 1.0))  # up, leaning onto the wall (Blender y = -z)
                new_light(col, f"LGT_PavilionUp_{i}_{j}_{side}", "SPOT", 220.0, WARM, to_blender(base), aim, spot=40)
                counts["pavilion-uplight"] += 1
    am = {m["id"]: m for m in MP["amenities"]}
    mq = am["mosque"]
    fp = mq["footprint"]
    dome = to_blender((mq["x"], mq["y"] + 11.0, mq["z"]))
    for i, (cx, cz) in enumerate(((fp["minX"] - 1.5, fp["minZ"] - 1.5), (fp["maxX"] + 1.5, fp["minZ"] - 1.5), (fp["minX"] - 1.5, fp["maxZ"] + 1.5), (fp["maxX"] + 1.5, fp["maxZ"] + 1.5))):
        at = to_blender((cx, mq["y"] + 0.05, cz))
        new_light(col, f"LGT_MosqueUp_{i}", "SPOT", 1400.0, WARM, at, dome - at, spot=32)
        counts["mosque-uplight"] += 1
    pool = am["pool"]
    pf = pool["footprint"]
    level = pool["y"] + pool["size"]["height"] - 0.05
    long_z = (pf["maxZ"] - pf["minZ"]) >= (pf["maxX"] - pf["minX"])
    a0, a1 = (pf["minZ"], pf["maxZ"]) if long_z else (pf["minX"], pf["maxX"])
    n = max(2, int((a1 - a0) / 6.0))
    for i in range(n + 1):
        a = a0 + 1.0 + (a1 - a0 - 2.0) * i / n
        for side in (0, 1):
            if long_z:
                x, z = (pf["minX"] + 0.45, a) if side == 0 else (pf["maxX"] - 0.45, a)
            else:
                x, z = (a, pf["minZ"] + 0.45) if side == 0 else (a, pf["maxZ"] - 0.45)
            new_light(col, f"LGT_Pool_{i}_{side}", "POINT", point_power(0.6, 1.5), "#ffe3b8", to_blender((x, level, z)))
            counts["pool"] += 1
    pg = am["playground"]["footprint"]
    py = am["playground"]["y"]
    cx, cz = (pg["minX"] + pg["maxX"]) / 2, (pg["minZ"] + pg["maxZ"]) / 2
    for i, (x, z) in enumerate(((pg["minX"] + 1, pg["minZ"] + 1), (pg["maxX"] - 1, pg["minZ"] + 1), (pg["minX"] + 1, pg["maxZ"] - 1), (pg["maxX"] - 1, pg["maxZ"] - 1))):
        at = to_blender((x, py + 3.4, z))
        new_light(col, f"LGT_Playground_{i}", "SPOT", point_power(1.2, 4.0), WARM, at, to_blender((cx, py, cz)) - at, spot=70)
        counts["playground"] += 1
    return counts


def windows_lit(name):
    if name.startswith("villa-"):
        return zlib.crc32(name.encode()) % 100 < WINDOWS_LIT
    return True


def set_glass_glow(on):
    """Dusk: lit windows glow warm (per copy, through the bake copies' `lm_lit` face attribute). Day: off."""
    m = bpy.data.materials.get("glass")
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    node = nt.nodes.get("lm-glow")
    if node is None:
        info = nt.nodes.new("ShaderNodeAttribute")
        info.name = "lm-lit"
        info.attribute_name = "lm_lit"
        node = nt.nodes.new("ShaderNodeMath")
        node.name = "lm-glow"
        node.operation = "MULTIPLY"
        nt.links.new(info.outputs["Fac"], node.inputs[0])
        nt.links.new(node.outputs[0], bsdf.inputs["Emission Strength"])
        node["lm_color"] = list(bsdf.inputs["Emission Color"].default_value)
        bsdf.inputs["Emission Color"].default_value = (*hex_linear("#ffc98a"), 1)
    node.inputs[1].default_value = GLASS_GLOW if on else 0.0


def set_lamp_glow(strength):
    for m in bpy.data.materials:
        if m.name.startswith("lamp-glow") and m.node_tree:
            bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            bsdf.inputs["Emission Strength"].default_value = strength


# ------------------------------------------------------------------ scene

def scene_objects(collections):
    out = []
    for name in collections:
        c = bpy.data.collections.get(name)
        if c:
            out.extend(c.objects)
    return out


def collection(name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def plain(name, color, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*hex_linear(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def setup_cycles(samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    c = scene.cycles
    c.samples = samples
    c.use_denoising = False
    c.max_bounces = 6
    c.diffuse_bounces = 3
    c.glossy_bounces = 2
    c.transmission_bounces = 4
    c.transparent_max_bounces = 8
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.sample_clamp_indirect = 8.0
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        c.device = "GPU"
        log("cycles: Metal GPU")
    except Exception as e:  # noqa: BLE001 - CPU is a valid fallback for a build tool
        log("cycles: CPU", e)


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


# ------------------------------------------------------------------ UV2

def uv_area(me, layer):
    uv = np.empty(len(me.loops) * 2, np.float64)
    me.uv_layers[layer].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    starts = np.empty(len(me.polygons), np.int64)
    totals = np.empty(len(me.polygons), np.int64)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_get("loop_total", totals)
    area = 0.0
    for s, t in zip(starts, totals):
        p = uv[s : s + t]
        area += 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(p[:, 1], np.roll(p[:, 0], -1)))
    return area


def smart_uv2(objs, margin):
    """UV2 by Smart UV Project (one island per flat wall, as UV1), packed jointly when several
    objects are given, with a gutter sized for the tile it will get."""
    for o in objs:
        me = o.data
        if "UV2" not in me.uv_layers:
            me.uv_layers.new(name="UV2")
        me.uv_layers.active = me.uv_layers["UV2"]
    select_only(objs)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    kw = dict(angle_limit=math.radians(30), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    # ADD: the margin in final UV units, so the gutter is margin x tile size in pixels. (SCALED,
    # the default, packs the islands into ~7 % of the square here; FRACTION collapses them.)
    bpy.ops.uv.smart_project(margin_method="ADD", **kw)
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]


def planar_uv2(me, bounds):
    """Top-down UV2 over the terrain grid: u from x, v from z (z = minZ at the top of the image)."""
    if "UV2" not in me.uv_layers:
        me.uv_layers.new(name="UV2")
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    vi = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", vi)
    x, z = co[vi, 0], -co[vi, 1]
    u = (x - bounds["minX"]) / (bounds["maxX"] - bounds["minX"])
    v = 1.0 - (z - bounds["minZ"]) / (bounds["maxZ"] - bounds["minZ"])
    me.uv_layers["UV2"].data.foreach_set("uv", np.stack([u, v], 1).ravel())
    me.uv_layers.active = me.uv_layers[0]


def shelf_pack(sizes, width, height, pad):
    """sizes: {key: side}. Square tiles, tallest first, left to right in rows. None if they don't fit."""
    x = y = row = 0
    out = {}
    for key, s in sorted(sizes.items(), key=lambda kv: (-kv[1], kv[0])):
        if x + s > width:
            x, y, row = 0, y + row + pad, 0
        if y + s > height or s > width:
            return None
        out[key] = (x, y)
        x += s + pad
        row = max(row, s)
    return out


def plan_page(instances, info, width, height):
    """Largest texel density (px/m) whose square tiles all fit: tile = density * sqrt(area / uv fill)."""
    lo, hi = 0.05, 64.0
    best = None
    for _ in range(40):
        mid = (lo + hi) / 2
        sizes = {o.name: max(8, int(math.ceil(mid * math.sqrt(info[o.data.name]["area"] / info[o.data.name]["fill"])))) for o in instances}
        placed = shelf_pack(sizes, width, height, TILE_PAD)
        if placed:
            lo, best = mid, (mid, sizes, placed)
        else:
            hi = mid
    return best


# ------------------------------------------------------------------ baking

def bake_into(objs, width, height, kind, label):
    img = bpy.data.images.new(label, width, height, alpha=True, float_buffer=True)
    img.generated_color = (0, 0, 0, 0)
    temp = []
    for m in {m for o in objs for m in o.data.materials if m}:
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        m.node_tree.nodes.active = node
        temp.append((m, node))
    select_only(objs)
    t = time.time()
    if kind == "DIFFUSE":
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=0, use_clear=True, uv_layer="UV2", target="IMAGE_TEXTURES")
    else:
        bpy.ops.object.bake(type=kind, margin=0, use_clear=True, uv_layer="UV2", target="IMAGE_TEXTURES")
    for m, node in temp:
        m.node_tree.nodes.remove(node)
    px = np.empty(width * height * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    log(f"baked {label} {width}x{height} {kind} in {time.time() - t:.1f}s")
    return px.reshape(height, width, 4)


def guide_material(name, source):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    vec = nt.nodes.new("ShaderNodeVectorMath")
    if source == "position":  # shifted positive: emission colours below zero are clamped
        vec.operation = "ADD"
        vec.inputs[1].default_value = (1000, 1000, 1000)
        nt.links.new(geo.outputs["Position"], vec.inputs[0])
    else:
        vec.operation = "MULTIPLY_ADD"
        vec.inputs[1].default_value = (0.5, 0.5, 0.5)
        vec.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs["Normal"], vec.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(vec.outputs[0], em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def bake_guides(objs, width, height, page):
    saved = {o.name: list(o.data.materials) for o in objs}
    guides = {}
    for source in ("position", "normal"):
        g = guide_material(f"lm-guide-{source}", source)
        for o in objs:
            for i in range(len(o.data.materials)):
                o.data.materials[i] = g
        px = bake_into(objs, width, height, "EMIT", f"guide-{page}-{source}")
        rgb = px[..., :3].astype(np.float32)
        guides[source] = rgb - 1000.0 if source == "position" else rgb * 2 - 1
        guides["mask"] = px[..., 3] > 0.5
        bpy.data.materials.remove(g)
    for o in objs:
        for i, m in enumerate(saved[o.name]):
            o.data.materials[i] = m
    return guides


def shift(a, dy, dx):
    """a shifted by (dy, dx) with zero fill (no wrap)."""
    out = np.zeros_like(a)
    h, w = a.shape[:2]
    ys, yd = (slice(dy, h), slice(0, h - dy)) if dy >= 0 else (slice(0, h + dy), slice(-dy, h))
    xs, xd = (slice(dx, w), slice(0, w - dx)) if dx >= 0 else (slice(0, w + dx), slice(-dx, w))
    out[yd, xd] = a[ys, xs]
    return out


def denoise(b, guides, texel_m):
    """Edge-avoiding a-trous filter guided by world position and normal: it never mixes texels
    across UV islands (they are metres apart or face another way) and keeps shadow edges (range
    weight on log luminance)."""
    mask = guides["mask"].astype(np.float32)
    pos, nrm = guides["position"], guides["normal"]
    cur = b.copy()
    kern = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16]
    sp = max(0.25, 1.6 * texel_m)
    for it in range(3):
        step = 2**it
        lum = np.log(luminance(cur) + 1e-3)
        acc = np.zeros_like(cur)
        wsum = np.zeros(cur.shape[:2], np.float32)
        for i, ky in enumerate(kern):
            for j, kx in enumerate(kern):
                dy, dx = (i - 2) * step, (j - 2) * step
                c = shift(cur, dy, dx)
                w = kx * ky * shift(mask, dy, dx)
                dp = ((shift(pos, dy, dx) - pos) ** 2).sum(-1)
                w = w * np.exp(-dp / (2 * (sp * step**0.5) ** 2))
                w = w * np.clip((shift(nrm, dy, dx) * nrm).sum(-1), 0, 1) ** 32
                w = w * np.exp(-((shift(lum, dy, dx) - lum) ** 2) / (2 * 0.3**2))
                acc += c * w[..., None]
                wsum += w
        cur = np.where((wsum > 1e-8)[..., None], acc / np.maximum(wsum, 1e-8)[..., None], cur)
    return cur * mask[..., None]


def fill_gutters(rgb, mask):
    """Dilate the islands a few texels (what bilinear filtering reads), then push-pull to fill the
    rest of the page smoothly, so mipmaps never pull black into an island."""
    c = rgb * mask[..., None]
    w = mask.astype(np.float32)
    for _ in range(4):
        acc = np.zeros_like(c)
        ws = np.zeros_like(w)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += shift(c, dy, dx)
                ws += shift(w, dy, dx)
        grow = (w == 0) & (ws > 0)
        c[grow] = acc[grow] / ws[grow][:, None]
        w = np.where(grow, 1.0, w)
    # push-pull
    levels = [(c * w[..., None], w)]
    while levels[-1][1].shape[0] > 1 and levels[-1][1].shape[1] > 1:
        lc, lw = levels[-1]
        h, ww = lw.shape
        lc = lc[: h // 2 * 2, : ww // 2 * 2]
        lw = lw[: h // 2 * 2, : ww // 2 * 2]
        lc = lc.reshape(h // 2, 2, ww // 2, 2, 3).sum((1, 3))
        lw = lw.reshape(h // 2, 2, ww // 2, 2).sum((1, 3))
        levels.append((lc, lw))
    fill = levels[-1][0] / np.maximum(levels[-1][1], 1e-8)[..., None]
    for lc, lw in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, 0), 2, 1)
        up = np.pad(up, ((0, lw.shape[0] - up.shape[0]), (0, lw.shape[1] - up.shape[1]), (0, 0)), mode="edge")
        own = lc / np.maximum(lw, 1e-8)[..., None]
        fill = np.where((lw > 0)[..., None], own, up)
    out = np.where((w > 0)[..., None], c, fill)
    return out.astype(np.float32)


def write_image(path, rgb_bottom_up, half=False, u8=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img = np.ascontiguousarray(rgb_bottom_up[::-1])
    h, w, ch = img.shape
    fmt = oiio.UINT8 if u8 else (oiio.HALF if half else oiio.FLOAT)
    spec = oiio.ImageSpec(w, h, ch, fmt)
    out = oiio.ImageOutput.create(path)
    out.open(path, spec)
    out.write_image(img)
    out.close()


def read_image(path):
    """All channels of an image; Blender writes multilayer EXRs as one part per pass."""
    inp = oiio.ImageInput.open(path)
    parts, names, k = [], [], 0
    while inp.seek_subimage(k, 0):
        spec = inp.spec()
        px = inp.read_image(k, 0, 0, spec.nchannels, oiio.FLOAT)
        parts.append(np.asarray(px).reshape(spec.height, spec.width, spec.nchannels))
        names += list(spec.channelnames)
        k += 1
    inp.close()
    return np.concatenate(parts, axis=2)[::-1], names


# ------------------------------------------------------------------ seams

def bilinear(img, u, v):
    h, w = img.shape[:2]
    x, y = u * w - 0.5, v * h - 0.5
    x0, y0 = np.clip(np.floor(x).astype(int), 0, w - 2), np.clip(np.floor(y).astype(int), 0, h - 2)
    fx, fy = np.clip(x - x0, 0, 1)[:, None], np.clip(y - y0, 0, 1)[:, None]
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def seam_pairs(me):
    """UV2 points either side of every seam that splits a flat surface (atlas coordinates)."""
    if True:
        bm = bmesh.new()
        bm.from_mesh(me)
        uvl = bm.loops.layers.uv["UV2"]
        a_uv, b_uv = [], []
        for e in bm.edges:
            if len(e.link_faces) != 2:
                continue
            f1, f2 = e.link_faces
            # Real surfaces only: trims and bevels thinner than a few texels can't hold light anyway.
            if f1.normal.dot(f2.normal) < 0.995 or e.calc_length() < 1.0 or min(f1.calc_area(), f2.calc_area()) < 1.0:
                continue
            l1 = {l.vert: l[uvl].uv.copy() for l in f1.loops}
            l2 = {l.vert: l[uvl].uv.copy() for l in f2.loops}
            v0, v1 = e.verts
            if (l1[v0] - l2[v0]).length < 1e-6 and (l1[v1] - l2[v1]).length < 1e-6:
                continue
            for t in (0.25, 0.5, 0.75):
                a_uv.append(l1[v0].lerp(l1[v1], t)[:])
                b_uv.append(l2[v0].lerp(l2[v1], t)[:])
        bm.free()
        return np.array(a_uv).reshape(-1, 2), np.array(b_uv).reshape(-1, 2)


def seam_error(pairs, decoded):
    """Across UV2 seams that split a flat surface, how much the lightmap jumps (relative, at mip 0)."""
    rel = []
    for a_uv, b_uv in pairs:
        if not len(a_uv):
            continue
        a = luminance(bilinear(decoded, a_uv[:, 0], a_uv[:, 1]))
        b = luminance(bilinear(decoded, b_uv[:, 0], b_uv[:, 1]))
        floor = 0.05 * float(np.percentile(luminance(decoded), 99))
        rel.extend((np.abs(a - b) / np.maximum((a + b) / 2, floor)).tolist())
    if not rel:
        return {"samples": 0, "mean": 0.0, "p95": 0.0, "over10pct": 0.0}
    r = np.array(rel)
    return {"samples": int(r.size), "mean": round(float(r.mean()), 4), "p95": round(float(np.percentile(r, 95)), 4), "over10pct": round(float((r > 0.1).mean()), 4)}


# ------------------------------------------------------------------ validation frames

ACES_IN = np.array([[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]])
ACES_OUT = np.array([[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]])


def aces(rgb, exposure=EXPOSURE):
    """three.js ACESFilmicToneMapping, then the sRGB encoding: what the web canvas shows."""
    c = rgb * (exposure / 0.6)
    c = c @ ACES_IN.T
    a = c * (c + 0.0245786) - 0.000090537
    b = c * (0.983729 * c + 0.4329510) + 0.238081
    c = (a / b) @ ACES_OUT.T
    return linear_to_srgb(np.clip(c, 0, 1))


def fog(rgb, depth, sky):
    """three.js FogExp2 (the sky itself is not fogged)."""
    f = 1.0 - np.exp(-((HAZE["density"] * depth) ** 2))
    f = np.where(sky, 0.0, f)[..., None]
    return rgb * (1 - f) + hex_linear(HAZE["color"])[None, None, :] * f


def camera_from_shot(cam, shot, key):
    k = shot["keys"][key]
    eye, tgt = to_blender((k["eye"]["x"], k["eye"]["y"], k["eye"]["z"])), to_blender((k["target"]["x"], k["target"]["y"], k["target"]["z"]))
    cam.location = eye
    cam.rotation_euler = (tgt - eye).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = shot["lens"]
    cam.data.sensor_width = SHOTS.get("sensorWidth", 36)
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.shift_y = k.get("shiftY", 0)
    cam.data.clip_end = 5000


SHOTS = json.load(open(os.path.join(HERE, "film", "shots.json")))
VALIDATION_SHOTS = [("01", 1, "day"), ("02", 1, "day"), ("03", 0, "day"), ("04", 1, "day"), ("06a", 0, "day"), ("02", 1, "dusk"), ("08", 0, "dusk")]


def pass_of(px, names, wanted):
    """The RGB of a render pass from a multilayer EXR, by any of its known channel names."""
    for w in wanted:
        idx = [i for i, n in enumerate(names) if n.split(".")[-2:-1] == [w] or n.endswith(f".{w}.R")]
        if idx:
            i = idx[0]
            return px[..., i : i + 3]
    raise KeyError(f"{wanted} not in {sorted({'.'.join(n.split('.')[:-1]) for n in names})}")


def render_multilayer(path, samples, denoise_beauty):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.cycles.use_denoising = denoise_beauty
    s = scene.render.image_settings
    try:
        set_enum(s, "media_type", ["MULTI_LAYER_IMAGE"])
        set_enum(s, "file_format", ["OPEN_EXR"])
    except (KeyError, ValueError, TypeError):
        set_enum(s, "file_format", ["OPEN_EXR_MULTILAYER"])
    s.color_depth = "32"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return read_image(path)


def validate(state, copies, page_images):
    exposure = EXPOSURE if state == "day" else DUSK_EXPOSURE
    """Per storyboard camera: Cycles' own diffuse lighting vs the baked lightmap seen from the same
    camera (both without albedo), and the beauty frame as Cycles renders it vs as the web will
    (albedo x lightmap + reflections, the web's fog and tone mapping)."""
    scene = bpy.context.scene
    vl = bpy.context.view_layer
    for p in ("use_pass_diffuse_direct", "use_pass_diffuse_indirect", "use_pass_diffuse_color", "use_pass_glossy_direct", "use_pass_glossy_indirect", "use_pass_glossy_color", "use_pass_emit", "use_pass_environment", "use_pass_z", "use_pass_transmission_direct", "use_pass_transmission_indirect", "use_pass_transmission_color"):
        setattr(vl, p, True)
    w, h = (480, 270) if QUICK else (960, 540)
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    cam = bpy.data.objects.new("CAM_Validate", bpy.data.cameras.new("CAM_Validate"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Not lightmapped: hidden from the camera in both renders (they still shadow and bounce).
    unbaked = [o for o in scene.objects if o.type == "MESH" and not o.get("lm_baked") and o.visible_camera]
    for o in unbaked:
        o.visible_camera = False
    # Not lightmapped materials: see-through to the camera in both renders (they still shadow).
    see_through = []
    for m in {m for o, _ in copies for m in o.data.materials if m and not lightmapped(m)}:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
        src = out.inputs["Surface"].links[0].from_socket
        lp = nt.nodes.new("ShaderNodeLightPath")
        clear = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(clear.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        see_through.append((m, src, (lp, clear, mix), out))
    # Emission materials showing the decoded lightmap (B = irradiance / pi) on UV2.
    show = {}
    for page, rgb in page_images.items():
        img = bpy.data.images.new(f"show-{page}-{state}", rgb.shape[1], rgb.shape[0], alpha=False, float_buffer=True)
        px = np.ones((*rgb.shape[:2], 4), np.float32)
        px[..., :3] = rgb / math.pi
        img.pixels.foreach_set(px.ravel())
        m = bpy.data.materials.new(f"show-{page}-{state}")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UV2"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        nt.links.new(uv.outputs[0], tex.inputs[0])
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(tex.outputs[0], em.inputs["Color"])
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        show[page] = m
    results = []
    os.makedirs(os.path.join(OUT, "lighting"), exist_ok=True)
    for sid, key, st in VALIDATION_SHOTS:
        if st != state:
            continue
        shot = next(s for s in SHOTS["shots"] if s["id"] == sid)
        camera_from_shot(cam, shot, key)
        base = os.path.join(OUT, "lighting", f"{state}-{sid}-{TIER}")
        ref, names = render_multilayer(base + "-ref.exr", 16 if QUICK else 256, False)
        dd, di, dc = (pass_of(ref, names, k) for k in (["DiffDir", "Diffuse Direct"], ["DiffInd", "Diffuse Indirect"], ["DiffCol", "Diffuse Color"]))
        p = lambda *k: pass_of(ref, names, list(k))  # noqa: E731
        rest = (
            p("GlossCol", "Glossy Color") * (p("GlossDir", "Glossy Direct") + p("GlossInd", "Glossy Indirect"))
            + p("TransCol", "Transmission Color") * (p("TransDir", "Transmission Direct") + p("TransInd", "Transmission Indirect"))
            + p("Emit", "Emission")
            + p("Env", "Environment")
        )
        depth_i = [i for i, n in enumerate(names) if n.endswith(".Z") or n.endswith("Depth.V") or n.endswith(".Depth.Z")]
        depth = ref[..., depth_i[0]] if depth_i else np.full(ref.shape[:2], 1e10)
        sky = depth > 1e5
        # Reconstruction: every baked copy shows its lightmap, nothing else lights the frame.
        saved = {o.name: list(o.data.materials) for o, _ in copies}
        for o, page in copies:
            for i, m in enumerate(saved[o.name]):
                o.data.materials[i] = show_variant(show[page], m)
        lights_hidden = [o for o in scene.objects if o.type == "LIGHT" and not o.hide_render]
        for o in lights_hidden:
            o.hide_render = True
        world = scene.world
        scene.world = None
        rec, rnames = render_multilayer(base + "-rec.exr", 4, False)
        scene.world = world
        for o in lights_hidden:
            o.hide_render = False
        for o, _ in copies:
            for i, m in enumerate(saved[o.name]):
                o.data.materials[i] = m
        rec_light = pass_of(rec, rnames, ["Emit", "Emission"])
        ref_light = dd + di
        geom = (~sky) & (luminance(dc) > 0.02)
        # 8 x 8 block means: the reference's per-pixel path-tracing noise is not lightmap error.
        def blocks(a):
            hh, ww = a.shape[0] // 8 * 8, a.shape[1] // 8 * 8
            return a[:hh, :ww].reshape(hh // 8, 8, ww // 8, 8).mean((1, 3))
        full_geom = blocks(geom.astype(np.float32)) > 0.99
        lr, lc = blocks(luminance(ref_light))[full_geom], blocks(luminance(rec_light))[full_geom]
        err = float(np.abs(lc - lr).mean() / max(lr.mean(), 1e-6))
        ratio = float(np.median(np.log((lc + 1e-3) / (lr + 1e-3))))
        cycles_beauty = dc * ref_light + rest
        web_beauty = dc * rec_light + rest
        strip = np.concatenate(
            [aces(fog(cycles_beauty, depth, sky), exposure), aces(fog(web_beauty, depth, sky), exposure), false_color(heat(ref_light, rec_light, geom, blocks))],
            axis=1,
        )
        write_image(base + "-compare.png", (np.clip(strip, 0, 1) * 255 + 0.5).astype(np.uint8), u8=True)
        # The full frame as the film sees it: everything visible (water, lamps, screens), denoised.
        for o in unbaked:
            o.visible_camera = True
        full, fnames = render_multilayer(base + "-full.exr", 16 if QUICK else 192, True)
        for o in unbaked:
            o.visible_camera = False
        fdi = [i for i, n in enumerate(fnames) if n.endswith(".Z")]
        fdepth = full[..., fdi[0]] if fdi else depth
        beauty = pass_of(full, fnames, ["Combined", "Image"])
        write_image(base + "-beauty.png", (np.clip(aces(fog(beauty, fdepth, fdepth > 1e5), exposure), 0, 1) * 255 + 0.5).astype(np.uint8), u8=True)
        results.append({"shot": sid, "key": key, "state": state, "relativeError": round(err, 4), "medianLogRatio": round(ratio, 4)})
        log(f"validate {state} {sid}: relative error {err:.3f}, median log ratio {ratio:+.3f}")
    for o in unbaked:
        o.visible_camera = True
    for m, src, nodes, out in see_through:
        nt = m.node_tree
        for n in nodes:
            nt.nodes.remove(n)
        nt.links.new(src, out.inputs["Surface"])
    bpy.data.objects.remove(cam)
    return results


def heat(ref_light, rec_light, geom, blocks):
    """Relative error of the 8 x 8 block means, back at full size (0 outside the baked surfaces)."""
    e = np.abs(blocks(luminance(rec_light)) - blocks(luminance(ref_light))) / np.maximum(blocks(luminance(ref_light)), 1e-3)
    e = np.where(blocks(geom.astype(np.float32)) > 0.5, e, 0)
    e = np.repeat(np.repeat(e, 8, 0), 8, 1)
    return np.pad(e, ((0, geom.shape[0] - e.shape[0]), (0, geom.shape[1] - e.shape[1])))


SHOW_CACHE = {}


def show_variant(show, original):
    """The lightmap-showing material with the original's alpha: alpha-cut lattices and fences stay
    see-through, as they do on the web (alphaTest), and so does the clear glass."""
    if original is None:
        return show
    if not lightmapped(original):  # see-through to the camera, as in the reference render
        m = SHOW_CACHE.get("clear")
        if m is None:
            m = bpy.data.materials.new("show-clear")
            m.use_nodes = True
            nt = m.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs[0], out.inputs["Surface"])
            SHOW_CACHE["clear"] = m
        return m
    key = (show.name, original.name)
    if key in SHOW_CACHE:
        return SHOW_CACHE[key]
    bsdf = next((n for n in original.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    alpha_in = bsdf.inputs["Alpha"] if bsdf else None
    if alpha_in is None or (not alpha_in.is_linked and alpha_in.default_value >= 0.999):
        SHOW_CACHE[key] = show
        return show
    m = show.copy()
    m.name = f"{show.name}-{original.name}"
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = next(n for n in nt.nodes if n.type == "EMISSION")
    mix = nt.nodes.new("ShaderNodeMixShader")
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    if alpha_in.is_linked:  # atlas alpha (rounded), sampled on UV0 like the original
        base = next(n for n in original.node_tree.nodes if n.type == "TEX_IMAGE" and n.outputs["Alpha"].is_linked)
        uv0 = nt.nodes.new("ShaderNodeUVMap")
        uv0.uv_map = "UVMap"
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = base.image
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"
        nt.links.new(uv0.outputs[0], tex.inputs[0])
        nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
        nt.links.new(rnd.outputs[0], mix.inputs[0])
    else:
        mix.inputs[0].default_value = alpha_in.default_value
    nt.links.new(clear.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    SHOW_CACHE[key] = m
    return m


def false_color(e):
    """0 -> dark blue, 10 % -> green, 25 %+ -> red."""
    t = np.clip(e / 0.25, 0, 1)[..., None]
    lo = np.array([0.05, 0.08, 0.3])
    mid = np.array([0.1, 0.8, 0.2])
    hi = np.array([0.95, 0.15, 0.1])
    return np.where(t < 0.4, lo + (mid - lo) * (t / 0.4), mid + (hi - mid) * ((t - 0.4) / 0.6))


# ------------------------------------------------------------------ main

def main():
    assert oiio is not None, "OpenImageIO (bundled with Blender) is needed"
    scene = bpy.context.scene
    assert bpy.data.collections.get("Villas"), "open the .blend written by build_compound.py --plan zaitun --blend"
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WEB_OUT, exist_ok=True)
    setup_cycles(SAMPLES)
    div = (2 if TIER == "low" else 1) * int(arg_value("--div", "4" if QUICK else "1"))
    pages = {k: (w // div, h // div) for k, (w, h) in PAGES.items()}

    # Film objects: give the terrain and water plausible surfaces (they bounce light).
    terrain = bpy.data.objects["terrain"]
    earth = plain("lm-earth", "#a48a63", 1.0)
    terrain.data.materials.clear()
    terrain.data.materials.append(earth)
    for name in ("stream-water", "pool-water"):
        o = bpy.data.objects.get(name)
        if o:
            o.data.materials.clear()
            o.data.materials.append(plain("lm-water", "#2f5458", 0.06))

    # UV2 on every template the buildings page uses, then the site + garden jointly.
    build_objs = sorted((o for o in scene_objects(BAKE_COLLECTIONS["buildings"]) if o.type == "MESH" and not o.name.endswith("-screens")), key=lambda o: o.name)
    by_data = {}
    for o in build_objs:
        by_data.setdefault(o.data.name, o)
    total_area = sum(sum(p.area for p in o.data.polygons) for o in build_objs)
    bw, bh = pages["buildings"]
    rho_guess = math.sqrt(bw * bh * 0.35 / total_area)
    info = {}
    for name, o in by_data.items():
        area = sum(p.area for p in o.data.polygons)
        tile = max(16.0, rho_guess * math.sqrt(area / 0.55))
        smart_uv2([o], min(0.05, max(0.004, ISLAND_GUTTER / tile)))
        info[name] = {"area": area, "fill": max(0.05, uv_area(o.data, "UV2"))}
        log(f"UV2 {name}: {area:.0f} m2, fill {info[name]['fill']:.2f}")
    site_objs = sorted((o for o in scene_objects(BAKE_COLLECTIONS["site"]) if o.type == "MESH"), key=lambda o: o.name)
    smart_uv2(site_objs, ISLAND_GUTTER / pages["site"][0])
    co = np.array([v.co[:] for v in terrain.data.vertices])
    bounds = {"minX": float(co[:, 0].min()), "maxX": float(co[:, 0].max()), "minZ": float(-co[:, 1].max()), "maxZ": float(-co[:, 1].min())}

    rho, sizes, placed = plan_page(build_objs, info, bw, bh)
    log(f"buildings page {bw}x{bh}: {len(build_objs)} tiles at {rho:.2f} px/m")

    # Bake copies: own mesh data, UV2 moved into the copy's tile; the originals stay untouched.
    bake_col = collection("LightmapBake")
    copies = []
    seams, seam_done = [], set()

    def add_copy(src, page, st):
        me = src.data.copy()
        me.name = f"lm-{src.name}"
        uv = np.empty(len(me.loops) * 2)
        me.uv_layers["UV2"].data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        uv[:, 0] = st[2] + uv[:, 0] * st[0]
        uv[:, 1] = st[3] + uv[:, 1] * st[1]
        me.uv_layers["UV2"].data.foreach_set("uv", uv.ravel())
        obj = bpy.data.objects.new(me.name, me)
        obj.matrix_world = src.matrix_world.copy()
        lit = me.attributes.new("lm_lit", "FLOAT", "FACE")
        lit.data.foreach_set("value", np.full(len(me.polygons), 1.0 if windows_lit(src.name) else 0.0, np.float32))
        bake_col.objects.link(obj)
        src.hide_render = True
        if page == "buildings" and src.data.name not in seam_done:
            seam_done.add(src.data.name)
            seams.append(seam_pairs(me))
        copies.append({"object": obj, "source": src, "page": page, "st": st})

    for o in build_objs:
        x, y = placed[o.name]
        s = sizes[o.name]
        add_copy(o, "buildings", (s / bw, s / bh, x / bw, y / bh))
    for o in site_objs:
        add_copy(o, "site", (1.0, 1.0, 0.0, 0.0))
    ground_me = terrain.data.copy()
    ground_me.name = "lm-ground"
    ground_me.transform(Matrix.Translation((0, 0, GROUND_LIFT)))
    planar_uv2(ground_me, bounds)
    ground = bpy.data.objects.new("lm-ground", ground_me)
    ground.matrix_world = terrain.matrix_world.copy()
    ground["lm_baked"] = True
    bake_col.objects.link(ground)
    ground.hide_render = True

    # One object per page: Cycles pays ~1 s of set-up per baked object, so 140 copies cost minutes.
    def join(objs, name):
        select_only(objs)
        bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = j.data.name = name
        j["lm_baked"] = True
        return j

    page_objs = {"buildings": [join([c["object"] for c in copies if c["page"] == "buildings"], "lm-buildings")], "site": [join([c["object"] for c in copies if c["page"] == "site"], "lm-site")], "ground": [ground]}
    texel = {"buildings": 1.0 / rho, "site": None, "ground": (bounds["maxX"] - bounds["minX"]) / pages["ground"][0]}
    site_area = sum(sum(p.area for p in o.data.polygons) for o in site_objs)
    texel["site"] = math.sqrt(site_area / max(1e-6, sum(uv_area(o.data, "UV2") for o in site_objs))) / pages["site"][0]

    def ground_mode(on):
        terrain.hide_render = on
        ground.hide_render = not on

    guides = {}
    for page, objs in page_objs.items():
        ground_mode(page == "ground")
        guides[page] = bake_guides(objs, *pages[page], page)
    ground_mode(False)

    lights_day, lights_dusk = collection("Lights-day"), collection("Lights-dusk")
    add_sun(lights_day)
    dusk_counts = add_dusk_lights(lights_dusk)
    worlds = {}
    report_states = {}
    raw = {}
    for state in STATES:
        world, winfo = make_world(state)
        worlds[state] = world
        scene.world = world
        for o in lights_day.objects:
            o.hide_render = state != "day"
        for o in lights_dusk.objects:
            o.hide_render = state != "dusk"
        set_glass_glow(state == "dusk")
        set_lamp_glow(0.0 if state == "day" else 4.0)
        raw[state] = {}
        for page, objs in page_objs.items():
            ground_mode(page == "ground")
            px = bake_into(objs, *pages[page], "DIFFUSE", f"{state}-{page}")
            b = np.nan_to_num(px[..., :3], nan=0.0, posinf=0.0, neginf=0.0)
            b = denoise(b, guides[page], texel[page])
            raw[state][page] = fill_gutters(b * math.pi, guides[page]["mask"])  # irradiance E = pi * B
            write_image(os.path.join(OUT, "lightmaps", f"{state}-{page}-{TIER}.exr"), raw[state][page], half=True)
        ground_mode(False)
        report_states[state] = {"world": winfo}

    # Encode: 8-bit sRGB of E / intensity; one intensity per state across its pages.
    manifest_tier = {"pages": {}, "instances": {}}
    decoded = {}
    for state in STATES:
        lum = np.concatenate([luminance(raw[state][p])[guides[p]["mask"]] for p in ("buildings", "site")])
        intensity = float(round(np.percentile(lum, 99.7) * 1.1, 3))
        report_states[state]["intensity"] = intensity
        decoded[state] = {}
        for page in page_objs:
            enc = linear_to_srgb(np.clip(raw[state][page] / intensity, 0, 1))
            u8 = (enc * 255 + 0.5).astype(np.uint8)
            path = os.path.join(WEB_OUT, f"{state}-{page}-{TIER}.png")
            write_image(path, u8, u8=True)
            decoded[state][page] = srgb_to_linear(u8 / 255.0) * intensity
            manifest_tier["pages"].setdefault(page, {"size": list(pages[page]), "files": {}, "texelMetres": round(texel[page], 4)})
            manifest_tier["pages"][page]["files"][state] = os.path.basename(path)
            manifest_tier["pages"][page].setdefault("bytes", {})[state] = os.path.getsize(path)
        report_states[state]["seams"] = seam_error(seams, decoded[state]["buildings"])
        report_states[state]["meanIrradiance"] = {p: round(float(luminance(raw[state][p])[guides[p]["mask"]].mean()), 4) for p in page_objs}
        log(f"{state}: intensity {intensity}, seams {report_states[state]['seams']}")
    manifest_tier["pages"]["ground"]["projection"] = {"axes": "xz", "bounds": {k: round(v, 3) for k, v in bounds.items()}, "lift": GROUND_LIFT}
    for c in copies:
        sx, sy, ox, oy = c["st"]
        src = c["source"]
        manifest_tier["instances"][src.name] = {
            "page": c["page"],
            # glTF UV convention (v down): uv2 * scale + offset, flipY false.
            "scaleOffset": [round(sx, 6), round(sy, 6), round(ox, 6), round(1.0 - oy - sy, 6)],
            "position": to_three(src.matrix_world.translation),
            "rotationY": round(src.matrix_world.to_euler().z, 5),
            "windowsLit": bool(windows_lit(src.name)),
        }

    validation = []
    if VALIDATE:
        for state in STATES:
            scene.world = worlds[state]
            for o in lights_day.objects:
                o.hide_render = state != "day"
            for o in lights_dusk.objects:
                o.hide_render = state != "dusk"
            set_glass_glow(state == "dusk")
            set_lamp_glow(0.0 if state == "day" else 4.0)
            ground_mode(False)
            ground.hide_render = False  # the lifted ground shows its own page
            terrain.hide_render = True
            validation += validate(state, [(o, p) for p, objs in page_objs.items() for o in objs], {p: decoded[state][p] for p in page_objs})
            ground_mode(False)

    # Restore the model and export it with UV2 (TEXCOORD_2) for track 6B.
    set_glass_glow(False)
    set_lamp_glow(1.6)
    glass = bpy.data.materials["glass"].node_tree
    glow = glass.nodes.get("lm-glow")
    if glow is not None:
        bsdf = next(n for n in glass.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Emission Color"].default_value = glow["lm_color"]
        bsdf.inputs["Emission Strength"].default_value = 0.0
        for n in [n for n in glass.nodes if n.name in ("lm-lit", "lm-glow")]:
            glass.nodes.remove(n)
    for c in copies:
        c["source"].hide_render = False
    for objs in page_objs.values():
        for o in objs:
            me = o.data
            bpy.data.objects.remove(o)
            bpy.data.meshes.remove(me)
    terrain.hide_render = False
    glb = os.path.join(OUT, f"compound-zaitun-{TIER}.lit.raw.glb")
    exported = scene_objects(EXPORT_COLLECTIONS)
    bpy.ops.object.select_all(action="DESELECT")
    for o in exported:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = exported[0]
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_texcoords=True,
        export_normals=True, export_materials="EXPORT", export_image_format="AUTO", export_extras=False, export_animations=False,
    )
    log(f"exported {glb} ({os.path.getsize(glb) / 1e6:.2f} MB)")

    if QUICK:
        log("quick run: report and manifest not written")
        return
    sun_t = sun_direction(SUN["elevationDeg"])
    light_t = sun_direction(SUN["elevationDeg"], SUN["liftDeg"])
    qibla = great_circle_bearing(ERBIL, MECCA)
    shared = {
        "north": NORTH,
        "sun": {
            "direction": [round(float(v), 5) for v in sun_t],
            "lightDirection": [round(float(v), 5) for v in light_t],
            "bearingDeg": round(bearing_of(sun_t[0], sun_t[2]), 2),
            "elevationDeg": SUN["elevationDeg"],
            "lightElevationDeg": SUN["elevationDeg"] + SUN["liftDeg"],
            "angleDeg": SUN_ANGLE_DEG,
            "color": SUN["color"],
            "intensity": SUN["intensity"],
        },
        "qibla": {"bearingDeg": round(qibla, 2), "direction": three_of_bearing(qibla)},
        "hemi": HEMI,
        "haze": HAZE,
        "skyDay": {k: v for k, v in SKY_DAY.items()},
        "skyDusk": {k: v for k, v in SKY_DUSK.items()},
        "duskAmbient": DUSK_AMBIENT,
        "fixtures": FIXTURES,
    }
    report = json.load(open(REPORT)) if os.path.exists(REPORT) else {}
    report.update(shared)
    report["source"] = hashlib.sha256(open(__file__, "rb").read()).hexdigest()
    report.setdefault("tiers", {})[TIER] = {
        "blender": bpy.app.version_string,
        "samples": SAMPLES,
        "pages": {p: {"size": list(pages[p]), "texelMetres": round(texel[p], 4), "coverage": round(float(guides[p]["mask"].mean()), 4)} for p in page_objs},
        "densityPxPerMetre": round(rho, 3),
        "tiles": len(build_objs),
        "instances": sorted(manifest_tier["instances"]),
        "states": report_states,
        "duskLights": dusk_counts,
        "validation": validation,
        "glb": {"file": os.path.basename(glb), "bytes": os.path.getsize(glb)},
        "minutes": round((time.time() - T0) / 60, 1),
    }
    json.dump(report, open(REPORT, "w"), indent=2)
    man_path = os.path.join(WEB_OUT, "lightmaps.json")
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    manifest.update({
        "version": 1,
        "plan": "zaitun",
        "uv": {"attribute": "uv2", "gltf": "TEXCOORD_2", "flipY": False},
        "encoding": {
            "colorSpace": "srgb",
            "meaning": "irradiance, without albedo: set texture.colorSpace = SRGBColorSpace, material.lightMap = texture, material.lightMapIntensity = intensity",
        },
        "states": {s: {"intensity": report_states[s]["intensity"]} for s in STATES},
        "sun": shared["sun"],
    })
    manifest.setdefault("tiers", {})[TIER] = manifest_tier
    json.dump(manifest, open(man_path, "w"), indent=1)
    log(f"wrote {REPORT} and {man_path}")


if __name__ == "__main__":
    main()
