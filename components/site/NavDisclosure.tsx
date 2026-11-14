"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * The only client JS on public pages. Wraps the (server-rendered) nav so that below
 * 48rem it becomes a disclosure: a toggle button + a panel. At >= 48rem CSS shows the
 * panel inline and hides the toggle. `children` stay server components / editables.
 *
 * a11y: button has aria-expanded/aria-controls; closed panel is `visibility:hidden`
 * (not focusable, not announced); Escape closes and returns focus; link click closes.
 * Motion is CSS-only and interruptible: toggling mid-transition re-targets from the
 * current computed value.
 */
export function NavDisclosure({ children, label = "Menu" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nav-toggle__bars" aria-hidden="true" />
      </button>
      <div
        id={id}
        className="nav-panel"
        data-open={open}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {children}
      </div>
    </>
  );
}
