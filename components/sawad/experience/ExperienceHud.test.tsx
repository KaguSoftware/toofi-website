// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperienceHud, type ExperienceHudProps } from "./ExperienceHud";
import type { ExperienceLabels } from "./types";

const labels: ExperienceLabels = {
  region: "Tour",
  loading: "Loading",
  stills: "Stills",
  load3d: "Explore in 3D",
  pause: "Pause",
  play: "Play",
  skipIntro: "Skip the intro",
  scrollHint: "Scroll to begin",
  explore: "Explore the compound",
  backToStory: "Back to the tour",
  orbit: "Orbit",
  walk: "Walk",
  exploreMode: "Way of exploring",
  toDusk: "Show dusk",
  toDay: "Show day",
  soundOn: "Sound on",
  soundOff: "Sound off",
  musicCredit: "Music: the piece, by its composer",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  reset: "Reset view",
  orbitHint: "Drag to orbit",
  walkHint: "Use the arrow keys",
  joystick: "Stick",
  panelTitle: "Home",
  close: "Close",
  inFinder: "Finder",
  beatsLabel: "Beats",
};

function setup(over: Partial<ExperienceHudProps> = {}) {
  const fns = {
    onPlaying: vi.fn(),
    onDaylight: vi.fn(),
    onSound: vi.fn(),
    onMode: vi.fn(),
    onBegin: vi.fn(),
    onZoom: vi.fn(),
    onReset: vi.fn(),
  };
  const props: ExperienceHudProps = {
    labels,
    mode: "story",
    daylight: "day",
    sound: false,
    soundAvailable: true,
    playing: true,
    introDone: false,
    prompt: true,
    hint: false,
    exploreButton: { current: null },
    backButton: { current: null },
    ...fns,
    ...over,
  };
  const view = render(<ExperienceHud {...props} />);
  return { ...fns, ...view, props };
}

afterEach(cleanup);

describe("ExperienceHud in the story", () => {
  it("offers pause, dusk, sound and explore, and fires each callback", () => {
    const h = setup();
    const pause = screen.getByRole("button", { name: "Pause" });
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pause);
    expect(h.onPlaying).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Show dusk" }));
    expect(h.onDaylight).toHaveBeenCalledWith("dusk");
    fireEvent.click(screen.getByRole("button", { name: "Sound on" }));
    expect(h.onSound).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Explore the compound" }));
    expect(h.onMode).toHaveBeenCalledWith("orbit");
  });

  it("names the toggles for their other state", () => {
    const h = setup({ playing: false, daylight: "dusk", sound: true });
    const play = screen.getByRole("button", { name: "Play" });
    expect(play.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(play);
    expect(h.onPlaying).toHaveBeenCalledWith(true);
    const day = screen.getByRole("button", { name: "Show day" });
    expect(day.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(day);
    expect(h.onDaylight).toHaveBeenCalledWith("day");
    const off = screen.getByRole("button", { name: "Sound off" });
    expect(off.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(off);
    expect(h.onSound).toHaveBeenCalledWith(false);
  });

  it("hides the sound button where sound is unavailable", () => {
    setup({ soundAvailable: false });
    expect(screen.queryByRole("button", { name: /Sound/ })).toBeNull();
  });

  it("credits the music while the sound is on, and only then", () => {
    const h = setup();
    expect(screen.queryByRole("link", { name: /Music/ })).toBeNull();
    h.rerender(<ExperienceHud {...h.props} sound />);
    const credit = screen.getByRole("link", { name: "Music: the piece, by its composer" });
    expect(credit.getAttribute("href")).toBe("https://www.scottbuckley.com.au");
    expect(credit.getAttribute("target")).toBe("_blank");
    expect(credit.getAttribute("rel")).toBe("noreferrer");
    h.rerender(<ExperienceHud {...h.props} sound soundAvailable={false} />);
    expect(screen.queryByRole("link", { name: /Music/ })).toBeNull();
  });

  it("keeps the credit on screen while exploring", () => {
    setup({ mode: "orbit", sound: true });
    expect(screen.getByRole("link", { name: "Music: the piece, by its composer" })).toBeTruthy();
    cleanup();
    setup({ mode: "walk", sound: true });
    expect(screen.getByRole("link", { name: "Music: the piece, by its composer" })).toBeTruthy();
    cleanup();
    setup({ mode: "walk" });
    expect(screen.queryByRole("link", { name: /Music/ })).toBeNull();
  });

  it("shows the skip prompt before the intro ends and the scroll hint after", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "Skip the intro" }));
    expect(h.onBegin).toHaveBeenCalledTimes(1);
    h.rerender(<ExperienceHud {...h.props} introDone />);
    expect(screen.queryByRole("button", { name: "Skip the intro" })).toBeNull();
    expect(screen.getByRole("button", { name: "Scroll to begin" })).toBeTruthy();
  });

  it("hides the prompt when prompt is false", () => {
    setup({ prompt: false });
    expect(screen.queryByRole("button", { name: "Skip the intro" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scroll to begin" })).toBeNull();
  });
});

describe("ExperienceHud while exploring", () => {
  it("shows back, the mode group and orbit tools, and fires them", () => {
    const h = setup({ mode: "orbit", hint: true });
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip the intro" })).toBeNull();
    const group = screen.getByRole("group", { name: "Way of exploring" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("button", { name: "Orbit" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Walk" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Drag to orbit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(h.onZoom).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(h.onZoom).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(h.onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Walk" }));
    expect(h.onMode).toHaveBeenLastCalledWith("walk");
    fireEvent.click(screen.getByRole("button", { name: "Back to the tour" }));
    expect(h.onMode).toHaveBeenLastCalledWith("story");
    fireEvent.click(screen.getByRole("button", { name: "Show dusk" }));
    expect(h.onDaylight).toHaveBeenCalledWith("dusk");
  });

  it("drops the zoom tools and shows the walk hint in walk mode", () => {
    setup({ mode: "walk", hint: true });
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset view" })).toBeNull();
    expect(screen.getByRole("button", { name: "Walk" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Use the arrow keys")).toBeTruthy();
  });

  it("shows no hint when hint is false", () => {
    setup({ mode: "orbit", hint: false });
    expect(screen.queryByText("Drag to orbit")).toBeNull();
  });
});
