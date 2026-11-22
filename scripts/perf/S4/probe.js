/**
 * Track S4's in-page probe (search: drawing each frame). Installed after the rig's probe
 * (../probe.js), which it builds on; like it, this measures the shipped production build from
 * outside. No product code changes: every experiment is a change made to the live scene.
 *
 * - `sync`: after each frame is drawn, one pixel is read back, which blocks until the GPU has
 *   finished the frame. The time from the start of the frame callback to that point is the
 *   frame's real cost in milliseconds (JavaScript and GPU, one after the other), which the 60 Hz
 *   cap and the relative GPU timer cannot give. `syncPass` does the same after every render pass,
 *   to split the frame by pass.
 * - `repeat`: while the rig records, the page's frame callback is run this many times per tick.
 *   At one frame per 60 Hz tick the GPU idles between frames and its governor clocks it down, so
 *   a lighter frame does not get proportionally faster and differences come out too small and
 *   uneven. Back to back, the GPU stays busy and a frame's cost is the tick's time over `repeat`.
 * - Every render pass gets a readable label: the full-screen material's name and the target size.
 * - `mutations`: frame-exact knock-outs (hide a layer, freeze or resize the shadow map, change the
 *   draw order, drop a shader feature, set the pixel ratio), so a cost is read as a difference.
 * - `skip`: render passes whose label matches are not drawn (the picture breaks; the cost of the
 *   pass is the difference in frame time).
 * - `overdraw`: counts the fragments each material shades in the real draw order, and how many of
 *   them end up visible.
 * - `memory`: lists every texture and renderbuffer the context holds, with format and size.
 * - `startup`: times the WebGL calls of the first frames by kind (programs, textures, buffers, draws).
 *
 * Configuration comes from `window.__S4_CONFIG__`.
 */
