"""
Zaitun Hills film storyboard: a greybox of the 28 ha masterplan with the film's cameras,
rendered as storyboard frames (and optionally a low-res animatic).

The greybox is built from scripts/blender/layout.json (the masterplan section, exported from
components/sawad/scene/layout.ts) and scripts/blender/out/film/greybox.json (ground and
indicative trees). The cameras come from scripts/blender/film/shots.json. All three are written
by scripts, so nothing here is placed by hand:

    node scripts/export-scene-layout.mjs
    node scripts/blender/film/shots.mjs
    blender -b --factory-startup -P scripts/blender/film/storyboard.py -- --boards

Options (after --):
    --boards            render the storyboard frames into scripts/blender/film/storyboard/
    --animatic          render the whole film as a greybox animatic (PNG frames, see --out)
    --only 01,05a       limit to these shots
    --width 1600        frame width (height follows 16:9)
    --samples 32        EEVEE samples
    --save              save the scene to scripts/blender/out/film/storyboard.blend
    --out DIR           where the animatic frames go (default scripts/blender/out/film/animatic)

Axes: the layout's (x, y, z) with y up maps to Blender (x, -z, y), as in build_compound.py.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
LAYOUT = os.path.join(BLENDER_DIR, "layout.json")
GREYBOX = os.path.join(BLENDER_DIR, "out", "film", "greybox.json")
SHOTS = os.path.join(HERE, "shots.json")
BOARDS = os.path.join(HERE, "storyboard")

# Palette (components/sawad/scene/world.ts and the brief), linearised by Blender on input.
PALETTE = {
    "render": "#ecdfc7",
    "render_shade": "#dccaa8",
    "limestone": "#f3e9d6",
    "plinth": "#d2c3a2",
    "timber": "#6b5038",
    "brass": "#c9a24a",
    "glass": "#6d5d4e",
    "paving": "#9b8466",
    "asphalt": "#7d7466",
    "path": "#c8b89a",
    "lawn": "#7f8f52",
    "court_padel": "#4f7a78",
    "court_tennis": "#b0654a",
    "soft": "#c08a5c",
    "sail": "#efe6d6",
    "water": "#3c5a66",
    "palm_crown": "#5f6b3c",
    "olive_crown": "#7c8460",
    "citrus_crown": "#556b34",
    "trunk": "#7a6650",
    "bronze": "#5a4632",
}
SKY_DAY = {"zenith": "#56618a", "horizon": "#e6ae86", "sun_side": "#ffbd70", "strength": 0.55}
SKY_DUSK = {"zenith": "#2b3a6e", "horizon": "#8a7390", "sun_side": "#d08a62", "strength": 0.4}
SUN_COLOUR = "#ffa65c"


def to_b(x, y, z):
    return Vector((x, -z, y))


def srgb(hex_colour):
    h = hex_colour.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return (*lin, 1.0)


# ---------------------------------------------------------------- materials


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def material(name, colour, roughness=0.85, metallic=0.0, emission=None, alpha=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = principled(mat)
    bsdf.inputs["Base Color"].default_value = srgb(colour)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = srgb(emission)
        bsdf.inputs["Emission Strength"].default_value = 0.0
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
    mat.diffuse_color = srgb(colour)
    return mat


def terrain_material():
    """Irrigated green on the valley floor, dry ochre on the slopes, read from the height."""
    mat = bpy.data.materials.get("MAT_Ground") or bpy.data.materials.new("MAT_Ground")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = principled(mat)
    bsdf.inputs["Roughness"].default_value = 0.95
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "ground"
    attr.attribute_type = "GEOMETRY"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


# ---------------------------------------------------------------- mesh building


class Builder:
    """Collects geometry per material and makes one object per material at the end."""

    def __init__(self):
        self.meshes = {}

    def bm(self, mat):
        if mat not in self.meshes:
            self.meshes[mat] = bmesh.new()
        return self.meshes[mat]

    def box(self, mat, x, y0, z, w, h, d, rot=0.0):
        """Box of width w (x), height h (y) and depth d (z), standing on y0, centred on x, z."""
        m = Matrix.Translation(to_b(x, y0 + h / 2, z)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Diagonal((w, d, h, 1))
        bmesh.ops.create_cube(self.bm(mat), size=1.0, matrix=m)

    def frond(self, mat, x, y, z, length, heading, droop):
        """A palm frond: a long flat blade leaving the crown at a heading, drooping by droop radians."""
        m = (
            Matrix.Translation(to_b(x, y, z))
            @ Matrix.Rotation(heading, 4, "Z")
            @ Matrix.Rotation(-droop, 4, "X")
            @ Matrix.Translation((0, length / 2, 0))
            @ Matrix.Diagonal((0.9, length, 0.08, 1))
        )
        bmesh.ops.create_cube(self.bm(mat), size=1.0, matrix=m)

    def rect_box(self, mat, r, y0, h, inset=0.0):
        self.box(mat, (r["minX"] + r["maxX"]) / 2, y0, (r["minZ"] + r["maxZ"]) / 2, r["maxX"] - r["minX"] - 2 * inset, h, r["maxZ"] - r["minZ"] - 2 * inset)

    def cylinder(self, mat, x, y0, z, radius, h, segments=12, radius_top=None):
        m = Matrix.Translation(to_b(x, y0 + h / 2, z))
        bmesh.ops.create_cone(self.bm(mat), cap_ends=True, segments=segments, radius1=radius, radius2=radius if radius_top is None else radius_top, depth=h, matrix=m)

    def sphere(self, mat, x, y, z, radius, squash=1.0, segments=16):
        m = Matrix.Translation(to_b(x, y, z)) @ Matrix.Diagonal((1, 1, squash, 1))
        bmesh.ops.create_uvsphere(self.bm(mat), u_segments=segments, v_segments=segments // 2, radius=radius, matrix=m)

    def ribbon(self, mat, path, width, lift=0.06):
        """A strip of the given width along a path of [x, y, z] points."""
        bm = self.bm(mat)
        left, right = [], []
        for i, (x, y, z) in enumerate(path):
            a = path[max(i - 1, 0)]
            b = path[min(i + 1, len(path) - 1)]
            dx, dz = b[0] - a[0], b[2] - a[2]
            n = math.hypot(dx, dz) or 1.0
            ox, oz = -dz / n * width / 2, dx / n * width / 2
            left.append(bm.verts.new(to_b(x + ox, y + lift, z + oz)))
            right.append(bm.verts.new(to_b(x - ox, y + lift, z - oz)))
        for i in range(len(path) - 1):
            bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))

    def tri(self, mat, a, b, c):
        bm = self.bm(mat)
        bm.faces.new([bm.verts.new(to_b(*v)) for v in (a, b, c)])

    def finish(self, collection):
        for mat, bm in self.meshes.items():
            mesh = bpy.data.meshes.new(mat.name.replace("MAT_", "GB_"))
            bm.normal_update()
            bm.to_mesh(mesh)
            bm.free()
            mesh.materials.append(mat)
            obj = bpy.data.objects.new(mesh.name, mesh)
            collection.objects.link(obj)
        self.meshes = {}


def collection(name):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


# ---------------------------------------------------------------- ground and water


class Ground:
    def __init__(self, t):
        self.t = t

    def height(self, x, z):
        t = self.t
        fx = min(max((x - t["minX"]) / t["step"], 0), t["columns"] - 1.001)
        fz = min(max((z - t["minZ"]) / t["step"], 0), t["rows"] - 1.001)
        c, r = int(fx), int(fz)
        u, v = fx - c, fz - r
        h = t["heightsCm"]
        top = h[r][c] * (1 - u) + h[r][c + 1] * u
        bot = h[r + 1][c] * (1 - u) + h[r + 1][c + 1] * u
        return max(0.0, (top * (1 - v) + bot * v) / 100)


def build_ground(t, site, col):
    mesh = bpy.data.meshes.new("GB_Ground")
    cols, rows, step = t["columns"], t["rows"], t["step"]
    verts = []
    for r in range(rows):
        z = t["minZ"] + r * step
        for c in range(cols):
            x = t["minX"] + c * step
            verts.append(tuple(to_b(x, t["heightsCm"][r][c] / 100, z)))
    faces = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            i = r * cols + c
            faces.append((i, i + 1, i + 1 + cols, i + cols))
    mesh.from_pydata(verts, [], faces)
    # Ground colour: irrigated green low down and inside the walls, dry grass up the slopes.
    attr = mesh.color_attributes.new("ground", "FLOAT_COLOR", "POINT")
    green, dry, bank = srgb("#7d8a4e"), srgb("#c2a46e"), srgb("#a39a72")
    for i, (bx, by, h) in enumerate(verts):
        x, z = bx, -by
        inside = site["minX"] <= x <= site["maxX"] and site["minZ"] <= z <= site["maxZ"]
        k = min(max((h - 2.0) / 14.0, 0.0), 1.0) * (0.45 if inside else 1.0)
        base = bank if h < 0.4 else green
        attr.data[i].color = tuple(base[j] * (1 - k) + dry[j] * k for j in range(3)) + (1.0,)
    mesh.materials.append(terrain_material())
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new("GB_Ground", mesh)
    col.objects.link(obj)

    water = bpy.data.meshes.new("GB_Stream")
    w = 1600
    water.from_pydata([(-w, -w, 0), (w, -w, 0), (w, w, 0), (-w, w, 0)], [], [(0, 1, 2, 3)])
    water.materials.append(material("MAT_Water", PALETTE["water"], roughness=0.04))
    col.objects.link(bpy.data.objects.new("GB_Stream", water))


# ---------------------------------------------------------------- buildings


def windows_on_face(b, mats, x0, x1, z, y0, floors, floor_h, normal_z, step=4.2, w=1.6, h=1.9):
    """Window panes along a facade that runs in x at depth z, facing +z (normal_z=1) or -z."""
    n = max(1, int((x1 - x0 - 2) // step))
    span = (n - 1) * step
    for f in range(floors):
        for i in range(n):
            x = (x0 + x1) / 2 - span / 2 + i * step
            b.box(mats["window"], x, y0 + f * floor_h + 0.9, z + normal_z * 0.06, w, h, 0.14)
            if f > 0:
                b.box(mats["timber"], x, y0 + f * floor_h + 0.9, z + normal_z * 0.16, w + 0.2, h + 0.2, 0.06)


def windows_on_side(b, mats, z0, z1, x, y0, floors, floor_h, normal_x, step=4.2, w=1.6, h=1.9):
    n = max(1, int((z1 - z0 - 2) // step))
    span = (n - 1) * step
    for f in range(floors):
        for i in range(n):
            z = (z0 + z1) / 2 - span / 2 + i * step
            b.box(mats["window"], x + normal_x * 0.06, y0 + f * floor_h + 0.9, z, 0.14, h, w)


def courtyard_villa(b, mats, x, y, z, w, d, h, facing):
    """Two floors around an inner court, a roof tower, a brass canopy over the front door."""
    wing = 6.0
    floor_h = h / 2
    b.box(mats["render"], x, y, z - d / 2 + wing / 2, w, h, wing)
    b.box(mats["render"], x, y, z + d / 2 - wing / 2, w, h, wing)
    b.box(mats["render"], x - w / 2 + wing / 2, y, z, wing, h, d - 2 * wing)
    b.box(mats["render"], x + w / 2 - wing / 2, y, z, wing, h, d - 2 * wing)
    b.box(mats["paving"], x, y, z, w - 2 * wing, 0.1, d - 2 * wing)
    # Parapet coping and plinth.
    b.box(mats["limestone"], x, y + h, z, w + 0.3, 0.25, d + 0.3)
    b.box(mats["plinth"], x, y, z, w + 0.2, 0.5, d + 0.2)
    tx, tz = x + w / 2 - wing / 2, z - facing * (d / 2 - wing / 2)
    b.box(mats["render_shade"], tx, y + h, tz, 5, 3.0, 5)
    b.box(mats["limestone"], tx, y + h + 3.0, tz, 5.3, 0.25, 5.3)
    front = z + facing * d / 2
    back = z - facing * d / 2
    windows_on_face(b, mats, x - w / 2, x + w / 2, front, y, 2, floor_h, facing)
    windows_on_face(b, mats, x - w / 2, x + w / 2, back, y, 2, floor_h, -facing)
    windows_on_side(b, mats, z - d / 2, z + d / 2, x + w / 2, y, 2, floor_h, 1)
    windows_on_side(b, mats, z - d / 2, z + d / 2, x - w / 2, y, 2, floor_h, -1)
    # Front door and its brass canopy.
    b.box(mats["timber"], x, y, front + facing * 0.08, 2.2, 2.8, 0.16)
    b.box(mats["brass"], x, y + 3.0, front + facing * 1.1, 4.2, 0.18, 2.2)


def garden_villa(b, mats, x, y, z, w, d, h, facing):
    """Two-floor main block and a single-floor lower wing."""
    main_w = w * 0.62
    floor_h = h / 2
    mx = x - w / 2 + main_w / 2
    b.box(mats["render"], mx, y, z, main_w, h, d)
    b.box(mats["limestone"], mx, y + h, z, main_w + 0.3, 0.25, d + 0.3)
    wx = x + w / 2 - (w - main_w) / 2
    b.box(mats["render_shade"], wx, y, z + facing * d * 0.1, w - main_w, floor_h + 0.4, d * 0.8)
    b.box(mats["limestone"], wx, y + floor_h + 0.4, z + facing * d * 0.1, w - main_w + 0.3, 0.2, d * 0.8 + 0.3)
    b.box(mats["plinth"], x, y, z, w + 0.2, 0.45, d + 0.2)
    front = z + facing * d / 2
    windows_on_face(b, mats, mx - main_w / 2, mx + main_w / 2, front, y, 2, floor_h, facing)
    windows_on_face(b, mats, mx - main_w / 2, mx + main_w / 2, z - facing * d / 2, y, 2, floor_h, -facing)
    windows_on_side(b, mats, z - d / 2, z + d / 2, mx - main_w / 2, y, 2, floor_h, -1)
    b.box(mats["timber"], mx, y, front + facing * 0.08, 1.8, 2.6, 0.16)
    b.box(mats["brass"], mx, y + 2.8, front + facing * 0.9, 3.4, 0.16, 1.8)


def villa_extras(b, mats, v):
    """Carport, driveway and the garden lawn on the villa's plot."""
    if v.get("garden"):
        b.rect_box(mats["lawn"], v["garden"], v["y"], 0.08)
    if v.get("driveway"):
        b.rect_box(mats["path"], v["driveway"], v["y"] - 0.02, 0.1)
    cp = v.get("carport")
    if cp:
        rot = cp.get("rotation", 0)
        for dx in (-2.8, 2.8):
            for dz in (-2.8, 2.8):
                b.box(mats["bronze"], cp["x"] + dx, v["y"], cp["z"] + dz, 0.15, 2.8, 0.15)
        b.box(mats["timber"], cp["x"], v["y"] + 2.8, cp["z"], 6.2, 0.18, 6.2, rot)


