import Link from "next/link";
import type { Editables } from "@/lib/content/editables";
import { GALLERIES, type Locale } from "@/lib/sawad/data";
import { globalKey, localizedPath, ROUTES, t } from "@/lib/sawad/i18n";
import { Container } from "@/components/ui";

const LINKS = ["residences", "compounds", "whatWeDo", "story", "contact"] as const;

/** Night footer. Global keys (per locale): site.name, footer.tagline, footer.note. */
export function SiteFooter({ g, locale = "en" }: { g: Editables; locale?: Locale }) {
  const d = t(locale);
  return (
    <footer className="site-footer on-dark">
      <Container>
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <p className="site-brand">
              <g.Text k={globalKey(locale, "site.name")} fallback={d.site.name} className="site-brand__name" />
              <span className="site-brand__holding">{d.site.holding}</span>
            </p>
            <g.Text
              k={globalKey(locale, "footer.tagline")}
              as="p"
              fallback={d.site.tagline}
              className="site-footer__tagline"
              multiline
            />
          </div>
          <nav aria-label={d.site.footerExplore}>
            <h2 className="site-footer__heading">{d.site.footerExplore}</h2>
            <ul className="site-footer__list">
              {LINKS.map((key) => (
                <li key={key}>
                  <Link href={localizedPath(ROUTES[key], locale)}>{d.nav[key]}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="site-footer__heading">{d.site.footerGalleries}</h2>
            <ul className="site-footer__list site-footer__galleries">
              {GALLERIES.map((gal) => (
                <li key={gal.id}>
                  <strong>{gal.name[locale]}</strong>
                  {gal.address[locale]}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="site-footer__bottom">
          <g.Text k={globalKey(locale, "footer.note")} as="p" fallback={d.site.note} />
        </div>
      </Container>
    </footer>
  );
}
