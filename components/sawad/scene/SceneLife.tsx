import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AnimationMixer,
  Box3,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type SkinnedMesh,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { reportError } from "@/lib/monitoring";
import { MAX_FRAME_SECONDS } from "./flight";
import { birdPosition, planLife, type CarKind, type MovingCar, type ParkedCar, type Walker } from "./landscape";
import { birdSlots, birdWings, carPose, clipTimeScale, walkerPose, wheelAngle, wheelRadius } from "./lifeMotion";
import type { QualityTier } from "./types";

/** A loaded GLB: the scene graph and its clips (public/sawad/models/life-<tier>.glb). */
export type GltfLibrary = { scene: Group; animations: AnimationClip[] };

export type SceneLifeProps = { tier: QualityTier; library: GltfLibrary };

/** Names given by scripts/blender/life.py. */
export const LIFE_NODES = { rig: "person-rig", bird: "bird", paint: "life-paint", wheels: ["fl", "fr", "rl", "rr"] } as const;

type Figure = { id: string; root: Object3D; mixer: AnimationMixer; clip: AnimationClip; timeScale: number; offset: number; actor: Actor };

/** A person or a car, for drawing and shadow distances (see `showLife`). */
type Actor = { root: Object3D; kind: "person" | "car"; meshes: Mesh[]; casts: boolean; shadow: boolean; idle: number };

/**
 * How far away people and cars are still drawn, and still cast a shadow (metres). Beyond these
 * a person is a few pixels in the haze; each one is its own draw call (twice, with the shadow).
 */
export const LIFE_DISTANCE = {
  person: { draw: 220, shadow: 70 },
  car: { draw: 450, shadow: 110 },
} as const;

/** Everything SceneLife adds to the scene, and what it has to free again. */
export type LifeScene = {
  root: Group;
  /** Seconds since the life started. */
  clock: { t: number };
  figures: Figure[];
  /** Every person and car, with whether it may cast a shadow at all (high tier). */
  actors: Actor[];
  movers: Array<(t: number) => void>;
  /** Frees what SceneLife made (never the library's geometry or textures). */
  release: Array<() => void>;
};

const report = (error: Error, context: Record<string, unknown>) => reportError("sawad-life", error, context);

const UP = new Vector3(0, 1, 0);

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function castShadows(root: Object3D, on: boolean): void {
  for (const mesh of meshesOf(root)) mesh.castShadow = on;
}

// ---------------------------------------------------------------- people

function buildPeople(life: LifeScene, walkers: Walker[], library: GltfLibrary, shadows: boolean): void {
  const rig = library.scene.getObjectByName(LIFE_NODES.rig);
  if (!rig) {
    if (walkers.length) report(new Error(`"${LIFE_NODES.rig}" not in the life library; no people`), { walkers: walkers.length });
    return;
  }
  const clips = new Map(library.animations.map((a) => [a.name, a]));
  for (const walker of walkers) {
    const clip = clips.get(walker.clip);
    if (!clip || !rig.getObjectByName(walker.asset)) {
      report(new Error(`Missing ${clip ? `figure "${walker.asset}"` : `clip "${walker.clip}"`} for ${walker.id}`), { walker: walker.id, asset: walker.asset, clip: walker.clip });
      continue;
    }
    const figure = cloneSkinned(rig);
    figure.name = `person:${walker.id}`;
    // One figure per walker: drop the other outfits the shared rig carries.
    const others: Object3D[] = [];
    figure.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh && o.name !== walker.asset) others.push(o);
    });
    for (const o of others) o.removeFromParent();
    figure.scale.setScalar(walker.scale);
    castShadows(figure, shadows);
    const kept = meshesOf(figure) as SkinnedMesh[];
    life.root.add(figure);
    const actor = addActor(life, figure, "person", shadows);
    life.figures.push({
      actor,
      id: walker.id,
      root: figure,
      mixer: new AnimationMixer(figure),
      clip,
      timeScale: clipTimeScale(walker.clip, walker.speed, walker.scale),
      // People never step in unison: each starts at its own point of the loop.
      offset: (walker.phase * 0.37) % Math.max(clip.duration, 1e-3),
    });
    life.movers.push((t) => placeFigure(figure, walker, t));
    life.release.push(() => {
      for (const m of kept) m.skeleton?.dispose();
    });
  }
}

function placeFigure(figure: Object3D, walker: Walker, t: number): void {
  const p = walkerPose(walker, t);
  figure.position.set(p.x, p.y, p.z);
  figure.rotation.y = p.heading;
}

