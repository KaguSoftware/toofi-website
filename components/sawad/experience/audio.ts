/**
 * Sound for the experience. The ambience is synthesised with the Web Audio API: wind through
 * the olive leaves and the stream (Zaitun's two signature sounds), birds by day and crickets at
 * dusk. The music bed is the one file that is downloaded, streamed by an <audio> element. While
 * the bed plays, the ambience is held at half the music's loudness (AMBIENCE_VS_MUSIC), measured
 * as it goes, so it rises and falls with the piece; with no bed, or if the bed fails, it plays in
 * full. Everything is off until the visitor turns the sound on; the audio context and the
 * element are only created then, inside their click.
 */
export type Ambience = {
  /** Fades the sound in. Call from a user gesture. */
  start: () => Promise<void>;
  /** Fades it out and suspends the context. */
  stop: () => void;
  /** 0 by day, 1 at dusk: birds give way to crickets and the wind drops. */
  setDusk: (k: number) => void;
  /** How near the listener is to the stream and how open the place is (both 0 to 1). */
  setPlace: (place: { water: number; open: number }) => void;
  readonly running: boolean;
  dispose: () => void;
};

/** The level of everything, music and ambience together: 0.4, soft and relaxed (it was 0.5; 20% lower). */
export const MASTER_GAIN = 0.4;
const FADE_SECONDS = 1.2;

/**
 * The music bed: "With These Hands" by Scott Buckley, the whole piece, looped. It is licensed
 * CC BY 4.0, so the credit (`showcase.musicCredit`, shown by the controls while the sound is on)
 * has to stay wherever the piece plays.
 */
export const MUSIC_BED = {
  src: "/sawad/audio/with-these-hands.mp3",
  title: "With These Hands",
  artist: "Scott Buckley",
  licence: "CC-BY 4.0",
  url: "https://www.scottbuckley.com.au",
} as const;

/** The bed's level under the master gain. The file is the piece as released, not re-levelled. */
export const MUSIC_GAIN = 0.8;

/**
 * How loud the synthesised ambience is next to the music while the bed plays, as a share of the
 * music's loudness (its RMS level): 0.5 is half as loud. The ambience follows the piece, which
 * runs from about -30 dB in its opening to -13 dB at its peak, instead of sitting at a fixed
 * level that would drown the opening or vanish under the peak. Set it to 0 for the music alone.
 */
export const AMBIENCE_VS_MUSIC = 0.5;
/** How often the two levels are read, in milliseconds. */
export const AMBIENCE_FOLLOW_MS = 200;

export type MusicOptions = {
  src: string;
  /** Called once if the bed cannot be loaded or played. The ambience carries on without it. */
  onError?: (error: unknown) => void;
  /** Makes the element (tests pass a stand-in). */
  element?: () => HTMLAudioElement;
};

type ContextCtor = new () => AudioContext;

function contextCtor(): ContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: ContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** True where the browser can make sound at all. */
export function audioSupported(): boolean {
  return contextCtor() !== null;
}

/** Two seconds of white noise, looped: the raw material for wind and water. */
function noiseBuffer(ctx: AudioContext, seed = 1): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    // xorshift: the same hiss every time, so the loop point never clicks differently.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = ((s >>> 0) / 4294967295) * 2 - 1;
  }
  return buffer;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How loud each layer is for a time of day and a place. Exported for tests. */
export function layerLevels(dusk: number, place: { water: number; open: number }): { wind: number; stream: number; birds: number; crickets: number } {
  const k = clamp01(dusk);
  const water = clamp01(place.water);
  const open = clamp01(place.open);
  return {
    wind: (0.16 + 0.2 * open) * (1 - 0.45 * k),
    stream: 0.04 + 0.36 * water,
    birds: (1 - k) * (0.5 + 0.5 * open),
    crickets: k * 0.5,
  };
}

/**
 * The volume for the ambience so that it is `ratio` as loud as the music, given the loudness
 * (RMS) of each as they are now. Never above 1: the ambience cannot be louder than it is made.
 * Exported for tests.
 */
export function ambienceGain(musicRms: number, ambienceRms: number, ratio: number): number {
  return clamp01((ratio * musicRms) / Math.max(ambienceRms, 1e-4));
}

