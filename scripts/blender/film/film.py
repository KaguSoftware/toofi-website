"""
Zaitun Hills film (track 5B): the Cycles film, the 4K stills and the four web posters, rendered from
the real 28 ha model with the approved storyboard cameras.

Nothing is placed by hand. The scene is assembled from generated sources only:

    scripts/blender/out/zaitun-high.blend     the compound (build_compound.py --plan zaitun --blend)
    scripts/blender/lighting.py               the day and dusk light rigs (track 4), imported
    scripts/blender/out/film/scene.json       trees, hedges, people, cars, birds, poster views (scene.mjs)
    scripts/blender/out/film/ground.pfm       the web terrain's colours (scene.mjs)
    scripts/blender/out/vegetation-high.raw.glb, life-high.raw.glb   the 3A libraries (vegetation.py, life.py)
    scripts/blender/film/shots.json           the approved cameras (track 5A), via storyboard.build_cameras

    blender -b scripts/blender/out/zaitun-high.blend --python-exit-code 1 -P scripts/blender/film/film.py -- \
        [--posters [flight,street,...]] [--stills [01-aerial-hero,...]] [--shots [01,05a,...]] \
        [--frames 1-288] [--scale 100] [--samples N] [--engine cycles|eevee] [--save] [--report]

scripts/blender/film/render.sh runs the whole thing; scripts/blender/film/edit.mjs cuts the film.

Look
- Light: lighting.py's rigs, unchanged (sun 4.2 deg up at a bearing of 279 deg, the art-directed sky as an
  HDRI, every dusk fitting). Shot 07 is a time-lapse between them; 08 is blue hour.
- Haze: the web's FogExp2 (world.ts colour and density), in the shaders on camera rays (fog_group), so
  the film's depth reads like the site's. The sky is not fogged (as on the web).
- Film and stills: AgX (Medium High Contrast), depth of field and focus from shots.json, subtle motion
  blur, a soft glow on bright lights. edit.mjs adds the grade, vignette, grain and letterbox.
- Posters: rendered linear, then fogged and tone mapped exactly as the web canvas is (three.js ACES
  filmic at the scene's exposure, lighting.aces + lighting.fog), with no depth of field or grade, so the
  poster hands over to the live scene without a jump.

Axes: the scene's (x, y up, z) is Blender's (x, -z, y), as everywhere in scripts/blender/.
"""

import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(BLENDER_DIR))
OUT = os.path.join(BLENDER_DIR, "out")
FILM_OUT = os.path.join(OUT, "film")
sys.path[:0] = [BLENDER_DIR, HERE]

import lighting  # noqa: E402  (track 4's rigs; reads only its own flags from argv)
import storyboard  # noqa: E402  (track 5A's cameras)

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
T0 = time.time()


def log(*a):
    print(f"[film {time.time() - T0:7.1f}s]", *a, flush=True)


def arg_list(name):
    """`--name a,b` -> [a, b]; `--name` alone -> [] (everything); absent -> None."""
    if name not in ARGS:
        return None
    i = ARGS.index(name)
    if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--"):
        return ARGS[i + 1].split(",")
    return []


