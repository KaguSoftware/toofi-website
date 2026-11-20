// @vitest-environment jsdom
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Joystick, RUN_AT, stickVector } from "./Joystick";
import type { WalkInput } from "./walk";

const newInput = (): { current: WalkInput } => ({ current: { move: { x: 0, y: 0 }, run: false, look: { dx: 0, dy: 0 } } });

describe("stickVector", () => {
  it("is zero at the centre and treats up as forward", () => {
    expect(stickVector(0, 0, 40)).toEqual({ x: 0, y: -0 });
    const up = stickVector(0, -20, 40);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(0.5);
    expect(stickVector(20, 0, 40).x).toBeCloseTo(0.5);
  });

  it("clamps to the radius", () => {
    const v = stickVector(300, 400, 50);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(-0.8);
  });

  it("survives a zero radius", () => {
    const v = stickVector(10, 0, 0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });
});

describe("Joystick", () => {
  function setup() {
    const input = newInput();
    render(<Joystick input={input} label="Walking stick" />);
    const pad = screen.getByRole("application", { name: "Walking stick" });
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    return { input, pad };
  }
  const pointer = (pad: HTMLElement, type: "pointerDown" | "pointerMove" | "pointerUp", init: { pointerId: number; clientX?: number; clientY?: number }) => {
    const e = createEvent[type](pad, init);
    // jsdom has no PointerEvent: give the synthetic event the fields React reads.
    Object.defineProperty(e, "pointerId", { value: init.pointerId });
    Object.defineProperty(e, "clientX", { value: init.clientX ?? 0 });
    Object.defineProperty(e, "clientY", { value: init.clientY ?? 0 });
    fireEvent(pad, e);
  };

  it("writes move and run into the shared input while the pointer is down", () => {
    const { input, pad } = setup();
    pointer(pad, "pointerDown", { pointerId: 1, clientX: 50, clientY: 25 });
    expect(input.current.move.x).toBeCloseTo(0);
    expect(input.current.move.y).toBeCloseTo(0.5);
    expect(input.current.run).toBe(false);

    pointer(pad, "pointerMove", { pointerId: 1, clientX: 100, clientY: 50 });
    expect(input.current.move.x).toBeCloseTo(1);
    expect(input.current.move.y).toBeCloseTo(0);
    expect(input.current.run).toBe(true);
    expect(Math.hypot(input.current.move.x, input.current.move.y)).toBeGreaterThanOrEqual(RUN_AT);
  });

  it("zeroes the input on release", () => {
    const { input, pad } = setup();
    pointer(pad, "pointerDown", { pointerId: 1, clientX: 100, clientY: 0 });
    expect(input.current.run).toBe(true);
    pointer(pad, "pointerUp", { pointerId: 1 });
    expect(input.current.move).toEqual({ x: 0, y: 0 });
    expect(input.current.run).toBe(false);
  });

  it("ignores moves and releases from a second pointer", () => {
    const { input, pad } = setup();
    pointer(pad, "pointerDown", { pointerId: 1, clientX: 50, clientY: 0 });
    const held = { ...input.current.move };
    pointer(pad, "pointerMove", { pointerId: 2, clientX: 0, clientY: 100 });
    expect(input.current.move).toEqual(held);
    pointer(pad, "pointerUp", { pointerId: 2 });
    expect(input.current.move).toEqual(held);
  });

  it("ignores moves with no pointer down", () => {
    const { input, pad } = setup();
    pointer(pad, "pointerMove", { pointerId: 1, clientX: 100, clientY: 0 });
    expect(input.current.move).toEqual({ x: 0, y: 0 });
  });
});
