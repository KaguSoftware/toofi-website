"""
Zaitun Hills amenities: parametric, reusable asset templates in the compound's style.

    gym         club building: glazed double-height hall behind cream fins, changing wing, timber pergola terrace
    padel       padel court (20 x 10): glass back and side walls, mesh fence, net, floodlights
    tennis      tennis court in its 36.6 x 18.3 enclosure: regulation lines, net, fence, floodlights
    playground  shaded kids' playground: soft surfacing, shade sails, timber play tower, brass slide, swings, sandpit
    mosque      neighbourhood mosque: prayer hall, arcaded portico, portal, mihrab bay, dome on a drum, minaret, ablution wing
    carport     villa driveway carport (1-n bays): rendered side wall, bronze columns, flat roof
    parking     visitor / apartment parking court: two rows of bays, kerbs, hedges, timber shade pergolas

Each one is modelled once, in three.js local space (y up, origin on the ground at the centre of
its footprint, +z = front / entrance), and sized by the arguments in DEFAULTS. Nothing is placed:
track 1B places them from the 28 ha layout. The mosque's qibla wall is local -z; rotate the
instance to face Mecca once the real north direction is known.

Used two ways:

1. From build_compound.py (one hook), which bakes AO for each template and keeps them out of the
   export until 1B places linked copies:

       amenity_templates = amenities.build_all(sys.modules[__name__], shared, atlas, triangles)

   `build_all(kit, shared, atlas, triangles=None, sizes=None)` returns
   {"gym": {"object", "screens", "ao", "params", ...}, ...}; `sizes` overrides DEFAULTS per asset,
   e.g. {"padel": {"length": 20}, "parking": {"bays": 14}}.

2. Standalone, to build, measure and look at them (runs the full compound build, then):

       /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/amenities.py -- \
           --tier high|low [--no-bake] [--textures DIR] [--out DIR] [--report] [--shots] [--blend PATH]

   --report  merges this tier into scripts/blender/amenities.report.json (checked by amenities.test.ts;
             it stores this file's SHA-256, so regenerate both tiers after every edit)
   --shots   EEVEE stills of every template into --out (amenity-<name>-<tier>.png, amenities-<tier>.png)
   --blend   saves a .blend of the preview scene for inspection (never hand-edit it; this file is the source)

Surfaces that the shared trim sheet does not have yet (court, soft surfacing, sail fabric, mesh, sand,
court lines) resolve through SURFACES: the dedicated region if build_compound.REGIONS has it (track 2
adds them), else an existing region with a similar look. No edit here is needed when they land.
"""

import hashlib
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT_PATH = os.path.join(HERE, "amenities.report.json")
SMOOTH = "amenity_smooth"  # face attribute: faces to shade smooth (domes, minaret, masts)

# Default sizes in metres. Track 0 confirms them against the 28 ha plan; pass `sizes` to override.
DEFAULTS = {
    "gym": dict(width=30.0, depth=18.0, height=7.2),
    "padel": dict(length=20.0, width=10.0),
    "tennis": dict(length=36.6, width=18.3),
    "playground": dict(width=24.0, depth=18.0),
    "mosque": dict(width=16.0, depth=16.0, height=7.5, dome_radius=4.2, minaret_height=17.0, dome_finish="limestone"),
    "carport": dict(bays=2, bay_width=3.0, depth=6.0, height=2.8),
    "parking": dict(bays=10, bay_width=2.5, bay_depth=5.0, aisle=6.0, shade=True),
}

# Semantic surface -> (region track 2 will add, fallback region that exists today).
SURFACES = {
    "court": ("court", "courtyard"),
    "line": ("court_line", "slab"),
    "soft": ("soft_surface", "stone"),
    "sand": ("sand", "stone"),
    "sail": ("sail", "slab"),
    "mesh": ("mesh", "lattice"),
}

K = None  # the build_compound module (helpers, slots, tier), set by build_all
LAST = {}  # the most recent build_all result, for the standalone runner


def surface(key):
    preferred, fallback = SURFACES[key]
    return preferred if preferred in K.SLOT else fallback


def slot(name):
    return K.SLOT[name]


# ------------------------------------------------------------------ geometry helpers

def smooth_layer(bm):
    return bm.faces.layers.int.get(SMOOTH) or bm.faces.layers.int.new(SMOOTH)


def lathe(bm, runs, x, z, slot_name, segments=24, smooth=True):
    """Surface of revolution around the vertical axis at (x, z). `runs` are lists of (radius, y)
    from bottom to top; vertices are shared inside a run (smooth) and split between runs (crease).
    Face normals follow the profile: outward on walls, up on caps, down on undersides."""
    lay = smooth_layer(bm) if smooth else None
    ang = [2 * math.pi * i / segments for i in range(segments)]
    for run in runs:
        rings = []
        for r, y in run:
            if r < 1e-6:
                rings.append([bm.verts.new((x, y, z))])
            else:
                rings.append([bm.verts.new((x + r * math.cos(a), y, z + r * math.sin(a))) for a in ang])
        for k in range(len(run) - 1):
            (r0, y0), (r1, y1) = run[k], run[k + 1]
            nr, ny = (y1 - y0), -(r1 - r0)  # the profile tangent turned clockwise
            ring_a, ring_b = rings[k], rings[k + 1]
            if len(ring_a) == 1 and len(ring_b) == 1:
                continue
            for i in range(segments):
                j = (i + 1) % segments
                if len(ring_a) == 1:
                    vs = (ring_a[0], ring_b[i], ring_b[j])
                elif len(ring_b) == 1:
                    vs = (ring_a[i], ring_a[j], ring_b[0])
                else:
                    vs = (ring_a[i], ring_a[j], ring_b[j], ring_b[i])
                f = bm.faces.new(vs)
                f.normal_update()
                mid = (ang[i] + ang[j]) / 2 if j else (ang[i] + 2 * math.pi) / 2
                expect = Vector((nr * math.cos(mid), ny, nr * math.sin(mid)))
                if f.normal.dot(expect) < 0:
                    f.normal_flip()
                f.material_index = slot(slot_name)
                if lay is not None:
                    f[lay] = 1


def cylinder(bm, r, y0, y1, x, z, slot_name, segments=12, smooth=True):
    """Vertical cylinder with a top cap (the bottom is never seen)."""
    lathe(bm, [[(r, y0), (r, y1)], [(r, y1), (0.0, y1)]], x, z, slot_name, segments, smooth)


def sphere(bm, r, cy, x, z, slot_name, segments=12, rings=6):
    run = [(r * math.cos(math.pi * (i / rings - 0.5)), cy + r * math.sin(math.pi * (i / rings - 0.5))) for i in range(rings + 1)]
    run[0] = (0.0, cy - r)
    run[-1] = (0.0, cy + r)
    lathe(bm, [run], x, z, slot_name, segments)


def pointed_dome(radius, base_y, n=14, point=1.1):
    """Two-centred (slightly pointed) dome profile from the springing to the apex."""
    rc = point * radius
    c = radius - rc
    end = math.acos(-c / rc)
    run = [(c + rc * math.cos(end * i / n), base_y + rc * math.sin(end * i / n)) for i in range(n + 1)]
    run[-1] = (0.0, run[-1][1])
    return run


