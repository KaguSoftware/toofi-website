"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ErrorBoundary } from "@/components/monitoring/ErrorBoundary";
import { reportError } from "@/lib/monitoring";
import { residencesIn, sceneImage } from "@/lib/sawad/data";
import { playsReel, qualityTier, readCapabilityEnv, render3D, type Render3D } from "../scene/capability";
import type { QualityTier, SceneMarker, ViewId } from "../scene/types";
import { audioSupported, createAmbience, MUSIC_BED, type Ambience } from "./audio";
import type { Daylight } from "./daylight";
import { EARLY_ATTR, earlyScript, preloadFirstAssets } from "./early";
import { ExperienceHud } from "./ExperienceHud";
import { Joystick } from "./Joystick";
import StoryReel from "./StoryReel";
import { initialRigState, type ExperienceApi, type ExperienceControl, type ExperienceMode, type RigState, type ScrollState, type ZaitunExperienceProps } from "./types";
import { UnitPanel } from "./UnitPanel";
import type { WalkInput } from "./walk";
import "./experience.css";

// Lazy chunks. The WebGL scene (three.js, React Three Fiber, Theatre.js) is fetched only when a
// visitor opens the explorer; the scroll driver (GSAP) when the story runs. three.js is asked for
// first and by itself, so that it is evaluated in a task of its own: together the 3D code was one
// 146 ms task on a phone (S1-6). The effect chain follows as a third chunk (ExperienceRoot, `loadPostFX`).
const ExperienceCanvas = dynamic(() => import("three").then(() => import("./ExperienceCanvas")), { ssr: false });
const StoryScroll = dynamic(() => import("./StoryScroll"), { ssr: false });

/**
 * What this device gets, once the browser has been asked: whether the reel plays, whether the 3D
 * can be had (freely, with a word about its size, or not at all) and at which tier; and, in
 * development, a capture that was asked for in the address.
 */
type Device = { verdict: Render3D; reducedMotion: boolean; tier: QualityTier; reel: boolean; capture: Capture | null };
type Capture = { at: number | null; dusk: boolean; view: ViewId | null; reel: boolean };
type Setup = { tier: QualityTier; holdAt: number | null; view: ViewId | null; reel: boolean };

const CAPTURE_FRAMES = 30;
const HINT_MS = 6000;
const noopSubscribe = () => () => {};

let deviceCache: Device | null = null;
function deviceSnapshot(): Device {
  // 3D on the same terms as the explorer; reduced motion is handled here, not refused.
  deviceCache ??= (() => {
    const env = readCapabilityEnv("explorer");
    return { verdict: render3D(env), reducedMotion: env.reducedMotion, tier: qualityTier({ ...env, width: window.innerWidth, dpr: window.devicePixelRatio || 1 }), reel: playsReel(env), capture: captureAt() };
  })();
  return deviceCache;
}
/** Test hook: forget what the device was found to be. */
export function resetDeviceCache(): void {
  deviceCache = null;
}

const VIEWS: readonly ViewId[] = ["flight", "street", "terrace", "aerial"];

/**
 * Development only, and the one place the live story still runs (visitors get it as the reel):
 * `?story=32` holds the story at sequence position 32 and hides the controls,
 * for rendering stills; `&dusk=1` renders it at dusk; `&view=street` plays another start view's
 * opening over its own poster (to check each poster-to-scene handover). `?reel=1` records the
 * reel instead (ReelCapture.tsx): the live story at the reel's quality, drawn frame by frame as
 * scripts/render-story-reel.mjs asks; `&view=` picks the opening.
 */
