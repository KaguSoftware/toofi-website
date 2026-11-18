import type { ReactNode } from "react";
import type { Editables } from "@/lib/content/editables";
import { ErrorBoundary } from "@/components/monitoring/ErrorBoundary";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Page chrome. `g` = editables bound to the "global" scope.
 * Global keys: site.name, nav[].link, footer.tagline, social[].link, footer.note.
 * Templates render <main id="main"> themselves; the skip link targets it.
 */
export function SiteShell({ g, children }: { g: Editables; children: ReactNode }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ErrorBoundary name="SiteHeader">
        <SiteHeader g={g} />
      </ErrorBoundary>
      <ErrorBoundary name="PageContent">{children}</ErrorBoundary>
      <ErrorBoundary name="SiteFooter">
        <SiteFooter g={g} />
      </ErrorBoundary>
    </>
  );
}