def beam(bm, p0, p1, w, h, slot_name):
    """Box from p0 to p1: `w` across (horizontal), `h` thick (in the vertical plane of the beam)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    d.normalize()
    side = d.cross(Vector((0, 1, 0)))
    side = Vector((1, 0, 0)) if side.length < 1e-6 else side.normalized()
    up = side.cross(d).normalized()
    mid = (p0 + p1) / 2
    res = bmesh.ops.create_cube(bm, size=1.0)
    for v in res["verts"]:
        c = v.co.copy()
        v.co = mid + d * (c.x * length) + up * (c.y * h) + side * (c.z * w)
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = slot(slot_name)


def box(bm, w, h, d, x, y, z, slot_name):
    return K.add_box(bm, w, h, d, x, y, z, slot_name)


def obox(bm, axis, u_len, h, n_len, cu, y, cn, slot_name):
    """Box measured against a wall: `u_len` along the face, `n_len` along its normal axis."""
    if axis == "z":
        return box(bm, u_len, h, n_len, cu, y, cn, slot_name)
    return box(bm, n_len, h, u_len, cn, y, cu, slot_name)


def quad(bm, corners, slot_name, outward=None):
    f = bm.faces.new([bm.verts.new(c) for c in corners])
    f.normal_update()
    if outward is not None and f.normal.dot(Vector(outward)) < 0:
        f.normal_flip()
    f.material_index = slot(slot_name)
    return f


def mesh_panel(bm, a, b, y0, y1, slot_name=None):
    """Vertical fence panel between plan points a and b (the mesh material is double-sided)."""
    (ax, az), (bx, bz) = a, b
    quad(bm, [(ax, y0, az), (bx, y0, bz), (bx, y1, bz), (ax, y1, az)], slot_name or surface("mesh"))


def net(bm, x0, x1, y_bottom, top_at, strands=6):
    """Tennis/padel net seen from the stands: dark cord strands and a white top tape.
    `top_at(x)` is the height of the tape at x (the net sags toward the centre strap)."""
    for k in range(strands):
        t = k / (strands - 1) * 0.92
        p0 = (x0, y_bottom + t * (top_at(x0) - y_bottom), 0)
        pm = (0.0, y_bottom + t * (top_at(0.0) - y_bottom), 0)
        p1 = (x1, y_bottom + t * (top_at(x1) - y_bottom), 0)
        beam(bm, p0, pm, 0.012, 0.012, "bronze")
        beam(bm, pm, p1, 0.012, 0.012, "bronze")
    for xe in (x0, x1):
        beam(bm, (xe, top_at(xe), 0), (0.0, top_at(0.0), 0), 0.02, 0.06, surface("line"))


def arch_points(w, h, n=8):
    """Pointed two-centred arch outline (u across, v up), counter-clockwise from bottom-left."""
    r = 0.8 * w
    c = w / 2 - r
    rise = math.sqrt(r * r - c * c)
    spring = max(0.0, h - rise)
    end = math.acos(-c / r)
    right = [(c + r * math.cos(end * i / n), spring + r * math.sin(end * i / n)) for i in range(1, n + 1)]
    right[-1] = (0.0, right[-1][1])
    left = [(-u, v) for u, v in reversed(right[:-1])]
    return [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, spring)] + right + left + [(-w / 2, spring)]


def rect_points(w, h):
    return [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h), (-w / 2, h)]


def wall_frame(axis, face, sign, along, y):
    """Maps (u along the wall, v up, n outward from the face plane) to three.js space."""
    def to3(u, v, n):
        c = face + sign * n
        return Vector((along + u, y + v, c)) if axis == "z" else Vector((c, y + v, along + u))
    return to3


def prism(bm, pts, to3, n0, n1, slot_name):
    front = [bm.verts.new(to3(u, v, n1)) for u, v in pts]
    back = [bm.verts.new(to3(u, v, n0)) for u, v in pts]
    faces = [bm.faces.new(front), bm.faces.new(back[::-1])]
    m = len(pts)
    for i in range(m):
        j = (i + 1) % m
        faces.append(bm.faces.new((front[i], back[i], back[j], front[j])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = slot(slot_name)


def flat(bm, pts, to3, n, axis, sign, slot_name):
    out = (0, 0, sign) if axis == "z" else (sign, 0, 0)
    f = bm.faces.new([bm.verts.new(to3(u, v, n)) for u, v in pts])
    f.normal_update()
    if f.normal.dot(Vector(out)) < 0:
        f.normal_flip()
    f.material_index = slot(slot_name)


def opening(solid, asset, axis, face, sign, along, y, w, h, arch=True, depth=0.3, fill="glass", screens=None, sill=True, through=None):
    """A window, door or arcade arch in a wall face (axis "z" or "x", outward normal sign * axis).
    The boolean cut gives the reveals; `fill` is a pane set back `depth`; `through` cuts the whole
    wall thickness instead (arcades); `screens` receives a mashrabiya plane (high tier only)."""
    pts = arch_points(w, h) if arch else rect_points(w, h)
    to3 = wall_frame(axis, face, sign, along, y)
    back = -(through + 0.05) if through else -depth
    prism(solid.cut, pts, to3, back, 0.3, K.solid_slot(solid))
    solid.has_cut = True
    if fill:
        flat(asset.loose, pts, to3, -depth + 0.02, axis, sign, fill)
    if screens is not None:
        flat(screens, pts, to3, -0.08, axis, sign, "lattice")
    if sill:
        obox(asset.loose, axis, w + 0.2, 0.07, depth + 0.07, along, y - 0.07, face - sign * (depth - 0.07) / 2, "limestone")


def floodlight(asset, x, z, height, toward):
    """Bronze mast with a floodlight head aimed along `toward` (unit (dx, dz) in plan)."""
    cylinder(asset.loose, 0.12, 0.0, 0.5, x, z, "stone", 10, smooth=False)  # footing
    cylinder(asset.loose, 0.07, 0.5, height, x, z, "bronze", 10)
    dx, dz = toward
    hx, hz = x + dx * 0.35, z + dz * 0.35
    beam(asset.loose, (x, height - 0.1, z), (hx, height - 0.1, hz), 0.06, 0.06, "bronze")
    box(asset.loose, 0.55, 0.14, 0.55, hx, height - 0.25, hz, "bronze")
    box(asset.loose, 0.45, 0.02, 0.45, hx, height - 0.27, hz, "emissive")


# ------------------------------------------------------------------ gym

def gym(screens, width, depth, height):
    a = K.Asset("amenity-gym")
    w, d, h = width, depth, height
    hall_w = round(w * 0.6, 2)
    hall_cx = -w / 2 + hall_w / 2
    wing_w = w - hall_w
    wing_cx = w / 2 - wing_w / 2
    wd = round(d * 0.78, 2)
    wing_cz = -d / 2 + wd / 2
    wh = 4.4
    zf = -d / 2 + wd  # wing front face
    terrace = 4.6

    hall = K.mass(a, hall_w, h, d, hall_cx, 0, "plaster_cream")
    # Double-height glazing toward the courts, behind a brise-soleil of cream fins.
    gw = hall_w - 2.4
    hall.cutter(gw, h - 1.9, 0.8, hall_cx, 0.5, d / 2, "plaster_cream")
    box(a.loose, gw, h - 1.9, 0.04, hall_cx, 0.5, d / 2 - 0.38, "glass")
    if K.HIGH:
        n = max(1, int(gw / 1.8))
        for k in range(n + 1):
            box(a.loose, 0.06, h - 1.9, 0.08, hall_cx - gw / 2 + k * gw / n, 0.5, d / 2 - 0.33, "bronze")
        box(a.loose, gw, 0.08, 0.08, hall_cx, 3.6, d / 2 - 0.33, "bronze")  # transom
    fins = a.solid(0.03)
    nf = int(hall_w / 2.4)
    for k in range(nf + 1):
        fins.box(0.3, h - 1.0, 0.7, hall_cx - hall_w / 2 + 0.3 + k * (hall_w - 0.6) / nf, 0.4, d / 2 + 0.35, "plaster_cream")
    band = a.solid(0.03)
    band.box(hall_w, 0.6, 0.8, hall_cx, h - 0.6, d / 2 + 0.4, "plaster_cream")
    band.box(hall_w, 0.4, 0.8, hall_cx, 0.0, d / 2 + 0.4, "stone")
    # Back clerestory and ground windows; tall screened slots on the open side.
    K.window_row(hall, a, hall_w, -d / 2, -1, 4.2, 1.8, 3.4, cx=hall_cx)
    K.window_row(hall, a, hall_w, -d / 2, -1, 1.0, 2.0, 3.4, cx=hall_cx)
    for k in range(3):
        opening(hall, a, "x", -w / 2, -1, -d / 2 + d * (k + 0.5) / 3, 1.2, 1.6, 4.6, arch=False, screens=screens)
    K.plinth(a, hall_w, d, hall_cx, 0)
    K.parapet(a, hall_w, d, h, hall_cx, 0)

    # Changing-room wing with the entrance under a brass canopy.
    wing = K.mass(a, wing_w, wh, wd, wing_cx, wing_cz, "plaster_shade")
    pc = []
    door_x = wing_cx - 2.5
    K.entrance(wing, a, zf, door_x, pc)
    K.window_row(wing, a, wing_w, zf, 1, 1.0, 2.3, 3.0, cx=wing_cx, skip=lambda x: abs(x - door_x) < 2.0)
    K.window_row(wing, a, wing_w, -d / 2, -1, 1.7, 1.1, 3.0, cx=wing_cx)
    for k in range(2):
        opening(wing, a, "x", w / 2, 1, wing_cz + (k - 0.5) * wd / 2, 1.2, 1.2, 2.2, arch=False, screens=screens)
    K.plinth(a, wing_w, wd, wing_cx, wing_cz, pc)
    K.parapet(a, wing_w, wd, wh, wing_cx, wing_cz, "plaster_shade", skip=("left",))

    # Timber deck terrace under a pergola in front of the hall; paved forecourt by the entrance.
    tz0 = d / 2 + 0.8
    box(a.loose, hall_w, 0.18, terrace, hall_cx, 0, tz0 + terrace / 2, "timber")
    post_z = tz0 + terrace - 0.3
    nposts = max(2, int(hall_w / 4.5) + 1)
    for k in range(nposts):
        px = hall_cx - hall_w / 2 + 0.4 + k * (hall_w - 0.8) / (nposts - 1)
        box(a.loose, 0.22, 3.4, 0.22, px, 0.18, post_z, "timber")
    box(a.loose, hall_w, 0.24, 0.22, hall_cx, 3.58, post_z, "timber")
    step = 0.75 if K.HIGH else 1.5
    for k in range(int(hall_w / step) + 1):
        bx = hall_cx - hall_w / 2 + 0.2 + k * (hall_w - 0.4) / int(hall_w / step)
        box(a.loose, 0.12, 0.2, terrace + 0.3, bx, 3.82, tz0 + terrace / 2, "timber")
    box(a.loose, wing_w, 0.06, tz0 + terrace - zf, wing_cx, 0, (zf + tz0 + terrace) / 2, "paving")

    # Rooftop plant and drain spouts.
    for dx in (-6.0, -3.6, -1.2):
        K.ac_unit(a, hall_cx + dx, h, -d / 2 + 2.6)
    K.ac_unit(a, wing_cx + 2.0, wh, wing_cz - 2.0)
    K.drain_spout(a, hall_cx - hall_w / 2 + 1.2, h - 0.05, -d / 2, -1)
    K.drain_spout(a, wing_cx + wing_w / 2 - 1.2, wh - 0.05, -d / 2, -1)
    return a


# ------------------------------------------------------------------ courts

def padel_court(screens, length, width):
    """Court along local z, net across x at z = 0. Glass back walls 3 m + 1 m mesh; side walls
    glass for the 4 m nearest each end (3 m then 2 m high), mesh elsewhere; 1 m apron."""
    a = K.Asset("amenity-padel")
    L, W = length, width
    court, line = surface("court"), surface("line")
    box(a.loose, W + 2.0, 0.04, L + 2.0, 0, 0, 0, "stone")
    box(a.loose, W, 0.03, L, 0, 0.04, 0, court)
    top = 0.07
    sl = 6.95 * L / 20  # service lines, 6.95 m from the net
    for s in (-1, 1):
        box(a.loose, W, 0.01, 0.05, 0, top, s * sl, line)
    box(a.loose, 0.05, 0.01, 2 * sl, 0, top, 0, line)
    g = 0.03  # walls stand just outside the playing surface
    for s in (-1, 1):
        zb = s * (L / 2 + g)
        box(a.loose, W, 3.0, 0.02, 0, 0.04, zb, "clear")
        mesh_panel(a.loose, (-W / 2, zb), (W / 2, zb), 3.04, 4.04)
        for sx in (-1, 1):
            xs = sx * (W / 2 + g)
            z_end, z2, z4 = s * L / 2, s * (L / 2 - 2), s * (L / 2 - 4)
            box(a.loose, 0.02, 3.0, 2.0, xs, 0.04, (z_end + z2) / 2, "clear")
            box(a.loose, 0.02, 2.0, 2.0, xs, 0.04, (z2 + z4) / 2, "clear")
            mesh_panel(a.loose, (xs, z_end), (xs, z2), 3.04, 4.04)
            mesh_panel(a.loose, (xs, z2), (xs, z4), 2.04, 3.04)
            # Middle run: mesh to 3 m, with the player gate (1 m) on one side of the net.
            gate = (1.0, 2.0) if sx > 0 else (-2.0, -1.0)
            lo, hi = sorted([z4, 0.0])
            cuts = [lo] + [c for c in gate if lo < c < hi] + [hi]
            for i in range(len(cuts) - 1):
                c0, c1 = cuts[i], cuts[i + 1]
                if gate[0] <= c0 and c1 <= gate[1]:
                    continue
                mesh_panel(a.loose, (xs, c0), (xs, c1), 0.04, 3.04)
    # Bronze frame: posts every 2 m, 4 m at the ends, 3 m along the middle, and top rails.
    posts = []
    for sx in (-1, 1):
        n = int(L / 2)
        for k in range(n + 1):
            z = -L / 2 + k * L / n
            posts.append((sx * (W / 2 + 0.07), z, 4.04 if abs(z) > L / 2 - 2.01 else 3.04))
    for s in (-1, 1):
        for k in range(1, 4):
            posts.append((-W / 2 + k * W / 4, s * (L / 2 + 0.07), 4.04))
    for x, z, ph in posts:
        box(a.loose, 0.08, ph, 0.08, x, 0.0, z, "bronze")
    for s in (-1, 1):
        box(a.loose, W + 0.2, 0.06, 0.06, 0, 4.0, s * (L / 2 + 0.07), "bronze")
        for sx in (-1, 1):
            x = sx * (W / 2 + 0.07)
            box(a.loose, 0.06, 0.06, 2.0, x, 4.0, s * (L / 2 - 1), "bronze")
    for sx in (-1, 1):
        box(a.loose, 0.06, 0.06, L - 4.0, sx * (W / 2 + 0.07), 3.0, 0, "bronze")
    # Net: 0.88 m at the centre, posts at the side walls.
    for sx in (-1, 1):
        cylinder(a.loose, 0.04, top, 0.95, sx * (W / 2 - 0.05), 0, "bronze", 8)
    net(a.loose, -W / 2 + 0.05, W / 2 - 0.05, top + 0.06, lambda x: 0.88 + 0.04 * abs(x) / (W / 2) + top - 0.04)
    for sx in (-1, 1):
        for s in (-1, 1):
            floodlight(a, sx * (W / 2 + 0.6), s * (L / 2 - 3.0), 6.0, (-sx, 0))
    return a


def tennis_court(screens, length, width):
    """Doubles court (23.77 x 10.97, ITF lines) centred in its enclosure; net across x at z = 0."""
    a = K.Asset("amenity-tennis")
    L, W = length, width
    court, line = surface("court"), surface("line")
    box(a.loose, W, 0.05, L, 0, 0, 0, court)
    top = 0.05
    hl, hw, sw, svc = 23.77 / 2, 10.97 / 2, 8.23 / 2, 6.40
    for s in (-1, 1):
        box(a.loose, 2 * hw + 0.05, 0.01, 0.1, 0, top, s * (hl - 0.05), line)  # baselines
        box(a.loose, 2 * sw, 0.01, 0.05, 0, top, s * svc, line)  # service lines
        box(a.loose, 0.05, 0.01, 0.1, 0, top, s * (hl - 0.15), line)  # centre marks
        for x in (hw, sw):
            box(a.loose, 0.05, 0.01, 2 * hl, s * (x - 0.025), top, 0, line)  # side lines
    box(a.loose, 0.05, 0.01, 2 * svc, 0, top, 0, line)  # centre service line
    # Net: 1.07 m at the posts (0.914 m outside the doubles lines), 0.914 m at the centre strap.
    px = hw + 0.914
    for sx in (-1, 1):
        cylinder(a.loose, 0.04, top, 1.07 + top, sx * px, 0, "bronze", 8)
    net(a.loose, -px, px, top + 0.08, lambda x: top + 0.914 + (1.07 - 0.914) * abs(x) / px)
    box(a.loose, 0.05, 0.86, 0.02, 0, top + 0.05, 0, line)  # centre strap
    # Fence: 3 m mesh on a low stone kerb, bronze posts every ~3 m, a gate in one long side.
    fh = 3.0
    for s in (-1, 1):
        box(a.loose, W + 0.2, 0.15, 0.2, 0, 0, s * (L / 2 + 0.1), "stone")
        box(a.loose, 0.2, 0.15, L, s * (W / 2 + 0.1), 0, 0, "stone")
    y0, y1 = 0.15, 0.15 + fh
    gate = (L / 2 - 3.0, L / 2 - 1.8)
    for s in (-1, 1):
        zf = s * (L / 2 + 0.1)
        mesh_panel(a.loose, (-W / 2, zf), (W / 2, zf), y0, y1)
        xf = s * (W / 2 + 0.1)
        if s > 0:
            mesh_panel(a.loose, (xf, -L / 2), (xf, gate[0]), y0, y1)
            mesh_panel(a.loose, (xf, gate[1]), (xf, L / 2), y0, y1)
        else:
            mesh_panel(a.loose, (xf, -L / 2), (xf, L / 2), y0, y1)
    nz, nx = max(2, round(L / 3)), max(2, round(W / 3))
    for k in range(nz + 1):
        z = -L / 2 + k * L / nz
        for s in (-1, 1):
            box(a.loose, 0.08, fh + 0.05, 0.08, s * (W / 2 + 0.1), 0.15, z, "bronze")
    for k in range(1, nx):
        x = -W / 2 + k * W / nx
        for s in (-1, 1):
            box(a.loose, 0.08, fh + 0.05, 0.08, x, 0.15, s * (L / 2 + 0.1), "bronze")
    for s in (-1, 1):
        box(a.loose, W + 0.28, 0.06, 0.06, 0, y1, s * (L / 2 + 0.1), "bronze")
        box(a.loose, 0.06, 0.06, L, s * (W / 2 + 0.1), y1, 0, "bronze")
    for sx in (-1, 1):
        for s in (-1, 1):
            floodlight(a, sx * (W / 2 + 0.45), s * L / 4, 8.0, (-sx, 0))
    return a


# ------------------------------------------------------------------ playground

def shade_sail(bm, corners, n=6):
    """Tensioned fabric (a hypar between four mast tops), two-sided, slightly sagging."""
    p = [Vector(c) for c in corners]
    grid = []
    for i in range(n + 1):
        row = []
        for j in range(n + 1):
            u, v = i / n, j / n
            q = p[0] * (1 - u) * (1 - v) + p[1] * u * (1 - v) + p[2] * u * v + p[3] * (1 - u) * v
            q.y -= 0.35 * math.sin(math.pi * u) * math.sin(math.pi * v)
            row.append(q)
        grid.append(row)
    for offset, up in ((0.0, 1), (-0.015, -1)):
        verts = [[bm.verts.new(q + Vector((0, offset, 0))) for q in row] for row in grid]
        for i in range(n):
            for j in range(n):
                f = bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
                f.normal_update()
                if f.normal.y * up < 0:
                    f.normal_flip()
                f.material_index = slot(surface("sail"))


def playground(screens, width, depth):
    a = K.Asset("amenity-playground")
    w, d = width, depth
    # Soft surfacing inside a limestone kerb that doubles as a seat edge.
    box(a.loose, w - 0.6, 0.06, d - 0.6, 0, 0, 0, surface("soft"))
    kerb = a.solid(0.03)
    for s in (-1, 1):
        kerb.box(w, 0.32, 0.3, 0, 0, s * (d / 2 - 0.15), "limestone")
        kerb.box(0.3, 0.32, d - 0.6, s * (w / 2 - 0.15), 0, 0, "limestone")
    sx, sz = w / 24, d / 18  # layout scales with the footprint
    g = 0.06  # top of the surfacing

    # Play tower: 2.4 m deck at 1.5 m, timber posts, flat roof with a brass fascia.
    tx, tz = -6 * sx, -2 * sz
    for px in (-1.13, 1.13):
        for pz in (-1.13, 1.13):
            box(a.loose, 0.14, 3.0 - g, 0.14, tx + px, g, tz + pz, "timber")
    box(a.loose, 2.4, 0.08, 2.4, tx, 1.42, tz, "timber")
    box(a.loose, 2.8, 0.1, 2.8, tx, 3.0, tz, "timber")
    for s in (-1, 1):
        box(a.loose, 2.92, 0.14, 0.04, tx, 2.98, tz + s * 1.44, "brass")
        box(a.loose, 0.04, 0.14, 2.84, tx + s * 1.44, 2.98, tz, "brass")
    for s in (-1, 1):  # rails on the two closed sides
        x = tx + s * 1.16
        box(a.loose, 0.06, 0.06, 2.3, x, 2.4, tz, "timber")
        if K.HIGH:
            for k in range(14):
                box(a.loose, 0.04, 0.9, 0.05, x, 1.5, tz - 1.05 + k * 2.1 / 13, "timber")
        else:
            box(a.loose, 0.04, 0.9, 2.3, x, 1.5, tz, "timber")
    # Brass slide off the front, timber stair at the back, climbing wall on the side.
    z0 = tz + 1.2
    beam(a.loose, (tx, 1.5, z0), (tx, 0.45, z0 + 3.2), 0.6, 0.04, "brass")
    beam(a.loose, (tx, 0.45, z0 + 3.2), (tx, 0.4, z0 + 4.0), 0.6, 0.04, "brass")
    for s in (-1, 1):
        beam(a.loose, (tx + s * 0.32, 1.65, z0), (tx + s * 0.32, 0.6, z0 + 3.2), 0.04, 0.3, "brass")
        beam(a.loose, (tx + s * 0.32, 0.6, z0 + 3.2), (tx + s * 0.32, 0.55, z0 + 4.0), 0.04, 0.3, "brass")
    box(a.loose, 0.12, 0.4, 0.12, tx, g, z0 + 3.2, "timber")
    zb = tz - 1.2
    box(a.loose, 1.1, 0.12, 0.5, tx, 0, zb - 2.45, "limestone")  # landing pad at the stair foot
    for s in (-1, 1):
        beam(a.loose, (tx + s * 0.45, 0.2, zb - 2.4), (tx + s * 0.45, 1.5, zb), 0.06, 0.2, "timber")
        if K.HIGH:
            beam(a.loose, (tx + s * 0.45, 1.0, zb - 2.4), (tx + s * 0.45, 2.4, zb), 0.04, 0.04, "brass")
    for k in range(1, 6):
        t = k / 6
        box(a.loose, 0.84, 0.05, 0.28, tx, 0.12 + t * (1.5 - 0.12), zb - 2.4 * (1 - t), "timber")
    box(a.loose, 0.08, 1.44, 2.4, tx - 1.24, g, tz, "timber")
    if K.HIGH:
        rng = np.random.default_rng(3)
        for _ in range(14):
            box(a.loose, 0.06, 0.08, 0.12, tx - 1.31, rng.uniform(0.25, 1.35), tz + rng.uniform(-1.0, 1.0), "brass")

    # Swing set: timber A-frames, a top beam, two seats on bronze chains.
    wx, wz = 5 * sx, -3 * sz
    for s in (-1, 1):
        for t in (-1, 1):
            box(a.loose, 0.3, 0.14, 0.3, wx + s * 2.0, 0, wz + t * 0.92, "stone")  # leg shoes
            beam(a.loose, (wx + s * 2.0, 0.2, wz + t * 0.88), (wx + s * 2.0, 2.62, wz), 0.12, 0.12, "timber")
    box(a.loose, 4.3, 0.14, 0.14, wx, 2.55, wz, "timber")
    for s in (-1, 1):
        cx = wx + s * 0.85
        for c in (-0.22, 0.22):
            box(a.loose, 0.025, 2.07, 0.025, cx + c, 0.48, wz, "bronze")
        box(a.loose, 0.52, 0.05, 0.2, cx, 0.46, wz, "timber")

    # Sandpit with a limestone frame.
    px, pz = 5.5 * sx, 4.6 * sz
    pit = a.solid(0.03)
    for s in (-1, 1):
        pit.box(4.0, 0.35, 0.3, px, 0, pz + s * 1.55, "limestone")
        pit.box(0.3, 0.35, 2.8, px + s * 1.85, 0, pz, "limestone")
    box(a.loose, 3.4, 0.24, 2.8, px, 0, pz, surface("sand"))

    # Stepping posts in an arc.
    for k in range(7):
        ang = math.radians(200 + k * 22)
        cylinder(a.loose, 0.15, g, g + 0.25 + 0.08 * (k % 4), -1 * sx + 2.6 * math.cos(ang), 5.2 * sz + 2.6 * math.sin(ang) + 2.6, "timber", 10, smooth=False)

    # Shade sails on bronze masts (corners alternate high and low).
    sails = [
        ((-10.6, 4.6, -7.4), (-1.6, 3.5, -7.4), (-1.6, 4.6, 3.6), (-10.6, 3.5, 3.6)),
        ((1.2, 3.6, -7.4), (10.6, 4.7, -7.4), (10.6, 3.6, 0.6), (1.2, 4.7, 0.6)),
        ((1.2, 4.5, 1.6), (10.6, 3.5, 1.6), (10.6, 4.5, 7.8), (1.2, 3.5, 7.8)),
    ]
    for corners in sails:
        cs = [(x * sx, y, z * sz) for x, y, z in corners]
        shade_sail(a.loose, cs)
        ccx = sum(c[0] for c in cs) / 4
        ccz = sum(c[2] for c in cs) / 4
        for x, y, z in cs:
            ox, oz = x - ccx, z - ccz
            n = math.hypot(ox, oz)
            mx, mz = x + ox / n * 0.35, z + oz / n * 0.35
            cylinder(a.loose, 0.08, g, y + 0.45, mx, mz, "bronze", 10)
            box(a.loose, 0.45, 0.12, 0.45, mx, g, mz, "stone")
            if K.HIGH:
                beam(a.loose, (mx, y + 0.3, mz), (x, y, z), 0.015, 0.015, "bronze")
    # Benches for parents (high tier only, like the boulevard benches).
    if K.HIGH:
        for bx in (-7.5 * sx, -1.0 * sx):
            seat = a.solid(0.03)
            seat.box(2.2, 0.12, 0.55, bx, 0.38, d / 2 - 1.3, "limestone")
            for o in (-0.8, 0.8):
                seat.box(0.3, 0.38, 0.5, bx + o, 0, d / 2 - 1.3, "limestone")
    return a


# ------------------------------------------------------------------ mosque

def mosque(screens, width, depth, height, dome_radius, minaret_height, dome_finish):
    """Prayer hall (qibla wall at local -z), portico and portal at +z, minaret at the front right,
    ablution wing on the left, all on a 0.45 m stone platform."""
    a = K.Asset("amenity-mosque")
    w, d, h, R, mh = width, depth, height, dome_radius, minaret_height
    P = 0.45
    pd, ph = 4.0, 4.8  # portico depth and height
    zp = d / 2 + pd  # portico front
    dome_slot = "mosaic" if dome_finish == "mosaic" else "limestone"
    mx, mz = w / 2 + 2.1, zp - 1.7  # minaret axis
    ax_w, ah = 4.4, 3.0  # ablution wing

    # Platform with a travertine top and two steps up at the front.
    x0, x1 = -w / 2 - ax_w - 1.2, mx + 1.7 + 1.2
    z0, z1 = -d / 2 - 1.4 - 1.2, zp + 0.3 + 1.2
    plat = a.solid(0.04)
    plat.box(x1 - x0, P, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2, "stone")
    box(a.loose, x1 - x0 - 0.6, 0.02, z1 - z0 - 0.6, (x0 + x1) / 2, P, (z0 + z1) / 2, "slab")
    for k, sh in enumerate((0.3, 0.15)):
        box(a.loose, 7.0, sh, 0.36, 0, 0, z1 + 0.18 + k * 0.36, "stone")

    # Prayer hall: tall pointed-arch windows with mashrabiya, a stone plinth course.
    hall = K.mass(a, w, h, d, 0, 0, "plaster_cream", y=P)
    for s in (-1, 1):
        for k in range(3):
            opening(hall, a, "x", s * w / 2, s, -d / 2 + d * (k + 0.5) / 3, P + 3.4, 1.5, 3.4, screens=screens)
        if s > 0:
            for k in range(3):
                opening(hall, a, "x", w / 2, 1, -d / 2 + d * (k + 0.5) / 3, P + 1.0, 1.0, 1.6, arch=False)
    for x in (-w / 2 + 3.0, w / 2 - 3.0):
        opening(hall, a, "z", -d / 2, -1, x, P + 3.4, 1.5, 3.4, screens=screens)
    opening(hall, a, "z", d / 2, 1, 0, P, 2.4, 3.8, depth=0.35, fill="timber", sill=False)
    for s in (-1, 1):
        box(a.loose, 0.05, 0.7, 0.05, s * 0.25, P + 1.1, d / 2 - 0.29, "brass")
    base = a.solid(0.03)
    base.box(w + 0.08, 0.35, d + 0.08, 0, P, 0, "stone")
    base.cutter(2.4, 0.5, 1.0, 0, P, d / 2, "stone")
    K.parapet(a, w, d, P + h, 0, 0)
    # Mihrab bay projecting from the qibla wall.
    mih = K.mass(a, 3.6, h - 1.4, 1.4, 0, -d / 2 - 0.7, "plaster_shade", y=P)
    mih.box(3.8, 0.12, 1.6, 0, P + h - 1.4, -d / 2 - 0.75, "limestone")

    # Arcaded portico (riwaq) with the tall portal (pishtaq) in the middle bay.
    # The arcade carries the roof's front edge; the middle bay is the portal, so the arcade and
    # the roof stop short of it and never show inside its arch.
    portal_w = 6.4
    roof = a.solid(0.03)
    roof.box(w, 0.5, pd - 0.7, 0, P + ph - 0.5, d / 2 + (pd - 0.7) / 2, "plaster_cream")
    bay = w / 5
    seg = (w - portal_w) / 2
    for s in (-1, 1):
        arcade = K.mass(a, seg, ph, 0.7, s * (portal_w / 2 + seg / 2), zp - 0.35, "plaster_cream", y=P)
        for k in (1, 2):
            opening(arcade, a, "z", zp, 1, s * k * bay, P, bay - 1.0, 3.6, fill=None, sill=False, through=0.7)
    side = K.mass(a, 0.7, ph - 0.5, pd - 0.7, -w / 2 + 0.35, d / 2 + (pd - 0.7) / 2, "plaster_cream", y=P)
    side.box(0.7, ph - 0.5, pd - 0.7, w / 2 - 0.35, P, d / 2 + (pd - 0.7) / 2, "plaster_cream")
    opening(side, a, "x", -w / 2, -1, d / 2 + (pd - 0.7) / 2, P, 2.0, 3.4, fill=None, sill=False, through=0.7)
    box(a.loose, w - 0.4, 0.04, pd - 0.4, 0, P, d / 2 + pd / 2 - 0.2, "slab")
    box(a.loose, w - 2.0, 0.02, 0.25, 0, P + ph - 0.53, d / 2 + (pd - 0.7) / 2, "emissive")
    K.parapet(a, w, pd, P + ph, 0, d / 2 + pd / 2, skip=("back",))
    portal_h = h + 0.9
    # Portal (iwan): a deep pointed-arch recess, a passage through its back into the portico.
    portal = K.mass(a, portal_w, portal_h, 1.1, 0, zp - 0.25, "plaster_cream", y=P)
    opening(portal, a, "z", zp + 0.3, 1, 0, P, 3.6, 6.2, depth=0.85, fill=None, sill=False)
    opening(portal, a, "z", zp + 0.3, 1, 0, P, 2.4, 3.7, fill=None, sill=False, through=1.1)
    box(a.loose, portal_w + 0.2, 0.12, 1.3, 0, P + portal_h, zp - 0.25, "limestone")
    box(a.loose, 5.6, 0.5, 0.04, 0, P + portal_h - 1.1, zp + 0.31, "mosaic")  # tile frieze

    # Drum, cornice, dome and a brass finial.
    yd = P + h
    rd = R + 0.6
    lathe(a.loose, [[(rd, yd), (rd, yd + 1.48)]], 0, 0, "plaster_cream", 8, smooth=False)
    lathe(a.loose, [[(rd + 0.03, yd + 0.95), (rd + 0.03, yd + 1.35)]], 0, 0, "mosaic", 8, smooth=False)
    lathe(a.loose, [[(rd, yd + 1.48), (rd + 0.12, yd + 1.48)], [(rd + 0.12, yd + 1.48), (rd + 0.12, yd + 1.62)], [(rd + 0.12, yd + 1.62), (0.0, yd + 1.62)]], 0, 0, "limestone", 8, smooth=False)
    dome = pointed_dome(R, yd + 1.62)
    lathe(a.loose, [dome], 0, 0, dome_slot, 40)
    top = dome[-1][1]
    finial(a, 0, 0, top, 1.05, 0.05, (0.2, 0.13), 0.28)

    # Minaret: square base, round shaft, tile band, corbelled balcony, lantern, small dome.
    base_top = P + h + 0.9
    mb = K.mass(a, 3.4, base_top - P - 0.12, 3.4, mx, mz, "plaster_cream", y=P)
    mb.box(3.5, 0.35, 3.5, mx, P, mz, "stone")
    for y in (P + 3.0, P + 5.6):
        opening(mb, a, "z", mz + 1.7, 1, mx, y, 0.5, 1.6, arch=True, depth=0.25)
    box(a.loose, 3.56, 0.12, 3.56, mx, base_top - 0.12, mz, "limestone")
    yb = mh - 5.6  # balcony
    yu = mh - 2.4  # top of the lantern
    lathe(a.loose, [[(1.15, base_top), (1.15, yb - 0.3)]], mx, mz, "plaster_cream", 24)
    lathe(a.loose, [[(1.17, yb - 0.9), (1.17, yb - 0.3)]], mx, mz, "mosaic", 24)
    lathe(a.loose, [[(1.15, yb - 0.3), (1.8, yb + 0.1)], [(1.8, yb + 0.1), (1.8, yb + 0.25)], [(1.8, yb + 0.25), (0.85, yb + 0.25)]], mx, mz, "limestone", 24)
    if K.HIGH:
        for k in range(16):
            t = 2 * math.pi * k / 16
            box(a.loose, 0.04, 0.9, 0.04, mx + 1.72 * math.cos(t), yb + 0.25, mz + 1.72 * math.sin(t), "brass")
        ring = [(mx + 1.72 * math.cos(2 * math.pi * k / 16), mz + 1.72 * math.sin(2 * math.pi * k / 16)) for k in range(17)]
        for (x0_, z0_), (x1_, z1_) in zip(ring, ring[1:]):
            beam(a.loose, (x0_, yb + 1.15, z0_), (x1_, yb + 1.15, z1_), 0.05, 0.05, "brass")
    else:
        lathe(a.loose, [[(1.8, yb + 0.25), (1.8, yb + 1.15)], [(1.8, yb + 1.15), (1.62, yb + 1.15)], [(1.62, yb + 1.15), (1.62, yb + 0.25)]], mx, mz, "limestone", 24, smooth=False)
    lathe(a.loose, [[(0.85, yb + 0.25), (0.85, yu)]], mx, mz, "plaster_cream", 20)
    lathe(a.loose, [[(0.87, yb + 0.6), (0.87, yb + 0.75)]], mx, mz, "emissive", 20)
    lathe(a.loose, [[(0.85, yu), (1.0, yu)], [(1.0, yu), (1.0, yu + 0.15)], [(1.0, yu + 0.15), (0.0, yu + 0.15)]], mx, mz, "limestone", 20, smooth=False)
    cap = pointed_dome(0.8, yu + 0.15, n=8)
    lathe(a.loose, [cap], mx, mz, dome_slot, 20)
    finial(a, mx, mz, cap[-1][1], mh - cap[-1][1], 0.035, (0.1,), 0.0)

    # Ablution wing on the left, with screened high windows.
    awx = -w / 2 - ax_w / 2
    awing = K.mass(a, ax_w, ah, d - 4.0, awx, 0, "plaster_shade", y=P)
    opening(awing, a, "z", d / 2 - 2.0, 1, awx, P, 1.2, 2.4, arch=False, fill="timber", sill=False, depth=0.25)
    for k in range(3):
        opening(awing, a, "x", -w / 2 - ax_w, -1, -d / 2 + 2.0 + (d - 4.0) * (k + 0.5) / 3, P + 1.9, 1.0, 0.8, arch=False, screens=screens)
    K.parapet(a, ax_w, d - 4.0, P + ah, awx, 0, "plaster_shade", skip=("right",))

    # Rooftop plant and drain spouts.
    for x in (-w / 2 + 2.4, w / 2 - 2.4):
        K.ac_unit(a, x, P + h, -d / 2 + 1.8)
    K.ac_unit(a, awx, P + ah, -d / 2 + 4.0)
    for x in (-w / 2 + 1.2, w / 2 - 1.2):
        K.drain_spout(a, x, P + h - 0.05, -d / 2, -1)
    return a


def finial(a, x, z, y, height, rod, spheres, crescent):
    """Brass finial: a rod with stacked spheres and, optionally, a crescent (horns up, facing +-z)."""
    cylinder(a.loose, rod, y - 0.1, y + height, x, z, "brass", 8)
    for k, r in enumerate(spheres):
        sphere(a.loose, r, y + height * (k + 1) / (len(spheres) + 1), x, z, "brass")
    if crescent and K.HIGH:
        cy = y + height + crescent
        pts = [(x + crescent * math.sin(math.radians(t)), cy - crescent * math.cos(math.radians(t))) for t in range(-140, 141, 35)]
        for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
            beam(a.loose, (u0, v0, z), (u1, v1, z), 0.05, 0.06, "brass")


# ------------------------------------------------------------------ parking

def carport(screens, bays, bay_width, depth, height):
    """Villa driveway carport: rendered side wall at -x, bronze columns at +x, flat roof; +z to the street."""
    a = K.Asset("amenity-carport")
    W, D, H = bays * bay_width + 0.6, depth, height
    box(a.loose, W, 0.06, D + 1.0, 0, 0, 0.5, "paving")
    wall = K.mass(a, 0.3, H, D, -W / 2 + 0.15, 0, "plaster_cream")
    wall.box(0.36, 0.4, D + 0.06, -W / 2 + 0.15, 0, 0, "stone")
    for s in (-1, 1):
        box(a.loose, 0.16, H, 0.16, W / 2 - 0.25, 0, s * (D / 2 - 0.3), "bronze")
    roof = a.solid(0.03)
    roof.box(W + 0.3, 0.24, D + 0.4, 0, H, 0, "plaster_cream")
    roof.box(W + 0.4, 0.08, D + 0.5, 0, H + 0.24, 0, "limestone")
    if K.HIGH:
        for k in range(int((D - 0.4) / 0.35) + 1):
            box(a.loose, W - 0.5, 0.06, 0.08, 0.1, H - 0.06, -D / 2 + 0.2 + k * 0.35, "timber")
        for b in range(bays):
            box(a.loose, 1.6, 0.12, 0.15, -W / 2 + 0.3 + (b + 0.5) * bay_width, 0.06, -D / 2 + 0.6, "limestone")
    box(a.loose, 0.2, 0.02, D - 1.2, 0.1, H - (0.08 if K.HIGH else 0.02), 0, "emissive")
    return a


def parking(screens, bays, bay_width, bay_depth, aisle, shade):
    """Parking court: a central aisle along x (entry at +x), `bays` bays on each side, limestone
    kerbs, hedges along the long sides, timber shade pergolas over the bays."""
    a = K.Asset("amenity-parking")
    run = bays * bay_width
    L, Dz = run + 2.0, 2 * bay_depth + aisle
    line = surface("line")
    box(a.loose, L, 0.05, Dz, 0, 0, 0, "paving")
    kerb = a.solid(0.03)
    for s in (-1, 1):
        kerb.box(L + 0.3, 0.15, 0.3, -0.15, 0, s * (Dz / 2 + 0.15), "limestone")
    kerb.box(0.3, 0.15, Dz, -L / 2 - 0.15, 0, 0, "limestone")
    hedge = a.solid(0.14, 2)
    for s in (-1, 1):
        hedge.box(L + 0.6, 1.1, 1.0, -0.3, 0, s * (Dz / 2 + 0.8), "hedge")
    for s in (-1, 1):
        zc = s * (aisle / 2 + (bay_depth - 0.4) / 2)
        for k in range(bays + 1):
            box(a.loose, 0.1, 0.01, bay_depth - 0.4, -run / 2 + k * bay_width, 0.05, zc, line)
        if K.HIGH:
            for k in range(bays):
                box(a.loose, 1.6, 0.12, 0.15, -run / 2 + (k + 0.5) * bay_width, 0.05, s * (aisle / 2 + bay_depth - 0.7), "limestone")
    if shade:
        zb, za = aisle / 2 + bay_depth - 0.15, aisle / 2 + 0.4
        step = 0.5 if K.HIGH else 0.9
        for s in (-1, 1):
            for k in range(0, bays + 1, 2):
                x = -run / 2 + k * bay_width
                box(a.loose, 0.14, 2.7, 0.14, x, 0.05, s * zb, "bronze")
                box(a.loose, 0.16, 0.28, zb - za + 0.3, x, 2.75, s * (zb + za) / 2, "timber")
            n = int((zb - za) / step)
            for k in range(n + 1):
                box(a.loose, run + 0.4, 0.1, 0.06, 0, 3.03, s * (za + k * (zb - za) / n), "timber")
    return a


# ------------------------------------------------------------------ build

BUILDERS = {
    "gym": gym,
    "padel": padel_court,
    "tennis": tennis_court,
    "playground": playground,
    "mosque": mosque,
    "carport": carport,
    "parking": parking,
}


def apply_smooth(me):
    """Shade the faces flagged by lathe() smooth (finish_mesh makes every face flat), then drop the flag."""
    attr = me.attributes.get(SMOOTH)
    if attr is None:
        return 0
    vals = np.zeros(len(me.polygons), np.int32)
    attr.data.foreach_get("value", vals)
    me.polygons.foreach_set("use_smooth", vals.astype(bool))
    me.attributes.remove(attr)
    me.update()
    return int(vals.sum())


def material_key(asset_name, mat_name):
    if mat_name.startswith(asset_name + "-"):
        return {"atlas": "atlas", "lattice": "lattice", "screens-atlas": "atlas", "screen": "lattice"}[mat_name[len(asset_name) + 1 :]]
    return mat_name


def describe(name, objs):
    """Bounds (three.js space), triangles and materials actually used, for the report."""
    cos, mats, tris = [], set(), 0
    for o in objs:
        me = o.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        cos.append(np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1))  # blender -> three.js
        idx = np.empty(len(me.polygons), np.int32)
        me.polygons.foreach_get("material_index", idx)
        mats |= {material_key(name, me.materials[i].name) for i in np.unique(idx)}
        tris += K.tri_count(me)
    co = np.concatenate(cos)
    lo, hi = co.min(0), co.max(0)
    return {
        "triangles": tris,
        "min": [round(float(v), 3) for v in lo],
        "max": [round(float(v), 3) for v in hi],
        "size": [round(float(v), 3) for v in hi - lo],
        "materials": sorted(mats),
    }


def build_all(kit, shared, atlas, triangles=None, sizes=None):
    """Model, UV and bake every amenity template; return them unplaced (not in the scene)."""
    global K
    K = kit
    out = {}
    scene_objects = bpy.context.scene.collection.objects
    for key, fn in BUILDERS.items():
        params = {**DEFAULTS[key], **((sizes or {}).get(key, {}))}
        name = f"amenity-{key}"
        screens = bmesh.new()
        obj, scr, ao = kit.make_asset(name, lambda fn=fn, p=params, s=screens: fn(s, **p), shared, atlas, screens)
        smooth = apply_smooth(obj.data)
        objs = [o for o in (obj, scr) if o]
        info = describe(name, objs)
        for o in objs:
            if o.name in scene_objects:
                scene_objects.unlink(o)
        if triangles is not None:
            triangles[name] = info["triangles"]
        out[key] = {"object": obj, "screens": scr, "ao": ao, "params": params, "smoothFaces": smooth, **info}
        kit.log(f"{name}: {info['triangles']} tris, {info['size']} m (unplaced template)")
    LAST.clear()
    LAST.update(out)
    return out


# ------------------------------------------------------------------ standalone: report, stills

def source_hash():
    with open(os.path.abspath(__file__), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def write_report(built, tier):
    report = {}
    if os.path.exists(REPORT_PATH):
        report = json.load(open(REPORT_PATH))
    if report.get("source") != source_hash():
        report = {"tiers": {}}  # stale: start again from this tier
    report["generatedBy"] = "scripts/blender/amenities.py --report"
    report["source"] = source_hash()
    report["blender"] = bpy.app.version_string
    report["surfaces"] = {k: surface(k) for k in SURFACES}
    report["params"] = {k: v["params"] for k, v in built.items()}
    report["tiers"][tier] = {
        k: {f: v[f] for f in ("triangles", "min", "max", "size", "materials", "smoothFaces")} for k, v in built.items()
    }
    report["tiers"] = dict(sorted(report["tiers"].items()))
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    K.log(f"report: {REPORT_PATH} ({', '.join(report['tiers'])})")


VIEWS = {  # three.js direction from the target toward the eye
    "gym": (0.55, 0.42, 1.0),
    "padel": (0.9, 0.55, 0.75),
    "tennis": (0.95, 0.6, 0.7),
    "playground": (0.7, 0.55, 1.0),
    "mosque": (0.55, 0.32, 1.0),
    "carport": (0.85, 0.4, 1.0),
    "parking": (0.7, 0.6, 1.0),
}


def render_shots(built, tier, out_dir):
    scene = bpy.data.scenes.new("amenities-preview")
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError as e:
        K.log("EEVEE engine name", e)
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.view_settings.view_transform = "AgX"
    if hasattr(scene.eevee, "use_shadows"):
        scene.eevee.use_shadows = True
    world = bpy.data.worlds.new("preview-sky")
    if world.node_tree is None:
        world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.42, 0.48, 0.62, 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.color = (1.0, 0.86, 0.7)
    sun.data.angle = math.radians(1.5)
    sun.rotation_euler = (math.radians(58), 0, math.radians(-35))
    scene.collection.objects.link(sun)
    ground_me = bpy.data.meshes.new("ground")
    s = 3000
    ground_me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gb = next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    gb.inputs["Base Color"].default_value = (0.42, 0.34, 0.24, 1)
    gb.inputs["Roughness"].default_value = 1.0
    ground_me.materials.append(gm)
    scene.collection.objects.link(bpy.data.objects.new("ground", ground_me))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 35
    scene.collection.objects.link(cam)
    scene.camera = cam

    # Lay the templates out in a row (preview only; 1B places the real copies).
    x = 0.0
    placed = {}
    for key, v in built.items():
        sx = v["size"][0]
        x += sx / 2
        objs = []
        for o in (v["object"], v["screens"]):
            if o:
                c = bpy.data.objects.new(f"preview-{o.name}", o.data)
                c.location = (x, 0, 0)
                scene.collection.objects.link(c)
                objs.append(c)
        placed[key] = (x, objs)
        x += sx / 2 + 14.0

    def aim(target_three, direction, radius):
        d = Vector(direction).normalized()
        fov = 2 * math.atan(18 / cam.data.lens) * (1000 / 1600)  # vertical
        dist = radius / math.sin(fov / 2) * 0.82
        eye = Vector(target_three) + d * dist
        cam.location = (eye.x, -eye.z, eye.y)
        t = Vector((target_three[0], -target_three[2], target_three[1]))
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()

    for key, v in built.items():
        ox, objs = placed[key]
        for k2, (_, others) in placed.items():
            for o in others:
                o.hide_render = k2 != key
        lo, hi = Vector(v["min"]), Vector(v["max"])
        c = (lo + hi) / 2
        c.x += ox
        aim(c, VIEWS[key], (hi - lo).length / 2)
        scene.render.filepath = os.path.join(out_dir, f"amenity-{key}-{tier}.png")
        bpy.ops.render.render(write_still=True, scene=scene.name)
    for _, others in placed.values():
        for o in others:
            o.hide_render = False
    aim((x / 2, 4, 0), (0.0, 0.85, 1.0), x * 0.3)
    scene.render.filepath = os.path.join(out_dir, f"amenities-{tier}.png")
    bpy.ops.render.render(write_still=True, scene=scene.name)
    return scene


def standalone():
    sys.path.insert(0, HERE)
    import build_compound as kit

    kit.main()  # the full compound build; its hook calls build_all on the imported `amenities` module
    mod = sys.modules["amenities"]
    built = mod.LAST
    args = kit.ARGS
    if "--report" in args:
        mod.write_report(built, kit.TIER)
    if "--shots" in args:
        mod.render_shots(built, kit.TIER, kit.OUT)
    if "--blend" in args:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(kit.arg_value("--blend", "")))


if __name__ == "__main__":
    standalone()
