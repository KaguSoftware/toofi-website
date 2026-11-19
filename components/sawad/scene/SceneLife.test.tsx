import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  VectorKeyframeTrack,
  type Object3D,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

import { planLife, type CarKind } from "./landscape";
import { SceneLife, type GltfLibrary, type SceneLifeProps } from "./SceneLife";
import type { QualityTier } from "./types";

// ---------------------------------------------------------------- a small stand-in for life-<tier>.glb

const PEOPLE = [
  "person-boy",
  "person-boy-2",
  "person-girl",
  "person-man-jacket",
  "person-man-kurdish",
  "person-man-shirt",
  "person-man-sport",
  "person-woman-abaya",
  "person-woman-coat",
  "person-woman-skirt",
  "person-woman-sport",
];
const CARS: CarKind[] = ["car-sedan", "car-suv", "car-pickup"];
const WHEEL_RADIUS = 0.32;
const PAINT = "#eeeeee";

type Options = { people?: boolean; bird?: boolean; morphs?: boolean; cars?: CarKind[]; wheels?: boolean; clips?: string[] };

function skinnedBox(name: string, bones: Bone[]): SkinnedMesh {
  const geometry = new BoxGeometry(0.4, 1.7, 0.3);
  const n = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial({ name: "life-matte" }));
  mesh.name = name;
  mesh.bind(new Skeleton(bones));
  return mesh;
}

function makeLibrary({ people = true, bird = true, morphs = true, cars = CARS, wheels = true, clips = ["walk", "run", "idle", "sit", "swing", "flap"] }: Options = {}): GltfLibrary {
  const scene = new Group();
  if (people) {
    const rig = new Group();
    rig.name = "person-rig";
    const hips = new Bone();
    hips.name = "hips";
    hips.position.y = 0.95;
    const spine = new Bone();
    spine.name = "spine";
    hips.add(spine);
    rig.add(hips);
    for (const name of PEOPLE) rig.add(skinnedBox(name, [hips, spine]));
    scene.add(rig);
  }
  const paint = new MeshStandardMaterial({ name: "life-paint", color: PAINT });
  for (const kind of cars) {
    const car = new Group();
    car.name = kind;
    car.add(new Mesh(new BoxGeometry(1.8, 1.4, 4.4), [paint, new MeshStandardMaterial({ name: "life-glass" })]));
    if (wheels) {
      const tyre = new CylinderGeometry(1, 1, 0.6, 12).rotateZ(Math.PI / 2); // axle along x
      for (const w of ["fl", "fr", "rl", "rr"]) {
        const wheel = new Group();
        wheel.name = `${kind}-wheel-${w}`;
        wheel.position.set(w.endsWith("l") ? -0.79 : 0.79, WHEEL_RADIUS, w.startsWith("f") ? 1.4 : -1.4);
        wheel.scale.setScalar(WHEEL_RADIUS); // as meshopt dequantisation puts it on the node
        wheel.add(new Mesh(tyre, new MeshStandardMaterial({ name: "life-matte" })));
        car.add(wheel);
      }
    }
    scene.add(car);
  }
  if (bird) {
    const geometry = new BoxGeometry(0.66, 0.1, 0.3);
    if (morphs) {
      const pos = geometry.getAttribute("position");
      geometry.morphAttributes.position = [pos.clone(), pos.clone()];
    }
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ name: "life-matte" }));
    mesh.name = "bird";
    mesh.scale.setScalar(0.37);
    scene.add(mesh);
  }
  const animations = clips.map((name) => new AnimationClip(name, 1, [new VectorKeyframeTrack("hips.position", [0, 1], [0, 0.95, 0, 0, 1.05, 0])]));
  return { scene, animations };
}

// ---------------------------------------------------------------- mounting

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

async function mount(props: SceneLifeProps) {
  const renderer = await ReactThreeTestRenderer.create(
    <>
      <Probe />
      <SceneLife {...props} />
    </>,
  );
  return {
    life: root.scene.getObjectByName("life")!,
    unmount: () => renderer.unmount(),
    async frames(n: number, dt: number) {
      for (let i = 0; i < n; i++) await renderer.advanceFrames(1, dt);
    },
  };
}

