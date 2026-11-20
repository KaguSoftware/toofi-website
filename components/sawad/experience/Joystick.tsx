"use client";

import { useRef, useState, type PointerEvent, type RefObject } from "react";
import type { WalkInput } from "./walk";

export type JoystickProps = {
  /** The walk input the camera reads every frame; the stick writes `move` and `run`. */
  input: RefObject<WalkInput>;
  label: string;
};

/** Pushing the stick past this fraction of its travel runs instead of walking. */
export const RUN_AT = 0.92;

/** Stick position for a pointer at (dx, dy) pixels from the centre of a pad of `radius` pixels. */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  const r = Math.max(1, radius);
  const len = Math.hypot(dx, dy);
  const k = len > r ? r / len : 1;
  // Screen y grows downward; pushing up walks forward.
  return { x: (dx * k) / r, y: (-dy * k) / r };
}

/** Puts the stick's position into the shared walk input. */
function writeStick(input: WalkInput | null, x: number, y: number): void {
  if (!input) return;
  input.move.x = x;
  input.move.y = y;
  input.run = Math.hypot(x, y) >= RUN_AT;
}

/**
 * The touch joystick for walk mode. It only writes to the shared input: the camera rig does
 * the walking. Shown on touch screens; a keyboard walks with the arrow keys instead.
 */
export function Joystick({ input, label }: JoystickProps) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  const write = (x: number, y: number) => {
    setKnob({ x, y });
    writeStick(input.current, x, y);
  };

  const follow = (e: PointerEvent<HTMLDivElement>) => {
    const el = pad.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const v = stickVector(e.clientX - (box.left + box.width / 2), e.clientY - (box.top + box.height / 2), box.width / 2);
    write(v.x, v.y);
  };

  const release = (e: PointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    write(0, 0);
  };

  return (
    <div
      ref={pad}
      className="xp__stick"
      role="application"
      aria-label={label}
      onPointerDown={(e) => {
        active.current = e.pointerId;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        follow(e);
      }}
      onPointerMove={(e) => {
        if (active.current === e.pointerId) follow(e);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="xp__stick-knob" style={{ translate: `${knob.x * 34}px ${-knob.y * 34}px` }} aria-hidden="true" />
    </div>
  );
}
