import Image from "next/image";
import Link from "next/link";
import { Container, Section } from "@/components/ui";
import { CompoundFacts } from "@/components/sawad/CompoundFacts";
import { HomeSearch } from "@/components/sawad/HomeSearch";
import { TweaksPanel } from "@/components/sawad/TweaksPanel";
import { SceneViewport } from "@/components/sawad/scene/SceneViewport";
import { OPERATIONS } from "@/lib/sawad/content";
import { COMPOUNDS, sceneImage } from "@/lib/sawad/data";
import { formatNumber } from "@/lib/sawad/format";
import { localeFromPath, localizedPath, ROUTES, t } from "@/lib/sawad/i18n";
import { parseExperience, parseView, showsFilm, TWEAK_KEYS } from "@/lib/sawad/tweaks";
import type { TemplateDefinition } from "./types";

/**
 * Home. Editable keys: hero.title, hero.lead, name.title, name.body, name.rule,
 * compounds.title, compounds.lead, ops.title, ops.lead, visit.title, visit.body.
 * The opening film holds one shot (Tweaks: startView), then flies slowly around the
 * compound. Switching viewpoints lives in the finder, so the hero has a single job:
 * lead to Find a residence.
 */
export const homeTemplate: TemplateDefinition = {
  id: "home",
  name: "Home",
  description: "Opening scene and search, the meaning of Sawad, compounds, operations.",
  component: ({ c, g, page }) => {
    const locale = localeFromPath(page.slug);
    const d = t(locale);
    const experience = parseExperience(g?.text(TWEAK_KEYS.experience, "both"));
    const startView = parseView(g?.text(TWEAK_KEYS.startView, "flight"), "flight");
    const poster = { src: sceneImage("dijla", startView), alt: d.home.sceneCaption };

    return (
      <main id="main">
        <TweaksPanel g={g} locale={locale} />
        <section className="home-hero" aria-labelledby="home-title">
          <div className="home-hero__stage">
            {showsFilm(experience) ? (
              <SceneViewport mode="film" variant="dijla" view={startView} poster={poster} labels={d.finder.scene} />
            ) : (
              <Image src={poster.src} alt={poster.alt} fill priority sizes="100vw" style={{ objectFit: "cover" }} />
            )}
          </div>
          <div className="home-hero__panel">
            <div id="home-title">
              <c.Text k="hero.title" as="h1" className="t-display home-hero__title" fallback={d.home.title} />
            </div>
            <c.Text k="hero.lead" as="p" className="t-lead home-hero__lead" fallback={d.home.lead} multiline />
            <p className="t-small home-hero__caption">{d.home.sceneCaption}</p>
          </div>
          <Container>
            <HomeSearch locale={locale} />
          </Container>
        </section>

        <section className="name-band on-dark" aria-labelledby="name-title">
          <Container className="name-band__grid">
            <div>
              <p className="name-band__word" lang="ar" aria-hidden="true">
                السواد
              </p>
              {locale === "en" && <p className="name-band__translit">al-Sawad, “the dark land”</p>}
            </div>
            <div className="name-band__copy">
              <div id="name-title">
                <c.Text k="name.title" as="h2" className="t-title" fallback={d.home.nameTitle} />
              </div>
              <c.Text k="name.body" as="p" fallback={d.home.nameBody} multiline />
              <c.Text k="name.rule" as="p" className="name-band__rule" fallback={d.home.nameBody2} />
            </div>
          </Container>
        </section>

        <Section aria-labelledby="compounds-title">
          <Container>
            <div className="section-head section-head--split">
              <div id="compounds-title">
                <c.Text k="compounds.title" as="h2" className="t-title" fallback={d.home.compoundsTitle} />
              </div>
              <c.Text k="compounds.lead" as="p" className="t-lead" fallback={d.home.compoundsLead} multiline />
            </div>
            <ol className="compound-rows">
              {COMPOUNDS.map((cp) => {
                const coming = cp.status === "coming-soon";
                return (
                  <li key={cp.id} className="compound-row">
                    <div className="compound-row__media">
                      <Image
                        src={cp.image.src}
                        alt={cp.image.alt[locale]}
                        width={1600}
                        height={900}
                        sizes="(min-width: 56rem) 58vw, 100vw"
                      />
                    </div>
                    <div className="compound-row__body">
                      <div className="compound-row__head">
                        <h3 className="t-title">{cp.name[locale]}</h3>
                        <span className="status" data-status={coming ? "coming-soon" : "selling"}>
                          {coming ? d.facts.comingSoon : d.facts.selling}
                        </span>
                      </div>
                      <p className="compound-row__city">{cp.location[locale]}</p>
                      <p className="t-body">{cp.summary[locale]}</p>
                      <CompoundFacts compound={cp} locale={locale} />
                      <div>
                        <Link href={`${localizedPath(ROUTES.residences, locale)}?compound=${cp.id}`} className="link-arrow">
                          {coming ? d.home.register : d.home.see}
                          <span className="visually-hidden">: {cp.name[locale]}</span>
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Container>
        </Section>

        <Section tone="subtle" aria-labelledby="ops-title">
          <Container>
            <div className="section-head section-head--split">
              <div id="ops-title">
                <c.Text k="ops.title" as="h2" className="t-title" fallback={d.home.opsTitle} />
              </div>
              <div className="stack">
                <c.Text k="ops.lead" as="p" className="t-lead" fallback={d.home.opsLead} multiline />
                <div>
                  <Link href={localizedPath(ROUTES.whatWeDo, locale)} className="link-arrow">
                    {d.home.opsLink}
                  </Link>
                </div>
              </div>
            </div>
            <ol className="sequence sequence--row">
              {OPERATIONS.map((op, i) => (
                <li key={op.id} className="sequence__item">
                  <span className="sequence__num" aria-hidden="true">
                    {formatNumber(i + 1, locale).padStart(2, locale === "ar" ? "٠" : "0")}
                  </span>
                  <h3 className="sequence__title">{op.title[locale]}</h3>
                  <p className="sequence__body">{op.body[locale]}</p>
                </li>
              ))}
            </ol>
          </Container>
        </Section>

        <Section aria-labelledby="visit-title">
          <Container className="visit">
            <div className="visit__media">
              <Image
                src={sceneImage("dijla", "street")}
                alt={locale === "ar" ? "شارع تحفّه أشجار النخيل في بستان دجلة عند الغروب" : "A palm-lined street in Bustan Dijla at sunset"}
                width={1600}
                height={900}
                sizes="(min-width: 56rem) 50vw, 100vw"
              />
            </div>
            <div className="stack">
              <div id="visit-title">
                <c.Text k="visit.title" as="h2" className="t-title" fallback={d.home.visitTitle} />
              </div>
              <c.Text k="visit.body" as="p" className="t-lead" fallback={d.home.visitBody} multiline />
              <div>
                <Link href={`${localizedPath(ROUTES.contact, locale)}#galleries`} className="link-arrow">
                  {d.home.visitLink}
                </Link>
              </div>
            </div>
          </Container>
        </Section>
      </main>
    );
  },
};
