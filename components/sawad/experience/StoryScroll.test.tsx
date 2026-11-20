// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createRef, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Trigger = { trigger: Element; start: string; end: string; onUpdate?: (s: { progress: number }) => void; onRefresh?: (s: { progress: number }) => void };
const g = vi.hoisted(() => ({
  triggers: [] as unknown[],
  timelines: [] as Array<{ config: Record<string, unknown>; calls: Array<[string, ...unknown[]]> }>,
  set: vi.fn(),
  registerPlugin: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("gsap", () => {
  const timeline = (config: Record<string, unknown>) => {
    const tl = { config, calls: [] as Array<[string, ...unknown[]]> };
    g.timelines.push(tl);
    const chain = {
      to: (...a: unknown[]) => (tl.calls.push(["to", ...a]), chain),
      from: (...a: unknown[]) => (tl.calls.push(["from", ...a]), chain),
    };
    return chain;
  };
  const gsap = {
    registerPlugin: g.registerPlugin,
    set: g.set,
    timeline,
    utils: { toArray: (sel: string, root: Element) => Array.from(root.querySelectorAll(sel)) },
  };
  return { default: gsap, gsap };
});
vi.mock("gsap/ScrollTrigger", () => ({
  ScrollTrigger: {
    create: (cfg: Trigger) => g.triggers.push(cfg),
    refresh: g.refresh,
  },
}));
vi.mock("@gsap/react", () => ({
  useGSAP: (fn: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => fn(), []);
  },
}));

import StoryScroll from "./StoryScroll";

const triggers = () => g.triggers as Trigger[];

function mountRoot(beats: number, withCaption = true) {
  const root = document.createElement("section");
  for (let i = 0; i < beats; i++) {
    const li = document.createElement("div");
    li.dataset.beat = `b${i}`;
    if (withCaption) {
      const cap = document.createElement("div");
      cap.dataset.caption = "";
      cap.innerHTML = "<p>a</p><div>b</div>";
      li.appendChild(cap);
    }
    root.appendChild(li);
  }
  document.body.appendChild(root);
  return { root, ref: { current: root } };
}

beforeEach(() => {
  g.triggers.length = 0;
  g.timelines.length = 0;
  g.set.mockClear();
  g.refresh.mockClear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("StoryScroll", () => {
  it("creates one progress trigger per beat panel and marks the root ready", () => {
    const { root, ref } = mountRoot(5);
    render(<StoryScroll root={ref} scroll={{ current: { progress: 0 } }} />);
    expect(triggers()).toHaveLength(5);
    const panels = Array.from(root.querySelectorAll("[data-beat]"));
    triggers().forEach((t, i) => {
      expect(t.trigger).toBe(panels[i]);
      expect(t.start).toBe("top bottom");
      expect(t.end).toBe("top top");
    });
    expect(root.dataset.scroll).toBe("ready");
    expect(g.refresh).toHaveBeenCalled();
  });

  it("publishes the mean of the panels' local progress", () => {
    const { ref } = mountRoot(5);
    const scroll = { current: { progress: 0 } };
    const onProgress = vi.fn();
    render(<StoryScroll root={ref} scroll={scroll} onProgress={onProgress} />);
    triggers()[0].onUpdate!({ progress: 1 });
    expect(scroll.current.progress).toBeCloseTo(0.2);
    expect(onProgress).toHaveBeenLastCalledWith(expect.closeTo(0.2));
    triggers()[1].onUpdate!({ progress: 0.5 });
    expect(scroll.current.progress).toBeCloseTo(0.3);
    triggers()[2].onRefresh!({ progress: 1 });
    expect(scroll.current.progress).toBeCloseTo(0.5);
    expect(onProgress).toHaveBeenLastCalledWith(expect.closeTo(0.5));
  });

  it("gives each caption a scroll-toggled timeline", () => {
    const { root, ref } = mountRoot(3);
    render(<StoryScroll root={ref} scroll={{ current: { progress: 0 } }} />);
    expect(g.timelines).toHaveLength(3);
    const caption = root.querySelector("[data-caption]");
    expect(g.set).toHaveBeenCalledWith(caption, { autoAlpha: 0 });
    for (const tl of g.timelines) {
      const st = tl.config.scrollTrigger as { toggleActions: string; start: string; end: string };
      expect(st.toggleActions).toBe("play reverse play reverse");
      expect(st.start).toBe("top 62%");
      expect(st.end).toBe("bottom 62%");
      expect(tl.calls.map((c) => c[0])).toEqual(["to", "from"]);
    }
  });

  it("skips the caption timeline for a panel without a caption", () => {
    const { ref } = mountRoot(2, false);
    render(<StoryScroll root={ref} scroll={{ current: { progress: 0 } }} />);
    expect(triggers()).toHaveLength(2);
    expect(g.timelines).toHaveLength(0);
  });

  it("removes the marker and resets progress on cleanup", () => {
    const { root, ref } = mountRoot(2);
    const scroll = { current: { progress: 0 } };
    const view = render(<StoryScroll root={ref} scroll={scroll} />);
    triggers()[0].onUpdate!({ progress: 1 });
    expect(scroll.current.progress).toBeGreaterThan(0);
    view.unmount();
    expect(root.dataset.scroll).toBeUndefined();
    expect(scroll.current.progress).toBe(0);
  });

  it("creates nothing without panels or without a root", () => {
    const { root, ref } = mountRoot(0);
    render(<StoryScroll root={ref} scroll={{ current: { progress: 0 } }} />);
    expect(triggers()).toHaveLength(0);
    expect(root.dataset.scroll).toBeUndefined();
    render(<StoryScroll root={createRef<HTMLElement>()} scroll={{ current: { progress: 0 } }} />);
    expect(triggers()).toHaveLength(0);
  });

  it("registers the plugins", () => {
    expect(g.registerPlugin).toHaveBeenCalled();
  });
});
