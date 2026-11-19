import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Texture, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  transcoderPath: "",
  detectSupport: [] as unknown[],
  ktx2Disposed: 0,
  meshopt: null as unknown,
  ktx2: null as unknown,
  urls: [] as string[],
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
  compoundModelUrl,
  disposeObject,
  loadCompound,
  loadLibrary,
  prepareCompound,
} from "./compoundModel";

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

afterEach(() => {
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
