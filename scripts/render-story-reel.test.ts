import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BEATS, INTRO_HOLD_SECONDS, INTRO_SECONDS, STORY_END } from "../components/sawad/experience/beats";
import { REEL_QUALITY } from "../components/sawad/experience/quality";
import * as reel from "../components/sawad/experience/reel";
import { VIEW_IDS } from "../lib/sawad/tweaks";
import { shippedPath } from "./blender/version-assets.mjs";
import * as script from "./render-story-reel.mjs";

describe("the reel's capture script", () => {
  it("keeps the timeline the page plays by", () => {
    expect(script.REEL_FPS).toBe(reel.REEL_FPS);
    expect(script.INTRO_HOLD_SECONDS).toBe(INTRO_HOLD_SECONDS);
    expect(script.INTRO_SECONDS).toBe(INTRO_SECONDS);
    expect(script.STORY_END).toBe(STORY_END);
    expect(script.OPENING_SECONDS).toBe(reel.OPENING_SECONDS);
    expect(script.TOUR_FRAMES_PER_UNIT).toBe(reel.TOUR_FRAMES_PER_UNIT);
    expect(script.TOUR_FRAMES).toBe(reel.TOUR_FRAMES);
    expect(script.VIEWS).toEqual([...VIEW_IDS]);
    expect(script.SHAPES).toEqual(reel.REEL_SIZE);
    for (const s of [0, 1.5, 2, 9, 16, 30]) expect(script.openingPosition(s)).toBe(reel.openingPosition(s));
    for (const k of [0, 1, 70, 719, 720, 900]) expect(script.tourPosition(k)).toBe(reel.tourPosition(k));
    // The master frame is the capture mode's canvas: the viewport at the reel's pixel ratio.
    expect(script.MASTER).toEqual({ width: script.VIEWPORT.width * REEL_QUALITY.maxDpr, height: script.VIEWPORT.height * REEL_QUALITY.maxDpr });
  });

  it("plans the opening as 16 s of frames: the hold, then one sequence second a second to the gate", () => {
    const frames = script.openingFrames();
    expect(frames).toHaveLength(reel.OPENING_SECONDS * reel.REEL_FPS);
    expect(frames[0]).toEqual({ part: "opening", index: 0, seconds: 0, position: 0 });
    expect(frames[INTRO_HOLD_SECONDS * reel.REEL_FPS].position).toBe(0);
    expect(frames[INTRO_HOLD_SECONDS * reel.REEL_FPS + 30].position).toBeCloseTo(1);
    const last = frames[frames.length - 1];
    expect(last.seconds).toBeCloseTo(reel.OPENING_SECONDS - 1 / reel.REEL_FPS);
    expect(last.position).toBeCloseTo(INTRO_SECONDS - 1 / reel.REEL_FPS);
  });

  it("runs on into the tour with the clock unbroken, a frame for every twentieth of a sequence second", () => {
    const frames = script.tourFrames();
    expect(frames).toHaveLength(reel.TOUR_FRAMES + 1);
    expect(frames[0]).toEqual({ part: "tour", index: 0, seconds: reel.OPENING_SECONDS, position: INTRO_SECONDS, still: true });
    expect(frames.every((f) => f.still)).toBe(true);
    expect(script.openingFrames().some((f) => "still" in f)).toBe(false);
    expect(frames[frames.length - 1].position).toBe(STORY_END);
    // Every stop is a frame of the file, at the time the page seeks to.
    for (const beat of BEATS) {
      const frame = frames[Math.round(reel.tourTime(beat.at) * reel.REEL_FPS)];
      expect(frame.position).toBeCloseTo(beat.at);
    }
    const plan = script.framePlan({ tour: true });
    expect(plan).toHaveLength(script.openingFrames().length + frames.length);
    // Never a step back or a jump; the tour's are finer, three sequence seconds to one of the scene's.
    for (let i = 1; i < plan.length; i++) expect(plan[i].seconds - plan[i - 1].seconds).toBeCloseTo(plan[i - 1].part === "tour" ? 1 / (3 * reel.TOUR_FRAMES_PER_UNIT) : 1 / reel.REEL_FPS);
    expect(script.framePlan({ tour: false })).toHaveLength(script.openingFrames().length);
  });

  it("names frames and files as the page asks for them", () => {
    expect(script.frameFile("opening", "street", 7, "/f")).toBe("/f/opening-street/00007.jpg");
    expect(script.frameFile("tour", "street", 720, "/f")).toBe("/f/tour/00720.jpg");
    for (const view of VIEW_IDS) for (const shape of ["wide", "tall"] as const) expect(script.outFile("opening", view, shape, "/public/sawad/reel")).toBe(`/public${reel.openingPath(view, shape)}`);
    for (const shape of ["wide", "tall"] as const) expect(script.outFile("tour", null, shape, "/public/sawad/reel")).toBe(`/public${reel.tourPath(shape)}`);
    expect(script.CODECS).toEqual([...reel.REEL_CODECS]);
    for (const codec of reel.REEL_CODECS) {
      expect(script.outFile("tour", null, "tall", "/p", codec)).toBe(`/p/${reel.tourPath("tall", codec).split("/").pop()}`);
      expect(script.outFile("opening", "street", "wide", "/p", codec)).toBe(`/p/${reel.openingPath("street", "wide", codec).split("/").pop()}`);
    }
  });

  it("scales the wide file down from the whole frame and cuts the tall one from its middle strip", () => {
    expect(script.videoFilter("wide")).toMatch(/^scale=1920:1080:flags=lanczos/);
    const tall = script.videoFilter("tall");
    const [, w, h, x, y] = /^crop=(\d+):(\d+):(\d+):(\d+),scale=720:1280:/.exec(tall)!.map(Number);
    expect([h, y]).toEqual([script.MASTER.height, 0]);
    expect(w % 2).toBe(0);
    expect(w / h).toBeCloseTo(9 / 16, 2);
    expect(Math.abs(x + w / 2 - script.MASTER.width / 2)).toBeLessThanOrEqual(1); // centred
    for (const shape of ["wide", "tall"] as const) expect(script.videoFilter(shape)).toMatch(/in_range=pc.*out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=.*color_primaries=bt709:color_trc=bt709$/);
  });

  it("encodes the opening to be played and the tour to be sought", () => {
    const arg = (args: string[], name: string) => args[args.indexOf(name) + 1];
    const opening = script.ffmpegArgs("opening", "flight", "wide", { framesDir: "/f", outDir: "/o" });
    expect(arg(opening, "-i")).toBe("/f/opening-flight/%05d.jpg");
    expect(arg(opening, "-framerate")).toBe("30");
    expect(arg(opening, "-c:v")).toBe("libx264");
    expect(arg(opening, "-profile:v")).toBe("high");
    expect(arg(opening, "-pix_fmt")).toBe("yuv420p");
    expect(arg(opening, "-colorspace")).toBe("bt709");
    expect(arg(opening, "-movflags")).toBe("+faststart");
    expect(opening).toContain("-an");
    expect(Number(arg(opening, "-g"))).toBeGreaterThanOrEqual(30);
    expect(opening[opening.length - 1]).toBe("/o/zaitun-opening-flight-wide.mp4");

    const tour = script.ffmpegArgs("tour", null, "tall", { framesDir: "/f", outDir: "/o" });
    expect(arg(tour, "-i")).toBe("/f/tour/%05d.jpg");
    // A seek decodes a handful of frames at most: close key frames, no B-frames, no extra ones at cuts.
    // Key frames fall on whole sequence seconds, so every stop of the story is one.
    expect(Number(arg(tour, "-g"))).toBeLessThanOrEqual(20);
    // The page's decoder (reelDecoder.ts) counts on the same spacing.
    expect(script.ENCODE.tour.gop).toBe(reel.TOUR_GOP);
    expect(reel.TOUR_FRAMES_PER_UNIT % Number(arg(tour, "-g"))).toBe(0);
    for (const beat of BEATS) expect(Math.round(reel.tourTime(beat.at) * reel.REEL_FPS) % Number(arg(tour, "-g"))).toBe(0);
    expect(arg(tour, "-keyint_min")).toBe(arg(tour, "-g"));
    expect(arg(tour, "-bf")).toBe("0");
    expect(arg(tour, "-sc_threshold")).toBe("0");
    expect(tour[tour.length - 1]).toBe("/o/zaitun-tour-tall.mp4");
  });

  it("gives AV1 and HEVC the same groups of pictures, and HEVC the tag Safari needs", () => {
    const arg = (args: string[], name: string) => args[args.indexOf(name) + 1];
    for (const part of ["opening", "tour"] as const) {
      const av1 = script.ffmpegArgs(part, "flight", "wide", { codec: "av1", outDir: "/o" });
      const hevc = script.ffmpegArgs(part, "flight", "wide", { codec: "hevc", outDir: "/o" });
      const gop = script.ENCODE[part].gop;
      expect(arg(av1, "-c:v")).toBe("libsvtav1");
      expect(Number(arg(av1, "-g"))).toBe(gop);
      expect(arg(hevc, "-c:v")).toBe("libx265");
      expect(arg(hevc, "-tag:v")).toBe("hvc1");
      expect(arg(hevc, "-x265-params")).toContain(`keyint=${gop}:min-keyint=${gop}:scenecut=0:open-gop=0`);
      // 8 bits: what `REEL_TYPE` asks the browser about.
      for (const args of [av1, hevc]) expect(arg(args, "-pix_fmt")).toBe("yuv420p");
      expect(av1[av1.length - 1]).toMatch(/-av1\.mp4$/);
      expect(hevc[hevc.length - 1]).toMatch(/-hevc\.mp4$/);
    }
  });

  it("reads its arguments", () => {
    expect(script.parseArgs([])).toEqual({ base: "http://localhost:3000", views: [...VIEW_IDS], codecs: ["av1", "hevc", "h264"], tour: true, record: true, encode: true });
    expect(script.parseArgs(["http://localhost:3211/", "--views", "street,aerial", "--no-tour", "--no-encode"])).toEqual({ base: "http://localhost:3211", views: ["street", "aerial"], codecs: ["av1", "hevc", "h264"], tour: false, record: true, encode: false });
    expect(script.parseArgs(["--encode-only"]).record).toBe(false);
    expect(script.parseArgs(["--codecs", "av1,hevc", "--encode-only"])).toMatchObject({ base: "http://localhost:3000", codecs: ["av1", "hevc"] });
    expect(() => script.parseArgs(["--codecs", "vp9"])).toThrow(/unknown codec/);
    expect(() => script.parseArgs(["--views", "moon"])).toThrow(/unknown view/);
  });

  it("has shipped the reel: every opening and the tour, in both shapes and every codec", () => {
    const publicDir = join(script.ROOT, "public");
    for (const shape of ["wide", "tall"] as const) {
      for (const codec of reel.REEL_CODECS) {
        for (const path of [...VIEW_IDS.map((view) => reel.openingPath(view, shape, codec)), reel.tourPath(shape, codec)]) expect(existsSync(shippedPath(path, { publicDir })), path).toBe(true);
      }
    }
  });
});
