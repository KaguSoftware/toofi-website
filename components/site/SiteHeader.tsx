import Link from "next/link";
import type { Editables } from "@/lib/content/editables";
import type { Locale } from "@/lib/sawad/data";
import { basePath, globalKey, localizedPath, ROUTES, t } from "@/lib/sawad/i18n";
import { Container, buttonClass } from "@/components/ui";
import { NavDisclosure } from "./NavDisclosure";

const NAV = ["compounds", "whatWeDo", "story", "contact"] as const;

/**
 * Solid cream header (no translucency). The site's single main action, Find a
 * residence, is the only filled button. In edit mode the brand is an editable
 * island, so it is never wrapped in a link (that would swallow clicks).
 */
export function SiteHeader({ g, locale = "en", path = "/" }: { g: Editables; locale?: Locale; path?: string }) {
  const d = t(locale);
  const current = basePath(path);
  const other: Locale = locale === "ar" ? "en" : "ar";
  const nameKey = globalKey(locale, "site.name");
  const brandInner = (
    <>
      <g.Text k={nameKey} fallback={d.site.name} className="site-brand__name" />
      {/* The space keeps the visible words ("Sawad Holding") inside the link's accessible name; the flex gap sets the look. */}{" "}
      <span className="site-brand__holding">{d.site.holding}</span>
    </>
  );
  const isCurrent = (route: string) => (route === "/" ? current === "/" : current === route || current.startsWith(route + "/"));

  return (
    <header className="site-header">
      <Container className="site-header__inner">
        {g.editing ? (
          <span className="site-brand">{brandInner}</span>
        ) : (
          <Link href={localizedPath("/", locale)} className="site-brand" aria-label={d.site.homeLabel}>
            {brandInner}
          </Link>
        )}
        <nav aria-label={d.site.primaryNav}>
          <NavDisclosure label={d.site.menu}>
            <ul className="nav-list">
              {NAV.map((key) => (
                <li key={key}>
                  <Link href={localizedPath(ROUTES[key], locale)} aria-current={isCurrent(ROUTES[key]) ? "page" : undefined}>
                    {d.nav[key]}
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={localizedPath(ROUTES.residences, locale)}
              className={`${buttonClass({ variant: "primary", size: "sm" })} nav-cta`}
              aria-current={isCurrent(ROUTES.residences) ? "page" : undefined}
            >
              {d.nav.residences}
            </Link>
            <a href={localizedPath(path, other)} className="nav-lang" lang={other} hrefLang={other} aria-label={d.site.switchLabel}>
              {d.site.switchTo}
            </a>
          </NavDisclosure>
        </nav>
      </Container>
    </header>
  );
}
