import Link from "next/link";
import { Container, Section } from "@/components/ui";
import { PageHead } from "@/components/sawad/PageHead";
import { OPERATIONS, PARTNERS, PROCESS } from "@/lib/sawad/content";
import { formatNumber } from "@/lib/sawad/format";
import { localeFromPath, localizedPath, ROUTES, t } from "@/lib/sawad/i18n";
import type { TemplateDefinition } from "./types";

/**
 * What we do. Editable keys: head.title, head.lead, ops.title, process.title,
 * process.lead, partners.title, partners.lead.
 */
export const whatWeDoTemplate: TemplateDefinition = {
  id: "what-we-do",
  name: "What we do",
  description: "Five operations, the buying process and partner routes.",
  component: ({ c, page }) => {
    const locale = localeFromPath(page.slug);
    const d = t(locale).work;
    const contact = localizedPath(ROUTES.contact, locale);
    const num = (i: number) => formatNumber(i + 1, locale).padStart(2, locale === "ar" ? "٠" : "0");
    return (
      <main id="main">
        <PageHead c={c} title={d.title} lead={d.lead} />

        <Section aria-labelledby="ops-title">
          <Container>
            <div className="section-head">
              <div id="ops-title">
                <c.Text k="ops.title" as="h2" className="t-title" fallback={d.opsTitle} />
              </div>
            </div>
            <ol className="sequence">
              {OPERATIONS.map((op, i) => (
                <li key={op.id} className="sequence__item">
                  <span className="sequence__num" aria-hidden="true">
                    {num(i)}
                  </span>
                  <h3 className="sequence__title">{op.title[locale]}</h3>
                  <p className="sequence__body">{op.body[locale]}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>

        <Section tone="subtle" aria-labelledby="process-title">
          <Container>
            <div className="section-head section-head--split">
              <div id="process-title">
                <c.Text k="process.title" as="h2" className="t-title" fallback={d.processTitle} />
              </div>
              <c.Text k="process.lead" as="p" className="t-lead" fallback={d.processLead} />
            </div>
            <ol className="process">
              {PROCESS.map((step, i) => (
                <li key={step.id} className="process__step">
                  <span className="process__dot" aria-hidden="true">
                    {formatNumber(i + 1, locale)}
                  </span>
                  <h3 className="process__title">{step.title[locale]}</h3>
                  <p>{step.body[locale]}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>

        <Section aria-labelledby="partners-title">
          <Container>
            <div className="section-head section-head--split">
              <div id="partners-title">
                <c.Text k="partners.title" as="h2" className="t-title" fallback={d.partnersTitle} />
              </div>
              <c.Text k="partners.lead" as="p" className="t-lead" fallback={d.partnersLead} />
            </div>
            <ul className="ledger">
              {PARTNERS.map((p) => (
                <li key={p.id} className="ledger__row">
                  <h3 className="t-headline">{p.title[locale]}</h3>
                  <p className="t-body">{p.body[locale]}</p>
                  <Link href={`${contact}?interest=${p.interest}`} className="link-arrow">
                    {p.cta[locale]}
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      </main>
    );
  },
};
