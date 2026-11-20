"use client";

import type { RefObject } from "react";
import type { Daylight } from "./daylight";
import type { ExperienceLabels, ExperienceMode, ExploreMode } from "./types";

export type ExperienceHudProps = {
  labels: ExperienceLabels;
  mode: ExperienceMode;
  daylight: Daylight;
  sound: boolean;
  /** False where the browser cannot make sound: the button is left out. */
  soundAvailable: boolean;
  playing: boolean;
  /** The opening has reached the gate: the prompt changes from "skip" to "scroll". */
  introDone: boolean;
  /** Shown while the visitor has not scrolled yet. */
  prompt: boolean;
  /** A hint for the current way of exploring, for its first seconds. */
  hint: boolean;
  exploreButton: RefObject<HTMLButtonElement | null>;
  backButton: RefObject<HTMLButtonElement | null>;
  onPlaying: (playing: boolean) => void;
  onDaylight: (daylight: Daylight) => void;
  onSound: (on: boolean) => void;
  onMode: (mode: ExperienceMode) => void;
  onBegin: () => void;
  onZoom: (dir: 1 | -1) => void;
  onReset: () => void;
};

const icon = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, "aria-hidden": true } as const;

const EXPLORE_MODES: ExploreMode[] = ["orbit", "walk"];

/**
 * The controls over the scene. In the story: pause, day or dusk, sound, and the way into free
 * exploring. While exploring: the way back, orbit or walk, zoom and reset, day or dusk, sound.
 * Every control is a real button with a text label or an accessible name; pressed states are
 * announced with aria-pressed.
 */
export function ExperienceHud({
  labels,
  mode,
  daylight,
  sound,
  soundAvailable,
  playing,
  introDone,
  prompt,
  hint,
  exploreButton,
  backButton,
  onPlaying,
  onDaylight,
  onSound,
  onMode,
  onBegin,
  onZoom,
  onReset,
}: ExperienceHudProps) {
  const exploring = mode !== "story";
  const dusk = daylight === "dusk";

  const ambience = (
    <div className="xp__group">
      <button type="button" className="xp__btn" aria-pressed={dusk} aria-label={dusk ? labels.toDay : labels.toDusk} onClick={() => onDaylight(dusk ? "day" : "dusk")}>
        {dusk ? <SunIcon /> : <MoonIcon />}
      </button>
      {soundAvailable ? (
        <button type="button" className="xp__btn" aria-pressed={sound} aria-label={sound ? labels.soundOff : labels.soundOn} onClick={() => onSound(!sound)}>
          {sound ? <SoundOnIcon /> : <SoundOffIcon />}
        </button>
      ) : null}
    </div>
  );

  if (exploring) {
    return (
      <div className="xp__hud" data-hud="explore">
        <button ref={backButton} type="button" className="xp__btn xp__btn--text xp__back" onClick={() => onMode("story")}>
          <BackIcon />
          <span>{labels.backToStory}</span>
        </button>
        <div className="xp__modes" role="group" aria-label={labels.exploreMode}>
          {EXPLORE_MODES.map((m) => (
            <button key={m} type="button" className="xp__btn xp__btn--text" aria-pressed={mode === m} onClick={() => onMode(m)}>
              {m === "orbit" ? labels.orbit : labels.walk}
            </button>
          ))}
        </div>
        <div className="xp__tools">
          {mode === "orbit" ? (
            <div className="xp__group xp__group--column">
              <button type="button" className="xp__btn" aria-label={labels.zoomIn} onClick={() => onZoom(1)}>
                <PlusIcon />
              </button>
              <button type="button" className="xp__btn" aria-label={labels.zoomOut} onClick={() => onZoom(-1)}>
                <MinusIcon />
              </button>
              <button type="button" className="xp__btn" aria-label={labels.reset} onClick={onReset}>
                <ResetIcon />
              </button>
            </div>
          ) : null}
          {ambience}
        </div>
        {hint ? (
          <p className="xp__hint" aria-hidden="true">
            {mode === "walk" ? labels.walkHint : labels.orbitHint}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="xp__hud" data-hud="story">
      <div className="xp__tools">
        <div className="xp__group">
          <button type="button" className="xp__btn" aria-pressed={!playing} aria-label={playing ? labels.pause : labels.play} onClick={() => onPlaying(!playing)}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        </div>
        {ambience}
        <button ref={exploreButton} type="button" className="xp__btn xp__btn--text xp__explore" onClick={() => onMode("orbit")}>
          <CompassIcon />
          <span>{labels.explore}</span>
        </button>
      </div>
      {prompt ? (
        <button type="button" className="xp__prompt" onClick={onBegin}>
          <span>{introDone ? labels.scrollHint : labels.skipIntro}</span>
          <span className="xp__prompt-line" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function PauseIcon() {
  return (
    <svg {...icon}>
      <path d="M6 4v10M12 4v10" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg {...icon}>
      <path d="M5.5 3.5l9 5.5-9 5.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...icon}>
      <path d="M9 3.5v11M3.5 9h11" />
    </svg>
  );
}
function MinusIcon() {
  return (
    <svg {...icon}>
      <path d="M3.5 9h11" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg {...icon}>
      <path d="M3.8 7.2A5.6 5.6 0 1 1 3.6 10.5" />
      <path d="M3.5 3.5v3.9h3.9" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg {...icon}>
      <path d="M14.2 10.9A6 6 0 0 1 7.1 3.8a6 6 0 1 0 7.1 7.1z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg {...icon}>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 2v1.8M9 14.2V16M2 9h1.8M14.2 9H16M4.05 4.05l1.3 1.3M12.65 12.65l1.3 1.3M4.05 13.95l1.3-1.3M12.65 5.35l1.3-1.3" />
    </svg>
  );
}
function SoundOnIcon() {
  return (
    <svg {...icon}>
      <path d="M3 7v4h2.6L9 14V4L5.6 7z" />
      <path d="M11.6 6.6a3.4 3.4 0 0 1 0 4.8M13.6 4.8a6 6 0 0 1 0 8.4" />
    </svg>
  );
}
function SoundOffIcon() {
  return (
    <svg {...icon}>
      <path d="M3 7v4h2.6L9 14V4L5.6 7z" />
      <path d="M12 7l3.5 4M15.5 7L12 11" />
    </svg>
  );
}
function CompassIcon() {
  return (
    <svg {...icon}>
      <circle cx="9" cy="9" r="6.2" />
      <path d="M11.6 6.4l-1.5 3.7-3.7 1.5 1.5-3.7z" />
    </svg>
  );
}
function BackIcon() {
  return (
    <svg {...icon} className="xp__flip">
      <path d="M10.5 4.5L6 9l4.5 4.5" />
    </svg>
  );
}
