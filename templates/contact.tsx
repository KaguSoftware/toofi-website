import { Suspense } from "react";
import { Container, Section } from "@/components/ui";
import { ContactForm } from "@/components/sawad/ContactForm";
import { PageHead } from "@/components/sawad/PageHead";
import { GALLERIES } from "@/lib/sawad/data";
import { localeFromPath, t } from "@/lib/sawad/i18n";
import type { TemplateDefinition } from "./types";

/**
 * Contact. Editable keys: head.title, head.lead. The enquiry form (client, reads
 * ?residence= from the finder) and the three sales galleries.
 */
export const contactTemplate: TemplateDefinition = {
  id: "contact",
  name: "Contact",
  description: "Enquiry form and the sales galleries.",
  component: ({ c, page }) => {
    const locale = localeFromPath(page.slug);
    const d = t(locale).contact;
    return (
      <main id="main">
        <PageHead c={c} title={d.title} lead={d.lead} />
        <Section>
          <Container className="contact-grid">
            <Suspense fallback={<div className="skeleton" style={{ minHeight: "40rem" }} />}>
              <ContactForm locale={locale} />
            </Suspense>
            <section id="galleries" aria-labelledby="galleries-title">
              <h2 id="galleries-title" className="t-headline" style={{ marginBottom: "var(--space-4)" }}>
                {d.galleriesTitle}
              </h2>
              <ul className="galleries">
                {GALLERIES.map((gal) => (
                  <li key={gal.id}>
                    <h3 className="t-body" style={{ fontWeight: 600, color: "var(--fg)" }}>
                      {gal.name[locale]}
                    </h3>
                    <p>{gal.address[locale]}</p>
                    <dl>
                      <dt>{d.hoursLabel}</dt>
                      <dd>{gal.hours[locale]}</dd>
                      <dt>{d.phoneLabel}</dt>
                      <dd>{d.phonePending}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          </Container>
        </Section>
      </main>
    );
  },
};
