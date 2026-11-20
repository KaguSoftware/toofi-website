// @vitest-environment jsdom
import { createRef, useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import { Vector3, type PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeControls = { target: Vector3; enabled: boolean; update: () => void; dispose: () => void };
const controls = vi.hoisted(() => ({ instances: [] as FakeControls[] }));
vi.mock("three/examples/jsm/controls/OrbitControls.js", async () => {
  const { Vector3: V3 } = await import("three");
  class Fake {
    target = new V3();
    enabled = true;
    update = vi.fn();
    dispose = vi.fn();
    constructor() {
      controls.instances.push(this);
    }
  }
  return { OrbitControls: Fake };
});

import { TARGET_BOUNDS, clampTarget, markerPose } from "../scene/flight";
import { PLAN_CENTER } from "../scene/layout";
import { siteFor } from "../scene/site";
import type { SceneMarker, Vec3 } from "../scene/types";
import { viewpoints } from "../scene/viewpoints";
import { AMBIENT_IDLE_SECONDS, HEAD_MAX_SPEED, INTRO_HOLD_SECONDS, INTRO_SECONDS, scrollToPosition } from "./beats";
import { StoryRig, type StoryRigProps } from "./StoryRig";
import { storyPose } from "./storySheet";
import { initialRigState, type ExperienceApi, type ScrollState } from "./types";
import { EYE_HEIGHT, emptyInput } from "./walk";

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

type Props = Partial<StoryRigProps>;
async function mount(props: Props = {}) {
  const refs = { scroll: { current: { progress: 0 } as ScrollState }, input: { current: emptyInput() }, rig: { current: initialRigState() } };
  const all = (p: Props): StoryRigProps => ({ view: "flight", mode: "story", ...refs, ...p });
  const tree = (p: Props) => (
    <>
      <Probe />
      <StoryRig {...all(p)} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(tree(props), { width: 800, height: 450 });
  let current = props;
  return {
    ...refs,
    camera: root.camera as PerspectiveCamera,
    canvas: root.gl.domElement,
    update: (next: Props) => renderer.update(tree((current = { ...current, ...next }))),
    unmount: () => renderer.unmount(),
    async frames(n: number, dt = 0.1) {
      for (let i = 0; i < n; i++) await renderer.advanceFrames(1, dt);
    },
  };
}

const at = (v: readonly number[]) => new Vector3(v[0], v[1], v[2]);
const gap = (rig: { camera: PerspectiveCamera }, v: Vec3) => rig.camera.position.distanceTo(at(v));
const lastControls = () => controls.instances[controls.instances.length - 1];
const aboveGround = (p: Vector3) => p.y - siteFor("zaitun").ground(p.x, p.z);
const forward = (camera: PerspectiveCamera) => new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
/** Frames (0.1 s each) the opening holds on its poster frame before it moves. */
const HOLD_FRAMES = Math.round(INTRO_HOLD_SECONDS / 0.1);
const INTRO_FRAMES = HOLD_FRAMES + Math.ceil(INTRO_SECONDS / 0.1) + 2;
const markers: SceneMarker[] = [{ id: "ZH-V05", kind: "villa", slot: 4, status: "available", label: "ZH-V05" }];

afterEach(() => {
  controls.instances.length = 0;
  vi.restoreAllMocks();
});

describe("StoryRig in the story", () => {
  it("opens on the story's first frame and plays the opening by the clock, once", async () => {
    const onIntroEnd = vi.fn();
    const rig = await mount({ view: "aerial", onIntroEnd });
    const open = storyPose("aerial", 0);
    expect(rig.camera.position.toArray()).toEqual(open.position);
    expect(rig.camera.fov).toBe(open.fov);
    expect(controls.instances).toHaveLength(0);
    // It holds on the poster frame for two seconds, then moves.
    await rig.frames(HOLD_FRAMES);
    expect(rig.rig.current.head).toBe(0);
    expect(gap(rig, open.position)).toBeLessThan(1e-6);
    await rig.frames(10);
    expect(rig.rig.current.head).toBeCloseTo(1, 6);
    expect(onIntroEnd).not.toHaveBeenCalled();
    await rig.frames(INTRO_FRAMES);
    expect(rig.rig.current.head).toBe(INTRO_SECONDS);
    expect(onIntroEnd).toHaveBeenCalledOnce();
    expect(gap(rig, storyPose("aerial", INTRO_SECONDS).position)).toBeLessThan(1e-6);
    await rig.frames(5);
    expect(onIntroEnd).toHaveBeenCalledOnce();
    await rig.unmount();
  });

  it("holds the opening while paused, and never jumps a stalled frame", async () => {
    const rig = await mount({ playing: false });
    await rig.frames(20);
    expect(rig.rig.current.head).toBe(0);
    expect(gap(rig, storyPose("flight", 0).position)).toBeLessThan(1e-6);
    await rig.update({ playing: true });
    // Paused time does not count toward the opening's hold.
    await rig.frames(HOLD_FRAMES);
    expect(rig.rig.current.head).toBe(0);
    await rig.frames(1, 60); // a minute-long stall counts as a tenth of a second
    expect(rig.rig.current.head).toBeCloseTo(0.1, 9);
    await rig.unmount();
  });

  it("skips the opening's hold when the visitor scrolls", async () => {
    const rig = await mount();
    await rig.frames(3);
    expect(rig.rig.current.head).toBe(0);
    rig.scroll.current.progress = 0.2;
    await rig.frames(1);
    expect(rig.rig.current.head).toBeGreaterThan(0);
    await rig.unmount();
  });

  it("holds a capture at its position", async () => {
    const rig = await mount({ holdAt: 30 });
    expect(rig.camera.position.toArray()).toEqual(storyPose("flight", 30).position);
    await rig.frames(AMBIENT_IDLE_SECONDS * 10 + 20);
    expect(rig.rig.current.head).toBe(30);
    expect(gap(rig, storyPose("flight", 30).position)).toBeLessThan(1e-6);
    await rig.unmount();
  });

  it("follows the scroll as a glide, never a jump, and settles on the beat", async () => {
    const rig = await mount();
    await rig.frames(INTRO_FRAMES);
    rig.scroll.current.progress = 0.4;
    const goal = scrollToPosition(0.4);
    await rig.frames(1);
    expect(rig.rig.current.head).toBeCloseTo(INTRO_SECONDS + HEAD_MAX_SPEED * 0.1, 6);
    expect(gap(rig, storyPose("flight", goal).position)).toBeGreaterThan(10);
    await rig.frames(120);
    expect(rig.rig.current.head).toBe(goal);
    expect(gap(rig, storyPose("flight", goal).position)).toBeLessThan(1e-6);
    // The lens and the surroundings are written for the effects and the sound.
    const pose = storyPose("flight", goal);
    expect(rig.rig.current).toMatchObject({ focus: pose.focus, blur: pose.blur });
    for (const k of ["water", "open"] as const) {
      expect(rig.rig.current[k]).toBeGreaterThanOrEqual(0);
      expect(rig.rig.current[k]).toBeLessThanOrEqual(1);
    }
    await rig.unmount();
  });

  it("keeps up with a fast scroll, so the camera stays with the captions", async () => {
    const rig = await mount();
    await rig.frames(INTRO_FRAMES);
    // The whole tour in one flick: the camera is there within a second.
    rig.scroll.current.progress = 1;
    await rig.frames(10);
    expect(rig.rig.current.head).toBeGreaterThan(scrollToPosition(1) - 1);
    // And all the way back up just as quickly.
    rig.scroll.current.progress = 0;
    await rig.frames(10);
    expect(rig.rig.current.head).toBeLessThan(INTRO_SECONDS + 1);
    await rig.unmount();
  });

  it("arrives back at the gate before the slow circuit may start", async () => {
    const rig = await mount();
    await rig.frames(INTRO_FRAMES);
    rig.scroll.current.progress = 1;
    await rig.frames(20);
    rig.scroll.current.progress = 0;
    // Back at the top, the camera settles on the gate shot and waits there.
    await rig.frames(AMBIENT_IDLE_SECONDS * 10 - 5);
    expect(rig.rig.current.head).toBe(INTRO_SECONDS);
    expect(gap(rig, storyPose("flight", INTRO_SECONDS).position)).toBeLessThan(1e-6);
    await rig.unmount();
  });

  it("drifts into the slow circuit when left alone at the top, and comes back on a scroll", async () => {
    const rig = await mount();
    await rig.frames(INTRO_FRAMES);
    const gate = storyPose("flight", INTRO_SECONDS).position;
    await rig.frames(AMBIENT_IDLE_SECONDS * 10 - 5);
    expect(gap(rig, gate)).toBeLessThan(1e-6); // not idle long enough yet
    await rig.frames(120);
    expect(gap(rig, gate)).toBeGreaterThan(20);
    expect(rig.rig.current.focus).toBeGreaterThan(storyPose("flight", INTRO_SECONDS).focus);
    rig.scroll.current.progress = 0.2;
    await rig.frames(200);
    expect(gap(rig, storyPose("flight", scrollToPosition(0.2)).position)).toBeLessThan(1e-6);
    await rig.unmount();
  });

  it("reports a failure once and then stands still", async () => {
    const onError = vi.fn();
    const boom = new Error("sheet failed");
    const rig = await mount({ onError });
    Object.defineProperty(rig.scroll, "current", {
      get() {
        throw boom;
      },
    });
    const before = rig.camera.position.clone();
    await rig.frames(5);
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    expect(rig.camera.position.distanceTo(before)).toBe(0);
    await rig.unmount();
  });

  it("survives a failure without an error handler", async () => {
    const rig = await mount();
    Object.defineProperty(rig.scroll, "current", {
      get() {
        throw new Error("sheet failed");
      },
    });
    await expect(rig.frames(2)).resolves.toBeUndefined();
    await rig.unmount();
  });
});

describe("StoryRig exploring", () => {
  it("orbits about what the story camera looked at, without moving it", async () => {
    const rig = await mount();
    await rig.frames(INTRO_FRAMES);
    const before = rig.camera.position.clone();
    const look = clampTarget(forward(rig.camera).multiplyScalar(60).add(before));
    await rig.update({ mode: "orbit" });
    expect(controls.instances).toHaveLength(1);
    expect(lastControls().target.distanceTo(look)).toBeLessThan(1e-6);
    await rig.frames(3);
    expect(lastControls().update).toHaveBeenCalled();
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(1e-6);
    expect(rig.rig.current.focus).toBeCloseTo(before.distanceTo(lastControls().target), 6);
    // Dragged off the site, the target is pulled back in.
    lastControls().target.set(9000, -50, 0);
    await rig.frames(1);
    expect(lastControls().target.x).toBe(TARGET_BOUNDS.maxX);
    expect(lastControls().target.y).toBe(TARGET_BOUNDS.minY);
    await rig.unmount();
    expect(lastControls().dispose).toHaveBeenCalled();
  });

  it("opens on the aerial about the plan's centre for a visitor who explores without the story", async () => {
    const rig = await mount({ mode: "orbit" });
    expect(rig.camera.position.toArray()).toEqual(viewpoints("zaitun").aerial.position);
    expect(lastControls().target.toArray()).toEqual([PLAN_CENTER.x, PLAN_CENTER.y, PLAN_CENTER.z]);
    await rig.unmount();
  });

  it("zooms and resets through the api, only while orbiting", async () => {
    const apiRef = createRef<ExperienceApi | null>();
    const rig = await mount({ reducedMotion: true, apiRef });
    const start = rig.camera.position.clone();
    await ReactThreeTestRenderer.act(async () => {
      apiRef.current!.zoom(1);
      apiRef.current!.reset();
      apiRef.current!.wake();
    });
    expect(rig.camera.position.distanceTo(start)).toBe(0); // the story owns the camera

    await rig.update({ mode: "orbit" });
    const target = lastControls().target.clone();
    const far = rig.camera.position.distanceTo(target);
    await ReactThreeTestRenderer.act(async () => apiRef.current!.zoom(1));
    expect(rig.camera.position.distanceTo(target)).toBeCloseTo(far * 0.7, 6);
    expect(lastControls().enabled).toBe(true);
    await ReactThreeTestRenderer.act(async () => apiRef.current!.reset());
    expect(rig.camera.position.toArray()).toEqual(viewpoints("zaitun").aerial.position);
    await rig.unmount();
    expect(apiRef.current).toBeNull();
  });

  it("flies to a selected home, and a press hands the camera back mid-flight", async () => {
    const rig = await mount({ mode: "orbit", markers });
    await rig.update({ selectedId: "missing" });
    expect(lastControls().enabled).toBe(true); // an unknown home: no flight
    const p = siteFor("zaitun").markerPosition(markers[0]);
    const expected = markerPose([p.x, p.y, p.z], rig.camera.position.toArray(), lastControls().target.toArray(), 46);
    await rig.update({ selectedId: "ZH-V05" });
    expect(lastControls().enabled).toBe(false); // the flight owns the camera
    await rig.frames(30);
    expect(gap(rig, expected.position)).toBeLessThan(1e-6);
    expect(lastControls().target.distanceTo(at(expected.target))).toBeLessThan(1e-6);
    expect(rig.camera.fov).toBe(46);
    expect(lastControls().enabled).toBe(true);

    await rig.update({ selectedId: null });
    await rig.update({ selectedId: "ZH-V05" });
    await rig.frames(1);
    expect(lastControls().enabled).toBe(false);
    rig.canvas.dispatchEvent(new Event("pointerdown"));
    expect(lastControls().enabled).toBe(true);
    const stopped = rig.camera.position.clone();
    rig.canvas.dispatchEvent(new Event("pointerdown")); // nothing left to interrupt
    await rig.frames(3);
    expect(rig.camera.position.distanceTo(stopped)).toBeLessThan(1e-6);
    await rig.unmount();
  });

  it("flies down to eye height for a walk, walks on the arrow keys, and turns on a drag", async () => {
    const rig = await mount();
    await rig.frames(INTRO_FRAMES);
    await rig.update({ mode: "walk" });
    await rig.frames(1);
    expect(aboveGround(rig.camera.position)).toBeGreaterThan(EYE_HEIGHT + 0.05); // still flying
    await rig.frames(20);
    expect(aboveGround(rig.camera.position)).toBeCloseTo(EYE_HEIGHT, 1);
    expect(rig.rig.current.focus).toBe(30);

    const start = rig.camera.position.clone();
    const ahead = forward(rig.camera).setY(0).normalize();
    const press = new KeyboardEvent("keydown", { code: "ArrowUp", cancelable: true });
    window.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" })); // not a walking key
    await rig.frames(10);
    const moved = rig.camera.position.clone().sub(start).setY(0);
    expect(moved.length()).toBeGreaterThan(1);
    expect(moved.normalize().dot(ahead)).toBeGreaterThan(0.9);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "ArrowUp" }));

    // Keys typed into a field do not walk.
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true }));
    await rig.frames(30);
    const resting = rig.camera.position.clone();
    await rig.frames(3);
    expect(rig.camera.position.distanceTo(resting)).toBeLessThan(0.01);
    field.remove();

    // A drag turns the walker.
    const facing = forward(rig.camera);
    rig.canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 180, clientY: 100 }));
    window.dispatchEvent(new MouseEvent("pointerup"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 400, clientY: 100 })); // released: ignored
    await rig.frames(1);
    expect(forward(rig.camera).angleTo(facing)).toBeCloseTo(80 * 0.0042, 3);
    expect(rig.input.current.look).toEqual({ dx: 0, dy: 0 });

    // The joystick walks too.
    rig.input.current.move = { x: 0, y: 1 };
    rig.input.current.run = true;
    const before = rig.camera.position.clone();
    await rig.frames(5);
    expect(rig.camera.position.distanceTo(before)).toBeGreaterThan(0.5);
    await rig.unmount();
  });

  it("flies back up out of a walk into the orbit, and back to the scroll's shot for the story", async () => {
    const rig = await mount({ reducedMotion: true });
    await rig.frames(INTRO_FRAMES);
    await rig.update({ mode: "walk" });
    expect(aboveGround(rig.camera.position)).toBeCloseTo(EYE_HEIGHT, 6); // a jump, not a flight
    const walker = rig.camera.position.clone();
    await rig.update({ mode: "orbit" });
    expect(lastControls().target.distanceTo(walker)).toBeLessThan(1e-6);
    expect(rig.camera.position.y).toBeCloseTo(walker.y + 30, 6);
    await rig.update({ mode: "story" });
    expect(lastControls().dispose).toHaveBeenCalled();
    expect(gap(rig, storyPose("flight", INTRO_SECONDS).position)).toBeLessThan(1e-6);
    await rig.unmount();

    // With motion, each change is a flight.
    const flying = await mount();
    await flying.frames(INTRO_FRAMES);
    await flying.update({ mode: "walk" });
    await flying.frames(20);
    await flying.update({ mode: "orbit" });
    expect(lastControls().enabled).toBe(false);
    await flying.frames(20);
    expect(lastControls().enabled).toBe(true);
    flying.scroll.current.progress = 0.2;
    await flying.update({ mode: "story" });
    await flying.frames(1);
    expect(gap(flying, storyPose("flight", scrollToPosition(0.2)).position)).toBeGreaterThan(1);
    await flying.frames(20);
    expect(gap(flying, storyPose("flight", scrollToPosition(0.2)).position)).toBeLessThan(1e-6);
    await flying.unmount();
  });

  it("stops listening when the walk ends", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const rig = await mount({ mode: "walk" });
    await rig.update({ mode: "orbit" });
    const removed = remove.mock.calls.map((c) => c[0]);
    for (const type of ["keydown", "keyup", "pointermove", "pointerup", "pointercancel"]) expect(removed).toContain(type);
    await rig.unmount();
  });
});