export function captureAt(): Capture | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("story");
  const at = raw === null ? NaN : Number(raw);
  const view = VIEWS.find((v) => v === params.get("view")) ?? null;
  const dusk = params.get("dusk") === "1";
  if (params.get("reel") === "1") return { at: null, dusk, view, reel: true };
  return Number.isFinite(at) ? { at, dusk, view, reel: false } : null;
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
 * - Nearly every device gets the reel on top of that (StoryReel.tsx): the story as video. The
 *   stage stays put while the page scrolls, an opening plays under a letterbox, and the scroll
 *   moves the picture from beat to beat. No 3D code, model or GPU is needed for it.
 * - "Explore" brings in the live 3D scene, on the shot the reel was showing: orbit, walk, the
 *   homes, day and dusk. Leaving the explorer lets the scene go and returns to the reel. A slow
 *   link or a small device is told the size of the download on the button; a device that cannot
 *   draw the scene has no button.
 * - With reduced motion nothing moves unasked: the stills stay, and a button opens the explorer,
 *   where only the visitor moves the camera. Save-Data and a 2g link get the stills alone
 *   (capability.ts `playsReel`, `render3D`).
 *
 * Before any of this code has arrived, a small inline script (early.ts) has made the same
 * decision about the reel: it starts the opening and keeps the stills from loading.
 *
 * The reel and the canvas are hidden from assistive technology; the captions, in document order,
 * are the story.
 */
/** The homes a visitor can pick while exploring: the same sample data the residence finder shows. */
const HOMES = residencesIn("zaitun-hills");

