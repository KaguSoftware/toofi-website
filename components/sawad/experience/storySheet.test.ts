// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEW_IDS } from "../scene/viewpoints";
import { INTRO_SECONDS, STORY_END } from "./beats";
import { introKeys, introObject, STORY_CAMERA, storyKeys, storyTracks, type StoryKey } from "./story";
import { openStoryStudio, storyPose, storyState, trackKeyframes } from "./storySheet";

const key = (at: number, x: number, ease: StoryKey["ease"]): StoryKey => ({ at, position: [x, 0, 0], target: [0, 0, 0], fov: 40, focus: 10, blur: 0, ease });

afterEach(() => vi.unstubAllEnvs());

describe("trackKeyframes", () => {
  const keys = [key(0, 0, "rest"), key(10, 10, "through"), key(20, 40, "through"), key(30, 40, "rest")];
  const frames = trackKeyframes(keys, ["position", "x"], "t");

  it("writes one bezier keyframe per key at its time and value", () => {
    expect(frames.map((f) => [f.id, f.position, f.value, f.type])).toEqual([
      ["t-0", 0, 0, "bezier"],
      ["t-1", 10, 10, "bezier"],
      ["t-2", 20, 40, "bezier"],
      ["t-3", 30, 40, "bezier"],
    ]);
    for (const f of frames) expect(f.connectedRight).toBe(true);
  });

  it("gives rest keys flat handles", () => {
    expect(frames[0].handles).toEqual([2 / 3, 1, 1 / 3, 0]);
    // Arriving at the last (rest) key: no rise, so the left handle stays at the end value.
    expect(frames[3].handles[1]).toBe(1);
  });

  it("gives through keys matching in and out slopes (the neighbours' average)", () => {
    const slope = (40 - 0) / 20; // 2 units per second at key 1
    const f = frames[1];
    const inSlope = ((1 - f.handles[1]) * 10) / (10 / 3);
    const outSlope = (f.handles[3] * 30) / (10 / 3);
    expect(inSlope).toBeCloseTo(slope, 9);
    expect(outSlope).toBeCloseTo(slope, 9);
  });

  it("reads the right field for each path", () => {
    const k = { ...key(0, 0, "rest"), position: [1, 2, 3] as [number, number, number], target: [4, 5, 6] as [number, number, number], fov: 33, focus: 7, blur: 0.5 };
    const val = (p: Parameters<typeof trackKeyframes>[1]) => trackKeyframes([k], p, "x")[0].value;
    expect([val(["position", "y"]), val(["position", "z"]), val(["target", "x"]), val(["target", "z"]), val(["fov"]), val(["focus"]), val(["blur"])]).toEqual([2, 3, 4, 6, 33, 7, 0.5]);
  });
});

describe("storyState", () => {
  const state = storyState();
  const seq = state.sheetsById.Story.sequence;

  it("has a sequence as long as the story", () => {
    expect(seq.length).toBe(STORY_END);
    expect(seq.type).toBe("PositionalSequence");
  });

  it("has one object per camera with nine tracks each", () => {
    expect(Object.keys(seq.tracksByObject).sort()).toEqual([STORY_CAMERA, ...VIEW_IDS.map(introObject)].sort());
    for (const [name, obj] of Object.entries(seq.tracksByObject)) {
      expect(Object.keys(obj.trackIdByPropPath), name).toHaveLength(9);
      expect(Object.keys(obj.trackData), name).toHaveLength(9);
      for (const id of Object.values(obj.trackIdByPropPath)) expect(obj.trackData[id].keyframes).toHaveLength(storyTracks()[name].length);
    }
  });
});

describe("storyPose", () => {
  const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));

  it("returns each story key's pose exactly at its time", () => {
    for (const k of storyKeys()) {
      const pose = storyPose("flight", k.at);
      close(pose.position, k.position);
      close(pose.target, k.target);
      expect(pose.fov).toBeCloseTo(k.fov, 3);
      expect(pose.focus).toBeCloseTo(k.focus, 3);
      expect(pose.blur).toBeCloseTo(k.blur, 3);
    }
  });

  it("returns each opening's keys on its own view before the intro ends", () => {
    for (const view of VIEW_IDS) {
      for (const k of introKeys(view).filter((x) => x.at < INTRO_SECONDS)) {
        const pose = storyPose(view, k.at);
        close(pose.position, k.position);
        close(pose.target, k.target);
        expect(pose.fov).toBeCloseTo(k.fov, 3);
      }
    }
  });

  it("switches from the opening to the story camera at INTRO_SECONDS", () => {
    const first = storyKeys()[0];
    close(storyPose("aerial", INTRO_SECONDS).position, first.position);
    const opening = introKeys("aerial")[0];
    close(storyPose("aerial", 0).position, opening.position);
    expect(storyPose("aerial", 0).position).not.toEqual(storyPose("flight", 0).position);
  });

  it("clamps positions outside the story", () => {
    expect(storyPose("flight", -5)).toEqual(storyPose("flight", 0));
    expect(storyPose("flight", STORY_END + 50)).toEqual(storyPose("flight", STORY_END));
  });
});

describe("openStoryStudio", () => {
  it("does nothing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(openStoryStudio()).resolves.toBe(false);
  });
});
