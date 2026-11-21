import { describe, expect, it } from "vitest";
import { blocking, fileKind, summarizeRuns, traceTable } from "./trace.mjs";

describe("fileKind", () => {
  it("sorts requests into the plan's file types", () => {
    expect(fileKind("http://x/sawad/models/compound-zaitun-low.glb", "Fetch")).toBe("model");
    expect(fileKind("http://x/sawad/lightmaps/zaitun/day-site-low.ktx2?v=1", "Fetch")).toBe("texture");
    expect(fileKind("http://x/sawad/basis/basis_transcoder.wasm", "Fetch")).toBe("wasm");
    expect(fileKind("http://x/sawad/audio/with-these-hands.mp3", "Media")).toBe("audio");
    expect(fileKind("http://x/_next/static/media/font.woff2", "Font")).toBe("font");
    expect(fileKind("http://x/_next/image?url=%2Fsawad%2Fscene.jpg&w=1920", "Image")).toBe("image");
    expect(fileKind("http://x/_next/static/chunks/a.css", "Stylesheet")).toBe("css");
    expect(fileKind("http://x/_next/static/chunks/a.js", "Script")).toBe("js");
    expect(fileKind("http://x/", "Document")).toBe("document");
    expect(fileKind("http://x/sawad/models/compound-zaitun.manifest.json", "Fetch")).toBe("data");
  });
});

describe("blocking", () => {
  const tasks = [
    { start: 100, duration: 40 },
    { start: 500, duration: 120 },
    { start: 2000, duration: 260 },
    { start: 9000, duration: 300 },
  ];

  it("counts the part of each long task beyond 50 ms inside the window", () => {
    expect(blocking(tasks, 0, 3000)).toEqual({ count: 3, totalMs: 420, blockingMs: 70 + 210, longestMs: 260, over200: 1 });
  });

  it("includes a task that straddles the window's start", () => {
    expect(blocking(tasks, 550, 1000).count).toBe(1);
  });

  it("is zero for an empty window", () => {
    expect(blocking(tasks, 3000, 8000)).toEqual({ count: 0, totalMs: 0, blockingMs: 0, longestMs: 0, over200: 0 });
  });
});

describe("summarizeRuns", () => {
  const run = (live: number, blockingMs: number, model: number) => ({
    tier: "low",
    ttfbMs: 10,
    fcpMs: 600,
    lcpMs: 700,
    cls: 0,
    loadMs: 1200,
    liveMs: live,
    bytesBeforeLive: 1000,
    bytesTotal: 2000,
    blockingToLive: { blockingMs, longestMs: blockingMs / 2, over200: 1 },
    kindsBeforeLive: { model },
  });

  it("takes medians and keeps the range of the blocking time", () => {
    const s = summarizeRuns([run(9000, 2000, 3), run(9600, 3100, 5), run(10000, 2600, 4)]);
    expect(s.liveMs).toBe(9600);
    expect(s.blockingMs).toBe(2600);
    expect(s.blockingMin).toBe(2000);
    expect(s.blockingMax).toBe(3100);
    expect(s.kindsBeforeLive).toEqual({ model: 4 });
    expect(traceTable([{ profile: "phone", route: "/", gpuCache: "cold", runs: [{}, {}, {}], median: s }])).toContain("| phone (low tier) | / | cold | 3 |");
  });
});
