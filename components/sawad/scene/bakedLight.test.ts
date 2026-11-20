import {
  BoxGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  ShaderChunk,
  ShaderLib,
  Vector3,
  type InstancedBufferAttribute,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  BAKED_LIGHT_BASE,
  DUSK_MIP_BIAS,
  applyBakedLight,
  bakeMaterial,
  bakedPageUrl,
  copyAt,
  copyNamed,
  createBakedLight,
  loadBakedManifest,
  loadBakedPages,
  mapsTail,
  setBakedDusk,
  setBakedMix,
  setBakedStrength,
  solveTiles,
  type BakedManifest,
  type CopyTransform,
} from "./bakedLight";

const tex = () => new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const pages = () => ({ buildings: tex(), site: tex() });

type Copy = BakedManifest["tiers"]["high"]["instances"][string];
const copy = (page: string, x: number, z: number, so: Copy["scaleOffset"]): Copy => ({ page, scaleOffset: so, position: [x, 1.2, z] });

function manifest(instances: Record<string, Copy>): BakedManifest {
  const files = (p: string, t: string) => ({ day: `day-${p}-${t}.png`, dusk: `dusk-${p}-${t}.png` });
  const tier = (t: string) => ({ pages: { buildings: { files: files("buildings", t) }, site: { files: files("site", t) } }, instances });
  return { version: 1, states: { day: { intensity: 3.86 }, dusk: { intensity: 7.49 } }, tiers: { high: tier("high"), low: tier("low") } };
}

describe("baked light files", () => {
  it("ships each page as KTX2 beside the PNG master the manifest lists", () => {
    const m = manifest({});
    expect(bakedPageUrl(m, "high", "buildings", "day")).toBe(`${BAKED_LIGHT_BASE}day-buildings-high.ktx2`);
    expect(bakedPageUrl(m, "low", "site", "dusk")).toBe(`${BAKED_LIGHT_BASE}dusk-site-low.ktx2`);
  });

  it("reads the manifest, and fails on a bad response", async () => {
    const m = manifest({});
    const ok = vi.fn(async () => new Response(JSON.stringify(m)));
    await expect(loadBakedManifest(ok as unknown as typeof fetch)).resolves.toEqual(m);
    expect(ok).toHaveBeenCalledWith(`${BAKED_LIGHT_BASE}lightmaps.json`);
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(loadBakedManifest(missing as unknown as typeof fetch)).rejects.toThrow("HTTP 404");
  });

  it("loads a state's two pages unflipped, on the second lightmap UV set", async () => {
    const loader = { loadAsync: vi.fn(async (url: string) => (void url, tex() as Texture)) };
    const p = await loadBakedPages(manifest({}), "high", "dusk", loader);
    expect(loader.loadAsync.mock.calls.map((c) => c[0])).toEqual([`${BAKED_LIGHT_BASE}dusk-buildings-high.ktx2`, `${BAKED_LIGHT_BASE}dusk-site-high.ktx2`]);
    for (const t of [p.buildings, p.site]) {
      expect(t.flipY).toBe(false);
      expect(t.channel).toBe(2);
    }
  });
});

