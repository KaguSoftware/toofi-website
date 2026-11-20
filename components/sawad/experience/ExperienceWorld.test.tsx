// @vitest-environment jsdom
import { useEffect, useLayoutEffect, useMemo } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  type Object3D,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LightmapManifest } from "./lightmaps";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

// The baked light pages: each test decides what the fetch returns.
const lm = vi.hoisted(() => ({ manifest: vi.fn(), texture: vi.fn() }));
vi.mock("./lightmaps", async (importActual) => ({
  ...(await importActual<typeof import("./lightmaps")>()),
  loadLightmapManifest: () => lm.manifest(),
  loadLightmapTexture: (url: string) => lm.texture(url),
}));

// The scene world has its own tests. This stand-in builds just the parts the daylight drives,
// under the names world.ts gives them.
const world = vi.hoisted(() => ({ props: [] as unknown[], parts: null as null | Record<string, Object3D> }));
const color = (hex: string) => ({ value: new Color(hex) });
function worldParts(): Record<string, Object3D> {
  const box = new BoxGeometry();
  const sky = new Mesh(
    box,
    new ShaderMaterial({
      uniforms: {
        uSunColor: color("#fff2d0"),
        uZenith: color("#6f9bd8"),
        uHorizonAway: color("#c8d8e8"),
        uHorizonSun: color("#f0e0c0"),
        uGround: color("#a89880"),
        uSunDir: { value: new Vector3(0.5, 0.5, -0.7).normalize() },
        uSunDisc: { value: 1 },
      },
    }),
  );
  sky.name = "sky";
  const river = new Mesh(
    box,
    new ShaderMaterial({
      uniforms: {
        uSunColor: color("#fff2d0"),
        uHorizon: color("#c8d8e8"),
        uZenith: color("#6f9bd8"),
        uDeep: color("#203040"),
        uFogColor: color("#d0d8e0"),
        uSunDir: { value: new Vector3(0.5, 0.5, -0.7).normalize() },
        uFogDensity: { value: 0.001 },
      },
    }),
  );
  river.name = "river";
  const sun = new DirectionalLight("#ffffff", 3);
  sun.name = "sun";
  sun.castShadow = true;
  const terrain = new Mesh(box, new MeshStandardMaterial());
  terrain.name = "terrain";
  return { sky, river, sun, hemisphere: new HemisphereLight("#aaccff", "#886644", 1.2), terrain };
}
vi.mock("../scene/SceneWorld", () => ({
  SceneWorld: (props: unknown) => {
    world.props.push(props);
    const scene = useThree((s) => s.scene);
    const parts = useMemo(() => worldParts(), []);
    world.parts = parts;
    useLayoutEffect(() => {
      scene.background = new Color("#d0d8e0");
      scene.fog = new FogExp2(0xd0d8e0, 0.001);
      return () => {
        scene.background = null;
        scene.fog = null;
      };
    }, [scene]);
    return (
      <>
        {Object.entries(parts).map(([key, o]) => (
          <primitive key={key} object={o} />
        ))}
      </>
    );
  },
}));

import { DAYLIGHT_SECONDS, WINDOW_GLOW } from "./daylight";
import { ExperienceWorld, findWorldParts, type ExperienceWorldProps } from "./ExperienceWorld";
import { SHAFT_STRENGTH } from "./godrays";
import { initialRigState, type RigState } from "./types";

const manifest: LightmapManifest = {
  version: 1,
  states: { day: { intensity: 0 }, dusk: { intensity: 2 } },
  tiers: {
    high: { pages: { ground: { files: { day: "g-day-high.ktx2", dusk: "g-dusk-high.png" }, projection: { bounds: { minX: -500, maxX: 500, minZ: -400, maxZ: 400 } } } } },
    low: { pages: { ground: { files: { day: "g-day-low.ktx2", dusk: "g-dusk-low.png" }, projection: { bounds: { minX: -500, maxX: 500, minZ: -400, maxZ: 400 } } } } },
  },
};

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

