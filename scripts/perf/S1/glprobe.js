/**
 * WebGL call probe for search track S1. Injected after the rig's probe and before any page
 * script, it times every WebGL call the page makes on the main thread, so the start-up cost
 * can be split into shader work (compile, link and the queries that wait for them), uploads
 * (textures and buffers) and draws, with no product code changed.
 *
 * With `salt` set, every shader gets one extra uniform with a unique name, so no cache
 * anywhere (the browser's program cache, the GPU driver's or the operating system's) has seen
 * it: that is what a first-ever visit compiles. The uniform is never set, so nothing visible
 * changes, but the extra branch may cost a little per frame: salted runs are for start-up
 * numbers only, never for frame rates or reference frames.
 *
 * Two what-if switches try a fix from outside, to size it before anyone writes it:
 * - `nocheck` turns off three.js's shader error check (`renderer.debug.checkShaderErrors`),
 *   the call that waits for each program's link on its first use.
 * - `precompile` holds the first frame back while every program the frame needs is compiled
 *   with `renderer.compileAsync` (the browser compiles in the background and the main thread
 *   only polls), then lets the frames through. The canvas shows nothing meanwhile, so this is
 *   for timing only, never for reference frames.
 *
 * Configuration comes from `window.__S1_CONFIG__ = { salt?: string, slowMs?: number,
 * nocheck?: boolean, precompile?: boolean }`.
 */
