import Image from "next/image";
import Link from "next/link";
import { Container, Section } from "@/components/ui";
import { CompoundFacts } from "@/components/sawad/CompoundFacts";
import { HomeSearch } from "@/components/sawad/HomeSearch";
import { TweaksPanel } from "@/components/sawad/TweaksPanel";
import { BEAT_IDS, type BeatId } from "@/components/sawad/experience/beats";
import { HERO_HOME_ID } from "@/components/sawad/experience/story";
import type { BeatContent, ExperienceLabels } from "@/components/sawad/experience/types";
import { finderHref } from "@/components/sawad/experience/links";
import { ZaitunExperience } from "@/components/sawad/experience/ZaitunExperience";
import { planAmenities } from "@/components/sawad/scene/layout";
import { OPERATIONS } from "@/lib/sawad/content";
import { COMPOUNDS, RESIDENCE_TYPES, fromPrice, getCompound, getResidence, sceneImage, type Locale } from "@/lib/sawad/data";
import { countHectares, formatArea, formatNumber, formatPercent, formatUsd } from "@/lib/sawad/format";
import { localeFromPath, localizedPath, ROUTES, t, type Dict } from "@/lib/sawad/i18n";
import { parseExperience, parseView, showsFilm, TWEAK_KEYS } from "@/lib/sawad/tweaks";
import type { TemplateDefinition } from "./types";

/** Stills of the Zaitun Hills story, rendered from the scene (scripts/render-story-stills.mjs). */
export const storyStill = (name: string): string => `/sawad/story/zaitun-${name}.jpg`;

/** The numbers under each caption, from the same data and layout the scene is built from. */
function beatFigures(id: BeatId, locale: Locale, d: Dict): BeatContent["figures"] {
  const zaitun = getCompound("zaitun-hills")!;
  const metres = (n: number) => `${formatNumber(n, locale)} ${locale === "ar" ? "م" : "m"}`;
  switch (id) {
    case "entrance":
      return [
        { label: d.facts.site, value: countHectares(zaitun.siteHa, locale) },
        { label: d.facts.landscape, value: formatPercent(zaitun.landscapePct, locale) },
      ];
    case "boulevard":
      return [
        { label: d.showcase.figures.villas, value: formatNumber(zaitun.phaseOne.villas, locale) },
        { label: d.showcase.figures.apartments, value: formatNumber(zaitun.phaseOne.apartments, locale) },
      ];
    case "villa": {
      const type = RESIDENCE_TYPES.cv5;
      const from = fromPrice("zaitun-hills", "cv5");
      return [
        { label: d.finder.bedrooms, value: formatNumber(type.bedrooms, locale) },
        { label: d.finder.built, value: formatArea(type.builtM2, locale) },
        ...(type.landM2 ? [{ label: d.finder.land, value: formatArea(type.landM2, locale) }] : []),
        ...(from ? [{ label: d.facts.fromPrice, value: formatUsd(from, locale) }] : []),
      ];
    }
    case "amenities": {
      const amenities = planAmenities();
      const pool = amenities.find((a) => a.id === "pool");
      const courts = amenities.filter((a) => a.kind === "padel" || a.kind === "tennis").length;
      return [
        ...(pool?.size ? [{ label: d.showcase.figures.pool, value: metres(pool.size.depth) }] : []),
        { label: d.showcase.figures.courts, value: formatNumber(courts, locale) },
      ];
    }
    case "aerial":
      return [
        { label: d.facts.homes, value: formatNumber(zaitun.phaseOne.villas + zaitun.phaseOne.apartments, locale) },
        { label: d.facts.handover, value: zaitun.handover[locale] },
      ];
  }
}

function experienceLabels(d: Dict): ExperienceLabels {
  const { scene, close } = d.finder;
  const s = d.showcase;
  return {
    region: s.region,
    loading: scene.loading,
    stills: s.stills,
    load3d: s.load3d,
    pause: scene.pause,
    play: scene.play,
    skipIntro: s.skipIntro,
    scrollHint: s.scrollHint,
    explore: s.explore,
    backToStory: s.backToStory,
    orbit: s.orbit,
    walk: s.walk,
    exploreMode: s.exploreMode,
    toDusk: s.toDusk,
    toDay: s.toDay,
    soundOn: s.soundOn,
    soundOff: s.soundOff,
    musicCredit: s.musicCredit,
    zoomIn: scene.zoomIn,
    zoomOut: scene.zoomOut,
    reset: scene.reset,
    orbitHint: s.orbitHint,
    walkHint: s.walkHint,
    joystick: s.joystick,
    panelTitle: s.panelTitle,
    close,
    inFinder: s.inFinder,
    beatsLabel: s.beatsLabel,
  };
}

/**
 * Home. Editable keys: hero.title, hero.lead, showcase.<beat>.eyebrow / .title / .body (beats:
 * entrance, boulevard, villa, amenities, aerial), name.title, name.body, name.rule,
 * compounds.title, compounds.lead, ops.title, ops.lead, visit.title, visit.body.
 * The page opens on Zaitun Hills, the showcase compound: an opening shot (Tweaks: startView),
 * then a scroll-driven tour with captions, then free exploring. Tweaks experience = explorer
 * shows the tour as stills. In edit mode it is always stills, so every caption can be edited.
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
    // Each opening starts on its viewpoint's own poster frame (public/sawad/scene-zaitun-*.jpg).
    const poster = { src: sceneImage("zaitun", startView), alt: d.showcase.caption };
    const heroHome = getResidence(HERO_HOME_ID);
    const finder = localizedPath(ROUTES.residences, locale);
    const beats: BeatContent[] = BEAT_IDS.map((id) => {
      const copy = d.showcase.beats[id];
      return {
        id,
        eyebrow: <c.Text k={`showcase.${id}.eyebrow`} as="span" fallback={copy.eyebrow} />,
        title: <c.Text k={`showcase.${id}.title`} as="h2" fallback={copy.title} />,
        body: <c.Text k={`showcase.${id}.body`} as="p" fallback={copy.body} multiline />,
        figures: beatFigures(id, locale, d),
        still: { src: storyStill(id), alt: copy.still },
        link:
          id === "villa" && heroHome
            ? { href: finderHref(heroHome, locale), label: d.showcase.seeHome }
            : id === "aerial"
              ? { href: `${finder}?compound=zaitun-hills`, label: d.showcase.findHome }
              : undefined,
      };
    });

    return (
      <main id="main">
        <TweaksPanel g={g} locale={locale} />
        <ZaitunExperience
          locale={locale}
          view={startView}
          live={showsFilm(experience) && !c.editing}
          poster={poster}
          labels={experienceLabels(d)}
          beats={beats}
          hero={
            <div className="home-hero__panel">
              <div id="home-title">
                <c.Text k="hero.title" as="h1" className="t-display home-hero__title" fallback={d.home.title} />
              </div>
              <c.Text k="hero.lead" as="p" className="t-lead home-hero__lead" fallback={d.home.lead} multiline />
              <p className="t-small home-hero__caption">{d.showcase.caption}</p>
            </div>
          }
          after={
            <Container>
              <HomeSearch locale={locale} />
            </Container>
          }
        />

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
