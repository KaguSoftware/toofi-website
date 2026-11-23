import { BoxGeometry, Group, InstancedBufferAttribute, InstancedMesh, Mesh, MeshStandardMaterial, Texture, type WebGLRenderer } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  transcoderPath: "",
  detectSupport: [] as unknown[],
  ktx2Disposed: 0,
  meshopt: null as unknown,
  ktx2: null as unknown,
  urls: [] as string[],
  textures: [] as string[],
  result: null as null | (() => Promise<{ scene: Group; animations?: unknown[] }>),
  /** Per-URL results; any URL not listed gets `result`. */
  byUrl: {} as Record<string, () => Promise<{ scene: Group; animations?: unknown[] }>>,
}));
const reportError = vi.fn();

vi.mock("three/examples/jsm/loaders/KTX2Loader.js", () => ({
  KTX2Loader: class {
    setTranscoderPath(p: string) {
      calls.transcoderPath = p;
      return this;
    }
    detectSupport(r: unknown) {
      calls.detectSupport.push(r);
      return this;
    }
    dispose() {
      calls.ktx2Disposed++;
    }
    loadAsync(url: string) {
      calls.textures.push(url);
      return Promise.resolve(new Texture());
    }
  },
}));
const useWorkers = vi.hoisted(() => vi.fn());
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({ MeshoptDecoder: { name: "meshopt", useWorkers } }));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setKTX2Loader(k: unknown) {
      calls.ktx2 = k;
      return this;
    }
    setMeshoptDecoder(d: unknown) {
      calls.meshopt = d;
      return this;
    }
    loadAsync(url: string) {
      calls.urls.push(url);
      return (calls.byUrl[url] ?? calls.result!)();
    }
  },
}));
vi.mock("@/lib/monitoring", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import {
  BASIS_TRANSCODER_PATH,
  COMPOUND_MODEL_URL,
  COMPOUND_NAME,
  LIBRARY_URL,
  PLAN_COMPOUND_MODEL_URL,
  PLAN_FAR_MODEL_URL,
  bakedLightOf,
  compoundModelUrl,
  disposeObject,
  loadCompound,
  loadLibrary,
  prepareCompound,
  withKtx2,
  detailOf,
  dayPageOf,
  pairDetail,
  upgradeDayPage,
  upgradeToFull,
  HALF_DAY_PAGE,
} from "./compoundModel";
import { assetUrl } from "./assetUrl";
import { createBakedLight } from "./bakedLight";
import { BAKED_LIGHT_BASE, type BakedManifest } from "./bakedLight";

const renderer = { id: "renderer", info: { render: { frame: 0 } } } as unknown as WebGLRenderer;

function fakeModel() {
  const scene = new Group();
  const ao = new Texture();
  const wall = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ aoMap: ao }));
  const glass = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ transparent: true, opacity: 0.3 }));
  const villas = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 24);
  scene.add(wall, glass, villas);
  return { scene, wall, glass, villas, ao };
}

/** The bake's manifest: the model's wall stands where the "gym" copy was baked. */
const MANIFEST: BakedManifest = (() => {
  const files = (p: string, t: string) => ({ day: `day-${p}-${t}.png`, dusk: `dusk-${p}-${t}.png` });
  const tier = (t: string) => ({
    pages: { buildings: { files: files("buildings", t) }, site: { files: files("site", t) } },
    instances: { gym: { page: "buildings", scaleOffset: [0.5, 0.5, 0, 0] as [number, number, number, number], position: [0, 0, 0] as [number, number, number] } },
  });
  return { version: 1, states: { day: { intensity: 3.86 }, dusk: { intensity: 7.49 } }, tiers: { high: tier("high"), low: tier("low") } };
})();

function bakeableModel() {
  const m = fakeModel();
  m.wall.name = "gym";
  m.wall.geometry.setAttribute("uv2", m.wall.geometry.getAttribute("uv").clone());
  return m;
}

/** A load that never finishes (the full file of a far set, when a test is about the first frame). */
const pending = () => new Promise<never>(() => {});

