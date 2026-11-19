import type { ReactNode } from "react";
import type { Editables } from "@/lib/content/editables";
import type { Locale } from "@/lib/sawad/data";
import { dirOf, t } from "@/lib/sawad/i18n";
import { ErrorBoundary } from "@/components/monitoring/ErrorBoundary";
import { HtmlLang } from "./HtmlLang";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * Page chrome. `g` = editables bound to the "global" scope (keys namespaced per
 * locale, see globalKey()). The wrapper carries lang/dir so Arabic pages mirror.
 * Templates render <main id="main"> themselves; the skip link targets it.
 */
export function SiteShell({
  g,
  locale = "en",
  path = "/",
  children,
}: {
  g: Editables;
  locale?: Locale;
  path?: string;
  children: ReactNode;
}) {
  const dir = dirOf(locale);
  return (
    <div className="site" lang={locale} dir={dir}>
      <HtmlLang lang={locale} dir={dir} />
      <a href="#main" className="skip-link">
        {t(locale).site.skip}
      </a>
      <ErrorBoundary name="SiteHeader">
        <SiteHeader g={g} locale={locale} path={path} />
      </ErrorBoundary>
      <ErrorBoundary name="PageContent">{children}</ErrorBoundary>
      <ErrorBoundary name="SiteFooter">
        <SiteFooter g={g} locale={locale} />
      </ErrorBoundary>
    </div>
  );
}
