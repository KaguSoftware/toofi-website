/**
 * Trace analysis for search track S1 (page load and 3D start-up on the main thread).
 *
 * Input is a Chrome trace (the event list DevTools' Performance panel records): the timeline
 * events of the page's main thread plus the V8 CPU profile carried in the same trace. Output is,
 * for every long task, what ran in it: which timeline events, which scripts, which WebGL calls
 * (the calls where the main thread waits for the GPU process), and the functions on top.
 *
 * Everything here is plain data in, plain data out (no browser), so it is unit tested.
 */

/** WebGL entry points that show up as native frames in the CPU profile. */
export const GL_CALLS = new Set([
  "getContext",
  "compileShader",
  "linkProgram",
  "shaderSource",
  "getProgramParameter",
  "getShaderParameter",
  "getProgramInfoLog",
  "getShaderInfoLog",
  "getUniformLocation",
  "getActiveUniform",
  "getActiveAttrib",
  "getAttribLocation",
  "getUniformBlockIndex",
  "getActiveUniformBlockParameter",
  "getActiveUniforms",
  "useProgram",
  "texImage2D",
  "texSubImage2D",
  "texImage3D",
  "texSubImage3D",
  "texStorage2D",
  "texStorage3D",
  "compressedTexImage2D",
  "compressedTexSubImage2D",
  "compressedTexImage3D",
  "compressedTexSubImage3D",
  "generateMipmap",
  "bufferData",
  "bufferSubData",
  "drawElements",
  "drawArrays",
  "drawElementsInstanced",
  "drawArraysInstanced",
  "drawRangeElements",
  "multiDrawElementsWEBGL",
  "clear",
  "readPixels",
  "finish",
  "flush",
  "getError",
  "getParameter",
  "getExtension",
  "getSupportedExtensions",
  "getShaderPrecisionFormat",
  "checkFramebufferStatus",
  "framebufferTexture2D",
  "renderbufferStorage",
  "renderbufferStorageMultisample",
  "blitFramebuffer",
  "copyTexSubImage2D",
  "clientWaitSync",
  "fenceSync",
  "getSyncParameter",
  "getQueryParameter",
  "bindVertexArray",
  "vertexAttribPointer",
  "uniformMatrix4fv",
  "bindTexture",
  "bindFramebuffer",
]);

