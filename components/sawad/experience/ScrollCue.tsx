"use client";

import { useEffect, useState } from "react";

/** How long the cue stays, fades included. */
export const SCROLL_CUE_MS = 2800;

export type ScrollCueProps = {
  /** The line under the gesture ("Scroll to begin the tour"). */
  label: string;
};

/**
 * Shown for a couple of seconds once the opening has landed on the gate: the picture dims and a
 * finger drags upward along a line, so the visitor knows it is their turn to scroll. It never takes
 * a click or a scroll (pointer-events: none), and it is decoration only: the prompt in the corner
 * already carries the words for assistive technology.
 */
export function ScrollCue({ label }: ScrollCueProps) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), SCROLL_CUE_MS);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div className="xp__cue" data-testid="scroll-cue" aria-hidden="true">
      <div className="xp__cue-gesture">
        <span className="xp__cue-track" />
        <span className="xp__cue-finger" />
        <svg className="xp__cue-arrow" width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12l8-8 8 8" />
        </svg>
      </div>
      <p className="xp__cue-label">{label}</p>
    </div>
  );
}
