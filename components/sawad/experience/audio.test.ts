import { statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMBIENCE_FOLLOW_MS, AMBIENCE_VS_MUSIC, ambienceGain, audioSupported, createAmbience, layerLevels, MASTER_GAIN, MUSIC_BED, MUSIC_GAIN } from "./audio";

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
  outputs: unknown[] = [];
  fftSize = 0;
  /** What an analyser reads: a constant signal of this amplitude (its RMS is the same). */
  sample = 0;
  getFloatTimeDomainData = (buffer: Float32Array) => void buffer.fill(this.sample);
  connect = <T>(target: T): T => {
    this.outputs.push(target);
    return target;
  };
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
  /** In creation order: the ambience's tap first, then the music's. */
  analysers: FakeNode[] = [];
  createAnalyser = () => {
    const node = this.make();
    this.analysers.push(node);
    return node;
  };
  mediaSources: Array<{ element: unknown; node: FakeNode }> = [];
  createMediaElementSource = (element: unknown) => {
    const node = this.make();
    this.mediaSources.push({ element, node });
    return node;
  };
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  /** The master gain is the first node that connects to the destination: created first. */
  get master() {
    return this.nodes[0];
  }
}
const Ctor = FakeContext as unknown as new () => AudioContext;

/** A stand-in for the <audio> element that streams the music bed. */
class FakeTrack {
  loop = false;
  preload = "";
  src = "";
  error: { code: number } | null = null;
  listeners = new Map<string, () => void>();
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  addEventListener = vi.fn((type: string, fn: () => void) => void this.listeners.set(type, fn));
  removeEventListener = vi.fn((type: string) => void this.listeners.delete(type));
}
function bed(track = new FakeTrack()) {
  const onError = vi.fn();
  const element = vi.fn(() => track as unknown as HTMLAudioElement);
  return { track, onError, element, options: { src: "/bed.mp3", onError, element } };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

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

describe("ambienceGain", () => {
  it("sets the ambience at the given share of the music's loudness", () => {
    expect(ambienceGain(0.04, 0.2, 0.5)).toBeCloseTo(0.1, 9);
    expect(ambienceGain(0.1, 0.4, 0.5)).toBeCloseTo(0.125, 9);
  });

  it("never turns the ambience up past its own level", () => {
    expect(ambienceGain(0.5, 0.05, 0.5)).toBe(1);
  });

  it("is silent when the music is, and safe when the ambience reads nothing", () => {
    expect(ambienceGain(0, 0.2, 0.5)).toBe(0);
    expect(ambienceGain(0.2, 0, 0.5)).toBe(1);
    expect(ambienceGain(0, 0, 0.5)).toBe(0);
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
    // 20% below the first version's 0.5, for a softer, more relaxed sound overall.
    expect(MASTER_GAIN).toBeCloseTo(0.5 * 0.8, 9);
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

describe("createAmbience with a music bed", () => {
  it("asks for no element and no file before the sound is turned on", () => {
    const m = bed();
    createAmbience(Ctor, () => 0.5, m.options);
    expect(m.element).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it("streams the file on a loop, through its own gain into the master", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    const ctx = contexts[0];
    expect(m.element).toHaveBeenCalledTimes(1);
    expect(m.track.src).toBe("/bed.mp3");
    expect(m.track.loop).toBe(true);
    expect(m.track.preload).toBe("none");
    expect(m.track.play).toHaveBeenCalledTimes(1);
    expect(ctx.mediaSources).toHaveLength(1);
    expect(ctx.mediaSources[0].element).toBe(m.track);
    const gain = ctx.mediaSources[0].node.outputs[0] as FakeNode;
    expect(gain.gain.value).toBe(MUSIC_GAIN);
    // Into the master, and into the tap the ambience listens to the music with.
    expect(gain.outputs).toEqual([ctx.master, ctx.analysers[1]]);
    expect(m.onError).not.toHaveBeenCalled();
    a.dispose();
  });

  it("starts the piece inside the click, before the context has resumed", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    const starting = a.start();
    expect(m.track.play).toHaveBeenCalledTimes(1);
    expect(a.running).toBe(false);
    await starting;
    a.dispose();
  });

  it("pauses it once the fade is over and picks it up again on the next start", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    a.stop();
    vi.advanceTimersByTime(1199);
    expect(m.track.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(m.track.pause).toHaveBeenCalledTimes(1);
    expect(m.track.removeAttribute).not.toHaveBeenCalled();
    await a.start();
    expect(m.track.play).toHaveBeenCalledTimes(2);
    expect(m.element).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it("keeps playing when the sound comes back during the fade", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    a.stop();
    await a.start();
    vi.advanceTimersByTime(2000);
    expect(m.track.pause).not.toHaveBeenCalled();
    a.dispose();
  });

  it("reports a file that will not load once, and plays the ambience without it", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    m.track.error = { code: 4 };
    m.track.listeners.get("error")!();
    m.track.listeners.get("error")!();
    expect(m.onError).toHaveBeenCalledTimes(1);
    expect(m.onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((m.onError.mock.calls[0][0] as Error).message).toContain("media error 4");
    expect(a.running).toBe(true);
    a.stop();
    vi.advanceTimersByTime(2000);
    await a.start();
    expect(m.track.play).toHaveBeenCalledTimes(1);
    expect(contexts[0].master.gain.last("target")![1]).toBe(MASTER_GAIN);
    a.dispose();
  });

  it("names an unknown media error as such", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    m.track.listeners.get("error")!();
    expect((m.onError.mock.calls[0][0] as Error).message).toContain("media error unknown");
    a.dispose();
  });

  it("treats a start cut short by a pause as no failure", async () => {
    const m = bed();
    m.track.play.mockRejectedValueOnce(Object.assign(new Error("interrupted"), { name: "AbortError" }));
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    await settle();
    expect(m.onError).not.toHaveBeenCalled();
    a.dispose();
  });

  it("reports a refused start once and still tries again next time", async () => {
    const m = bed();
    const refused = Object.assign(new Error("not allowed"), { name: "NotAllowedError" });
    m.track.play.mockRejectedValueOnce(refused).mockRejectedValueOnce(refused);
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    await settle();
    expect(m.onError).toHaveBeenCalledTimes(1);
    expect(m.onError).toHaveBeenCalledWith(refused);
    expect(a.running).toBe(true);
    a.stop();
    vi.advanceTimersByTime(2000);
    await a.start();
    await settle();
    expect(m.track.play).toHaveBeenCalledTimes(2);
    expect(m.onError).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it("reports an element that cannot be made and starts the ambience anyway", async () => {
    const failure = new Error("no media elements");
    const onError = vi.fn();
    const a = createAmbience(Ctor, () => 0.5, {
      src: "/bed.mp3",
      onError,
      element: () => {
        throw failure;
      },
    });
    await a.start();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(a.running).toBe(true);
    expect(contexts[0].mediaSources).toHaveLength(0);
    expect(() => a.dispose()).not.toThrow();
  });

  it("works without an error handler", async () => {
    const track = new FakeTrack();
    const a = createAmbience(Ctor, () => 0.5, { src: "/bed.mp3", element: () => track as unknown as HTMLAudioElement });
    await a.start();
    expect(() => track.listeners.get("error")!()).not.toThrow();
    a.dispose();
  });

  it("pauses the piece and rejects when the context will not resume", async () => {
    const m = bed();
    const blocked = new Error("blocked");
    class Blocked extends FakeContext {
      resume = vi.fn(async () => {
        throw blocked;
      });
    }
    const a = createAmbience(Blocked as unknown as new () => AudioContext, () => 0.5, m.options);
    await expect(a.start()).rejects.toBe(blocked);
    expect(m.track.pause).toHaveBeenCalledTimes(1);
    expect(a.running).toBe(false);
  });

  it("lets go of the file on dispose", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    a.dispose();
    expect(m.track.pause).toHaveBeenCalledTimes(1);
    expect(m.track.removeAttribute).toHaveBeenCalledWith("src");
    expect(m.track.load).toHaveBeenCalledTimes(1);
    expect(m.track.listeners.has("error")).toBe(false);
  });

  it("makes its own audio element when none is supplied", async () => {
    const made: FakeTrack[] = [];
    vi.stubGlobal(
      "Audio",
      class extends FakeTrack {
        constructor() {
          super();
          made.push(this);
        }
      },
    );
    const a = createAmbience(Ctor, () => 0.5, { src: "/bed.mp3" });
    await a.start();
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe("/bed.mp3");
    expect(made[0].play).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  /** The ambience's own volume control: the second node, after the master. */
  const ambienceVolume = (ctx: FakeContext) => ctx.nodes[2];
  const layersOf = (ctx: FakeContext) => ctx.nodes.filter((n) => n.gain.last("target") && n !== ctx.master && n !== ambienceVolume(ctx)).map((n) => n.gain.last("target")![1]);
  const tick = (ticks: number) => vi.advanceTimersByTime(ticks * AMBIENCE_FOLLOW_MS);

  it("keeps the ambience at half the music's loudness while the bed plays", async () => {
    // The wind and the stream are filtered noise with slow swells: next to a quiet piano they
    // read as surf, so they follow the music instead of sitting at a fixed level.
    expect(AMBIENCE_VS_MUSIC).toBe(0.5);
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    const ctx = contexts[0];
    const [ambienceTap, musicTap] = ctx.analysers;
    const volume = ambienceVolume(ctx);
    // Silent until it has heard the music, so it cannot burst in before the piece begins.
    expect(volume.gain.value).toBe(0);
    ambienceTap.sample = 0.1;
    musicTap.sample = 0.04;
    tick(40);
    expect(volume.gain.last("target")![1]).toBeCloseTo((0.5 * 0.04) / 0.1, 3);
    // The piece swells: the ambience follows it up, but never past its own level.
    musicTap.sample = 0.12;
    tick(40);
    expect(volume.gain.last("target")![1]).toBeCloseTo((0.5 * 0.12) / 0.1, 3);
    musicTap.sample = 0.5;
    tick(40);
    expect(volume.gain.last("target")![1]).toBe(1);
    // And back down with the music.
    musicTap.sample = 0.02;
    tick(60);
    expect(volume.gain.last("target")![1]).toBeCloseTo((0.5 * 0.02) / 0.1, 3);
    a.dispose();
  });

  it("goes quiet with the music when it stalls, and comes back with it", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    const ctx = contexts[0];
    const [ambienceTap, musicTap] = ctx.analysers;
    ambienceTap.sample = 0.1;
    musicTap.sample = 0.1;
    tick(40);
    expect(ambienceVolume(ctx).gain.last("target")![1]).toBeCloseTo(0.5, 3);
    musicTap.sample = 0;
    tick(60);
    expect(ambienceVolume(ctx).gain.last("target")![1]).toBeLessThan(0.001);
    musicTap.sample = 0.1;
    tick(60);
    expect(ambienceVolume(ctx).gain.last("target")![1]).toBeCloseTo(0.5, 3);
    a.dispose();
  });

  it("still moves the layers with the dusk and the place while the music plays", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    const ctx = contexts[0];
    a.setDusk(1);
    a.setPlace({ water: 1, open: 0 });
    const expected = layerLevels(1, { water: 1, open: 0 });
    expect(layersOf(ctx)).toEqual([expected.wind, expected.stream, expected.crickets]);
    a.dispose();
  });

  it("stops following the music when the sound goes off, and starts again with it", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    const ctx = contexts[0];
    const [ambienceTap, musicTap] = ctx.analysers;
    ambienceTap.sample = 0.1;
    musicTap.sample = 0.1;
    tick(10);
    a.stop();
    const calls = ambienceVolume(ctx).gain.calls.length;
    tick(20);
    expect(ambienceVolume(ctx).gain.calls.length).toBe(calls);
    vi.advanceTimersByTime(2000);
    await a.start();
    tick(10);
    expect(ambienceVolume(ctx).gain.calls.length).toBeGreaterThan(calls);
    a.dispose();
    const after = ambienceVolume(ctx).gain.calls.length;
    tick(20);
    expect(ambienceVolume(ctx).gain.calls.length).toBe(after);
  });

  it("plays the ambience in full at once when the bed cannot be loaded", async () => {
    const m = bed();
    const a = createAmbience(Ctor, () => 0.5, m.options);
    await a.start();
    const ctx = contexts[0];
    const volume = ambienceVolume(ctx);
    ctx.analysers[1].sample = 0.1;
    ctx.analysers[0].sample = 0.1;
    tick(10);
    expect(volume.gain.last("target")![1]).toBeCloseTo(0.5, 3);
    m.track.listeners.get("error")!();
    expect(volume.gain.last("target")![1]).toBe(1);
    // It stays in full: the music is no longer listened to.
    ctx.analysers[1].sample = 0;
    tick(40);
    expect(volume.gain.last("target")![1]).toBe(1);
    a.dispose();
  });

  it("plays the ambience in full when the audio element cannot be made", async () => {
    const a = createAmbience(Ctor, () => 0.5, {
      src: "/bed.mp3",
      element: () => {
        throw new Error("no media elements");
      },
    });
    await a.start();
    expect(ambienceVolume(contexts[0]).gain.value).toBe(1);
    a.dispose();
  });

  it("leaves the ambience in full, with nothing to follow, when no bed is asked for", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    const ctx = contexts[0];
    expect(ambienceVolume(ctx).gain.value).toBe(1);
    expect(ctx.analysers).toHaveLength(0);
    tick(40);
    expect(ambienceVolume(ctx).gain.calls.filter((c) => c[0] === "target")).toHaveLength(0);
    a.dispose();
  });

  it("adds no media element when no bed is asked for", async () => {
    const a = createAmbience(Ctor, () => 0.5);
    await a.start();
    expect(contexts[0].mediaSources).toHaveLength(0);
    a.dispose();
  });
});

describe("MUSIC_BED", () => {
  it("points at a file that ships with the site, small enough to stream on demand", () => {
    expect(MUSIC_BED.src).toMatch(/^\/sawad\/audio\/[a-z0-9-]+\.mp3$/);
    const file = statSync(join(process.cwd(), "public", MUSIC_BED.src));
    expect(file.size).toBeGreaterThan(500_000);
    expect(file.size).toBeLessThan(6_000_000);
  });

  it("names the piece, its composer, the licence and where it comes from", () => {
    expect(MUSIC_BED).toMatchObject({ title: "With These Hands", artist: "Scott Buckley", licence: "CC-BY 4.0", url: "https://www.scottbuckley.com.au" });
  });
});
