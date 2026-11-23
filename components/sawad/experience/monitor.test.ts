import { describe, expect, it } from "vitest";
import { MONITOR, STARVED_FPS, createQualityMonitor, type MonitorDecision, type MonitorInput } from "./monitor";
import { QUALITY_RANGE, fpsBounds } from "./quality";

const high: MonitorInput = { level: 2, min: 1, max: 3, bounds: (r) => fpsBounds("high", r), starvedFps: STARVED_FPS.high };

/** Draws frames at `fps` for `seconds` and returns every decision made, with the second it came at. */
function run(monitor: ReturnType<typeof createQualityMonitor>, fps: number, seconds: number, input: MonitorInput | (() => MonitorInput)): Array<{ at: number; decision: MonitorDecision }> {
  const out: Array<{ at: number; decision: MonitorDecision }> = [];
  const delta = 1 / fps;
  for (let t = delta; t <= seconds + 1e-9; t += delta) {
    const decision = monitor.frame(delta, typeof input === "function" ? input() : input);
    if (decision) out.push({ at: Math.round(t * 10) / 10, decision });
  }
  return out;
}

describe("the quality monitor", () => {
  it("allows a step up after one window of full frame rate", () => {
    const decisions = run(createQualityMonitor(), 60, 3, high);
    expect(decisions).toEqual([{ at: 2.5, decision: "up" }]);
  });

  it("asks for a step down after one window under the lower bound", () => {
    // At 30 fps a sample takes eight frames (267 ms), so the window is 2.7 s.
    const decisions = run(createQualityMonitor(), 30, 3, high);
    expect(decisions).toEqual([{ at: 2.7, decision: "down" }]);
  });

  it("holds between the bounds", () => {
    // 60 Hz first, so the refresh rate is known; then 52 fps: over 48, under 57.
    const monitor = createQualityMonitor();
    run(monitor, 60, 1, { ...high, level: 3 });
    expect(run(monitor, 52, 20, { ...high, level: 3 })).toEqual([]);
  });

  it("does not count a fast window at the top level: a fast device keeps its best level for good", () => {
    // drei stepped every fast device down at about 11 s and then stopped.
    const monitor = createQualityMonitor();
    expect(run(monitor, 60, 120, { ...high, level: 3 })).toEqual([]);
  });

  it("keeps watching: a device that slows down minutes in is stepped down, and comes back when it recovers", () => {
    const monitor = createQualityMonitor();
    let level = 3;
    const input = () => ({ ...high, level });
    const apply = (list: Array<{ decision: MonitorDecision }>) => {
      for (const { decision } of list) level += decision === "up" ? 1 : decision === "down" ? -1 : 0;
      return list.map((d) => d.decision);
    };
    expect(apply(run(monitor, 60, 300, input))).toEqual([]);
    // Heat: 36 fps, as S9 measured at 12× CPU. One window to notice, then one more level if it is still slow.
    expect(apply(run(monitor, 36, 3, input))).toEqual(["down"]);
    expect(level).toBe(2);
    expect(apply(run(monitor, 36, 4, input))).toEqual(["down"]);
    expect(level).toBe(1);
    // At the floor it holds (36 fps is slow, not unwatchable).
    expect(apply(run(monitor, 36, 30, input))).toEqual([]);
    // Cooled: level 2 failed about 34 s ago and may not be retried inside its minute.
    expect(apply(run(monitor, 60, 20, input))).toEqual([]);
    expect(apply(run(monitor, 60, 10, input))).toEqual(["up"]);
    expect(level).toBe(2);
  });

  it("does not flip between two levels: a level that failed waits a minute, then twice as long", () => {
    const monitor = createQualityMonitor();
    let level = 2;
    const times: Array<{ at: number; decision: MonitorDecision }> = [];
    let clock = 0;
    // A GPU that holds level 2 at 60 fps and level 3 at 40.
    for (let i = 0; i < 4000; i++) {
      const fps = level === 3 ? 40 : 60;
      const slice = run(monitor, fps, 0.5, { ...high, level });
      clock += 0.5;
      for (const { decision } of slice) {
        times.push({ at: clock, decision });
        level += decision === "up" ? 1 : -1;
      }
    }
    const ups = times.filter((t) => t.decision === "up").map((t) => t.at);
    // The gaps between tries grow: about 1, 2, 4, 8 minutes, then the cap of 10.
    const gaps = ups.slice(1).map((at, i) => at - ups[i]);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    expect(gaps[0]).toBeGreaterThanOrEqual(60);
    expect(gaps[1]).toBeGreaterThanOrEqual(120);
    expect(gaps[2]).toBeGreaterThanOrEqual(240);
    expect(gaps[3]).toBeGreaterThanOrEqual(480);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(MONITOR.cooldownMaxMs / 1000 + 10);
    expect(level === 2 || level === 3).toBe(true);
  });

  it("judges nothing for a second after a level change", () => {
    const monitor = createQualityMonitor();
    expect(run(monitor, 60, 2.5, high)).toEqual([{ at: 2.5, decision: "up" }]);
    // The next verdict needs the settle time (1 s) and then a full window (2.7 s at 30 fps).
    expect(run(monitor, 30, 3.5, { ...high, level: 3 })).toEqual([]);
    expect(run(monitor, 30, 0.4, { ...high, level: 3 }).map((d) => d.decision)).toEqual(["down"]);
  });

  it("reads a pause as a pause, not as slow frames", () => {
    const monitor = createQualityMonitor();
    run(monitor, 60, 2.4, { ...high, level: 3 });
    // The tab was hidden for a minute, then one frame every 0.6 s while the visitor scrolls a paused scene.
    expect(monitor.frame(60, { ...high, level: 3 })).toBeNull();
    for (let i = 0; i < 50; i++) expect(monitor.frame(0.6, { ...high, level: 3 })).toBeNull();
    // Back at full rate: a whole new window is needed.
    expect(run(monitor, 30, 2.5, { ...high, level: 3 })).toEqual([]);
    expect(run(monitor, 30, 0.3, { ...high, level: 3 }).map((d) => d.decision)).toEqual(["down"]);
  });

  it("forgets its samples when told to rest, and ignores frames without time between them", () => {
    const monitor = createQualityMonitor();
    run(monitor, 30, 2.4, high);
    monitor.rest();
    expect(run(monitor, 30, 2.4, high)).toEqual([]);
    expect(monitor.frame(0, high)).toBeNull();
    expect(monitor.frame(Number.NaN, high)).toBeNull();
    expect(monitor.frame(-1, high)).toBeNull();
  });

  it("measures the frame rate over whole intervals: 60 fps reads 60, not 64", () => {
    // drei counted the window's first frame, so 60 read as 64 and the bounds acted 4 fps low.
    // 56 fps is under the upper bound of 57 and must not earn a step up.
    const monitor = createQualityMonitor();
    run(monitor, 60, 1, { ...high, level: 3 });
    expect(run(monitor, 56, 30, high)).toEqual([]);
    // And 47 fps is under the lower bound of 48.
    expect(run(createQualityMonitor(), 47, 3, { ...high, bounds: () => [48, 57] }).map((d) => d.decision)).toEqual(["down"]);
  });

  it("uses the faster bounds on a fast display", () => {
    // 120 Hz: [55, 85]. 70 fps holds there; on a 60 Hz display it would be over the upper bound.
    const monitor = createQualityMonitor();
    run(monitor, 120, 1, { ...high, level: 3 });
    expect(run(monitor, 70, 20, high)).toEqual([]);
    expect(run(monitor, 50, 3, high).map((d) => d.decision)).toEqual(["down"]);
  });

  describe("at the lowest level", () => {
    const floor: MonitorInput = { ...high, level: 1 };

    it("gives up once, after ten seconds under the starved frame rate", () => {
      const monitor = createQualityMonitor();
      // At 15 fps a sample takes four frames (267 ms), so four windows are 10.7 s.
      const decisions = run(monitor, 15, 60, floor);
      expect(decisions).toEqual([{ at: 10.7, decision: "starved" }]);
    });

    it("holds a frame rate that is slow but watchable", () => {
      expect(run(createQualityMonitor(), 25, 120, floor)).toEqual([]);
    });

    it("starts the count again when the frame rate recovers in between", () => {
      const monitor = createQualityMonitor();
      // Two starved windows, one watchable one, then it takes four more in a row.
      expect(run(monitor, 15, 5.4, floor)).toEqual([]);
      expect(run(monitor, 30, 2.7, floor)).toEqual([]);
      expect(run(monitor, 15, 10.5, floor)).toEqual([]);
      expect(run(monitor, 15, 0.4, floor).map((d) => d.decision)).toEqual(["starved"]);
    });

    it("never gives up where no starved frame rate is set (phones, until one has been measured)", () => {
      expect(STARVED_FPS.low).toBeNull();
      const phone: MonitorInput = { level: 0, min: 0, max: 1, bounds: (r) => fpsBounds("low", r), starvedFps: STARVED_FPS.low };
      expect(run(createQualityMonitor(), 10, 120, phone)).toEqual([]);
      expect(run(createQualityMonitor(), 10, 30, { ...phone, starvedFps: undefined })).toEqual([]);
    });

    it("reaches whatever floor the tier has: a level below today's is stepped to like any other", () => {
      // F3 adds a level 0 to the high tier (T51); the monitor takes the range as given.
      const monitor = createQualityMonitor();
      expect(run(monitor, 15, 3, { ...high, level: 1, min: 0 }).map((d) => d.decision)).toEqual(["down"]);
      expect(run(monitor, 15, 12, { ...high, level: 0, min: 0 }).map((d) => d.decision)).toEqual(["starved"]);
    });
  });

  it("works on both tiers' ranges as quality.ts defines them", () => {
    for (const tier of ["low", "high"] as const) {
      const { min, max, start } = QUALITY_RANGE[tier];
      const input: MonitorInput = { level: start, min, max, bounds: (r) => fpsBounds(tier, r), starvedFps: STARVED_FPS[tier] };
      expect(run(createQualityMonitor(), 60, 3, input).map((d) => d.decision)).toEqual(start < max ? ["up"] : []);
    }
  });
});