def apartment(b, mats, a):
    """Four floors stepping back 2.6 m a floor, terraces toward the water."""
    for f, depth in enumerate(a["floorDepths"]):
        y = a["y"] + f * a["floorHeight"]
        zc = a["backZ"] + depth / 2
        b.box(mats["render"], a["x"], y, zc, a["width"], a["floorHeight"], depth)
        b.box(mats["limestone"], a["x"], y + a["floorHeight"], zc, a["width"] + 0.3, 0.22, depth + 0.3)
        # Glass wall onto the terrace and a parapet along its edge.
        front = a["backZ"] + depth
        b.box(mats["window"], a["x"], y + 0.4, front + 0.06, a["width"] - 3, 2.6, 0.12)
        b.box(mats["limestone"], a["x"], y + a["floorHeight"], front + 1.2, a["width"], 1.0, 0.2)
        windows_on_face(b, mats, a["x"] - a["width"] / 2, a["x"] + a["width"] / 2, a["backZ"], y, 1, 3.6, -1)
    b.box(mats["plinth"], a["x"], a["y"], a["backZ"] + a["floorDepths"][0] / 2, a["width"] + 0.2, 0.5, a["floorDepths"][0] + 0.2)


# ---------------------------------------------------------------- amenities


def court(b, mats, a, surface, fence_h):
    r = a["footprint"]
    b.rect_box(mats[surface], r, a["y"], 0.08, inset=1.0)
    x0, x1, z0, z1 = r["minX"] + 1, r["maxX"] - 1, r["minZ"] + 1, r["maxZ"] - 1
    for (ax, az, bx, bz) in ((x0, z0, x1, z0), (x1, z0, x1, z1), (x1, z1, x0, z1), (x0, z1, x0, z0)):
        length = math.hypot(bx - ax, bz - az)
        n = max(2, int(length // 3))
        for i in range(n + 1):
            k = i / n
            b.box(mats["bronze"], ax + (bx - ax) * k, a["y"], az + (bz - az) * k, 0.1, fence_h, 0.1)
        horizontal = abs(bz - az) < 0.01
        cx, cz = (ax + bx) / 2, (az + bz) / 2
        b.box(mats["fence"], cx, a["y"], cz, length if horizontal else 0.04, fence_h, 0.04 if horizontal else length)
    # The net across the middle.
    long_x = (x1 - x0) > (z1 - z0)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    b.box(mats["sail"], cx, a["y"], cz, 0.05 if long_x else (x1 - x0), 1.0, (z1 - z0) if long_x else 0.05)


def amenity(b, mats, a, villa_builder):
    kind, r, y = a["kind"], a["footprint"], a["y"]
    cx, cz = (r["minX"] + r["maxX"]) / 2, (r["minZ"] + r["maxZ"]) / 2
    w, d = r["maxX"] - r["minX"], r["maxZ"] - r["minZ"]
    if kind == "terrace":
        b.rect_box(mats["limestone"], r, y, 0.06)
    elif kind == "pool":
        b.rect_box(mats["limestone"], r, y, 0.35)
        b.rect_box(mats["pool"], r, y + 0.02, 0.3, inset=0.6)
    elif kind == "steps":
        rise = a.get("size", {}).get("rise", 6)
        n = 24
        for i in range(n):
            z = r["maxZ"] - (i + 0.5) * d / n
            b.box(mats["limestone"], cx, y, z, w, (i + 1) * rise / n, d / n)
    elif kind == "belvedere":
        b.rect_box(mats["limestone"], r, y - 0.3, 0.3)
        for px in (r["minX"] + 0.5, r["maxX"] - 0.5):
            for pz in (r["minZ"] + 0.5, r["maxZ"] - 0.5):
                b.box(mats["limestone"], px, y, pz, 0.5, 3.2, 0.5)
        b.box(mats["timber"], cx, y + 3.2, cz, w, 0.3, d)
    elif kind == "plaza":
        b.rect_box(mats["paving"], r, y, 0.08)
    elif kind == "lawn":
        b.rect_box(mats["lawn"], r, y, 0.08)
    elif kind == "gym":
        size = a["size"]
        long_z = d > w
        bw, bd = (size["depth"], size["width"]) if long_z else (size["width"], size["depth"])
        b.box(mats["render"], cx - (w - bw) / 2, y, cz, bw, size["height"], bd)
        b.box(mats["limestone"], cx - (w - bw) / 2, y + size["height"], cz, bw + 0.3, 0.3, bd + 0.3)
        windows_on_side(b, mats, cz - bd / 2, cz + bd / 2, cx - (w - bw) / 2 + bw / 2, y, 2, 3.6, 1, step=3.2, w=2.4, h=2.6)
        b.box(mats["paving"], r["maxX"] - (w - bw) / 2, y, cz, w - bw, 0.12, bd)
    elif kind == "padel":
        court(b, mats, a, "court_padel", 3.0)
    elif kind == "tennis":
        court(b, mats, a, "court_tennis", 3.5)
    elif kind == "playground":
        b.rect_box(mats["soft"], r, y, 0.1, inset=1.0)
        posts = [(r["minX"] + 2, r["minZ"] + 2), (r["maxX"] - 2, r["minZ"] + 2), (r["maxX"] - 2, r["maxZ"] - 2), (r["minX"] + 2, r["maxZ"] - 2), (cx, cz)]
        for px, pz in posts:
            b.cylinder(mats["timber"], px, y, pz, 0.12, 4.2, 8)
        hy = y + 4.2
        b.tri(mats["sail"], (posts[0][0], hy, posts[0][1]), (posts[1][0], hy - 1.2, posts[1][1]), (cx, hy - 0.6, cz))
        b.tri(mats["sail"], (posts[2][0], hy, posts[2][1]), (posts[3][0], hy - 1.2, posts[3][1]), (cx, hy - 0.6, cz))
        b.tri(mats["sail"], (posts[1][0], hy - 0.4, posts[1][1]), (posts[2][0], hy - 1.0, posts[2][1]), (cx, hy - 1.4, cz))
        for i in range(3):
            b.box(mats["timber"], cx - 6 + i * 6, y, cz + 2, 2.4, 2.0 + i * 0.4, 2.4)
    elif kind == "mosque":
        s = a["size"]
        mx, mz = a["x"], a["z"]
        b.rect_box(mats["paving"], r, y, 0.1)
        b.box(mats["render"], mx, y, mz, s["width"], s["height"], s["depth"])
        b.box(mats["limestone"], mx, y + s["height"], mz, s["width"] + 0.3, 0.3, s["depth"] + 0.3)
        b.cylinder(mats["render_shade"], mx, y + s["height"], mz, s["dome_radius"] + 0.3, 1.0, 24)
        b.sphere(mats["limestone"], mx, y + s["height"] + 1.0, mz, s["dome_radius"], squash=0.95, segments=24)
        px, pz = mx + s["width"] / 2 + 2, mz + s["depth"] / 2 - 2
        b.cylinder(mats["render"], px, y, pz, 1.3, s["minaret_height"] - 2.5, 16)
        b.box(mats["limestone"], px, y + s["minaret_height"] - 2.5, pz, 3.0, 0.4, 3.0)
        b.cylinder(mats["brass"], px, y + s["minaret_height"] - 2.1, pz, 1.0, 2.1, 16, radius_top=0.05)
        windows_on_face(b, mats, mx - s["width"] / 2, mx + s["width"] / 2, mz + s["depth"] / 2, y, 1, 3.6, 1, step=3.4, w=1.4, h=3.0)
    elif kind == "gallery":
        size = a.get("size") or {"width": 24, "depth": 22, "height": 7.6}
        villa_builder(b, mats, a["x"], y, a["z"], size["width"], size["depth"], size["height"], -1 if abs(a.get("rotation", 0)) > 1 else 1)


def gate(b, mats, g, plan):
    gt = plan["gate"]
    for pv in g["pavilions"]:
        b.box(mats["render"], pv["x"], g["y"], pv["z"], gt["pavilion"], gt["pavilionHeight"], gt["pavilion"])
        b.box(mats["limestone"], pv["x"], g["y"] + gt["pavilionHeight"], pv["z"], gt["pavilion"] + 0.4, 0.3, gt["pavilion"] + 0.4)
    b.box(mats["brass"], g["x"], g["y"] + gt["pavilionHeight"] - 0.9, g["z"], 1.2, 0.9, gt["lintelLength"])


def walls(b, mats, plan, ground):
    wall = plan["wall"]
    for w in plan["walls"]:
        (ax, az), (bx, bz) = w["from"], w["to"]
        length = math.hypot(bx - ax, bz - az)
        n = max(1, int(length // 6))
        for i in range(n):
            k0, k1 = i / n, (i + 1) / n
            x = ax + (bx - ax) * (k0 + k1) / 2
            z = az + (bz - az) * (k0 + k1) / 2
            seg = length / n
            y = min(ground.height(ax + (bx - ax) * k0, az + (bz - az) * k0), ground.height(ax + (bx - ax) * k1, az + (bz - az) * k1))
            along_x = abs(bx - ax) > abs(bz - az)
            sw, sd = (seg + 0.02, wall["thickness"]) if along_x else (wall["thickness"], seg + 0.02)
            b.box(mats["render_shade"], x, y - 0.6, z, sw, wall["height"] + 0.6, sd)
            b.box(mats["limestone"], x, y + wall["height"], z, sw + 0.1, 0.15, sd + 0.2)


# ---------------------------------------------------------------- trees and lamps (instanced)


def instance_set(name, points, proto, col):
    """Vertex-instanced copies of proto at each [x, y, z] point."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(to_b(x, y, z)) for x, y, z in points], [], [])
    holder = bpy.data.objects.new(name, mesh)
    col.objects.link(holder)
    holder.instance_type = "VERTS"
    proto.parent = holder
    return holder


def prototype(name, build, col):
    b = Builder()
    build(b)
    sub = bpy.data.collections.new(name + "_proto")
    b.finish(sub)
    objs = list(sub.objects)
    # Join into one object so one parent instances everything.
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    mats = []
    for o in objs:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        mi = len(mats)
        mats.append(o.data.materials[0])
        for f in tmp.faces:
            f.material_index = mi
        tmp.to_mesh(o.data)
        tmp.free()
        bm.from_mesh(o.data)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    for o in objs:
        bpy.data.objects.remove(o)
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    return obj


def build_trees(trees, mats, col):
    def palm(b):
        b.cylinder(mats["trunk"], 0, 0, 0, 0.28, 10.5, 8, radius_top=0.22)
        for i in range(14):
            b.frond(mats["palm"], 0, 10.5, 0, 4.2 if i % 2 else 3.6, i * 2 * math.pi / 14 + (0.2 if i % 2 else 0), 0.25 + 0.45 * (i % 3) / 2)
        b.sphere(mats["palm"], 0, 10.5, 0, 0.8, segments=8)

    def olive(b):
        b.cylinder(mats["trunk"], 0, 0, 0, 0.3, 1.8, 6)
        b.sphere(mats["olive"], 0, 3.2, 0, 2.5, squash=0.75, segments=8)

    def citrus(b):
        b.cylinder(mats["trunk"], 0, 0, 0, 0.12, 1.0, 6)
        b.sphere(mats["citrus"], 0, 1.9, 0, 1.3, squash=0.95, segments=8)

    for key, fn in (("palm", palm), ("olive", olive), ("citrus", citrus)):
        proto = prototype("TREE_" + key, fn, col)
        instance_set("TREES_" + key, trees[key], proto, col)


def build_lamps(plan, mats, col):
    def lamp(b):
        b.cylinder(mats["bronze"], 0, 0, 0, 0.08, 5.4, 8)
        b.sphere(mats["lamp"], 0, 5.4, 0, 0.28, segments=8)

    proto = prototype("LAMP", lamp, col)
    instance_set("LAMPS", [(l["x"], l["y"], l["z"]) for l in plan["lamps"]], proto, col)


# ---------------------------------------------------------------- the whole greybox


def build_greybox(layout, grey):
    plan = layout["masterplan"]
    ground = Ground(grey["terrain"])
    col_ground = collection("COL_Ground")
    col_build = collection("COL_Buildings")
    col_land = collection("COL_Landscape")

    build_ground(grey["terrain"], plan["site"], col_ground)

    mats = {k: material("MAT_" + k, PALETTE[k]) for k in ("render", "render_shade", "limestone", "plinth", "timber", "paving", "asphalt", "path", "lawn", "court_padel", "court_tennis", "soft", "sail", "trunk", "bronze")}
    mats["brass"] = material("MAT_brass", PALETTE["brass"], roughness=0.3, metallic=1.0)
    mats["window"] = material("MAT_window", PALETTE["glass"], roughness=0.08, emission="#ffb867")
    mats["pool"] = material("MAT_pool", "#3f7f86", roughness=0.03)
    mats["fence"] = material("MAT_fence", "#2f2a24", roughness=0.6, alpha=0.35)
    mats["lamp"] = material("MAT_lamp", "#f5e3c0", roughness=0.4, emission="#ffc27a")
    mats["palm"] = material("MAT_palm", PALETTE["palm_crown"], roughness=0.8)
    mats["olive"] = material("MAT_olive", PALETTE["olive_crown"], roughness=0.8)
    mats["citrus"] = material("MAT_citrus", PALETTE["citrus_crown"], roughness=0.8)

    b = Builder()
    surface = {"boulevard": "asphalt", "street": "asphalt", "promenade": "path", "walk": "path"}
    for road in plan["roads"]:
        b.ribbon(mats[surface.get(road["kind"], "path")], road["path"], road["width"])
        if road["kind"] in ("boulevard", "street"):
            # Sidewalks either side, on the far edge of the verge.
            st = plan["street"] if road["kind"] == "boulevard" else plan["link"]
            off = road["width"] / 2 + (st.get("verge", 1.0)) + st["sidewalk"] / 2
            for side in (-1, 1):
                b.ribbon(mats["paving"], offset_path(road["path"], side * off), st["sidewalk"], lift=0.12)
    for pk in plan["parking"]:
        b.rect_box(mats["asphalt"], pk["footprint"], pk["y"] - 0.02, 0.1)
        if pk.get("driveway"):
            b.rect_box(mats["asphalt"], pk["driveway"], pk["y"] - 0.02, 0.1)
    b.finish(col_land)

    for v in plan["villas"]:
        fn = courtyard_villa if v["type"] == "courtyard" else garden_villa
        fn(b, mats, v["x"], v["y"], v["z"], v["width"], v["depth"], v["height"], v["facing"])
        villa_extras(b, mats, v)
    for a in plan["apartments"]:
        apartment(b, mats, a)
    for a in plan["amenities"]:
        amenity(b, mats, a, courtyard_villa)
    for g in plan["gates"]:
        gate(b, mats, g, plan)
    walls(b, mats, plan, ground)
    b.finish(col_build)

    build_trees(grey["trees"], mats, col_land)
    build_lamps(plan, mats, col_land)
    return mats


def offset_path(path, off):
    out = []
    for i, (x, y, z) in enumerate(path):
        a = path[max(i - 1, 0)]
        c = path[min(i + 1, len(path) - 1)]
        dx, dz = c[0] - a[0], c[2] - a[2]
        n = math.hypot(dx, dz) or 1.0
        out.append([x - dz / n * off, y, z + dx / n * off])
    return out


# ---------------------------------------------------------------- light


def sun_vector(sun, elevation_deg):
    e = math.radians(elevation_deg)
    h = math.hypot(sun["azimuthX"], sun["azimuthZ"])
    return to_b(sun["azimuthX"] / h * math.cos(e), math.sin(e), sun["azimuthZ"] / h * math.cos(e)).normalized()


def build_light(sun):
    scene = bpy.context.scene
    data = bpy.data.lights.new("SUN_Golden", "SUN")
    data.color = srgb(SUN_COLOUR)[:3]
    data.angle = math.radians(0.8)
    obj = bpy.data.objects.new("SUN_Golden", data)
    scene.collection.objects.link(obj)

    world = bpy.data.worlds.new("WORLD_Zaitun")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    up = nt.nodes.new("ShaderNodeMapRange")
    up.inputs["From Min"].default_value = -0.02
    up.inputs["From Max"].default_value = 0.55
    nt.links.new(sep.outputs["Z"], up.inputs["Value"])
    sky = nt.nodes.new("ShaderNodeMix")
    sky.data_type = "RGBA"
    sky.name = "SKY_Gradient"
    nt.links.new(up.outputs["Result"], sky.inputs["Factor"])
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.name = "SKY_SunDot"
    nt.links.new(coord.outputs["Generated"], dot.inputs[0])
    side = nt.nodes.new("ShaderNodeMapRange")
    side.inputs["From Min"].default_value = 0.2
    side.inputs["From Max"].default_value = 1.0
    nt.links.new(dot.outputs["Value"], side.inputs["Value"])
    low = nt.nodes.new("ShaderNodeMapRange")  # sun-side warmth only near the horizon
    low.inputs["From Min"].default_value = 0.35
    low.inputs["From Max"].default_value = 0.0
    nt.links.new(sep.outputs["Z"], low.inputs["Value"])
    warmth = nt.nodes.new("ShaderNodeMath")
    warmth.operation = "MULTIPLY"
    nt.links.new(side.outputs["Result"], warmth.inputs[0])
    nt.links.new(low.outputs["Result"], warmth.inputs[1])
    warm = nt.nodes.new("ShaderNodeMix")
    warm.data_type = "RGBA"
    warm.name = "SKY_Warm"
    nt.links.new(warmth.outputs["Value"], warm.inputs["Factor"])
    nt.links.new(sky.outputs["Result"], warm.inputs["A"])
    nt.links.new(warm.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    bg.name = "SKY_Background"
    return obj, world


def haze_group(density):
    """Aerial haze: every surface fades toward the haze colour with distance from the camera.
    (A world volume would be the physical way, but EEVEE's volumes go black with this sun.)"""
    ng = bpy.data.node_groups.new("NG_Haze", "ShaderNodeTree")
    ng.interface.new_socket("Shader", in_out="INPUT", socket_type="NodeSocketShader")
    ng.interface.new_socket("Shader", in_out="OUTPUT", socket_type="NodeSocketShader")
    n = ng.nodes
    gin, gout = n.new("NodeGroupInput"), n.new("NodeGroupOutput")
    cam = n.new("ShaderNodeCameraData")
    mul = n.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = -density
    exp = n.new("ShaderNodeMath")
    exp.operation = "EXPONENT"
    fac = n.new("ShaderNodeMath")
    fac.operation = "SUBTRACT"
    fac.inputs[0].default_value = 1.0
    colour = n.new("ShaderNodeRGB")
    colour.name = "HAZE_Colour"
    strength = n.new("ShaderNodeValue")
    strength.name = "HAZE_Strength"
    emit = n.new("ShaderNodeEmission")
    mix = n.new("ShaderNodeMixShader")
    ng.links.new(cam.outputs["View Distance"], mul.inputs[0])
    ng.links.new(mul.outputs[0], exp.inputs[0])
    ng.links.new(exp.outputs[0], fac.inputs[1])
    ng.links.new(fac.outputs[0], mix.inputs["Fac"])
    ng.links.new(gin.outputs[0], mix.inputs[1])
    ng.links.new(colour.outputs[0], emit.inputs["Color"])
    ng.links.new(strength.outputs[0], emit.inputs["Strength"])
    ng.links.new(emit.outputs[0], mix.inputs[2])
    ng.links.new(mix.outputs[0], gout.inputs[0])
    return ng


def add_haze(ng):
    """Route every material's surface through the haze group."""
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        nt = mat.node_tree
        out = next((x for x in nt.nodes if x.type == "OUTPUT_MATERIAL"), None)
        if not out or not out.inputs["Surface"].links:
            continue
        src = out.inputs["Surface"].links[0].from_socket
        g = nt.nodes.new("ShaderNodeGroup")
        g.node_tree = ng
        nt.links.new(src, g.inputs[0])
        nt.links.new(g.outputs[0], out.inputs["Surface"])


def set_light(sun_obj, world, mats, sun, k, frame=None):
    """k = 0 golden hour, 1 blue hour. Keys every value at `frame` when given."""
    elevation = 4.2 + (-5.0 - 4.2) * k
    sv = sun_vector(sun, elevation)
    sun_obj.rotation_euler = (-sv).to_track_quat("-Z", "Y").to_euler()
    sun_obj.data.energy = 7.0 * max(0.0, 1 - k * 1.6)
    nt = world.node_tree
    mix = lambda a, b: tuple(x * (1 - k) + y * k for x, y in zip(srgb(a), srgb(b)))
    nt.nodes["SKY_Gradient"].inputs["A"].default_value = mix(SKY_DAY["horizon"], SKY_DUSK["horizon"])
    nt.nodes["SKY_Gradient"].inputs["B"].default_value = mix(SKY_DAY["zenith"], SKY_DUSK["zenith"])
    nt.nodes["SKY_Warm"].inputs["B"].default_value = mix(SKY_DAY["sun_side"], SKY_DUSK["sun_side"])
    nt.nodes["SKY_SunDot"].inputs[1].default_value = sv
    nt.nodes["SKY_Background"].inputs["Strength"].default_value = SKY_DAY["strength"] + (SKY_DUSK["strength"] - SKY_DAY["strength"]) * k
    lamps = min(max((k - 0.4) / 0.2, 0.0), 1.0)
    windows = min(max((k - 0.55) / 0.3, 0.0), 1.0)
    principled(mats["lamp"]).inputs["Emission Strength"].default_value = 60.0 * lamps
    principled(mats["window"]).inputs["Emission Strength"].default_value = 6.0 * windows
    ng = bpy.data.node_groups.get("NG_Haze")
    if ng:
        ng.nodes["HAZE_Colour"].outputs[0].default_value = mix(SKY_DAY["horizon"], SKY_DUSK["horizon"])
        ng.nodes["HAZE_Strength"].outputs[0].default_value = SKY_DAY["strength"] + (SKY_DUSK["strength"] - SKY_DAY["strength"]) * k
    if frame is not None:
        if ng:
            ng.nodes["HAZE_Colour"].outputs[0].keyframe_insert("default_value", frame=frame)
            ng.nodes["HAZE_Strength"].outputs[0].keyframe_insert("default_value", frame=frame)
        sun_obj.keyframe_insert("rotation_euler", frame=frame)
        sun_obj.data.keyframe_insert("energy", frame=frame)
        for name in ("SKY_Gradient", "SKY_Warm"):
            for sock in ("A", "B"):
                nt.nodes[name].inputs[sock].keyframe_insert("default_value", frame=frame)
        nt.nodes["SKY_SunDot"].inputs[1].keyframe_insert("default_value", frame=frame)
        nt.nodes["SKY_Background"].inputs["Strength"].keyframe_insert("default_value", frame=frame)
        principled(mats["lamp"]).inputs["Emission Strength"].keyframe_insert("default_value", frame=frame)
        principled(mats["window"]).inputs["Emission Strength"].keyframe_insert("default_value", frame=frame)


def key_light(sun_obj, world, mats, plan):
    """Golden hour until shot 07, a time-lapse to blue hour across it, blue hour after."""
    sun = plan["sun"]
    for shot in plan["shots"]:
        if shot["light"] == "day-to-dusk":
            for i in range(11):
                frame = shot["startFrame"] + round(i / 10 * (shot["endFrame"] - shot["startFrame"]))
                set_light(sun_obj, world, mats, sun, i / 10, frame)
    first = plan["shots"][0]["startFrame"]
    set_light(sun_obj, world, mats, sun, 0.0, first)
    set_light(sun_obj, world, mats, sun, 1.0, plan["frames"])


def light_at(plan, frame):
    for shot in plan["shots"]:
        if shot["startFrame"] <= frame <= shot["endFrame"]:
            if shot["light"] == "day":
                return 0.0
            if shot["light"] == "dusk":
                return 1.0
            return (frame - shot["startFrame"]) / (shot["endFrame"] - shot["startFrame"])
    return 0.0


# ---------------------------------------------------------------- cameras


def build_cameras(plan):
    scene = bpy.context.scene
    col = collection("COL_Cameras")
    cams = {}
    for shot in plan["shots"]:
        data = bpy.data.cameras.new("CAM_" + shot["id"])
        data.lens = shot["lens"]
        data.sensor_fit = "HORIZONTAL"
        data.sensor_width = plan["sensorWidth"]
        data.clip_start = 0.1
        data.clip_end = 6000
        data.dof.use_dof = True
        data.dof.aperture_fstop = shot["fStop"]
        cam = bpy.data.objects.new("CAM_" + shot["id"] + "_" + shot["name"].split(":")[0].replace(" ", ""), data)
        col.objects.link(cam)
        cam.rotation_mode = "XYZ"
        span = shot["endFrame"] - shot["startFrame"]
        prev_yaw = None
        for k in shot["keys"]:
            frame = shot["startFrame"] + k["at"] * span
            yaw = k["yawDeg"]
            if prev_yaw is not None:
                while yaw - prev_yaw > 180:
                    yaw -= 360
                while yaw - prev_yaw < -180:
                    yaw += 360
            prev_yaw = yaw
            e = k["eye"]
            cam.location = to_b(e["x"], e["y"], e["z"])
            cam.rotation_euler = (math.radians(90 + k["pitchDeg"]), 0.0, math.radians(yaw))
            data.shift_y = k["shiftY"]
            data.dof.focus_distance = k["focus"]
            cam.keyframe_insert("location", frame=frame)
            cam.keyframe_insert("rotation_euler", frame=frame)
            data.keyframe_insert("shift_y", frame=frame)
            data.dof.keyframe_insert("focus_distance", frame=frame)
        marker = scene.timeline_markers.new(shot["id"], frame=shot["startFrame"])
        marker.camera = cam
        cams[shot["id"]] = cam
    # Eased in and out: Bezier keys with flat handles at the ends of every move.
    for obj in [*cams.values(), *[c.data for c in cams.values()]]:
        ad = obj.animation_data
        if not ad or not ad.action:
            continue
        for fc in fcurves_of(ad.action):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
            fc.update()
    return cams


def fcurves_of(action):
    """F-curves of an action, for both the classic and the layered (Blender 4.4+) action API."""
    if hasattr(action, "fcurves") and len(getattr(action, "fcurves", [])):
        return list(action.fcurves)
    out = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out.extend(bag.fcurves)
    return out


# ---------------------------------------------------------------- render


def setup_render(width, samples):
    scene = bpy.context.scene
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    eevee = next((e for e in engines if "EEVEE" in e), engines[0])
    try:
        scene.render.engine = eevee
    except TypeError as err:
        print("engine:", err)
    scene.render.resolution_x = width
    scene.render.resolution_y = round(width * 9 / 16)
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    ee = scene.eevee
    for attr, value in (("taa_render_samples", samples), ("use_raytracing", True), ("use_shadows", True), ("shadow_ray_count", 2), ("shadow_step_count", 8), ("use_gtao", True), ):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, value)
            except (TypeError, AttributeError):
                pass
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError as err:
        print("view transform:", err)
    try:
        looks = [l.name for l in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items]
        pick = next((l for l in looks if "Medium High" in l), None)
        if pick:
            scene.view_settings.look = pick
    except Exception as err:  # the look list is version dependent; the default look is fine
        print("look:", err)
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90


def render_boards(plan, cams, sun_obj, world, mats, only):
    scene = bpy.context.scene
    os.makedirs(BOARDS, exist_ok=True)
    frames = []
    for shot in plan["shots"]:
        if only and shot["id"] not in only:
            continue
        scene.camera = cams[shot["id"]]
        span = shot["endFrame"] - shot["startFrame"]
        for n, at in enumerate(shot["boards"]):
            frame = shot["startFrame"] + round(at * span)
            scene.frame_set(frame)
            name = f"S{shot['id']}-{'abc'[n] if len(shot['boards']) > 1 else 'a'}.jpg"
            scene.render.filepath = os.path.join(BOARDS, name)
            bpy.ops.render.render(write_still=True)
            frames.append({"shot": shot["id"], "at": at, "frame": frame, "file": name, "light": round(light_at(plan, frame), 3)})
            print("board", name, "frame", frame)
    return frames


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", action="store_true")
    ap.add_argument("--animatic", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--haze", type=float, default=0.0005, help="haze density per metre (0 turns it off)")
    ap.add_argument("--out", default=os.path.join(BLENDER_DIR, "out", "film", "animatic"))
    args = ap.parse_args(argv)
    only = [s for s in args.only.split(",") if s]

    with open(LAYOUT) as f:
        layout = json.load(f)
    with open(GREYBOX) as f:
        grey = json.load(f)
    with open(SHOTS) as f:
        plan = json.load(f)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = plan["frames"]
    mats = build_greybox(layout, grey)
    sun_obj, world = build_light(plan["sun"])
    if args.haze > 0:
        add_haze(haze_group(args.haze))
    key_light(sun_obj, world, mats, plan)
    cams = build_cameras(plan)
    setup_render(args.width, args.samples)

    if args.save:
        path = os.path.join(BLENDER_DIR, "out", "film", "storyboard.blend")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=path)
    if args.boards:
        frames = render_boards(plan, cams, sun_obj, world, mats, only)
        index_path = os.path.join(BOARDS, "frames.json")
        old = []
        if only and os.path.exists(index_path):
            with open(index_path) as f:
                old = [b for b in json.load(f)["boards"] if b["shot"] not in only]
        boards = sorted(old + frames, key=lambda b: b["frame"])
        with open(index_path, "w") as f:
            json.dump({"note": "Written by scripts/blender/film/storyboard.py", "width": args.width, "samples": args.samples, "boards": boards}, f, indent=2)
            f.write("\n")
    if args.animatic:
        os.makedirs(args.out, exist_ok=True)
        scene.render.image_settings.file_format = "JPEG"
        scene.render.filepath = os.path.join(args.out, "f")
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
