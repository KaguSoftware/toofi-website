/**
 * The rig's in-page probe (optimization track P0). Injected before any page script runs, it
 * measures the shipped production build from outside, with no product code changed:
 *
 * - three.js announces every WebGLRenderer and Scene on `__THREE_DEVTOOLS__`; the probe wraps
 *   that renderer's render() to count draw calls, triangles and passes per frame, time each
 *   pass on the GPU (EXT_disjoint_timer_query_webgl2) with the shadow pass split out, and time
 *   the JavaScript of the frame.
 * - WebGL calls that allocate (buffers, textures, renderbuffers) are tallied per context, so
 *   GPU memory can be read after the scene closes.
 * - A frame-exact action plan (scroll to a stop, click Explore, hold a key, drag, capture)
 *   runs inside requestAnimationFrame, counted from the scene's first frame.
 * - With `virtualTime`, performance.now, Date.now and rAF timestamps stand still until the
 *   first frame and then advance exactly 1/60 s per frame, so reference frames repeat.
 * - The quality level can be pinned through React's fiber tree (the `?level=` switch is
 *   development only), and the device tier forced through navigator.deviceMemory.
 *
 * Configuration comes from `window.__RIG_CONFIG__`, set by an init script that runs first.
 */
(() => {
  if (window.__rig) return;
  const cfg = window.__RIG_CONFIG__ || {};
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now;
  const realRAF = window.requestAnimationFrame.bind(window);

  const rig = {
    cfg,
    renderers: [],
    scenes: [],
    started: false,
    startedAt: null, // real performance.now() of the scene's first frame
    frame: 0, // frames since the scene's first frame
    recording: false,
    frames: [],
    plan: [],
    captures: {},
    events: [],
    errors: [],
    longFrames: [],
    contexts: [],
  };
  window.__rig = rig;
  const log = (type, detail) => rig.events.push({ t: realNow(), frame: rig.frame, type, detail });

  // ------------------------------------------------------------ device tier

  const defineNav = (key, value) => {
    try {
      Object.defineProperty(Navigator.prototype, key, { get: () => value, configurable: true });
    } catch (err) {
      rig.errors.push(`nav ${key}: ${err}`);
    }
  };
  if (cfg.deviceMemory !== undefined) defineNav("deviceMemory", cfg.deviceMemory);
  if (cfg.hardwareConcurrency !== undefined) defineNav("hardwareConcurrency", cfg.hardwareConcurrency);

  // ------------------------------------------------------------ virtual time

  let vt = 0; // virtual ms since the first frame
  const VT_BASE = 1000;
  const dateBase = realDateNow();
  if (cfg.virtualTime) {
    performance.now = () => VT_BASE + vt;
    Date.now = () => dateBase + vt;
  }

  // ------------------------------------------------------------ frames and the plan

  let lastTs = -1;
  let current = null; // the frame being drawn
  let rendersInTick = 0;
  let captureNow = null;

  function beginTick(ts) {
    if (ts === lastTs) return;
    lastTs = ts;
    if (rig.started) {
      rig.frame += 1;
      if (cfg.virtualTime) vt = (rig.frame * 1000) / 60;
      runPlan();
    }
  }

  window.requestAnimationFrame = (cb) =>
    realRAF((ts) => {
      beginTick(ts);
      const before = renderCount;
      const t0 = realNow();
      try {
        cb(cfg.virtualTime ? VT_BASE + vt : ts);
      } finally {
        if (frameQuery) {
          endQuery(frameQuery.gl, frameQuery.t);
          frameQuery = null;
        }
        if (renderCount !== before) {
          // This callback drew the frame (React Three Fiber's loop).
          const f = current;
          if (f) {
            f.cpuMs = realNow() - t0;
            f.ts = ts;
          }
          rendersInTick += renderCount - before;
          if (captureNow) {
            const c = captureNow;
            captureNow = null;
            capture(c.name, c.width);
          }
        }
      }
    });

  function closeFrame() {
    if (!current) return;
    // A frame belongs to the recording if recording was on when it began.
    if (current.recorded) rig.frames.push(current);
    current = null;
  }

  function frameFor(ts) {
    if (current && current.realTs === ts) return current;
    closeFrame();
    const prev = rig._prevTs;
    rig._prevTs = ts;
    current = {
      frame: rig.frame,
      recorded: rig.recording,
      realTs: ts,
      interval: prev === undefined ? null : ts - prev,
      renderMs: 0,
      calls: 0,
      triangles: 0,
      points: 0,
      lines: 0,
      passes: 0,
      gpu: {}, // pass label → ms, filled in when the queries resolve
      gpuPending: 0,
      shadowGpuMs: 0,
      shadowCalls: 0,
      shadowTriangles: 0,
      sceneCalls: null, // the first perspective pass, shadow draws taken out: what the camera sees
      sceneTriangles: null,
      dpr: null,
      width: null,
    };
    return current;
  }

  const actions = {
    scrollToBeat({ beat }) {
      const el = document.querySelectorAll("[data-beat]")[beat - 1];
      if (!el) return log("error", `no beat ${beat}`);
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
    },
    scrollTo({ y }) {
      window.scrollTo({ top: y, behavior: "instant" });
    },
    click({ selector }) {
      const el = document.querySelector(selector);
      if (!el) return log("error", `no element ${selector}`);
      el.click();
    },
    key({ code, type }) {
      window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    },
    pointer({ type, x, y }) {
      const canvas = document.querySelector(".xp__canvas canvas");
      if (!canvas) return log("error", "no canvas");
      const r = canvas.getBoundingClientRect();
      const init = { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height, bubbles: true };
      (type === "pointerdown" ? canvas : window).dispatchEvent(new PointerEvent(type, init));
      if (type === "pointermove") canvas.dispatchEvent(new PointerEvent(type, init));
      if (type === "pointerup") canvas.dispatchEvent(new PointerEvent(type, init));
    },
    pin({ level }) {
      rig.pinResult = pinLevel(level);
      log("pin", rig.pinResult);
    },
    record({ on }) {
      if (on) {
        rig.frames = [];
        rig.recording = true;
      } else {
        closeFrame();
        rig.recording = false;
      }
    },
    capture({ name, width }) {
      captureNow = { name, width };
    },
    /** The poster image as the canvas would show it (object-fit: cover), for the handover check. */
    capturePoster({ name, width }) {
      const img = document.querySelector(".xp__poster img");
      const src = document.querySelector(".xp__canvas canvas");
      if (!img || !src) return log("error", "capturePoster: no poster or canvas");
      const w = Math.min(width || src.width, src.clientWidth || src.width); // same size as capture()
      const h = Math.round((src.height / src.width) * w);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      rig.captures[name] = { dataUrl: c.toDataURL("image/png"), frame: rig.frame, srcWidth: img.naturalWidth, srcHeight: img.naturalHeight, src: img.currentSrc };
    },
    mark({ name }) {
      log("mark", name);
    },
  };

  function runPlan() {
    while (rig.plan.length && rig.plan[0].frame <= rig.frame) {
      const step = rig.plan.shift();
      try {
        actions[step.do](step);
      } catch (err) {
        rig.errors.push(`${step.do}@${step.frame}: ${err}`);
      }
    }
  }

  /** Steps sorted by frame; frame 0 runs on the scene's first frame. */
  rig.setPlan = (steps) => {
    rig.plan = [...steps].sort((a, b) => a.frame - b.frame);
  };
  rig.setPlan(cfg.plan || []);

  // The canvas is scaled on a 2D canvas inside the same task as the draw, so the drawing buffer
  // is still valid (the renderer does not preserve it).
  function capture(name, width) {
    const src = document.querySelector(".xp__canvas canvas");
    if (!src) return log("error", "capture: no canvas");
    // Never wider than the canvas is on screen (a phone's 412 px stay 412 px).
    const w = Math.min(width || src.width, src.clientWidth || src.width);
    const h = Math.round((src.height / src.width) * w);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    rig.captures[name] = { dataUrl: c.toDataURL("image/png"), frame: rig.frame, srcWidth: src.width, srcHeight: src.height };
    log("capture", name);
  }

  // ------------------------------------------------------------ the renderer

  let renderCount = 0;
  let depth = 0;
  const timers = new WeakMap(); // gl → { ext, pending: [] }

  // "pass" times every render() call (shadow split out); "frame" (or true) times the whole frame
  // with one query, which is the trustworthy total where per-pass queries add driver overhead.
  const gpuMode = cfg.gpuTimers === "pass" ? "pass" : cfg.gpuTimers ? "frame" : null;
  let frameQuery = null; // { gl, t } while a whole-frame query is open

  function timerFor(gl) {
    if (!gpuMode) return null;
    let t = timers.get(gl);
    if (!t) {
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      t = { ext, pending: [], active: null };
      timers.set(gl, t);
      if (!ext) rig.errors.push("EXT_disjoint_timer_query_webgl2 unavailable");
    }
    return t.ext ? t : null;
  }

  function beginQuery(gl, t, frame, label, kind) {
    const q = gl.createQuery();
    gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q);
    t.active = { q, frame, label, kind };
    frame.gpuPending += 1;
  }
  function endQuery(gl, t) {
    if (!t.active) return;
    gl.endQuery(t.ext.TIME_ELAPSED_EXT);
    t.pending.push(t.active);
    t.active = null;
  }
  function pollQueries(gl, t) {
    const disjoint = gl.getParameter(t.ext.GPU_DISJOINT_EXT);
    const keep = [];
    for (const p of t.pending) {
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) {
        keep.push(p);
        continue;
      }
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT);
      gl.deleteQuery(p.q);
      p.frame.gpuPending -= 1;
      if (disjoint) {
        p.frame.gpuDisjoint = true;
        continue;
      }
      const ms = ns / 1e6;
      if (p.kind === "shadow") p.frame.shadowGpuMs += ms;
      p.frame.gpu[p.label] = (p.frame.gpu[p.label] || 0) + ms;
    }
    t.pending = keep;
  }

  function wrapRenderer(renderer) {
    if (renderer.__rigWrapped) return;
    renderer.__rigWrapped = true;
    rig.renderers.push(renderer);
    const render = renderer.render.bind(renderer);
    const shadowRender = renderer.shadowMap.render.bind(renderer.shadowMap);
    let passFrame = null;
    let passLabel = null;

    // The shadow map is drawn inside render(), so its draws land in the same counters: split
    // them out, so "scene triangles" is what the camera sees and "shadow" is the extra pass.
    renderer.shadowMap.render = (...args) => {
      const f = depth === 1 ? passFrame : null;
      const info = renderer.info.render;
      const calls0 = info.calls;
      const tris0 = info.triangles;
      const gl = renderer.getContext();
      const t = f && gpuMode === "pass" ? timerFor(gl) : null;
      if (t) {
        endQuery(gl, t);
        beginQuery(gl, t, f, "shadow", "shadow");
      }
      try {
        return shadowRender(...args);
      } finally {
        if (f) {
          f.shadowCalls += info.calls - calls0;
          f.shadowTriangles += info.triangles - tris0;
        }
        if (t) {
          endQuery(gl, t);
          beginQuery(gl, t, f, passLabel, "pass");
        }
      }
    };

    renderer.render = (scene, camera) => {
      if (depth > 0) return render(scene, camera);
      const gl = renderer.getContext();
      const inStage = !!renderer.domElement.closest?.(".xp__canvas");
      // The first frame is the first draw to the screen: earlier renders into targets are set-up
      // work (the environment map is rendered at mount, before the model is even requested).
      if (inStage && !rig.started && renderer.getRenderTarget() === null) {
        rig.started = true;
        rig.startedAt = realNow();
        log("first-frame", null);
        runPlan();
      }
      const f = frameFor(lastTs);
      const target = renderer.getRenderTarget();
      const index = f.passes;
      passLabel = `${index}:${camera.isOrthographicCamera ? "ortho" : "persp"}:${target ? `${target.width}x${target.height}` : "screen"}`;
      passFrame = f;
      const info = renderer.info.render;
      const before = { calls: info.calls, triangles: info.triangles, points: info.points, lines: info.lines };
      const shadowBefore = { calls: f.shadowCalls, triangles: f.shadowTriangles };
      const timer = timerFor(gl);
      const t = gpuMode === "pass" ? timer : null;
      if (timer && gpuMode === "frame" && !frameQuery) {
        pollQueries(gl, timer);
        beginQuery(gl, timer, f, "frame", "frame");
        frameQuery = { gl, t: timer };
      }
      if (t) {
        pollQueries(gl, t);
        beginQuery(gl, t, f, passLabel, "pass");
      }
      const t0 = realNow();
      depth = 1;
      try {
        return render(scene, camera);
      } finally {
        depth = 0;
        if (t) endQuery(gl, t);
        f.renderMs += realNow() - t0;
        // With info.autoReset (three's default, left on by this app) every render() starts the
        // counters from zero, so the value after the call is this pass's own count.
        const perCall = renderer.info.autoReset !== false;
        const own = {};
        for (const k of ["calls", "triangles", "points", "lines"]) {
          own[k] = perCall ? info[k] : info[k] - before[k];
          f[k] += own[k];
        }
        if (f.sceneTriangles === null && camera.isPerspectiveCamera) {
          f.sceneCalls = own.calls - (f.shadowCalls - shadowBefore.calls);
          f.sceneTriangles = own.triangles - (f.shadowTriangles - shadowBefore.triangles);
        }
        f.passes += 1;
        f.dpr = renderer.getPixelRatio();
        f.width = renderer.domElement.width;
        f.height = renderer.domElement.height;
        passFrame = null;
        renderCount += 1;
      }
    };
  }

  const devtools = new EventTarget();
  devtools.addEventListener("observe", (e) => {
    const obj = e.detail;
    if (obj && obj.isWebGLRenderer) wrapRenderer(obj);
    else if (obj && obj.isScene) rig.scenes.push(obj);
  });
  window.__THREE_DEVTOOLS__ = devtools;

  // ------------------------------------------------------------ GPU memory per context

  const BPP = {
    0x8058: 4, 0x8c43: 4, 0x8051: 4, 0x8c41: 4, 0x881a: 8, 0x881b: 8, 0x8814: 16, 0x8815: 16, 0x8229: 1, 0x822b: 2,
    0x822d: 2, 0x822f: 4, 0x822e: 4, 0x8230: 8, 0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8059: 4,
    0x906f: 4, 0x8c3a: 4, 0x8c3d: 4, 0x8d62: 2, 0x8056: 2, 0x8057: 2, 0x8d48: 1,
    // block-compressed, bytes per pixel
    0x93b0: 1, 0x93d0: 1, 0x8e8c: 1, 0x8e8d: 1, 0x83f0: 0.5, 0x83f1: 0.5, 0x83f2: 1, 0x83f3: 1, 0x9274: 0.5,
    0x9275: 0.5, 0x9278: 1, 0x9279: 1, 0x8d64: 0.5,
  };
  const UNSIZED = { 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190a: 2, 0x1906: 1, 0x1902: 4, 0x84f9: 4 };
  const TYPE_SCALE = { 0x1401: 1, 0x1406: 4, 0x8d61: 2, 0x140b: 2, 0x1403: 2, 0x1405: 4 };
  const bppFor = (ifmt, type) => BPP[ifmt] ?? (UNSIZED[ifmt] ?? 4) * (TYPE_SCALE[type] ?? 1);
  const mipBytes = (w, h, d, levels, bpp) => {
    let sum = 0;
    for (let l = 0; l < levels; l++) sum += Math.max(1, w >> l) * Math.max(1, h >> l) * d * bpp;
    return sum;
  };

  const memState = new WeakMap();
  function mem(gl) {
    let s = memState.get(gl);
    if (!s) {
      s = { buf: new Map(), tex: new Map(), rb: new Map(), boundBuf: new Map(), unit: 0, boundTex: new Map(), boundRb: null };
      memState.set(gl, s);
    }
    return s;
  }
  const faceTarget = (target) => (target >= 0x8515 && target <= 0x851a ? 0x8513 : target);
  const boundTexture = (s, target) => s.boundTex.get(`${s.unit}:${faceTarget(target)}`);
  const setTex = (s, tex, key, bytes) => {
    if (!tex) return;
    let m = s.tex.get(tex);
    if (!m) s.tex.set(tex, (m = new Map()));
    m.set(key, bytes);
  };

  function patchContext(proto) {
    if (!proto || proto.__rigPatched) return;
    proto.__rigPatched = true;
    const wrap = (name, after) => {
      const orig = proto[name];
      if (!orig) return;
      proto[name] = function (...args) {
        const r = orig.apply(this, args);
        try {
          after.call(this, mem(this), args, r);
        } catch (err) {
          rig.errors.push(`${name}: ${err}`);
        }
        return r;
      };
    };
    wrap("bindBuffer", (s, [target, buf]) => s.boundBuf.set(target, buf));
    wrap("bufferData", (s, [target, data]) => {
      const buf = s.boundBuf.get(target);
      if (buf) s.buf.set(buf, typeof data === "number" ? data : data?.byteLength ?? 0);
    });
    wrap("deleteBuffer", (s, [buf]) => s.buf.delete(buf));
    wrap("activeTexture", (s, [unit]) => (s.unit = unit));
    wrap("bindTexture", (s, [target, tex]) => s.boundTex.set(`${s.unit}:${target}`, tex));
    wrap("texStorage2D", (s, [target, levels, ifmt, w, h]) => {
      const faces = target === 0x8513 ? 6 : 1;
      setTex(s, boundTexture(s, target), "storage", mipBytes(w, h, 1, levels, bppFor(ifmt)) * faces);
    });
    wrap("texStorage3D", (s, [target, levels, ifmt, w, h, d]) => {
      setTex(s, boundTexture(s, target), "storage", mipBytes(w, h, 1, levels, bppFor(ifmt)) * d);
    });
    wrap("texImage2D", (s, args) => {
      const [target, level, ifmt] = args;
      let w, h, type;
      if (args.length >= 9) {
        [, , , w, h, , , type] = args;
      } else {
        type = args[4];
        const src = args[5];
        w = src?.videoWidth || src?.naturalWidth || src?.width || 0;
        h = src?.videoHeight || src?.naturalHeight || src?.height || 0;
      }
      setTex(s, boundTexture(s, target), `${target}:${level}`, w * h * bppFor(ifmt, type));
    });
    wrap("texImage3D", (s, [target, level, ifmt, w, h, d, , , type]) => {
      setTex(s, boundTexture(s, target), `${target}:${level}`, w * h * d * bppFor(ifmt, type));
    });
    wrap("compressedTexImage2D", (s, [target, level, , , , , data]) => {
      setTex(s, boundTexture(s, target), `${target}:${level}`, typeof data === "number" ? data : data?.byteLength ?? 0);
    });
    wrap("compressedTexImage3D", (s, [target, level, , , , , , data]) => {
      setTex(s, boundTexture(s, target), `${target}:${level}`, typeof data === "number" ? data : data?.byteLength ?? 0);
    });
    wrap("deleteTexture", (s, [tex]) => s.tex.delete(tex));
    wrap("bindRenderbuffer", (s, [, rb]) => (s.boundRb = rb));
    wrap("renderbufferStorage", (s, [, ifmt, w, h]) => s.boundRb && s.rb.set(s.boundRb, w * h * bppFor(ifmt)));
    wrap("renderbufferStorageMultisample", (s, [, samples, ifmt, w, h]) => s.boundRb && s.rb.set(s.boundRb, w * h * bppFor(ifmt) * Math.max(1, samples)));
    wrap("deleteRenderbuffer", (s, [rb]) => s.rb.delete(rb));
  }
  patchContext(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patchContext(window.WebGLRenderingContext && WebGLRenderingContext.prototype);

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type) && !rig.contexts.some((c) => c.gl === ctx)) {
      const entry = { gl: ctx, canvas: this, type, created: realNow(), lost: false };
      rig.contexts.push(entry);
      this.addEventListener("webglcontextlost", () => (entry.lost = true));
    }
    return ctx;
  };

  const sum = (m) => {
    let n = 0;
    for (const v of m.values()) n += v instanceof Map ? sum(v) : v;
    return n;
  };
  /** Live WebGL contexts and what each holds on the GPU (estimated from the allocation calls). */
  rig.memory = () => {
    const contexts = rig.contexts.map((c) => {
      const s = memState.get(c.gl);
      const lost = c.lost || (c.gl.isContextLost && c.gl.isContextLost());
      const bytes = s && !lost ? { buffers: sum(s.buf), textures: sum(s.tex), renderbuffers: sum(s.rb) } : { buffers: 0, textures: 0, renderbuffers: 0 };
      const drawing = lost ? 0 : c.canvas.width * c.canvas.height * 4 * 2;
      return {
        type: c.type,
        lost,
        connected: c.canvas.isConnected,
        size: `${c.canvas.width}x${c.canvas.height}`,
        counts: s && !lost ? { buffers: s.buf.size, textures: s.tex.size, renderbuffers: s.rb.size } : null,
        bytes: { ...bytes, drawingBuffer: drawing, total: bytes.buffers + bytes.textures + bytes.renderbuffers + drawing },
      };
    });
    return {
      contexts,
      live: contexts.filter((c) => !c.lost).length,
      liveBytes: contexts.reduce((a, c) => a + c.bytes.total, 0),
      renderers: rig.renderers.map((r) => ({ geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null })),
    };
  };

  // ------------------------------------------------------------ the quality level

  function hooksOf(fiber) {
    const out = [];
    for (let h = fiber && fiber.memoizedState; h; h = h.next) out.push(h);
    return out;
  }

  /**
   * Pins the quality level in a production build. ExperienceCanvas keeps the level in its
   * second useState and passes the monitor a useCallback([holdAt, tier]); the probe dispatches
   * the level and swaps that memoised callback for a no-op so the monitor cannot move it.
   */
  function pinLevel(level) {
    const canvas = document.querySelector(".xp__canvas canvas");
    if (!canvas) return { ok: false, why: "no canvas" };
    const key = Object.keys(canvas).find((k) => k.startsWith("__reactFiber$"));
    let f = key && canvas[key];
    while (f && !(typeof f.type === "function" && f.memoizedProps && "playing" in f.memoizedProps && "tier" in f.memoizedProps && "mode" in f.memoizedProps)) f = f.return;
    if (!f) return { ok: false, why: "ExperienceCanvas fiber not found" };
    const hooks = hooksOf(f);
    const levelHook = hooks[1];
    if (!levelHook || typeof levelHook.memoizedState !== "number" || !levelHook.queue?.dispatch) return { ok: false, why: "level hook not where expected" };
    const noop = () => {};
    let patched = 0;
    for (const fiber of [f, f.alternate]) {
      if (!fiber) continue;
      for (const h of hooksOf(fiber)) {
        const m = h.memoizedState;
        if (Array.isArray(m) && typeof m[0] === "function" && Array.isArray(m[1]) && m[1].length === 2) {
          h.memoizedState = [noop, m[1]];
          patched++;
        }
      }
    }
    if (!patched) return { ok: false, why: "onQuality callback not found" };
    const from = levelHook.memoizedState;
    // Step through another level first, in a separate render, so ExperienceCanvas re-renders even
    // when the level asked for is the current one (React folds two updates in one tick that end
    // where they started and skips the render): only a re-render hands ExperienceRoot, and with
    // it the monitor, the no-op.
    levelHook.queue.dispatch(level === 0 ? 1 : 0);
    setTimeout(() => levelHook.queue.dispatch(level), 100);
    // The Canvas's `dpr` prop is the start level's ratio, kept in the fourth useState, and React
    // Three Fiber re-applies it whenever the Canvas re-renders; set it to the pinned level's.
    const dprHook = hooks[3];
    const maxDpr = { 0: 1, 1: 1.25, 2: 1.5, 3: 1.75 }[level];
    const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), maxDpr);
    if (dprHook && typeof dprHook.memoizedState === "number" && dprHook.queue?.dispatch) dprHook.queue.dispatch(dpr);
    return { ok: true, from, to: level, dpr, tier: f.memoizedProps.tier };
  }
  rig.pinLevel = pinLevel;
  rig.level = () => {
    const canvas = document.querySelector(".xp__canvas canvas");
    const key = canvas && Object.keys(canvas).find((k) => k.startsWith("__reactFiber$"));
    let f = key && canvas[key];
    while (f && !(typeof f.type === "function" && f.memoizedProps && "playing" in f.memoizedProps && "tier" in f.memoizedProps)) f = f.return;
    if (!f) return null;
    return { level: hooksOf(f)[1]?.memoizedState ?? null, tier: f.memoizedProps.tier };
  };

  // ------------------------------------------------------------ page load

  // The experience marks itself running once its first frame is on screen.
  rig.runningAt = null;
  new MutationObserver((list, obs) => {
    for (const m of list) {
      if (m.target.getAttribute && m.target.getAttribute("data-running") === "true") {
        rig.runningAt = realNow();
        obs.disconnect();
        return;
      }
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-running"] });

  rig.vitals = { fcp: null, lcp: null, cls: 0, longTasks: [] };
  const observe = (type, fn) => {
    try {
      new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true });
    } catch (err) {
      rig.errors.push(`${type}: ${err}`);
    }
  };
  observe("paint", (e) => e.name === "first-contentful-paint" && (rig.vitals.fcp = e.startTime));
  observe("largest-contentful-paint", (e) => (rig.vitals.lcp = e.startTime));
  observe("layout-shift", (e) => !e.hadRecentInput && (rig.vitals.cls += e.value));
  observe("longtask", (e) => rig.vitals.longTasks.push({ start: e.startTime, duration: e.duration }));

  // ------------------------------------------------------------ long frames

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        rig.longFrames.push({
          start: e.startTime,
          duration: e.duration,
          blocking: e.blockingDuration ?? null,
          scripts: (e.scripts || []).slice(0, 5).map((s) => ({ url: s.sourceURL, fn: s.sourceFunctionName, ms: s.duration })),
        });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch (err) {
    rig.errors.push(`loaf: ${err}`);
  }

  /** What the rig reads back: plain data only. */
  rig.snapshot = () => ({
    started: rig.started,
    startedAt: rig.startedAt,
    frame: rig.frame,
    frames: rig.frames.map((f) => {
      const out = { ...f, gpuComplete: f.gpuPending === 0 };
      delete out.gpuPending;
      delete out.recorded;
      return out;
    }),
    events: rig.events,
    errors: rig.errors,
    pin: rig.pinResult ?? null,
    level: rig.level(),
  });
  rig.renderCount = () => renderCount;
  rig.ticks = () => rendersInTick;
})();
