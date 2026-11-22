// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "glprobe.js"), "utf8");

type Call = { n: number; ms: number; max: number };
type S1 = {
  salt: (source: string, type: number) => string | null;
  snapshot: () => {
    calls: Record<string, Call>;
    slow: Array<{ name: string; ms: number; detail: string; phase: string }>;
    programs: number;
    shaders: number;
    salted: number;
    saltMisses: number;
    extensions: string[];
    workers: unknown[];
    programList: Array<{ phase: string; type: string; name: string }>;
    precompile: { scenes: number; ms: number; heldFrames: number } | null;
    marks: Array<{ name: string }>;
  };
};
type W = Window & { __s1?: S1; __S1_CONFIG__?: unknown; __rig?: { started: boolean }; WebGL2RenderingContext?: unknown; __THREE_DEVTOOLS__?: EventTarget };

const VERTEX = 0x8b31;
const FRAGMENT = 0x8b30;

/** A stand-in context: records the shader sources it is given, and can be made slow. */
function fakeContext() {
  const sources: string[] = [];
  let clock = 0;
  class Fake {
    createShader(type: number) {
      return { type };
    }
    shaderSource(_shader: object, source: string) {
      sources.push(source);
    }
    linkProgram() {}
    getProgramParameter() {
      clock += 25; // a wait for the link
      return true;
    }
    getExtension(name: string) {
      return name ? {} : null;
    }
    texImage2D() {
      clock += 1;
    }
    drawElements() {}
  }
  return { Fake, sources, now: () => clock };
}

const realNow = performance.now;
const realRAF = window.requestAnimationFrame;

function install(config: Record<string, unknown>) {
  const ctx = fakeContext();
  const queue: FrameRequestCallback[] = [];
  window.requestAnimationFrame = (cb) => queue.push(cb);
  performance.now = ctx.now;
  (window as W).WebGL2RenderingContext = ctx.Fake;
  (window as W).__S1_CONFIG__ = config;
  new Function(SOURCE)();
  const flush = () => queue.splice(0).forEach((cb) => cb(0));
  return { s1: (window as W).__s1!, gl: new ctx.Fake(), sources: ctx.sources, flush };
}

beforeEach(() => {
  delete (window as W).__s1;
  delete (window as W).__rig;
  delete (window as W).__THREE_DEVTOOLS__;
  document.body.innerHTML = "";
});

/** A stand-in three.js renderer whose canvas sits in the experience's stage. */
function fakeRenderer() {
  const host = document.createElement("div");
  host.className = "xp__canvas";
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  const drawn: object[] = [];
  const compiled: object[] = [];
  const renderer = {
    isWebGLRenderer: true,
    domElement: canvas,
    debug: { checkShaderErrors: true },
    render(scene: object) {
      drawn.push(scene);
    },
    compileAsync(scene: object) {
      compiled.push(scene);
      return Promise.resolve(scene);
    },
  };
  return { renderer, drawn, compiled };
}

const announce = (renderer: object) => (window as W).__THREE_DEVTOOLS__!.dispatchEvent(new CustomEvent("observe", { detail: renderer }));
const tick = () => new Promise((r) => setTimeout(r, 5));
afterEach(() => {
  performance.now = realNow;
  window.requestAnimationFrame = realRAF;
  delete (window as W).WebGL2RenderingContext;
});