(() => {
  if (window.__s1) return;
  const cfg = window.__S1_CONFIG__ || {};
  const now = performance.now.bind(performance);
  const slowMs = cfg.slowMs ?? 4;

  const s1 = {
    cfg,
    calls: {}, // name → { n, ms, max }, split by phase
    slow: [], // every call over slowMs: { t, name, ms, detail, phase }
    programs: 0,
    programList: [], // { t, phase, type, name }: three.js writes both into each shader's first lines
    shaders: 0,
    salted: 0,
    saltMisses: 0,
    extensions: [],
    workers: [],
    wasm: [],
    marks: [],
    precompile: null, // { scenes, ms, heldFrames } once the what-if has run
  };
  window.__s1 = s1;

  /** "load" until the scene's first frame begins, "first" during it, "after" from then on. */
  let firstFrameDone = false;
  const phase = () => {
    const rig = window.__rig;
    if (!rig || !rig.started) return "load";
    return firstFrameDone ? "after" : "first";
  };
  // The first frame ends with the first animation frame that follows it.
  const watch = () => {
    if (window.__rig && window.__rig.started) {
      requestAnimationFrame(() => {
        firstFrameDone = true;
        s1.marks.push({ t: now(), name: "first-frame-done" });
      });
      return;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  const TIMED = [
    "compileShader", "linkProgram", "shaderSource", "getProgramParameter", "getShaderParameter", "getProgramInfoLog", "getShaderInfoLog",
    "getUniformLocation", "getActiveUniform", "getActiveAttrib", "getAttribLocation", "getUniformBlockIndex", "getActiveUniformBlockParameter",
    "getActiveUniforms", "useProgram", "texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "texStorage2D", "texStorage3D",
    "compressedTexImage2D", "compressedTexSubImage2D", "generateMipmap", "bufferData", "bufferSubData", "drawElements", "drawArrays",
    "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements", "clear", "readPixels", "finish", "flush", "getError", "getParameter",
    "getExtension", "getSupportedExtensions", "getShaderPrecisionFormat", "checkFramebufferStatus", "blitFramebuffer", "copyTexSubImage2D",
    "clientWaitSync", "fenceSync", "getSyncParameter", "renderbufferStorage", "renderbufferStorageMultisample",
  ];

  const LINK_STATUS = 0x8b82;
  const COMPLETION_STATUS = 0x91b1;
  const VERTEX_SHADER = 0x8b31;
  const shaderType = new WeakMap();
  let saltIndex = 0;
  let lastShader = { type: "", name: "" };

  /** Adds one live, uniquely named uniform to a shader, without changing what it draws. */
  function salt(source, type) {
    const re = /void\s+main\s*\(\s*(?:void)?\s*\)/g;
    let last = null;
    for (let m = re.exec(source); m; m = re.exec(source)) last = m;
    if (!last) return null;
    const id = `s1_salt_${cfg.salt}_${saltIndex++}`;
    const body = source.slice(0, last.index) + "void s1_main_orig()" + source.slice(last.index + last[0].length);
    const tail =
      type === VERTEX_SHADER
        ? `\nuniform float ${id};\nvoid main(){ s1_main_orig(); if (${id} < -1.0) gl_Position.z += 1.0; }\n`
        : `\nuniform mediump float ${id};\nvoid main(){ s1_main_orig(); if (${id} < -1.0) discard; }\n`;
    return body + tail;
  }
  s1.salt = salt;

  function detailOf(name, args) {
    if (name === "getProgramParameter") return args[1] === LINK_STATUS ? "LINK_STATUS" : args[1] === COMPLETION_STATUS ? "COMPLETION_STATUS" : `0x${Number(args[1]).toString(16)}`;
    if (name === "texImage2D" || name === "texSubImage2D") {
      const src = args[args.length - 1];
      const w = args.length >= 9 ? args[name === "texImage2D" ? 3 : 4] : src?.width;
      const h = args.length >= 9 ? args[name === "texImage2D" ? 4 : 5] : src?.height;
      return `${w}x${h}${src && src.constructor ? ` ${src.constructor.name}` : ""}`;
    }
    if (name === "compressedTexImage2D") return `${args[3]}x${args[4]} level ${args[1]} ${args[6]?.byteLength ?? 0} B`;
    if (name === "texStorage2D") return `${args[3]}x${args[4]} levels ${args[1]}`;
    if (name === "bufferData") return `${typeof args[1] === "number" ? args[1] : args[1]?.byteLength ?? 0} B`;
    if (name === "getExtension") return String(args[0]);
    return "";
  }

  function patch(proto) {
    if (!proto || proto.__s1Patched) return;
    proto.__s1Patched = true;
    const createShader = proto.createShader;
    if (createShader) {
      proto.createShader = function (type) {
        const shader = createShader.call(this, type);
        if (shader) shaderType.set(shader, type);
        s1.shaders++;
        return shader;
      };
    }
    for (const name of TIMED) {
      const orig = proto[name];
      if (typeof orig !== "function") continue;
      proto[name] = function (...args) {
        if (name === "shaderSource" && cfg.salt) {
          const salted = salt(String(args[1]), shaderType.get(args[0]));
          if (salted) {
            args[1] = salted;
            s1.salted++;
          } else s1.saltMisses++;
        }
        if (name === "shaderSource") {
          const type = /#define SHADER_TYPE (\S+)/.exec(String(args[1]));
          const label = /#define SHADER_NAME ([^\n]*)/.exec(String(args[1]));
          if (type || label) lastShader = { type: type ? type[1] : "", name: label ? label[1].trim() : "" };
        }
        if (name === "linkProgram") {
          s1.programs++;
          s1.programList.push({ t: now(), phase: phase(), ...lastShader });
          lastShader = { type: "", name: "" };
        }
        if (name === "getExtension") s1.extensions.push(String(args[0]));
        const t0 = now();
        const r = orig.apply(this, args);
        const ms = now() - t0;
        const p = phase();
        const key = `${p}:${name}`;
        const c = (s1.calls[key] ??= { n: 0, ms: 0, max: 0 });
        c.n++;
        c.ms += ms;
        if (ms > c.max) c.max = ms;
        if (ms >= slowMs) s1.slow.push({ t: t0, name, ms, detail: detailOf(name, args), phase: p });
        return r;
      };
    }
  }
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);

  // ------------------------------------------------------------ what-if switches

  // The frame loop draws inside requestAnimationFrame; set-up renders (the environment map,
  // made when the canvas mounts) do not. Only the frame loop's draws are held back.
  let inFrame = false;
  const realRAF = window.requestAnimationFrame.bind(window);
  if (cfg.precompile) {
    window.requestAnimationFrame = (cb) =>
      realRAF((ts) => {
        inFrame = true;
        try {
          cb(ts);
        } finally {
          inFrame = false;
        }
      });
  }

  /**
   * Holds back every draw of the stage's frame loop until the programs its first frame needs
   * are compiled. The first frame's render calls (the scene, then each effect pass) are not
   * drawn but handed to compileAsync, with the render target each one was about to draw into
   * still bound, so the programs are the ones the real frame will ask for.
   */
  function precompile(renderer) {
    const inner = renderer.render;
    const seen = new Set();
    let state = "idle"; // idle → compiling → done
    let pending = 0;
    let t0 = 0;
    let held = 0;
    const finish = () => {
      if (state !== "compiling" || pending > 0) return;
      state = "done";
      s1.precompile = { scenes: seen.size, ms: now() - t0, heldFrames: held };
      s1.marks.push({ t: now(), name: "precompile-done" });
    };
    const settle = () => {
      pending--;
      // Let the rest of this frame's passes register before deciding it is all compiled.
      setTimeout(finish, 0);
    };
    renderer.render = function (scene, camera) {
      const stage = renderer.domElement.closest && renderer.domElement.closest(".xp__canvas");
      if (state === "done" || !stage || !inFrame) return inner.call(this, scene, camera);
      if (state === "idle") {
        state = "compiling";
        t0 = now();
        s1.marks.push({ t: t0, name: "precompile-start" });
      }
      if (seen.size === 0 || !seen.has(scene)) {
        seen.add(scene);
        pending++;
        renderer.compileAsync(scene, camera).then(settle, settle);
      } else if (scene.isScene && camera.isPerspectiveCamera) held++;
    };
  }

  if (cfg.nocheck || cfg.precompile) {
    const hook = (target) => {
      target.addEventListener("observe", (e) => {
        const r = e.detail;
        if (!r || !r.isWebGLRenderer || r.__s1Hooked) return;
        r.__s1Hooked = true;
        if (cfg.nocheck) r.debug.checkShaderErrors = false;
        // The rig's probe listens to the same event first, so its wrapper is already in place.
        if (cfg.precompile) precompile(r);
        s1.marks.push({ t: now(), name: "renderer" });
      });
    };
    if (!window.__THREE_DEVTOOLS__) window.__THREE_DEVTOOLS__ = new EventTarget();
    hook(window.__THREE_DEVTOOLS__);
  }

  // Workers and WebAssembly: which ones the page starts, and when.
  const RealWorker = window.Worker;
  if (RealWorker) {
    window.Worker = function (url, options) {
      s1.workers.push({ t: now(), url: String(url).slice(0, 80) });
      return new RealWorker(url, options);
    };
    window.Worker.prototype = RealWorker.prototype;
  }
  if (window.WebAssembly) {
    for (const name of ["instantiate", "instantiateStreaming", "compile", "compileStreaming"]) {
      const orig = WebAssembly[name];
      if (typeof orig !== "function") continue;
      WebAssembly[name] = function (...args) {
        const entry = { t: now(), name, bytes: args[0]?.byteLength ?? null, ms: null };
        s1.wasm.push(entry);
        const p = orig.apply(this, args);
        Promise.resolve(p).then(
          () => (entry.ms = now() - entry.t),
          () => (entry.ms = -1),
        );
        return p;
      };
    }
  }

  /** What the runner reads back: plain data only. */
  s1.snapshot = () => ({
    calls: s1.calls,
    slow: s1.slow,
    programs: s1.programs,
    programList: s1.programList,
    shaders: s1.shaders,
    salted: s1.salted,
    saltMisses: s1.saltMisses,
    extensions: [...new Set(s1.extensions)],
    workers: s1.workers,
    wasm: s1.wasm,
    marks: s1.marks,
    precompile: s1.precompile,
  });
})();