beforeEach(() => {
  // Node has no animation frames: a far set loaded by loadCompound stays a far set in these tests.
  vi.stubGlobal("requestAnimationFrame", () => 0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.byUrl = {};
  calls.textures.length = 0;
  calls.urls.length = 0;
  calls.detectSupport.length = 0;
  calls.ktx2Disposed = 0;
  reportError.mockClear();
});

describe("loadCompound", () => {
  it("loads the tier's model with KTX2 and meshopt, casting shadows and reading AO from UV1", async () => {
    const m = fakeModel();
    calls.result = () => Promise.resolve({ scene: m.scene });
    const group = await loadCompound("high", renderer);
    expect(calls.urls).toEqual([COMPOUND_MODEL_URL.high]);
    expect(calls.transcoderPath).toBe(BASIS_TRANSCODER_PATH);
    expect(calls.detectSupport).toEqual([renderer]);
    expect(calls.meshopt).toMatchObject({ name: "meshopt" });
    // Geometry decodes in workers, started once for the whole app.
    expect(useWorkers).toHaveBeenCalledWith(2);
    expect(calls.ktx2).toBeTruthy();
    expect(calls.ktx2Disposed).toBe(1);
    expect(group).toBe(m.scene);
    expect(group.name).toBe(COMPOUND_NAME);
    expect(m.wall.castShadow && m.wall.receiveShadow).toBe(true);
    expect(m.villas.castShadow && m.villas.receiveShadow).toBe(true);
    // Transparent balustrade glass receives shadows but does not cast them.
    expect(m.glass.castShadow).toBe(false);
    expect(m.glass.receiveShadow).toBe(true);
    expect(m.ao.channel).toBe(1);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("starts the meshopt workers only once", async () => {
    calls.result = () => Promise.resolve({ scene: new Group() });
    await loadCompound("low", renderer);
    await loadLibrary("life", "low", renderer);
    expect(useWorkers).toHaveBeenCalledTimes(1);
  });

  it("loads the low tier file on the low tier", async () => {
    calls.result = () => Promise.resolve({ scene: new Group() });
    await loadCompound("low", renderer);
    expect(calls.urls).toEqual([assetUrl("/sawad/models/compound-low.glb")]);
    expect(COMPOUND_MODEL_URL.high).toBe(assetUrl("/sawad/models/compound-high.glb"));
  });

  it("reports and rejects when the model cannot load", async () => {
    const error = new Error("404 Not Found");
    calls.result = () => Promise.reject(error);
    await expect(loadCompound("low", renderer)).rejects.toBe(error);
    expect(reportError).toHaveBeenCalledWith("sawad-scene", error, expect.objectContaining({ tier: "low", url: COMPOUND_MODEL_URL.low }));
    expect(calls.ktx2Disposed).toBe(1);
  });
});

describe("compoundModelUrl", () => {
  it("gives Zaitun Hills its 28 ha model and keeps the 7 ha model for the other compounds", () => {
    expect(compoundModelUrl("zaitun", "high")).toBe(assetUrl("/sawad/models/compound-zaitun-high.glb"));
    expect(compoundModelUrl("zaitun", "low")).toBe(PLAN_COMPOUND_MODEL_URL.low);
    expect(compoundModelUrl("dijla", "high")).toBe(COMPOUND_MODEL_URL.high);
    expect(compoundModelUrl("shatt", "low")).toBe(COMPOUND_MODEL_URL.low);
  });

  it("loads the variant's model: Zaitun's far set for the first frame, its full file after it", async () => {
    const far = new Group();
    calls.byUrl[PLAN_FAR_MODEL_URL.low] = () => Promise.resolve({ scene: far });
    calls.byUrl[PLAN_COMPOUND_MODEL_URL.low] = pending;
    calls.result = () => Promise.resolve({ scene: new Group() });
    const group = await loadCompound("low", renderer, "zaitun");
    // The full file waits until the far set has been drawn.
    expect(calls.urls).toEqual([PLAN_FAR_MODEL_URL.low]);
    expect(group).toBe(far);
    expect(detailOf(group)?.state).toBe("far");
    // One KTX2 loader for the far set, the light and the full file, kept until the full file is in.
    expect(calls.detectSupport).toEqual([renderer]);
    expect(calls.ktx2Disposed).toBe(0);
    expect(PLAN_FAR_MODEL_URL.high).toBe(assetUrl("/sawad/models/compound-zaitun-far-high.glb"));
  });

  it("waits for the full file, as before, when the far set cannot load", async () => {
    const farError = new Error("404");
    const full = new Group();
    calls.byUrl[PLAN_FAR_MODEL_URL.high] = () => Promise.reject(farError);
    calls.byUrl[PLAN_COMPOUND_MODEL_URL.high] = () => Promise.resolve({ scene: full });
    calls.result = () => Promise.resolve({ scene: new Group() });
    const group = await loadCompound("high", renderer, "zaitun");
    expect(group).toBe(full);
    expect(group.name).toBe(COMPOUND_NAME);
    expect(detailOf(group)).toBeNull();
    expect(reportError).toHaveBeenCalledWith("sawad-scene", farError, expect.objectContaining({ stage: "compound-far", url: PLAN_FAR_MODEL_URL.high }));
    expect(calls.ktx2Disposed).toBe(1);
  });

  it("names the variant when the model fails", async () => {
    const error = new Error("404");
    calls.result = () => Promise.reject(error);
    await expect(loadCompound("high", renderer, "zaitun")).rejects.toBe(error);
    expect(reportError).toHaveBeenCalledWith("sawad-scene", error, expect.objectContaining({ stage: "compound-model", variant: "zaitun", url: PLAN_COMPOUND_MODEL_URL.high }));
    expect(calls.ktx2Disposed).toBe(1);
  });
});

describe("the baked light", () => {
  it("loads Zaitun's day pages beside the model, with the same KTX2 loader, and lights the model", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(MANIFEST)));
    vi.stubGlobal("fetch", fetcher);
    const m = bakeableModel();
    calls.byUrl[PLAN_COMPOUND_MODEL_URL.high] = pending;
    calls.result = () => Promise.resolve({ scene: m.scene });
    const group = await loadCompound("high", renderer, "zaitun");
    expect(fetcher).toHaveBeenCalledWith(assetUrl(`${BAKED_LIGHT_BASE}lightmaps.json`));
    // The high tier's first frame takes the buildings page at half size (ledger T36).
    expect(calls.textures).toEqual([assetUrl(`${BAKED_LIGHT_BASE}day-buildings-high.half.ktx2`), assetUrl(`${BAKED_LIGHT_BASE}day-site-high.ktx2`)]);
    expect(calls.ktx2Disposed).toBe(0); // still needed for the full file
    const light = bakedLightOf(group)!;
    expect(light.tier).toBe("high");
    expect((m.wall.material as MeshStandardMaterial).lightMap).toBe(light.day.buildings);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("shows the model on real-time light when the bake cannot load, and reports it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const m = bakeableModel();
    calls.byUrl[PLAN_COMPOUND_MODEL_URL.low] = pending;
    calls.result = () => Promise.resolve({ scene: m.scene });
    const group = await loadCompound("low", renderer, "zaitun");
    expect(group).toBe(m.scene);
    expect(bakedLightOf(group)).toBeNull();
    expect((m.wall.material as MeshStandardMaterial).lightMap).toBeNull();
    expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.any(Error), { stage: "baked-light", tier: "low" });
  });

  it("never asks for a bake for the 7 ha compounds", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    calls.result = () => Promise.resolve({ scene: new Group() });
    const group = await loadCompound("high", renderer, "dijla");
    expect(fetcher).not.toHaveBeenCalled();
    expect(bakedLightOf(group)).toBeNull();
    expect(bakedLightOf(null)).toBeNull();
  });

  it("frees the lightmaps with the model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(MANIFEST))));
    const m = bakeableModel();
    calls.byUrl[PLAN_COMPOUND_MODEL_URL.high] = pending;
    calls.result = () => Promise.resolve({ scene: m.scene });
    const group = await loadCompound("high", renderer, "zaitun");
    const light = bakedLightOf(group)!;
    const lightMap = vi.spyOn(light.day.buildings, "dispose");
    const whole = vi.spyOn(light, "dispose");
    disposeObject(group);
    expect(lightMap).toHaveBeenCalled();
    expect(whole).toHaveBeenCalledOnce();
  });

  it("ends the transcoder workers even when the work fails", async () => {
    await expect(withKtx2(renderer, () => Promise.reject(new Error("bad")))).rejects.toThrow("bad");
    expect(calls.ktx2Disposed).toBe(1);
  });
});