describe("glprobe", () => {
  it("times each call and tallies it under the phase it ran in", () => {
    const { s1, gl, flush } = install({});
    gl.getExtension("KHR_parallel_shader_compile");
    gl.linkProgram();
    (window as W).__rig = { started: true }; // the first frame begins
    flush();
    gl.getProgramParameter();
    gl.getProgramParameter();
    gl.texImage2D();
    flush(); // the frame after the first: start-up is over
    gl.drawElements();
    const snap = s1.snapshot();
    expect(snap.calls["load:linkProgram"]).toEqual({ n: 1, ms: 0, max: 0 });
    expect(snap.calls["first:getProgramParameter"]).toEqual({ n: 2, ms: 50, max: 25 });
    expect(snap.calls["first:texImage2D"]).toEqual({ n: 1, ms: 1, max: 1 });
    expect(snap.calls["after:drawElements"].n).toBe(1);
    expect(snap.programs).toBe(1);
    expect(snap.extensions).toEqual(["KHR_parallel_shader_compile"]);
  });

  it("lists the calls that took long, with what they were", () => {
    const { s1, gl } = install({ slowMs: 10 });
    (gl.getProgramParameter as (p: object, name: number) => boolean)({}, 0x8b82);
    gl.texImage2D();
    expect(s1.snapshot().slow).toEqual([expect.objectContaining({ name: "getProgramParameter", ms: 25, detail: "LINK_STATUS", phase: "load" })]);
  });

  it("leaves shader sources alone without a salt", () => {
    const { s1, gl, sources } = install({});
    const shader = gl.createShader(VERTEX);
    gl.shaderSource(shader, "void main(){ gl_Position = vec4(0.0); }");
    expect(sources).toEqual(["void main(){ gl_Position = vec4(0.0); }"]);
    expect(s1.snapshot()).toMatchObject({ shaders: 1, salted: 0 });
  });

  it("gives every shader its own uniform when salted, so no cache has seen it", () => {
    const { s1, gl, sources } = install({ salt: "abc" });
    gl.shaderSource(gl.createShader(VERTEX), "#version 300 es\nvoid main() { gl_Position = vec4(0.0); }");
    gl.shaderSource(gl.createShader(FRAGMENT), "precision highp float;\nvoid main( void ){ gl_FragColor = vec4(1.0); }");
    expect(sources[0].startsWith("#version 300 es\nvoid s1_main_orig() {")).toBe(true);
    expect(sources[0]).toContain("uniform float s1_salt_abc_0;");
    expect(sources[0]).toContain("void main(){ s1_main_orig(); if (s1_salt_abc_0 < -1.0) gl_Position.z += 1.0; }");
    expect(sources[1]).toContain("void s1_main_orig(){ gl_FragColor");
    expect(sources[1]).toContain("uniform mediump float s1_salt_abc_1;");
    expect(sources[1]).toContain("discard;");
    expect(s1.snapshot()).toMatchObject({ salted: 2, saltMisses: 0 });
  });

  it("counts a shader it cannot salt and passes it through unchanged", () => {
    const { s1, gl, sources } = install({ salt: "abc" });
    gl.shaderSource(gl.createShader(VERTEX), "#define ENTRY main\nvoid ENTRY(){}");
    expect(sources).toEqual(["#define ENTRY main\nvoid ENTRY(){}"]);
    expect(s1.snapshot()).toMatchObject({ salted: 0, saltMisses: 1 });
  });

  it("renames only the last main, the one that is defined", () => {
    const { s1 } = install({ salt: "x" });
    const out = s1.salt("// void main() in a comment\nvoid main(){}", VERTEX)!;
    expect(out).toContain("// void main() in a comment\nvoid s1_main_orig(){}");
  });

  it("names each program from the lines three.js writes into its shaders", () => {
    const { s1, gl } = install({});
    gl.shaderSource(gl.createShader(VERTEX), "#version 300 es\n#define SHADER_TYPE MeshStandardMaterial\n#define SHADER_NAME trim-sheet\nvoid main(){}");
    gl.shaderSource(gl.createShader(FRAGMENT), "#define SHADER_TYPE MeshStandardMaterial\n#define SHADER_NAME trim-sheet\nvoid main(){}");
    gl.linkProgram();
    gl.linkProgram(); // a program whose shaders carry no names
    expect(s1.snapshot().programList).toEqual([
      expect.objectContaining({ phase: "load", type: "MeshStandardMaterial", name: "trim-sheet" }),
      expect.objectContaining({ phase: "load", type: "", name: "" }),
    ]);
  });
});

describe("glprobe what-if switches", () => {
  it("leaves the renderer alone without a switch", () => {
    install({});
    expect((window as W).__THREE_DEVTOOLS__).toBeUndefined();
  });

  it("turns three.js's shader error check off with nocheck", () => {
    const { s1 } = install({ nocheck: true });
    const { renderer } = fakeRenderer();
    announce(renderer);
    expect(renderer.debug.checkShaderErrors).toBe(false);
    expect(s1.snapshot().marks.map((m) => m.name)).toContain("renderer");
  });

  it("holds the frame loop's draws until every scene of the first frame is compiled, then lets them through", async () => {
    const { s1, flush } = install({ precompile: true });
    const { renderer, drawn, compiled } = fakeRenderer();
    announce(renderer);
    const scene = { isScene: true };
    const pass = { isScene: true };
    const camera = { isPerspectiveCamera: true };

    // A set-up render outside the frame loop (the environment map) is drawn at once.
    renderer.render(pass);
    expect(drawn).toEqual([pass]);

    // The first frame: the scene and an effect pass are compiled, not drawn.
    window.requestAnimationFrame(() => {
      (renderer.render as (s: object, c: object) => void)(scene, camera);
      (renderer.render as (s: object, c: object) => void)(pass, {});
    });
    flush();
    expect(compiled).toEqual([scene, pass]);
    expect(drawn).toEqual([pass]);

    // Once the compile has settled, frames draw as usual.
    await tick();
    window.requestAnimationFrame(() => (renderer.render as (s: object, c: object) => void)(scene, camera));
    flush();
    expect(drawn).toEqual([pass, scene]);
    expect(s1.snapshot().precompile).toMatchObject({ scenes: 2 });
  });

  it("does not hold a renderer that is not the experience's", async () => {
    const { flush } = install({ precompile: true });
    const { renderer, drawn, compiled } = fakeRenderer();
    renderer.domElement.parentElement!.className = "finder__scene";
    announce(renderer);
    window.requestAnimationFrame(() => renderer.render({ isScene: true }));
    flush();
    expect(compiled).toEqual([]);
    expect(drawn).toHaveLength(1);
  });
});
