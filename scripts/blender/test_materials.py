"""
Tests for the materials in build_compound.py: atlas layout and texel density, the tint and
noise maths, the procedural tiles, the dust colours and the glTF export of COLOR_0. Fast (a
few seconds) and needs no downloaded textures.

    blender -b --factory-startup --python-exit-code 1 -P scripts/blender/test_materials.py

Run by scripts/blender/materials.test.ts as part of `npm run test` when Blender is installed.
"""

import json
import os
import struct
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True  # importing build_compound must not leave __pycache__ behind
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

import build_compound as bc  # noqa: E402

HISTORIC = ["plaster_cream", "plaster_shade", "paving", "limestone", "hedge", "wall", "courtyard", "lattice", "stone", "slab", "timber", "mosaic"]


def seam_ratio(a):
    """Mean step across the wrap-around seam over the mean step between neighbours inside."""
    inner = np.abs(np.diff(a, axis=1)).mean()
    seam = np.abs(a[:, 0] - a[:, -1]).mean()
    return seam / max(inner, 1e-9)


class AtlasLayout(unittest.TestCase):
    def test_regions_fit_without_overlap_and_all_are_used(self):
        usage = bc.check_atlas_layout()
        self.assertLessEqual(usage, 1.0)
        used = {s["region"] for s in bc.SURFACES.values()}
        self.assertEqual(used, set(bc.REGIONS))

    def test_texel_density_is_consistent(self):
        for name, r in bc.REGIONS.items():
            d = bc.texel_density(name)
            if r["src"] in bc.ALPHA_SOURCES:
                self.assertGreaterEqual(d, 380, name)
            else:
                self.assertTrue(195 <= d <= 290, f"{name}: {d:.0f} px/m")

    def test_sources_show_at_real_scale(self):
        for name, r in bc.REGIONS.items():
            if r["src"].startswith("@"):
                continue
            scale = r["cell"] / (r["repeat"] * r["real"])
            # Only the courtyard setts are deliberately smaller (4/7 of the boulevard pavers).
            self.assertAlmostEqual(scale, 2 / 3.5 if name == "courtyard" else 1.0, places=3, msg=name)

    def test_historic_slots_keep_their_indices(self):
        self.assertEqual(bc.SURFACE_NAMES[: len(HISTORIC)], HISTORIC)
        self.assertEqual(bc.SLOTS[len(bc.SURFACE_NAMES) :], bc.SPECIAL)

    def test_amenity_surfaces_exist(self):
        for name in ("court", "court_line", "rubber", "fence", "net", "zellige", "mosque_floor", "jali"):
            self.assertIn(name, bc.SLOT)
        self.assertEqual(bc.MASKED, {"lattice", "jali", "fence", "net"})

    def test_world_palette_surfaces_use_world_ts_keys(self):
        for name, s in bc.SURFACES.items():
            self.assertIn(s["color"], bc.COLORS, name)
        self.assertFalse(set(bc.AMENITY_PALETTE) & set(bc.PALETTE))


class Maths(unittest.TestCase):
    def test_srgb_round_trip(self):
        c = np.linspace(0, 1, 11)
        np.testing.assert_allclose(bc.to_srgb(bc.to_linear(c)), c, atol=1e-9)

    def test_periodic_noise_is_normalised_and_tileable(self):
        f = bc.periodic_noise(64, 2, 12, 3)
        self.assertAlmostEqual(float(f.mean()), 0.0, places=6)
        self.assertAlmostEqual(float(f.std()), 1.0, places=6)
        self.assertLess(seam_ratio(f), 1.5)
        self.assertLess(seam_ratio(f.T), 1.5)

    def test_solve_tint_lands_on_the_palette(self):
        rng = np.random.default_rng(1)
        texels = np.clip(bc.srgb(bc.PALETTE["cream"]) * (1 + 0.05 * rng.standard_normal((32, 32, 1))), 0, 1)
        tint, mean = bc.solve_tint(texels, np.ones((32, 32)), bc.PALETTE["creamShade"])
        self.assertTrue((tint <= 1).all())
        np.testing.assert_allclose(mean * 255, bc.srgb(bc.PALETTE["creamShade"]) * 255, atol=1.0)

    def test_crevice_mask_is_local(self):
        n = 64
        x = np.arange(n) / n
        broad = np.tile(0.75 + 0.25 * np.sin(2 * np.pi * x), (n, 1))  # broad shading, no pores
        pores = broad.copy()
        pores[::8, ::8] = 0.3
        self.assertLess(bc.crevice_mask({"ao": broad}, broad).max(), 0.25)
        self.assertGreater(bc.crevice_mask({"ao": pores}, pores)[::8, ::8].mean(), 0.5)

    def test_instance_tint_is_stable_and_subtle(self):
        self.assertEqual(bc.instance_tint("villa-07"), bc.instance_tint("villa-07"))
        tints = np.array([bc.instance_tint(f"villa-{i:02d}") for i in range(200)])
        self.assertTrue((np.abs(tints - 1) < 0.07).all())
        self.assertGreater(float(np.abs(tints - 1).max()), 0.03)  # visible, not invisible
        self.assertAlmostEqual(float(tints.mean()), 1.0, delta=0.01)
        self.assertGreater(len({tuple(t) for t in tints.round(4)}), 190)


