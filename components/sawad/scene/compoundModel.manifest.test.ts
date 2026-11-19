import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { residencesIn, type ResidenceTypeId } from "@/lib/sawad/data";
import { PAD_Y, planAmenities, planApartmentBlocks, planLamps, planParking, planVilla, planVillas, villaPlot, type VillaType } from "./layout";
import { paletteHex } from "./world";

/**
 * The shipped model (scripts/blender/build.sh) must agree with layout.ts, stay on budget and
 * use the scene's palette. Rebuild the model when one of these fails after a layout change.
 */
const models = (f: string) => fileURLToPath(new URL(`../../../public/sawad/models/${f}`, import.meta.url));
type Manifest = {
  villas: Array<{ name: string; position: [number, number, number] }>;
  files: Record<string, number>;
  budgets: Record<string, number>;
  palette: Record<string, { key: string; palette: string; mean: string }>;
};
const manifest: Manifest = JSON.parse(readFileSync(models("compound.manifest.json"), "utf8"));

type Gltf = {
  extensionsUsed?: string[];
  meshes: Array<{ name?: string }>;
  nodes: Array<{ name?: string; mesh?: number; extensions?: Record<string, unknown> }>;
  materials: Array<{ name?: string; occlusionTexture?: { texCoord?: number }; alphaMode?: string }>;
  images?: Array<{ mimeType?: string }>;
};
/** The JSON chunk of a .glb (no decoding of buffers needed for these checks). */
function readGlb(file: string): Gltf {
  const buf = readFileSync(models(file));
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  const length = buf.readUInt32LE(12);
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  return JSON.parse(buf.subarray(20, 20 + length).toString("utf8"));
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("compound.manifest.json", () => {
  it("puts every villa-NN empty on its layout.ts plot (within 5 cm)", () => {
    expect(manifest.villas).toHaveLength(24);
    manifest.villas.forEach((v, i) => {
      expect(v.name).toBe(`villa-${String(i).padStart(2, "0")}`);
      const p = villaPlot(i);
      const [x, y, z] = v.position;
      expect(Math.hypot(x - p.x, y - PAD_Y, z - p.z)).toBeLessThan(0.05);
    });
  });

  it("matches the files on disk and keeps them within budget", () => {
    expect(manifest.budgets).toEqual({ "compound-high.glb": 5_000_000, "compound-low.glb": 2_000_000 });
    for (const [file, size] of Object.entries(manifest.files)) {
      expect(statSync(models(file)).size).toBe(size);
      expect(size).toBeLessThanOrEqual(manifest.budgets[file]);
    }
  });

  it("tints every trim-sheet region to the scene palette", () => {
    const palette = paletteHex();
    for (const region of Object.values(manifest.palette)) {
      expect(region.palette).toBe(palette[region.key as keyof typeof palette]);
      const [a, b] = [rgb(region.mean), rgb(region.palette)];
      a.forEach((c, i) => expect(Math.abs(c - b[i])).toBeLessThanOrEqual(2));
    }
    expect(Object.keys(manifest.palette)).toEqual(expect.arrayContaining(["plaster_cream", "plaster_shade", "paving", "limestone", "hedge", "mosaic", "lattice"]));
  });
});

describe.each(["compound-high.glb", "compound-low.glb"])("%s", (file) => {
  const gltf = readGlb(file);

  it("is meshopt-compressed with KTX2 textures and GPU-instanced villas and lamps", () => {
    expect(gltf.extensionsUsed).toEqual(expect.arrayContaining(["EXT_meshopt_compression", "EXT_mesh_gpu_instancing", "KHR_texture_basisu"]));
    const instanced = gltf.nodes.filter((n) => n.extensions?.EXT_mesh_gpu_instancing).map((n) => gltf.meshes[n.mesh!].name);
    expect(instanced).toEqual(expect.arrayContaining(["villa-courtyard", "villa-garden-4", "villa-garden-3", "lamp"]));
  });

  it("bakes AO on the second UV set for every trim-sheet material with an occlusion map", () => {
    const withAo = gltf.materials.filter((m) => m.occlusionTexture);
    expect(withAo.length).toBeGreaterThanOrEqual(5); // three villa types, apartment, site
    for (const m of withAo) expect(m.occlusionTexture!.texCoord).toBe(1);
  });

  it("ships mashrabiya screens and benches only on the high tier", () => {
    const names = gltf.meshes.map((m) => m.name ?? "");
    const extras = names.filter((n) => n.endsWith("-screens") || n === "bench");
    if (file === "compound-high.glb") expect(extras.length).toBeGreaterThanOrEqual(4);
    else expect(extras).toEqual([]);
  });
});

/**
 * The 28 ha Zaitun Hills model (build_compound.py --plan zaitun) against the masterplan in
 * layout.ts and the homes in lib/sawad/data.ts. The 7 ha files above stay for Bustan Dijla and
 * Shatt Gardens until they move onto the new layout.
 */
type ZaitunManifest = Omit<Manifest, "villas"> & {
  plan: string;
  villas: Array<{ name: string; type: VillaType; position: [number, number, number] }>;
  apartments: Array<{ name: string; position: [number, number, number] }>;
  amenities: string[];
  counts: Record<"high" | "low", Record<string, number>>;
  placedTriangles: Record<"high" | "low", number>;
};
const zaitun: ZaitunManifest = JSON.parse(readFileSync(models("compound-zaitun.manifest.json"), "utf8"));
const VILLA_TYPE: Partial<Record<ResidenceTypeId, VillaType>> = { cv5: "courtyard", gv4: "garden-4", gv3: "garden-3" };

describe("compound-zaitun.manifest.json", () => {
  it("puts every villa-NN empty on its masterplan plot (within 5 cm), terrace rows included", () => {
    expect(zaitun.plan).toBe("zaitun");
    expect(zaitun.villas).toHaveLength(planVillas().length);
    zaitun.villas.forEach((v, i) => {
      const p = planVilla(i);
      expect(v.name).toBe(`villa-${String(i).padStart(2, "0")}`);
      expect(v.type).toBe(p.type);
      const [x, y, z] = v.position;
      expect(Math.hypot(x - p.x, y - p.y, z - p.z)).toBeLessThan(0.05);
    });
    expect(new Set(zaitun.villas.map((v) => v.position[1]))).toEqual(new Set(planVillas().map((v) => v.y)));
  });

  it("models a plot of the right type for every Zaitun home, and a home for every modelled plot", () => {
    const homes = residencesIn("zaitun-hills");
    const villas = homes.filter((r) => r.kind === "villa");
    expect(villas.map((r) => r.slot).sort((a, b) => a - b)).toEqual(zaitun.villas.map((_, i) => i));
    for (const r of villas) expect(zaitun.villas[r.slot].type).toBe(VILLA_TYPE[r.type]);
    const apartments = homes.filter((r) => r.kind === "apartment");
    const blocks = new Set(apartments.map((r) => Math.floor(r.slot / 4)));
    expect([...blocks].sort()).toEqual(zaitun.apartments.map((_, i) => i));
    expect(apartments).toHaveLength(zaitun.apartments.length * 4);
  });

  it("places the apartment blocks, amenities, parking courts, carports and lamps of the masterplan", () => {
    planApartmentBlocks().forEach((b, i) => {
      expect(zaitun.apartments[i].name).toBe(`apartment-${i}`);
      const [x, y, z] = zaitun.apartments[i].position;
      expect(Math.hypot(x - b.x, y - b.y, z - b.backZ)).toBeLessThan(0.05);
    });
    const placedKinds = planAmenities().filter((m) => ["gym", "padel", "tennis", "playground", "mosque", "gallery"].includes(m.kind));
    expect(zaitun.amenities).toEqual(placedKinds.map((m) => m.id));
    for (const tier of ["high", "low"] as const) {
      expect(zaitun.counts[tier]).toMatchObject({ villas: 60, apartmentBlocks: 6, carports: 60, parkingCourts: planParking().length, lamps: planLamps().length });
    }
    expect(zaitun.counts.high.benches).toBeGreaterThan(0);
    expect(zaitun.counts.low.benches).toBe(0);
    expect(zaitun.placedTriangles.low).toBeLessThan(zaitun.placedTriangles.high);
  });

  it("matches the files on disk and keeps them within budget", () => {
    expect(Object.keys(zaitun.budgets)).toEqual(["compound-zaitun-high.glb", "compound-zaitun-low.glb"]);
    for (const [file, size] of Object.entries(zaitun.files)) {
      expect(statSync(models(file)).size).toBe(size);
      expect(size).toBeLessThanOrEqual(zaitun.budgets[file]);
    }
  });

  it("tints every trim-sheet region to the scene palette", () => {
    const palette = paletteHex();
    for (const region of Object.values(zaitun.palette)) {
      expect(region.palette).toBe(palette[region.key as keyof typeof palette]);
      const [a, b] = [rgb(region.mean), rgb(region.palette)];
      a.forEach((c, i) => expect(Math.abs(c - b[i])).toBeLessThanOrEqual(2));
    }
  });
});

describe.each(["compound-zaitun-high.glb", "compound-zaitun-low.glb"])("%s", (file) => {
  const gltf = readGlb(file);
  const names = gltf.meshes.map((m) => m.name ?? "");

  it("is meshopt-compressed with KTX2 textures and GPU-instanced homes, carports, courts and lamps", () => {
    expect(gltf.extensionsUsed).toEqual(expect.arrayContaining(["EXT_meshopt_compression", "EXT_mesh_gpu_instancing", "KHR_texture_basisu"]));
    const instanced = gltf.nodes.filter((n) => n.extensions?.EXT_mesh_gpu_instancing).map((n) => gltf.meshes[n.mesh!].name);
    expect(instanced).toEqual(expect.arrayContaining(["villa-courtyard", "villa-garden-4", "villa-garden-3", "apartment", "amenity-carport", "amenity-padel", "lamp"]));
  });

  it("carries the site, the garden axis and every amenity model", () => {
    expect(names).toEqual(expect.arrayContaining(["site", "garden", "amenity-gym", "amenity-padel", "amenity-tennis", "amenity-playground", "amenity-mosque", "amenity-carport", "amenity-parking"]));
    expect(names).not.toContain("terrain"); // the scene draws the ground itself
  });

  it("bakes AO on the second UV set for every trim-sheet material with an occlusion map", () => {
    const withAo = gltf.materials.filter((m) => m.occlusionTexture);
    expect(withAo.length).toBeGreaterThanOrEqual(12); // villas, apartment, site, garden, amenities
    for (const m of withAo) expect(m.occlusionTexture!.texCoord).toBe(1);
  });

  it("ships mashrabiya screens and benches only on the high tier", () => {
    const extras = names.filter((n) => n.endsWith("-screens") || n === "bench");
    if (file === "compound-zaitun-high.glb") expect(extras.length).toBeGreaterThanOrEqual(4);
    else expect(extras).toEqual([]);
  });
});
