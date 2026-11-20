import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioSupported, createAmbience, layerLevels, MASTER_GAIN } from "./audio";

class FakeParam {
  value = 0;
  calls: Array<[string, ...number[]]> = [];
  setTargetAtTime = (v: number, t: number, c: number) => void this.calls.push(["target", v, t, c]);
  setValueAtTime = (v: number, t: number) => void this.calls.push(["set", v, t]);
  linearRampToValueAtTime = (v: number, t: number) => void this.calls.push(["linear", v, t]);
  exponentialRampToValueAtTime = (v: number, t: number) => void this.calls.push(["exp", v, t]);
  cancelScheduledValues = (t: number) => void this.calls.push(["cancel", t]);
  last(kind: string) {
    return this.calls.filter((c) => c[0] === kind).at(-1);
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  pan = new FakeParam();
  Q = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  connect = <T>(target: T): T => target;
  start = vi.fn();
  stop = vi.fn();
}

const contexts: FakeContext[] = [];
class FakeContext {
  currentTime = 0;
  sampleRate = 100;
  destination = new FakeNode();
  nodes: FakeNode[] = [];
  resume = vi.fn(async () => undefined);
  suspend = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  constructor() {
    contexts.push(this);
  }
  private make() {
    const n = new FakeNode();
    this.nodes.push(n);
    return n;
  }
  createGain = () => this.make();
  createBiquadFilter = () => this.make();
  createOscillator = () => this.make();
  createBufferSource = () => this.make();
  createStereoPanner = () => this.make();
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  /** The master gain is the first node that connects to the destination: created first. */
  get master() {
    return this.nodes[0];
  }
}
const Ctor = FakeContext as unknown as new () => AudioContext;

beforeEach(() => {
  contexts.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("layerLevels", () => {
  it("fades birds out and crickets in with dusk", () => {
    const place = { water: 0.5, open: 1 };
    const day = layerLevels(0, place);
    const dusk = layerLevels(1, place);
    expect(day.birds).toBe(1);
    expect(dusk.birds).toBe(0);
    expect(day.crickets).toBe(0);
    expect(dusk.crickets).toBe(0.5);
    expect(dusk.wind).toBeLessThan(day.wind);
  });

  it("follows the water for the stream and the openness for the wind", () => {
    expect(layerLevels(0, { water: 0, open: 0 }).stream).toBeCloseTo(0.04, 9);
    expect(layerLevels(0, { water: 1, open: 0 }).stream).toBeCloseTo(0.4, 9);
    expect(layerLevels(0, { water: 0, open: 1 }).wind).toBeCloseTo(0.36, 9);
    expect(layerLevels(0, { water: 0, open: 0 }).wind).toBeCloseTo(0.16, 9);
  });

  it("clamps its inputs", () => {
    expect(layerLevels(9, { water: 9, open: 9 })).toEqual(layerLevels(1, { water: 1, open: 1 }));
    expect(layerLevels(-9, { water: -9, open: -9 })).toEqual(layerLevels(0, { water: 0, open: 0 }));
  });
});

describe("audioSupported", () => {
  it("follows the presence of an AudioContext on window", () => {
    vi.stubGlobal("window", {});
    expect(audioSupported()).toBe(false);
    vi.stubGlobal("window", { AudioContext: FakeContext });
    expect(audioSupported()).toBe(true);
    vi.stubGlobal("window", { webkitAudioContext: FakeContext });
    expect(audioSupported()).toBe(true);
  });
});

describe("createAmbience", () => {
  it("creates no context before start", () => {
    const a = createAmbience(Ctor, () => 0.5);
    expect(contexts).toHaveLength(0);
    expect(a.running).toBe(false);
  });

  it("starts by resuming and ramping the master gain to MASTER_GAIN", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    const ctx = contexts[0];
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(a.running).toBe(true);
    expect(ctx.master.gain.value).toBe(0);
    expect(ctx.master.gain.last("target")![1]).toBe(MASTER_GAIN);
    expect(ctx.master.gain.last("cancel")).toBeDefined();
    a.dispose();
  });

  it("makes a second start a no-op", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    await a.start();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it("rejects start when there is no AudioContext", async () => {
    const a = createAmbience(null);
    await expect(a.start()).rejects.toThrow("Web Audio is not available");
    expect(a.running).toBe(false);
  });

  it("stops by ramping to 0 and suspends after the fade", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    const ctx = contexts[0];
    a.stop();
    expect(a.running).toBe(false);
    expect(ctx.master.gain.last("target")![1]).toBe(0);
    expect(ctx.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1199);
    expect(ctx.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
  });

  it("does not suspend if started again during the fade", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    a.stop();
    await a.start();
    vi.advanceTimersByTime(2000);
    expect(contexts[0].suspend).not.toHaveBeenCalled();
    a.dispose();
  });

  it("ignores stop when not running", () => {
    const a = createAmbience(Ctor, () => 0.5);
    expect(() => a.stop()).not.toThrow();
    expect(contexts).toHaveLength(0);
  });

  it("moves the layers with the dusk and the place", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    const targets = () => contexts[0].nodes.filter((n) => n.gain.last("target") && n !== contexts[0].master);
    a.setDusk(1);
    a.setPlace({ water: 1, open: 0 });
    const values = targets().map((n) => n.gain.last("target")![1]);
    const expected = layerLevels(1, { water: 1, open: 0 });
    expect(values).toEqual([expected.wind, expected.stream, expected.crickets]);
    a.dispose();
  });

  it("calls birds on a timer by day and keeps quiet at dusk", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    const ctx = contexts[0];
    const count = () => ctx.nodes.length;
    const before = count();
    vi.advanceTimersByTime(1000);
    expect(count()).toBeGreaterThan(before);
    a.setDusk(1);
    const atDusk = count();
    vi.advanceTimersByTime(20000);
    expect(count()).toBe(atDusk);
    a.dispose();
  });

  it("closes the context and stops the birds on dispose", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    const ctx = contexts[0];
    a.dispose();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(a.running).toBe(false);
    const nodes = ctx.nodes.length;
    vi.advanceTimersByTime(20000);
    expect(ctx.nodes.length).toBe(nodes);
    expect(() => a.setDusk(0.5)).not.toThrow();
  });
});