class Weathering(unittest.TestCase):
    def test_mask_is_sparse_tileable_and_off_when_unused(self):
        self.assertEqual(float(bc.weathering(64, 1, 0.0, 0.0).max()), 0.0)
        m = bc.weathering(128, 1, 0.6, 0.3)
        self.assertTrue(0 <= m.min() and m.max() <= 1)
        coverage = float((m > 0.1).mean())
        self.assertTrue(0.02 < coverage < 0.6, coverage)
        self.assertLess(seam_ratio(m), 2.0)
        self.assertLess(seam_ratio(m.T), 2.0)

    def test_streaks_run_vertically(self):
        m = bc.weathering(256, 3, 1.0, 0.0)
        down = np.abs(np.diff(m, axis=0)).mean()  # along v
        across = np.abs(np.diff(m, axis=1)).mean()
        self.assertLess(down, across)

    def test_ao_dirt_darkens_occluded_corners_of_the_atlas_only(self):
        me = bpy.data.meshes.new("ao-probe")
        me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (2, 0, 0), (3, 0, 0), (3, 1, 0), (2, 1, 0)], [], [(0, 1, 2, 3), (4, 5, 6, 7)])
        me.polygons[1].material_index = 2  # a special (glass)
        uv1 = me.uv_layers.new(name="UV1")
        for li, l in enumerate(me.loops):  # first face's first corner samples the dark half
            uv1.data[li].uv = (0.1, 0.5) if li in (0, 4) else (0.9, 0.5)
        colours = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
        for d in colours.data:
            d.color = (1, 1, 1, 1)
        img = bpy.data.images.new("ao-probe", 4, 4)
        px = np.ones((4, 4, 4), np.float32)
        px[:, :2, :3] = 0.2  # left half occluded
        img.pixels.foreach_set(px.ravel())
        bc.ao_dirt(me, img)
        c = [np.array(colours.data[i].color[:3]) for i in range(len(me.loops))]
        self.assertTrue((c[0] < 0.9).all(), "occluded atlas corner is dirty")
        np.testing.assert_allclose(c[1], 1.0)  # open corner stays clean
        np.testing.assert_allclose(c[4], 1.0)  # specials never get dirt
        bpy.data.meshes.remove(me)


class ProceduralTiles(unittest.TestCase):
    def test_every_generator_makes_a_seamless_tile(self):
        for src, make in bc.PROCEDURAL.items():
            t = make(64)
            self.assertEqual(t["color"].shape, (64, 64, 3), src)
            self.assertEqual(t["normal"].shape, (64, 64, 3), src)
            lum = t["color"].mean(-1)
            self.assertLess(seam_ratio(lum), 2.0, src)
            if src in bc.ALPHA_SOURCES:
                a = t["alpha"]
                self.assertTrue(0 < a.mean() < 1, f"{src} alpha has holes and bars")

    def test_procedural_region_tiles_hit_their_palette_colour(self):
        for name, r in bc.REGIONS.items():
            if not r["src"].startswith("@"):
                continue
            t = bc.region_tile(name, r, 64, {})
            mean = bc.weighted_mean(t["base"][..., :3], t["weights"])
            np.testing.assert_allclose(mean * 255, bc.srgb(bc.COLORS[r["color"]]) * 255, atol=2.0, err_msg=name)
            rough = t["orm"][..., 1]
            self.assertTrue(((rough >= 0.05) & (rough <= 1)).all(), name)


