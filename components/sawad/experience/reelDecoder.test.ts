import { afterEach, describe, expect, it, vi } from "vitest";

const mb = vi.hoisted(() => ({ canDecode: true, track: true as boolean, disposed: 0, urls: [] as string[], samples: vi.fn() }));
vi.mock("mediabunny", () => {
  class UrlSource {
    constructor(public url: string) {
      mb.urls.push(url);
    }
  }
  class Input {
    constructor(public options: unknown) {}
    async getPrimaryVideoTrack() {
      return mb.track ? { canDecode: async () => mb.canDecode, getDisplayWidth: async () => 1920, getDisplayHeight: async () => 1080 } : null;
    }
    dispose() {
      mb.disposed++;
    }
  }
  class VideoSampleSink {
    constructor(public track: unknown) {}
    samples(start?: number, end?: number) {
      return mb.samples(start, end);
    }
  }
  return { ALL_FORMATS: ["mp4"], Input, UrlSource, VideoSampleSink };
});

import { TourDecoder, openWithMediabunny, type DecodedFrame, type OpenTrack, type TourTrack } from "./reelDecoder";

const FPS = 30;
const GOP = 20;
const LAST = 1440;

type Frame = DecodedFrame & { index: number; closed: number };

/**
 * A track that behaves like Mediabunny's: `samples(start, end)` decodes from the key frame at or
 * before `start` and yields from the frame at `start` up to the one before `end`. Every frame it
 * yields is kept here, so a test can tell whether each was closed.
 */
function fakeTrack(options: { throwAt?: number } = {}) {
  const made: Frame[] = [];
  const calls: Array<{ start: number; end: number | null; decodedFrom: number; returned: boolean }> = [];
  let gate: { promise: Promise<void>; open: () => void } | null = null;
  const track: TourTrack & { disposed: boolean } = {
    width: 1920,
    height: 1080,
    disposed: false,
    samples(start: number, end?: number) {
      const first = Math.floor(start * FPS);
      const call = { start: first, end: end === undefined ? null : Math.ceil(end * FPS), decodedFrom: Math.floor(first / GOP) * GOP, returned: false };
      calls.push(call);
      let f = first;
      return {
        async next() {
          if (gate) await gate.promise;
          await Promise.resolve();
          if (call.returned || f > LAST || (end !== undefined && f / FPS >= end)) return { done: true as const, value: undefined };
          if (options.throwAt !== undefined && f === options.throwAt) throw new Error(`decode failed at ${f}`);
          const frame: Frame = { index: f, timestamp: f / FPS, closed: 0, draw: () => {}, close: () => frame.closed++ };
          made.push(frame);
          f++;
          return { done: false as const, value: frame };
        },
        async return() {
          call.returned = true;
          return { done: true as const, value: undefined };
        },
      };
    },
    dispose() {
      track.disposed = true;
    },
  };
  return {
    track,
    made,
    calls,
    hold() {
      let open = () => {};
      const promise = new Promise<void>((r) => (open = r));
      gate = { promise, open };
    },
    release() {
      gate?.open();
      gate = null;
    },
  };
}

const settle = async (rounds = 200) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

function decoderWith(tracks: Record<string, ReturnType<typeof fakeTrack> | null | Error>, cap = 60) {
  const onError = vi.fn();
  const onCodecFailed = vi.fn();
  const openTrack: OpenTrack = async (url) => {
    const t = tracks[url];
    if (t instanceof Error) throw t;
    return t ? t.track : null;
  };
  const sources = (["av1", "hevc", "h264"] as const).filter((c) => c in tracks).map((codec) => ({ codec, url: codec }));
  const decoder = new TourDecoder({ sources, cap, gop: GOP, fps: FPS, last: LAST, openTrack, onError, onCodecFailed });
  return { decoder, onError, onCodecFailed };
}

const held = (decoder: TourDecoder, from = 0, to = LAST) => {
  const out: number[] = [];
  for (let f = from; f <= to; f++) if (decoder.get(f)) out.push(f);
  return out;
};
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/**
 * Every frame the track gave out is held by the decoder or closed, none twice or while held. The
 * one exception is a frame a job holds at the window's edge until the playhead brings it in.
 * Closing the decoder then closes all of them.
 */
const noLeaks = (decoder: TourDecoder, made: Frame[]) => {
  const loose = made.filter((f) => f.closed === 0 && decoder.get(f.index) !== f).map((f) => f.index);
  expect(loose.length <= 1 && loose.every((f) => f === decoder.window()[1] + 1), `loose frames ${loose.join(",")}`).toBe(true);
  for (const f of made) if (decoder.get(f.index) === f) expect(f.closed).toBe(0);
  expect(made.every((f) => f.closed <= 1)).toBe(true);
  decoder.close();
  expect(made.every((f) => f.closed === 1)).toBe(true);
};

