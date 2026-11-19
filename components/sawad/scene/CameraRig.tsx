import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DISTANCE, FLY_SECONDS, MAX_FRAME_SECONDS, clampTarget, flightPose, keepAboveGround, markerPose, zoomPose } from "./flight";
import { siteFor } from "./site";
import type { SceneApi, SceneMarker, SceneVariant, Vec3, ViewId } from "./types";
import { filmBlend, filmPose, viewpoints, type CameraPose } from "./viewpoints";

export type CameraRigProps = {
  variant: SceneVariant;
  mode: "film" | "explorer";
  /** Controlled: changing it moves the camera (a flight in the explorer, a restart of the film). */
  view: ViewId;
  /** Jump instead of flying. */
  reducedMotion?: boolean;
  /**
   * Film only: shift the picture so the subject clears overlaid text, as fractions of the
   * viewport (x > 0 moves it right, y > 0 up). Applied on wide screens, eased in as the film
   * leaves its opening shot so the first frame still matches the poster.
   */
  frame?: { x: number; y: number };
  /** Explorer: the homes that can be flown to. */
  markers?: SceneMarker[];
  /** Explorer: selecting a home flies the camera to its marker. */
  selectedId?: string | null;
  /** Receives the zoom and reset actions for the on-screen buttons. */
  apiRef?: RefObject<SceneApi | null>;
};

type Flight = { from: CameraPose; to: CameraPose; elapsed: number };
type Shift = { x: number; y: number };

const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];

/** Puts the camera (and the orbit target, when there are controls) on a pose. */
function applyPose(camera: PerspectiveCamera, controls: OrbitControls | null, pose: CameraPose): void {
  camera.position.set(...pose.position);
  if (camera.fov !== pose.fov) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }
  controls?.target.set(...pose.target);
  camera.lookAt(...pose.target);
}

/** Where the camera is and what it looks at (the orbit target, or a point 100 m ahead). */
function readPose(camera: PerspectiveCamera, controls: OrbitControls | null): CameraPose {
  const target = controls ? controls.target : new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(100).add(camera.position);
  return { position: toVec3(camera.position), target: toVec3(target), fov: camera.fov };
}

/** The film's framing shift at strength `lens` (0 to 1). Dropped on narrow screens. */
function applyLens(camera: PerspectiveCamera, shift: Shift | undefined, lens: number, width: number, height: number): void {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (!shift || w / h < 1.2 || lens === 0) {
    if (camera.view) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(w, h, -shift.x * lens * w, shift.y * lens * h, w, h);
}

function createControls(camera: PerspectiveCamera, canvas: HTMLCanvasElement): OrbitControls {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = DISTANCE.min;
  controls.maxDistance = DISTANCE.max;
  controls.maxPolarAngle = Math.PI / 2 - 0.03; // never underground
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.55;
  return controls;
}

/**
 * Moves the camera. Film: hold the opening shot, then circle the compound slowly. Explorer:
 * damped orbit controls that cannot leave the site, plus eased flights between viewpoints,
 * to a selected home, and for the zoom and reset buttons.
 */
export function CameraRig({ variant, mode, view, reducedMotion = false, frame, markers, selectedId = null, apiRef }: CameraRigProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const canvas = useThree((s) => s.gl.domElement);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const views = useMemo(() => viewpoints(variant), [variant]);

  const controlsRef = useRef<OrbitControls | null>(null);
  const flight = useRef<Flight | null>(null);
  const film = useRef({ seconds: 0, lens: 0 });
  const currentView = useRef(view);
  // The latest props, for the frame loop and the imperative actions.
  const latest = useRef({ markers, frame, size, reducedMotion });
  useEffect(() => {
    latest.current = { markers, frame, size, reducedMotion };
  });

  const moveTo = useCallback((pose: CameraPose) => applyPose(camera, controlsRef.current, pose), [camera]);

  const flyTo = useCallback(
    (to: CameraPose, animate = true) => {
      const controls = controlsRef.current;
      if (!animate || latest.current.reducedMotion) {
        flight.current = null;
        moveTo(to);
        if (controls) {
          controls.enabled = true;
          controls.update();
        }
      } else {
        flight.current = { from: readPose(camera, controls), to, elapsed: 0 };
        if (controls) controls.enabled = false;
      }
      invalidate();
    },
    [camera, moveTo, invalidate],
  );

  /** The film's framing shift, eased in by `film.lens`. */
  const shiftLens = useCallback(() => {
    const { frame: shift, size: box } = latest.current;
    applyLens(camera, shift, film.current.lens, box.width, box.height);
  }, [camera]);

  // The starting shot, and the orbit controls in the explorer.
  useLayoutEffect(() => {
    const controls = mode === "explorer" ? createControls(camera, canvas) : null;
    controlsRef.current = controls;
    applyPose(camera, controls, views[currentView.current]);
    controls?.update();
    // A press interrupts a flight where it is: the user is in charge.
    const interrupt = () => {
      if (!flight.current) return;
      flight.current = null;
      if (controls) controls.enabled = true;
    };
    if (controls) canvas.addEventListener("pointerdown", interrupt);
    return () => {
      canvas.removeEventListener("pointerdown", interrupt);
      controls?.dispose();
      controlsRef.current = null;
      flight.current = null;
    };
  }, [camera, canvas, mode, views]);

  // A new view: the film restarts from that shot; the explorer flies there.
  useEffect(() => {
    if (currentView.current === view) return;
    currentView.current = view;
    if (mode === "film") {
      film.current.seconds = 0;
      moveTo(views[view]);
      invalidate();
      return;
    }
    flyTo(views[view]);
  }, [view, mode, views, moveTo, flyTo, invalidate]);

  // A newly selected home: fly to its marker, keeping the current viewing direction.
  useEffect(() => {
    if (mode !== "explorer" || !selectedId) return;
    const marker = latest.current.markers?.find((m) => m.id === selectedId);
    if (!marker) return;
    const site = siteFor(variant);
    const p = site.markerPosition(marker);
    const pivot = controlsRef.current ? toVec3(controlsRef.current.target) : ([site.center.x, site.center.y, site.center.z] as Vec3);
    flyTo(markerPose([p.x, p.y, p.z], toVec3(camera.position), pivot, views.aerial.fov + 6));
  }, [selectedId, mode, variant, camera, views, flyTo]);

  // The framing shift follows the canvas size.
  useEffect(() => {
    latest.current.size = size;
    shiftLens();
  }, [size, shiftLens]);

  useImperativeHandle(
    apiRef,
    () => ({
      zoom: (dir) => flyTo(zoomPose(readPose(camera, controlsRef.current), dir)),
      reset: () => flyTo(views[currentView.current]),
    }),
    [camera, flyTo, views],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, MAX_FRAME_SECONDS);
    const controls = controlsRef.current;
    const active = flight.current;
    if (active) {
      active.elapsed += dt;
      moveTo(flightPose(active.from, active.to, active.elapsed / FLY_SECONDS));
      if (active.elapsed >= FLY_SECONDS) {
        flight.current = null;
        if (controls) controls.enabled = true;
      }
    } else if (mode === "film") {
      film.current.seconds += dt;
      moveTo(filmPose(variant, currentView.current, film.current.seconds));
      const lens = filmBlend(film.current.seconds);
      if (latest.current.frame && lens !== film.current.lens) {
        film.current.lens = lens;
        shiftLens();
      }
    }
    if (controls && !flight.current) {
      controls.update();
      clampTarget(controls.target);
      // The orbit limits keep the camera above the horizon, not above the foothills.
      keepAboveGround(camera.position, siteFor(variant).ground);
    }
  });

  return null;
}