describe("loadLibrary", () => {
  it("loads the tier's plant or life library with its animation clips, untouched", async () => {
    const scene = new Group();
    const animations = [{ name: "walk" }];
    calls.result = () => Promise.resolve({ scene, animations });
    const lib = await loadLibrary("life", "high", renderer);
    expect(calls.urls).toEqual([LIBRARY_URL.life.high]);
    expect(lib.scene).toBe(scene);
    expect(lib.animations).toBe(animations);
    expect(scene.name).toBe(""); // not renamed or prepared like the compound
    expect(calls.ktx2Disposed).toBe(1);
    expect(LIBRARY_URL.vegetation.low).toBe(assetUrl("/sawad/models/vegetation-low.glb"));
  });

  it("reports which library failed and rejects", async () => {
    const error = new Error("broken");
    calls.result = () => Promise.reject(error);
    await expect(loadLibrary("vegetation", "low", renderer)).rejects.toBe(error);
    expect(reportError).toHaveBeenCalledWith("sawad-scene", error, { stage: "vegetation", tier: "low", url: LIBRARY_URL.vegetation.low });
  });
});

describe("prepareCompound / disposeObject", () => {
  it("frees every geometry, material and texture once", () => {
    const m = fakeModel();
    prepareCompound(m.scene);
    const geo = vi.spyOn(m.wall.geometry, "dispose");
    const mat = vi.spyOn(m.wall.material, "dispose");
    const tex = vi.spyOn(m.ao, "dispose");
    const inst = vi.spyOn(m.villas, "dispose");
    disposeObject(m.scene);
    expect(geo).toHaveBeenCalledOnce();
    expect(mat).toHaveBeenCalledOnce();
    expect(tex).toHaveBeenCalledOnce();
    expect(inst).toHaveBeenCalledOnce();
  });
});

