import { describe, expect, it } from "vitest";
import { analyzeTrace, attribute, blockingOf, chunkName, cpuProfile, findMainThread, frameKey, kindOf, longTasks, stackOf, timelineIn } from "./analyze.mjs";

const PID = 7;
const TID = 1;
const NAV = 1_000_000; // µs on the trace clock
const at = (ms: number) => NAV + ms * 1000;

/** A small trace: one navigation, three tasks (20, 120 and 300 ms) and a CPU profile. */
function trace() {
  const X = (name: string, startMs: number, durMs: number, data?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    ph: "X",
    name,
    pid: PID,
    tid: TID,
    ts: at(startMs),
    dur: durMs * 1000,
    args: data ? { data } : {},
    ...extra,
  });
  const nodes = [
    { id: 1, callFrame: { functionName: "(root)", url: "", codeType: "other" } },
    { id: 2, parent: 1, callFrame: { functionName: "render", url: "http://x/_next/static/chunks/three.js?v=1", lineNumber: 0, columnNumber: 1200, codeType: "JS" } },
    { id: 3, parent: 2, callFrame: { functionName: "getProgramParameter", url: "", codeType: "other" } },
    { id: 4, parent: 2, callFrame: { functionName: "texImage2D", url: "", codeType: "other" } },
    { id: 5, parent: 1, callFrame: { functionName: "hydrate", url: "http://x/_next/static/chunks/app.js", lineNumber: 3, columnNumber: 40, codeType: "JS" } },
    { id: 6, parent: 1, callFrame: { functionName: "(garbage collector)", url: "", codeType: "other" } },
    { id: 7, parent: 1, callFrame: { functionName: "(idle)", url: "", codeType: "other" } },
    { id: 8, parent: 1, callFrame: { functionName: "(program)", url: "", codeType: "other" } },
  ];
  // Samples every 10 ms from 1000 ms: 200 ms waiting on a link, 60 ms uploading, 40 ms of
  // three.js itself (the 300 ms task), then idle, then 100 ms of hydration and 20 ms of GC.
  const plan: Array<[number, number]> = [
    [3, 20],
    [4, 6],
    [2, 4],
    [7, 20],
    [5, 10],
    [6, 2],
    [8, 1],
  ];
  const samples: number[] = [];
  for (const [id, n] of plan) for (let i = 0; i < n; i++) samples.push(id);
  const timeDeltas = samples.map(() => 10_000);
  return [
    { ph: "R", name: "navigationStart", pid: 99, tid: 1, ts: at(-500), args: { data: { documentLoaderURL: "about:blank", isOutermostMainFrame: true } } },
    { ph: "R", name: "navigationStart", pid: PID, tid: TID, ts: NAV, args: { data: { documentLoaderURL: "http://x/", isOutermostMainFrame: true } } },
    X("RunTask", 100, 20),
    X("RunTask", 1000, 300),
    X("ThreadControllerImpl::RunTask", 999.5, 302), // the same task under its outer name
    X("FireAnimationFrame", 1001, 298),
    X("FunctionCall", 1002, 296, { url: "http://x/_next/static/chunks/three.js?v=1", functionName: "loop" }),
    X("RunTask", 1500, 120),
    X("EvaluateScript", 1500, 110, { url: "http://x/_next/static/chunks/app.js" }),
    X("v8.compile", 1500, 12, { url: "http://x/_next/static/chunks/app.js" }),
    X("RunTask", 1000, 400, undefined, { tid: 2 }), // another thread: never the page's task
    { ph: "P", name: "Profile", id: "0x1", pid: PID, tid: TID, ts: at(990), args: { data: { startTime: at(990) } } },
    { ph: "P", name: "ProfileChunk", id: "0x1", pid: PID, tid: 55, ts: at(1200), args: { data: { cpuProfile: { nodes, samples: samples.slice(0, 30) }, timeDeltas: timeDeltas.slice(0, 30) } } },
    { ph: "P", name: "ProfileChunk", id: "0x1", pid: PID, tid: 55, ts: at(1700), args: { data: { cpuProfile: { samples: samples.slice(30) }, timeDeltas: timeDeltas.slice(30) } } },
  ];
}

describe("chunkName and frameKey", () => {
  it("keeps the file name only", () => {
    expect(chunkName("http://x/_next/static/chunks/abc.js?dpl=1#x")).toBe("abc.js");
    expect(chunkName("")).toBe("");
  });

  it("names a frame by function and position, or by name alone for browser code", () => {
    expect(frameKey({ fn: "render", url: "http://x/a/three.js", line: 0, column: 12 })).toBe("render three.js:0:12");
    expect(frameKey({ fn: "", url: "http://x/a/three.js", line: 2, column: 3 })).toBe("(anonymous) three.js:2:3");
    expect(frameKey({ fn: "texImage2D", url: "", line: -1, column: -1 })).toBe("texImage2D");
  });
});

describe("findMainThread", () => {
  it("picks the page's thread and navigation start, not about:blank", () => {
    expect(findMainThread(trace(), "http://x")).toEqual({ pid: PID, tid: TID, navStart: NAV });
  });

  it("is null when the page was never loaded", () => {
    expect(findMainThread(trace(), "http://other")).toBeNull();
  });
});

describe("longTasks", () => {
  it("lists the main thread's tasks over the threshold once each, in ms since navigation", () => {
    const thread = findMainThread(trace(), "http://x")!;
    expect(longTasks(trace(), thread, 50)).toEqual([
      { start: 999.5, end: 1301.5, dur: 302 },
      { start: 1500, end: 1620, dur: 120 },
    ]);
  });
});

