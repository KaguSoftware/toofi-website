// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCROLL_CUE_MS, ScrollCue } from "./ScrollCue";

describe("ScrollCue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the gesture and the line at once, hidden from assistive technology", () => {
    render(<ScrollCue label="Scroll to begin the tour" />);
    const cue = screen.getByTestId("scroll-cue");
    expect(cue.getAttribute("aria-hidden")).toBe("true");
    expect(cue.textContent).toContain("Scroll to begin the tour");
    expect(cue.querySelector(".xp__cue-finger")).not.toBeNull();
  });

  it("leaves after a couple of seconds, and not before", () => {
    render(<ScrollCue label="Scroll" />);
    act(() => void vi.advanceTimersByTime(SCROLL_CUE_MS - 1));
    expect(screen.queryByTestId("scroll-cue")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("scroll-cue")).toBeNull();
  });

  it("clears its timer when it is removed early", () => {
    const clear = vi.spyOn(window, "clearTimeout");
    render(<ScrollCue label="Scroll" />).unmount();
    expect(clear).toHaveBeenCalled();
  });
});
