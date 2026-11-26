import { REEL_FPS, TOUR_FRAMES, TOUR_GOP, type ReelCodec } from "./reel";

/**
 * The tour decoded in the page with WebCodecs, through Mediabunny, into a sliding window of frames
 * held in memory around the playhead. StoryReel draws from that window on every refresh, so a frame
 * step costs a canvas draw instead of a browser seek (and Safari no longer flushes its decoder at
 * every one). The tour file keeps a key frame every TOUR_GOP frames: forward the decoder simply runs
 * on; backward it decodes the previous group of pictures in one burst from its key frame.
 *
 * Decoded frames stay as they come (VideoSample, a VideoFrame underneath, usually on the GPU: about
 * 3 MB at 1080p against 8 MB as RGBA on a canvas) and each is closed as it leaves the window.
 *
 * Mediabunny is loaded with a dynamic import when the tour is opened, so it is never in the page's
 * first bundle. The track is reached through `OpenTrack`, which tests replace with a fake.
 */

/** A decoded frame: what the window holds. Mediabunny's VideoSample is one. */
export type DecodedFrame = {
  /** Presentation time in seconds. */
  readonly timestamp: number;
  draw(context: CanvasRenderingContext2D, dx: number, dy: number, dWidth?: number, dHeight?: number): void;
  close(): void;
};

/** An open video track that can be decoded. */
export type TourTrack = {
  readonly width: number;
  readonly height: number;
  /**
   * Frames in presentation order from the last one at or before `start` up to (not including) the
   * first at or after `end`, in seconds. Decoding starts at the key frame before `start`.
   */
  samples(start: number, end?: number): AsyncIterator<DecodedFrame, void>;
  dispose(): void;
};

/** Opens a file's video track, or resolves null when this browser cannot decode it. */
export type OpenTrack = (url: string) => Promise<TourTrack | null>;

/**
 * The real track: the file read over HTTP range requests (`UrlSource`), which is simpler and better
 * here than fetching the whole file into a Blob first. The first frame shows after the header and
 * one group of pictures have come, not the whole file; asking a codec whether it decodes costs only
 * the header (7 KB, at the front of the file); and the source's cache (64 MiB by default, more than
 * the largest tour) keeps what was read, so scrolling back does not fetch again.
 */
export const openWithMediabunny: OpenTrack = async (url) => {
  const { ALL_FORMATS, Input, UrlSource, VideoSampleSink } = await import("mediabunny");
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }
    const [width, height] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
    const sink = new VideoSampleSink(track);
    return { width, height, samples: (start, end) => sink.samples(start, end), dispose: () => input.dispose() };
  } catch (error) {
    input.dispose();
    throw error;
  }
};

export type TourDecoderOptions = {
  /** The tour in each codec, best first. The first this browser decodes is used; one that fails mid-way gives way to the next. */
  sources: ReadonlyArray<{ codec: ReelCodec; url: string }>;
  /** The most frames held at once. */
  cap: number;
  /** Frames from one key frame to the next. */
  gop?: number;
  fps?: number;
  /** The last frame's index. */
  last?: number;
  openTrack?: OpenTrack;
  /** A codec failed (could not be opened, or decoding failed) and the next is being tried. */
  onCodecFailed?: (codec: ReelCodec, error: unknown) => void;
  /** No codec is left: the decoder has stopped and the page should show the tour some other way. */
  onError?: (error: unknown) => void;
};

/** One decode job: a run of `samples()` from `next` up to (not including) frame `end`. */
type Job = {
  kind: "ahead" | "behind";
  next: number;
  end: number;
  it: AsyncIterator<DecodedFrame, void>;
  cancelled: boolean;
  /** A frame decoded past the window's edge, held until the playhead brings it in. */
  parked: DecodedFrame | null;
  wake: (() => void) | null;
};

export type TourDecoderStats = { held: number; jobs: number; codec: ReelCodec | null };

export class TourDecoder {
  private readonly frames = new Map<number, DecodedFrame>();
  private readonly gop: number;
  private readonly fps: number;
  private readonly last: number;
  private readonly openTrack: OpenTrack;
  private track: TourTrack | null = null;
  private codecIndex = -1;
  private job: Job | null = null;
  private head = 0;
  private dir: 1 | -1 = 1;
  private jobs = 0;
  private closed = false;

