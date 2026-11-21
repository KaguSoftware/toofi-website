import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffImage,
  fmtBytes,
  fmtMs,
  fmtNum,
  frameStats,
  imageDiff,
  list,
  mdTable,
  median,
  medianOfRuns,
  parseArgs,
  percentile,
  readLock,
  saveResult,
  stamp,
  summarize,
  summarizeFrames,
  tryLock,
  acquireLock,
} from "./lib.mjs";

const img = (w: number, h: number, rgb: [number, number, number]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return { width: w, height: h, data };
};

describe("statistics", () => {
  it("takes the median of odd and even lists and ignores non-numbers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([NaN, 5, Infinity])).toBe(5);
    expect(median([])).toBeNaN();
  });

  it("uses nearest-rank percentiles", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 100)).toBe(100);
    expect(percentile([7], 50)).toBe(7);
  });

  it("summarizes a series", () => {
    expect(summarize([1, 2, 3, 4])).toMatchObject({ n: 4, mean: 2.5, median: 2.5, max: 4, min: 1 });
  });

  it("turns frame intervals into fps and counts frames over budget", () => {
    const s = frameStats([16.7, 16.7, 16.6, 33.4], { budgetMs: 20 });
    expect(s.frames).toBe(4);
    expect(Math.round(s.fps)).toBe(60);
    expect(s.overBudget).toBe(1);
    expect(s.maxMs).toBe(33.4);
  });

  it("takes the median of each numeric field across runs", () => {
    expect(medianOfRuns([{ a: 1, name: "x" }, { a: 5, name: "y" }, { a: 3, name: "z" }])).toEqual({ a: 3, name: "x" });
    expect(medianOfRuns([])).toEqual({});
  });

  it("summarizes recorded frames, using only complete GPU readings", () => {
    const frame = (interval: number | null, gpu: Record<string, number>, complete = true) => ({ interval, cpuMs: 2, renderMs: 1.5, calls: 100, triangles: 5000, passes: 3, dpr: 1.5, width: 300, height: 200, gpu, gpuComplete: complete, shadowGpuMs: 1 });
    const s = summarizeFrames([frame(null, { frame: 4 }), frame(16.7, { frame: 6 }), frame(16.7, { frame: 100 }, false)]);
    expect(s.frames).toBe(2);
    expect(s.gpuMs.median).toBe(5);
    expect(s.gpuMs.frames).toBe(2);
    expect(s.calls.median).toBe(100);
    expect(s.drawingBuffer).toBe("300x200");
    expect(s.gpuPasses[0].label).toBe("frame");
  });
});

describe("image difference", () => {
  it("is zero for identical images", () => {
    expect(imageDiff(img(4, 4, [10, 20, 30]), img(4, 4, [10, 20, 30]))).toEqual({ mean: 0, changedShare: 0, worst: 0 });
  });

  it("reports the mean per channel, the share of changed pixels and the worst pixel", () => {
    const a = img(2, 1, [0, 0, 0]);
    const b = img(2, 1, [0, 0, 0]);
    b.data.set([30, 0, 0], 0); // one pixel, one channel, +30
    const d = imageDiff(a, b);
    expect(d.mean).toBeCloseTo(30 / 6);
    expect(d.changedShare).toBe(0.5);
    expect(d.worst).toBe(30);
  });

  it("refuses images of different sizes", () => {
    expect(() => imageDiff(img(2, 2, [0, 0, 0]), img(3, 2, [0, 0, 0]))).toThrow(/sizes differ/);
  });

  it("draws a heat map scaled to the given full value", () => {
    const h = diffImage(img(1, 1, [0, 0, 0]), img(1, 1, [16, 0, 0]), { full: 32 });
    expect([...h.data]).toEqual([128, 128, 128, 255]);
  });
});

