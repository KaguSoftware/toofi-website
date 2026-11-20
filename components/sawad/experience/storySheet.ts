import { getProject, types, type ISheet, type ISheetObject } from "@theatre/core";
import type { Vec3, ViewId } from "../scene/types";
import { VIEW_IDS, type CameraPose } from "../scene/viewpoints";
import { INTRO_SECONDS, STORY_END } from "./beats";
import { STORY_CAMERA, introObject, storyTracks, type StoryKey } from "./story";
import exported from "./story.theatre.json";

/**
 * The story camera as a Theatre.js sheet. The keyframes come from story.ts, converted here into
 * a Theatre project state, so the same sheet can be opened and retimed in Theatre Studio
 * (development only, `?studio=1`). A state exported from Studio and saved as story.theatre.json
 * takes over from the generated one; see README.md.
 */
export const STORY_PROJECT = "Zaitun Hills story";
export const STORY_SHEET = "Story";

export type StoryPose = CameraPose & { focus: number; blur: number };

/** The numbers a camera object animates, as paths into its props. */
const PROP_PATHS = [
  ["position", "x"],
  ["position", "y"],
  ["position", "z"],
  ["target", "x"],
  ["target", "y"],
  ["target", "z"],
  ["fov"],
  ["focus"],
  ["blur"],
] as const;
type PropPath = (typeof PROP_PATHS)[number];

function read(k: StoryKey, path: PropPath): number {
  if (path.length === 1) return k[path[0]];
  const axis = { x: 0, y: 1, z: 2 }[path[1]];
  return k[path[0]][axis];
}

type Keyframe = { id: string; position: number; value: number; connectedRight: boolean; handles: [number, number, number, number]; type: "bezier" };

/** Slope of a track at key i: zero where the camera rests, the neighbours' average where it passes through. */
function slopeAt(keys: StoryKey[], values: number[], i: number): number {
  if (i === 0 || i === keys.length - 1 || keys[i].ease === "rest") return 0;
  return (values[i + 1] - values[i - 1]) / (keys[i + 1].at - keys[i - 1].at);
}

/**
 * One prop's keyframes. Each segment is a cubic Hermite curve written as Theatre bezier handles
 * (x handles at 1/3 and 2/3, so time runs evenly): every move eases in and out of a rest key
 * and runs smoothly through a "through" key, on every axis at once.
 */
export function trackKeyframes(keys: StoryKey[], path: PropPath, idPrefix: string): Keyframe[] {
  const values = keys.map((k) => read(k, path));
  const slopes = keys.map((_, i) => slopeAt(keys, values, i));
  return keys.map((k, i): Keyframe => {
    // The handle toward the previous key (left) and toward the next key (right), as fractions of that segment.
    let leftY = 1;
    let rightY = 0;
    if (i > 0) {
      const rise = values[i] - values[i - 1];
      if (Math.abs(rise) > 1e-9) leftY = 1 - (slopes[i] * (k.at - keys[i - 1].at)) / (3 * rise);
    }
    if (i < keys.length - 1) {
      const rise = values[i + 1] - values[i];
      if (Math.abs(rise) > 1e-9) rightY = (slopes[i] * (keys[i + 1].at - k.at)) / (3 * rise);
    }
    return { id: `${idPrefix}-${i}`, position: k.at, value: values[i], connectedRight: true, handles: [2 / 3, leftY, 1 / 3, rightY], type: "bezier" };
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The Theatre.js project state for the keys in story.ts. */
export function storyState() {
  const tracksByObject: Record<string, { trackIdByPropPath: Record<string, string>; trackData: Record<string, { type: "BasicKeyframedTrack"; __debugName: string; keyframes: Keyframe[] }> }> = {};
  for (const [object, keys] of Object.entries(storyTracks())) {
    const trackIdByPropPath: Record<string, string> = {};
    const trackData: (typeof tracksByObject)[string]["trackData"] = {};
    for (const path of PROP_PATHS) {
      const id = `${slug(object)}-${path.join("-")}`;
      trackIdByPropPath[JSON.stringify(path)] = id;
      trackData[id] = { type: "BasicKeyframedTrack", __debugName: `${object}:${JSON.stringify(path)}`, keyframes: trackKeyframes(keys, path, id) };
    }
    tracksByObject[object] = { trackIdByPropPath, trackData };
  }
  return {
    sheetsById: {
      [STORY_SHEET]: {
        staticOverrides: { byObject: {} },
        sequence: { type: "PositionalSequence" as const, length: STORY_END, subUnitsPerUnit: 30, tracksByObject },
      },
    },
    definitionVersion: "0.4.0",
    revisionHistory: ["story-ts"],
  };
}

const metres = (v: number) => types.number(v, { nudgeMultiplier: 0.5 });
const CAMERA_PROPS = {
  position: types.compound({ x: metres(0), y: metres(10), z: metres(0) }),
  target: types.compound({ x: metres(0), y: metres(0), z: metres(-10) }),
  fov: types.number(40, { range: [10, 90] }),
  focus: types.number(50, { range: [0.5, 2000] }),
  blur: types.number(0, { range: [0, 1] }),
};
type CameraObject = ISheetObject<typeof CAMERA_PROPS>;

type Story = { sheet: ISheet; camera: CameraObject; intro: Record<ViewId, CameraObject> };
// Theatre allows one configuration per project id for the life of the page, so the sheet is
// kept on the global object: a hot reload of this module in development reuses it.
const store = globalThis as typeof globalThis & { __zaitunStory?: Story };

/** The sheet and its camera objects, created on first use (client only). */
export function storySheet(): Story {
  const story = store.__zaitunStory;
  if (story) return story;
  // A state exported from Theatre Studio wins over the generated one.
  const state = (exported as unknown) ?? storyState();
  const sheet = getProject(STORY_PROJECT, { state }).sheet(STORY_SHEET);
  const intro = Object.fromEntries(VIEW_IDS.map((view) => [view, sheet.object(introObject(view), CAMERA_PROPS)])) as Record<ViewId, CameraObject>;
  const made: Story = { sheet, camera: sheet.object(STORY_CAMERA, CAMERA_PROPS), intro };
  store.__zaitunStory = made;
  return made;
}

const vec = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

/**
 * The camera at a sequence position: the opening for `view` before INTRO_SECONDS, the story
 * camera after it. Moves the sheet's playhead, which is what Theatre Studio shows too.
 */
export function storyPose(view: ViewId, position: number): StoryPose {
  const { sheet, camera, intro } = storySheet();
  const at = Math.min(STORY_END, Math.max(0, position));
  sheet.sequence.position = at;
  const v = (at < INTRO_SECONDS ? intro[view] : camera).value;
  return { position: vec(v.position), target: vec(v.target), fov: v.fov, focus: v.focus, blur: v.blur };
}

/**
 * Opens Theatre Studio on the story sheet. Development only: the editor is never part of a
 * production bundle. Export from Studio and save the file as story.theatre.json to keep the edits.
 */
export async function openStoryStudio(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  const studio = (await import("@theatre/studio")).default;
  studio.initialize();
  storySheet();
  return true;
}
