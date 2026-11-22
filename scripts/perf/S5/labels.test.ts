import { describe, expect, it } from "vitest";
import { commitSummary, labelSubscriber, levelChanges, longFrames, subscriberTable } from "./labels.mjs";

const desc = (props: string[], priority = 0, memoKeys: string[] = []) => ({ props, priority, memoKeys, found: true, name: "x", src: null });

describe("labelSubscriber", () => {
  it("names each frame callback of the experience from its owner's props", () => {
    expect(labelSubscriber(desc(["composer", "onError", "onFirstFrame", "onFrame"], 1))).toBe("RenderPass: draw (composer)");
    expect(labelSubscriber(desc(["apiRef", "input", "mode", "rig", "scroll", "view"]))).toBe("StoryRig: camera");
    expect(labelSubscriber(desc(["composerRef", "rig", "settings"], 0.8))).toBe("PostFX: lens and vignette");
    expect(labelSubscriber(desc(["margin", "model"], 0.5))).toBe("InstanceCulling: buildings");
    expect(labelSubscriber(desc(["daylight", "model", "rig", "shafts", "sunRise", "tier"]))).toBe("Daylighting: handover and dusk");
    expect(labelSubscriber(desc(["bounds", "flipflops", "onDecline"]))).toBe("PerformanceMonitor (drei)");
  });

  it("tells the plants from the life by priority, and the sky from the water by what they memoise", () => {
    expect(labelSubscriber(desc(["library", "tier"], 0.5))).toBe("SceneVegetation: wind and sort");
    expect(labelSubscriber(desc(["library", "tier"], 0, ["root,clock,figures,actors,movers,release"]))).toBe("SceneLife: people, cars, birds");
    expect(labelSubscriber(desc(["tier", "variant"], 0, ["mesh,material"]))).toBe("Sky: clock");
    expect(labelSubscriber(desc(["tier", "variant"], 0, ["river,pool,material"]))).toBe("Water: clock");
  });

  it("says what it could not place instead of guessing", () => {
    expect(labelSubscriber(desc(["foo"], 2))).toBe("unlabelled (priority 2; props foo)");
    expect(labelSubscriber(null)).toBe("unknown");
  });
});

describe("subscriberTable", () => {
  it("gives each subscriber's cost per frame and the time spent outside them", () => {
    const snap = {
      subs: [
        { id: 0, priority: 1, desc: desc(["composer", "onFirstFrame"], 1) },
        { id: 1, priority: 0.5, desc: desc(["library", "tier"], 0.5) },
      ],
      frames: [
        { frame: 1, cb: 5, subs: [3, 1] },
        { frame: 2, cb: 7, subs: [4, 2] },
        { frame: 3, cb: 6, subs: [3, 1] },
      ],
    };
    const t = subscriberTable(snap);
    expect(t.frames).toBe(3);
    expect(t.callback.median).toBe(6);
    expect(t.outsideSubscribers.median).toBe(1);
    expect(t.rows[0].label).toBe("RenderPass: draw (composer)");
    expect(t.rows[0].mean).toBeCloseTo(10 / 3);
    expect(t.rows[1].max).toBe(2);
  });

  it("adds up two subscribers with the same name", () => {
    const snap = { subs: [{ id: 0, priority: 0, desc: desc(["foo"]) }, { id: 1, priority: 0, desc: desc(["foo"]) }], frames: [{ frame: 1, cb: 3, subs: [1, 2] }] };
    expect(subscriberTable(snap).rows).toHaveLength(1);
    expect(subscriberTable(snap).rows[0].mean).toBe(3);
  });
});

describe("commitSummary", () => {
  it("counts commits per renderer per second and the components rendered most", () => {
    const snap = {
      commits: [
        { renderer: "react-dom", names: { "Hud{a}": 1, "Panel{b}": 2 } },
        { renderer: "react-dom", names: { "Hud{a}": 1 } },
        { renderer: "@react-three/fiber", names: { "Rig{c}": 1 } },
      ],
    };
    const s = commitSummary(snap, 2);
    expect(s.dom).toBe(2);
    expect(s.r3f).toBe(1);
    expect(s.domPerSecond).toBe(1);
    expect(s.top[0]).toEqual({ name: "dom:Hud{a}", renders: 2 });
  });
});

describe("longFrames", () => {
  it("lists the frames over budget with the biggest subscriber in each", () => {
    const snap = { subs: [{ id: 0, priority: 0.5, desc: desc(["library", "tier"], 0.5) }], frames: [{ frame: 7, cb: 30, subs: [25] }], commits: [{ frame: 7 }] };
    const rig = [
      { frame: 6, interval: 16.7 },
      { frame: 7, interval: 33.4, cpuMs: 31, renderMs: 4, passes: 31, dpr: 1.5 },
    ];
    const out = longFrames(snap, rig);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ frame: 7, callback: 30, commits: 1, top: { label: "SceneVegetation: wind and sort", ms: 25 } });
  });
});

describe("levelChanges", () => {
  it("finds the frames where the passes per frame change", () => {
    expect(levelChanges([{ frame: 1, passes: 31 }, { frame: 2, passes: 31 }, { frame: 3, passes: 43 }, { frame: 4, passes: 43 }])).toEqual([{ frame: 3, from: 31, to: 43 }]);
    expect(levelChanges([])).toEqual([]);
  });
});