class SurfaceColours(unittest.TestCase):
    def test_dust_weight(self):
        g = bc.SURFACES["plaster_cream"]["grime"]
        self.assertAlmostEqual(bc.dust_weight("plaster_cream", 0.0, 0.0), g)
        self.assertAlmostEqual(bc.dust_weight("plaster_cream", 0.0, bc.GRIME_HEIGHT / 2), g * 0.5**bc.GRIME_CURVE)
        self.assertLess(bc.dust_weight("plaster_cream", 0.0, bc.GRIME_KNEE), g / 2)  # hugs the ground
        self.assertEqual(bc.dust_weight("plaster_cream", 0.0, bc.GRIME_HEIGHT + 1), 0.0)
        self.assertEqual(bc.dust_weight("limestone", 1.0, 7.6), bc.DUST_FILM)  # coping top
        self.assertEqual(bc.dust_weight("paving", 1.0, 0.06), 0.0)  # the ground keeps its texture
        self.assertEqual(bc.dust_weight("hedge", 1.0, 0.9), 0.0)
        self.assertEqual(bc.dust_weight("jali", 1.0, 3.0), 0.0)
        self.assertEqual(bc.dust_weight("plaster_cream", -1.0, 3.0), 0.0)  # soffits stay clean

    def test_finished_mesh_carries_tint_and_dust(self):
        bc.SLOT_TINT["plaster_shade"] = np.array([0.85, 0.8, 0.7])
        bm = bmesh.new()
        bc.add_box(bm, 3.0, 3.0, 3.0, 0, 0, 0, "plaster_shade")
        bc.add_box(bm, 1.0, 1.0, 0.05, 0, 1.5, 1.6, "glass")
        me = bc.finish_mesh("probe", bm, 0.0)
        colours = me.color_attributes["Color"]
        self.assertEqual((colours.data_type, colours.domain), ("FLOAT_COLOR", "CORNER"))
        heights = {round(me.vertices[l.vertex_index].co.z, 3) for l in me.loops}
        self.assertIn(round(bc.GRIME_HEIGHT, 3), heights)  # the dust's edge loops
        self.assertIn(round(bc.GRIME_KNEE, 3), heights)
        tint = bc.SLOT_TINT["plaster_shade"]
        glass = bc.SLOT["glass"]
        for poly in me.polygons:
            for li in poly.loop_indices:
                c = np.array(colours.data[li].color[:3])
                z = me.vertices[me.loops[li].vertex_index].co.z
                if poly.material_index == glass:
                    np.testing.assert_allclose(c, 1.0)
                elif abs(poly.normal.z) < 0.5 and z < 1e-3:
                    self.assertTrue((c < tint - 0.02).all(), "wall base is dusty")
                elif abs(poly.normal.z) < 0.5 and z >= bc.GRIME_HEIGHT - 1e-3:
                    np.testing.assert_allclose(c, tint, atol=1e-6)
        bpy.data.meshes.remove(me)

    def test_masked_surfaces_take_the_mask_material(self):
        bm = bmesh.new()
        bc.add_box(bm, 1, 1, 1, 0, 0, 0, "fence")
        bc.add_box(bm, 1, 1, 1, 3, 0, 0, "court")
        bc.add_box(bm, 1, 1, 1, 6, 0, 0, "brass")
        me = bc.finish_mesh("mask-probe", bm, -10.0)
        mats = [bpy.data.materials.new(f"mask-test-{n}") for n in ("atlas", "mask", *bc.SPECIAL)]
        bc.assign_final_materials(me, mats)
        by_x = {}
        for p in me.polygons:
            by_x.setdefault(round(p.center.x), set()).add(me.materials[p.material_index].name)
        self.assertEqual(by_x[0], {"mask-test-mask"})
        self.assertEqual(by_x[3], {"mask-test-atlas"})
        self.assertEqual(by_x[6], {"mask-test-brass"})
        bpy.data.meshes.remove(me)


class Export(unittest.TestCase):
    def test_gltf_keeps_the_base_texture_and_exports_color_0(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        atlas = {}
        for key in ("base", "orm", "normal"):
            img = bpy.data.images.new(f"atlas-{key}", 8, 8, alpha=True)
            img.pixels.foreach_set(np.full(8 * 8 * 4, 0.8, np.float32))
            img.pack()
            atlas[key] = img
        bm = bmesh.new()
        bc.add_box(bm, 3.0, 3.0, 3.0, 0, 0, 0, "plaster_cream")
        bc.add_box(bm, 1.0, 1.0, 0.05, 0, 1.5, 1.6, "glass")
        me = bc.finish_mesh("export-probe", bm, 0.0)
        mats = [bc.atlas_material("probe-atlas", atlas, None), bc.atlas_material("probe-mask", atlas, None, mask=True), *bc.shared_materials()]
        bc.assign_final_materials(me, mats)
        obj = bpy.data.objects.new("export-probe", me)
        bpy.context.scene.collection.objects.link(obj)

        bsdf = next(n for n in mats[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        source = lambda: bsdf.inputs["Base Color"].links[0].from_node.name  # noqa: E731
        self.assertEqual(source(), "surface-color")
        bc.use_instance_tint(mats, True)
        self.assertEqual(source(), "instance-tint")
        bc.use_instance_tint(mats, False)
        self.assertEqual(source(), "surface-color")

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "probe.glb")
            bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True, export_materials="EXPORT", export_image_format="AUTO", export_extras=False, export_animations=False)
            data = open(path, "rb").read()
        n = struct.unpack("<I", data[12:16])[0]
        gltf = json.loads(data[20 : 20 + n])
        materials = gltf["materials"]
        for prim in gltf["meshes"][0]["primitives"]:
            mat = materials[prim["material"]]
            if mat["name"] == "probe-atlas":
                self.assertIn("COLOR_0", prim["attributes"])
                self.assertIn("baseColorTexture", mat["pbrMetallicRoughness"])
            if mat["name"] == "glass":
                self.assertNotIn("baseColorTexture", mat["pbrMetallicRoughness"])


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        raise SystemExit(1)
