import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Texture, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  transcoderPath: "",
  detectSupport: [] as unknown[],
  ktx2Disposed: 0,
  meshopt: null as unknown,
  ktx2: null as unknown,
  urls: [] as string[],
  textures: [] as string[],
  result: null as null | (() => Promise<{ scene: Group; animations?: unknown[] }>),
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
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({ MeshoptDecoder: { name: "meshopt" } }));
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
      return calls.result!();
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
  bakedLightOf,
  compoundModelUrl,
  disposeObject,
  loadCompound,
  loadLibrary,
  prepareCompound,
  withKtx2,
} from "./compoundModel";
import { BAKED_LIGHT_BASE, type BakedManifest } from "./bakedLight";

const renderer = { id: "renderer" } as unknown as WebGLRenderer;

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

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(calls.meshopt).toEqual({ name: "meshopt" });
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

  it("loads the low tier file on the low tier", async () => {
    calls.result = () => Promise.resolve({ scene: new Group() });
    await loadCompound("low", renderer);
    expect(calls.urls).toEqual(["/sawad/models/compound-low.glb"]);
    expect(COMPOUND_MODEL_URL.high).toBe("/sawad/models/compound-high.glb");
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
    expect(compoundModelUrl("zaitun", "high")).toBe("/sawad/models/compound-zaitun-high.glb");
    expect(compoundModelUrl("zaitun", "low")).toBe(PLAN_COMPOUND_MODEL_URL.low);
    expect(compoundModelUrl("dijla", "high")).toBe(COMPOUND_MODEL_URL.high);
    expect(compoundModelUrl("shatt", "low")).toBe(COMPOUND_MODEL_URL.low);
  });

  it("loads the variant's model", async () => {
    calls.result = () => Promise.resolve({ scene: new Group() });
    await loadCompound("low", renderer, "zaitun");
    expect(calls.urls).toEqual([PLAN_COMPOUND_MODEL_URL.low]);
  });

  it("names the variant when the model fails", async () => {
    const error = new Error("404");
    calls.result = () => Promise.reject(error);
    await expect(loadCompound("high", renderer, "zaitun")).rejects.toBe(error);
    expect(reportError).toHaveBeenCalledWith("sawad-scene", error, expect.objectContaining({ variant: "zaitun", url: PLAN_COMPOUND_MODEL_URL.high }));
  });
});

describe("the baked light", () => {
  it("loads Zaitun's day pages beside the model, with the same KTX2 loader, and lights the model", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(MANIFEST)));
    vi.stubGlobal("fetch", fetcher);
    const m = bakeableModel();
    calls.result = () => Promise.resolve({ scene: m.scene });
    const group = await loadCompound("high", renderer, "zaitun");
    expect(fetcher).toHaveBeenCalledWith(`${BAKED_LIGHT_BASE}lightmaps.json`);
    expect(calls.textures).toEqual([`${BAKED_LIGHT_BASE}day-buildings-high.ktx2`, `${BAKED_LIGHT_BASE}day-site-high.ktx2`]);
    expect(calls.ktx2Disposed).toBe(1);
    const light = bakedLightOf(group)!;
    expect(light.tier).toBe("high");
    expect((m.wall.material as MeshStandardMaterial).lightMap).toBe(light.day.buildings);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("shows the model on real-time light when the bake cannot load, and reports it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const m = bakeableModel();
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
    expect(LIBRARY_URL.vegetation.low).toBe("/sawad/models/vegetation-low.glb");
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