/** A model with lit windows to switch on at dusk. */
function windowModel() {
  const glass = new MeshStandardMaterial({ name: "glass", emissive: "#000000", emissiveIntensity: 0 });
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(), glass));
  return { group, glass };
}

const DUSK_FRAMES = Math.ceil(DAYLIGHT_SECONDS / 0.1) + 1;

async function mount(props: Partial<ExperienceWorldProps> = {}) {
  const rig = { current: initialRigState() as RigState };
  const all = (p: Partial<ExperienceWorldProps>): ExperienceWorldProps => ({
    tier: "high",
    model: null,
    fallback: false,
    vegetation: null,
    plantingFallback: false,
    life: null,
    daylight: "day",
    godRays: false,
    rig,
    ...p,
  });
  const tree = (p: Partial<ExperienceWorldProps>) => (
    <>
      <Probe />
      <ExperienceWorld {...all(p)} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(tree(props));
  const parts = world.parts!;
  return {
    rig,
    gl: root.gl,
    scene: root.scene,
    sun: parts.sun as DirectionalLight,
    terrain: (parts.terrain as Mesh).material as MeshStandardMaterial,
    update: (next: Partial<ExperienceWorldProps>) => renderer.update(tree({ ...props, ...next })),
    unmount: () => renderer.unmount(),
    async frames(n: number, dt = 0.1) {
      for (let i = 0; i < n; i++) await renderer.advanceFrames(1, dt);
    },
  };
}
const settle = () => ReactThreeTestRenderer.act(async () => {});

beforeEach(() => {
  world.props.length = 0;
  reportError.mockReset();
  lm.manifest.mockReset().mockResolvedValue(manifest);
  lm.texture.mockReset().mockImplementation(async () => new Texture());
});
afterEach(() => vi.restoreAllMocks());

describe("findWorldParts", () => {
  it("finds the sky, water, sun, sky light and terrain by name, remembering the sun's shadows", () => {
    const scene = new Scene();
    const parts = worldParts();
    Object.values(parts).forEach((o) => scene.add(o));
    const found = findWorldParts(scene)!;
    expect(found.sky).toBe((parts.sky as Mesh).material);
    expect(found.water).toBe((parts.river as Mesh).material);
    expect(found.sun).toBe(parts.sun);
    expect(found.hemisphere).toBe(parts.hemisphere);
    expect(found.terrain).toBe(parts.terrain);
    expect(parts.sun.userData.castsShadow).toBe(true);
    // Remembered once: a sun already darkened by dusk keeps its day setting.
    (parts.sun as DirectionalLight).castShadow = false;
    findWorldParts(scene);
    expect(parts.sun.userData.castsShadow).toBe(true);
  });

  it("goes on without terrain, and finds nothing when a part the daylight needs is missing", () => {
    for (const missing of ["sky", "river", "sun", "hemisphere"]) {
      const scene = new Scene();
      const parts = worldParts();
      for (const [key, o] of Object.entries(parts)) if (key !== missing && key !== "terrain") scene.add(o);
      expect(findWorldParts(scene)).toBeNull();
      if (missing === "hemisphere") {
        scene.add(parts.hemisphere);
        expect(findWorldParts(scene)?.terrain).toBeNull();
      }
    }
  });
});

describe("ExperienceWorld", () => {
  it("hands the 28 ha world its model and libraries", async () => {
    const model = new Group();
    const lib = { scene: new Group(), animations: [] };
    const w = await mount({ tier: "low", model, fallback: true, vegetation: lib, plantingFallback: false, life: lib });
    expect(world.props.at(-1)).toEqual({ variant: "zaitun", tier: "low", model, fallback: true, vegetation: lib, plantingFallback: false, life: lib });
    await w.unmount();
  });

  it("leaves the day look exactly as the scene built it", async () => {
    const w = await mount();
    const exposure = w.gl.toneMappingExposure;
    await w.frames(20);
    expect(w.gl.toneMappingExposure).toBe(exposure);
    expect(w.sun.intensity).toBe(3);
    expect(w.terrain.userData.groundLight).toBeUndefined();
    expect(w.rig.current.dusk).toBe(0);
    expect(lm.manifest).not.toHaveBeenCalled();
    await w.unmount();
  });

  it("blends to dusk, switching on the windows and the baked ground light, and back to day", async () => {
    const { group, glass } = windowModel();
    const w = await mount({ model: group });
    const exposure = w.gl.toneMappingExposure;
    await w.update({ model: group, daylight: "dusk" });
    await settle();
    expect(lm.manifest).toHaveBeenCalledOnce();
    expect(lm.texture).toHaveBeenCalledExactlyOnceWith("/sawad/lightmaps/zaitun/g-dusk-high.png");
    await w.frames(5);
    expect(w.rig.current.dusk).toBeCloseTo(0.1, 9);
    expect(w.terrain.userData.groundLight).toBe(true); // patched for the baked light
    await w.frames(DUSK_FRAMES);
    expect(w.rig.current.dusk).toBe(1);
    expect(w.sun.intensity).toBe(0);
    expect(w.sun.castShadow).toBe(false);
    expect(w.gl.toneMappingExposure).not.toBe(exposure);
    expect(glass.emissiveIntensity).toBeCloseTo(WINDOW_GLOW.radiance, 9);

    await w.update({ model: group, daylight: "day" });
    await w.frames(DUSK_FRAMES);
    expect(w.rig.current.dusk).toBe(0);
    expect(w.sun.intensity).toBe(3);
    expect(w.sun.castShadow).toBe(true);
    expect(w.gl.toneMappingExposure).toBeCloseTo(exposure, 9);
    expect(glass.emissiveIntensity).toBe(0);
    expect(lm.manifest).toHaveBeenCalledOnce(); // fetched once per mount
    await w.unmount();
  });

  it("puts the day look back when it goes away at dusk", async () => {
    const w = await mount({ daylight: "dusk" });
    await settle();
    await w.frames(DUSK_FRAMES);
    expect(w.sun.intensity).toBe(0);
    const sun = w.sun;
    await w.unmount();
    expect(sun.intensity).toBe(3);
  });

  it("reports a lightmap that fails to load, and dusk still comes", async () => {
    const boom = new Error("lightmaps.json: HTTP 404");
    lm.manifest.mockRejectedValue(boom);
    const w = await mount({ tier: "low", daylight: "dusk" });
    await settle();
    expect(reportError).toHaveBeenCalledExactlyOnceWith("sawad-experience", boom, { stage: "lightmaps", tier: "low" });
    await w.frames(DUSK_FRAMES);
    expect(w.rig.current.dusk).toBe(1);
    await w.unmount();
  });

  it("frees a page that arrives after the world has gone", async () => {
    let arrive!: (t: Texture) => void;
    lm.texture.mockImplementation(() => new Promise<Texture>((res) => (arrive = res)));
    const w = await mount({ daylight: "dusk" });
    await settle();
    await w.unmount();
    const late = new Texture();
    const dispose = vi.spyOn(late, "dispose");
    arrive(late);
    await settle();
    expect(dispose).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("adds light shafts only when the quality allows, and fades them out at dusk", async () => {
    const w = await mount({ godRays: true });
    const shafts = w.scene.getObjectByName("god-rays") as Mesh<BoxGeometry, ShaderMaterial>;
    expect(shafts).toBeDefined();
    await w.frames(3, 0.05);
    expect(shafts.material.uniforms.uTime.value).toBeGreaterThan(0); // the shimmer moves
    expect(shafts.material.uniforms.uStrength.value).toBe(SHAFT_STRENGTH);
    await w.update({ godRays: true, daylight: "dusk" });
    await settle();
    await w.frames(DUSK_FRAMES);
    expect(shafts.visible).toBe(false);
    expect(shafts.material.uniforms.uStrength.value).toBe(0);
    await w.update({ godRays: false, daylight: "dusk" });
    expect(w.scene.getObjectByName("god-rays")).toBeUndefined();
    await w.unmount();

    const plain = await mount({ godRays: false });
    expect(plain.scene.getObjectByName("god-rays")).toBeUndefined();
    await plain.unmount();
  });
});
