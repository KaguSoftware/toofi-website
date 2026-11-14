"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useEditorApi } from "./context";

type Props = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  children: ReactNode;
  /** Focus the first field when opened (default true). */
  autoFocus?: boolean;
  placement?: "below" | "above";
};

const GAP = 8;
const MARGIN = 12;

/**
 * Small non-modal dialog anchored to an element. Rendered into the editor root's
 * portal (position: fixed) so it never affects page layout. Closes on Escape and
 * outside pointer-down.
 */
export function Popover({ anchorRef, open, onClose, label, children, autoFocus = true, placement = "below" }: Props) {
  const { portal } = useEditorApi();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Position next to the anchor; follow scroll/resize. Writes styles directly (no re-render).
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    let frame = 0;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const roomBelow = vh - a.bottom;
      const below = placement === "below" ? roomBelow >= h + GAP || a.top < h + GAP : a.top < h + GAP;
      const top = below ? a.bottom + GAP : a.top - h - GAP;
      const left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, vw - w - MARGIN));
      el.style.top = `${Math.max(MARGIN, Math.min(top, vh - h - MARGIN))}px`;
      el.style.left = `${left}px`;
      el.style.visibility = "visible";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [open, anchorRef, placement]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || anchorRef.current?.contains(t))) {
        e.preventDefault();
        onCloseRef.current();
        anchorRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    if (autoFocus) ref.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchorRef, autoFocus]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="toofi-popover" style={{ visibility: "hidden" }}>
      {children}
    </div>,
    portal ?? document.body,
  );
}