  constructor(private readonly options: TourDecoderOptions) {
    this.gop = Math.max(1, options.gop ?? TOUR_GOP);
    this.fps = options.fps ?? REEL_FPS;
    this.last = options.last ?? TOUR_FRAMES;
    this.openTrack = options.openTrack ?? openWithMediabunny;
  }

  /** The codec in use, null until a file is open (or after all failed). */
  get codec(): ReelCodec | null {
    return this.track ? this.options.sources[this.codecIndex].codec : null;
  }

  /** The size of the decoded frames, 0 until a file is open. */
  get width(): number {
    return this.track?.width ?? 0;
  }
  get height(): number {
    return this.track?.height ?? 0;
  }

  /** Opens the first codec this browser decodes and starts filling the window. Resolves with it, or null (and `onError`) when none does. */
  open(): Promise<ReelCodec | null> {
    return this.openFrom(0, null);
  }

  /** Where the playhead is (in tour frames, fractional) and how fast it is moving (frames a second): steers the window. */
  update(frame: number, velocity: number): void {
    if (this.closed) return;
    this.head = Math.min(this.last, Math.max(0, Number.isFinite(frame) ? frame : 0));
    if (velocity > 1e-3) this.dir = 1;
    else if (velocity < -1e-3) this.dir = -1;
    this.pump();
  }

  /** A decoded frame, or null when it is not held. */
  get(frame: number): DecodedFrame | null {
    return this.frames.get(frame) ?? null;
  }

  /** The held frame closest to `frame`, or null when none is held. */
  nearest(frame: number): number | null {
    let best: number | null = null;
    let distance = Infinity;
    for (const f of this.frames.keys()) {
      const d = Math.abs(f - frame);
      if (d < distance) {
        distance = d;
        best = f;
      }
    }
    return best;
  }

  stats(): TourDecoderStats {
    return { held: this.frames.size, jobs: this.jobs, codec: this.codec };
  }

  /** Stops decoding and frees every frame and the file. */
  close(): void {
    this.closed = true;
    this.stop();
  }

  private stop(): void {
    if (this.job) this.cancel(this.job);
    for (const frame of this.frames.values()) frame.close();
    this.frames.clear();
    this.track?.dispose();
    this.track = null;
  }

  private async openFrom(index: number, cause: unknown): Promise<ReelCodec | null> {
    let lastError = cause;
    for (let i = index; i < this.options.sources.length; i++) {
      if (this.closed) return null;
      const { codec, url } = this.options.sources[i];
      let track: TourTrack | null = null;
      try {
        track = await this.openTrack(url);
        if (!track) lastError = new Error(`The tour's ${codec} cannot be decoded in this browser`);
      } catch (error) {
        lastError = error;
      }
      if (this.closed) {
        track?.dispose();
        return null;
      }
      if (track) {
        this.track = track;
        this.codecIndex = i;
        this.pump();
        return codec;
      }
      if (i + 1 < this.options.sources.length) this.options.onCodecFailed?.(codec, lastError);
    }
    this.closed = true;
    this.options.onError?.(lastError ?? new Error("The tour could not be decoded"));
    return null;
  }

  /** Decoding failed mid-way: everything from that codec goes, and the next codec is opened. */
  private failed(error: unknown): void {
    if (this.closed) return;
    const codec = this.codec;
    const index = this.codecIndex;
    this.stop();
    if (codec && index + 1 < this.options.sources.length) this.options.onCodecFailed?.(codec, error);
    void this.openFrom(index + 1, error);
  }

  private base(): number {
    return Math.min(this.last, Math.floor(this.head));
  }

  private keyFrame(frame: number): number {
    return Math.floor(frame / this.gop) * this.gop;
  }

  /**
   * The frames wanted, inclusive: about one and a half groups of pictures ahead of the playhead in
   * the direction it moves, one behind, and never more than `cap`; the side behind gives way first.
   */
  window(): [number, number] {
    const b = this.base();
    let ahead = Math.ceil(1.5 * this.gop);
    let behind = this.gop;
    const cap = Math.max(2, this.options.cap);
    if (ahead + behind + 1 > cap) behind = Math.max(1, cap - 1 - ahead);
    if (ahead + behind + 1 > cap) ahead = cap - 1 - behind;
    const lo = this.dir > 0 ? b - behind : b - ahead;
    const hi = this.dir > 0 ? b + ahead : b + behind;
    return [Math.max(0, lo), Math.min(this.last, hi)];
  }

