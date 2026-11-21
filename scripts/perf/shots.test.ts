import { describe, expect, it } from "vitest";
import { LEVELS, REFERENCE_LEVEL, SHOT_NAMES, SHOTS, planFor } from "./shots.mjs";

describe("the fixed cameras", () => {
  it("covers every camera the optimization plan names", () => {
    expect(SHOT_NAMES).toEqual(["poster-hold", "opening", "stop-1", "stop-2", "stop-3", "stop-4", "stop-5", "aerial", "orbit", "walk", "dusk"]);
  });

  it("records inside each shot and captures after its steps have settled", () => {
    for (const [name, shot] of Object.entries(SHOTS)) {
      expect(shot.record[0], name).toBeLessThan(shot.record[1]);
      const lastStep = Math.max(0, ...shot.steps.map((s: { frame: number }) => s.frame));
      expect(shot.capture, name).toBeGreaterThan(lastStep);
    }
  });

  it("keeps the poster-hold capture inside the 2 s hold", () => {
    expect(SHOTS["poster-hold"].capture).toBeLessThan(120);
  });

  it("matches the quality ranges of quality.ts", () => {
    expect(LEVELS).toEqual({ high: [1, 2, 3], low: [0, 1] });
    expect(REFERENCE_LEVEL).toEqual({ high: 3, low: 1 });
  });
});

describe("planFor", () => {
  it("adds the level pin, the recording window and the capture, sorted by frame", () => {
    const { steps, lastFrame } = planFor("stop-2", { level: 3, record: true, capture: true, width: 640 });
    expect(steps.map((s: { frame: number }) => s.frame)).toEqual([...steps.map((s: { frame: number }) => s.frame)].sort((a, b) => a - b));
    expect(steps).toContainEqual({ frame: 1, do: "pin", level: 3 });
    expect(steps).toContainEqual({ frame: 5, do: "scrollToBeat", beat: 2 });
    expect(steps).toContainEqual({ frame: SHOTS["stop-2"].capture, do: "capture", name: "stop-2", width: 640 });
    expect(steps.filter((s: { do: string }) => s.do === "record")).toHaveLength(2);
    expect(lastFrame).toBeGreaterThan(SHOTS["stop-2"].record[1]);
  });

  it("leaves the level alone for an adaptive run and skips what is not asked for", () => {
    const { steps } = planFor("poster-hold", { level: null, record: false, capture: false });
    expect(steps).toEqual([]);
  });

  it("drags one pointer move per frame for the orbit", () => {
    const moves = SHOTS.orbit.steps.filter((s: { type?: string }) => s.type === "pointermove");
    expect(moves).toHaveLength(40);
    expect(new Set(moves.map((m: { frame: number }) => m.frame)).size).toBe(40);
  });

  it("refuses an unknown camera", () => {
    expect(() => planFor("nowhere")).toThrow(/unknown shot/);
  });
});
