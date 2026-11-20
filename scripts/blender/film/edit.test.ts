import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { END_CARD, GRADE, cardArgs, filmArgs, frameStatus, grainFor, letterboxBar, loadPlan, stillArgs, verticalArgs } from "./edit.mjs";
import { verticalCut } from "./scene.mjs";

const { shots } = loadPlan();
const graph = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

describe("edit: letterbox and grain", () => {
  it("crops 4K to 2.39:1 with even bars", () => {
    const bar = letterboxBar(3840, 2160, 2.39);
    expect(bar % 2).toBe(0);
    expect(Math.abs(2160 - 2 * bar - 3840 / 2.39)).toBeLessThan(4);
    expect(letterboxBar(1920, 800, 2.39)).toBe(0); // already wider than 2.39:1: no bars
  });

  it("keeps the grain light and scaled to the frame", () => {
    expect(grainFor(540)).toBeLessThan(grainFor(2160));
    expect(grainFor(2160)).toBeLessThanOrEqual(8);
  });
});

describe("edit: the film", () => {
  const base = { shots, framesDir: "/f", width: 3840, height: 2160, out: "/o.mp4", card: "/card.png" };

  it("plays every frame at 24 fps for the film's length, graded, letterboxed, with a silent track", () => {
    const args = filmArgs(base);
    expect(args).toContain("/f/f_%04d.png");
    expect(args[args.indexOf("-t") + 1]).toBe((shots.frames / shots.fps).toFixed(3));
    expect(args[args.indexOf("-framerate") + 1]).toBe("24");
    expect(graph(args)).toContain(GRADE);
    expect(graph(args)).toContain(`h=${letterboxBar(3840, 2160, shots.letterbox)}`);
    expect(args.join(" ")).toContain("anullsrc");
    expect(args).toContain("libx264");
  });

  it("fades the end card in over the last seconds", () => {
    const start = (shots.frames / shots.fps - END_CARD.seconds).toFixed(3);
    expect(graph(filmArgs(base))).toContain(`fade=t=in:st=${start}:d=${END_CARD.fadeIn}:alpha=1`);
  });

  it("lays the owner's music under the film when given, and can drop the letterbox", () => {
    const args = filmArgs({ ...base, music: "/bed.wav", letterbox: false });
    expect(args).toContain("/bed.wav");
    expect(args.join(" ")).not.toContain("anullsrc");
    expect(args.join(" ")).toContain("afade=t=out");
    expect(graph(args)).not.toContain("drawbox");
  });
});

describe("edit: the vertical cut", () => {
  const plan = verticalCut();
  const args = verticalArgs({ shots, plan, framesDir: "/f", out: "/v.mp4", card: "/tall.png" });

  it("reads each segment from its first frame and crops it 9:16 where the shot list says", () => {
    plan.forEach((seg) => {
      expect(args.join(" ")).toContain(`-start_number ${seg.firstFrame} -i /f/f_%04d.png`);
      expect(graph(args)).toContain(`x=(iw-ih*9/16)*${seg.center}`);
    });
    expect(graph(args)).toContain(`concat=n=${plan.length}`);
    expect(graph(args)).toContain(`scale=${shots.vertical.width}:${shots.vertical.height}`);
  });

  it("runs 15 s with the end card on the last segment", () => {
    expect(args[args.indexOf("-t") + 1]).toBe(shots.vertical.seconds.toFixed(3));
    expect(graph(args)).toContain(`fade=t=in:st=${(shots.vertical.seconds - END_CARD.tallSeconds).toFixed(3)}`);
  });
});

describe("edit: stills, end card and frames", () => {
  it("grades stills like the film", () => {
    expect(stillArgs("/a.png", "/a.jpg").join(" ")).toContain(GRADE);
  });

  it("renders the end card at the requested size and layout, with the logo once it exists", () => {
    const args = cardArgs({ width: 1080, height: 1920, layout: "tall", out: "/c.png", logo: "/logo.png" });
    expect(args).toContain("--window-size=1080,1920");
    const url = new URL(args.at(-1)!);
    expect(url.pathname.endsWith("/endcard.html")).toBe(true);
    expect(url.searchParams.get("layout")).toBe("tall");
    expect(url.searchParams.get("logo")).toBe("file:///logo.png");
  });

  const dir = mkdtempSync(join(tmpdir(), "frames-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports the first missing frame", () => {
    for (const f of ["f_0001.png", "f_0002.png", "f_0004.png", "notes.txt"]) writeFileSync(join(dir, f), "");
    expect(frameStatus(dir, 4)).toEqual({ count: 3, missing: 3 });
    writeFileSync(join(dir, "f_0003.png"), "");
    expect(frameStatus(dir, 4)).toEqual({ count: 4, missing: null });
    expect(frameStatus(join(dir, "nope"), 2)).toEqual({ count: 0, missing: 1 });
  });
});
