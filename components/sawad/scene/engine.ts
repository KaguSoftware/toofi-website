import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { reportError } from "@/lib/monitoring";
import { disposeObject, loadCompound } from "./compoundModel";
import { COMPOUND_CENTER } from "./layout";
import { createMarkerLayer } from "./markers";
import type { QualityTier, SceneMarker, SceneVariant, Vec3, ViewId } from "./types";
import { easeOutExpo, filmBlend, filmPose, lerpCamera, viewpoints, type CameraPose } from "./viewpoints";
import { buildWorld } from "./world";

export type EngineOptions = {
  variant: SceneVariant;
  tier: QualityTier;
  mode: "film" | "explorer";
  view: ViewId;
  reducedMotion?: boolean;
  /**
   * Film only: shift the picture so the subject clears overlaid text, as fractions
   * of the viewport (x > 0 moves it right, y > 0 up). Applied on wide screens, eased
   * in as the film leaves its opening shot so the first frame still matches the poster.
   */
  frame?: { x: number; y: number };
  onSelect?: (id: string) => void;
  onFirstFrame?: () => void;
  onFrame?: (frame: number) => void;
  onError?: (error: unknown) => void;
};

export type Engine = {
  setView: (view: ViewId, animate?: boolean) => void;
  flyToMarker: (id: string) => void;
  setMarkers: (markers: SceneMarker[]) => void;
  setSelected: (id: string | null) => void;
  zoom: (dir: 1 | -1) => void;
  reset: () => void;
  setPlaying: (playing: boolean) => void;
  resize: () => void;
  dispose: () => void;
};

/** How long the first frame waits for the baked model before showing the procedural compound. */
export const MODEL_TIMEOUT_MS = 8000;
const FLY_SECONDS = 1.2;
const CLICK_TOLERANCE_PX = 6;
const TARGET_BOUNDS = { minX: -480, maxX: 480, minY: -2, maxY: 60, minZ: -320, maxZ: 420 };
const DISTANCE = { min: 7, max: 720 };

