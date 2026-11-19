"""
Tests for the 28 ha placement in build_compound.py (--plan zaitun): the polyline helpers behind
kerbs and walks, the terrain grid, the garden steps, the villa plots, and the in-place `site`
and `garden` assets checked against layout.json's masterplan. Fast (seconds), no textures.

    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/test_placement.py

Run by scripts/blender/placement.test.ts as part of `npm run test` when Blender is installed.
"""

import math
import os
import sys
import unittest

sys.dont_write_bytecode = True  # importing build_compound must not leave __pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402

import build_compound as bc  # noqa: E402

MP = bc.MP
GROUND = bc.TerrainGrid(MP["terrain"])


def faces_of(bm, slot):
    return [f for f in bm.faces if f.material_index == bc.SLOT[slot]]


def centre(f):
    c = f.calc_center_median()
    return c.x, c.y, c.z


class Polylines(unittest.TestCase):
    line = [(float(x), 1.0, 0.0) for x in range(0, 101, 10)]

    def test_arc_lengths_are_in_plan(self):
        sloped = [(0.0, 0.0, 0.0), (3.0, 5.0, 4.0)]
        self.assertEqual(bc.arc_lengths(sloped), [0.0, 5.0])

    def test_clip_cuts_exactly_and_keeps_inner_vertices(self):
        part = bc.clip(self.line, 15.0, 42.5)
        self.assertAlmostEqual(part[0][0], 15.0)
        self.assertAlmostEqual(part[-1][0], 42.5)
        self.assertEqual([p[0] for p in part[1:-1]], [20.0, 30.0, 40.0])
        self.assertEqual(bc.clip(self.line, 30.0, 30.01), [])

    def test_runs_outside_leaves_exact_gaps(self):
        runs = bc.runs_outside(self.line, lambda x, z: 40.3 <= x <= 47.1 or x >= 95)
        self.assertEqual(len(runs), 2)
        self.assertAlmostEqual(runs[0][0][0], 0.0)
        self.assertAlmostEqual(runs[0][-1][0], 40.3, places=3)
        self.assertAlmostEqual(runs[1][0][0], 47.1, places=3)
        self.assertAlmostEqual(runs[1][-1][0], 95.0, places=3)
        self.assertEqual(bc.runs_outside(self.line, lambda x, z: True), [])

    def test_offset_is_to_the_left_of_travel(self):
        self.assertAlmostEqual(bc.offset_line(self.line, 2.0)[3][2], 2.0)
        down = [(0.0, 0.0, 0.0), (0.0, 0.0, -10.0)]  # travelling -z: left is +x
        self.assertAlmostEqual(bc.offset_line(down, 2.0)[0][0], 2.0)

    def test_extend_runs_straight_on(self):
        e = bc.extend(self.line, 3.0, 4.0)
        self.assertAlmostEqual(e[0][0], -3.0)
        self.assertAlmostEqual(e[-1][0], 104.0)

    def test_ribbon_follows_a_sloping_line(self):
        bm = bmesh.new()
        slope = [(0.0, 0.0, 0.0), (0.0, 6.0, -50.0)]
        bc.ribbon3(bm, slope, 2.0, 0.2, -0.1, "paving")
        tops = sorted({round(v.co.y, 4) for v in bm.verts})
        self.assertEqual(tops, [-0.1, 0.2, 5.9, 6.2])
        self.assertTrue(all(f.normal.y > -0.5 for f in bm.faces if abs(f.normal.y) > 0.5))
        bm.free()


class Terrain(unittest.TestCase):
    def test_matches_the_grid_and_interpolates(self):
        t = MP["terrain"]
        x, z = t["minX"] + 10 * t["step"], t["minZ"] + 20 * t["step"]
        self.assertAlmostEqual(GROUND.y(x, z), t["heightsCm"][20][10] / 100)
        mid = GROUND.y(x + t["step"] / 2, z)
        self.assertAlmostEqual(mid, (t["heightsCm"][20][10] + t["heightsCm"][20][11]) / 200)

    def test_levels_under_the_homes(self):
        for v in MP["villas"]:
            self.assertAlmostEqual(GROUND.y(v["x"], v["z"]), v["y"], delta=0.05, msg=v["name"])