/** Program and shader calls: the ones that wait for a compile or a link in the GPU process. */
export const SHADER_CALLS = new Set([
  "compileShader",
  "linkProgram",
  "shaderSource",
  "getProgramParameter",
  "getShaderParameter",
  "getProgramInfoLog",
  "getShaderInfoLog",
  "getUniformLocation",
  "getActiveUniform",
  "getActiveAttrib",
  "getAttribLocation",
  "getUniformBlockIndex",
  "getActiveUniformBlockParameter",
  "getActiveUniforms",
  "useProgram",
]);
const UPLOAD_CALLS = new Set(["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "texStorage2D", "texStorage3D", "compressedTexImage2D", "compressedTexSubImage2D", "compressedTexImage3D", "compressedTexSubImage3D", "generateMipmap", "bufferData", "bufferSubData"]);
const DRAW_CALLS = new Set(["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced", "drawRangeElements", "multiDrawElementsWEBGL", "clear", "blitFramebuffer"]);

/** The file name of a script URL, without host, folders or query. */
export function chunkName(url) {
  if (!url) return "";
  const path = url.split("?")[0].split("#")[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The renderer main thread of the page under test and its navigation start (trace clock, µs).
 * The page is the one whose document URL starts with `urlPrefix`; with several navigations the
 * last one wins (a context's first document is about:blank).
 */
export function findMainThread(events, urlPrefix) {
  let nav = null;
  for (const e of events) {
    if (e.name !== "navigationStart") continue;
    const d = e.args?.data;
    if (!d || d.isOutermostMainFrame === false || d.isLoadingMainFrame === false) continue;
    if (typeof d.documentLoaderURL === "string" && d.documentLoaderURL.startsWith(urlPrefix)) nav = e;
  }
  if (!nav) return null;
  return { pid: nav.pid, tid: nav.tid, navStart: nav.ts };
}

/** Complete (`X`) events of one thread, sorted by start. */
export function threadEvents(events, thread) {
  return events.filter((e) => e.ph === "X" && e.pid === thread.pid && e.tid === thread.tid && typeof e.dur === "number").sort((a, b) => a.ts - b.ts || b.dur - a.dur);
}

/** Main-thread tasks of at least `minMs`, as { start, end, dur } in ms since navigation. */
export function longTasks(events, thread, minMs = 50) {
  const ms = (ts) => (ts - thread.navStart) / 1000;
  const tasks = [];
  for (const e of threadEvents(events, thread)) {
    if (e.name !== "RunTask" && e.name !== "ThreadControllerImpl::RunTask") continue;
    if (e.dur / 1000 < minMs) continue;
    const start = ms(e.ts);
    const end = start + e.dur / 1000;
    // The same task is reported under both names, one nested in the other: keep the outer one
    // (events are sorted by start, longest first, so the outer one is already in the list).
    if (tasks.some((t) => start >= t.start - 0.001 && end <= t.end + 0.001)) continue;
    tasks.push({ start, end, dur: e.dur / 1000 });
  }
  return tasks;
}

/** Timeline events worth naming inside a task (what DevTools shows as the task's children). */
const TIMELINE = new Set([
  "EvaluateScript",
  "v8.compile",
  "v8.compileModule",
  "v8.evaluateModule",
  "v8.produceCache",
  "v8.produceModuleCache",
  "FunctionCall",
  "TimerFire",
  "FireAnimationFrame",
  "FireIdleCallback",
  "RunMicrotasks",
  "EventDispatch",
  "XHRReadyStateChange",
  "XHRLoad",
  "ParseHTML",
  "ParseAuthorStyleSheet",
  "Layout",
  "UpdateLayoutTree",
  "PrePaint",
  "Paint",
  "Layerize",
  "Commit",
  "HitTest",
  "MajorGC",
  "MinorGC",
  "V8.GC_MARK_COMPACTOR",
  "V8.GC_SCAVENGER",
  "BlinkGC.AtomicPhase",
  "Decode Image",
  "ImageDecodeTask",
  "wasm.CompileLazy",
  "v8.wasm.streamFromResponseCallback",
  "v8.wasm.compiledModule",
  "ResourceReceivedData",
  "WebGLRenderingContextBase::DrawingBufferClientRestoreMaskAndClearValues",
]);

/**
 * The named timeline events inside [start, end] (ms since navigation), outermost first:
 * an event nested in another named one is not listed again. Each has its duration clipped to
 * the window and, where the trace gives one, the script URL and function.
 */
export function timelineIn(events, thread, start, end) {
  const from = thread.navStart + start * 1000;
  const to = thread.navStart + end * 1000;
  const out = [];
  let coveredUntil = -Infinity;
  for (const e of threadEvents(events, thread)) {
    if (!TIMELINE.has(e.name)) continue;
    const eEnd = e.ts + e.dur;
    if (eEnd <= from || e.ts >= to) continue;
    if (e.ts < coveredUntil) continue; // nested in the previous named event
    coveredUntil = eEnd;
    const d = e.args?.data ?? {};
    out.push({
      name: e.name,
      ms: (Math.min(eEnd, to) - Math.max(e.ts, from)) / 1000,
      url: chunkName(d.url ?? d.scriptName ?? d.fileName ?? ""),
      fn: d.functionName ?? "",
      type: d.type ?? "",
    });
  }
  return out.sort((a, b) => b.ms - a.ms);
}

/**
 * The CPU profile of one thread out of the trace: the call tree (`nodes`, id → { fn, url,
 * line, column, parent, native }) and the samples as [{ ts (µs, trace clock), id, dt (µs to
 * the next sample) }].
 */
export function cpuProfile(events, thread) {
  const ids = new Set();
  for (const e of events) if (e.name === "Profile" && e.pid === thread.pid && e.tid === thread.tid) ids.add(e.id);
  const starts = new Map();
  for (const e of events) if (e.name === "Profile" && ids.has(e.id)) starts.set(e.id, e.args?.data?.startTime ?? e.ts);
  const nodes = new Map();
  const samples = [];
  const cursor = new Map(starts);
  const chunks = events.filter((e) => e.name === "ProfileChunk" && ids.has(e.id) && e.pid === thread.pid).sort((a, b) => a.ts - b.ts);
  for (const e of chunks) {
    const d = e.args?.data ?? {};
    for (const n of d.cpuProfile?.nodes ?? []) {
      const cf = n.callFrame ?? {};
      nodes.set(n.id, {
        fn: cf.functionName ?? "",
        url: cf.url ?? "",
        line: cf.lineNumber ?? -1,
        column: cf.columnNumber ?? -1,
        parent: n.parent ?? null,
        // A frame with no script URL is the browser's own: a WebGL or DOM call, a regular expression, the collector.
        native: !cf.url,
      });
    }
    const ss = d.cpuProfile?.samples ?? [];
    const dts = d.timeDeltas ?? [];
    let t = cursor.get(e.id) ?? e.ts;
    for (let i = 0; i < ss.length; i++) {
      t += dts[i] ?? 0;
      samples.push({ ts: t, id: ss[i], dt: 0 });
    }
    cursor.set(e.id, t);
  }
  samples.sort((a, b) => a.ts - b.ts);
  for (let i = 0; i + 1 < samples.length; i++) samples[i].dt = samples[i + 1].ts - samples[i].ts;
  return { nodes, samples };
}

/** A sample's stack, leaf first. */
export function stackOf(nodes, id) {
  const out = [];
  for (let n = nodes.get(id), guard = 0; n && guard < 2000; n = n.parent === null ? null : nodes.get(n.parent), guard++) out.push(n);
  return out;
}

/**
 * Which kind of work a sample is, from its stack (leaf first):
 * `shader` (compile, link and program queries), `upload` (textures and buffers), `draw`,
 * `webgl` (other context calls), `gc`, `idle`, `native` (browser work with no script on top),
 * or `script` (JavaScript, or a browser call made from it).
 */
export function kindOf(stack) {
  const leaf = stack[0];
  if (!leaf) return "native";
  if (leaf.fn === "(idle)") return "idle";
  if (leaf.fn === "(garbage collector)") return "gc";
  if (leaf.native && GL_CALLS.has(leaf.fn)) {
    if (SHADER_CALLS.has(leaf.fn)) return "shader";
    if (UPLOAD_CALLS.has(leaf.fn)) return "upload";
    if (DRAW_CALLS.has(leaf.fn)) return "draw";
    return "webgl";
  }
  if (leaf.fn === "(program)" || leaf.fn === "(root)") return "native";
  // Anything else is script, or a browser call made from it (a regular expression, fetch, …).
  return "script";
}

const add = (map, key, v) => map.set(key, (map.get(key) ?? 0) + v);
const top = (map, n) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, us]) => ({ key, ms: us / 1000 }));

/**
 * What the samples inside [start, end] (ms since navigation) say: time per kind of work, per
 * WebGL call, per script file (self time), and the functions with the most self and inclusive
 * time. Times are sampled, so they are estimates: `sampledMs` says how much of the window the
 * samples cover.
 */
export function attribute(profile, thread, start, end, { topN = 12 } = {}) {
  const from = thread.navStart + start * 1000;
  const to = thread.navStart + end * 1000;
  const kinds = new Map();
  const gl = new Map();
  const files = new Map();
  const self = new Map();
  const inclusive = new Map();
  let sampled = 0;
  for (const s of profile.samples) {
    if (s.ts + s.dt <= from || s.ts >= to) continue;
    const us = Math.min(s.ts + s.dt, to) - Math.max(s.ts, from);
    if (us <= 0) continue;
    const stack = stackOf(profile.nodes, s.id);
    const kind = kindOf(stack);
    if (kind === "idle") continue;
    sampled += us;
    add(kinds, kind, us);
    const leaf = stack[0];
    if (leaf && leaf.native && GL_CALLS.has(leaf.fn)) add(gl, leaf.fn, us);
    // Self time goes to the nearest script frame: a native leaf is charged to its caller's file.
    const owner = stack.find((f) => f.url);
    add(files, owner ? chunkName(owner.url) : "(browser)", us);
    if (leaf) add(self, frameKey(leaf), us);
    const seen = new Set();
    for (const f of stack) {
      const key = frameKey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      add(inclusive, key, us);
    }
  }
  return {
    sampledMs: sampled / 1000,
    kinds: Object.fromEntries([...kinds.entries()].map(([k, us]) => [k, us / 1000])),
    gl: top(gl, 20),
    files: top(files, 10),
    self: top(self, topN),
    inclusive: top(inclusive, topN * 2),
  };
}

/** `fn file:line:column` for a call frame (line and column as the trace gives them, zero-based). */
export function frameKey(f) {
  const name = f.fn || "(anonymous)";
  return f.url ? `${name} ${chunkName(f.url)}:${f.line}:${f.column}` : name;
}

/**
 * Totals over a set of tasks, as Total Blocking Time counts them: the part of each task beyond
 * 50 ms, inside [from, to] (ms since navigation).
 */
export function blockingOf(tasks, from, to) {
  const inside = tasks.filter((t) => t.end > from && t.start < to);
  return {
    count: inside.length,
    totalMs: inside.reduce((a, t) => a + t.dur, 0),
    blockingMs: inside.reduce((a, t) => a + Math.max(0, t.dur - 50), 0),
    longestMs: inside.reduce((a, t) => Math.max(a, t.dur), 0),
    over200: inside.filter((t) => t.dur > 200).length,
  };
}

/**
 * The whole analysis of one trace: the page's main thread, its long tasks from first content
 * to `until` (ms since navigation), and what ran in each.
 */
export function analyzeTrace(events, { urlPrefix = "", minMs = 50, from = 0, until = Infinity, topN = 12 } = {}) {
  const thread = findMainThread(events, urlPrefix);
  if (!thread) return { error: `no navigation to ${urlPrefix} in the trace`, tasks: [] };
  const profile = cpuProfile(events, thread);
  const tasks = longTasks(events, thread, minMs)
    .filter((t) => t.end > from && t.start < until)
    .map((t) => ({ ...t, timeline: timelineIn(events, thread, t.start, t.end).slice(0, 8), ...attribute(profile, thread, t.start, t.end, { topN }) }));
  const lastMs = ((profile.samples.at(-1)?.ts ?? thread.navStart) - thread.navStart) / 1000;
  const window = attribute(profile, thread, from, Number.isFinite(until) ? until : lastMs, { topN: topN * 2 });
  return { thread, samples: profile.samples.length, tasks, blocking: blockingOf(tasks, from, until), window };
}