/** The RMS level of what an analyser hears right now. */
function rmsOf(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

/**
 * Builds the sound. `Ctor` is the AudioContext to use (tests pass a stand-in); `random` drives
 * when the birds call; `music` adds a bed from a file.
 */
export function createAmbience(
  Ctor: ContextCtor | null = contextCtor(),
  random: () => number = Math.random,
  music: MusicOptions | null = null,
): Ambience {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let layers: { wind: GainNode; stream: GainNode; crickets: GainNode } | null = null;
  /** Where every synthesised layer comes in, and the one volume control after it. */
  let ambienceIn: GainNode | null = null;
  let ambienceVolume: GainNode | null = null;
  let taps: { ambience: AnalyserNode; music: AnalyserNode } | null = null;
  let followTimer: ReturnType<typeof setInterval> | null = null;
  let heard: { ambience: number; music: number } | null = null;
  let sources: AudioScheduledSourceNode[] = [];
  let birdTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dusk = 0;
  let place = { water: 0.3, open: 0.6 };
  let track: HTMLAudioElement | null = null;
  /** The file could not be loaded: it is not asked for again. */
  let musicDead = false;
  let musicReported = false;

  const musicFailed = (error: unknown) => {
    if (musicReported) return;
    musicReported = true;
    music?.onError?.(error);
  };
  const stopFollowing = () => {
    if (followTimer !== null) clearInterval(followTimer);
    followTimer = null;
    heard = null;
  };
  /** Sets the ambience's volume: half the music's loudness, or full if there is no music. */
  const follow = () => {
    if (!ctx || !ambienceVolume) return;
    const t = ctx.currentTime;
    if (!track || musicDead || !taps) {
      ambienceVolume.gain.setTargetAtTime(1, t, 0.4);
      return;
    }
    const buffer = new Float32Array(taps.music.fftSize);
    const now = { ambience: rmsOf(taps.ambience, buffer), music: rmsOf(taps.music, buffer) };
    // Smoothed over about a second, so a beat or a chirp does not move the level.
    heard = heard ? { ambience: heard.ambience * 0.7 + now.ambience * 0.3, music: heard.music * 0.7 + now.music * 0.3 } : now;
    ambienceVolume.gain.setTargetAtTime(ambienceGain(heard.music, heard.ambience, AMBIENCE_VS_MUSIC), t, 0.6);
  };
  const onTrackError = () => {
    musicDead = true;
    musicFailed(new Error(`The music bed could not be loaded (media error ${track?.error?.code ?? "unknown"})`));
    // No bed: the ambience takes over in full, so the button still does something.
    stopFollowing();
    follow();
  };
  const playMusic = () => {
    if (!track || musicDead) return;
    track.play().catch((error: unknown) => {
      // A start cut short by a pause (sound switched off again straight away) is not a failure.
      if ((error as { name?: string } | null)?.name !== "AbortError") musicFailed(error);
    });
  };

  const apply = () => {
    if (!ctx || !layers) return;
    const levels = layerLevels(dusk, place);
    const t = ctx.currentTime;
    layers.wind.gain.setTargetAtTime(levels.wind, t, 0.8);
    layers.stream.gain.setTargetAtTime(levels.stream, t, 0.8);
    layers.crickets.gain.setTargetAtTime(levels.crickets, t, 1.5);
  };

  const build = (c: AudioContext) => {
    master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
    // Every synthesised layer comes in at `ambienceIn`; `ambienceVolume` is its one volume control.
    ambienceIn = c.createGain();
    ambienceVolume = c.createGain();
    ambienceIn.connect(ambienceVolume).connect(master);
    const noise = noiseBuffer(c);
    const loop = () => {
      const src = c.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start();
      sources.push(src);
      return src;
    };
    const lfo = (hz: number, depth: number, target: AudioParam) => {
      const osc = c.createOscillator();
      const amount = c.createGain();
      osc.frequency.value = hz;
      amount.gain.value = depth;
      osc.connect(amount).connect(target);
      osc.start();
      sources.push(osc);
    };

    // Wind in leaves: band-limited hiss whose colour and loudness drift with the gusts.
    const wind = c.createGain();
    const windBand = c.createBiquadFilter();
    windBand.type = "bandpass";
    windBand.frequency.value = 900;
    windBand.Q.value = 0.5;
    const windGust = c.createGain();
    windGust.gain.value = 0.7;
    loop().connect(windBand).connect(windGust).connect(wind).connect(ambienceIn);
    lfo(0.07, 420, windBand.frequency);
    lfo(0.11, 0.3, windGust.gain);

    // The stream: a lower, steadier wash with a quick burble on top.
    const stream = c.createGain();
    const wash = c.createBiquadFilter();
    wash.type = "bandpass";
    wash.frequency.value = 1500;
    wash.Q.value = 0.7;
    const burble = c.createBiquadFilter();
    burble.type = "bandpass";
    burble.frequency.value = 2900;
    burble.Q.value = 2.2;
    const burbleGain = c.createGain();
    burbleGain.gain.value = 0.35;
    const water = loop();
    water.connect(wash).connect(stream);
    water.connect(burble).connect(burbleGain).connect(stream);
    stream.connect(ambienceIn);
    lfo(3.1, 500, burble.frequency);
    lfo(0.23, 0.18, burbleGain.gain);

    // Crickets: a high tone chopped into pulses.
    const crickets = c.createGain();
    const tone = c.createOscillator();
    tone.type = "triangle";
    tone.frequency.value = 4300;
    const chop = c.createGain();
    chop.gain.value = 0.03;
    tone.connect(chop).connect(crickets).connect(ambienceIn);
    tone.start();
    sources.push(tone);
    lfo(17, 0.03, chop.gain);

    layers = { wind, stream, crickets };
    for (const g of [wind, stream, crickets]) g.gain.value = 0;
    // Heard at its own level unless the music is there to set it.
    ambienceVolume.gain.value = 1;

    // The music bed: streamed, never decoded whole (five minutes of PCM would be 100 MB), and
    // routed through the graph so the master fade and the level also hold on iOS, where an
    // element's own volume cannot be set.
    if (music) {
      try {
        const el = music.element ? music.element() : new Audio();
        el.loop = true;
        el.preload = "none";
        el.src = music.src;
        el.addEventListener("error", onTrackError);
        const bed = c.createGain();
        bed.gain.value = MUSIC_GAIN;
        c.createMediaElementSource(el).connect(bed).connect(master);
        // Two taps to read loudness from, before any volume control: the ambience as made, and the music.
        const ambienceTap = c.createAnalyser();
        const musicTap = c.createAnalyser();
        ambienceTap.fftSize = musicTap.fftSize = 2048;
        ambienceIn.connect(ambienceTap);
        bed.connect(musicTap);
        taps = { ambience: ambienceTap, music: musicTap };
        track = el;
        // Silent until the music has been heard, so it cannot come in before the piece does.
        ambienceVolume.gain.value = 0;
      } catch (error) {
        musicDead = true;
        musicFailed(error);
      }
    }
  };

  /** One bird call: two or three quick downward chirps, panned somewhere in the trees. */
  const chirp = () => {
    if (!ctx || !master || !ambienceIn) return;
    const level = layerLevels(dusk, place).birds;
    if (level > 0.05) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = random() * 1.6 - 0.8;
      pan.connect(ambienceIn!);
      const notes = 2 + Math.floor(random() * 2);
      const base = 2600 + random() * 2200;
      for (let i = 0; i < notes; i++) {
        const t = ctx.currentTime + i * 0.13;
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(base * (1 + 0.12 * i), t);
        osc.frequency.exponentialRampToValueAtTime(base * 0.72, t + 0.09);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.05 * level, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        osc.connect(env).connect(pan);
        osc.start(t);
        osc.stop(t + 0.14);
      }
    }
    birdTimer = setTimeout(chirp, 1400 + random() * 5200);
  };

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      if (!Ctor) throw new Error("Web Audio is not available");
      if (!ctx) {
        ctx = new Ctor();
        build(ctx);
      }
      // Media may only start from inside the visitor's click, so before the first await.
      playMusic();
      try {
        await ctx.resume();
      } catch (error) {
        track?.pause();
        throw error;
      }
      running = true;
      apply();
      master!.gain.cancelScheduledValues(ctx.currentTime);
      master!.gain.setTargetAtTime(MASTER_GAIN, ctx.currentTime, FADE_SECONDS / 3);
      if (birdTimer === null) birdTimer = setTimeout(chirp, 900);
      if (track && !musicDead && followTimer === null) followTimer = setInterval(follow, AMBIENCE_FOLLOW_MS);
    },
    stop() {
      if (!running || !ctx || !master) return;
      running = false;
      if (birdTimer !== null) clearTimeout(birdTimer);
      birdTimer = null;
      stopFollowing();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, FADE_SECONDS / 3);
      const closing = ctx;
      // Let the fade finish before the context sleeps.
      setTimeout(() => {
        if (running) return;
        // Paused, not rewound: the piece picks up where it left off.
        track?.pause();
        void closing.suspend();
      }, FADE_SECONDS * 1000);
    },
    setDusk(k) {
      dusk = clamp01(k);
      apply();
    },
    setPlace(next) {
      place = next;
      apply();
    },
    dispose() {
      running = false;
      if (birdTimer !== null) clearTimeout(birdTimer);
      birdTimer = null;
      stopFollowing();
      if (track) {
        track.removeEventListener("error", onTrackError);
        track.pause();
        // Dropping the source ends the download; an empty `src` would raise an error instead.
        track.removeAttribute("src");
        track.load();
        track = null;
      }
      // Closing the context ends every source on it.
      sources = [];
      void ctx?.close();
      ctx = null;
      master = null;
      layers = null;
      ambienceIn = null;
      ambienceVolume = null;
      taps = null;
    },
  };
}