def arg_value(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default


SCENE = json.load(open(os.path.join(FILM_OUT, "scene.json")))
SHOTS = json.load(open(os.path.join(HERE, "shots.json")))
REPORT_PATH = os.path.join(HERE, "film.report.json")

# ------------------------------------------------------------------ look (documented in README.md)

LOOK = {
    "viewTransform": "AgX",
    "look": "Medium High Contrast",
    # AgX exposure for golden hour and blue hour: the web's ACES exposures (0.5 day, 2.4 dusk) re-based
    # on AgX's curve, set by eye against the poster frames so stills and posters share a brightness.
    "exposureDay": -0.2,
    "exposureDusk": 1.9,
    "motionBlurShutter": 0.35,  # of a frame: subtle, the moves are slow
    "glare": {"threshold": 6.0, "strength": 0.12, "size": 7},
    "dispersion": 0.006,
    "samples": {"shot": 64, "still": 160, "poster": 256, "preview": 16},
    "adaptiveThreshold": 0.015,
}
# Haze colour at blue hour (linear radiance): the dusk sky's horizon, which the fog fades into.
DUSK_HAZE = "#3e4468"
WIND = {"olive": (0.05, 0.9), "palm": (0.16, 0.45), "citrus": (0.035, 1.0), "hedge": (0.012, 1.2), "grass": (0.05, 1.4), "shrub": (0.01, 1.2)}
WIND_PHASES = 3

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three.js -> Blender
C_INV = C.inverted()


def to_b(x, y, z):
    return Vector((x, -z, y))


def hex_linear(h):
    return lighting.hex_linear(h)


def collection(name, parent=None):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in {c.name for c in (parent or bpy.context.scene.collection).children}:
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


# ------------------------------------------------------------------ bulk keyframes

def fcurve(id_data, path, index=0):
    ad = id_data.animation_data or id_data.animation_data_create()
    if ad.action is None:
        ad.action = bpy.data.actions.new(f"{id_data.name}-film")
    act = ad.action
    if hasattr(act, "fcurve_ensure_for_datablock"):
        return act.fcurve_ensure_for_datablock(id_data, path, index=index)
    fc = act.fcurves.find(path, index=index)
    return fc or act.fcurves.new(path, index=index)


def bulk_keys(id_data, path, index, frames, values):
    fc = fcurve(id_data, path, index)
    n = len(frames)
    fc.keyframe_points.clear()
    fc.keyframe_points.add(n)
    co = np.empty(n * 2, np.float32)
    co[0::2] = frames
    co[1::2] = values
    fc.keyframe_points.foreach_set("co", co)
    # A key on every frame: Blender's default auto-clamped Bezier passes through each sample (and
    # gives motion blur a smooth path between them).
    fc.update()
    return fc


def unwrap(angles):
    out = np.array(angles, np.float64)
    return np.unwrap(out) if len(out) > 1 else out


# ------------------------------------------------------------------ ground and water

def ground_material():
    """The web terrain's colours (ground.pfm, by world x/z), broken up at metre and pebble scale."""
    path = os.path.join(FILM_OUT, "ground.exr")
    with open(os.path.join(FILM_OUT, "ground.pfm"), "rb") as f:  # Blender doesn't read PFM: re-save as EXR
        assert f.readline().strip() == b"PF"
        gw, gh = map(int, f.readline().split())
        f.readline()
        rgb = np.frombuffer(f.read(), "<f4").reshape(gh, gw, 3)  # PFM rows run bottom-up, as Blender's
    lighting.write_image(path, rgb, half=True)
    img = bpy.data.images.load(path, check_existing=True)
    try:
        img.colorspace_settings.name = "Linear Rec.709"
    except TypeError:
        img.colorspace_settings.is_data = True
    t = lighting.LAYOUT["masterplan"]["terrain"]
    w, h = img.size
    step = SCENE_GROUND_STEP
    mat = bpy.data.materials.new("film-ground")
    nt = mat.node_tree if mat.node_tree else None
    if nt is None:
        mat.use_nodes = True
        nt = mat.node_tree
    bsdf = principled(mat)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    # u = (x - minX) / (w * step) + half a texel; v = (z - minZ) / (h * step) + half, with z = -Y.
    u = nt.nodes.new("ShaderNodeMath")
    u.operation = "MULTIPLY_ADD"
    nt.links.new(sep.outputs["X"], u.inputs[0])
    u.inputs[1].default_value = 1.0 / (w * step)
    u.inputs[2].default_value = (-t["minX"] / step + 0.5) / w
    v = nt.nodes.new("ShaderNodeMath")
    v.operation = "MULTIPLY_ADD"
    nt.links.new(sep.outputs["Y"], v.inputs[0])
    v.inputs[1].default_value = -1.0 / (h * step)
    v.inputs[2].default_value = (-t["minZ"] / step + 0.5) / h
    uv = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(u.outputs[0], uv.inputs[0])
    nt.links.new(v.outputs[0], uv.inputs[1])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Cubic"
    tex.extension = "EXTEND"
    nt.links.new(uv.outputs[0], tex.inputs["Vector"])
    # Beyond the 1 m map (outside the model's terrain), the web mesh's own vertex colours.
    vcol = nt.nodes.new("ShaderNodeAttribute")
    vcol.attribute_name = "film_col"
    inside = None
    for comp in (u, v):
        lo = nt.nodes.new("ShaderNodeMath")
        lo.operation = "COMPARE"
        nt.links.new(comp.outputs[0], lo.inputs[0])
        lo.inputs[1].default_value = 0.5
        lo.inputs[2].default_value = 0.5
        inside = lo if inside is None else _mul(nt, inside, lo)
    pick = nt.nodes.new("ShaderNodeMix")
    pick.data_type = "RGBA"
    nt.links.new(inside.outputs[0], pick.inputs["Factor"])
    nt.links.new(vcol.outputs["Color"], pick.inputs["A"])
    nt.links.new(tex.outputs["Color"], pick.inputs["B"])
    # Breakup: soil clods and grass tufts (0.3 m), patches (4 m); pebbles in the bump.
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 3.0
    fine.inputs["Detail"].default_value = 6.0
    nt.links.new(geo.outputs["Position"], fine.inputs["Vector"])
    coarse = nt.nodes.new("ShaderNodeTexNoise")
    coarse.inputs["Scale"].default_value = 0.25
    coarse.inputs["Detail"].default_value = 3.0
    nt.links.new(geo.outputs["Position"], coarse.inputs["Vector"])
    vary = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(fine.outputs["Fac"], vary.inputs["Value"])
    vary.inputs["To Min"].default_value = 0.78
    vary.inputs["To Max"].default_value = 1.18
    vary2 = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(coarse.outputs["Fac"], vary2.inputs["Value"])
    vary2.inputs["To Min"].default_value = 0.88
    vary2.inputs["To Max"].default_value = 1.1
    m1 = nt.nodes.new("ShaderNodeVectorMath")
    m1.operation = "MULTIPLY"
    nt.links.new(pick.outputs["Result"], m1.inputs[0])
    nt.links.new(vary.outputs[0], m1.inputs[1])
    m2 = nt.nodes.new("ShaderNodeVectorMath")
    m2.operation = "MULTIPLY"
    nt.links.new(m1.outputs[0], m2.inputs[0])
    nt.links.new(vary2.outputs[0], m2.inputs[1])
    nt.links.new(m2.outputs[0], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.96
    peb = nt.nodes.new("ShaderNodeTexVoronoi")
    peb.inputs["Scale"].default_value = 9.0
    nt.links.new(geo.outputs["Position"], peb.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(peb.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


SCENE_GROUND_STEP = 1.0


def _mul(nt, a, b):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = "MULTIPLY"
    nt.links.new(a.outputs[0], m.inputs[0])
    nt.links.new(b.outputs[0], m.inputs[1])
    return m


def web_terrain():
    """The web's ground mesh (scene.json `terrain`: planWorld.ts's grid, ±1.8 km) as the film's land,
    with its vertex colours, replacing the model's 980 x 448 m terrain (which stops short of the
    flight and aerial views). Faces point up; smooth shaded like the web's computed normals."""
    t = SCENE["terrain"]
    xs, zs = np.array(t["xs"]), np.array(t["zs"])
    nx, nz = len(xs), len(zs)
    hy = np.array(t["heights"]).reshape(nz, nx)
    gx, gz = np.meshgrid(xs, zs)
    co = np.stack([gx, -gz, hy], axis=-1).reshape(-1, 3).astype(np.float32)
    a = (np.arange(nz - 1)[:, None] * nx + np.arange(nx - 1)[None, :]).ravel()
    quads = np.stack([a, a + 1, a + 1 + nx, a + nx], axis=1)  # counter-clockwise seen from +Blender z
    me = bpy.data.meshes.new("film-terrain")
    me.vertices.add(len(co))
    me.vertices.foreach_set("co", co.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel().astype(np.int32))
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", (np.arange(len(quads)) * 4).astype(np.int32))
    me.update()
    me.polygons.foreach_set("use_smooth", np.ones(len(quads), bool))
    if me.polygons[0].normal.z < 0:
        me.flip_normals()
    col = me.color_attributes.new("film_col", "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(co), 4), np.float32)
    rgba[:, :3] = np.array(t["colors"], np.float32).reshape(-1, 3)
    col.data.foreach_set("color", rgba.ravel())
    obj = bpy.data.objects.new("film-terrain", me)
    collection("Film").objects.link(obj)
    return obj


def water_plane(name, r, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([to_b(r["minX"], r["y"], r["minZ"]), to_b(r["maxX"], r["y"], r["minZ"]), to_b(r["maxX"], r["y"], r["maxZ"]), to_b(r["minX"], r["y"], r["maxZ"])], [], [(0, 1, 2, 3)])
    me.update()
    if me.polygons[0].normal.z < 0:
        me.flip_normals()
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    collection("Film").objects.link(obj)
    return obj


def water_material(name, color, roughness, transmission, ripple_scale, ripple_strength, speed):
    """Water: a clean Fresnel reflection on animated ripples (two noise octaves drifting with time),
    so the low sun breaks into glitter on the stream. Transmission for the clear pool."""
    mat = bpy.data.materials.new(name)
    if not mat.node_tree:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = principled(mat)
    bsdf.inputs["Base Color"].default_value = (*hex_linear(color), 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["IOR"].default_value = 1.333
    for key in ("Transmission Weight", "Transmission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = transmission
            break
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    tnode = nt.nodes.new("ShaderNodeValue")
    tnode.name = "FILM_Time"
    # Driven by the frame: W of the 4D noise moves the ripples.
    drv = tnode.outputs[0].driver_add("default_value").driver
    drv.expression = f"frame / 24 * {speed}"
    height = None
    for scale, weight in ((ripple_scale, 1.0), (ripple_scale * 3.7, 0.35)):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = 4.0
        nt.links.new(geo.outputs["Position"], n.inputs["Vector"])
        nt.links.new(tnode.outputs[0], n.inputs["W"])
        m = nt.nodes.new("ShaderNodeMath")
        m.operation = "MULTIPLY"
        nt.links.new(n.outputs["Fac"], m.inputs[0])
        m.inputs[1].default_value = weight
        if height is None:
            height = m
        else:
            a = nt.nodes.new("ShaderNodeMath")
            nt.links.new(height.outputs[0], a.inputs[0])
            nt.links.new(m.outputs[0], a.inputs[1])
            height = a
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = ripple_strength
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(height.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def dress_ground_and_water():
    """The web's land, stream and pool water (planWorld.ts), with the film's ground and water shaders.
    The model's own terrain and water quads (its bake helpers) stay hidden."""
    for name in ("terrain", "stream-water", "pool-water"):
        o = bpy.data.objects.get(name)
        if o:
            o.hide_render = True
            o.hide_viewport = True
    ground = web_terrain()
    ground.data.materials.append(ground_material())
    t = SCENE["terrain"]
    water_plane("film-stream", t["stream"], water_material("film-stream", "#1f3c40", 0.035, 0.0, 0.9, 0.25, 0.35))
    water_plane("film-pool", t["pool"], water_material("film-pool", "#cfe3e0", 0.01, 1.0, 1.6, 0.08, 0.25))


# ------------------------------------------------------------------ vegetation

def import_library(path, col_name):
    if not os.path.exists(path):
        raise SystemExit(
            f"missing {path}: build it with scripts/blender/vegetation.py or life.py (track 3A), "
            "or copy the raw GLB from the track 3A output"
        )
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    col = collection(col_name)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
    col.hide_render = True
    col.hide_viewport = True
    return {o.name: o for o in new}


def wind_group(amplitude, frequency, phase):
    """Sways a plant by its _WIND weight (0 at the trunk, 1 at the tips): a slow sway plus a faster
    flutter, both horizontal, from 4D noise in scene time. One group per plant kind and phase."""
    name = f"FILM_Wind_{amplitude:.3f}_{frequency:.2f}_{phase}"
    ng = bpy.data.node_groups.get(name)
    if ng:
        return ng
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n = ng.nodes
    gin, gout = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    setp = n.new("GeometryNodeSetPosition")
    pos = n.new("GeometryNodeInputPosition")
    tm = n.new("GeometryNodeInputSceneTime")
    wt = n.new("GeometryNodeInputNamedAttribute")
    wt.data_type = "FLOAT"
    wt.inputs["Name"].default_value = "_WIND"
    offset = None
    for k, (amp, freq, scale) in enumerate(((amplitude, frequency, 0.18), (amplitude * 0.22, frequency * 5.3, 1.6))):
        w = n.new("ShaderNodeMath")
        w.operation = "MULTIPLY_ADD"
        ng.links.new(tm.outputs["Seconds"], w.inputs[0])
        w.inputs[1].default_value = freq
        w.inputs[2].default_value = phase * 7.31 + k * 3.1
        noise = n.new("ShaderNodeTexNoise")
        noise.noise_dimensions = "4D"
        noise.inputs["Scale"].default_value = scale
        noise.inputs["Detail"].default_value = 1.0
        ng.links.new(pos.outputs[0], noise.inputs["Vector"])
        ng.links.new(w.outputs[0], noise.inputs["W"])
        centre = n.new("ShaderNodeVectorMath")
        centre.operation = "SUBTRACT"
        ng.links.new(noise.outputs["Color"], centre.inputs[0])
        centre.inputs[1].default_value = (0.5, 0.5, 0.5)
        flat = n.new("ShaderNodeVectorMath")
        flat.operation = "MULTIPLY"
        ng.links.new(centre.outputs[0], flat.inputs[0])
        flat.inputs[1].default_value = (amp * 2, amp * 2, amp * 0.4)
        if offset is None:
            offset = flat
        else:
            add = n.new("ShaderNodeVectorMath")
            ng.links.new(offset.outputs[0], add.inputs[0])
            ng.links.new(flat.outputs[0], add.inputs[1])
            offset = add
    scale = n.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    ng.links.new(offset.outputs[0], scale.inputs[0])
    ng.links.new(wt.outputs[0], scale.inputs["Scale"])
    ng.links.new(gin.outputs[0], setp.inputs["Geometry"])
    ng.links.new(scale.outputs[0], setp.inputs["Offset"])
    ng.links.new(setp.outputs[0], gout.inputs[0])
    return ng


def instancer_group(proto):
    """Instances `proto` on every point, turned by the point's `rot` (Euler) and scaled by `scl`."""
    ng = bpy.data.node_groups.new(f"FILM_Instance_{proto.name}", "GeometryNodeTree")
    ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    n = ng.nodes
    gin, gout = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    info = n.new("GeometryNodeObjectInfo")
    info.transform_space = "ORIGINAL"
    info.inputs["As Instance"].default_value = True
    inst = n.new("GeometryNodeInstanceOnPoints")
    rot = n.new("GeometryNodeInputNamedAttribute")
    rot.data_type = "FLOAT_VECTOR"
    rot.inputs["Name"].default_value = "rot"
    scl = n.new("GeometryNodeInputNamedAttribute")
    scl.data_type = "FLOAT"
    scl.inputs["Name"].default_value = "scl"
    info.inputs["Object"].default_value = proto
    ng.links.new(gin.outputs["Geometry"], inst.inputs["Points"])
    ng.links.new(info.outputs["Geometry"], inst.inputs["Instance"])
    ng.links.new(rot.outputs["Attribute"], inst.inputs["Rotation"])
    ng.links.new(scl.outputs["Attribute"], inst.inputs["Scale"])
    ng.links.new(inst.outputs[0], gout.inputs[0])
    return ng


def wind_kind(species_id):
    for k in WIND:
        if species_id.startswith(k):
            return k
    return "shrub"


def place_vegetation(library):
    """Every plant of scene.json as instances of its library node, split into WIND_PHASES groups that
    sway out of step. Matrices are three.js instance matrices: Blender's is C * M * C^-1."""
    col = collection("Vegetation")
    protos_col = collection("VEG_Prototypes")
    protos_col.hide_render = True
    protos_col.hide_viewport = True
    counts = {}
    for sp in SCENE["vegetation"]:
        src = library.get(sp["node"])
        if src is None or sp["count"] == 0:
            log(f"vegetation: no node {sp['node']} for {sp['id']}")
            continue
        m = np.array(sp["matrices"], np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)  # column-major
        kind = wind_kind(sp["id"])
        amp, freq = WIND[kind]
        for phase in range(WIND_PHASES):
            sel = m[phase::WIND_PHASES]
            if not len(sel):
                continue
            proto = src.copy()
            proto.name = f"veg-{sp['id']}-phase{phase}"
            protos_col.objects.link(proto)
            mod = proto.modifiers.new("wind", "NODES")
            mod.node_group = wind_group(amp, freq, phase)
            locs, rots, scls = [], [], []
            for mi in sel:
                mb = C @ Matrix(mi.tolist()) @ C_INV
                loc, q, s = mb.decompose()
                locs.append(loc[:])
                rots.extend(q.to_euler()[:])
                scls.append(s[0])
            me = bpy.data.meshes.new(f"pts-{sp['id']}-{phase}")
            me.from_pydata(locs, [], [])
            me.attributes.new("rot", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", rots)
            me.attributes.new("scl", "FLOAT", "POINT").data.foreach_set("value", scls)
            obj = bpy.data.objects.new(f"VEG_{sp['id']}_{phase}", me)
            col.objects.link(obj)
            gm = obj.modifiers.new("instances", "NODES")
            gm.node_group = instancer_group(proto)
        counts[sp["id"]] = sp["count"]
    log("vegetation:", counts)
    return counts


FOLIAGE = {"veg-olive": (0.62, 0.22, 0.3), "veg-citrus": (0.55, 0.3, 0.25), "veg-palm": (0.6, 0.25, 0.25), "veg-hedge": (0.7, 0.2, 0.15), "veg-grass": (0.8, 0.15, 0.2), "veg-card": (0.7, 0.2, 0.2)}


def foliage_look():
    """Leaves for path tracing. As exported (roughness ~0.45, full specular) thousands of cards seen
    edge-on mirror the sky, so distant olive rows read white and glow at blue hour. Rougher, less
    specular leaves, plus a little translucency (sun through backlit olive and palm leaves), under
    the same alpha cut-out: the leaf colours themselves (the 3A atlas) are unchanged."""
    for name, (rough, spec, translucency) in FOLIAGE.items():
        m = bpy.data.materials.get(name)
        if not m or not m.node_tree or m.node_tree.nodes.get("film-leaf"):
            continue
        nt = m.node_tree
        bsdf = principled(m)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Specular IOR Level"].default_value = spec
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        alpha_link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Alpha"]), None)
        colour_link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Base Color"]), None)
        trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
        if colour_link:
            nt.links.new(colour_link.from_socket, trans.inputs["Color"])
        leaf = nt.nodes.new("ShaderNodeMixShader")
        leaf.name = "film-leaf"
        leaf.inputs[0].default_value = translucency
        nt.links.new(bsdf.outputs[0], leaf.inputs[1])
        nt.links.new(trans.outputs[0], leaf.inputs[2])
        last = leaf
        if alpha_link:
            cut = nt.nodes.new("ShaderNodeMixShader")
            cut.name = "film-cut"
            clear = nt.nodes.new("ShaderNodeBsdfTransparent")
            nt.links.new(alpha_link.from_socket, cut.inputs[0])
            nt.links.new(clear.outputs[0], cut.inputs[1])
            nt.links.new(leaf.outputs[0], cut.inputs[2])
            nt.links.remove(alpha_link)
            bsdf.inputs["Alpha"].default_value = 1.0
            last = cut
        nt.links.new(last.outputs[0], out.inputs["Surface"])


# ------------------------------------------------------------------ life

def tint_paint():
    """Car paint takes each car's tint from its object colour (as the web tints per instance)."""
    m = bpy.data.materials.get("life-paint")
    if not m or m.node_tree.nodes.get("film-tint"):
        return
    nt = m.node_tree
    bsdf = principled(m)
    link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Base Color"]), None)
    info = nt.nodes.new("ShaderNodeObjectInfo")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.name = "film-tint"
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    if link:
        nt.links.new(link.from_socket, mix.inputs["A"])
    else:
        mix.inputs["A"].default_value = bsdf.inputs["Base Color"].default_value
    nt.links.new(info.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])


def place_car(lib, asset, name, tint, col):
    body = lib[asset]
    car = body.copy()
    car.name = name
    car.color = (*hex_linear(tint), 1)
    col.objects.link(car)
    wheels = []
    for child in body.children:
        w = child.copy()
        w.parent = car
        w.name = f"{name}-{child.name.split('-')[-1]}"
        col.objects.link(w)
        wheels.append(w)
    return car, wheels


def animate_track(obj, track, stride, frames, scale=1.0):
    t = np.array(track, np.float64).reshape(frames, stride)
    f = np.arange(1, frames + 1, dtype=np.float64)
    bulk_keys(obj, "location", 0, f, t[:, 0])
    bulk_keys(obj, "location", 1, f, -t[:, 2])
    bulk_keys(obj, "location", 2, f, t[:, 1])
    bulk_keys(obj, "rotation_euler", 2, f, unwrap(t[:, 3]))
    obj.scale = (scale, scale, scale)
    return t


def place_life(lib):
    life = SCENE["life"]
    frames = life["frames"]
    col = collection("Life")
    tint_paint()
    rig = lib["person-rig"]
    actions = {a.name: a for a in bpy.data.actions}
    people = 0
    for w in life["walkers"]:
        arm = bpy.data.objects.new(f"person-{w['id']}", rig.data)
        col.objects.link(arm)
        body = lib[w["asset"]].copy()
        body.name = f"{w['asset']}-{w['id']}"
        body.parent = arm
        col.objects.link(body)
        for mod in body.modifiers:
            if mod.type == "ARMATURE":
                mod.object = arm
        act = actions.get(w["clip"])
        if act:
            ad = arm.animation_data_create()
            track = ad.nla_tracks.new()
            length = act.frame_range[1] - act.frame_range[0]
            scale = 1.0 / max(1e-3, w["timeScale"])
            offset = (w["phase"] * life["fps"] / scale) % max(1.0, length * scale)
            strip = track.strips.new(w["clip"], int(1 - round(offset)), act)
            if hasattr(strip, "action_slot") and getattr(act, "slots", None) and len(act.slots):
                strip.action_slot = act.slots[0]
            strip.scale = scale
            strip.repeat = math.ceil((frames + offset + 2) / max(1.0, length * scale)) + 1
        if w["moving"]:
            animate_track(arm, w["track"], 4, frames, w["scale"])
        else:
            x, y, z, h = w["track"]
            arm.location = to_b(x, y, z)
            arm.rotation_euler = (0, 0, h)
            arm.scale = (w["scale"],) * 3
        people += 1
    cars = 0
    for c in life["cars"]:
        car, wheels = place_car(lib, c["asset"], f"car-{c['id']}", c["tint"], col)
        t = animate_track(car, c["track"], 5, frames)
        f = np.arange(1, frames + 1, dtype=np.float64)
        for wh in wheels:
            r = max(0.05, wh.dimensions.z / 2)
            bulk_keys(wh, "rotation_euler", 0, f, t[:, 4] / r)
        cars += 1
    for c in life["parked"]:
        car, _ = place_car(lib, c["asset"], f"parked-{c['id']}", c["tint"], col)
        car.location = to_b(c["x"], c["y"], c["z"])
        car.rotation_euler = (0, 0, c["rotation"])
        cars += 1
    birds = 0
    bird = lib.get("bird")
    for i, b in enumerate(life["birds"]):
        if bird is None:
            break
        o = bird.copy()
        o.data = bird.data.copy()  # own shape-key values per bird
        o.name = f"bird-{i:02d}"
        col.objects.link(o)
        t = animate_track(o, b["track"], 6, frames)
        key = o.data.shape_keys
        key.animation_data_clear()  # the library's looping "flap" action; the web's flap timing replaces it
        f = np.arange(1, frames + 1, dtype=np.float64)
        bulk_keys(key, 'key_blocks["wings-up"].value', 0, f, t[:, 4])
        bulk_keys(key, 'key_blocks["wings-down"].value', 0, f, t[:, 5])
        birds += 1
    for name in ("Icosphere",):
        if name in lib:
            lib[name].hide_render = True
    log(f"life: {people} people, {cars} cars, {birds} birds")
    return {"people": people, "cars": cars, "birds": birds}


# ------------------------------------------------------------------ light: day, dusk and the time-lapse

def light_k(frame):
    """0 golden hour .. 1 blue hour at a film frame (07 is the time-lapse, eased in and out)."""
    for shot in SHOTS["shots"]:
        if shot["startFrame"] <= frame <= shot["endFrame"]:
            if shot["light"] == "day":
                return 0.0
            if shot["light"] == "dusk":
                return 1.0
            u = (frame - shot["startFrame"]) / (shot["endFrame"] - shot["startFrame"])
            return u * u * (3 - 2 * u)
    return 0.0


def ramp(k, a, b):
    return min(max((k - a) / (b - a), 0.0), 1.0)


def build_lights():
    """lighting.py's day and dusk rigs in one scene, with one world that blends their skies."""
    scene = bpy.context.scene
    day_col, dusk_col = collection("Lights-day"), collection("Lights-dusk")
    sun = lighting.add_sun(day_col)
    dusk_counts = lighting.add_dusk_lights(dusk_col)
    day_world, day_info = lighting.make_world("day")
    dusk_world, dusk_info = lighting.make_world("dusk")
    world = bpy.data.worlds.new("FILM_World")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.name = "FILM_SkyMix"
    for i, (w, info) in enumerate(((day_world, day_info), (dusk_world, dusk_info))):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = next(n for n in w.node_tree.nodes if n.type == "TEX_ENVIRONMENT").image
        bg = nt.nodes.new("ShaderNodeBackground")
        bg.inputs["Strength"].default_value = info["strength"]
        nt.links.new(env.outputs[0], bg.inputs[0])
        nt.links.new(bg.outputs[0], mix.inputs[1 + i])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    scene.world = world
    for o in dusk_col.objects:
        o["film_energy"] = o.data.energy
    return {"sun": sun, "day": day_col, "dusk": dusk_col, "world": world, "duskCounts": dusk_counts, "dayWorld": day_info, "duskWorld": dusk_info}


def window_glow():
    """Lit windows at dusk (lighting.windows_lit: 72 % of villas, every block and amenity), per object."""
    m = bpy.data.materials.get("glass")
    nt = m.node_tree
    bsdf = principled(m)
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "OBJECT"
    attr.attribute_name = "film_lit"
    k = nt.nodes.new("ShaderNodeValue")
    k.name = "FILM_WindowGlow"
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(attr.outputs["Fac"], mul.inputs[0])
    nt.links.new(k.outputs[0], mul.inputs[1])
    nt.links.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
    bsdf.inputs["Emission Color"].default_value = (*hex_linear("#ffc98a"), 1)
    for col in ("Villas", "Apartments", "Amenities"):
        c = bpy.data.collections.get(col)
        for o in c.objects if c else []:
            o["film_lit"] = 1.0 if lighting.windows_lit(o.name) else 0.0
    return k


def set_light_state(rig, k, frame=None):
    """Sets (and keys, when `frame` is given) everything that changes from golden to blue hour."""
    scene = bpy.context.scene
    sun = rig["sun"]
    elevation = lighting.SUN["elevationDeg"] + (-5.0 - lighting.SUN["elevationDeg"]) * k
    d = lighting.to_blender(lighting.sun_direction(elevation, lighting.SUN["liftDeg"] * (1 - k)))
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sun.data.energy = lighting.SUN["intensity"] * (1 - ramp(k, 0.1, 0.55))
    rig["world"].node_tree.nodes["FILM_SkyMix"].inputs[0].default_value = k
    lamps = ramp(k, 0.4, 0.65)
    windows = ramp(k, 0.5, 0.85)
    for o in rig["dusk"].objects:
        o.data.energy = o["film_energy"] * lamps
    for m in bpy.data.materials:
        if m.name.startswith("lamp-glow") and m.node_tree:
            principled(m).inputs["Emission Strength"].default_value = 4.0 * lamps
    rig["glow"].outputs[0].default_value = lighting.GLASS_GLOW * windows
    scene.view_settings.exposure = LOOK["exposureDay"] + (LOOK["exposureDusk"] - LOOK["exposureDay"]) * k
    haze = rig.get("haze")
    if haze is not None:
        # The day haze stands to the day sky as the dusk haze to the dusk sky (strengths from make_world).
        dusk_haze = hex_linear(DUSK_HAZE) * rig["duskWorld"]["strength"] / max(1e-6, rig["dayWorld"]["strength"])
        c = hex_linear(lighting.HAZE["color"]) * (1 - k) + dusk_haze * k
        haze.outputs[0].default_value = (*c, 1)
    if frame is None:
        return
    sun.keyframe_insert("rotation_euler", frame=frame)
    sun.data.keyframe_insert("energy", frame=frame)
    rig["world"].node_tree.nodes["FILM_SkyMix"].inputs[0].keyframe_insert("default_value", frame=frame)
    for o in rig["dusk"].objects:
        o.data.keyframe_insert("energy", frame=frame)
    for m in bpy.data.materials:
        if m.name.startswith("lamp-glow") and m.node_tree:
            principled(m).inputs["Emission Strength"].keyframe_insert("default_value", frame=frame)
    rig["glow"].outputs[0].keyframe_insert("default_value", frame=frame)
    scene.view_settings.keyframe_insert("exposure", frame=frame)
    if haze is not None:
        haze.outputs[0].keyframe_insert("default_value", frame=frame)


def key_light_timeline(rig):
    timelapse = next(s for s in SHOTS["shots"] if s["light"] == "day-to-dusk")
    frames = sorted({1, SHOTS["frames"], *[timelapse["startFrame"] + round(i / 24 * (timelapse["endFrame"] - timelapse["startFrame"])) for i in range(25)], timelapse["startFrame"] - 1, timelapse["endFrame"] + 1})
    for f in frames:
        set_light_state(rig, light_k(f), f)


def lights_for(shot_lights):
    """Hide the rig a shot never sees (the light tree still pays for dark lights)."""
    rig = RIG
    rig["day"].hide_render = all(s == "dusk" for s in shot_lights)
    rig["dusk"].hide_render = all(s == "day" for s in shot_lights)


# ------------------------------------------------------------------ render setup and compositor

def setup_render(engine, samples):
    scene = bpy.context.scene
    scene.render.fps = SHOTS["fps"]
    scene.frame_start, scene.frame_end = 1, SHOTS["frames"]
    if engine == "eevee":
        engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
        scene.render.engine = next(e for e in engines if "EEVEE" in e)
    else:
        lighting.setup_cycles(samples)
        c = scene.cycles
        c.use_adaptive_sampling = True
        c.adaptive_threshold = LOOK["adaptiveThreshold"]
        c.use_denoising = True
        try:
            c.denoiser = "OPENIMAGEDENOISE"
        except TypeError:
            pass
        c.max_bounces = 8
        c.diffuse_bounces = 3
        c.glossy_bounces = 3
        c.transparent_max_bounces = 24
        c.sample_clamp_indirect = 6.0
        if hasattr(c, "use_light_tree"):
            c.use_light_tree = True
        scene.render.use_persistent_data = True
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = LOOK["motionBlurShutter"]
    scene.view_settings.view_transform = LOOK["viewTransform"]
    for name in (f"{LOOK['viewTransform']} - {LOOK['look']}", LOOK["look"]):
        try:
            scene.view_settings.look = name
            break
        except TypeError as e:
            log("look:", e)
    scene.view_layers[0].use_pass_z = True  # posters fog from depth, as the web does


def socket(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


def fog_group():
    """The web's FogExp2 (world.ts colour and density) in the shaders: on camera rays every surface
    fades toward the haze colour by its distance from the camera, f = 1 - exp(-(density * d)^2), and
    the sky is never fogged (as on the web). Shading-side, so it is exact under depth of field, motion
    blur and alpha-cut leaves (a pass-based fog mixes a leaf's depth with the sky's at its edges).
    `FILM_FogStrength` is 1 for the film and stills, 0 for posters (they fog in lighting.fog)."""
    ng = bpy.data.node_groups.get("FILM_Fog")
    if ng:
        return ng
    ng = bpy.data.node_groups.new("FILM_Fog", "ShaderNodeTree")
    ng.interface.new_socket(name="Surface", in_out="INPUT", socket_type="NodeSocketShader")
    ng.interface.new_socket(name="Surface", in_out="OUTPUT", socket_type="NodeSocketShader")
    n, L = ng.nodes, ng.links.new
    gin, gout = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    cam = n.new("ShaderNodeCameraData")
    path = n.new("ShaderNodeLightPath")

    def math(op, a, value=None, b=None, clamp=False):
        m = n.new("ShaderNodeMath")
        m.operation = op
        m.use_clamp = clamp
        L(a, m.inputs[0])
        if b is not None:
            L(b, m.inputs[1])
        elif value is not None:
            m.inputs[1].default_value = value
        return m.outputs[0]

    d = math("MULTIPLY", cam.outputs["View Distance"], lighting.HAZE["density"])
    e = math("EXPONENT", math("MULTIPLY", math("POWER", d, 2.0), -1.0))
    fog = n.new("ShaderNodeMath")
    fog.operation = "SUBTRACT"
    fog.use_clamp = True
    fog.inputs[0].default_value = 1.0
    L(e, fog.inputs[1])
    strength = n.new("ShaderNodeValue")
    strength.name = "FILM_FogStrength"
    strength.outputs[0].default_value = 1.0
    fac = math("MULTIPLY", math("MULTIPLY", fog.outputs[0], b=path.outputs["Is Camera Ray"]), b=strength.outputs[0])
    haze = n.new("ShaderNodeRGB")
    haze.name = "FILM_Haze"
    haze.outputs[0].default_value = (*hex_linear(lighting.HAZE["color"]), 1)
    emit = n.new("ShaderNodeEmission")
    L(haze.outputs[0], emit.inputs["Color"])
    mix = n.new("ShaderNodeMixShader")
    L(fac, mix.inputs[0])
    L(gin.outputs[0], mix.inputs[1])
    L(emit.outputs[0], mix.inputs[2])
    L(mix.outputs[0], gout.inputs[0])
    return ng


def fog_materials():
    """Puts FILM_Fog on every surface the camera can see. Where a material cuts leaves or lattices
    out by alpha, the fog goes under the cut, so the clear parts stay clear."""
    ng = fog_group()
    done = 0
    for m in bpy.data.materials:
        if not m.users or not m.node_tree or m.node_tree.nodes.get("film-fog"):
            continue
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) or next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None or not out.inputs["Surface"].is_linked:
            continue
        src = out.inputs["Surface"].links[0].from_socket
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        alpha_link = next((l for l in nt.links if bsdf and l.to_socket == bsdf.inputs["Alpha"]), None)
        fog = nt.nodes.new("ShaderNodeGroup")
        fog.node_tree = ng
        fog.name = "film-fog"
        cut = nt.nodes.get("film-cut")
        if cut is not None:  # foliage_look's cut: fog the leaf, not the hole
            leaf = cut.inputs[2].links[0].from_socket
            nt.links.new(leaf, fog.inputs[0])
            nt.links.new(fog.outputs[0], cut.inputs[2])
        elif alpha_link is not None and src.node == bsdf:
            cut = nt.nodes.new("ShaderNodeMixShader")
            cut.name = "film-cut"
            clear = nt.nodes.new("ShaderNodeBsdfTransparent")
            nt.links.new(alpha_link.from_socket, cut.inputs[0])
            nt.links.new(clear.outputs[0], cut.inputs[1])
            nt.links.new(bsdf.outputs[0], fog.inputs[0])
            nt.links.new(fog.outputs[0], cut.inputs[2])
            nt.links.remove(alpha_link)
            bsdf.inputs["Alpha"].default_value = 1.0
            nt.links.new(cut.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(src, fog.inputs[0])
            nt.links.new(fog.outputs[0], out.inputs["Surface"])
        done += 1
    log(f"fog on {done} materials")
    return ng.nodes["FILM_Haze"]


def build_compositor():
    """A soft glow on bright lights and a touch of lens dispersion. The haze is in the shaders
    (fog_group); grade, vignette, grain and letterbox come after, in edit.mjs."""
    scene = bpy.context.scene
    ng = bpy.data.node_groups.new("FILM_Compositor", "CompositorNodeTree")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = ng
    scene.render.use_compositing = True
    n, L = ng.nodes, ng.links.new
    rl = n.new("CompositorNodeRLayers")
    out = n.new("NodeGroupOutput")
    last = rl.outputs["Image"]
    glare = n.new("CompositorNodeGlare")
    for attr, value in (("glare_type", "FOG_GLOW"), ("quality", "HIGH")):
        try:
            setattr(glare, attr, value)
        except (AttributeError, TypeError):
            pass
    socket(glare, ["Type"], "Fog Glow")
    socket(glare, ["Threshold"], LOOK["glare"]["threshold"])
    socket(glare, ["Strength"], LOOK["glare"]["strength"])
    socket(glare, ["Size"], LOOK["glare"]["size"] / 9 if "Size" in glare.inputs and glare.inputs["Size"].type == "VALUE" else LOOK["glare"]["size"])
    if not socket(glare, ["Mix"], 0.0):
        try:
            glare.mix = LOOK["glare"]["strength"] * 2 - 1
            glare.threshold = LOOK["glare"]["threshold"]
        except AttributeError:
            pass
    L(last, glare.inputs["Image"])
    last = glare.outputs["Image"]
    lens = n.new("CompositorNodeLensdist")
    if not socket(lens, ["Dispersion"], LOOK["dispersion"]):
        lens.inputs[2].default_value = LOOK["dispersion"]
    L(last, lens.inputs["Image"])
    L(lens.outputs["Image"], out.inputs[0])


# ------------------------------------------------------------------ cameras

def poster_camera(p):
    data = bpy.data.cameras.new(f"CAM_Poster_{p['id']}")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(p["fovVertical"])
    data.clip_start = 0.1
    data.clip_end = 8000
    cam = bpy.data.objects.new(f"CAM_Poster_{p['id']}", data)
    collection("COL_Cameras").objects.link(cam)
    eye, tgt = to_b(*p["position"]), to_b(*p["target"])
    cam.location = eye
    cam.rotation_euler = (tgt - eye).to_track_quat("-Z", "Y").to_euler()
    return cam


def shot_of_frame(frame):
    return next(s for s in SHOTS["shots"] if s["startFrame"] <= frame <= s["endFrame"])


# ------------------------------------------------------------------ renders

def set_resolution(w, h, scale):
    r = bpy.context.scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, scale


def png16(path):
    s = bpy.context.scene.render.image_settings
    lighting.set_enum(s, "file_format", ["PNG"])
    s.color_mode = "RGB"
    s.color_depth = "16"
    s.compression = 15
    bpy.context.scene.render.filepath = path


def render_posters(only, scale, samples):
    scene = bpy.context.scene
    done = []
    scene.render.use_compositing = False
    scene.render.use_motion_blur = False
    fog_strength = bpy.data.node_groups["FILM_Fog"].nodes["FILM_FogStrength"].outputs[0]
    fog_strength.default_value = 0.0  # posters fog from depth exactly as the web canvas (lighting.fog)
    lights_for(["day"])
    set_light_state(RIG, 0.0)
    scene.frame_set(1)
    for p in SCENE["posters"]:
        if only and p["id"] not in only:
            continue
        scene.camera = poster_camera(p)
        set_resolution(p["width"], p["height"], scale)
        exr = os.path.join(FILM_OUT, "posters", f"{p['id']}.exr")
        px, names = lighting.render_multilayer(exr, samples, True)
        beauty = lighting.pass_of(px, names, ["Combined", "Image"])
        zi = [i for i, nme in enumerate(names) if nme.endswith(".Z") or nme.endswith("Depth.V")]
        depth = px[..., zi[0]] if zi else np.full(beauty.shape[:2], 1e9, np.float32)
        web = np.clip(lighting.aces(lighting.fog(beauty, depth, depth > 1e5), lighting.EXPOSURE), 0, 1)
        u8 = (web * 255 + 0.5).astype(np.uint8)
        target = os.path.join(ROOT, p["file"])
        png = os.path.join(FILM_OUT, "posters", f"scene-zaitun-{p['id']}.png")
        lighting.write_image(png, u8, u8=True)
        write_jpeg(u8, target, 86)
        log(f"poster {p['id']}: {target} ({os.path.getsize(target) // 1024} KB)")
        done.append({"id": p["id"], "file": p["file"], "bytes": os.path.getsize(target), "camera": camera_report(scene.camera)})
    scene.render.use_compositing = True
    scene.render.use_motion_blur = True
    fog_strength.default_value = 1.0
    return done


def write_jpeg(rgb_bottom_up, path, quality):
    import OpenImageIO as oiio  # bundled with Blender

    img = np.ascontiguousarray(rgb_bottom_up[::-1])
    h, w, ch = img.shape
    spec = oiio.ImageSpec(w, h, ch, oiio.UINT8)
    spec.attribute("Compression", f"jpeg:{quality}")
    spec.attribute("jpeg:subsampling", "4:2:0")
    out = oiio.ImageOutput.create(path)
    out.open(path, spec)
    out.write_image(img)
    out.close()


def render_stills(only, scale, samples):
    scene = bpy.context.scene
    done = []
    scene.render.use_motion_blur = False
    for st in SCENE["stills"]:
        if only and st["id"] not in only:
            continue
        shot = next(s for s in SHOTS["shots"] if s["id"] == st["shot"])
        lights_for([shot["light"]])
        scene.frame_set(st["frame"])
        scene.camera = CAMS[shot["id"]]
        set_resolution(st["width"], st["height"], scale)
        scene.cycles.samples = samples
        path = os.path.join(FILM_OUT, st["file"])
        png16(path)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        log(f"still {st['id']}: frame {st['frame']} in {time.time() - t:.0f}s")
        done.append({"id": st["id"], "frame": st["frame"], "seconds": round(time.time() - t, 1)})
    scene.render.use_motion_blur = True
    return done


def frames_dir(scale):
    """frames/ holds the full-size film; a preview at another scale gets frames-<scale>/, so the
    resumable final render never mistakes preview frames for its own."""
    return "frames" if scale == 100 else f"frames-{scale}"


def render_shots(only, frame_range, scale, samples):
    """The film's frames, one global numbering (frames/f_0001.png ...), skipping frames already on
    disk, so a render can stop and resume, or run as several processes at once."""
    scene = bpy.context.scene
    r = scene.render
    r.use_overwrite = False
    r.use_placeholder = True
    set_resolution(SHOTS["frame"]["width"], SHOTS["frame"]["height"], scale)
    scene.cycles.samples = samples
    done = []
    for shot in SHOTS["shots"]:
        if only and shot["id"] not in only:
            continue
        a, b = shot["startFrame"], shot["endFrame"]
        if frame_range:
            a, b = max(a, frame_range[0]), min(b, frame_range[1])
            if a > b:
                continue
        lights_for([shot["light"]])
        scene.camera = CAMS[shot["id"]]
        scene.frame_start, scene.frame_end = a, b
        png16(os.path.join(FILM_OUT, frames_dir(scale), "f_"))
        r.filepath = os.path.join(FILM_OUT, frames_dir(scale), "f_####")
        t = time.time()
        bpy.ops.render.render(animation=True)
        log(f"shot {shot['id']}: frames {a}-{b} in {time.time() - t:.0f}s")
        done.append({"shot": shot["id"], "frames": [a, b], "seconds": round(time.time() - t, 1)})
    scene.frame_start, scene.frame_end = 1, SHOTS["frames"]
    return done


def camera_report(cam):
    m = cam.matrix_world
    fwd = m.to_quaternion() @ Vector((0, 0, -1))
    eye = m.translation
    return {
        "eye": lighting.to_three(eye),
        "forward": lighting.to_three(fwd),
        "fovVerticalDeg": round(math.degrees(cam.data.angle_y), 3) if cam.data.sensor_fit == "VERTICAL" else None,
    }


# ------------------------------------------------------------------ main

RIG = {}
CAMS = {}


def main():
    scene = bpy.context.scene
    assert bpy.data.collections.get("Villas"), "open the .blend written by build_compound.py --plan zaitun --blend"
    os.makedirs(FILM_OUT, exist_ok=True)
    engine = arg_value("--engine", "cycles")
    scale = int(arg_value("--scale", "100"))
    setup_render(engine, LOOK["samples"]["shot"])

    dress_ground_and_water()
    veg = import_library(os.path.join(OUT, "vegetation-high.raw.glb"), "VEG_Library")
    foliage_look()
    veg_counts = place_vegetation(veg)
    life_lib = import_library(os.path.join(OUT, "life-high.raw.glb"), "LIFE_Library")
    life_counts = place_life(life_lib)

    RIG.update(build_lights())
    RIG["glow"] = window_glow()
    build_compositor()
    RIG["haze"] = fog_materials()
    key_light_timeline(RIG)
    CAMS.update(storyboard.build_cameras(SHOTS))
    for marker in scene.timeline_markers:  # every render here picks its camera itself
        marker.camera = None
    for cam in CAMS.values():
        cam.data.clip_end = 8000
    log("lights:", RIG["duskCounts"])

    report = {
        "version": 1,
        "note": "Written by scripts/blender/film/film.py; checked by film.test.ts.",
        "look": LOOK,
        "haze": {"color": lighting.HAZE["color"], "density": lighting.HAZE["density"], "dusk": DUSK_HAZE},
        "sun": lighting.SUN,
        "exposureWeb": {"day": lighting.EXPOSURE, "dusk": lighting.DUSK_EXPOSURE},
        "vegetation": veg_counts,
        "life": life_counts,
        "duskLights": RIG["duskCounts"],
        "cameras": {sid: {"lens": c.data.lens, "fStop": c.data.dof.aperture_fstop, "sensorWidth": c.data.sensor_width} for sid, c in CAMS.items()},
        "posters": [],
        "stills": [],
        "shots": [],
    }
    if os.path.exists(REPORT_PATH):
        old = json.load(open(REPORT_PATH))
        for k in ("posters", "stills", "shots"):
            report[k] = old.get(k, [])

    def merge(key, new, by):
        keep = [x for x in report[key] if x[by] not in {n[by] for n in new}]
        report[key] = sorted(keep + new, key=lambda x: str(x[by]))

    if "--save" in ARGS:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(FILM_OUT, "film.blend"), compress=True)
        log("saved film.blend")
    posters = arg_list("--posters")
    if posters is not None:
        merge("posters", render_posters(posters, scale, int(arg_value("--samples", LOOK["samples"]["poster"]))), "id")
    stills = arg_list("--stills")
    if stills is not None:
        merge("stills", render_stills(stills, scale, int(arg_value("--samples", LOOK["samples"]["still"]))), "id")
    shots = arg_list("--shots")
    if shots is not None:
        fr = arg_value("--frames", None)
        fr = tuple(int(x) for x in fr.split("-")) if fr else None
        merge("shots", render_shots(shots, fr, scale, int(arg_value("--samples", LOOK["samples"]["shot"]))), "shot")
    if "--report" in ARGS or posters is not None or stills is not None or shots is not None:
        with open(REPORT_PATH, "w") as f:
            json.dump(report, f, indent=2)
            f.write("\n")
        log("report", REPORT_PATH)


if __name__ == "__main__":
    main()