afterEach(() => {
  mb.canDecode = true;
  mb.track = true;
  mb.disposed = 0;
  mb.urls = [];
  mb.samples.mockReset();
});

describe("TourDecoder", () => {
  it("opens the first codec that decodes and starts filling at the gate, where the tour begins", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    expect(decoder.width).toBe(0);
    expect(decoder.codec).toBeNull();
    expect(decoder.nearest(0)).toBeNull();
    await expect(decoder.open()).resolves.toBe("av1");
    expect(decoder.codec).toBe("av1");
    expect([decoder.width, decoder.height]).toEqual([1920, 1080]);
    await settle();
    expect(held(decoder)).toEqual(range(0, 30));
    noLeaks(decoder, av1.made);
  });

  it("fills the window ahead of the playhead in the direction it moves, and one group behind", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    decoder.update(100.4, 20);
    await decoder.open();
    await settle();
    // 1.5 groups ahead (30 frames), one behind (20).
    expect(held(decoder)).toEqual(range(80, 130));
    // The frames ahead came first, from the playhead's own key frame.
    expect(av1.calls[0]).toMatchObject({ start: 100, end: null, decodedFrom: 100 });
    expect(decoder.window()).toEqual([80, 130]);
    // Moving the other way turns the window round.
    decoder.update(100.4, -20);
    expect(decoder.window()).toEqual([70, 120]);
    expect(decoder.stats()).toMatchObject({ codec: "av1" });
    expect(decoder.stats().jobs).toBeGreaterThan(1);
    noLeaks(decoder, av1.made);
  });

  it("runs on as the playhead moves forward, without starting over from a key frame", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    decoder.update(100, 20);
    await decoder.open();
    await settle();
    const jobs = decoder.stats().jobs;
    for (let f = 100; f <= 140; f += 0.5) {
      decoder.update(f, 15);
      await settle(3);
    }
    await settle();
    expect(held(decoder)).toEqual(range(120, 170));
    // One job runs ahead the whole way, woken at the window's edge, never started over.
    expect(decoder.stats().jobs).toBe(jobs + 1);
    noLeaks(decoder, av1.made);
  });

  it("closes every frame that leaves the window", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    decoder.update(100, 20);
    await decoder.open();
    await settle();
    const first = av1.made.filter((f) => f.closed === 0);
    decoder.update(400, 20);
    await settle();
    expect(first.length).toBeGreaterThan(40);
    expect(first.every((f) => f.closed === 1)).toBe(true);
    noLeaks(decoder, av1.made);
    expect(av1.track.disposed).toBe(true);
    expect(decoder.get(400)).toBeNull();
  });

  it("never holds more than its cap", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 }, 12);
    await decoder.open();
    for (const [f, v] of [[100, 20], [130, 20], [125, -20], [90, -20], [600, 20]] as const) {
      decoder.update(f, v);
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 0));
        expect(decoder.stats().held).toBeLessThanOrEqual(12);
      }
    }
    // The window shrinks to the cap, behind first; the base and the frame after it are always in.
    const [lo, hi] = decoder.window();
    expect(hi - lo + 1).toBeLessThanOrEqual(12);
    expect(decoder.get(600)).not.toBeNull();
    expect(decoder.get(601)).not.toBeNull();
    noLeaks(decoder, av1.made);
  });

  it("scrolling backward decodes the group before the playhead in one burst from its key frame", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    decoder.update(700, -20);
    await decoder.open();
    await settle();
    // Backward: 30 frames below the playhead, 20 above.
    expect(held(decoder)).toEqual(range(670, 720));
    const bursts = av1.calls.filter((c) => c.end !== null);
    // The group 680 to 699 from its key frame, then 670 to 679 (decoded from 660, the window starts at 670).
    expect(bursts).toEqual([
      expect.objectContaining({ start: 680, end: 700, decodedFrom: 680 }),
      expect.objectContaining({ start: 670, end: 680, decodedFrom: 660 }),
    ]);
    // On down: each step back past a key frame is one more burst.
    for (let f = 700; f >= 655; f -= 0.5) {
      decoder.update(f, -15);
      await settle(3);
    }
    await settle();
    expect(held(decoder)).toEqual(range(625, 675));
    expect(av1.calls.at(-1)).toMatchObject({ end: expect.any(Number) });
    noLeaks(decoder, av1.made);
  });

  it("cancels the running job when the playhead jumps far, and starts again from there", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    av1.hold();
    decoder.update(100, 20);
    await decoder.open();
    expect(av1.calls).toHaveLength(1);
    decoder.update(900, 20);
    expect(av1.calls[0].returned).toBe(true);
    expect(av1.calls[1]).toMatchObject({ start: 900, decodedFrom: 900, returned: false });
    av1.release();
    await settle();
    expect(held(decoder)).toEqual(range(880, 930));
    expect(held(decoder, 0, 200)).toEqual([]);
    noLeaks(decoder, av1.made);
  });

  it("keeps a job that is about to reach the playhead", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    av1.hold();
    decoder.update(100, 20);
    await decoder.open();
    decoder.update(110, 20);
    expect(av1.calls).toHaveLength(1);
    expect(av1.calls[0].returned).toBe(false);
    av1.release();
    await settle();
    expect(held(decoder)).toEqual(range(90, 140));
  });

  it("goes to the next codec when one cannot be decoded or cannot be fetched", async () => {
    const h264 = fakeTrack();
    const { decoder, onCodecFailed, onError } = decoderWith({ av1: null, hevc: new Error("network"), h264 });
    await expect(decoder.open()).resolves.toBe("h264");
    expect(onCodecFailed).toHaveBeenNthCalledWith(1, "av1", expect.objectContaining({ message: expect.stringContaining("av1 cannot be decoded") }));
    expect(onCodecFailed).toHaveBeenNthCalledWith(2, "hevc", expect.objectContaining({ message: "network" }));
    expect(onError).not.toHaveBeenCalled();
    decoder.update(10, 20);
    await settle();
    expect(decoder.get(10)).not.toBeNull();
  });

  it("goes to the next codec when decoding fails mid-way, from the same playhead", async () => {
    const av1 = fakeTrack({ throwAt: 115 });
    const hevc = fakeTrack();
    const { decoder, onCodecFailed, onError } = decoderWith({ av1, hevc });
    decoder.update(100, 20);
    await decoder.open();
    await settle();
    expect(onCodecFailed).toHaveBeenCalledWith("av1", expect.objectContaining({ message: "decode failed at 115" }));
    expect(onError).not.toHaveBeenCalled();
    expect(decoder.codec).toBe("hevc");
    expect(av1.track.disposed).toBe(true);
    expect(av1.made.every((f) => f.closed === 1)).toBe(true);
    expect(held(decoder)).toEqual(range(80, 130));
    noLeaks(decoder, hevc.made);
  });

  it("tells its error callback when no codec is left, and then does nothing", async () => {
    const none = decoderWith({ av1: null, h264: null });
    await expect(none.decoder.open()).resolves.toBeNull();
    expect(none.onError).toHaveBeenCalledTimes(1);
    expect(none.onError.mock.calls[0][0]).toEqual(expect.objectContaining({ message: expect.stringContaining("h264 cannot be decoded") }));
    none.decoder.update(10, 1);
    expect(none.decoder.get(10)).toBeNull();

    const h264 = fakeTrack({ throwAt: 12 });
    const late = decoderWith({ h264 });
    late.decoder.update(10, 20);
    await late.decoder.open();
    await settle();
    expect(late.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "decode failed at 12" }));
    expect(late.onCodecFailed).not.toHaveBeenCalled();
    expect(late.decoder.codec).toBeNull();
    expect(h264.made.every((f) => f.closed === 1)).toBe(true);
  });

  it("finds the nearest frame it holds while the one wanted is still coming", async () => {
    const av1 = fakeTrack();
    const { decoder } = decoderWith({ av1 });
    decoder.update(100, 20);
    await decoder.open();
    await settle();
    av1.hold();
    decoder.update(300, 20);
    // Everything around 100 has left the window; nothing near 300 is in yet.
    expect(decoder.nearest(300)).toBeNull();
    av1.release();
    await settle();
    expect(decoder.nearest(250)).toBe(280);
    expect(decoder.nearest(1000)).toBe(330);
  });

  it("stops at once when closed while opening", async () => {
    let resolve: (t: TourTrack) => void = () => {};
    const t = fakeTrack();
    const decoder = new TourDecoder({ sources: [{ codec: "av1", url: "a" }], cap: 60, openTrack: () => new Promise((r) => (resolve = r)) });
    const opened = decoder.open();
    decoder.close();
    resolve(t.track);
    await expect(opened).resolves.toBeNull();
    expect(t.track.disposed).toBe(true);
  });
});

describe("openWithMediabunny", () => {
  it("opens the file over range requests and gives its size and its frames", async () => {
    mb.samples.mockReturnValue("iterator");
    const track = await openWithMediabunny("/tour.mp4");
    expect(mb.urls).toEqual(["/tour.mp4"]);
    expect(track).not.toBeNull();
    expect([track!.width, track!.height]).toEqual([1920, 1080]);
    expect(track!.samples(1, 2)).toBe("iterator");
    expect(mb.samples).toHaveBeenCalledWith(1, 2);
    track!.dispose();
    expect(mb.disposed).toBe(1);
  });

  it("is null, with the file let go, where the codec cannot be decoded or there is no video", async () => {
    mb.canDecode = false;
    await expect(openWithMediabunny("/a.mp4")).resolves.toBeNull();
    mb.canDecode = true;
    mb.track = false;
    await expect(openWithMediabunny("/b.mp4")).resolves.toBeNull();
    expect(mb.disposed).toBe(2);
  });
});
