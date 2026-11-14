import type { ReactNode } from "react";
import type { Editables } from "@/lib/content/editables";
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
      <SiteHeader g={g} />
      {children}
      <SiteFooter g={g} />
    </>
  );
}