// ------------------------------------------------------------------ the far set's full detail

/** One file's worth of compound: a single wall (named, textured), an instanced villa and a lamp. */
function compoundFile(label: string) {
  const scene = new Group();
  const map = new Texture();
  const ao = new Texture();
  map.name = `${label}-map`;
  ao.name = `${label}-ao`;
  const atlas = new MeshStandardMaterial({ map, aoMap: ao });
  atlas.name = "villa-atlas";
  const bronze = new MeshStandardMaterial({ metalness: 1 });
  bronze.name = "bronze";
  const wall = new Mesh(new BoxGeometry(2, 3, 4), atlas);
  wall.name = "gym";
  wall.geometry.setAttribute("uv2", wall.geometry.getAttribute("uv").clone());
  const villas = new InstancedMesh(new BoxGeometry(1, 1, 1), atlas, 3);
  villas.name = "villa";
  const lamp = new Mesh(new BoxGeometry(0.2, 3, 0.2), bronze);
  lamp.name = "lamp";
  scene.add(wall, villas, lamp);
  return { scene, map, ao, atlas, bronze, wall, villas, lamp };
}

/** Animation frames the test runs by hand. */
function frames() {
  const queue: Array<() => void> = [];
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, 0));
      queue.shift()?.();
    }
    await new Promise((r) => setTimeout(r, 0));
  };
  return { frame: (run: () => void) => void queue.push(run), tick, waiting: () => queue.length };
}

function setUp({ holdFrames = 2, shown = () => true }: { holdFrames?: number; shown?: () => boolean } = {}) {
  const far = compoundFile("far");
  const full = compoundFile("full");
  const tile = new InstancedBufferAttribute(new Float32Array(12), 4);
  far.villas.geometry.setAttribute("lightmapTile", tile);
  const f = frames();
  const renderer = { initTexture: vi.fn() };
  const redraw = vi.fn();
  const onSettled = vi.fn();
  let resolveFull!: (g: GLTF) => void;
  let rejectFull!: (e: Error) => void;
  const fullFile = new Promise<GLTF>((res, rej) => {
    resolveFull = res;
    rejectFull = rej;
  });
  const loadFull = vi.fn(() => fullFile);
  const detail = upgradeToFull(far.scene, loadFull, { renderer, tier: "high", frame: f.frame, redraw, shown, holdFrames, onSettled });
  far.scene.userData.detail = detail; // as loadCompound attaches it
  return { far, full, tile, f, renderer, redraw, onSettled, detail, loadFull, arrive: () => resolveFull({ scene: full.scene } as unknown as GLTF), fail: rejectFull };
}

