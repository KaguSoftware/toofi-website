"""
Material lookdev: renders the trim-sheet surfaces, the dust pass and the per-copy tint in
Cycles under the golden-hour sun, so the materials can be judged on their own.

    blender -b --factory-startup -P scripts/blender/lookdev_materials.py -- \
        [--out DIR] [--samples 128] [--clean]

Builds everything with build_compound.py's own functions (atlas, surfaces, villa assets, AO
bake) and writes to <out>/lookdev/ (default scripts/blender/out/lookdev/):

    lookdev-walls-a.png, lookdev-walls-b.png   every wall surface as a 1.8 x 2.6 m panel
    lookdev-floors.png                         the floor surfaces as 3 x 3 m tiles
    lookdev-villas.png                         three copies of one villa type (tint, dust)
    lookdev-base.png                           85 mm on a villa's entrance and plinth

--clean renders the same frames without the imperfection pass (no dust, streaks, stains,
corner dirt, colour mottling, roughness breakup or per-copy tint) as lookdev-*-clean.png, for an A/B comparison.
Light: sun 9 degrees up toward +x (downstream), #ffa65c; sky gradient from zenith #56618a to
the sun-side horizon #ffbd70; AgX. Nothing here is shipped.
"""

import math
import os
import sys

sys.dont_write_bytecode = True  # importing build_compound must not leave __pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import build_compound as bc  # noqa: E402

CLEAN = "--clean" in bc.ARGS
OUT = os.path.join(bc.OUT, "lookdev")
SUFFIX = "-clean" if CLEAN else ""

WALLS_A = ["plaster_cream", "plaster_shade", "wall", "limestone", "stone", "slab", "timber"]
WALLS_B = ["zellige", "jali", "lattice", "fence", "net", "hedge", "mosaic"]
FLOORS = ["paving", "courtyard", "mosque_floor", "court", "court_line", "rubber", "mosaic"]
SUN_ELEVATION = 9.0
SUN_AZIMUTH = (0.97, 0.16)  # three.js x, z: world.ts SUN.zaitun


def strip_imperfection():
    for r in bc.REGIONS.values():
        r["mottle"], r["dust"], r["breakup"], r["streaks"], r["stains"] = 0.0, 0.0, 0.0, 0.0, 0.0
    for s in bc.SURFACES.values():
        s["grime"] = 0.0
    bc.DUST_FILM = 0.0
    bc.AO_DIRT = 0.0


def surface_mesh(name, boxes, atlas, shared):
    """A mesh of plain boxes (w, h, d, x, y, z, surface) through the real finishing pipeline."""
    a = bc.Asset(name)
    for b in boxes:
        a.box(*b)
    me = bc.finish_mesh(name, a.build(), 0.0)
    bc.assign_final_materials(me, [bc.atlas_material(f"{name}-atlas", atlas, None), bc.atlas_material(f"{name}-mask", atlas, None, mask=True), *shared])
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def label(text, x, z, size=0.22):
    curve = bpy.data.curves.new(f"label-{text}", "FONT")
    curve.body = text.replace("_", " ")
    curve.size = size
    obj = bpy.data.objects.new(f"label-{text}", curve)
    obj.location = bc.to_blender_co(x, 0.02, z)
    obj.data.materials.append(LABEL_MAT)
    obj.visible_shadow = False
    bpy.context.scene.collection.objects.link(obj)


def world_and_sun():
    scene = bpy.context.scene
    world = scene.world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    lin = lambda h: (*bc.to_linear(bc.srgb(h)), 1.0)  # noqa: E731
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = lin("#e6ae86")  # haze at the horizon
    ramp.color_ramp.elements[1].position = 0.55
    ramp.color_ramp.elements[1].color = lin("#56618a")  # zenith
    mid = ramp.color_ramp.elements.new(0.08)
    mid.color = lin("#ffbd70")
    bg.inputs["Strength"].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.color = bc.to_linear(bc.srgb("#ffa65c"))
    sun.data.angle = math.radians(1.0)
    el = math.radians(SUN_ELEVATION)
    ax, az = SUN_AZIMUTH
    h = math.hypot(ax, az)
    to_sun = bc.to_blender_co(ax / h * math.cos(el), math.sin(el), az / h * math.cos(el))
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)