/** Starts every figure's clip. Safe to call again after stopLife (React may remount in development). */
export function startLife(life: LifeScene): void {
  for (const f of life.figures) {
    const action = f.mixer.clipAction(f.clip);
    action.timeScale = f.timeScale;
    action.time = f.offset;
    action.play();
  }
}

/** Stops the clips and frees what SceneLife made. The objects stay usable: startLife brings them back. */
export function stopLife(life: LifeScene): void {
  for (const f of life.figures) {
    f.mixer.stopAllAction();
    f.mixer.uncacheRoot(f.root);
  }
  for (const free of life.release) free();
}

function addActor(life: LifeScene, root: Object3D, kind: Actor["kind"], casts: boolean): Actor {
  const actor: Actor = { root, kind, meshes: meshesOf(root), casts, shadow: casts, idle: 0 };
  life.actors.push(actor);
  return actor;
}

// ---------------------------------------------------------------- cars

type CarTemplate = { object: Object3D; radius: number };

/** The wheel's radius, measured from its geometry in the car's own metres. */
function measureWheel(car: Object3D, wheel: Object3D): number {
  car.updateWorldMatrix(true, true);
  const toCar = new Matrix4().copy(car.matrixWorld).invert();
  const box = new Box3();
  const m = new Matrix4();
  for (const mesh of meshesOf(wheel)) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(toCar, mesh.matrixWorld)));
  }
  return box.isEmpty() ? 0 : wheelRadius(box.min.y, box.max.y);
}

function carTemplates(library: GltfLibrary, kinds: Set<CarKind>): Map<CarKind, CarTemplate> {
  const out = new Map<CarKind, CarTemplate>();
  for (const kind of kinds) {
    const object = library.scene.getObjectByName(kind);
    if (!object) {
      report(new Error(`"${kind}" not in the life library; those cars are left out`), { asset: kind });
      continue;
    }
    const front = object.getObjectByName(`${kind}-wheel-fl`);
    out.set(kind, { object, radius: front ? measureWheel(object, front) : 0 });
  }
  return out;
}

