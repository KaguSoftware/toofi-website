import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISTANCE, FLY_SECONDS, MAX_FRAME_SECONDS, clampTarget, flightPose, keepAboveGround, markerPose, zoomPose } from "../scene/flight";
import { PLAN_CENTER } from "../scene/layout";
import { siteFor } from "../scene/site";
import type { SceneMarker, Vec3, ViewId } from "../scene/types";
import { lerpCamera, tourAngleNear, tourPose, viewpoints, type CameraPose } from "../scene/viewpoints";
import { AMBIENT_BLEND_SECONDS, AMBIENT_IDLE_SECONDS, HEAD_SETTLED, INTRO_HOLD_SECONDS, INTRO_SECONDS, approach, scrollToPosition } from "./beats";
import { storyPose } from "./storySheet";
import type { ExperienceApi, ExperienceMode, RigState, ScrollState } from "./types";
import { WALK_KEYS, keysToMove, stepWalk, walkPose, walkStart, type WalkInput, type WalkState } from "./walk";

export type StoryRigProps = {
  /** The owner's opening shot: which of the four openings plays. */
  view: ViewId;
  /** "story": the intro, then the scroll, drive the camera. "orbit" and "walk": the visitor does. */
  mode: ExperienceMode;
  /** Jump instead of flying, and never move the camera unasked. */
  reducedMotion?: boolean;
  /** False pauses what moves by itself (the intro, the circuit); the scroll still works. */
  playing?: boolean;
  /** Development capture: hold the story at this sequence position. */
  holdAt?: number | null;
  scroll: RefObject<ScrollState>;
  input: RefObject<WalkInput>;
  /** Written every frame: the lens and the camera's surroundings. */
  rig: RefObject<RigState>;
  markers?: SceneMarker[];
  selectedId?: string | null;
  apiRef?: RefObject<ExperienceApi | null>;
  /** The opening has reached the gate. */
  onIntroEnd?: () => void;
  /** The camera could not be moved (the story sheet failed): reported once, then the rig stands still. */
  onError?: (error: unknown) => void;
};

type Flight = { from: CameraPose; to: CameraPose; elapsed: number; seconds: number };

const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const smoother = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * k * (k * (k * 6 - 15) + 10);
};
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Scroll progress under this counts as "at the top": the intro and the circuit may run. */
const AT_TOP = 0.002;
/** Seconds to fly down into a walk or back up out of one. */
const WALK_FLY_SECONDS = 1.8;
/** The stream's nearest bank and the distance over which its sound fades. */
const WATER_HEARING = 140;

function applyPose(camera: PerspectiveCamera, controls: OrbitControls | null, pose: CameraPose): void {
  camera.position.set(...pose.position);
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  controls?.target.set(...pose.target);
  camera.lookAt(...pose.target);
}

function readPose(camera: PerspectiveCamera, controls: OrbitControls | null): CameraPose {
  const target = controls ? controls.target : new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(60).add(camera.position);
  return { position: toVec3(camera.position), target: toVec3(target), fov: camera.fov };
}

function createControls(camera: PerspectiveCamera, canvas: HTMLCanvasElement): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = DISTANCE.min;
  controls.maxDistance = DISTANCE.max;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.55;
  return controls;
}

/** The orbit target for a camera that was not orbiting: what it looks at, pulled inside the site. */
function orbitTargetFor(pose: CameraPose): Vec3 {
  const t = clampTarget({ x: pose.target[0], y: pose.target[1], z: pose.target[2] });
  return [t.x, t.y, t.z];
}

/** A drag on the canvas, added to what the walker has yet to turn by. */
function addLook(input: WalkInput | null, dx: number, dy: number): void {
  if (!input) return;
  input.look.dx += dx;
  input.look.dy += dy;
}

/** The walker has turned: the drag is spent. */
function clearLook(input: WalkInput | null): void {
  if (!input) return;
  input.look.dx = 0;
  input.look.dy = 0;
}

