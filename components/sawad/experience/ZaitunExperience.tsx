"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ErrorBoundary } from "@/components/monitoring/ErrorBoundary";
import { reportError } from "@/lib/monitoring";
import { residencesIn, sceneImage } from "@/lib/sawad/data";
import { canRender3D, qualityTier, readCapabilityEnv } from "../scene/capability";
import type { QualityTier, SceneMarker, ViewId } from "../scene/types";
import { audioSupported, createAmbience, type Ambience } from "./audio";
import type { Daylight } from "./daylight";
import { ExperienceHud } from "./ExperienceHud";
import { Joystick } from "./Joystick";
import { initialRigState, type ExperienceApi, type ExperienceMode, type RigState, type ScrollState, type ZaitunExperienceProps } from "./types";
import { UnitPanel } from "./UnitPanel";
import type { WalkInput } from "./walk";
import "./experience.css";

// Two lazy chunks, fetched in the browser only when the live story runs: the WebGL scene
// (three.js, React Three Fiber, Theatre.js, the effect chain) and the scroll driver (GSAP).
const ExperienceCanvas = dynamic(() => import("./ExperienceCanvas"), { ssr: false });
const StoryScroll = dynamic(() => import("./StoryScroll"), { ssr: false });

/** What this device gets, once the browser has been asked. */
type Device = { capable: boolean; reducedMotion: boolean };
type Setup = { tier: QualityTier; holdAt: number | null; view: ViewId | null };

const CAPTURE_FRAMES = 30;
const HINT_MS = 6000;
const noopSubscribe = () => () => {};

let deviceCache: Device | null = null;
function deviceSnapshot(): Device {
  // 3D on the same terms as the explorer; reduced motion is handled here, not refused.
  deviceCache ??= (() => {
    const env = readCapabilityEnv("explorer");
    return { capable: canRender3D(env), reducedMotion: env.reducedMotion };
  })();
  return deviceCache;
}
/** Test hook: forget what the device was found to be. */
export function resetDeviceCache(): void {
  deviceCache = null;
}

const VIEWS: readonly ViewId[] = ["flight", "street", "terrace", "aerial"];

/**
 * Development only: `?story=32` holds the story at sequence position 32 and hides the controls,
 * for rendering stills; `&dusk=1` renders it at dusk; `&view=street` plays another start view's
 * opening over its own poster (to check each poster-to-scene handover).
 */
export function captureAt(): { at: number; dusk: boolean; view: ViewId | null } | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("story");
  const at = raw === null ? NaN : Number(raw);
  const view = VIEWS.find((v) => v === params.get("view")) ?? null;
  return Number.isFinite(at) ? { at, dusk: params.get("dusk") === "1", view } : null;
}

function OnMount({ run }: { run: () => void }) {
  useEffect(run, [run]);
  return null;
}

const newInput = (): WalkInput => ({ move: { x: 0, y: 0 }, run: false, look: { dx: 0, dy: 0 } });

/**
 * The Zaitun Hills showcase on Home. One structure serves every visitor:
 *
 * - The server (and a browser without JavaScript) gets the stills: the poster behind the hero,
 *   then one full-screen still per beat with its caption.
 * - A capable device gets the live story on top of that: the stage stays put while the page
 *   scrolls, an opening plays under a letterbox, the scroll moves the camera from beat to beat,
 *   and "Explore" hands the camera over (orbit, walk, the homes, day and dusk, sound).
 * - With reduced motion nothing moves unasked: the stills stay, and a button opens the
 *   explorer, where only the visitor moves the camera.
 *
 * The canvas is hidden from assistive technology; the captions, in document order, are the story.
 */
/** The homes a visitor can pick while exploring: the same sample data the residence finder shows. */
const HOMES = residencesIn("zaitun-hills");