describe("upgradeToFull", () => {
  it("keeps the far set through the hold, uploads the full textures a frame each, then swaps one mesh per frame", async () => {
    const t = setUp({ holdFrames: 3 });
    const farWallGeometry = t.far.wall.geometry;
    const freedGeometry = vi.spyOn(farWallGeometry, "dispose");
    const freedMap = vi.spyOn(t.far.map, "dispose");
    const freedFullMaterial = vi.spyOn(t.full.atlas, "dispose");
    const keptFullMap = vi.spyOn(t.full.map, "dispose");
    t.arrive();
    await t.f.tick(3); // the hold
    expect(t.renderer.initTexture).not.toHaveBeenCalled();
    await t.f.tick(2); // two textures, one per frame
    expect(t.renderer.initTexture.mock.calls.map(([x]) => x)).toEqual([t.full.map, t.full.ao]);
    expect(t.far.wall.geometry).toBe(farWallGeometry);
    await t.f.tick(1);
    expect(t.far.wall.geometry).toBe(t.full.wall.geometry); // the first mesh
    expect(t.far.villas.geometry).not.toBe(t.full.villas.geometry);
    await t.f.tick(2);
    await expect(t.detail.settled).resolves.toBe("full");
    expect(t.detail.state).toBe("full");
    // The far set's objects stay: same meshes, same materials, now with the full geometry and textures.
    expect(t.far.villas.geometry).toBe(t.full.villas.geometry);
    expect(t.far.atlas.map).toBe(t.full.map);
    expect(t.far.atlas.aoMap).toBe(t.full.ao);
    expect(t.far.wall.material).toBe(t.far.atlas);
    // The culling keeps writing to the attribute that is drawn.
    expect(t.far.villas.geometry.getAttribute("lightmapTile")).toBe(t.tile);
    expect(freedGeometry).toHaveBeenCalledOnce();
    expect(freedMap).toHaveBeenCalledOnce();
    expect(freedFullMaterial).toHaveBeenCalled();
    expect(keptFullMap).not.toHaveBeenCalled();
    expect(t.redraw).toHaveBeenCalled();
    expect(t.onSettled).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("fetches the full file only once the far set is on screen, and counts the hold from then", async () => {
    let drawn = false;
    const t = setUp({ holdFrames: 2, shown: () => drawn });
    await t.f.tick(5);
    expect(t.loadFull).not.toHaveBeenCalled();
    drawn = true;
    await t.f.tick(1);
    expect(t.loadFull).toHaveBeenCalledOnce();
    t.arrive();
    await t.f.tick(2); // the hold, from the first frame
    expect(t.renderer.initTexture).not.toHaveBeenCalled();
    await t.f.tick(1);
    expect(t.renderer.initTexture).toHaveBeenCalledOnce();
  });

  it("never fetches the full file for a far set freed before it was shown", async () => {
    const t = setUp({ shown: () => false });
    disposeObject(t.far.scene);
    await t.f.tick(2);
    await expect(t.detail.settled).resolves.toBe("cancelled");
    expect(t.loadFull).not.toHaveBeenCalled();
    expect(t.onSettled).toHaveBeenCalledOnce();
  });

  it("starts as soon as both the hold and the full file are done, whichever comes last", async () => {
    const t = setUp({ holdFrames: 1 });
    await t.f.tick(4);
    expect(t.renderer.initTexture).not.toHaveBeenCalled();
    expect(t.f.waiting()).toBe(0); // no frames asked for while it waits for the file
    t.arrive();
    await t.f.tick(1);
    expect(t.renderer.initTexture).toHaveBeenCalledOnce();
  });

  it("frees a full file that arrives after the far set was freed, and never swaps it in", async () => {
    const t = setUp();
    const farGeometry = t.far.wall.geometry;
    const fullGeometry = vi.spyOn(t.full.wall.geometry, "dispose");
    const fullMap = vi.spyOn(t.full.map, "dispose");
    disposeObject(t.far.scene);
    t.arrive();
    await t.f.tick(3);
    await expect(t.detail.settled).resolves.toBe("cancelled");
    expect(t.far.wall.geometry).toBe(farGeometry);
    expect(fullGeometry).toHaveBeenCalledOnce();
    expect(fullMap).toHaveBeenCalledOnce();
    expect(t.renderer.initTexture).not.toHaveBeenCalled();
    expect(t.onSettled).toHaveBeenCalledOnce();
  });

  it("frees everything when the far set is freed half way through the swap", async () => {
    const t = setUp({ holdFrames: 0 });
    const oldWall = vi.spyOn(t.far.wall.geometry, "dispose");
    const oldMap = vi.spyOn(t.far.map, "dispose");
    const lampGeometry = vi.spyOn(t.full.lamp.geometry, "dispose");
    t.arrive();
    await t.f.tick(3); // two uploads, then the wall
    expect(t.far.wall.geometry).toBe(t.full.wall.geometry);
    disposeObject(t.far.scene);
    await t.f.tick(1);
    await expect(t.detail.settled).resolves.toBe("cancelled");
    expect(oldWall).toHaveBeenCalledOnce(); // swapped out before the stop
    expect(oldMap).toHaveBeenCalledOnce();
    expect(lampGeometry).toHaveBeenCalledOnce(); // never swapped in
  });

  it("leaves the far set on screen and reports when the full file fails", async () => {
    const t = setUp();
    const error = new Error("network");
    t.fail(error);
    await t.f.tick(3);
    await expect(t.detail.settled).resolves.toBe("failed");
    expect(reportError).toHaveBeenCalledWith("sawad-scene", error, { stage: "compound-detail", tier: "high" });
    expect(t.far.atlas.map).toBe(t.far.map);
    expect(t.onSettled).toHaveBeenCalledOnce();
  });

  it("leaves the far set on screen and frees the full file when they do not match", async () => {
    const t = setUp({ holdFrames: 0 });
    t.full.lamp.geometry = new BoxGeometry(5, 5, 5); // other bounds: another quantization frame
    const fullGeometry = vi.spyOn(t.full.wall.geometry, "dispose");
    t.arrive();
    await t.f.tick(2);
    await expect(t.detail.settled).resolves.toBe("failed");
    expect(reportError).toHaveBeenCalledWith("sawad-scene", expect.objectContaining({ message: expect.stringContaining("bounds differ") }), { stage: "compound-detail", tier: "high" });
    expect(fullGeometry).toHaveBeenCalledOnce();
    expect(t.far.wall.geometry).not.toBe(t.full.wall.geometry);
  });

  it("moves a single copy's lightmap UVs onto its tile, as the bake did to the far geometry", async () => {
    const t = setUp({ holdFrames: 0 });
    t.far.scene.userData.bakedLight = createBakedLight(MANIFEST, "high", { buildings: new Texture(), site: new Texture() });
    t.far.wall.geometry.userData.bakedTile = true;
    const before = t.full.wall.geometry.getAttribute("uv2").getX(1);
    t.arrive();
    await t.f.tick(6);
    await expect(t.detail.settled).resolves.toBe("full");
    const uv2 = t.far.wall.geometry.getAttribute("uv2");
    expect(uv2.getX(1)).toBeCloseTo(before * 0.5); // the "gym" copy's scaleOffset [0.5, 0.5, 0, 0]
    expect(t.far.wall.geometry.userData.bakedTile).toBe(true);
  });
});

describe("upgradeToFull with copies sharing one geometry", () => {
  it("gives each single copy its own full geometry, tiled from the untouched original", async () => {
    const make = (label: string) => {
      const scene = new Group();
      const material = new MeshStandardMaterial({ map: new Texture() });
      material.name = "atlas";
      const geometry = new BoxGeometry(1, 1, 1);
      geometry.setAttribute("uv2", geometry.getAttribute("uv").clone());
      const a = new Mesh(geometry, material);
      const b = new Mesh(geometry, material);
      a.name = "gym";
      b.name = "pool";
      scene.add(a, b);
      scene.name = label;
      return { scene, a, b, geometry };
    };
    const far = make("far");
    const full = make("full");
    const manifest: BakedManifest = { ...MANIFEST, tiers: { ...MANIFEST.tiers, high: { ...MANIFEST.tiers.high, instances: { gym: MANIFEST.tiers.high.instances.gym, pool: { page: "buildings", scaleOffset: [0.25, 0.25, 0.5, 0.5], position: [9, 0, 9] } } } } };
    far.scene.userData.bakedLight = createBakedLight(manifest, "high", { buildings: new Texture(), site: new Texture() });
    far.a.geometry = far.geometry.clone();
    far.b.geometry = far.geometry.clone();
    far.a.geometry.userData.bakedTile = true;
    far.b.geometry.userData.bakedTile = true;
    const original = full.geometry.getAttribute("uv2").getX(1);
    const freedOriginal = vi.spyOn(full.geometry, "dispose");
    const f = frames();
    const detail = upgradeToFull(far.scene, () => Promise.resolve({ scene: full.scene } as unknown as GLTF), { renderer: { initTexture: vi.fn() }, tier: "high", frame: f.frame, redraw: vi.fn(), holdFrames: 0 });
    await f.tick(6);
    await expect(detail.settled).resolves.toBe("full");
    expect(far.a.geometry).not.toBe(far.b.geometry);
    expect(far.a.geometry.getAttribute("uv2").getX(1)).toBeCloseTo(original * 0.5);
    expect(far.b.geometry.getAttribute("uv2").getX(1)).toBeCloseTo(original * 0.25 + 0.5);
    expect(full.geometry.getAttribute("uv2").getX(1)).toBe(original); // untouched, then freed
    expect(freedOriginal).toHaveBeenCalled();
  });
});

describe("pairDetail", () => {
  it("pairs meshes in order and refuses files that do not match", () => {
    const pair = () => [compoundFile("far"), compoundFile("full")] as const;
    const [a, b] = pair();
    expect(pairDetail(a.scene, b.scene).map((p) => p.far.name)).toEqual(["gym", "villa", "lamp"]);

    const [c, d] = pair();
    d.scene.remove(d.lamp);
    expect(() => pairDetail(c.scene, d.scene)).toThrow("3 meshes");
    const [e, f] = pair();
    f.lamp.name = "post";
    expect(() => pairDetail(e.scene, f.scene)).toThrow("post");
    const [g, h] = pair();
    h.villas.count = 2;
    (h.villas as unknown as { instanceMatrix: { count: number } }).instanceMatrix = { count: 2 };
    expect(() => pairDetail(g.scene, h.scene)).toThrow("copies");
    const [i, j] = pair();
    j.bronze.name = "brass";
    expect(() => pairDetail(i.scene, j.scene)).toThrow("materials differ");
    const [k, l] = pair();
    l.atlas.aoMap = null;
    expect(() => pairDetail(k.scene, l.scene)).toThrow("aoMap");
  });
});

describe("the asset diet in the loader (F2B)", () => {
  it("drops the zero TEXCOORD_1 a mesh without an AO map keeps, and keeps it where an AO map reads it (T6)", () => {
    const m = fakeModel();
    const bare = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    bare.geometry.setAttribute("uv1", bare.geometry.getAttribute("uv").clone());
    m.wall.geometry.setAttribute("uv1", m.wall.geometry.getAttribute("uv").clone());
    m.scene.add(bare);
    prepareCompound(m.scene);
    expect(bare.geometry.getAttribute("uv1")).toBeUndefined();
    expect(m.wall.geometry.getAttribute("uv1")).toBeDefined();
  });

  it("composes every node's matrix once and stops three recomposing it each frame (T23)", () => {
    const m = fakeModel();
    m.wall.position.set(4, 0, 2);
    prepareCompound(m.scene);
    m.scene.traverse((o) => expect(o.matrixAutoUpdate).toBe(false));
    expect(m.wall.matrix.elements[12]).toBe(4);
    m.scene.updateMatrixWorld();
    expect(m.wall.matrixWorld.elements[14]).toBe(2);
  });

  it("keeps the finder on the far set: no full file, no swap (T30)", async () => {
    const far = new Group();
    calls.byUrl[PLAN_FAR_MODEL_URL.high] = () => Promise.resolve({ scene: far });
    calls.result = () => Promise.resolve({ scene: new Group() });
    const group = await loadCompound("high", renderer, "zaitun", "far");
    expect(group).toBe(far);
    expect(detailOf(group)).toBeNull();
    expect(calls.urls).toEqual([PLAN_FAR_MODEL_URL.high]);
  });

  it("takes the half page on the high tier only", async () => {
    expect(HALF_DAY_PAGE).toEqual({ high: true, low: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(MANIFEST))));
    calls.byUrl[PLAN_COMPOUND_MODEL_URL.low] = pending;
    calls.result = () => Promise.resolve({ scene: bakeableModel().scene });
    const group = await loadCompound("low", renderer, "zaitun");
    expect(calls.textures).toEqual([assetUrl(`${BAKED_LIGHT_BASE}day-buildings-low.ktx2`), assetUrl(`${BAKED_LIGHT_BASE}day-site-low.ktx2`)]);
    expect(dayPageOf(group)).toBeNull();
  });

  it("swaps the full buildings page in after the hold, on its own frames, and frees the half page (T36)", async () => {
    const half = new Texture();
    const full = new Texture();
    const light = createBakedLight(MANIFEST, "high", { buildings: half, site: new Texture() });
    const lit = new MeshStandardMaterial({ lightMap: half });
    light.materials.buildings.push(lit);
    const freed = vi.spyOn(half, "dispose");
    const queue: (() => void)[] = [];
    const step = async (n: number) => {
      for (let i = 0; i < n; i++) {
        queue.shift()?.();
        await Promise.resolve();
        await Promise.resolve();
      }
    };
    const initTexture = vi.fn();
    const redraw = vi.fn();
    const up = upgradeDayPage(light, () => Promise.resolve(full), { renderer: { initTexture } as unknown as WebGLRenderer, tier: "high", frame: (run) => queue.push(run), redraw, holdFrames: 3 });
    await step(3);
    expect(up.state).toBe("far");
    expect(lit.lightMap).toBe(half);
    await step(4);
    await up.settled;
    expect(initTexture).toHaveBeenCalledWith(full);
    expect(up.state).toBe("full");
    expect(lit.lightMap).toBe(full);
    expect(light.day.buildings).toBe(full);
    expect(light.uniforms.buildings.uBakedDusk.value).toBe(full);
    expect(freed).toHaveBeenCalled();
    expect(redraw).toHaveBeenCalled();
  });

  it("leaves the half page in place when the full page fails, and reports it", async () => {
    const half = new Texture();
    const light = createBakedLight(MANIFEST, "high", { buildings: half, site: new Texture() });
    const error = new Error("404");
    const up = upgradeDayPage(light, () => Promise.reject(error), { renderer: { initTexture: vi.fn() } as unknown as WebGLRenderer, tier: "high", frame: (run) => run(), holdFrames: 0 });
    expect(await up.settled).toBe("failed");
    expect(light.day.buildings).toBe(half);
    expect(reportError).toHaveBeenCalledWith("sawad-scene", error, { stage: "baked-light-full", tier: "high" });
  });

  it("never swaps once the model was freed", async () => {
    const half = new Texture();
    const full = new Texture();
    const freedFull = vi.spyOn(full, "dispose");
    const light = createBakedLight(MANIFEST, "high", { buildings: half, site: new Texture() });
    let resolve!: (t: Texture) => void;
    const up = upgradeDayPage(light, () => new Promise((r) => (resolve = r)), { renderer: { initTexture: vi.fn() } as unknown as WebGLRenderer, tier: "high", frame: (run) => run(), holdFrames: 0 });
    await Promise.resolve();
    up.cancel();
    resolve(full);
    expect(await up.settled).toBe("cancelled");
    expect(light.day.buildings).toBe(half);
    expect(freedFull).toHaveBeenCalled();
  });
});