class Steps(unittest.TestCase):
    def test_flights_and_landings_fill_the_run(self):
        steps = next(m for m in MP["amenities"] if m["id"] == "garden-steps")
        f = steps["footprint"]
        prof, treads = bc.stair_profile(f["maxZ"], f["minZ"], steps["size"]["rise"])
        self.assertAlmostEqual(prof[-1][0], f["minZ"])
        self.assertAlmostEqual(prof[-1][1], steps["size"]["rise"])
        landings = [z0 - z1 for z0, z1, _ in treads if z0 - z1 > bc.STEP_TREAD + 1e-6]
        self.assertEqual(len(landings), 3)  # two between the flights, one level at the head
        self.assertAlmostEqual(landings[0], landings[1])
        self.assertGreaterEqual(min(landings), 1.5)
        # A comfortable stair: 2 risers + 1 tread in the 0.60-0.66 m step length.
        self.assertTrue(0.6 <= 2 * bc.STEP_RISE + bc.STEP_TREAD <= 0.66)

    def test_the_stair_never_dips_into_the_bank(self):
        """Against the graded slope itself (layout.ts planGrade on the garden axis: the valley
        floor rising to the terrace over gardenBay.run from gardenBay.headZ), not the 4 m grid,
        which rounds off the foot of the slope."""
        steps = next(m for m in MP["amenities"] if m["id"] == "garden-steps")
        bay, lv = MP["ground"]["gardenBay"], MP["levels"]
        bank = lambda z: lv["valley"] + (lv["terrace"] - lv["valley"]) * min(max((bay["headZ"] - z) / bay["run"], 0.0), 1.0)  # noqa: E731
        f = steps["footprint"]
        _, treads = bc.stair_profile(f["maxZ"], f["minZ"], steps["size"]["rise"])
        for z_front, z_back, y in treads:
            for z in (z_front - 0.01, (z_front + z_back) / 2, z_back + 0.01):
                self.assertGreaterEqual(steps["y"] + y, bank(z) - 1e-6, z)

    def test_the_film_terrain_is_carved_under_the_stair(self):
        steps = next(m for m in MP["amenities"] if m["id"] == "garden-steps")
        f = steps["footprint"]
        ground = bc.TerrainGrid(MP["terrain"])
        bc.carve_stair(ground, steps)
        _, treads = bc.stair_profile(f["maxZ"], f["minZ"], steps["size"]["rise"])
        for z_front, z_back, y in treads:
            for x in (f["minX"] + 0.5, 0.0, f["maxX"] - 0.5):
                self.assertLess(ground.y(x, (z_front + z_back) / 2), steps["y"] + y, (x, z_front))
        self.assertAlmostEqual(ground.y(40.0, -132.0), GROUND.y(40.0, -132.0))  # untouched beside it


class Plots(unittest.TestCase):
    def test_every_type_has_one_plot_shape_and_the_house_sits_inside_it(self):
        for kind in ("courtyard", "garden-4", "garden-3"):
            villas = [v for v in MP["villas"] if v["type"] == kind]
            hw, front, back = bc.local_plot(villas)
            v = villas[0]
            self.assertLessEqual(v["width"] / 2, hw, kind)
            self.assertLess(v["depth"] / 2, front, kind)
            self.assertLessEqual(back, -v["depth"] / 2, kind)

    def test_hedges_stay_inside_the_plot(self):
        a = bc.Asset("probe")
        bc.hedge(a, 20, 16, (11.0, 11.5, -13.95))
        bm = a.build()
        xs = [v.co.x for v in bm.verts]
        zs = [v.co.z for v in bm.verts]
        self.assertLessEqual(max(map(abs, xs)), 11.0 + 1e-6)
        self.assertGreaterEqual(min(zs), -13.95 - 1e-6)
        self.assertLessEqual(max(zs), 11.5 + 1e-6)
        bm.free()


