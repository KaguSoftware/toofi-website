import { describe, expect, it } from "vitest";
import { ACTIONS, tapsTable, worstSince } from "./taps.mjs";

describe("worstSince", () => {
  it("returns the slowest event that began after the cut-off", () => {
    const ev = [
      { start: 10, duration: 400 },
      { start: 120, duration: 90 },
      { start: 130, duration: 140 },
    ];
    expect(worstSince(ev, 100)).toMatchObject({ duration: 140 });
    expect(worstSince(ev, 500)).toBeNull();
  });
});

describe("tapsTable", () => {
  it("prints a row per action with the split of the last slow event", () => {
    const table = tapsTable([{ profile: "phone", route: "/residences", actions: [{ label: ACTIONS[0].label, n: 3, medianMs: 120, worstMs: 210, last: { delay: 5, processing: 100, present: 20 } }] }]);
    expect(table).toContain("Viewpoint button");
    expect(table).toContain("phone");
  });
});