function noteHead(rig: RigState, head: number): void {
  rig.head = head;
}

/** Where the camera is for the sound and the lens. */
function describePlace(rig: RigState, pose: CameraPose, focus: number, blur: number): void {
  const [x, y, z] = pose.position;
  const site = siteFor("zaitun");
  const toWater = Math.abs(z - site.riverCenterZ(x));
  rig.water = Math.min(1, Math.max(0, 1 - toWater / WATER_HEARING)) * Math.min(1, Math.max(0.25, 1 - (y - 20) / 160));
  rig.open = Math.min(1, Math.max(0, (y - site.ground(x, z)) / 40));
  rig.focus = focus;
  rig.blur = blur;
}

/**
 * Moves the camera. In the story it plays the Theatre.js sheet: the opening by the clock, the
 * rest from the scroll (eased, so a flung scroll becomes a glide), and a slow circuit when a
 * visitor at the top does nothing. Exploring hands over to damped orbit controls or a walk,
 * with eased flights between the modes.
 */
export function StoryRig({ view, mode, reducedMotion = false, playing = true, holdAt = null, scroll, input, rig, markers, selectedId = null, apiRef, onIntroEnd, onError }: StoryRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const canvas = useThree((s) => s.gl.domElement);
  const invalidate = useThree((s) => s.invalidate);

  const controlsRef = useRef<OrbitControls | null>(null);
  const flight = useRef<Flight | null>(null);
  const walker = useRef<WalkState | null>(null);
  const keys = useRef(new Set<string>());
  const story = useRef({ head: holdAt ?? 0, held: 0, idle: 0, ambient: 0, tourSeconds: 0, tourAngle: 0, introDone: false });
  const currentMode = useRef<ExperienceMode>(mode);
  const failed = useRef(false);
  const latest = useRef({ markers, reducedMotion, playing, holdAt, view, onIntroEnd, onError });
  useEffect(() => {
    latest.current = { markers, reducedMotion, playing, holdAt, view, onIntroEnd, onError };
  });

  const moveTo = useCallback((pose: CameraPose) => applyPose(camera, controlsRef.current, pose), [camera]);

  const flyTo = useCallback(
    (to: CameraPose, seconds = FLY_SECONDS) => {
      const controls = controlsRef.current;
      if (latest.current.reducedMotion) {
        flight.current = null;
        moveTo(to);
        if (controls) {
          controls.enabled = true;
          controls.update();
        }
      } else {
        flight.current = { from: readPose(camera, controls), to, elapsed: 0, seconds };
        if (controls) controls.enabled = false;
      }
      invalidate();
    },
    [camera, moveTo, invalidate],
  );

  /** The story's camera for the playhead, with the circuit blended in while a visitor idles at the top. */
  const storyNow = useCallback(() => {
    const s = story.current;
    const pose = storyPose(latest.current.view, s.head);
    if (s.ambient <= 0) return pose;
    const tour = tourPose("zaitun", s.tourSeconds, s.tourAngle);
    const k = smoother(s.ambient);
    const blended = lerpCamera(pose, tour, k);
    // Rise first, so the lift-off from the gate clears the trees.
    blended.position[1] = pose.position[1] + (tour.position[1] - pose.position[1]) * smoother(s.ambient * 1.6);
    return { ...blended, focus: pose.focus + (400 - pose.focus) * k, blur: pose.blur * (1 - k) };
  }, []);

  // The opening frame: the poster's shot, or the aerial for a visitor who explores without the story.
  useLayoutEffect(() => {
    applyPose(camera, null, mode === "story" ? storyPose(view, holdAt ?? 0) : viewpoints("zaitun").aerial);
    // Mount only: later changes of mode and view are flown to below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  // Orbit controls exist only while orbiting.
  useLayoutEffect(() => {
    if (mode !== "orbit") return;
    const from = readPose(camera, null);
    const controls = createControls(camera, canvas);
    controlsRef.current = controls;
    const wasWalking = currentMode.current === "walk" && walker.current;
    if (wasWalking) {
      // Up and back from where the walker stood.
      const w = walker.current!;
      const back: Vec3 = [w.x - Math.sin(w.yaw) * 46, w.y + 30, w.z + Math.cos(w.yaw) * 46];
      controls.target.set(w.x, w.y, w.z);
      flight.current = latest.current.reducedMotion ? null : { from, to: { position: back, target: [w.x, w.y, w.z], fov: 46 }, elapsed: 0, seconds: WALK_FLY_SECONDS };
      if (flight.current) controls.enabled = false;
      else applyPose(camera, controls, { position: back, target: [w.x, w.y, w.z], fov: 46 });
    } else if (currentMode.current === "story") {
      // No move at all: orbit about what the story camera was looking at.
      controls.target.set(...orbitTargetFor(from));
    } else {
      controls.target.set(PLAN_CENTER.x, PLAN_CENTER.y, PLAN_CENTER.z);
    }
    controls.update();
    const interrupt = () => {
      if (!flight.current) return;
      flight.current = null;
      controls.enabled = true;
    };
    canvas.addEventListener("pointerdown", interrupt);
    return () => {
      canvas.removeEventListener("pointerdown", interrupt);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [mode, camera, canvas]);

  // Walking: fly down to the nearest free ground, then listen for keys and drags.
  useEffect(() => {
    if (mode !== "walk") return;
    const from = readPose(camera, null);
    const facing: Vec3 = [from.target[0] - from.position[0], 0, from.target[2] - from.position[2]];
    const start = walkStart(orbitTargetFor(from), facing);
    walker.current = start;
    flyTo(walkPose(start), WALK_FLY_SECONDS);

    const held = keys.current;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const down = (e: KeyboardEvent) => {
      if (!WALK_KEYS.has(e.code) || typing(e)) return;
      held.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
      invalidate();
    };
    const up = (e: KeyboardEvent) => held.delete(e.code);
    let drag: { id: number; x: number; y: number } | null = null;
    const press = (e: PointerEvent) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      addLook(input.current, e.clientX - drag.x, e.clientY - drag.y);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      invalidate();
    };
    const release = () => {
      drag = null;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    canvas.addEventListener("pointerdown", press);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      held.clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      canvas.removeEventListener("pointerdown", press);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [mode, camera, canvas, flyTo, invalidate, input]);

  // Back to the story: fly to where the scroll has the camera.
  useEffect(() => {
    const previous = currentMode.current;
    currentMode.current = mode;
    if (mode !== "story" || previous === "story") return;
    const s = story.current;
    s.ambient = 0;
    s.idle = 0;
    s.head = Math.max(scrollToPosition(scroll.current?.progress ?? 0), s.introDone ? INTRO_SECONDS : s.head);
    flyTo(storyPose(latest.current.view, s.head), WALK_FLY_SECONDS);
  }, [mode, flyTo, scroll]);

  // A newly selected home: fly to it, keeping the current viewing direction (orbit only).
  useEffect(() => {
    if (mode !== "orbit" || !selectedId) return;
    const marker = latest.current.markers?.find((m) => m.id === selectedId);
    const controls = controlsRef.current;
    if (!marker || !controls) return;
    const p = siteFor("zaitun").markerPosition(marker);
    flyTo(markerPose([p.x, p.y, p.z], toVec3(camera.position), toVec3(controls.target), 46));
  }, [selectedId, mode, camera, flyTo]);

  useImperativeHandle(
    apiRef,
    () => ({
      zoom: (dir) => {
        if (controlsRef.current) flyTo(zoomPose(readPose(camera, controlsRef.current), dir));
      },
      reset: () => {
        if (controlsRef.current) flyTo(viewpoints("zaitun").aerial);
      },
      wake: () => invalidate(),
    }),
    [camera, flyTo, invalidate],
  );

  const step = (delta: number) => {
    const dt = Math.min(delta, MAX_FRAME_SECONDS);
    const controls = controlsRef.current;
    const state = rig.current;
    const active = flight.current;
    if (active) {
      active.elapsed += dt;
      moveTo(flightPose(active.from, active.to, active.elapsed / active.seconds));
      if (active.elapsed >= active.seconds) {
        flight.current = null;
        if (controls) controls.enabled = true;
      }
      if (state) describePlace(state, readPose(camera, controls), 200, 0);
      return;
    }

    if (mode === "story") {
      const s = story.current;
      const { playing: moving, holdAt: hold, onIntroEnd: introEnd } = latest.current;
      const progress = scroll.current?.progress ?? 0;
      const atTop = progress <= AT_TOP;
      if (hold !== null) s.head = hold;
      else if (atTop && s.head < INTRO_SECONDS) {
        // The opening holds on its poster frame first; a scroll skips the hold (the branch below).
        if (moving && s.held < INTRO_HOLD_SECONDS) s.held += dt;
        else if (moving) s.head = Math.min(INTRO_SECONDS, s.head + dt);
      } else s.head = approach(s.head, scrollToPosition(progress), dt);
      if (!s.introDone && s.head >= INTRO_SECONDS) {
        s.introDone = true;
        introEnd?.();
      }
      // The slow circuit, for a visitor who stays at the top and does nothing. A camera still
      // gliding back up from the tour first arrives at the gate; only then does the wait start.
      const caughtUp = Math.abs(s.head - scrollToPosition(progress)) < HEAD_SETTLED;
      if (hold === null && atTop && s.introDone && moving && (caughtUp || s.ambient > 0)) {
        s.idle += dt;
        if (s.idle > AMBIENT_IDLE_SECONDS) {
          if (s.ambient === 0) {
            s.tourSeconds = 0;
            s.tourAngle = tourAngleNear(storyPose(latest.current.view, s.head).position, "zaitun");
          }
          s.ambient = Math.min(1, s.ambient + dt / AMBIENT_BLEND_SECONDS);
          s.tourSeconds += dt;
        }
      } else if (!atTop || hold !== null || !caughtUp) {
        s.idle = 0;
        if (s.ambient > 0) {
          // Come back at a speed the eye can follow, however far the circuit had gone.
          const gap = dist(toVec3(camera.position), storyPose(latest.current.view, s.head).position);
          s.ambient = Math.max(0, s.ambient - dt * Math.min(1 / 1.6, 220 / Math.max(gap, 1)));
        }
      }
      const pose = storyNow();
      moveTo(pose);
      if (state) {
        noteHead(state, s.head);
        describePlace(state, pose, pose.focus, pose.blur);
      }
      return;
    }

    if (mode === "walk" && walker.current) {
      const stick = input.current;
      const fromKeys = keysToMove(keys.current);
      const usingKeys = fromKeys.x !== 0 || fromKeys.y !== 0;
      const next = stepWalk(
        walker.current,
        {
          move: usingKeys ? fromKeys : (stick?.move ?? { x: 0, y: 0 }),
          run: keys.current.has("ShiftLeft") || keys.current.has("ShiftRight") || (stick?.run ?? false),
          look: stick?.look ?? { dx: 0, dy: 0 },
        },
        dt,
      );
      clearLook(stick);
      walker.current = next;
      const pose = walkPose(next);
      moveTo(pose);
      if (state) describePlace(state, pose, 30, 0);
      return;
    }

    if (controls) {
      controls.update();
      clampTarget(controls.target);
      keepAboveGround(camera.position, siteFor("zaitun").ground);
      if (state) describePlace(state, readPose(camera, controls), camera.position.distanceTo(controls.target), 0);
    }
  };

  useFrame((_, delta) => {
    if (failed.current) return;
    try {
      step(delta);
    } catch (err) {
      // One report, not one per frame; the viewport falls back to the stills.
      failed.current = true;
      latest.current.onError?.(err);
    }
  });

  return null;
}
