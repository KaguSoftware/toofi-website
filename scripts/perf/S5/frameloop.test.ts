import { describe, expect, it } from "vitest";
import { allocationSites, frameloopTable, gcFromTrace, selfTimes } from "./frameloop.mjs";

describe("allocationSites", () => {
  it("sums a sampling heap profile's self sizes by call site, largest first", () => {
    const cf = (functionName: string, lineNumber: number) => ({ functionName, url: "http://x/a.js", lineNumber, columnNumber: 3 });
    const profile = {
      head: {
        callFrame: cf("(root)", 0),
        selfSize: 0,
        children: [
          { callFrame: cf("update", 10), selfSize: 4096, children: [{ callFrame: cf("subarray", 12), selfSize: 8192, children: [] }] },
          { callFrame: cf("update", 10), selfSize: 1024, children: [] },
        ],
      },
    };
    const { total, sites } = allocationSites(profile);
    expect(total).toBe(13312);
    expect(sites[0]).toMatchObject({ functionName: "subarray", bytes: 8192 });
    expect(sites[1]).toMatchObject({ functionName: "update", line: 10, bytes: 5120 });
    expect(allocationSites(null).total).toBe(0);
  });
});

describe("gcFromTrace", () => {
  it("counts minor and major collections on the page's main thread only", () => {
    const events = [
      { name: "thread_name", ph: "M", pid: 1, tid: 1, args: { name: "CrRendererMain" } },
      { name: "MinorGC", ph: "X", pid: 1, tid: 1, dur: 1500 },
      { name: "MinorGC", ph: "X", pid: 1, tid: 1, dur: 500 },
      { name: "MajorGC", ph: "X", pid: 1, tid: 1, dur: 9000 },
      { name: "MinorGC", ph: "X", pid: 1, tid: 7, dur: 4000 },
    ];
    expect(gcFromTrace(events)).toEqual({ minor: 2, major: 1, minorMs: 2, majorMs: 9, worstMs: 9 });
  });
});

describe("frameloopTable", () => {
  it("shows one row per camera with the top subscriber", () => {
    const row = {
      tier: "high",
      level: "adaptive",
      shot: "opening",
      frames: { overBudget: 1, frames: 700 },
      subs: { callback: { median: 2.5, p95: 4 }, outsideSubscribers: { median: 1.2 }, rows: [{ label: "SceneVegetation: wind and sort", mean: 0.8 }] },
      commits: { dom: 0, r3f: 0 },
    };
    expect(frameloopTable([row])).toContain("| high | adaptive | opening | 1/700 | 2.50 ms | 4.00 ms | 1.20 ms | SceneVegetation: wind and sort 0.80 ms |  | 0 / 0 |");
  });
});

describe("selfTimes", () => {
  it("charges each sample the gap to the next one and sums by function", () => {
    const cf = (functionName: string) => ({ functionName, url: "http://x/a.js", lineNumber: 1, columnNumber: 2 });
    const profile = {
      nodes: [
        { id: 1, callFrame: cf("(root)") },
        { id: 2, callFrame: cf("render") },
        { id: 3, callFrame: cf("update") },
      ],
      samples: [2, 2, 3, 2],
      timeDeltas: [0, 1000, 2000, 500],
    };
    const { total, rows } = selfTimes(profile);
    expect(total).toBe(3.5);
    expect(rows[0]).toMatchObject({ functionName: "render", ms: 3 });
    expect(rows[1]).toMatchObject({ functionName: "update", ms: 0.5 });
  });
});