class Site(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bm = bc.plan_site(GROUND).build()
        cls.bm.normal_update()

    @classmethod
    def tearDownClass(cls):
        cls.bm.free()

    def test_kerbs_drop_at_every_drive(self):
        kerb_tops = [centre(f) for f in faces_of(self.bm, "limestone") if f.normal.y > 0.9]
        for d in [v["driveway"] for v in MP["villas"]] + [p["driveway"] for p in MP["parking"]]:
            y = GROUND.y((d["minX"] + d["maxX"]) / 2, (d["minZ"] + d["maxZ"]) / 2)
            hits = [c for c in kerb_tops if bc.inside(d, c[0], c[2], -0.3, 0.6) and abs(c[1] - (y + bc.KERB_TOP)) < 0.02]
            self.assertEqual(hits, [], d)

    def test_wall_coping_follows_the_ground(self):
        t, h = MP["wall"]["thickness"], MP["wall"]["height"]
        tops = [centre(f) for f in faces_of(self.bm, "limestone") if f.normal.y > 0.5 and f.calc_area() > 0.2]
        near_gate = lambda x, z: any(abs(x - g["x"]) < 4 and abs(z - g["z"]) < 13 for g in MP["gates"])  # noqa: E731 (pavilion caps)
        coping = [c for c in tops if (abs(abs(c[0]) - MP["site"]["maxX"]) < t or abs(c[2] - MP["site"]["minZ"]) < t) and not near_gate(c[0], c[2])]
        self.assertGreater(len(coping), 100)
        for x, y, z in coping:
            self.assertAlmostEqual(y, GROUND.y(x, z) + h, delta=0.25, msg=(x, z))

    def test_streets_span_the_site_and_climb_to_the_terrace(self):
        paving = [centre(f) for f in faces_of(self.bm, "paving") if f.normal.y > 0.9]
        xs = [c[0] for c in paving]
        self.assertLess(min(xs), MP["site"]["minX"])  # boulevard A runs on past the gates
        self.assertGreater(max(xs), MP["site"]["maxX"])
        levels = MP["levels"]
        on_terrace = [c for c in paving if abs(c[1] - (levels["terrace"] + bc.ROAD_TOP)) < 0.05]
        self.assertGreater(len(on_terrace), 50)

    def test_belvedere_interrupts_the_terrace_sidewalk(self):
        bel = next(m for m in MP["amenities"] if m["kind"] == "belvedere")["footprint"]
        y = MP["levels"]["terrace"] + bc.SIDEWALK_TOP
        inside = [c for c in map(centre, faces_of(self.bm, "paving")) if bc.inside(bel, c[0], c[2]) and abs(c[1] - y) < 0.02]
        self.assertEqual(inside, [])

    def test_gate_lintels_span_the_openings(self):
        lintels = [centre(f) for f in faces_of(self.bm, "brass") if f.normal.y > 0.9]
        self.assertEqual(len(lintels), len(MP["gates"]))
        for gate in MP["gates"]:
            self.assertTrue(any(abs(x - gate["x"]) < 0.01 and abs(z - gate["z"]) < 0.01 for x, _, z in lintels))


class Garden(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bm = bc.plan_garden().build()
        cls.bm.normal_update()

    @classmethod
    def tearDownClass(cls):
        cls.bm.free()

    def test_pool_rim_and_mosaic_basin_at_the_pool(self):
        pool = next(m for m in MP["amenities"] if m["id"] == "pool")
        mosaic = [centre(f) for f in faces_of(self.bm, "mosaic")]
        self.assertTrue(mosaic)
        for x, _, z in mosaic:
            self.assertTrue(bc.inside(pool["footprint"], x, z), (x, z))

    def test_steps_climb_from_the_terrace_to_the_belvedere(self):
        steps = next(m for m in MP["amenities"] if m["id"] == "garden-steps")
        bel = next(m for m in MP["amenities"] if m["id"] == "belvedere")
        f = steps["footprint"]
        treads = [centre(t) for t in faces_of(self.bm, "limestone") if t.normal.y > 0.9]
        treads = [c for c in treads if abs(c[0]) < 3 and f["minZ"] < c[2] < f["maxZ"]]
        top = max(c[1] for c in treads)
        self.assertAlmostEqual(top, bel["y"], delta=0.02)
        self.assertAlmostEqual(min(c[1] for c in treads), steps["y"] + bc.STEP_RISE, delta=0.02)

    def test_terrace_paving_leaves_the_pool_open(self):
        pool = next(m for m in MP["amenities"] if m["id"] == "pool")["footprint"]
        y = MP["levels"]["valley"] + bc.TERRACE_TOP
        over_pool = [c for c in map(centre, faces_of(self.bm, "paving")) if bc.inside(pool, c[0], c[2], -0.1, -0.1) and abs(c[1] - y) < 0.01]
        self.assertEqual(over_pool, [])


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        raise SystemExit(1)
