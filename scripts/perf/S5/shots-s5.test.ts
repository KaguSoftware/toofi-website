import { describe, expect, it } from "vitest";
import { S5_SHOTS, S5_SHOT_NAMES, planS5 } from "./shots-s5.mjs";

describe("S5 shots", () => {
  it("records every camera inside its own plan", () => {
    for (const name of S5_SHOT_NAMES) {
      const shot = S5_SHOTS[name as keyof typeof S5_SHOTS];
      expect(shot.record[1]).toBeGreaterThan(shot.record[0]);
      expect(shot.note.length).toBeGreaterThan(10);
    }
  });

  it("turns the sweep into one scroll per frame from the top to the last beat", () => {
    const plan = planS5("scroll-sweep", { scrollRange: { top: 0, bottom: 3600 } });
    const scrolls = plan.steps.filter((s) => s.do === "scrollTo");
    expect(scrolls).toHaveLength(361);
    expect(scrolls[0]).toMatchObject({ frame: 200, y: 0 });
    expect(scrolls.at(-1)).toMatchObject({ frame: 560, y: 3600 });
    expect(plan.needsScroll).toBe(true);
    expect(() => planS5("scroll-sweep")).toThrow(/scroll range/);
  });

  it("adds the recording window and an optional level pin, in frame order", () => {
    const plan = planS5("fling", { level: 2 });
    expect(plan.steps[0]).toMatchObject({ frame: 1, do: "pin", level: 2 });
    expect(plan.steps.map((s) => s.frame)).toEqual([...plan.steps.map((s) => s.frame)].sort((a, b) => a - b));
    expect(plan.steps.filter((s) => s.do === "record")).toHaveLength(2);
    expect(plan.lastFrame).toBe(342);
    expect(() => planS5("nope")).toThrow(/unknown/);
  });
});
