import type { ReactNode } from "react";
import type { BeatId } from "./beats";
import type { Daylight } from "./daylight";
import type { ViewId } from "../scene/types";

/** Free exploring: an orbiting camera, or a walk at eye height. */
export type ExploreMode = "orbit" | "walk";
/** What moves the camera: the story (intro, then the scroll), or the visitor. */
export type ExperienceMode = "story" | ExploreMode;

/** Scroll progress through the story, 0 to 1. Written by the page, read by the camera every frame. */
export type ScrollState = { progress: number };

/** What the camera rig tells the rest of the frame: the lens for depth of field, and where it is for the sound. */
export type RigState = {
  /** Sequence position the camera is showing. */
  head: number;
  /** Distance to the subject in metres, and blur strength 0 to 1. */
  focus: number;
  blur: number;
  /** How near the stream is, and how open the surroundings are (0 to 1). */
  water: number;
  open: number;
  /** 0 by day, 1 at dusk. */
  dusk: number;
  /** 0 at the poster handover (the live frame dressed as the poster), 1 once it has settled into the live look. */
  handover: number;
};

export const initialRigState = (): RigState => ({ head: 0, focus: 100, blur: 0, water: 0.3, open: 0.6, dusk: 0, handover: 1 });

/** The actions behind the on-screen buttons. */
export type ExperienceApi = {
  zoom: (dir: 1 | -1) => void;
  reset: () => void;
  /** Draws a frame when the loop is on demand (paused): the scroll moved. */
  wake: () => void;
};

/** One caption: the template renders the (editable) text on the server and hands it over. */
export type BeatContent = {
  id: BeatId;
  eyebrow: ReactNode;
  title: ReactNode;
  body: ReactNode;
  figures: Array<{ value: string; label: string }>;
  /** The still shown instead of the live scene (reduced motion, no 3D). */
  still: { src: string; alt: string };
  /** An optional link under the caption. */
  link?: { href: string; label: string };
};

export type ExperienceLabels = {
  region: string;
  loading: string;
  stills: string;
  load3d: string;
  pause: string;
  play: string;
  skipIntro: string;
  scrollHint: string;
  explore: string;
  backToStory: string;
  orbit: string;
  walk: string;
  exploreMode: string;
  toDusk: string;
  toDay: string;
  soundOn: string;
  soundOff: string;
  /** The credit the music's licence asks for, shown while the sound is on. */
  musicCredit: string;
  zoomIn: string;
  zoomOut: string;
  reset: string;
  orbitHint: string;
  walkHint: string;
  joystick: string;
  panelTitle: string;
  close: string;
  inFinder: string;
  beatsLabel: string;
};

export type ZaitunExperienceProps = {
  locale: "en" | "ar";
  /** Owner setting: the opening shot (its poster is `poster`). */
  view: ViewId;
  /** Owner setting: false shows the stills only, never the live scene. */
  live: boolean;
  poster: { src: string; alt: string };
  /** The hero panel (headline, lead) and what follows it in the first screen (the search). */
  hero: ReactNode;
  after?: ReactNode;
  beats: BeatContent[];
  labels: ExperienceLabels;
};

export type { Daylight };