const named = (life: Object3D, prefix: string) => life.children.filter((c) => c.name.startsWith(prefix));
const counts = (tier: QualityTier) => {
  const plan = planLife(tier);
  return { people: plan.walkers.length, cars: plan.moving.length + plan.parked.length, birds: plan.flocks.reduce((n, f) => n + f.count, 0) };
};

afterEach(() => reportError.mockClear());

describe("SceneLife", () => {
  it("puts every person, car and bird of the high tier in the scene, with shadows", async () => {
    const scene = await mount({ tier: "high", library: makeLibrary() });
    const want = counts("high");
    expect(named(scene.life, "person:")).toHaveLength(want.people);
    expect(named(scene.life, "car:")).toHaveLength(want.cars);
    const birds = scene.life.getObjectByName("birds") as InstancedMesh;
    expect(birds.count).toBe(want.birds);
    expect(reportError).not.toHaveBeenCalled();
    // One outfit per person, on its own copy of the skeleton.
    const walker = planLife("high").walkers[0];
    const person = scene.life.getObjectByName(`person:${walker.id}`)!;
    const outfits: SkinnedMesh[] = [];
    person.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) outfits.push(o as SkinnedMesh);
    });
    expect(outfits.map((o) => o.name)).toEqual([walker.asset]);
    expect(outfits[0].castShadow).toBe(true);
    expect(person.scale.x).toBeCloseTo(walker.scale);
    await scene.unmount();
  });

  it("draws the smaller low-tier cast, without shadows", async () => {
    const scene = await mount({ tier: "low", library: makeLibrary() });
    const want = counts("low");
    expect(want.people).toBeLessThan(counts("high").people);
    expect(named(scene.life, "person:")).toHaveLength(want.people);
    expect(named(scene.life, "car:")).toHaveLength(want.cars);
    expect((scene.life.getObjectByName("birds") as InstancedMesh).count).toBe(want.birds);
    let shadows = 0;
    scene.life.traverse((o) => {
      if ((o as Mesh).isMesh && o.castShadow) shadows++;
    });
    expect(shadows).toBe(0);
    await scene.unmount();
  });

  it("walks the people, drives the cars on turning wheels and flies the flapping birds", async () => {
    const scene = await mount({ tier: "high", library: makeLibrary() });
    const plan = planLife("high");
    const walker = plan.walkers.find((w) => w.speed > 0)!;
    const stander = plan.walkers.find((w) => w.speed === 0)!;
    const car = plan.moving[0];
    const person = scene.life.getObjectByName(`person:${walker.id}`)!;
    const still = scene.life.getObjectByName(`person:${stander.id}`)!;
    const vehicle = scene.life.getObjectByName(`car:${car.id}`)!;
    const hips = person.getObjectByName("hips")!;
    const birds = scene.life.getObjectByName("birds") as InstancedMesh;
    const before = { person: person.position.clone(), still: still.position.clone(), car: vehicle.position.clone(), hips: hips.position.y, bird: new Matrix4() };
    birds.getMatrixAt(0, before.bird);

    await scene.frames(10, 0.05);

    expect(person.position.distanceTo(before.person)).toBeCloseTo(walker.speed * 0.5, 1);
    expect(still.position.distanceTo(before.still)).toBe(0);
    expect(still.rotation.y).toBeCloseTo(stander.heading);
    expect(hips.position.y).not.toBeCloseTo(before.hips, 3); // the clip is playing
    expect(vehicle.position.distanceTo(before.car)).toBeCloseTo(car.speed * 0.5, 0);
    const wheel = vehicle.getObjectByName(`${car.asset}-wheel-fl`)!;
    const driven = (car.phase + 0.5) * car.speed;
    expect(wheel.rotation.x).toBeCloseTo(driven / WHEEL_RADIUS, 1);
    const after = new Matrix4();
    birds.getMatrixAt(0, after);
    expect(after.equals(before.bird)).toBe(false);
    expect(birds.morphTexture).not.toBeNull();
    await scene.unmount();
  });

  it("never jumps more than a tenth of a second after a stalled tab", async () => {
    const scene = await mount({ tier: "low", library: makeLibrary() });
    const car = planLife("low").moving[0];
    const vehicle = scene.life.getObjectByName(`car:${car.id}`)!;
    const start = vehicle.position.clone();
    await scene.frames(1, 30);
    expect(vehicle.position.distanceTo(start)).toBeLessThanOrEqual(car.speed * 0.1 + 1e-6);
    await scene.unmount();
  });

  it("paints each car its colour without touching the library, one paint per colour", async () => {
    const library = makeLibrary();
    const scene = await mount({ tier: "high", library });
    const plan = planLife("high");
    const paintOf = (id: string) => {
      const body = scene.life.getObjectByName(`car:${id}`)!.children.find((c) => (c as Mesh).isMesh) as Mesh;
      return (body.material as MeshStandardMaterial[])[0];
    };
    const all = [...plan.moving, ...plan.parked];
    for (const c of all.slice(0, 8)) expect(`#${paintOf(c.id).color.getHexString()}`).toBe(c.tint);
    const sameTint = all.filter((c) => c.tint === all[0].tint);
    if (sameTint.length > 1) expect(paintOf(sameTint[1].id)).toBe(paintOf(sameTint[0].id));
    const original = ((library.scene.getObjectByName("car-sedan")!.children[0] as Mesh).material as MeshStandardMaterial[])[0];
    expect(`#${original.color.getHexString()}`).toBe(PAINT);
    await scene.unmount();
  });

  it("reports missing parts as sawad-life and still shows the rest", async () => {
    const scene = await mount({ tier: "high", library: makeLibrary({ people: false, bird: false, cars: ["car-sedan"] }) });
    expect(reportError).toHaveBeenCalledWith("sawad-life", expect.any(Error), expect.any(Object));
    const messages = reportError.mock.calls.map((c) => (c[1] as Error).message).join(" | ");
    expect(messages).toMatch(/person-rig/);
    expect(messages).toMatch(/bird/);
    expect(messages).toMatch(/car-suv|car-pickup/);
    expect(named(scene.life, "person:")).toHaveLength(0);
    expect(scene.life.getObjectByName("birds")).toBeUndefined();
    const plan = planLife("high");
    const sedans = [...plan.moving, ...plan.parked].filter((c) => c.asset === "car-sedan").length;
    expect(named(scene.life, "car:")).toHaveLength(sedans);
    await scene.frames(3, 0.05); // and nothing throws while it runs
    await scene.unmount();
  });

  it("leaves out people whose clip is missing, keeps wheel-less cars still-wheeled, and birds gliding without morphs", async () => {
    const scene = await mount({ tier: "low", library: makeLibrary({ clips: ["walk"], wheels: false, morphs: false }) });
    const plan = planLife("low");
    const walking = plan.walkers.filter((w) => w.clip === "walk").length;
    expect(named(scene.life, "person:")).toHaveLength(walking);
    expect(reportError.mock.calls.some((c) => /wheels/.test((c[1] as Error).message))).toBe(true);
    expect(reportError.mock.calls.some((c) => /morph/.test((c[1] as Error).message))).toBe(true);
    await scene.frames(2, 0.05);
    expect((scene.life.getObjectByName("birds") as InstancedMesh).morphTexture).toBeNull();
    await scene.unmount();
  });

  it("frees what it made on unmount, never the library's geometry", async () => {
    const library = makeLibrary();
    const geometries: Array<ReturnType<typeof vi.spyOn>> = [];
    library.scene.traverse((o) => {
      if ((o as Mesh).isMesh) geometries.push(vi.spyOn((o as Mesh).geometry, "dispose"));
    });
    const scene = await mount({ tier: "low", library });
    const birds = scene.life.getObjectByName("birds") as InstancedMesh;
    const instances = vi.spyOn(birds, "dispose");
    const car = planLife("low").moving[0];
    const body = scene.life.getObjectByName(`car:${car.id}`)!.children.find((c) => (c as Mesh).isMesh) as Mesh;
    const paint = vi.spyOn((body.material as MeshStandardMaterial[])[0], "dispose");
    const person = named(scene.life, "person:")[0];
    let skinned: SkinnedMesh | undefined;
    person.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) skinned = o as SkinnedMesh;
    });
    const skeleton = vi.spyOn(skinned!.skeleton, "dispose");
    await scene.unmount();
    expect(instances).toHaveBeenCalled();
    expect(paint).toHaveBeenCalled();
    expect(skeleton).toHaveBeenCalled();
    for (const g of geometries) expect(g).not.toHaveBeenCalled();
    expect(root.scene.getObjectByName("life")).toBeUndefined();
  });
});
