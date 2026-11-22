import { describe, expect, it } from "vitest";
import { CATEGORIES, glGroup, gpuProcessIn, parseMode, summarizeGl, summarizeRuns, taskTable } from "./startup.mjs";

describe("glGroup", () => {
  it("sorts WebGL calls into shader work, uploads, draws and the rest", () => {
    expect(glGroup("linkProgram")).toBe("shader");
    expect(glGroup("getProgramParameter")).toBe("shader");
    expect(glGroup("compressedTexImage2D")).toBe("upload");
    expect(glGroup("bufferData")).toBe("upload");
    expect(glGroup("drawElementsInstanced")).toBe("draw");
    expect(glGroup("getExtension")).toBe("other");
  });
});

describe("summarizeGl", () => {
  const snapshot = {
    calls: {
      "load:getExtension": { n: 30, ms: 3, max: 1 },
      "first:getProgramParameter": { n: 40, ms: 180, max: 22 },
      "first:linkProgram": { n: 20, ms: 6, max: 1 },
      "first:texImage2D": { n: 4, ms: 50, max: 30 },
      "first:drawElements": { n: 120, ms: 9, max: 1 },
      "after:drawElements": { n: 900, ms: 30, max: 1 },
    },
    slow: [
      { t: 10, name: "texImage2D", ms: 30, detail: "2048x2048", phase: "first" },
      { t: 5, name: "getProgramParameter", ms: 22, detail: "LINK_STATUS", phase: "first" },
    ],
    programs: 20,
    shaders: 40,
    salted: 0,
    saltMisses: 0,
    extensions: ["EXT_color_buffer_float", "KHR_parallel_shader_compile"],
    workers: [{ t: 1, url: "blob:" }],
    wasm: [],
  };

  it("totals each phase by group and ranks its calls", () => {
    const s = summarizeGl(snapshot);
    expect(s.phases.first.totalMs).toBe(245);
    expect(s.phases.first.groups).toEqual({ shader: 186, upload: 50, draw: 9 });
    expect(s.phases.first.byCall[0]).toEqual({ name: "getProgramParameter", n: 40, ms: 180, max: 22 });
    expect(s.phases.load.groups).toEqual({ other: 3 });
    expect(s.phases.after.calls).toBe(900);
  });

  it("carries the counts and the slowest calls, slowest first", () => {
    const s = summarizeGl(snapshot);
    expect(s).toMatchObject({ programs: 20, shaders: 40, parallelCompile: true, workers: 1 });
    expect(s.slow.map((c) => c.name)).toEqual(["texImage2D", "getProgramParameter"]);
  });

  it("copes with a page that made no WebGL calls", () => {
    expect(summarizeGl({})).toMatchObject({ phases: {}, programs: 0, parallelCompile: false, slow: [] });
  });
});

describe("gpuProcessIn", () => {
  const thread = { pid: 7, tid: 1, navStart: 1_000_000 };
  const events = [
    { ph: "X", name: "ProgramMtl::link", cat: "gpu.angle", pid: 9, tid: 3, ts: 1_100_000, dur: 80_000 },
    { ph: "X", name: "ProgramMtl::link", cat: "gpu.angle", pid: 9, tid: 3, ts: 1_250_000, dur: 100_000 }, // half inside
    { ph: "X", name: "GpuChannel::Flush", cat: "gpu", pid: 9, tid: 3, ts: 1_150_000, dur: 10_000 },
    { ph: "X", name: "RunTask", cat: "toplevel", pid: 9, tid: 3, ts: 1_100_000, dur: 90_000 }, // not a GPU category
    { ph: "X", name: "WebGL", cat: "gpu", pid: 7, tid: 1, ts: 1_100_000, dur: 50_000 }, // the page's own process
  ];

  it("sums the GPU process's events inside the window, clipped to it", () => {
    expect(gpuProcessIn(events, thread, 100, 300)).toEqual([
      { name: "ProgramMtl::link", ms: 130 },
      { name: "GpuChannel::Flush", ms: 10 },
    ]);
  });
});

describe("taskTable", () => {
  it("prints one row per task with where its time went", () => {
    const table = taskTable([
      {
        start: 6900,
        dur: 280,
        timeline: [{ name: "FireAnimationFrame", ms: 270, url: "" }],
        kinds: { script: 60, shader: 150, upload: 40, draw: 20 },
        files: [{ key: "three.js", ms: 250 }],
      },
    ]);
    expect(table).toContain("| 6.90 s | 280 ms | FireAnimationFrame 270 ms | 60 ms | 150 ms | 40 ms | 20 ms |");
    expect(table).toContain("three.js 250 ms");
  });
});

describe("summarizeRuns", () => {
  const row = (blockingMs: number, shader: number, firstGl: number) => ({
    fcpMs: 500,
    liveMs: 7000,
    pageLongTasks: [
      { start: 100, duration: 80 }, // before first content: not counted
      { start: 6990, duration: 250 },
    ],
    trace: { blocking: { blockingMs, longestMs: 250, over200: 1 }, tasks: [{ kinds: { shader, script: 50 } }, { kinds: { shader: 10 } }] },
    gl: { programs: 24, phases: { first: { totalMs: firstGl, groups: { shader: firstGl - 20, upload: 20 } } } },
  });

  it("takes the median of each number across the runs", () => {
    const s = summarizeRuns([row(600, 100, 200), row(700, 140, 240), row(650, 120, 220)]);
    expect(s).toMatchObject({ runs: 3, fcpMs: 500, liveMs: 7000, blockingMs: 650, longestTaskMs: 250, shaderMs: 130, scriptMs: 50 });
    expect(s).toMatchObject({ gl_first_Ms: 220, gl_first_shaderMs: 200, gl_first_uploadMs: 20, gl_load_Ms: 0, programs: 24 });
    expect(s.longestPageTaskMs).toBe(250);
    expect(s.pageBlockingMs).toBe(200);
  });

  it("leaves out what a run did not record", () => {
    const s = summarizeRuns([{ fcpMs: 500, liveMs: 7000, pageLongTasks: [] }]);
    expect(s).toEqual({ runs: 1, fcpMs: 500, liveMs: 7000 });
  });
});

describe("CATEGORIES", () => {
  it("records the timeline, tasks and the CPU profile", () => {
    expect(CATEGORIES).toEqual(expect.arrayContaining(["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-v8.cpu_profiler"]));
  });
});

describe("parseMode", () => {
  it("turns a mode name into its switches", () => {
    expect(parseMode("trace")).toEqual({ trace: true, gl: false, salt: false, nocheck: false, precompile: false });
    expect(parseMode("plain")).toEqual({ trace: false, gl: false, salt: false, nocheck: false, precompile: false });
  });

  it("installs the call probe for every mode that needs it", () => {
    expect(parseMode("gl+salt")).toMatchObject({ gl: true, salt: true });
    expect(parseMode("salt+precompile")).toMatchObject({ gl: true, salt: true, precompile: true });
    expect(parseMode("nocheck")).toMatchObject({ gl: true, nocheck: true, salt: false });
  });

  it("refuses a name it does not know", () => {
    expect(() => parseMode("gl+turbo")).toThrow(/unknown mode "turbo"/);
  });
});