const v3 = (v: Vec3) => new Vector3(v[0], v[1], v[2]);
const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function createEngine(canvas: HTMLCanvasElement, opts: EngineOptions): Engine {
  const { variant, tier, mode } = opts;
  const views = viewpoints(variant);
  let currentView: ViewId = opts.view;

  const renderer = new WebGLRenderer({ canvas, antialias: tier === "high", powerPreference: "high-performance" });
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  renderer.setPixelRatio(tier === "high" ? Math.min(dpr, 1.75) : 1);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.outputColorSpace = SRGBColorSpace;
  if (tier === "high") {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
  }

  const world = buildWorld({ variant, tier });
  const scene = world.scene;
  try {
    world.setEnvironment(renderer);
  } catch (err) {
    // Without reflections the scene still renders; say so and carry on.
    reportError("sawad-scene", err, { stage: "environment", variant, tier });
  }
  const markers = createMarkerLayer();
  scene.add(markers.group);

  const start = views[currentView];
  const camera = new PerspectiveCamera(start.fov, 1, 0.5, 14000);
  camera.position.copy(v3(start.position));
  camera.lookAt(v3(start.target));

  let controls: OrbitControls | null = null;
  if (mode === "explorer") {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = DISTANCE.min;
    controls.maxDistance = DISTANCE.max;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.screenSpacePanning = false;
    controls.zoomSpeed = 0.8;
    controls.rotateSpeed = 0.55;
    controls.target.copy(v3(start.target));
    controls.update();
  }

  // ---- camera flights
  type Flight = { from: CameraPose; to: CameraPose; t0: number; dur: number };
  let flight: Flight | null = null;
  const currentPose = (): CameraPose => {
    const target = controls ? controls.target.clone() : new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(100).add(camera.position);
    return { position: toVec3(camera.position), target: toVec3(target), fov: camera.fov };
  };
  const applyPose = (pose: CameraPose) => {
    camera.position.copy(v3(pose.position));
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    if (controls) controls.target.copy(v3(pose.target));
    camera.lookAt(v3(pose.target));
  };
  const flyTo = (to: CameraPose, animate = true) => {
    if (!animate || opts.reducedMotion) {
      flight = null;
      applyPose(to);
      if (controls) controls.update();
      requestRender();
      return;
    }
    flight = { from: currentPose(), to, t0: now(), dur: FLY_SECONDS };
    if (controls) controls.enabled = false;
    requestRender();
  };
  const stepFlight = (t: number) => {
    if (!flight) return;
    const k = easeOutExpo((t - flight.t0) / flight.dur);
    const pose = lerpCamera(flight.from, flight.to, k);
    // Arc upward on long moves so the camera never skims through buildings.
    const span = v3(flight.from.position).distanceTo(v3(flight.to.position));
    pose.position[1] += Math.sin(Math.PI * k) * Math.min(60, span * 0.18);
    applyPose(pose);
    if (k >= 1) {
      flight = null;
      if (controls) {
        controls.enabled = true;
        controls.update();
      }
    }
  };

  // ---- film: hold the opening shot, then fly slowly around the compound.
  const center = new Vector3(COMPOUND_CENTER.x, COMPOUND_CENTER.y, COMPOUND_CENTER.z);
  let filmT = 0;
  let lens = 0;
  const applyLens = () => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    if (!opts.frame || w / h < 1.2 || lens === 0) {
      if (camera.view) camera.clearViewOffset();
      return;
    }
    camera.setViewOffset(w, h, -opts.frame.x * lens * w, opts.frame.y * lens * h, w, h);
  };
  const stepFilm = (dt: number) => {
    filmT += dt;
    applyPose(filmPose(variant, currentView, filmT));
    const k = filmBlend(filmT);
    if (opts.frame && k !== lens) {
      lens = k;
      applyLens();
    }
  };

  // ---- loop
  let raf = 0;
  let playing = true;
  let frames = 0;
  let disposed = false;
  // The first frame waits for the baked architecture (or its failure, or the timeout), so the
  // poster hands over to the finished compound with no pop from boxes to model.
  let architectureReady = false;
  let last = now();
  const clock0 = now();

  function now() {
    return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  }
  const schedule = (cb: FrameRequestCallback) =>
    typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : (setTimeout(() => cb(Date.now()), 16) as unknown as number);
  const cancel = (id: number) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));

  function renderFrame() {
    const t = now();
    const dt = Math.min(0.1, t - last);
    last = t;
    world.update(t - clock0);
    if (flight) stepFlight(t);
    else if (mode === "film") stepFilm(dt);
    if (controls && !flight) {
      controls.update();
      const tg = controls.target;
      tg.set(clamp(tg.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX), clamp(tg.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY), clamp(tg.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ));
    }
    renderer.render(scene, camera);
    frames++;
    if (frames === 1) opts.onFirstFrame?.();
    opts.onFrame?.(frames);
  }

  function tick() {
    raf = 0;
    if (disposed || !playing || !architectureReady) return;
    try {
      renderFrame();
    } catch (err) {
      playing = false;
      opts.onError?.(err);
      return;
    }
    raf = schedule(tick);
  }

  /** Renders once even while paused (after a resize or a jump). */
  function requestRender() {
    if (disposed || !architectureReady) return;
    if (playing) {
      if (!raf) raf = schedule(tick);
      return;
    }
    schedule(() => {
      if (!disposed && !playing) renderFrame();
    });
  }

  // ---- input
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  let down: { x: number; y: number } | null = null;
  const toNdc = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
    if (flight) {
      // Interrupt a flight where it is: the user is in charge.
      flight = null;
      if (controls) controls.enabled = true;
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved >= CLICK_TOLERANCE_PX) return;
    toNdc(e);
    const id = markers.pick(raycaster);
    if (id) opts.onSelect?.(id);
  };
  let hoverFrame = 0;
  const onMove = (e: PointerEvent) => {
    if (e.buttons || ++hoverFrame % 2) return;
    toNdc(e);
    canvas.style.cursor = markers.pick(raycaster) ? "pointer" : "";
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    playing = false;
    opts.onError?.(new Error("WebGL context lost"));
  };
  if (mode === "explorer") {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
  }
  canvas.addEventListener("webglcontextlost", onLost);

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyLens();
    requestRender();
  }
  resize();

  // ---- baked architecture: start loading now; render once it is in, failed or timed out.
  const openGate = () => {
    if (architectureReady || disposed) return;
    architectureReady = true;
    clearTimeout(modelTimer);
    last = now();
    requestRender();
  };
  const modelTimer = setTimeout(() => {
    if (architectureReady || disposed) return;
    reportError("sawad-scene", new Error(`Compound model not ready after ${MODEL_TIMEOUT_MS} ms; showing the procedural compound`), { stage: "compound-model", tier, variant });
    openGate();
  }, MODEL_TIMEOUT_MS);
  loadCompound(tier, renderer).then(
    (model) => {
      // Too late (timed out) or torn down: keep what is on screen and free the model.
      if (architectureReady || disposed) {
        disposeObject(model);
        return;
      }
      world.setArchitecture(model);
      openGate();
    },
    // loadCompound has reported the failure; the procedural compound stays.
    () => openGate(),
  );

  return {
    setView(view, animate = true) {
      currentView = view;
      if (mode === "film") {
        filmT = 0;
        applyPose(views[view]);
        requestRender();
        return;
      }
      flyTo(views[view], animate);
    },
    flyToMarker(id) {
      const p = markers.positionOf(id);
      if (!p) return;
      const from = controls ? controls.target : center;
      const dir = camera.position.clone().sub(from).setY(0);
      if (dir.lengthSq() < 1) dir.set(-1, 0, -1);
      dir.normalize();
      const position = p.clone().addScaledVector(dir, 62);
      position.y = Math.max(p.y + 30, 34);
      const target = p.clone();
      target.y -= 4;
      flyTo({ position: toVec3(position), target: toVec3(target), fov: views.aerial.fov + 6 });
    },
    setMarkers(list) {
      markers.setMarkers(list);
      requestRender();
    },
    setSelected(id) {
      markers.setSelected(id);
      requestRender();
    },
    zoom(dir) {
      const pose = currentPose();
      const target = v3(pose.target);
      const offset = v3(pose.position).sub(target);
      const dist = clamp(offset.length() * (dir === 1 ? 0.7 : 1 / 0.7), DISTANCE.min, DISTANCE.max);
      offset.setLength(dist);
      flyTo({ ...pose, position: toVec3(target.clone().add(offset)) });
    },
    reset() {
      flyTo(views[currentView]);
    },
    setPlaying(next) {
      if (next === playing) return;
      playing = next;
      if (playing) {
        last = now();
        if (!raf) raf = schedule(tick);
      } else if (raf) {
        cancel(raf);
        raf = 0;
      }
    },
    resize,
    dispose() {
      disposed = true;
      clearTimeout(modelTimer);
      if (raf) cancel(raf);
      raf = 0;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("webglcontextlost", onLost);
      controls?.dispose();
      markers.dispose();
      world.dispose();
      renderer.dispose();
    },
  };
}