  /** The frame most wanted that is not held: the base, the one over it, then outward in the direction of motion, then the other way. */
  private target(lo: number, hi: number): number | null {
    const b = this.base();
    if (!this.frames.has(b)) return b;
    if (b + 1 <= hi && !this.frames.has(b + 1)) return b + 1;
    for (const dir of [this.dir, -this.dir]) {
      for (let f = b + dir; f >= lo && f <= hi; f += dir) if (!this.frames.has(f)) return f;
    }
    return null;
  }

  /** Brings the window and the decode job up to date with the playhead. */
  private pump(): void {
    if (this.closed || !this.track) return;
    const [lo, hi] = this.window();
    for (const [f, frame] of this.frames) {
      if (f < lo || f > hi) {
        frame.close();
        this.frames.delete(f);
      }
    }
    const job = this.job;
    if (job) {
      const b = this.base();
      // A frame waiting at the edge that the window now takes in: the job carries on.
      if (job.parked && job.next <= hi) {
        job.wake?.();
        return;
      }
      // The base is missing and this job will not reach it soon (the playhead jumped): start again from there.
      const reaches = job.next <= b && b < job.end && b - job.next <= this.gop;
      const useless = job.end - 1 < lo || job.next > hi;
      if ((!this.frames.has(b) && !reaches) || (useless && this.target(lo, hi) !== null)) this.cancel(job);
      else return;
    }
    const t = this.target(lo, hi);
    if (t === null) return;
    // From the key frame (or the window's edge): those frames are decoded on the way anyway.
    let start = Math.max(lo, this.keyFrame(t));
    while (start < t && this.frames.has(start)) start++;
    const b = this.base();
    const kind = t >= b ? "ahead" : "behind";
    // Ahead runs on until the window's edge stops it; behind is one burst up to the frame wanted.
    const end = kind === "ahead" ? this.last + 1 : t + 1;
    const it = this.track.samples((start + 0.5) / this.fps, end > this.last ? undefined : (end - 0.5) / this.fps);
    const next: Job = { kind, next: start, end, it, cancelled: false, parked: null, wake: null };
    this.job = next;
    this.jobs++;
    void this.run(next);
  }

  private cancel(job: Job): void {
    job.cancelled = true;
    job.parked?.close();
    job.parked = null;
    job.wake?.();
    if (this.job === job) this.job = null;
    // Ends Mediabunny's iterator: it stops decoding and closes the frames it had queued.
    void job.it.return?.()?.catch(() => {});
  }

  private async run(job: Job): Promise<void> {
    let error: unknown = null;
    try {
      while (!job.cancelled) {
        const result = await job.it.next();
        if (result.done) break;
        const sample = result.value;
        if (job.cancelled) {
          sample.close();
          break;
        }
        const f = Math.round(sample.timestamp * this.fps);
        if (f >= job.end) {
          sample.close();
          break;
        }
        // Past the window's edge: wait for the playhead (or for the job to be cancelled, which closes it).
        if (f > this.window()[1]) {
          job.parked = sample;
          job.next = f;
          const woken = new Promise<void>((resolve) => (job.wake = resolve));
          // Frames missing elsewhere in the window (behind the playhead) go first: this cancels the job.
          this.pump();
          await woken;
          job.wake = null;
          if (job.cancelled) break;
          job.parked = null;
        }
        job.next = f + 1;
        this.keep(f, sample);
      }
    } catch (e) {
      if (!job.cancelled) error = e;
    }
    if (this.job !== job) return;
    this.job = null;
    if (error !== null) this.failed(error);
    else this.pump();
  }

  private keep(f: number, sample: DecodedFrame): void {
    const [lo, hi] = this.window();
    if (this.frames.has(f) || f < lo || f > hi || this.frames.size >= this.options.cap) {
      sample.close();
      return;
    }
    this.frames.set(f, sample);
  }
}
