import Image from "next/image";
import { Container, Section } from "@/components/ui";
import { PageHead } from "@/components/sawad/PageHead";
import { LEADERSHIP, PRINCIPLES, TIMELINE } from "@/lib/sawad/content";
import { sceneImage } from "@/lib/sawad/data";
import { formatNumber } from "@/lib/sawad/format";
import { localeFromPath, t } from "@/lib/sawad/i18n";
import type { TemplateDefinition } from "./types";

/**
 * Our story. Editable keys: head.title, head.lead, timeline.title,
 * principles.title, leadership.title, leadership.note.
 * Timeline reads oldest first: it is a story.
 */
export const storyTemplate: TemplateDefinition = {
  id: "story",
  name: "Our story",
  description: "Company timeline, guiding principles and leadership.",
  component: ({ c, page }) => {
    const locale = localeFromPath(page.slug);
    const d = t(locale).story;
    return (
      <main id="main">
        <PageHead c={c} title={d.title} lead={d.lead} />

        <Section aria-labelledby="timeline-title">
          <Container>
            <div className="section-head section-head--split">
              <div id="timeline-title">
                <c.Text k="timeline.title" as="h2" className="t-title" fallback={d.timelineTitle} />
              </div>
              <div className="visit__media">
                <Image
                  src={sceneImage("dijla", "aerial")}
                  alt={locale === "ar" ? "بستان دجلة من الأعلى عند الغروب، بين النخيل وعلى ضفة النهر" : "Bustan Dijla from above at sunset, among palms on the riverbank"}
                  width={1600}
                  height={900}
                  sizes="(min-width: 64rem) 45vw, 100vw"
                />
              </div>
            </div>
            <ol className="timeline">
              {TIMELINE.map((m) => (
                <li key={m.year} className="timeline__item">
                  <p className="timeline__year">{formatNumber(m.year, locale).replace(/[,٬]/g, "")}</p>
                  <div className="stack" style={{ ["--stack" as string]: "var(--space-2)" }}>
                    <h3 className="t-headline">{m.title[locale]}</h3>
                    <p className="t-body">{m.body[locale]}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Container>
        </Section>

        <Section tone="subtle" aria-labelledby="principles-title">
          <Container>
            <div className="section-head">
              <div id="principles-title">
                <c.Text k="principles.title" as="h2" className="t-title" fallback={d.principlesTitle} />
              </div>
            </div>
            <ul className="principles">
              {PRINCIPLES.map((p) => (
                <li key={p.id}>
                  <h3 className="t-headline">{p.title[locale]}</h3>
                  <p className="t-body">{p.body[locale]}</p>
                </li>
              ))}
            </ul>
          </Container>
        </Section>

        <Section aria-labelledby="leadership-title">
          <Container>
            <div className="section-head section-head--split">
              <div id="leadership-title">
                <c.Text k="leadership.title" as="h2" className="t-title" fallback={d.leadershipTitle} />
              </div>
              <c.Text k="leadership.note" as="p" className="t-lead" fallback={d.leadershipNote} />
            </div>
            <ul className="people">
              {LEADERSHIP.map((p) => (
                <li key={p.id}>
                  <span className="people__role">{p.role[locale]}</span>
                  <span className="t-small">{p.remit[locale]}</span>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      </main>
    );
  },
};