describe("the lock", () => {
  let dir: string;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("is taken once, refused while held, and free again after release", () => {
    dir = mkdtempSync(join(tmpdir(), "rig-lock-"));
    const path = join(dir, "rig.lock");
    const release = tryLock("first", path);
    expect(release).toBeTypeOf("function");
    expect(readLock(path)).toMatchObject({ label: "first", pid: process.pid });
    expect(tryLock("second", path)).toBeNull();
    release!();
    expect(existsSync(path)).toBe(false);
    expect(readLock(path)).toBeNull();
  });

  it("treats a lock left by a dead process on this machine as free", () => {
    dir = mkdtempSync(join(tmpdir(), "rig-lock-"));
    const path = join(dir, "rig.lock");
    writeFileSync(path, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), label: "crashed", since: "x" }));
    expect(readLock(path)).toBeNull();
    const release = tryLock("next", path);
    expect(release).toBeTypeOf("function");
    release!();
  });

  it("waits for a held lock and says who holds it", async () => {
    dir = mkdtempSync(join(tmpdir(), "rig-lock-"));
    const path = join(dir, "rig.lock");
    const first = tryLock("busy", path)!;
    const lines: string[] = [];
    const waiting = acquireLock("queued", { path, pollMs: 20, log: (l: string) => lines.push(l) });
    await new Promise((r) => setTimeout(r, 60));
    expect(lines[0]).toMatch(/waiting for the measurement lock \(held by busy/);
    first();
    const release = await waiting;
    expect(readLock(path)).toMatchObject({ label: "queued" });
    release();
    expect(readLock(path)).toBeNull();
  });

  it("gives up after its timeout", async () => {
    dir = mkdtempSync(join(tmpdir(), "rig-lock-"));
    const path = join(dir, "rig.lock");
    const held = tryLock("busy", path)!;
    await expect(acquireLock("late", { path, pollMs: 10, timeoutMs: 30, log: () => {} })).rejects.toThrow(/timed out/);
    held();
  });
});

describe("output helpers", () => {
  it("formats bytes, milliseconds and numbers", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(8_650_000)).toBe("8.65 MB");
    expect(fmtBytes(NaN)).toBe("–");
    expect(fmtMs(12.34, 1)).toBe("12.3 ms");
    expect(fmtMs(9600)).toBe("9.60 s");
    expect(fmtNum(794123)).toBe("794,123");
  });

  it("writes a Markdown table and escapes pipes", () => {
    const t = mdTable([{ a: "x|y", b: 2 }], [["A", (r: { a: string }) => r.a], ["B", (r: { b: number }) => r.b]]);
    expect(t).toBe("| A | B |\n|---|---|\n| x\\|y | 2 |");
  });

  it("parses flags, values and positionals", () => {
    expect(parseArgs(["reference", "--update", "--tiers", "high,low", "--width=640"])).toEqual({ _: ["reference"], update: true, tiers: "high,low", width: "640" });
    expect(list("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(list(undefined)).toBeUndefined();
    expect(list(true)).toBeUndefined();
  });

  it("stamps without colons and saves results as JSON", () => {
    expect(stamp(new Date("2026-11-20T18:01:02.345Z"))).toBe("2026-11-20T18-01-02");
    const dir = mkdtempSync(join(tmpdir(), "rig-out-"));
    const file = saveResult("x", { a: 1 }, dir);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ a: 1 });
    rmSync(dir, { recursive: true, force: true });
  });
});

import { parsePower, powerProblem } from "./lib.mjs";

describe("power", () => {
  const settings = (low: number) => ` sleep 1\n displaysleep 10\n lowpowermode ${low}\n`;

  it("reads the power source, battery level and Low Power Mode", () => {
    expect(parsePower("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t12%; discharging", settings(1))).toEqual({ source: "battery", batteryPercent: 12, lowPowerMode: true });
    expect(parsePower("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging", settings(0))).toEqual({ source: "ac", batteryPercent: 80, lowPowerMode: false });
  });

  it("refuses battery and Low Power Mode, accepts the charger", () => {
    expect(powerProblem({ source: "battery", batteryPercent: 12, lowPowerMode: false })).toMatch(/battery \(12%\)/);
    expect(powerProblem({ source: "ac", batteryPercent: 80, lowPowerMode: true })).toMatch(/Low Power Mode/);
    expect(powerProblem({ source: "ac", batteryPercent: 80, lowPowerMode: false })).toBeNull();
  });
});
