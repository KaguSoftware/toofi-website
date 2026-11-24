import { describe, expect, it } from "vitest";
import { BEATS, INTRO_HOLD_SECONDS, INTRO_SECONDS, STORY_END } from "./beats";
import { OPENING_SECONDS, REEL_CODECS, REEL_FPS, REEL_TYPE, REEL_SIZE, TOUR_FRAMES, TOUR_SECONDS, openingPath, bestCodec, openingPosition, playableCodecs, reelFileOf, reelShape, reelSources, tourPath, tourPosition, tourTime } from "./reel";

describe("the reel's timeline", () => {
  it("plays the opening as the live story did: a hold on the poster frame, then one sequence second a second to the gate", () => {
    expect(OPENING_SECONDS).toBe(INTRO_HOLD_SECONDS + INTRO_SECONDS);
    expect(openingPosition(0)).toBe(0);
    expect(openingPosition(INTRO_HOLD_SECONDS)).toBe(0);
    expect(openingPosition(INTRO_HOLD_SECONDS + 5)).toBe(5);
    expect(openingPosition(OPENING_SECONDS)).toBe(INTRO_SECONDS);
    expect(openingPosition(OPENING_SECONDS + 9)).toBe(INTRO_SECONDS);
    expect(openingPosition(NaN)).toBe(0);
  });

  it("maps the tour's sequence positions onto the tour file and back", () => {
    expect(tourTime(INTRO_SECONDS)).toBe(0);
    expect(tourTime(0)).toBe(0); // before the gate is the gate
    expect(tourTime(STORY_END)).toBeCloseTo(TOUR_SECONDS);
    expect(tourTime(STORY_END + 10)).toBeCloseTo(TOUR_SECONDS);
    expect(TOUR_SECONDS).toBeCloseTo(TOUR_FRAMES / REEL_FPS);
    expect(tourPosition(0)).toBe(INTRO_SECONDS);
    expect(tourPosition(TOUR_FRAMES)).toBe(STORY_END);
    // Every stop is a whole frame, so the still under a caption is an exact frame of the file.
    for (const beat of BEATS) {
      const frame = tourTime(beat.at) * REEL_FPS;
      expect(frame).toBeCloseTo(Math.round(frame));
      expect(tourPosition(Math.round(frame))).toBeCloseTo(beat.at);
    }
  });

  it("gives a portrait screen the tall file and everything else the wide one", () => {
    expect(reelShape(412, 915)).toBe("tall");
    expect(reelShape(1440, 900)).toBe("wide");
    expect(reelShape(900, 900)).toBe("wide");
    expect(REEL_SIZE.wide.width / REEL_SIZE.wide.height).toBeCloseTo(16 / 9);
    expect(REEL_SIZE.tall.height / REEL_SIZE.tall.width).toBeCloseTo(16 / 9);
  });

  it("names one opening per start view and shape, and one tour per shape", () => {
    expect(openingPath("street", "tall")).toBe("/sawad/reel/zaitun-opening-street-tall.mp4");
    expect(tourPath("wide")).toBe("/sawad/reel/zaitun-tour-wide.mp4");
    const sources = reelSources("flight", "wide");
    expect(sources.opening).toMatch(/^\/sawad\/reel\/zaitun-opening-flight-wide(\.[0-9a-f]+)?\.mp4$/);
    for (const codec of REEL_CODECS) {
      for (const shape of ["wide", "tall"] as const) for (const src of Object.values(reelSources("aerial", shape, codec))) expect(reelFileOf(src)).toEqual({ codec, shape });
    }
    expect(tourPath("tall", "av1")).toBe("/sawad/reel/zaitun-tour-tall-av1.mp4");
    expect(sources.tour).toMatch(/^\/sawad\/reel\/zaitun-tour-wide(\.[0-9a-f]+)?\.mp4$/);
  });

  it("offers only the codecs a browser is sure of, best first, and H.264 always", () => {
    const answers = (table: Record<string, CanPlayTypeResult>) => ({ canPlayType: (type: string) => table[type] ?? "" });
    expect(playableCodecs(answers({ [REEL_TYPE.av1]: "probably", [REEL_TYPE.hevc]: "probably" }))).toEqual(["av1", "hevc", "h264"]);
    expect(playableCodecs(answers({ [REEL_TYPE.av1]: "maybe", [REEL_TYPE.hevc]: "probably" }))).toEqual(["hevc", "h264"]);
    expect(playableCodecs(answers({}))).toEqual(["h264"]);
    // The tour would rather have HEVC, the opening AV1; each takes the next that is left.
    expect(bestCodec("opening", ["av1", "hevc", "h264"])).toBe("av1");
    expect(bestCodec("tour", ["av1", "hevc", "h264"])).toBe("hevc");
    expect(bestCodec("tour", ["av1", "h264"])).toBe("av1");
    expect(bestCodec("tour", ["h264"])).toBe("h264");
    expect(bestCodec("tour", [])).toBeUndefined();
  });
});