describe("timelineIn", () => {
  it("names the outermost timeline events of a task with their script", () => {
    const thread = findMainThread(trace(), "http://x")!;
    expect(timelineIn(trace(), thread, 1000, 1300)).toEqual([{ name: "FireAnimationFrame", ms: 298, url: "", fn: "", type: "" }]);
    const second = timelineIn(trace(), thread, 1500, 1620);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ name: "EvaluateScript", ms: 110, url: "app.js" });
  });
});

describe("cpuProfile", () => {
  it("joins the chunks into one sample list on the trace clock", () => {
    const thread = findMainThread(trace(), "http://x")!;
    const p = cpuProfile(trace(), thread);
    expect(p.samples).toHaveLength(63);
    expect(p.samples[0]).toMatchObject({ ts: at(1000), id: 3, dt: 10_000 });
    expect(p.samples.at(-1)!.dt).toBe(0);
    expect(stackOf(p.nodes, 3).map((f) => f.fn)).toEqual(["getProgramParameter", "render", "(root)"]);
  });
});

describe("kindOf", () => {
  const frame = (fn: string, url = "") => ({ fn, url, line: 0, column: 0, parent: null, native: !url });

  it("sorts samples by what the main thread was doing", () => {
    expect(kindOf([frame("getProgramParameter"), frame("render", "u")])).toBe("shader");
    expect(kindOf([frame("linkProgram")])).toBe("shader");
    expect(kindOf([frame("compressedTexImage2D")])).toBe("upload");
    expect(kindOf([frame("bufferData")])).toBe("upload");
    expect(kindOf([frame("drawElements")])).toBe("draw");
    expect(kindOf([frame("getExtension")])).toBe("webgl");
    expect(kindOf([frame("(garbage collector)")])).toBe("gc");
    expect(kindOf([frame("(idle)")])).toBe("idle");
    expect(kindOf([frame("(program)")])).toBe("native");
    expect(kindOf([frame("render", "u")])).toBe("script");
    expect(kindOf([])).toBe("native");
  });

  it("does not take a script function that happens to share a WebGL name for a WebGL call", () => {
    expect(kindOf([frame("getParameter", "http://x/app.js")])).toBe("script");
  });

  it("counts other browser calls made from script as script", () => {
    expect(kindOf([frame("RegExp: #include"), frame("resolve", "u")])).toBe("script");
    expect(kindOf([frame("fetch"), frame("load", "u")])).toBe("script");
  });
});

describe("attribute", () => {
  it("splits a task into shader waits, uploads and script, and charges browser calls to the calling file", () => {
    const thread = findMainThread(trace(), "http://x")!;
    const a = attribute(cpuProfile(trace(), thread), thread, 1000, 1300);
    expect(a.sampledMs).toBeCloseTo(300);
    expect(a.kinds).toEqual({ shader: 200, upload: 60, script: 40 });
    expect(a.gl).toEqual([
      { key: "getProgramParameter", ms: 200 },
      { key: "texImage2D", ms: 60 },
    ]);
    expect(a.files).toEqual([{ key: "three.js", ms: 300 }]);
    expect(a.self[0]).toEqual({ key: "getProgramParameter", ms: 200 });
    expect(a.inclusive[0]).toEqual({ key: "render three.js:0:1200", ms: 300 });
  });

  it("leaves idle time out and clips samples to the window", () => {
    const thread = findMainThread(trace(), "http://x")!;
    const p = cpuProfile(trace(), thread);
    expect(attribute(p, thread, 1300, 1500).sampledMs).toBe(0);
    expect(attribute(p, thread, 1195, 1205).kinds).toEqual({ shader: 5, upload: 5 });
  });
});

describe("blockingOf", () => {
  it("counts the part of each task beyond 50 ms inside the window", () => {
    const tasks = [
      { start: 1000, end: 1300, dur: 300 },
      { start: 1500, end: 1620, dur: 120 },
    ];
    expect(blockingOf(tasks, 0, 2000)).toEqual({ count: 2, totalMs: 420, blockingMs: 320, longestMs: 300, over200: 1 });
    expect(blockingOf(tasks, 1400, 2000).count).toBe(1);
    expect(blockingOf(tasks, 3000, 4000)).toEqual({ count: 0, totalMs: 0, blockingMs: 0, longestMs: 0, over200: 0 });
  });
});

describe("analyzeTrace", () => {
  it("returns every long task in the window with what ran in it", () => {
    const a = analyzeTrace(trace(), { urlPrefix: "http://x", from: 0, until: 2000 });
    expect(a.tasks.map((t) => t.dur)).toEqual([302, 120]);
    expect(a.tasks[0].kinds.shader).toBe(200);
    expect(a.tasks[1].kinds).toEqual({ script: 100, gc: 20 });
    expect(a.tasks[1].files[0]).toEqual({ key: "app.js", ms: 100 });
    expect(a.blocking).toMatchObject({ count: 2, blockingMs: 322, longestMs: 302 });
    expect(a.window?.kinds.shader).toBe(200);
  });

  it("drops tasks outside the window", () => {
    expect(analyzeTrace(trace(), { urlPrefix: "http://x", from: 1400, until: 2000 }).tasks.map((t) => t.dur)).toEqual([120]);
  });

  it("reports a trace without the page", () => {
    expect(analyzeTrace(trace(), { urlPrefix: "http://nope" })).toMatchObject({ error: expect.stringContaining("no navigation"), tasks: [] });
  });
});
