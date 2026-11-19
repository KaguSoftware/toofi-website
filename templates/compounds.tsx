import Image from "next/image";
import Link from "next/link";
import { Container, Section } from "@/components/ui";
import { CompoundFacts } from "@/components/sawad/CompoundFacts";
import { PageHead } from "@/components/sawad/PageHead";
import { COMPOUNDS, OTHER_HOLDINGS, RESIDENCE_TYPES, TOTALS, TYPE_ORDER, fromPrice, residencesIn } from "@/lib/sawad/data";
import { countHectares, countHomes, formatArea, formatNumber, formatPercent, formatUsd } from "@/lib/sawad/format";
import { localeFromPath, localizedPath, ROUTES, t } from "@/lib/sawad/i18n";
import type { TemplateDefinition } from "./types";

/**
 * Compounds. Editable keys: head.title, head.lead. A portfolio table, then one
 * full-bleed profile per compound, each drenched in its own ground colour.
 */
export const compoundsTemplate: TemplateDefinition = {
  id: "compounds",
  name: "Compounds",
  description: "Portfolio table and a full profile of each compound.",
  component: ({ c, page }) => {
    const locale = localeFromPath(page.slug);
    const d = t(locale);
    const finder = localizedPath(ROUTES.residences, locale);
    return (
      <main id="main">
        <PageHead c={c} title={d.compounds.title} lead={d.compounds.lead} />

        <Section>
          <Container>
            <h2 id="portfolio-title" className="t-headline" style={{ marginBottom: "var(--space-6)" }}>
              {d.compounds.tableCaption}
            </h2>
            <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="portfolio-title">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{d.facts.holding}</th>
                    <th scope="col">{d.facts.location}</th>
                    <th scope="col" className="num">
                      {d.facts.site}
                    </th>
                    <th scope="col" className="num">
                      {d.facts.landscape}
                    </th>
                    <th scope="col" className="num">
                      {d.facts.homes}
                    </th>
                    <th scope="col">{d.facts.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPOUNDS.map((cp) => (
                    <tr key={cp.id}>
                      <th scope="row">
                        <a href={`#${cp.id}`} className="link-subtle">
                          {cp.name[locale]}
                        </a>
                      </th>
                      <td>{cp.location[locale]}</td>
                      <td className="num">{countHectares(cp.siteHa, locale)}</td>
                      <td className="num">{formatPercent(cp.landscapePct, locale)}</td>
                      <td className="num">{formatNumber(cp.phaseOne.villas + cp.phaseOne.apartments, locale)}</td>
                      <td>
                        <span className="status" data-status={cp.status === "coming-soon" ? "coming-soon" : "selling"}>
                          {cp.status === "coming-soon" ? d.facts.comingSoon : d.facts.selling}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {OTHER_HOLDINGS.map((h) => (
                    <tr key={h.id}>
                      <th scope="row">{h.name[locale]}</th>
                      <td>{h.location[locale]}</td>
                      <td className="num">–</td>
                      <td className="num">–</td>
                      <td className="num">{h.homes === null ? "–" : formatNumber(h.homes, locale)}</td>
                      <td>
                        {h.status[locale]}
                        <span className="t-small" style={{ display: "block" }}>
                          {h.note[locale]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={4}>
                      {d.compounds.total}
                    </th>
                    <td className="num">{formatNumber(TOTALS.residences, locale)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Container>
        </Section>

        {COMPOUNDS.map((cp, i) => {
          const coming = cp.status === "coming-soon";
          const homes = residencesIn(cp.id);
          const types = TYPE_ORDER.filter((id) => homes.some((r) => r.type === id));
          return (
            <section key={cp.id} id={cp.id} className="profile on-dark" data-variant={cp.variant} aria-labelledby={`${cp.id}-title`}>
              <Container className="profile__grid">
                <div className="profile__media">
                  <Image src={cp.image.src} alt={cp.image.alt[locale]} width={1600} height={900} sizes="(min-width: 64rem) 55vw, 100vw" />
                </div>
                <div className="profile__body">
                  <p className="profile__index">
                    {formatNumber(i + 1, locale)} / {formatNumber(COMPOUNDS.length, locale)}
                  </p>
                  <h2 id={`${cp.id}-title`} className="t-title">
                    {cp.name[locale]}
                  </h2>
                  <p>
                    {cp.location[locale]} ·{" "}
                    <span className="status" data-status={coming ? "coming-soon" : "selling"}>
                      {coming ? d.facts.comingSoon : d.facts.selling}
                    </span>
                  </p>
                  <p className="t-body">{cp.summary[locale]}</p>
                  <CompoundFacts compound={cp} locale={locale} />
                  <div>
                    <Link href={`${finder}?compound=${cp.id}`} className="link-arrow">
                      {coming ? d.compounds.registerCta : d.compounds.profileCta}
                      <span className="visually-hidden">: {cp.name[locale]}</span>
                    </Link>
                  </div>
                </div>
              </Container>
              <Container>
                <div
                  className="table-scroll"
                  style={{ marginTop: "var(--space-12)" }}
                  tabIndex={0}
                  role="region"
                  aria-label={`${d.facts.types}: ${cp.name[locale]}`}
                >
                  <table className="table">
                    <caption className="t-small" style={{ color: "var(--on-night-muted)" }}>
                      {d.facts.types} · {countHomes(homes.length, locale)} · {d.compounds.typesNote}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{d.finder.kind}</th>
                        <th scope="col" className="num">
                          {d.finder.bedrooms}
                        </th>
                        <th scope="col" className="num">
                          {d.finder.built}
                        </th>
                        <th scope="col" className="num">
                          {d.finder.land}
                        </th>
                        <th scope="col" className="num">
                          {d.facts.homes}
                        </th>
                        <th scope="col" className="num">
                          {d.facts.fromPrice}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {types.map((id) => {
                        const rt = RESIDENCE_TYPES[id];
                        const price = fromPrice(cp.id, id);
                        return (
                          <tr key={id}>
                            <th scope="row">{rt.name[locale]}</th>
                            <td className="num">{formatNumber(rt.bedrooms, locale)}</td>
                            <td className="num">{formatArea(rt.builtM2, locale)}</td>
                            <td className="num">{rt.landM2 ? formatArea(rt.landM2, locale) : "–"}</td>
                            <td className="num">{formatNumber(homes.filter((r) => r.type === id).length, locale)}</td>
                            <td className="num">{price ? formatUsd(price, locale) : "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Container>
            </section>
          );
        })}
      </main>
    );
  },
};
