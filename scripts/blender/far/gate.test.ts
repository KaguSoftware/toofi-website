import { describe, expect, it } from "vitest";
import { DEFAULT_SHOTS, EXTRA_SHOTS, MODES, blockDiff, blockedPatterns, candidateFile, moveCapture, planShot, verdict } from "./gate.mjs";

describe("the far set's look gate", () => {
  it("refuses the full files to keep the far set, and the far files to fall back to the full one", () => {
    expect(blockedPatterns("far")).toEqual(["**/sawad/models/compound-zaitun-high.*.glb", "**/sawad/models/compound-zaitun-low.*.glb"]);
    expect(blockedPatterns("full")).toEqual(["**/sawad/models/compound-zaitun-far-*.glb"]);
    expect(blockedPatterns("mixed")).toEqual([]);
    expect(() => blockedPatterns("near")).toThrow("unknown mode near");
    expect(MODES).toEqual(["far", "full", "mixed"]);
  });

  it("checks the plan's cameras for the far set and every camera otherwise", () => {
    expect(DEFAULT_SHOTS.far).toEqual(["poster-hold", "aerial", "opening"]);
    expect(DEFAULT_SHOTS.full).toBeNull();
  });

  it("states each frame against the 2/255 gate", () => {
    expect(verdict({ tier: "high", shot: "aerial", mean: 1.234, changedShare: 0.05, worst: 90 }, 2)).toBe("high aerial      mean 1.23/255, changed 5.0%, worst 90 pass");
    expect(verdict({ tier: "low", shot: "poster-hold", mean: 2.5, changedShare: 0.2, worst: 120 }, 2)).toContain("FAIL");
    expect(verdict({ tier: "low", shot: "dusk", missing: true }, 2)).toBe("low dusk: no reference");
    expect(verdict({ tier: "low", shot: "dusk", error: "no capture" }, 2)).toBe("low dusk: no capture");
    expect(verdict({ candidate: "c2", tier: "high", shot: "aerial", mean: 0.5, changedShare: 0, worst: 3 }, 2)).toMatch(/^\[c2\] high aerial/);
  });

  it("serves a candidate's far files from scripts/blender/out", () => {
    expect(candidateFile("c1", "low")).toMatch(/scripts\/blender\/out\/cand-c1\/compound-zaitun-far-low\.glb$/);
    expect(() => candidateFile("../x", "low")).toThrow("bad candidate name");
  });

  it("compares block averages, so grain cancels and a real change stays", () => {
    const img = (fill: (x: number, y: number) => number) => {
      const data = new Uint8Array(8 * 8 * 4);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) for (let c = 0; c < 4; c++) data[(y * 8 + x) * 4 + c] = fill(x, y);
      return { width: 8, height: 8, data };
    };
    const flat = img(() => 100);
    const grain = img((x, y) => ((x + y) % 2 ? 110 : 90)); // same mean in every 4 x 4 block
    const changed = img((x, y) => (x < 4 && y < 4 ? 140 : 100)); // one block brighter by 40
    expect(blockDiff(flat, grain)).toBe(0);
    expect(blockDiff(flat, changed)).toBe(10); // 40 over a quarter of the blocks
    expect(verdict({ tier: "high", shot: "aerial", mean: 1, blockMean: 0.25, changedShare: 0, worst: 9 }, 2)).toContain("(grain-free 0.25)");
  });

  it("moves a camera's capture to a later frame", () => {
    const plan = { steps: [{ frame: 5, do: "click" }, { frame: 330, do: "capture" }, { frame: 0, do: "capture" }], lastFrame: 332 };
    moveCapture(plan, 900);
    expect(plan.steps.map((st) => [st.frame, st.do])).toEqual([[5, "click"], [900, "capture"], [900, "capture"]]);
    expect(plan.lastFrame).toBe(902);
  });

  it("plans the close-up camera itself and hands every other camera to the rig", () => {
    const rig = (name: string, opts: unknown) => ({ steps: [], lastFrame: 0, name, opts });
    const close = planShot("close", rig, { level: 3, width: 1440 });
    expect(close.steps[0]).toEqual({ frame: 1, do: "pin", level: 3 });
    expect(close.steps.at(-1)).toEqual({ frame: EXTRA_SHOTS.close.capture, do: "capture", name: "close", width: 1440 });
    expect(close.lastFrame).toBe(EXTRA_SHOTS.close.capture + 2);
    expect(close.steps.map((s: { frame: number }) => s.frame)).toEqual([...close.steps.map((s: { frame: number }) => s.frame)].sort((a, b) => a - b));
    expect(planShot("aerial", rig, { level: 1 })).toMatchObject({ name: "aerial", opts: { level: 1, record: false, capture: true, width: 960 } });
  });
});