/** One painted copy of a car model. Paint is one material per colour, shared by every car in it. */
function paintedCar(template: Object3D, tint: string, paints: Map<string, Material>, release: LifeScene["release"]): Object3D {
  const car = template.clone(true);
  for (const mesh of meshesOf(car)) {
    const swap = (m: Material) => {
      if (m.name !== LIFE_NODES.paint) return m;
      let paint = paints.get(tint);
      if (!paint) {
        paint = m.clone();
        (paint as MeshStandardMaterial).color?.set(tint);
        paints.set(tint, paint);
        const made = paint;
        release.push(() => made.dispose());
      }
      return paint;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  }
  return car;
}

function buildCars(life: LifeScene, moving: MovingCar[], parked: ParkedCar[], library: GltfLibrary, shadows: boolean): void {
  const templates = carTemplates(library, new Set([...moving, ...parked].map((c) => c.asset)));
  const paints = new Map<string, Material>();
  const wheelsMissing = new Set<CarKind>();
  for (const spec of parked) {
    const template = templates.get(spec.asset);
    if (!template) continue;
    const car = paintedCar(template.object, spec.tint, paints, life.release);
    car.name = `car:${spec.id}`;
    car.position.set(spec.x, spec.y, spec.z);
    car.rotation.y = spec.rotation;
    castShadows(car, shadows);
    life.root.add(car);
    addActor(life, car, "car", shadows);
  }
  for (const spec of moving) {
    const template = templates.get(spec.asset);
    if (!template) continue;
    const car = paintedCar(template.object, spec.tint, paints, life.release);
    car.name = `car:${spec.id}`;
    castShadows(car, shadows);
    const wheels = LIFE_NODES.wheels.map((w) => car.getObjectByName(`${spec.asset}-wheel-${w}`)).filter((w): w is Object3D => !!w);
    if (wheels.length < LIFE_NODES.wheels.length && !wheelsMissing.has(spec.asset)) {
      wheelsMissing.add(spec.asset);
      report(new Error(`"${spec.asset}" has ${wheels.length} of 4 wheels; they will not turn`), { asset: spec.asset });
    }
    const spinning = wheels.length === LIFE_NODES.wheels.length ? wheels : [];
    life.root.add(car);
    addActor(life, car, "car", shadows);
    life.movers.push((t) => driveCar(car, spinning, spec, template.radius, t));
  }
}

function driveCar(car: Object3D, wheels: Object3D[], spec: MovingCar, radius: number, t: number): void {
  const p = carPose(spec, t);
  car.position.set(p.x, p.y, p.z);
  car.rotation.y = p.heading;
  const angle = wheelAngle(p.distance, radius);
  for (const w of wheels) w.rotation.x = angle;
}

// ---------------------------------------------------------------- birds

function buildBirds(life: LifeScene, tier: QualityTier, library: GltfLibrary): void {
  const slots = birdSlots(planLife(tier).flocks);
  if (!slots.length) return;
  const bird = library.scene.getObjectByName(LIFE_NODES.bird) as Mesh | undefined;
  if (!bird?.isMesh) {
    report(new Error(`"${LIFE_NODES.bird}" mesh not in the life library; no birds`), { birds: slots.length });
    return;
  }
  const flaps = (bird.geometry.morphAttributes.position?.length ?? 0) >= 2;
  if (!flaps) report(new Error("The bird has no wings-up / wings-down morph targets; birds glide without flapping"), { tier });
  // The bird's own node transform (meshopt dequantisation scale and offset) rides on every instance.
  library.scene.updateWorldMatrix(true, true);
  const local = new Matrix4().copy(library.scene.matrixWorld).invert().multiply(bird.matrixWorld);
  const flock = new InstancedMesh(bird.geometry, bird.material, slots.length);
  flock.name = "birds";
  flock.frustumCulled = false; // they fly the whole site; one bounding sphere would be stale at once
  life.root.add(flock);
  const wings = new Mesh();
  wings.morphTargetInfluences = [0, 0];
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const one = new Vector3(1, 1, 1);
  life.movers.push((t) => {
    slots.forEach((slot, i) => {
      const at = birdPosition(slot.flock, slot.index, t);
      flock.setMatrixAt(i, m.compose(p.set(at.x, at.y, at.z), q.setFromAxisAngle(UP, at.heading), one).multiply(local));
      if (flaps) {
        const [up, down] = birdWings(slot, t);
        wings.morphTargetInfluences![0] = up;
        wings.morphTargetInfluences![1] = down;
        flock.setMorphAt(i, wings);
      }
    });
    flock.instanceMatrix.needsUpdate = true;
    if (flock.morphTexture) flock.morphTexture.needsUpdate = true;
  });
  life.release.push(() => flock.dispose());
}

// ---------------------------------------------------------------- the whole life

/**
 * People, cars and birds for a tier, built from the loaded life library and placed at time 0.
 * Missing parts are reported as `sawad-life` and left out; the rest still moves.
 */
export function buildLife(tier: QualityTier, library: GltfLibrary): LifeScene {
  const root = new Group();
  root.name = "life";
  const life: LifeScene = { root, clock: { t: 0 }, figures: [], actors: [], movers: [], release: [] };
  const plan = planLife(tier);
  const shadows = tier === "high";
  buildPeople(life, plan.walkers, library, shadows);
  buildCars(life, plan.moving, plan.parked, library, shadows);
  buildBirds(life, tier, library);
  for (const move of life.movers) move(0);
  return life;
}

/**
 * Moves the life on by one frame (never more than MAX_FRAME_SECONDS, so a stalled tab resumes
 * calmly). A figure out of drawing range skips its skeleton and catches its clip up when it is back.
 */
export function advanceLife(life: LifeScene, deltaSeconds: number): void {
  const dt = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_SECONDS);
  life.clock.t += dt;
  for (const move of life.movers) move(life.clock.t);
  for (const f of life.figures) {
    if (!f.actor.root.visible) {
      f.actor.idle += dt;
      continue;
    }
    f.mixer.update(dt + f.actor.idle);
    f.actor.idle = 0;
  }
}

/** Draws people and cars only within their distances from the camera, and lets them cast shadows only closer still. */
export function showLife(life: LifeScene, camera: Vector3): void {
  for (const a of life.actors) {
    const d = a.root.position.distanceTo(camera);
    const limits = LIFE_DISTANCE[a.kind];
    a.root.visible = d < limits.draw;
    const shadow = a.casts && d < limits.shadow;
    if (shadow !== a.shadow) {
      a.shadow = shadow;
      for (const m of a.meshes) m.castShadow = shadow;
    }
  }
}

/**
 * The people on the promenade, the padel courts and the playground, the cars on the boulevards and
 * in the parking courts, and the birds over the stream and the olive slopes (Zaitun Hills, from
 * planLife). The library belongs to whoever loaded it; this frees only what it makes.
 */
export function SceneLife({ tier, library }: SceneLifeProps) {
  const life = useMemo(() => buildLife(tier, library), [tier, library]);
  useEffect(() => {
    startLife(life);
    return () => stopLife(life);
  }, [life]);
  useFrame(({ camera }, delta) => {
    showLife(life, camera.position);
    advanceLife(life, delta);
  });
  return <primitive object={life.root} />;
}
