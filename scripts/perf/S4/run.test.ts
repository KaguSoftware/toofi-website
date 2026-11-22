import { describe, expect, it, vi } from "vitest";
import { COMMANDS, DPR_AT, MUTATE_AT, SETTLE, knockoutTable, paired, runOne } from "./run.mjs";

describe("S4 runner", () => {
  it("offers one command per kind of evidence", () => {
    expect(Object.keys(COMMANDS)).toEqual(["describe", "knockouts", "levels", "passes", "overdraw", "memory", "startup", "look"]);
    expect(DPR_AT).toBeLessThan(MUTATE_AT);
  });

  it("prints a knock-out as the frame before and after, what it saves, and whether that beats the noise", () => {
    const base = { tier: "high", level: 3, shot: "stop-1", variant: "base", ms: 14.4, after: 14.5, saved: -0.1, lo: -0.2, hi: 0.1, noise: 0.2, triangles: 2673696, trianglesAfter: 2673696, calls: 485, callsAfter: 485 };
    const table = knockoutTable([
      base,
      { ...base, variant: "shadow-off", after: 11.25, saved: 3.15, lo: 3.1, hi: 3.2, share: 0.22, sure: true, trianglesAfter: 1462190, callsAfter: 364 },
      { ...base, variant: "sky-last", after: 14.35, saved: 0.05, lo: -0.1, hi: 0.1, share: 0.003, sure: false },
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toBe("| Tier | Camera | Variant | Frame (ms) | After (ms) | Saves (ms) | Share of frame | Triangles | Calls |");
    expect(lines[2]).toBe("| high L3 | stop-1 | base | 14.40 | 14.50 | ±0.20 |  | 2,673,696 → 2,673,696 | 485 → 485 |");
    expect(lines[3]).toBe("| high L3 | stop-1 | shadow-off | 14.40 | 11.25 | 3.15 (3.10 to 3.20) | 22% | 2,673,696 → 1,462,190 | 485 → 364 |");
    expect(lines[4]).toContain("| 0.05 (-0.10 to 0.10) | 0% (noise) |");
  });

  it("loads Home with both probes, waits for the plan to finish and returns both snapshots", async () => {
    const scripts: string[] = [];
    const evaluated: string[] = [];
    const page = {
      on: vi.fn(),
      goto: vi.fn(async () => {}),
      waitForFunction: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      evaluate: vi.fn(async (fn: () => unknown) => {
        evaluated.push(String(fn));
        if (String(fn).includes("__rig.snapshot")) return { frames: [], errors: ["rig-warning"] };
        if (String(fn).includes("__s4.snapshot")) return { frames: [{ frame: 1, ms: 9, jsMs: 2 }], errors: [] };
        return { "stop-3": { dataUrl: "data:image/png;base64,AA==" } };
      }),
    };
    const context = {
      addInitScript: vi.fn(async (s: string) => void scripts.push(s)),
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => ({ send: vi.fn(async () => {}) })),
      close: vi.fn(async () => {}),
    };
    const browser = { newContext: vi.fn(async () => context) };

    const out = await runOne(browser, "http://127.0.0.1:1", { tier: "high", shot: "stop-3", level: 3, s4: { sync: true, mutations: [{ frame: 60, do: "hide", match: "^sky$" }] }, capture: true });

    // The rig's configuration and probe first, then S4's.
    expect(scripts).toHaveLength(4);
    expect(scripts[0]).toContain("__RIG_CONFIG__");
    expect(scripts[0]).toContain('"do":"pin","level":3');
    expect(scripts[2]).toBe('window.__S4_CONFIG__ = {"sync":true,"mutations":[{"frame":60,"do":"hide","match":"^sky$"}]};');
    expect(scripts[3]).toContain("window.__s4 = s4");
    expect(page.goto).toHaveBeenCalledWith("http://127.0.0.1:1/", { waitUntil: "domcontentloaded" });
    expect(out.s4.frames).toHaveLength(1);
    expect(out.errors).toEqual(["rig-warning"]);
    expect(out.captures["stop-3"]).toBeDefined();
    expect(context.close).toHaveBeenCalled();
  });

  it("times the shipped frame and the changed frame in one load, the change made between the two windows", async () => {
    const scripts: string[] = [];
    // stop-3 records from frame 220: 10 ticks before the change at 230, timed again from 230 + SETTLE.
    const frames = (ms: (frame: number) => number) => Array.from({ length: 10 + SETTLE + 10 }, (_, i) => ({ frame: 220 + i, ms: ms(220 + i), jsMs: 2, drawn: 6 }));
    const rigFrames = frames(() => 0).map((f) => ({ frame: f.frame, interval: 90, cpuMs: 12, renderMs: 10, gpu: {}, gpuComplete: true, calls: f.frame < 230 ? 6 * 485 : 6 * 364, triangles: 6000, sceneTriangles: 900, shadowTriangles: 0, sceneCalls: 100, shadowCalls: 0, passes: 6 * 43, dpr: 1.75, width: 2520, height: 1456 }));
    const page = {
      on: vi.fn(),
      goto: vi.fn(async () => {}),
      waitForFunction: vi.fn(async () => {}),
      waitForTimeout: vi.fn(async () => {}),
      evaluate: vi.fn(async (fn: () => unknown) => (String(fn).includes("__rig.snapshot") ? { frames: rigFrames, errors: [] } : { frames: frames((f) => (f < 230 ? 14.4 : 11.2)), errors: [], done: [{ do: "shadow" }], skipped: 0 })),
    };
    const context = { addInitScript: vi.fn(async (s: string) => void scripts.push(s)), newPage: vi.fn(async () => page), newCDPSession: vi.fn(async () => ({ send: vi.fn(async () => {}) })), close: vi.fn(async () => {}) };
    const browser = { newContext: vi.fn(async () => context) };

    const out = await paired(browser, "http://127.0.0.1:1", { tier: "high", shot: "stop-3", level: 3, mutations: [{ do: "shadow", cast: false }, { do: "dpr", value: 1.5, after: 3 }], repeat: 6, ticks: 10 });

    expect(scripts[2]).toBe('window.__S4_CONFIG__ = {"sync":true,"repeat":6,"mutations":[{"do":"shadow","cast":false,"frame":230},{"do":"dpr","value":1.5,"frame":233}]};');
    expect(scripts[0]).toContain(`{"frame":220,"do":"record","on":true}`);
    expect(scripts[0]).toContain(`{"frame":${230 + SETTLE + 10},"do":"record","on":false}`);
    expect(out.a.ms).toBeCloseTo(14.4);
    expect(out.b.ms).toBeCloseTo(11.2);
    expect(out.a.calls).toBe(485);
    expect(out.b.calls).toBe(364);
    expect(out.b.passes).toBe(43);
    expect(out.perTick).toBe(6);
  });
});
