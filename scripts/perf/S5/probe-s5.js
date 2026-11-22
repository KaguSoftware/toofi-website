/**
 * Track S5's in-page probe, injected after the rig's probe (../probe.js). It measures the
 * shipped production build from outside, with no product code changed:
 *
 * - React commits. A minimal React DevTools hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) receives
 *   every commit of every React renderer: react-dom (the page) and React Three Fiber's own
 *   reconciler (the scene). While the rig records, each commit is walked to count the components
 *   that rendered in it, so a re-render caused by frame or scroll state shows up by name.
 * - useFrame subscribers. React Three Fiber keeps its frame callbacks in
 *   `state.internal.subscribers`; each one's ref object is wrapped (in place, so unsubscribing
 *   still works) to time every callback on every frame. Each subscriber is described by the
 *   component that owns it (found through the hook that holds its ref): its props, the keys of
 *   its memoised values and its priority, which S5/labels.mjs turns into a name.
 *
 * Results are read back with `window.__s5.snapshot()`.
 */
(() => {
  if (window.__s5) return;
  const now = performance.now.bind(performance);
  const rig = () => window.__rig;

  const s5 = {
    renderers: {}, // id → package name
    roots: new Map(), // id → Set of fiber roots
    commits: [], // while recording: { t, renderer, rendered, top }
    commitCount: {}, // renderer → commits over the page's life
    subs: [], // { id, priority, desc, total, max, calls }
    frames: [], // while recording: { t, cb, subs: [ms per sub id], commits: { dom, r3f } }
    errors: [],
  };
  window.__s5 = s5;

  // ------------------------------------------------------------ React commits

  const FUNCTION_TAGS = new Set([0, 1, 11, 14, 15]); // function, class, forwardRef, memo, simple memo
  const seen = new WeakMap(); // fiber (either copy) → { props, state }

  function nameOf(fiber) {
    const t = fiber.type;
    const base = t && (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)));
    const keys = fiber.memoizedProps && typeof fiber.memoizedProps === "object" ? Object.keys(fiber.memoizedProps).filter((k) => k !== "children").sort().slice(0, 6).join(",") : "";
    return `${base || "anonymous"}{${keys}}`;
  }

  function renderedIn(root) {
    const out = [];
    const stack = root.current ? [root.current] : [];
    while (stack.length) {
      const f = stack.pop();
      if (FUNCTION_TAGS.has(f.tag)) {
        const key = seen.get(f) || (f.alternate && seen.get(f.alternate));
        const rendered = !key || key.props !== f.memoizedProps || key.state !== f.memoizedState;
        const record = { props: f.memoizedProps, state: f.memoizedState };
        seen.set(f, record);
        if (f.alternate) seen.set(f.alternate, record);
        if (rendered) out.push(nameOf(f));
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return out;
  }

  let rendererId = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    checkDCE() {},
    inject(internals) {
      rendererId += 1;
      s5.renderers[rendererId] = internals.rendererPackageName || "unknown";
      this.renderers.set(rendererId, internals);
      return rendererId;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    setStrictMode() {},
    onCommitFiberRoot(id, root) {
      try {
        let set = s5.roots.get(id);
        if (!set) s5.roots.set(id, (set = new Set()));
        set.add(root);
        const pkg = s5.renderers[id];
        s5.commitCount[pkg] = (s5.commitCount[pkg] || 0) + 1;
        const r = rig();
        // Walk only while recording (it costs time) or to seed the "seen" map before it.
        const names = renderedIn(root);
        if (r && r.recording) {
          const counts = {};
          for (const n of names) counts[n] = (counts[n] || 0) + 1;
          s5.commits.push({ t: now(), frame: r.frame, renderer: pkg, rendered: names.length, names: counts });
          if (current) current.commits[pkg === "@react-three/fiber" ? "r3f" : "dom"] += 1;
        }
      } catch (err) {
        s5.errors.push(`commit: ${err}`);
      }
    },
  };

  // ------------------------------------------------------------ useFrame subscribers

  function r3fState() {
    for (const scene of (rig() && rig().scenes) || []) {
      const store = scene.__r3f && scene.__r3f.root;
      if (store && store.getState) return store.getState();
    }
    return null;
  }

  function hookList(fiber) {
    const out = [];
    for (let h = fiber && fiber.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) out.push(h);
    return out;
  }

  /** The component fiber whose hooks hold `ref`, in the R3F reconciler's trees. */
  function ownerOf(ref) {
    for (const [id, set] of s5.roots) {
      if (s5.renderers[id] !== "@react-three/fiber") continue;
      for (const root of set) {
        const stack = root.current ? [root.current] : [];
        while (stack.length) {
          const f = stack.pop();
          if (FUNCTION_TAGS.has(f.tag)) for (const h of hookList(f)) if (h.memoizedState === ref) return f;
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
      }
    }
    return null;
  }

  function describe(sub, fn) {
    const f = ownerOf(sub.ref);
    const props = f && f.memoizedProps && typeof f.memoizedProps === "object" ? Object.keys(f.memoizedProps).filter((k) => k !== "children").sort() : [];
    const memoKeys = [];
    if (f) {
      for (const h of hookList(f)) {
        const m = h.memoizedState;
        // useMemo keeps [value, deps]
        if (Array.isArray(m) && m.length === 2 && (Array.isArray(m[1]) || m[1] === null) && m[0] && typeof m[0] === "object") memoKeys.push(Object.keys(m[0]).slice(0, 8).join(","));
      }
    }
    return { priority: sub.priority, found: !!f, name: f ? nameOf(f) : null, props, memoKeys, src: fn ? String(fn).slice(0, 200) : null };
  }

  let current = null; // the record for the frame being drawn
  const wrapped = new WeakMap(); // sub object → entry

  function wrapSubscribers() {
    const state = r3fState();
    if (!state || !state.internal || !state.internal.subscribers) return;
    for (const sub of state.internal.subscribers) {
      if (wrapped.has(sub)) continue;
      const entry = { id: s5.subs.length, priority: sub.priority, desc: null, total: 0, calls: 0, max: 0 };
      s5.subs.push(entry);
      wrapped.set(sub, entry);
      const ref = sub.ref;
      let inner = ref.current;
      const timed = new WeakMap();
      const timedFor = (fn) => {
        let t = timed.get(fn);
        if (!t) {
          t = function (...args) {
            const t0 = now();
            try {
              return fn.apply(this, args);
            } finally {
              const ms = now() - t0;
              entry.total += ms;
              entry.calls += 1;
              if (ms > entry.max) entry.max = ms;
              if (current) current.subs[entry.id] = (current.subs[entry.id] || 0) + ms;
            }
          };
          timed.set(fn, t);
        }
        return t;
      };
      try {
        Object.defineProperty(ref, "current", {
          configurable: true,
          get: () => (typeof inner === "function" ? timedFor(inner) : inner),
          set: (v) => {
            inner = v;
          },
        });
      } catch (err) {
        s5.errors.push(`wrap: ${err}`);
      }
      entry.desc = describe(sub, inner);
    }
  }

  // ------------------------------------------------------------ GPU uploads

  // Bytes handed to the GPU after start-up: buffer and texture uploads, per frame while recording.
  let uploads = { buffer: 0, texture: 0, calls: 0 };
  const upload = (kind, bytes) => {
    uploads[kind] += bytes;
    uploads.calls += 1;
  };
  const sizeOf = (data) => (data && typeof data === "object" && "byteLength" in data ? data.byteLength : 0);
  for (const proto of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
    if (!proto || proto.__s5Patched) continue;
    proto.__s5Patched = true;
    const wrap = (name, fn) => {
      const orig = proto[name];
      if (!orig) return;
      proto[name] = function (...args) {
        try {
          fn(args);
        } catch (err) {
          s5.errors.push(`${name}: ${err}`);
        }
        return orig.apply(this, args);
      };
    };
    // bufferSubData(target, offset, src, srcOffset?, length?) uploads `length` elements of src, or all of it.
    wrap("bufferSubData", (a) => {
      const src = a[2];
      const per = src && src.BYTES_PER_ELEMENT ? src.BYTES_PER_ELEMENT : 1;
      upload("buffer", a.length >= 5 && a[4] ? a[4] * per : a.length >= 4 && a[3] ? sizeOf(src) - a[3] * per : sizeOf(src));
    });
    wrap("bufferData", (a) => upload("buffer", typeof a[1] === "number" ? 0 : sizeOf(a[1])));
    wrap("texSubImage2D", (a) => {
      // (target, level, x, y, w, h, format, type, pixels) or (target, level, x, y, format, type, source)
      if (a.length >= 9) upload("texture", sizeOf(a[8]) || a[4] * a[5] * 4);
      else upload("texture", (a[6] && (a[6].width || 0) * (a[6].height || 0) * 4) || 0);
    });
    wrap("texSubImage3D", (a) => upload("texture", sizeOf(a[10]) || a[5] * a[6] * a[7] * 4));
    wrap("texImage2D", (a) => upload("texture", a.length >= 9 ? sizeOf(a[8]) : (a[5] && (a[5].width || 0) * (a[5].height || 0) * 4) || 0));
  }

  // ------------------------------------------------------------ the frame

  // Outermost rAF wrapper (installed after the rig's): time the callback that draws, and every
  // other requestAnimationFrame callback of the same frame (GSAP's ticker, drei, the page).
  const prevRAF = window.requestAnimationFrame;
  let otherByTs = new Map(); // ts → ms in callbacks that did not draw
  window.requestAnimationFrame = (cb) =>
    prevRAF((ts) => {
      const r = rig();
      try {
        wrapSubscribers();
      } catch (err) {
        s5.errors.push(`subs: ${err}`);
      }
      const before = r ? r.renderCount() : 0;
      const recording = !!(r && r.recording);
      const rec = recording ? { frame: r.frame, ts, cb: 0, other: 0, subs: [], commits: { dom: 0, r3f: 0 }, uploads: null } : null;
      current = rec;
      if (rec) uploads = { buffer: 0, texture: 0, calls: 0 };
      const t0 = now();
      try {
        cb(ts);
      } finally {
        const ms = now() - t0;
        if (rec && r.renderCount() !== before) {
          rec.cb = ms;
          rec.uploads = uploads;
          rec.other = otherByTs.get(ts) || 0;
          s5.frames.push(rec);
          rec.ts = ts;
          s5.lastDrawn = rec;
        } else if (recording) {
          // A callback that did not draw: charge it to its frame (callbacks of one frame share ts).
          otherByTs.set(ts, (otherByTs.get(ts) || 0) + ms);
          if (s5.lastDrawn && s5.lastDrawn.ts === ts) s5.lastDrawn.other += ms;
          if (otherByTs.size > 600) otherByTs = new Map();
        }
        current = null;
      }
    });

  s5.snapshot = () => ({
    renderers: s5.renderers,
    commitCount: s5.commitCount,
    commits: s5.commits,
    subs: s5.subs.map((s) => ({ ...s, desc: s.desc })),
    frames: s5.frames.map((f) => ({ frame: f.frame, cb: f.cb, other: f.other, subs: f.subs, uploads: f.uploads })),
    errors: s5.errors,
  });
  s5.reset = () => {
    s5.commits = [];
    s5.frames = [];
    for (const s of s5.subs) {
      s.total = 0;
      s.calls = 0;
      s.max = 0;
    }
  };
  s5.r3fState = r3fState;
})();