def camera(name, pos, target, lens):
    scene = bpy.context.scene
    cam = scene.camera
    cam.data.lens = lens
    cam.location = bc.to_blender_co(*pos)
    cam.rotation_euler = (bc.to_blender_co(*target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(OUT, f"lookdev-{name}{SUFFIX}.png")
    bpy.ops.render.render(write_still=True)
    bc.log("rendered", scene.render.filepath)


def main():
    global LABEL_MAT
    os.makedirs(OUT, exist_ok=True)
    if CLEAN:
        strip_imperfection()
    bc.reset_scene()
    bc.setup_cycles()
    scene = bpy.context.scene
    atlas, _ = bc.build_atlas()
    shared = bc.shared_materials()
    LABEL_MAT = bc.plain_material("label", "#2b2520", 0.8, 0.0)

    # Villas: three copies of the 4-bed garden villa and one courtyard villa, AO baked.
    sizes = {p["type"]: p for p in bc.LAYOUT["villas"]}
    templates = {}
    for kind in ("garden-4", "courtyard"):
        p = sizes[kind]
        screens = bc.bmesh.new()
        if kind == "courtyard":
            build = lambda p=p, s=screens: bc.villa_courtyard(p["width"], p["depth"], p["height"], s)  # noqa: E731
        else:
            build = lambda p=p, s=screens, k=kind: bc.villa_garden(p["width"], p["depth"], p["height"], s, k)  # noqa: E731
        obj, scr, _ = bc.make_asset(f"villa-{kind}", build, shared, atlas, screens)
        templates[kind] = (obj, scr)
    for obj, scr in templates.values():
        scene.collection.objects.unlink(obj)
        if scr:
            scene.collection.objects.unlink(scr)
    row = [("garden-4", -50.0), ("garden-4", -22.0), ("garden-4", 6.0), ("courtyard", 40.0)]
    for i, (kind, x) in enumerate(row):
        obj, scr = templates[kind]
        placed = [bc.place(obj, f"villa-{i:02d}-{kind}", x, 0.0, 0.0)]
        if scr:
            placed.append(bc.place(scr, f"villa-{i:02d}-screens", x, 0.0, 0.0))
        for o in placed:
            if not CLEAN:
                bc.apply_instance_tint(o, f"villa-{i:02d}")

    # Ground (paving), wall panels and floor tiles, through the same surface pipeline.
    surface_mesh("ground", [(420, 0.1, 140, 90, -0.1, 0, "paving")], atlas, shared)
    boxes = []
    for j, names in enumerate((WALLS_A, WALLS_B)):
        x0 = 200 + j * 40
        for i, name in enumerate(names):
            x = x0 + i * 2.2
            thin = name in bc.MASKED
            boxes.append((1.8, 2.6, 0.04 if thin else 0.3, x, 0.0, 0.0, name))
            label(name, x - 0.85, 0.75)
    for i, name in enumerate(FLOORS):
        x = 200 + i * 3.4
        boxes.append((3.0, 0.03, 3.0, x, 0.0, 12.0, name))
        label(name, x - 1.4, 14.0)
    surface_mesh("board", boxes, atlas, shared)

    if not CLEAN:
        bc.use_instance_tint([m for m in bpy.data.materials if m.node_tree and m.node_tree.nodes.get("instance-tint")])
    world_and_sun()
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"

    camera("walls-a", (206.6, 1.6, 16.5), (206.6, 1.2, 0.0), 35)
    camera("walls-b", (246.6, 1.6, 16.5), (246.6, 1.2, 0.0), 35)
    camera("floors", (210.2, 12.0, 30.0), (210.2, 0.0, 12.5), 35)
    camera("villas", (-74.0, 1.7, 22.0), (0.0, 3.5, 2.0), 35)
    camera("base", (-18.0, 1.1, 15.5), (-26.2, 0.9, 8.0), 85)


if __name__ == "__main__":
    main()
