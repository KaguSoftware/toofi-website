"use client";

import { type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type { ScrollState } from "./types";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Marks the root once the scroll driver runs: from then the stage places the captions (experience.css). */
function markReady(el: HTMLElement, ready: boolean): void {
  if (ready) el.dataset.scroll = "ready";
  else delete el.dataset.scroll;
}

function setProgress(scroll: ScrollState | null, progress: number): void {
  if (scroll) scroll.progress = progress;
}

export type StoryScrollProps = {
  /** The experience's root element: the panels and captions are found inside it. */
  root: RefObject<HTMLElement | null>;
  /** Written with the story's scroll progress, 0 to 1. */
  scroll: RefObject<ScrollState>;
  /** Called whenever the progress changes (the canvas may be drawing on demand). */
  onProgress?: (progress: number) => void;
};

/** Where in the viewport a beat's panel takes over from the one before it. */
export const HANDOVER = "62%";
/** The last caption starts to leave a little before the stage unpins (its panel's foot at the screen's foot). */
export const LAST_CAPTION_END = "bottom 115%";
/** The captions' overlap group: a caption coming in ends the others' fades. */
export const CAPTIONS = "captions";

/**
 * Ties the story to the scroll (GSAP ScrollTrigger). Each beat's panel adds one fifth to the
 * progress as it rises to fill the screen, which is what the camera follows; and each beat's
 * caption fades in while its panel holds the screen and out when the next one takes over.
 * Loaded only when the live story runs, so the stills fallback never downloads GSAP.
 */
export default function StoryScroll({ root, scroll, onProgress }: StoryScrollProps) {
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const panels = gsap.utils.toArray<HTMLElement>("[data-beat]", el);
      if (!panels.length) return;
      const local = panels.map(() => 0);
      const publish = () => {
        const progress = local.reduce((a, b) => a + b, 0) / panels.length;
        setProgress(scroll.current, progress);
        onProgress?.(progress);
      };

      panels.forEach((panel, i) => {
        // The camera: this panel's share of the progress, from entering the screen to filling it.
        ScrollTrigger.create({
          trigger: panel,
          start: "top bottom",
          end: "top top",
          onUpdate: (self) => {
            local[i] = self.progress;
            publish();
          },
          onRefresh: (self) => {
            local[i] = self.progress;
            publish();
          },
        });

        // The caption: its lines rise and fade in one after another, and leave together. Only one
        // caption shows at a time, however fast the scroll: a fast pass finishes each fade at once
        // (fastScrollEnd), and a caption coming in ends the ones before it (preventOverlaps). The
        // last one leaves when the stage does, never floating over the page below.
        const lines = gsap.utils.toArray<HTMLElement>("[data-caption] > *", panel);
        const caption = panel.querySelector<HTMLElement>("[data-caption]");
        if (!caption || !lines.length) return;
        const last = i === panels.length - 1;
        gsap.set(caption, { autoAlpha: 0 });
        gsap
          .timeline({
            defaults: { ease: "power3.out" },
            scrollTrigger: {
              trigger: panel,
              start: `top ${HANDOVER}`,
              end: last ? LAST_CAPTION_END : `bottom ${HANDOVER}`,
              toggleActions: "play reverse play reverse",
              fastScrollEnd: true,
              preventOverlaps: CAPTIONS,
            },
          })
          .to(caption, { autoAlpha: 1, duration: 0.3 }, 0)
          .from(lines, { autoAlpha: 0, y: 26, duration: 0.9, stagger: 0.08 }, 0);
      });

      markReady(el, true);
      ScrollTrigger.refresh();
      return () => {
        markReady(el, false);
        setProgress(scroll.current, 0);
      };
    },
    { scope: root, dependencies: [] },
  );
  return null;
}