describe("the light's controls", () => {
  it("blends to dusk only once the dusk pages are in", () => {
    const light = createBakedLight(manifest({}), "high", pages());
    setBakedMix(light, 0.7);
    expect(light.uniforms.buildings.uBakedMix.value).toBe(0);
    const dusk = pages();
    setBakedDusk(light, dusk);
    expect(light.uniforms.site.uBakedDusk.value).toBe(dusk.site);
    setBakedMix(light, 0.7);
    expect(light.uniforms.buildings.uBakedMix.value).toBeCloseTo(0.7);
    setBakedMix(light, 3);
    expect(light.uniforms.site.uBakedMix.value).toBe(1);
  });

  it("takes the intensities from the manifest", () => {
    const light = createBakedLight(manifest({}), "low", pages());
    expect(light.uniforms.buildings.uBakedDayIntensity.value).toBeCloseTo(3.86);
    expect(light.uniforms.site.uBakedDuskIntensity.value).toBeCloseTo(7.49);
    expect(light.uniforms.site.uBakedStrength.value).toBe(1);
  });

  it("fades the baked AO out as the lightmap takes over, and back in without it", () => {
    const light = createBakedLight(manifest({}), "high", pages());
    const source = new MeshStandardMaterial({ aoMapIntensity: 0.8 });
    const m = bakeMaterial(source, light.day.buildings, light.uniforms.buildings, "buildings");
    light.materials.buildings.push(m);
    setBakedStrength(light, 1);
    expect(m.aoMapIntensity).toBe(0);
    setBakedStrength(light, 0);
    expect(m.aoMapIntensity).toBeCloseTo(0.8);
    expect(light.uniforms.buildings.uBakedStrength.value).toBe(0);
    setBakedStrength(light, -1);
    expect(light.uniforms.site.uBakedStrength.value).toBe(0);
  });

  it("frees its pages and its lit materials", () => {
    const light = createBakedLight(manifest({}), "high", pages());
    setBakedDusk(light, pages());
    const m = new MeshStandardMaterial();
    light.materials.site.push(m);
    const spies = [light.day.buildings, light.day.site, light.dusk!.buildings, light.dusk!.site, m].map((o) => vi.spyOn(o, "dispose"));
    light.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});

describe("the lit material", () => {
  const compile = (m: MeshStandardMaterial) => {
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as WebGLRenderer);
    return shader;
  };

  it("keeps the reflection half of three's chunk and refuses a chunk it does not know", () => {
    expect(mapsTail()).toContain("getIBLRadiance");
    expect(ShaderChunk.lights_fragment_maps.endsWith(mapsTail())).toBe(true);
    expect(() => mapsTail("irradiance += 1.0;")).toThrow("changed");
  });

  it("is a named copy that reads its tile and both pages, and replaces the real-time diffuse", () => {
    const light = createBakedLight(manifest({}), "high", pages());
    const source = new MeshStandardMaterial({ name: "villa-courtyard-atlas", aoMapIntensity: 1 });
    const m = bakeMaterial(source, light.day.buildings, light.uniforms.buildings, "buildings");
    expect(m).not.toBe(source);
    expect(m.name).toBe("villa-courtyard-atlas");
    expect(m.lightMap).toBe(light.day.buildings);
    expect(m.userData.baked).toBe("buildings");
    expect(m.customProgramCacheKey()).toBe("baked-light:buildings");
    expect(source.lightMap).toBeNull();

    const shader = compile(m);
    expect(shader.uniforms.uBakedMix).toBe(light.uniforms.buildings.uBakedMix);
    expect(shader.vertexShader).toContain("attribute vec4 lightmapTile;");
    expect(shader.vertexShader).toContain("vLightMapUv = vLightMapUv * lightmapTile.xy + lightmapTile.zw;");
    expect(shader.fragmentShader).toContain("mix( bakedDay, bakedDusk, uBakedMix )");
    expect(shader.fragmentShader).toContain(`texture2D( uBakedDusk, vLightMapUv, ${DUSK_MIP_BIAS.toFixed(1)} )`);
    expect(shader.fragmentShader).toContain("reflectedLight.directDiffuse *= 1.0 - uBakedStrength;");
    // Plants and people are not in the bake: the sun they hold back comes off the baked light.
    expect(shader.fragmentShader).toContain("getShadow( directionalShadowMap[ 0 ]");
    expect(shader.fragmentShader).not.toContain("#include <lights_fragment_maps>");
    expect(shader.fragmentShader).toContain("getIBLRadiance");
  });
});

describe("finding each copy's tile", () => {
  const copies = [
    { ...copy("buildings", 0, 0, [0.1, 0.1, 0, 0]), name: "villa-00" },
    { ...copy("buildings", 30, 0, [0.1, 0.1, 0.1, 0]), name: "villa-01" },
    { ...copy("buildings", 60, 10, [0.1, 0.1, 0.2, 0]), name: "villa-02" },
    { ...copy("buildings", 200, 0, [0.05, 0.05, 0.5, 0.5]), name: "carport-00" },
  ];

  it("finds the copy standing at a point, within half a metre", () => {
    expect(copyAt(copies, 30.3, 0.2)?.name).toBe("villa-01");
    expect(copyAt(copies, 31, 0)).toBeNull();
  });

  it("finds a single copy by its node name, on the mesh or a parent", () => {
    const m = manifest({ gym: copy("buildings", -50, -55, [0.1, 0.1, 0.1, 0.4]), site: copy("site", 0, 0, [1, 1, 0, 0]) });
    const root = new Group();
    const gym = new Group();
    gym.name = "gym";
    const part = new Mesh();
    part.name = "amenity-gym_2";
    gym.add(part);
    const site = new Mesh();
    site.name = "site";
    root.add(gym, site);
    expect(copyNamed(m, "high", part, root)?.position[0]).toBe(-50);
    expect(copyNamed(m, "high", site, root)?.page).toBe("site");
    expect(copyNamed(m, "high", root, root)).toBeNull();
  });

  // The export folds the mesh's quantization offset into each copy's transform, turned with the copy.
  const transformsFor = (names: string[], offset: Vector3, turns: number[]): CopyTransform[] =>
    names.map((n, i) => {
      const c = copies.find((x) => x.name === n)!;
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turns[i]);
      const position = new Vector3(...c.position).add(offset.clone().applyQuaternion(rotation));
      return { position, rotation, scale: 14 };
    });

  it("solves the shared offset and gives every copy its own tile, in order", () => {
    const t = transformsFor(["villa-02", "villa-00", "villa-01"], new Vector3(3, 2.5, -6.5), [Math.PI, 0, Math.PI / 2]);
    const tiles = solveTiles(t, copies)!;
    expect(Array.from(tiles)).toEqual(
      [...copies[2].scaleOffset, ...copies[0].scaleOffset, ...copies[1].scaleOffset].map((v) => Math.fround(v)),
    );
  });

  it("gives up when no single offset fits every copy", () => {
    const t = transformsFor(["villa-00", "villa-01"], new Vector3(3, 0, -6), [0, 0]);
    t[1].position.x += 7;
    expect(solveTiles(t, copies)).toBeNull();
    expect(solveTiles([], copies)).toBeNull();
  });

  it("never gives two copies the same tile", () => {
    const one = transformsFor(["villa-00"], new Vector3(0, 0, 0), [0])[0];
    expect(solveTiles([one, { ...one }], copies)).toBeNull();
  });
});