(() => {
  if (window.__s4) return;
  const cfg = window.__S4_CONFIG__ || {};
  const rig = window.__rig;
  // The rig may have replaced performance.now with virtual time on the instance; the prototype's is real.
  let now = () => performance.now();
  try {
    const real = Performance.prototype.now.bind(performance);
    real();
    now = real;
  } catch {
    /* no Performance prototype here: the instance's clock will do */
  }

  const s4 = {
    cfg,
    renderer: null,
    frames: [], // recorded frames: { frame, ms, jsMs }
    passes: {}, // label → { n, ms } over recorded frames
    passOrder: [], // labels of one recorded frame, in draw order
    done: [], // mutations applied
    errors: [],
    overdraw: null,
    startup: { frames: [], gl: {} },
    skipped: 0,
    passFrames: 0, // frames whose passes are in `passes`
  };
  window.__s4 = s4;
  if (!rig) {
    s4.errors.push("the rig's probe is not installed");
    return;
  }

  // ------------------------------------------------------------ the scene

  const mainScene = () => rig.scenes.find((s) => s.getObjectByName && s.getObjectByName("sky")) || null;
  const each = (root, fn) => root && root.traverse(fn);
  const materialsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);

  function canvasFiber() {
    const canvas = document.querySelector(".xp__canvas canvas");
    const key = canvas && Object.keys(canvas).find((k) => k.startsWith("__reactFiber$"));
    let f = key && canvas[key];
    while (f && !(typeof f.type === "function" && f.memoizedProps && "playing" in f.memoizedProps && "tier" in f.memoizedProps && "mode" in f.memoizedProps)) f = f.return;
    return f || null;
  }

  // ------------------------------------------------------------ mutations

  const actions = {
    /** Hides every object whose name matches. */
    hide({ match }) {
      const re = new RegExp(match);
      let n = 0;
      each(mainScene(), (o) => {
        if (o.name && re.test(o.name)) {
          o.visible = false;
          n++;
        }
      });
      return { hidden: n };
    },
    /** The sun's shadow: `cast: false` (no shadows at all), `freeze` (keep the map, stop redrawing it), `size`, `radius`. */
    shadow({ cast, freeze, size, radius }) {
      const scene = mainScene();
      const sun = scene && scene.getObjectByName("sun");
      if (!sun) return { error: "no sun" };
      if (cast === false) sun.castShadow = false;
      if (freeze) s4.renderer.shadowMap.autoUpdate = false;
      if (size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      if (radius !== undefined) sun.shadow.radius = radius;
      return { cast: sun.castShadow, autoUpdate: s4.renderer.shadowMap.autoUpdate, size: sun.shadow.mapSize.x, radius: sun.shadow.radius };
    },
    /** Draw order: objects whose name matches get this renderOrder (three sorts opaque objects by it first). */
    renderOrder({ match, value }) {
      const re = new RegExp(match);
      let n = 0;
      each(mainScene(), (o) => {
        if (o.name && re.test(o.name)) {
          o.renderOrder = value;
          n++;
        }
      });
      return { moved: n };
    },
    /** No sky light on surfaces (scene.environment), to cost the prefiltered environment lookup. */
    environment({ on }) {
      const scene = mainScene();
      if (!scene) return { error: "no scene" };
      if (!on) {
        s4.environment = scene.environment;
        scene.environment = null;
      } else if (s4.environment) scene.environment = s4.environment;
      return { environment: !!scene.environment };
    },
    /** Baked surfaces look the sun's shadow up twice (three's own, and bakedLight.ts); this drops the second. */
    singleShadowLookup() {
      let n = 0;
      each(mainScene(), (o) => {
        for (const m of materialsOf(o)) {
          if (!m.userData || !m.userData.baked || m.__s4Shadow) continue;
          m.__s4Shadow = true;
          const before = m.onBeforeCompile;
          const key = m.customProgramCacheKey;
          m.onBeforeCompile = (shader, renderer) => {
            before.call(m, shader, renderer);
            const src = shader.fragmentShader;
            shader.fragmentShader = src.replace(/bakedSunLit = receiveShadow \? getShadow\([\s\S]*?\) : 1\.0;/, "bakedSunLit = 1.0;");
            if (shader.fragmentShader === src) s4.errors.push(`singleShadowLookup: no match in ${m.name}`);
          };
          m.customProgramCacheKey = () => `${key.call(m)}|s4-one-shadow`;
          m.needsUpdate = true;
          n++;
        }
      });
      return { materials: n };
    },
    /** Every surface drawn with one flat colour: what is left is geometry and passes, not surface shading. */
    flatShading({ on = true }) {
      const scene = mainScene();
      const sky = scene && scene.getObjectByName("sky");
      if (!sky) return { error: "no sky" };
      if (!on) {
        scene.overrideMaterial = null;
        return { override: false };
      }
      const ShaderMaterial = sky.material.constructor;
      scene.overrideMaterial = new ShaderMaterial({
        vertexShader: "void main() {\n  vec4 p = vec4(position, 1.0);\n  #ifdef USE_INSTANCING\n  p = instanceMatrix * p;\n  #endif\n  gl_Position = projectionMatrix * modelViewMatrix * p;\n}",
        fragmentShader: "void main() { gl_FragColor = vec4(0.5, 0.45, 0.4, 1.0); }",
      });
      return { override: true };
    },
    /** The Canvas's pixel ratio (the fourth useState of ExperienceCanvas, as the rig's level pin sets it). */
    dpr({ value }) {
      const f = canvasFiber();
      let h = f && f.memoizedState;
      for (let i = 0; i < 3 && h; i++) h = h.next;
      if (!h || typeof h.memoizedState !== "number" || !h.queue || !h.queue.dispatch) return { error: "dpr hook not where expected" };
      h.queue.dispatch(value);
      return { dpr: value };
    },
    /**
     * The rig's level pin, in two frame-exact steps (the rig's own waits 100 ms of real time between
     * them, so the frame the effect chain is rebuilt on, and with it the film grain's phase, can
     * differ between two captures). Step 1 silences the monitor and moves off the level; step 2
     * sets the level and its pixel ratio.
     */
    pinLevel({ level, step }) {
      const f = canvasFiber();
      if (!f) return { error: "ExperienceCanvas fiber not found" };
      const hooks = [];
      for (let h = f.memoizedState; h; h = h.next) hooks.push(h);
      const levelHook = hooks[1];
      if (!levelHook || typeof levelHook.memoizedState !== "number" || !levelHook.queue || !levelHook.queue.dispatch) return { error: "level hook not where expected" };
      if (step === 1) {
        const noop = () => {};
        let patched = 0;
        for (const fiber of [f, f.alternate]) {
          for (let h = fiber && fiber.memoizedState; h; h = h.next) {
            const m = h.memoizedState;
            if (Array.isArray(m) && typeof m[0] === "function" && Array.isArray(m[1]) && m[1].length === 2) {
              h.memoizedState = [noop, m[1]];
              patched++;
            }
          }
        }
        if (!patched) return { error: "onQuality callback not found" };
        levelHook.queue.dispatch(level === 0 ? 1 : 0);
        return { from: levelHook.memoizedState, patched };
      }
      levelHook.queue.dispatch(level);
      const dprHook = hooks[3];
      const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), { 0: 1, 1: 1.25, 2: 1.5, 3: 1.75 }[level]);
      if (dprHook && typeof dprHook.memoizedState === "number" && dprHook.queue && dprHook.queue.dispatch) dprHook.queue.dispatch(dpr);
      return { to: level, dpr };
    },
    /** Starts skipping the render passes `cfg.skip` names. */
    skip({ match }) {
      s4.skip = new RegExp(match);
      return { skip: match };
    },
    overdraw() {
      s4.wantOverdraw = true;
      return {};
    },
  };

  const pending = [...(cfg.mutations || [])].sort((a, b) => a.frame - b.frame);
  function runMutations() {
    while (pending.length && rig.started && pending[0].frame <= rig.frame) {
      const m = pending.shift();
      try {
        s4.done.push({ frame: rig.frame, do: m.do, result: actions[m.do](m) });
      } catch (err) {
        s4.errors.push(`${m.do}@${m.frame}: ${err}`);
      }
    }
  }

  // ------------------------------------------------------------ passes

  const TYPE = { 1009: "u8", 1015: "f32", 1016: "f16", 1014: "u32", 1012: "u16" };

  /** What a render() call draws: the scene, or the name of a full-screen pass's material; and where to. */
  function labelOf(renderer, scene, camera) {
    const t = renderer.getRenderTarget();
    const where = t ? `${t.width}x${t.height}${t.texture ? `:${TYPE[t.texture.type] || t.texture.type}` : ""}` : "screen";
    let what;
    if (scene.isScene && camera.isPerspectiveCamera && scene.children.length > 3) what = "scene";
    else {
      const holder = scene.isMesh ? scene : scene.children && scene.children[0];
      const m = holder && (Array.isArray(holder.material) ? holder.material[0] : holder.material);
      what = m ? m.name || `${m.type}#${(m.fragmentShader || "").length}` : scene.type || "?";
    }
    return `${what}@${where}`;
  }
  s4.labelOf = labelOf;

  let framePasses = []; // the passes of the frame being drawn
  let scenePasses = 0;

  /** Ends a frame: its passes go into the totals (while recording) and the list starts again. */
  function flushPasses() {
    if (rig.recording && framePasses.length) {
      if (!s4.passOrder.length) s4.passOrder = framePasses.map((p) => p.label);
      framePasses.forEach((p, i) => {
        const index = String(i).padStart(2, "0");
        const e = (s4.passes[`${index} ${p.label}`] ??= { n: 0, ms: 0, skipped: 0 });
        e.n++;
        if (p.ms !== null) e.ms += p.ms;
        if (p.skipped) e.skipped++;
        // The shadow map drawn inside this pass, as its own row.
        if (p.shadowMs) {
          const sh = (s4.passes[`${index}+ shadow`] ??= { n: 0, ms: 0, skipped: 0 });
          sh.n++;
          sh.ms += p.shadowMs;
        }
      });
      s4.passFrames++;
    }
    framePasses = [];
    scenePasses = 0;
  }

  function hook() {
    if (s4.renderer) return;
    const renderer = rig.renderers.find((r) => r.domElement && r.domElement.closest && r.domElement.closest(".xp__canvas"));
    if (!renderer) return;
    s4.renderer = renderer;
    const gl = renderer.getContext();
    const inner = renderer.render;
    const innerShadow = renderer.shadowMap.render;
    let depth = 0;
    let shadowMs = 0;

    // gl.finish() returns at once in Chrome; reading one pixel of the target a pass drew to is what
    // waits for the GPU. The format to read is asked once per target.
    const readers = new WeakMap();
    const SCREEN = {};
    const waitForGpu = () => {
      const key = renderer.getRenderTarget() || SCREEN;
      let r = readers.get(key);
      if (!r) {
        const format = key === SCREEN ? gl.RGBA : gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
        const type = key === SCREEN ? gl.UNSIGNED_BYTE : gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
        const data = type === gl.FLOAT ? new Float32Array(4) : type === gl.UNSIGNED_BYTE ? new Uint8Array(4) : type === 0x8368 /* UNSIGNED_INT_2_10_10_10_REV */ || type === gl.UNSIGNED_INT ? new Uint32Array(4) : new Uint16Array(4);
        readers.set(key, (r = { format, type, data }));
      }
      gl.readPixels(0, 0, 1, 1, r.format, r.type, r.data);
    };
    s4.waitForGpu = waitForGpu;

    renderer.shadowMap.render = function (lights, ...rest) {
      if (!cfg.syncPass || depth !== 1) return innerShadow.call(this, lights, ...rest);
      const t0 = now();
      try {
        return innerShadow.call(this, lights, ...rest);
      } finally {
        // The shadow pass hands the previous target back when it ends: read the map itself.
        const map = lights && lights[0] && lights[0].shadow && lights[0].shadow.map;
        if (map && renderer.shadowMap.autoUpdate !== false) {
          const prev = renderer.getRenderTarget();
          const face = renderer.getActiveCubeFace();
          const mip = renderer.getActiveMipmapLevel();
          renderer.setRenderTarget(map);
          waitForGpu();
          renderer.setRenderTarget(prev, face, mip);
        }
        shadowMs += now() - t0;
      }
    };

    renderer.render = function (scene, camera) {
      if (depth > 0) return inner.call(renderer, scene, camera);
      let label = labelOf(renderer, scene, camera);
      if (label.startsWith("scene@")) {
        // The first is the picture; later ones in the same frame are a pass drawing the scene again.
        if (scenePasses === 0) s4.camera = camera;
        else label = label.replace("scene@", `scene+${scenePasses}@`);
        scenePasses++;
      }
      const entry = { label, ms: null };
      framePasses.push(entry);
      if (s4.skip && s4.skip.test(label) && renderer.getRenderTarget() !== null) {
        s4.skipped++;
        entry.skipped = true;
        return undefined;
      }
      const timed = cfg.syncPass || (cfg.startup && rig.frame <= (cfg.startup.frames ?? 5));
      const t0 = timed ? now() : 0;
      shadowMs = 0;
      depth = 1;
      try {
        return inner.call(renderer, scene, camera);
      } finally {
        depth = 0;
        if (timed) {
          if (cfg.syncPass) waitForGpu();
          entry.ms = now() - t0 - shadowMs;
          if (shadowMs > 0) entry.shadowMs = shadowMs;
        }
      }
    };
  }

  // ------------------------------------------------------------ frames

  const px = new Uint8Array(4);
  const repeat = Math.max(1, cfg.repeat || 1);
  const prevRAF = window.requestAnimationFrame;
  const wrappedRAF = (cb) =>
    prevRAF((ts) => {
      hook();
      runMutations();
      const before = rig.renderCount();
      const startupFrame = cfg.startup && rig.frame <= (cfg.startup.frames ?? 5) ? beginStartup() : null;
      const t0 = now();
      let drawn = 0;
      try {
        cb(ts);
        if (rig.renderCount() !== before) {
          drawn = 1;
          if (startupFrame) startupFrame.passes = framePasses;
          flushPasses();
          if (repeat > 1 && rig.recording) {
            // More frames in the same tick. The page's loop asks for its next tick each time it
            // runs: only the first request may stand, or the loop would multiply.
            window.requestAnimationFrame = () => 0;
            try {
              for (; drawn < repeat; drawn++) {
                cb(ts);
                flushPasses();
              }
            } finally {
              window.requestAnimationFrame = wrappedRAF;
            }
          }
        }
      } finally {
        if (drawn && s4.renderer) afterDraw(t0, startupFrame, drawn);
        else bucket = null;
      }
    });
  window.requestAnimationFrame = wrappedRAF;

  function afterDraw(t0, startupFrame, drawn) {
    const renderer = s4.renderer;
    const gl = renderer.getContext();
    const jsMs = now() - t0;
    let ms = null;
    if (cfg.sync || startupFrame) {
      // Blocks until the GPU has finished everything this tick drew.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      ms = now() - t0;
    }
    if (startupFrame) endStartup(startupFrame, jsMs, ms);
    if (rig.recording) s4.frames.push({ frame: rig.frame, ms: ms === null ? null : ms / drawn, jsMs: jsMs / drawn, drawn });
    if (s4.wantOverdraw && s4.camera) {
      s4.wantOverdraw = false;
      try {
        s4.overdraw = countOverdraw();
      } catch (err) {
        s4.errors.push(`overdraw: ${err && err.stack ? err.stack : err}`);
      }
    }
  }

  // ------------------------------------------------------------ start-up: WebGL calls by kind

  const KIND = {
    compileShader: "program", linkProgram: "program", getProgramParameter: "program", getShaderParameter: "program", getProgramInfoLog: "program",
    getShaderInfoLog: "program", getUniformLocation: "program", getActiveUniform: "program", getActiveAttrib: "program", getAttribLocation: "program",
    getUniformBlockIndex: "program", getActiveUniforms: "program", useProgram: "program", validateProgram: "program",
    texImage2D: "texture", texSubImage2D: "texture", texStorage2D: "texture", texImage3D: "texture", texSubImage3D: "texture", texStorage3D: "texture",
    compressedTexImage2D: "texture", compressedTexSubImage2D: "texture", generateMipmap: "texture",
    bufferData: "buffer", bufferSubData: "buffer",
    drawElements: "draw", drawArrays: "draw", drawElementsInstanced: "draw", drawArraysInstanced: "draw", drawRangeElements: "draw", clear: "draw",
    blitFramebuffer: "draw", checkFramebufferStatus: "other", getParameter: "other", getError: "other", getExtension: "other", finish: "other", flush: "other",
  };
  let bucket = null; // the frame being timed, or null
  if (cfg.startup && window.WebGL2RenderingContext) {
    const proto = WebGL2RenderingContext.prototype;
    for (const [name, kind] of Object.entries(KIND)) {
      const orig = proto[name];
      if (typeof orig !== "function") continue;
      proto[name] = function (...args) {
        if (!bucket) return orig.apply(this, args);
        const t0 = now();
        try {
          return orig.apply(this, args);
        } finally {
          const dt = now() - t0;
          const k = (bucket.kinds[kind] ??= { n: 0, ms: 0 });
          k.n++;
          k.ms += dt;
          const c = (bucket.calls[name] ??= { n: 0, ms: 0 });
          c.n++;
          c.ms += dt;
        }
      };
    }
  }
  function beginStartup() {
    const r = s4.renderer;
    bucket = { frame: rig.frame, kinds: {}, calls: {}, programs: r ? r.info.programs.length : 0, textures: r ? r.info.memory.textures : 0, geometries: r ? r.info.memory.geometries : 0 };
    return bucket;
  }
  function endStartup(b, jsMs, ms) {
    bucket = null;
    const r = s4.renderer;
    s4.startup.frames.push({
      frame: b.frame,
      started: rig.started,
      jsMs,
      ms,
      kinds: b.kinds,
      calls: Object.fromEntries(Object.entries(b.calls).filter(([, c]) => c.ms >= 0.5).sort((x, y) => y[1].ms - x[1].ms)),
      programs: r.info.programs.length - b.programs,
      textures: r.info.memory.textures - b.textures,
      geometries: r.info.memory.geometries - b.geometries,
      passes: (b.passes || []).filter((p) => p.ms !== null && p.ms > 1).map((p) => ({ label: p.label, ms: p.ms })),
    });
  }

  // ------------------------------------------------------------ overdraw

  /**
   * Counts fragments. Every material is swapped for a copy that keeps its own vertex stage, alpha
   * test, depth settings and place in the draw order (three sorts opaque objects by material id,
   * so the copies are made in id order) but writes a constant, added to the frame buffer:
   *
   * - `shaded`: fragments of this material that pass the depth test in the real draw order. On a
   *   GPU that tests depth as it draws, each one runs the material's full shader.
   * - `visible`: how many of them are in the final picture (opaque materials).
   * - `raster`: fragments it covers with no depth test at all.
   *
   * Counts are in screens (fragments / pixels of the frame buffer).
   */
  function countOverdraw() {
    const renderer = s4.renderer;
    const gl = renderer.getContext();
    const scene = mainScene();
    const camera = s4.camera;
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;
    const pixels = W * H;

    const meshes = [];
    // Lines, points and sprites (the explorer's marker lines) keep their own materials and would
    // add their colour to every count: they are hidden while counting and are not in the result.
    const others = [];
    scene.traverseVisible((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.material) meshes.push(o);
      else if (o.isLine || o.isPoints || o.isSprite) others.push(o);
    });
    for (const o of others) o.visible = false;
    const originals = new Map(); // material → { users }
    for (const o of meshes) for (const m of materialsOf(o)) originals.set(m, (originals.get(m) || 0) + 1);
    const sorted = [...originals.keys()].sort((a, b) => a.id - b.id);

    const END = /}\s*$/;
    const copies = new Map();
    const rows = sorted.map((m, i) => {
      const uOn = { value: 0 };
      const c = m.clone();
      const tail = "\n  gl_FragColor = vec4(vec3(uS4On / 255.0), 1.0);\n}";
      if (m.isShaderMaterial) {
        c.fragmentShader = "uniform float uS4On;\n" + m.fragmentShader.replace(END, tail);
        c.uniforms = { ...m.uniforms, uS4On: uOn };
      } else {
        const before = m.onBeforeCompile;
        const key = m.customProgramCacheKey;
        c.onBeforeCompile = (shader, r) => {
          before.call(m, shader, r);
          shader.uniforms.uS4On = uOn;
          shader.fragmentShader = "uniform float uS4On;\n" + shader.fragmentShader.replace(END, tail);
        };
        c.customProgramCacheKey = () => `${key.call(m)}|s4-count`;
      }
      c.blending = 2; // AdditiveBlending
      c.premultipliedAlpha = false;
      c.dithering = false;
      c.toneMapped = false;
      copies.set(m, c);
      return {
        index: i + 1,
        id: m.id,
        name: m.name || "",
        type: m.type,
        users: originals.get(m),
        transparent: !!m.transparent,
        alphaTest: m.alphaTest || 0,
        side: m.side,
        depthWrite: m.depthWrite,
        uOn,
        copy: c,
        objects: [],
      };
    });
    const rowOf = new Map(rows.map((r, i) => [sorted[i], r]));
    for (const o of meshes) for (const m of materialsOf(o)) if (rowOf.get(m).objects.length < 4 && o.name) rowOf.get(m).objects.push(o.name);

    const saved = meshes.map((o) => o.material);
    for (const o of meshes) o.material = Array.isArray(o.material) ? o.material.map((m) => copies.get(m)) : copies.get(o.material);
    const background = scene.background;
    const fog = scene.fog;
    const autoUpdate = renderer.shadowMap.autoUpdate;
    const clear = renderer.getClearAlpha();
    const Color = scene.fog.color.constructor;
    const clearColor = renderer.getClearColor(new Color());
    // postprocessing's composer leaves renderer.autoClear off: each count starts from black.
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(0x000000, 1);
    const buf = new Uint8Array(pixels * 4);
    const draw = () => {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    };
    const sum = () => {
      let n = 0;
      let saturated = 0;
      for (let i = 0; i < buf.length; i += 4) {
        n += buf[i];
        if (buf[i] === 255) saturated++;
      }
      return { n, saturated };
    };

    try {
      // Warm-up: compiles the copies (not timed, not counted).
      draw();
      // 1. Everything on: total fragments shaded per pixel, and its histogram.
      for (const r of rows) r.uOn.value = 1;
      draw();
      const histogram = new Array(16).fill(0);
      let total = 0;
      for (let i = 0; i < buf.length; i += 4) {
        total += buf[i];
        histogram[Math.min(15, buf[i])]++;
      }
      // A small heat map for the findings page: layers × 32 per channel, quarter size or less.
      const step = Math.max(1, Math.ceil(W / 480));
      const hw = Math.floor(W / step);
      const hh = Math.floor(H / step);
      const heat = document.createElement("canvas");
      heat.width = hw;
      heat.height = hh;
      const ctx = heat.getContext("2d");
      const img = ctx.createImageData(hw, hh);
      for (let y = 0; y < hh; y++) {
        for (let x = 0; x < hw; x++) {
          const layers = buf[((H - 1 - y * step) * W + x * step) * 4];
          const o = (y * hw + x) * 4;
          const k = Math.min(1, layers / 8);
          img.data[o] = Math.round(255 * Math.min(1, k * 2));
          img.data[o + 1] = Math.round(255 * Math.max(0, 1 - Math.abs(k - 0.5) * 2));
          img.data[o + 2] = Math.round(255 * Math.max(0, 1 - k * 2));
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      // 2. One material at a time: its own shaded fragments (the rest still write depth).
      for (const r of rows) r.uOn.value = 0;
      for (const r of rows) {
        r.uOn.value = 1;
        draw();
        const s = sum();
        r.shaded = s.n / pixels;
        r.saturated = s.saturated;
        r.uOn.value = 0;
      }

      // 3. No depth test: what each material covers in all.
      for (const r of rows) {
        r.copy.depthTest = false;
      }
      for (const r of rows) {
        r.uOn.value = 1;
        draw();
        r.raster = sum().n / pixels;
        r.uOn.value = 0;
      }
      for (const [m, c] of copies) c.depthTest = m.depthTest;

      // 4. The final picture: which opaque material each pixel shows.
      for (const r of rows) {
        r.copy.blending = 0; // NoBlending
        r.copy.colorWrite = !r.transparent;
        r.uOn.value = r.index;
      }
      draw();
      const visible = new Array(rows.length + 1).fill(0);
      for (let i = 0; i < buf.length; i += 4) visible[Math.min(rows.length, buf[i])]++;
      for (const r of rows) r.visible = r.transparent ? null : visible[r.index] / pixels;

      // Plain data only: the uniforms and the copies stay here.
      const out = rows.map((r) => {
        const row = { ...r };
        delete row.uOn;
        delete row.copy;
        return row;
      });
      const opaque = out.filter((r) => !r.transparent);
      return {
        width: W,
        height: H,
        hidden: others.length,
        materials: out,
        total: total / pixels,
        opaqueShaded: opaque.reduce((a, r) => a + r.shaded, 0),
        opaqueVisible: opaque.reduce((a, r) => a + r.visible, 0),
        transparentShaded: out.filter((r) => r.transparent).reduce((a, r) => a + r.shaded, 0),
        raster: out.reduce((a, r) => a + r.raster, 0),
        histogram: histogram.map((n) => n / pixels),
        heat: heat.toDataURL("image/png"),
      };
    } finally {
      meshes.forEach((o, i) => (o.material = saved[i]));
      for (const o of others) o.visible = true;
      for (const c of copies.values()) c.dispose();
      renderer.autoClear = autoClear;
      scene.background = background;
      scene.fog = fog;
      renderer.shadowMap.autoUpdate = autoUpdate;
      renderer.setClearColor(clearColor, clear);
    }
  }

  // ------------------------------------------------------------ texture memory

  const FORMAT = {
    0x8058: ["RGBA8", 4], 0x8c43: ["SRGB8_A8", 4], 0x8051: ["RGB8", 4], 0x8c41: ["SRGB8", 4], 0x881a: ["RGBA16F", 8], 0x881b: ["RGB16F", 8],
    0x8814: ["RGBA32F", 16], 0x8815: ["RGB32F", 16], 0x8229: ["R8", 1], 0x822b: ["RG8", 2], 0x822d: ["R16F", 2], 0x822f: ["RG16F", 4],
    0x822e: ["R32F", 4], 0x8230: ["RG32F", 8], 0x81a5: ["DEPTH16", 2], 0x81a6: ["DEPTH24", 4], 0x8cac: ["DEPTH32F", 4], 0x88f0: ["DEPTH24_STENCIL8", 4],
    0x8cad: ["DEPTH32F_STENCIL8", 8], 0x8c3a: ["R11F_G11F_B10F", 4], 0x8d48: ["STENCIL8", 1], 0x1908: ["RGBA", 4], 0x1907: ["RGB", 3],
    0x93b0: ["ASTC_4x4", 1], 0x93d0: ["SRGB_ASTC_4x4", 1], 0x8e8c: ["BC7", 1], 0x8e8d: ["SRGB_BC7", 1], 0x83f0: ["DXT1", 0.5], 0x83f1: ["DXT1A", 0.5],
    0x83f2: ["DXT3", 1], 0x83f3: ["DXT5", 1], 0x9274: ["ETC2_RGB", 0.5], 0x9275: ["ETC2_SRGB", 0.5], 0x9278: ["ETC2_RGBA", 1], 0x9279: ["ETC2_SRGBA", 1],
    0x8c4c: ["SRGB_DXT1", 0.5], 0x8c4d: ["SRGB_DXT1A", 0.5], 0x8c4f: ["SRGB_DXT5", 1],
  };
  const TYPE_SCALE = { 0x1401: 1, 0x1406: 4, 0x8d61: 2, 0x140b: 2, 0x1403: 2, 0x1405: 4 };
  const mem = { tex: new Map(), rb: new Map(), unit: 0, bound: new Map(), boundRb: null };
  if (cfg.memory && window.WebGL2RenderingContext) {
    const proto = WebGL2RenderingContext.prototype;
    const wrap = (name, after) => {
      const orig = proto[name];
      if (typeof orig !== "function") return;
      proto[name] = function (...args) {
        const r = orig.apply(this, args);
        try {
          after(args);
        } catch (err) {
          s4.errors.push(`${name}: ${err}`);
        }
        return r;
      };
    };
    const face = (t) => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t);
    const current = (target) => mem.bound.get(`${mem.unit}:${face(target)}`);
    const entry = (tex) => {
      let e = mem.tex.get(tex);
      if (!e) mem.tex.set(tex, (e = { format: "?", w: 0, h: 0, levels: 1, bytes: 0, cube: false, perLevel: new Map() }));
      return e;
    };
    const fmt = (ifmt, type) => {
      const f = FORMAT[ifmt];
      if (!f) return [`0x${ifmt.toString(16)}`, 4];
      return [f[0], f[0] === "RGBA" || f[0] === "RGB" ? f[1] * (TYPE_SCALE[type] ?? 1) : f[1]];
    };
    wrap("activeTexture", ([unit]) => (mem.unit = unit));
    wrap("bindTexture", ([target, tex]) => mem.bound.set(`${mem.unit}:${target}`, tex));
    wrap("texStorage2D", ([target, levels, ifmt, w, h]) => {
      const tex = current(target);
      if (!tex) return;
      const e = entry(tex);
      const [name, bpp] = fmt(ifmt);
      let bytes = 0;
      for (let l = 0; l < levels; l++) bytes += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp;
      Object.assign(e, { format: name, w, h, levels, cube: target === 0x8513, bytes: bytes * (target === 0x8513 ? 6 : 1) });
    });
    wrap("texStorage3D", ([target, levels, ifmt, w, h, d]) => {
      const tex = current(target);
      if (!tex) return;
      const [name, bpp] = fmt(ifmt);
      Object.assign(entry(tex), { format: name, w, h, levels, depth: d, bytes: w * h * d * bpp });
    });
    wrap("texImage2D", (args) => {
      const [target, level, ifmt] = args;
      const tex = current(target);
      if (!tex) return;
      let w, h, type;
      if (args.length >= 9) [, , , w, h, , , type] = args;
      else {
        type = args[4];
        const src = args[5];
        w = (src && (src.videoWidth || src.naturalWidth || src.width)) || 0;
        h = (src && (src.videoHeight || src.naturalHeight || src.height)) || 0;
      }
      const e = entry(tex);
      const [name, bpp] = fmt(ifmt, type);
      e.perLevel.set(`${target}:${level}`, w * h * bpp);
      if (level === 0) Object.assign(e, { format: name, w, h, cube: face(target) === 0x8513 });
      e.levels = Math.max(e.levels, level + 1);
      e.bytes = [...e.perLevel.values()].reduce((a, b) => a + b, 0);
    });
    wrap("compressedTexImage2D", ([target, level, ifmt, w, h, , data]) => {
      const tex = current(target);
      if (!tex) return;
      const e = entry(tex);
      e.perLevel.set(`${target}:${level}`, typeof data === "number" ? data : (data && data.byteLength) || 0);
      if (level === 0) Object.assign(e, { format: fmt(ifmt)[0], w, h, compressed: true });
      e.levels = Math.max(e.levels, level + 1);
      e.bytes = [...e.perLevel.values()].reduce((a, b) => a + b, 0);
    });
    wrap("compressedTexSubImage2D", ([target]) => {
      const tex = current(target);
      const e = tex && mem.tex.get(tex);
      if (e) e.compressed = true;
    });
    wrap("generateMipmap", ([target]) => {
      const tex = current(target);
      const e = tex && mem.tex.get(tex);
      if (e && !e.mipmapped && e.levels === 1) {
        e.mipmapped = true;
        e.bytes = Math.round(e.bytes * (4 / 3));
      }
    });
    wrap("deleteTexture", ([tex]) => mem.tex.delete(tex));
    wrap("bindRenderbuffer", ([, rb]) => (mem.boundRb = rb));
    wrap("renderbufferStorage", ([, ifmt, w, h]) => mem.boundRb && mem.rb.set(mem.boundRb, { format: fmt(ifmt)[0], w, h, samples: 1, bytes: w * h * fmt(ifmt)[1] }));
    wrap("renderbufferStorageMultisample", ([, samples, ifmt, w, h]) =>
      mem.boundRb && mem.rb.set(mem.boundRb, { format: fmt(ifmt)[0], w, h, samples, bytes: w * h * fmt(ifmt)[1] * Math.max(1, samples) }),
    );
    wrap("deleteRenderbuffer", ([rb]) => mem.rb.delete(rb));
  }

  /** Every live texture and renderbuffer, grouped by format and size, largest first. */
  s4.memoryList = () => {
    const groups = new Map();
    const add = (kind, e) => {
      const key = `${kind} ${e.format} ${e.w}x${e.h}${e.cube ? " cube" : ""}${e.depth ? `x${e.depth}` : ""}${e.levels > 1 || e.mipmapped ? " mips" : ""}${e.samples > 1 ? ` x${e.samples}` : ""}`;
      const g = groups.get(key) || { key, kind, format: e.format, w: e.w, h: e.h, count: 0, bytes: 0, compressed: !!e.compressed };
      g.count++;
      g.bytes += e.bytes;
      groups.set(key, g);
    };
    for (const e of mem.tex.values()) add("texture", e);
    for (const e of mem.rb.values()) add("renderbuffer", e);
    const list = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
    return { total: list.reduce((a, g) => a + g.bytes, 0), textures: mem.tex.size, renderbuffers: mem.rb.size, groups: list };
  };

  // ------------------------------------------------------------ read-back

  /** What the scene is made of, for choosing knock-outs: top-level objects, materials, lights, passes. */
  s4.describe = () => {
    const scene = mainScene();
    if (!scene) return null;
    const count = (o) => {
      let meshes = 0;
      let instances = 0;
      o.traverse((c) => {
        if (c.isMesh) {
          meshes++;
          if (c.isInstancedMesh) instances += c.count;
        }
      });
      return { meshes, instances };
    };
    const materials = new Map();
    scene.traverse((o) => {
      for (const m of materialsOf(o)) {
        const e = materials.get(m) || { id: m.id, name: m.name, type: m.type, transparent: !!m.transparent, alphaTest: m.alphaTest || 0, side: m.side, users: 0, maps: [], baked: m.userData && m.userData.baked, cast: 0 };
        e.users++;
        if (o.castShadow) e.cast++;
        if (!materials.has(m)) for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "lightMap", "emissiveMap", "envMap", "alphaMap"]) if (m[k]) e.maps.push(k);
        materials.set(m, e);
      }
    });
    const r = s4.renderer;
    return {
      children: scene.children.map((o) => ({ name: o.name, type: o.type, visible: o.visible, renderOrder: o.renderOrder, castShadow: !!o.castShadow, ...count(o) })),
      materials: [...materials.values()].sort((a, b) => a.id - b.id),
      environment: !!scene.environment,
      fog: scene.fog ? { density: scene.fog.density } : null,
      renderer: r && {
        pixelRatio: r.getPixelRatio(),
        buffer: `${r.domElement.width}x${r.domElement.height}`,
        shadowType: r.shadowMap.type,
        shadowEnabled: r.shadowMap.enabled,
        toneMapping: r.toneMapping,
        programs: r.info.programs.length,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        programNames: r.info.programs.map((p) => p.name).reduce((a, n) => ((a[n] = (a[n] || 0) + 1), a), {}),
      },
    };
  };

  s4.snapshot = () => ({
    frames: s4.frames,
    passes: s4.passes,
    passOrder: s4.passOrder,
    done: s4.done,
    errors: s4.errors,
    skipped: s4.skipped,
    passFrames: s4.passFrames,
    overdraw: s4.overdraw,
    startup: s4.startup,
    memory: cfg.memory ? s4.memoryList() : null,
    describe: cfg.describe ? s4.describe() : null,
  });
})();
