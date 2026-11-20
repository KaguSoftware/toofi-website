/**
 * Ambient sound for the experience, synthesised with the Web Audio API so nothing is
 * downloaded: wind through the olive leaves and the stream (Zaitun's two signature sounds),
 * birds by day and crickets at dusk. Off until the visitor turns it on; the audio context is
 * only created then, inside their click. The music bed is the owner's to supply (track 5B).
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

export const MASTER_GAIN = 0.5;
const FADE_SECONDS = 1.2;

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
 * Builds the sound. `Ctor` is the AudioContext to use (tests pass a stand-in); `random` drives
 * when the birds call.
 */
export function createAmbience(Ctor: ContextCtor | null = contextCtor(), random: () => number = Math.random): Ambience {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let layers: { wind: GainNode; stream: GainNode; crickets: GainNode } | null = null;
  let sources: AudioScheduledSourceNode[] = [];
  let birdTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dusk = 0;
  let place = { water: 0.3, open: 0.6 };

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
    loop().connect(windBand).connect(windGust).connect(wind).connect(master);
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
    stream.connect(master);
    lfo(3.1, 500, burble.frequency);
    lfo(0.23, 0.18, burbleGain.gain);

    // Crickets: a high tone chopped into pulses.
    const crickets = c.createGain();
    const tone = c.createOscillator();
    tone.type = "triangle";
    tone.frequency.value = 4300;
    const chop = c.createGain();
    chop.gain.value = 0.03;
    tone.connect(chop).connect(crickets).connect(master);
    tone.start();
    sources.push(tone);
    lfo(17, 0.03, chop.gain);

    layers = { wind, stream, crickets };
    for (const g of [wind, stream, crickets]) g.gain.value = 0;
  };

  /** One bird call: two or three quick downward chirps, panned somewhere in the trees. */
  const chirp = () => {
    if (!ctx || !master) return;
    const level = layerLevels(dusk, place).birds;
    if (level > 0.05) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = random() * 1.6 - 0.8;
      pan.connect(master);
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
      await ctx.resume();
      running = true;
      apply();
      master!.gain.cancelScheduledValues(ctx.currentTime);
      master!.gain.setTargetAtTime(MASTER_GAIN, ctx.currentTime, FADE_SECONDS / 3);
      if (birdTimer === null) birdTimer = setTimeout(chirp, 900);
    },
    stop() {
      if (!running || !ctx || !master) return;
      running = false;
      if (birdTimer !== null) clearTimeout(birdTimer);
      birdTimer = null;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, FADE_SECONDS / 3);
      const closing = ctx;
      // Let the fade finish before the context sleeps.
      setTimeout(() => {
        if (!running) void closing.suspend();
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
      // Closing the context ends every source on it.
      sources = [];
      void ctx?.close();
      ctx = null;
      master = null;
      layers = null;
    },
  };
}