export function ZaitunExperience({ locale, view: ownerView, live, poster: ownerPoster, hero, after, beats, labels }: ZaitunExperienceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const exploreButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const apiRef = useRef<ExperienceApi | null>(null);
  const control = useRef<ExperienceControl | null>(null);
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
  // "lost": the browser took the GPU context away; the scene can be asked for again.
  const [status, setStatus] = useState<"off" | "running" | "failed" | "lost">("off");
  // The reel plays until one of its files fails; then the stills are the story.
  const [reelFailed, setReelFailed] = useState(false);
  // The sequence position the reel was showing when the explorer was asked for: its first shot.
  const [startAt, setStartAt] = useState<number | null>(null);
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

  // What this visitor gets: the reel, or the stills; and whether the 3D can be had on top.
  const possible = live && !!device && device.verdict !== "no" && status !== "failed";
  // "live": the story drawn live, which only a development capture asks for (the reel is recorded from it).
  const kind = !live || !device ? "stills" : device.capture ? "live" : device.reel && !reelFailed ? "reel" : "stills";
  // Everywhere else the 3D comes on request, as an explorer, and goes again when it is left.
  const onRequest = kind !== "live";
  const loads = kind === "live" || (possible && asked);
  const running = loads && status === "running";
  // A word beside the picture: the 3D is on its way, was taken away, or waits behind a button (the stills).
  const offer = onRequest && possible && !running && (kind === "stills" || asked || status === "lost");
  const capture = setup?.holdAt != null || !!setup?.reel || kind === "live";
  // An explorer on request has no story camera to return to: it is the whole live scene.
  const activeMode: ExperienceMode = onRequest && mode === "story" ? "orbit" : mode;
  const exploring = running && activeMode !== "story";
  const ui = !capture && (kind === "reel" || running);

  const fail = useCallback(
    (err: unknown) => {
      reportError("ZaitunExperience", err, { view });
      // The explorer is over: the reel, held while it was open, moves again.
      setAsked(false);
      setStatus("failed");
    },
    [view],
  );
  const onBoundaryError = useCallback(() => {
    setAsked(false);
    setStatus("failed");
  }, []);
  // Browsers take GPU contexts away, mostly from tabs in the background. The stills come back,
  // and the visitor can ask for the scene again (S5-10). `severity` marks it for the error sink.
  const onContextLost = useCallback(() => {
    reportError("ZaitunExperience", new Error("WebGL context lost"), { view, severity: "warning", recoverable: true });
    setAsked(false);
    setMode("story");
    setSelectedId(null);
    setStatus("lost");
  }, [view]);
  // Too slow to watch at the lowest quality level: the stills serve this device better.
  const onStarved = useCallback(() => {
    reportError("ZaitunExperience", new Error("The frame rate stayed too low at the lowest quality level; showing the stills"), { view, severity: "warning", stage: "starved" });
    setAsked(false);
    setStatus("failed");
  }, [view]);
  const ask = useCallback(() => {
    // From the reel the explorer opens on the shot it was showing; from the stills, on the aerial.
    setStartAt(kind === "reel" ? rig.current.head : null);
    setAsked(true);
    setStatus((s) => (s === "lost" ? "off" : s));
  }, [kind]);
  const onReelError = useCallback(() => setReelFailed(true), []);
  const onFirstFrame = useCallback(() => setStatus((s) => (s === "failed" ? s : "running")), []);
  const onFrame = useCallback((n: number) => {
    if (n === CAPTURE_FRAMES) setCaptureReady(true);
  }, []);
  const onReelReady = useCallback(() => setCaptureReady(true), []);
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
    const tier = hold ? "high" : qualityTier({ ...env, width: window.innerWidth, dpr: window.devicePixelRatio || 1 });
    // The first files start now, not when the 3D code has arrived (the early script has usually
    // asked already; this covers a page reached by a link, and a scene opened on request).
    preloadFirstAssets(tier);
    setSetup({ holdAt: hold?.at ?? null, view: hold?.view ?? null, tier, reel: !!hold?.reel });
    if (hold?.dusk) setDaylight("dusk");
  }, []);

  // The early script's mark has done its work once React knows the device: `data-state` takes over.
  useEffect(() => {
    if (device) rootRef.current?.removeAttribute(EARLY_ATTR);
  }, [device]);

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
    if (kind === "stills" || interacted) return;
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
        // An explorer on request has no story camera: leaving it leaves the 3D, and the next one
        // starts from nothing (it says it is loading until its own first frame).
        if (onRequest) {
          setAsked(false);
          setStatus((s) => (s === "running" ? "off" : s));
        }
        setMode("story");
        setHint(false);
        return;
      }
      setInteracted(true);
      setMode(next);
      setHint(true);
      // The first step into the explorer is what asks for the 3D.
      if (onRequest && !asked) ask();
    },
    [onRequest, asked, ask],
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
    // The bed is an extra: if its file fails, that is reported and the ambience plays on.
    ambience.current ??= createAmbience(undefined, undefined, {
      src: MUSIC_BED.src,
      onError: (err) => reportError("ZaitunExperience", err, { stage: "music" }),
    });
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

  // Next keeps a page it navigates away from, hidden, and shows it again on the way back (React
  // Activity). Hiding runs the effect cleanups and reveals run the effects again, layout effects
  // at once. The scene's loop runs outside React and kept drawing behind every other page
  // (S5-1), so it is stopped here; and the sound is stopped, not closed, so that it picks up
  // where it was instead of staying silent under a button that says it is on (S5-2).
  const pauseScene = useCallback(() => control.current?.pause(), []);
  const resumeScene = useCallback(() => control.current?.resume(), []);
  const parkedSound = useRef(false);
  const parkSound = useCallback(() => {
    if (!ambience.current?.running) return;
    ambience.current.stop();
    parkedSound.current = true;
  }, []);
  const unparkSound = useCallback(() => {
    if (!parkedSound.current) return;
    parkedSound.current = false;
    ambience.current?.start().catch((err) => {
      reportError("ZaitunExperience", err, { stage: "audio" });
      setSound(false);
    });
  }, []);
  const closeSound = useCallback(() => {
    ambience.current?.dispose();
    ambience.current = null;
  }, []);
  useLayoutEffect(() => {
    const el = rootRef.current;
    resumeScene();
    unparkSound();
    return () => {
      pauseScene();
      parkSound();
      // A hidden page stays in the document; one that has left it is gone for good.
      setTimeout(() => {
        if (!el?.isConnected) closeSound();
      }, 0);
    };
  }, [pauseScene, resumeScene, parkSound, unparkSound, closeSound]);

  const markers: SceneMarker[] = useMemo(() => HOMES.map((r) => ({ id: r.id, kind: r.kind, slot: r.slot, status: r.status, label: r.id })), []);
  const selected = exploring && selectedId ? HOMES.find((r) => r.id === selectedId) : undefined;

  const begin = useCallback(() => {
    setInteracted(true);
    const first = rootRef.current?.querySelector<HTMLElement>("[data-beat]");
    first?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const letterbox = kind !== "stills" && !interacted && !scrolled && !capture;
  // What the stills, or the reel, say beside the picture while the 3D is not on screen.
  const note = !device ? null : asked ? labels.loading : status === "lost" ? labels.lost : device.verdict === "offer" ? labels.heldBack : device.reducedMotion ? labels.stills : null;
  const ready = capture ? captureReady : running;

  return (
    <section
      ref={rootRef}
      className="xp"
      data-state={kind === "stills" ? "stills" : "story"}
      data-reel={kind === "reel" ? "true" : undefined}
      data-mode={exploring ? activeMode : "story"}
      data-running={running ? "true" : undefined}
      data-letterbox={letterbox ? "closed" : "open"}
      data-capture={capture ? "true" : undefined}
      data-scene-ready={ready ? "true" : undefined}
      aria-label={labels.region}
      // The early script marks this element before React arrives.
      suppressHydrationWarning
    >
      <div className="xp__stage">
        <div className="xp__poster">
          {/* Home's largest paint: found in the head and fetched ahead of the fonts. */}
          <Image src={poster.src} alt={poster.alt} fill preload fetchPriority="high" sizes="100vw" />
        </div>
        {/* In the server's HTML for everyone (the server cannot know the device); it stays where the reel plays. */}
        {live && (device === null || kind === "reel") && (
          <ErrorBoundary name="StoryReel" fallback={<OnMount run={onReelError} />}>
            <StoryReel view={ownerView} playing={playing && onScreen && tabVisible} active={!asked} scroll={scroll} rig={rig} onIntroEnd={onIntroEnd} onError={onReelError} />
          </ErrorBoundary>
        )}
        {/* Only in the server's HTML, where it runs as the page is parsed, after the reel's elements and before the stills; React never runs it. */}
        {live && device === null && <script dangerouslySetInnerHTML={{ __html: earlyScript(ownerView) }} />}
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
                  startAt={onRequest ? startAt : null}
                  reel={setup.reel}
                  onReelReady={onReelReady}
                  playing={onScreen && tabVisible && (playing || exploring)}
                  moving={playing}
                  markers={exploring ? markers : undefined}
                  selectedId={exploring ? selectedId : null}
                  scroll={scroll}
                  input={input}
                  rig={rig}
                  apiRef={apiRef}
                  controlRef={control}
                  onSelect={setSelectedId}
                  onFirstFrame={onFirstFrame}
                  onFrame={setup.holdAt !== null ? onFrame : undefined}
                  onError={fail}
                  onContextLost={onContextLost}
                  onStarved={onStarved}
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
            mode={exploring ? activeMode : "story"}
            daylight={daylight}
            sound={sound}
            soundAvailable={soundAvailable}
            playing={playing}
            introDone={introDone}
            prompt={!scrolled && !exploring}
            hint={hint}
            canPause={kind !== "reel" || !introDone}
            canDusk={kind !== "reel"}
            exploreLabel={!possible ? null : device?.verdict === "offer" ? labels.load3dSized[device.tier] : undefined}
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

        {offer && (
          <div className="xp__offer">
            {note && <p role={asked ? "status" : undefined}>{note}</p>}
            {/* The stills carry the button; over the reel it is "Explore" in the controls. */}
            {!asked && kind === "stills" && (
              <button type="button" className="xp__btn xp__btn--text xp__offer-btn" onClick={ask}>
                {device?.verdict === "offer" ? labels.load3dSized[device.tier] : labels.load3d}
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

      {kind !== "stills" && (
        <ErrorBoundary name="StoryScroll">
          <StoryScroll root={rootRef} scroll={scroll} onProgress={wake} />
        </ErrorBoundary>
      )}
    </section>
  );
}
