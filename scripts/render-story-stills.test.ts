import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BEATS } from "../components/sawad/experience/beats";
import { STORY_STILLS } from "./render-story-stills.mjs";

describe("story stills", () => {
  it("renders one still per beat, at the frame the beat's panel is centred on", () => {
    expect(STORY_STILLS).toEqual(Object.fromEntries(BEATS.map((b) => [b.id, b.at])));
  });

  it("has shipped every still the Home template points at", () => {
    for (const beat of BEATS) {
      const file = fileURLToPath(new URL(`../public/sawad/story/zaitun-${beat.id}.jpg`, import.meta.url));
      expect(existsSync(file), file).toBe(true);
    }
  });
});