describe("lighting a model", () => {
  const uv2 = (g: BoxGeometry) => {
    g.setAttribute("uv2", new Float32BufferAttribute(Array.from({ length: g.attributes.position.count * 2 }, (_, i) => (i % 2 ? 0.5 : 0.25)), 2));
    return g;
  };

  function model() {
    const root = new Group();
    const atlas = new MeshStandardMaterial({ name: "villa-garden-4-atlas" });
    const glass = new MeshStandardMaterial({ name: "glass" });
    const lattice = new MeshStandardMaterial({ name: "amenity-padel-lattice", alphaTest: 0.5 });

    // Two villas as instances, their transforms carrying the quantization offset.
    const villas = new InstancedMesh(uv2(new BoxGeometry(20, 7, 16)), [atlas, glass], 2);
    const offset = new Vector3(0, 3.5, 4);
    villas.setMatrixAt(0, new Matrix4().compose(new Vector3(0, 1.2, 0).add(offset), new Quaternion(), new Vector3(10, 10, 10)));
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    villas.setMatrixAt(1, new Matrix4().compose(new Vector3(30, 1.2, 0).add(offset.clone().applyQuaternion(turned)), turned, new Vector3(10, 10, 10)));

    // Single copies: the gym, two parking courts sharing one mesh, the site.
    const gym = new Mesh(uv2(new BoxGeometry(30, 9, 20)), atlas);
    gym.name = "gym";
    const shared = uv2(new BoxGeometry(10, 1, 10));
    const parkA = new Mesh(shared, atlas);
    parkA.name = "parking-1";
    const parkB = new Mesh(shared, atlas);
    parkB.name = "parking-2";
    const site = new Mesh(uv2(new BoxGeometry(100, 1, 100)), new MeshStandardMaterial({ name: "site-atlas" }));
    site.name = "site";

    // Not lit by the bake: a lamp with no lightmap UVs (sharing glass), a lattice, a copy the bake does not know.
    const lamp = new Mesh(new BoxGeometry(), glass);
    lamp.name = "lamp";
    const fence = new Mesh(uv2(new BoxGeometry()), lattice);
    fence.name = "gym-fence";
    const stray = new Mesh(uv2(new BoxGeometry()), atlas);
    stray.name = "unknown-thing";
    root.add(villas, gym, parkA, parkB, site, lamp, fence, stray);
    return { root, villas, gym, parkA, parkB, site, lamp, fence, stray, atlas, glass };
  }

  const instances = {
    "villa-00-garden-4": copy("buildings", 0, 0, [0.25, 0.25, 0, 0]),
    "villa-01-garden-4": copy("buildings", 30, 0, [0.25, 0.25, 0.25, 0]),
    gym: copy("buildings", -50, -55, [0.5, 0.5, 0.5, 0.5]),
    "parking-1": copy("buildings", 80, 0, [0.125, 0.125, 0, 0.75]),
    "parking-2": copy("buildings", 95, 0, [0.125, 0.125, 0.125, 0.75]),
    site: copy("site", 0, 0, [1, 1, 0, 0]),
  };

  it("gives instanced copies their tiles and single copies tiled UVs, with lit materials", () => {
    const m = model();
    const light = createBakedLight(manifest(instances), "high", pages());
    const count = applyBakedLight(m.root, light);
    expect(count).toBe(5); // villas, gym, both parking courts, site

    const tiles = m.villas.geometry.getAttribute("lightmapTile") as InstancedBufferAttribute;
    expect(Array.from(tiles.array)).toEqual([0.25, 0.25, 0, 0, 0.25, 0.25, 0.25, 0]);
    const [villaAtlas, villaGlass] = m.villas.material as MeshStandardMaterial[];
    expect(villaAtlas.userData.baked).toBe("buildings");
    expect(villaGlass.name).toBe("glass");
    expect(villaGlass.lightMap).toBe(light.day.buildings);

    // The gym's lightmap UVs now point into its tile: 0.25 * 0.5 + 0.5.
    expect(m.gym.geometry.getAttribute("uv2").getX(0)).toBeCloseTo(0.625);
    expect(m.gym.geometry.getAttribute("uv2").getY(0)).toBeCloseTo(0.75);
    // The parking courts shared a mesh: each now has its own, on its own tile.
    expect(m.parkA.geometry).not.toBe(m.parkB.geometry);
    expect(m.parkA.geometry.getAttribute("uv2").getX(0)).toBeCloseTo(0.25 * 0.125);
    expect(m.parkB.geometry.getAttribute("uv2").getX(0)).toBeCloseTo(0.25 * 0.125 + 0.125);
    // The site page is not tiled.
    expect(m.site.geometry.getAttribute("uv2").getX(0)).toBeCloseTo(0.25);
    expect((m.site.material as MeshStandardMaterial).lightMap).toBe(light.day.site);
    expect((m.site.material as MeshStandardMaterial).userData.baked).toBe("site");

    // One lit copy per source material and page.
    expect((m.gym.material as MeshStandardMaterial)).toBe(villaAtlas);
    expect(light.materials.buildings).toHaveLength(2);
    expect(light.materials.site).toHaveLength(1);

    // Left on real-time light.
    expect(m.lamp.material).toBe(m.glass);
    expect((m.fence.material as MeshStandardMaterial).lightMap).toBeNull();
    expect(m.stray.material).toBe(m.atlas);
  });

  it("tiles a model's UVs only once, however often it is lit", () => {
    const m = model();
    applyBakedLight(m.root, createBakedLight(manifest(instances), "high", pages()));
    applyBakedLight(m.root, createBakedLight(manifest(instances), "high", pages()));
    expect(m.gym.geometry.getAttribute("uv2").getX(0)).toBeCloseTo(0.625);
  });

  it("leaves instanced copies it cannot all place on real-time light", () => {
    const m = model();
    const { "villa-01-garden-4": _gone, ...partial } = instances;
    void _gone;
    applyBakedLight(m.root, createBakedLight(manifest(partial), "high", pages()));
    expect(m.villas.geometry.getAttribute("lightmapTile")).toBeUndefined();
    expect((m.villas.material as MeshStandardMaterial[])[0]).toBe(m.atlas);
  });
});