export function ZaitunExperience({ locale, view: ownerView, live, poster: ownerPoster, hero, after, beats, labels }: ZaitunExperienceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const exploreButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const apiRef = useRef<ExperienceApi | null>(null);
  const scroll = useRef<ScrollState>({ progress: 0 });
  const input = useRef<WalkInput>(newInput());
  const rig = useRef<RigState>(initialRigState());
  const ambience = useRef<Ambience | null>(null);

  const device = useSyncExternalStore<Device | null>(noopSubscribe, deviceSnapshot, () => null);
  const soundAvailable = useSyncExternalStore(noopSubscribe, audioSupported, () => false);

  const [setup, setSetup] = useState<Setup | null>(null);
  // A capture may play another start view; everyone else gets the owner's.
  const view = setup?.view ?? ownerView;
  const poster = setup?.view ? { src: sceneImage("zaitun", setup.view), alt: ownerPoster.alt } : ownerPoster;
  const [status, setStatus] = useState<"off" | "running" | "failed">("off");
  const [captureReady, setCaptureReady] = useState(false);
  const [asked, setAsked] = useState(false);
  const [mode, setMode] = useState<ExperienceMode>("story");
  const [daylight, setDaylight] = useState<Daylight>("day");
  const [sound, setSound] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [introDone, setIntroDone] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hint, setHint] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // What this visitor gets: the live story, the stills with an explorer on request, or the stills alone.
  const kind = !live || !device?.capable || status === "failed" ? "stills" : device.reducedMotion ? "reduced" : "story";
  const loads = kind === "story" || (kind === "reduced" && asked);
  const running = loads && status === "running";
  const capture = setup?.holdAt != null;
  // Reduced motion has no story to return to: its explorer is the whole live scene.
  const activeMode: ExperienceMode = kind === "reduced" && mode === "story" ? "orbit" : mode;
  const exploring = running && activeMode !== "story";
  const ui = running && !capture;

  const fail = useCallback(
    (err: unknown) => {
      reportError("ZaitunExperience", err, { view });
      setStatus("failed");
    },
    [view],
  );
  const onBoundaryError = useCallback(() => setStatus("failed"), []);
  const onFirstFrame = useCallback(() => setStatus((s) => (s === "failed" ? s : "running")), []);
  const onFrame = useCallback((n: number) => {
    if (n === CAPTURE_FRAMES) setCaptureReady(true);
  }, []);
  const onIntroEnd = useCallback(() => setIntroDone(true), []);
  const wake = useCallback((progress: number) => {
    if (progress > 0.002) setScrolled(true);
    apiRef.current?.wake();
  }, []);

  // The stage reads the device once, when the scene is about to load.
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const hold = captureAt();
    const env = readCapabilityEnv("explorer");
    setSetup({ holdAt: hold?.at ?? null, view: hold?.view ?? null, tier: hold ? "high" : qualityTier({ ...env, width: window.innerWidth, dpr: window.devicePixelRatio || 1 }) });
    if (hold?.dusk) setDaylight("dusk");
  }, []);

  // No frames while the story is off screen or the tab is hidden.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0 });
      io.observe(el);
    }
    const onVis = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // The letterbox opens at the first sign of the visitor: a scroll, a key, a touch.
  useEffect(() => {
    if (kind !== "story" || interacted) return;
    const open = () => setInteracted(true);
    const events = ["wheel", "touchstart", "keydown", "pointerdown", "scroll"] as const;
    for (const e of events) window.addEventListener(e, open, { passive: true, once: true });
    return () => {
      for (const e of events) window.removeEventListener(e, open);
    };
  }, [kind, interacted]);

  const setExperienceMode = useCallback(
    (next: ExperienceMode) => {
      if (next === "story") {
        setSelectedId(null);
        // With reduced motion there is no story camera: leaving the explorer leaves the 3D.
        if (kind === "reduced") setAsked(false);
        setMode("story");
        setHint(false);
        return;
      }
      setInteracted(true);
      setMode(next);
      setHint(true);
    },
    [kind],
  );

  // Exploring takes the whole screen: the page behind must not scroll, and Escape leaves.
  useEffect(() => {
    if (!exploring) return;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    // Hold the page where the stage fills the screen, then stop it scrolling.
    const root = rootRef.current;
    if (root) {
      const box = root.getBoundingClientRect();
      const stage = root.querySelector<HTMLElement>(".xp__stage");
      const top = box.top + window.scrollY;
      const last = top + box.height - (stage?.offsetHeight ?? 0);
      const y = Math.min(Math.max(window.scrollY, top), Math.max(top, last));
      if (y !== window.scrollY) window.scrollTo({ top: y, behavior: "instant" });
    }
    html.style.overflow = "hidden";
    const opener = exploreButton.current;
    backButton.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedId) setSelectedId(null);
      else setExperienceMode("story");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      opener?.focus({ preventScroll: true });
    };
    // `selectedId` is read when Escape is pressed, through the latest closure below.
  }, [exploring, selectedId, setExperienceMode]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(t);
  }, [hint, activeMode]);

  // Sound: made on the first request (inside the click), fed with where the camera is.
  const toggleSound = useCallback((on: boolean) => {
    setSound(on);
    if (!on) {
      ambience.current?.stop();
      return;
    }
    ambience.current ??= createAmbience();
    ambience.current.start().catch((err) => {
      reportError("ZaitunExperience", err, { stage: "audio" });
      setSound(false);
    });
  }, []);
  useEffect(() => {
    if (!sound) return;
    const feed = setInterval(() => {
      ambience.current?.setDusk(rig.current.dusk);
      ambience.current?.setPlace({ water: rig.current.water, open: rig.current.open });
    }, 250);
    return () => clearInterval(feed);
  }, [sound]);
  // A hidden tab goes quiet; it picks up again when it is back.
  const quieted = useRef(false);
  useEffect(() => {
    if (!sound) return;
    if (!tabVisible) {
      quieted.current = true;
      ambience.current?.stop();
    } else if (quieted.current) {
      quieted.current = false;
      void ambience.current?.start().catch((err) => reportError("ZaitunExperience", err, { stage: "audio" }));
    }
  }, [tabVisible, sound]);
  useEffect(
    () => () => {
      ambience.current?.dispose();
      ambience.current = null;
    },
    [],
  );

  const markers: SceneMarker[] = useMemo(() => HOMES.map((r) => ({ id: r.id, kind: r.kind, slot: r.slot, status: r.status, label: r.id })), []);
  const selected = exploring && selectedId ? HOMES.find((r) => r.id === selectedId) : undefined;

  const begin = useCallback(() => {
    setInteracted(true);
    const first = rootRef.current?.querySelector<HTMLElement>("[data-beat]");
    first?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const letterbox = kind === "story" && !interacted && !scrolled && !capture;
  const ready = capture ? captureReady : running;

  return (
    <section
      ref={rootRef}
      className="xp"
      data-state={kind === "story" ? "story" : "stills"}
      data-mode={exploring ? activeMode : "story"}
      data-running={running ? "true" : undefined}
      data-letterbox={letterbox ? "closed" : "open"}
      data-capture={capture ? "true" : undefined}
      data-scene-ready={ready ? "true" : undefined}
      aria-label={labels.region}
    >
      <div className="xp__stage">
        <div className="xp__poster">
          <Image src={poster.src} alt={poster.alt} fill priority sizes="100vw" />
        </div>
        {loads && (
          <div ref={stageRef} className="xp__canvas" data-visible={running} aria-hidden="true" onPointerDown={() => setHint(false)}>
            {setup && (
              <ErrorBoundary name="ZaitunExperience" fallback={<OnMount run={onBoundaryError} />}>
                <ExperienceCanvas
                  tier={setup.tier}
                  view={view}
                  mode={activeMode}
                  daylight={daylight}
                  reducedMotion={device?.reducedMotion}
                  holdAt={setup.holdAt}
                  playing={onScreen && tabVisible && (playing || exploring)}
                  moving={playing}
                  markers={exploring ? markers : undefined}
                  selectedId={exploring ? selectedId : null}
                  scroll={scroll}
                  input={input}
                  rig={rig}
                  apiRef={apiRef}
                  onSelect={setSelectedId}
                  onFirstFrame={onFirstFrame}
                  onFrame={setup.holdAt !== null ? onFrame : undefined}
                  onError={fail}
                  onIntroEnd={onIntroEnd}
                />
              </ErrorBoundary>
            )}
          </div>
        )}
        <div className="xp__bar xp__bar--top" aria-hidden="true" />
        <div className="xp__bar xp__bar--bottom" aria-hidden="true" />

        {ui && (
          <ExperienceHud
            labels={labels}
            mode={activeMode}
            daylight={daylight}
            sound={sound}
            soundAvailable={soundAvailable}
            playing={playing}
            introDone={introDone}
            prompt={!scrolled && activeMode === "story"}
            hint={hint}
            exploreButton={exploreButton}
            backButton={backButton}
            onPlaying={setPlaying}
            onDaylight={setDaylight}
            onSound={toggleSound}
            onMode={setExperienceMode}
            onBegin={begin}
            onZoom={(dir) => apiRef.current?.zoom(dir)}
            onReset={() => apiRef.current?.reset()}
          />
        )}
        {ui && exploring && activeMode === "walk" && <Joystick input={input} label={labels.joystick} />}
        {ui && selected && <UnitPanel residence={selected} locale={locale} labels={labels} onClose={() => setSelectedId(null)} />}

        {kind === "reduced" && !running && (
          <div className="xp__offer">
            <p role={asked ? "status" : undefined}>{asked ? labels.loading : labels.stills}</p>
            {!asked && (
              <button type="button" className="xp__btn xp__btn--text xp__offer-btn" onClick={() => setAsked(true)}>
                {labels.load3d}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="xp__panels">
        <div className="xp__panel xp__panel--hero">
          {hero}
          {after}
        </div>
        <ol className="xp__beats" aria-label={labels.beatsLabel}>
          {beats.map((beat) => (
            <li key={beat.id} className="xp__panel xp__beat" data-beat={beat.id}>
              <Image className="xp__still" src={beat.still.src} alt={beat.still.alt} fill sizes="100vw" />
              <div className="xp__caption" data-caption="">
                <p className="xp__eyebrow">{beat.eyebrow}</p>
                <div className="xp__title">{beat.title}</div>
                <div className="xp__body">{beat.body}</div>
                {beat.figures.length > 0 && (
                  <dl className="xp__figures">
                    {beat.figures.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {beat.link && (
                  <p className="xp__more">
                    <Link href={beat.link.href} className="xp__link">
                      {beat.link.label}
                    </Link>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {kind === "story" && (
        <ErrorBoundary name="StoryScroll">
          <StoryScroll root={rootRef} scroll={scroll} onProgress={wake} />
        </ErrorBoundary>
      )}
    </section>
  );
}
