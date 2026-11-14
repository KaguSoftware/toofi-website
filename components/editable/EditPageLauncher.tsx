"use client";

import { useSyncExternalStore, type SyntheticEvent } from "react";
import { CAN_EDIT_HINT_COOKIE, EDITING_HTML_ATTR, editEnableUrl } from "./paths";

/**
 * Floating "Edit page" button on public pages, shown only to signed-in editors.
 *
 * Deliberately tiny and static-friendly: no server data, no cookies() read on the
 * server — it checks a non-httpOnly hint cookie in the browser after hydration.
 * The cookie is UX only; /api/edit/enable performs the real authorization.
 */

const HINT_RE = new RegExp(`(?:^|;\\s*)${CAN_EDIT_HINT_COOKIE}=1(?:;|$)`);

function getSnapshot(): boolean {
  return HINT_RE.test(document.cookie) && !document.documentElement.hasAttribute(EDITING_HTML_ATTR);
}

function subscribe(onChange: () => void) {
  // Hide/show when the inline editor mounts/unmounts (it toggles an <html> attribute).
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: [EDITING_HTML_ATTR] });
  window.addEventListener("focus", onChange); // cookie may change in another tab (login/logout)
  return () => {
    mo.disconnect();
    window.removeEventListener("focus", onChange);
  };
}

const getServerSnapshot = () => false;

/** Point the link at the current path right before it's used (works across client navigations). */
function syncHref(e: SyntheticEvent<HTMLAnchorElement>) {
  e.currentTarget.href = editEnableUrl(window.location.pathname);
}

export function EditPageLauncher() {
  const show = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!show) return null;
  return (
    // A full document navigation is intended: it hits a Route Handler that sets the
    // Draft Mode cookie and redirects (next/link would try a client RSC fetch/prefetch).
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a
      href="/api/edit/enable"
      onPointerEnter={syncHref}
      onFocus={syncHref}
      onClick={syncHref}
      onAuxClick={syncHref}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 2147483000,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: 999,
        background: "#111",
        color: "#fff",
        font: "500 13px/1.2 system-ui, -apple-system, Segoe UI, sans-serif",
        textDecoration: "none",
        boxShadow: "0 4px 16px rgb(0 0 0 / 0.2)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
      Edit page
    </a>
  );
}
