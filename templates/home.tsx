import Image from "next/image";
import Link from "next/link";
import { Container, Section } from "@/components/ui";
import { CompoundFacts } from "@/components/sawad/CompoundFacts";
import { HomeSearch } from "@/components/sawad/HomeSearch";
import { TweaksPanel } from "@/components/sawad/TweaksPanel";
import { BEAT_IDS, type BeatId } from "@/components/sawad/experience/beats";
import { HERO_HOME_ID } from "@/components/sawad/experience/story";
import type { BeatContent, ExperienceLabels } from "@/components/sawad/experience/types";
import { LIVE_DOWNLOAD_MB } from "@/components/sawad/experience/early";
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

/**
 * Wording for visitors the 3D tour is held back from until they ask: a slow link or a small
 * device, and a 3D view the browser has closed (a lost GPU context). The button names the
 * download, so the choice is an informed one.
 */
const OFFER: Record<Locale, { heldBack: string; sized: (megabytes: string) => string; lost: string }> = {
  en: {
    heldBack: "The 3D tour is a larger download, so it is shown as stills here.",
    sized: (mb) => `Load the 3D tour (about ${mb} MB)`,
    lost: "The browser closed the 3D view. The tour continues as stills.",
  },
  ar: {
    heldBack: "الجولة ثلاثية الأبعاد أكبر حجمًا في التنزيل، لذا نعرضها هنا صورًا ثابتة.",
    sized: (mb) => `حمّل الجولة ثلاثية الأبعاد (نحو ${mb} ميغابايت)`,
    lost: "أغلق المتصفّح العرض ثلاثي الأبعاد، والجولة مستمرة بالصور الثابتة.",
  },
};

/**
 * "al-Sawad" set in Amiri Bold and traced as one path (the shaped word, 1,000 units to the em).
 * The band's word was the only Amiri text on the English page, which downloaded the 100 KB font
 * for it at the highest priority (S1-9). The box is the line the text stood on: 1.972 em wide
 * and 0.9 em tall (the band's line height), with the baseline 695 units down, so the word sits
 * where the text sat; the tall letters reach above the box, as they reached above the line.
 */
const SAWAD_WORD = {
  width: 1972,
  height: 900,
  baseline: 695,
  d: "M180 -285Q160 -294 172 -329Q178 -346 184 -360Q191 -375 197 -387Q209 -411 229 -400Q352 -328 379 -193Q386 -157 386 -126Q385 -94 375 -67Q365 -34 345 -26Q239 17 165 21Q54 29 86 -99Q92 -124 105 -124Q115 -124 122 -112Q130 -100 213 -110Q296 -120 343 -143Q328 -219 180 -285ZM549 -692Q569 -735 575 -672L599 -428Q629 -100 585 -15Q575 3 566 0Q556 -3 557 -48Q558 -86 549 -174Q540 -261 522 -396L501 -562Q498 -583 507 -603ZM997 15Q961 205 809 273Q764 293 728 293Q676 293 593 223Q578 211 583 201Q588 191 608 199Q697 230 809 162Q921 94 954 10Q879 7 847 -13Q808 -37 821 -100Q844 -199 889 -227Q938 -256 971 -214Q995 -183 1004 -106Q1040 -108 1045 -70Q1048 -44 1041 -16Q1034 13 1014 15ZM944 -101Q924 -143 896 -142Q880 -139 872 -130Q864 -120 871 -112Q887 -91 940 -93Q946 -93 944 -101ZM1139 -167Q1147 -189 1166 -182Q1184 -174 1171 -145L1162 -127Q1270 -88 1317 -187Q1326 -209 1344 -201Q1361 -193 1352 -170Q1343 -146 1343 -138Q1345 -116 1382 -112Q1419 -108 1431 -124Q1444 -142 1454 -192Q1457 -206 1471 -206Q1485 -206 1489 -194Q1520 -111 1581 -105Q1604 -102 1611 -69Q1618 -38 1610 -11Q1602 15 1581 15Q1491 15 1459 -87Q1452 -65 1444 -46Q1436 -26 1428 -10Q1413 19 1383 21Q1313 24 1275 -23Q1235 14 1180 14Q1125 14 1093 -18Q1074 -2 1054 6Q1033 15 1012 15Q985 15 977 -34Q976 -40 975 -48Q974 -57 973 -68Q971 -93 996 -102Q1005 -105 1012 -105Q1119 -112 1139 -167ZM1665 -573Q1705 -278 1695 -168Q1679 -2 1580 15Q1555 19 1552 -16Q1551 -27 1550 -40Q1550 -54 1551 -70Q1553 -102 1580 -105Q1636 -111 1651 -139Q1650 -151 1636 -260Q1623 -370 1595 -577Q1592 -596 1590 -608Q1587 -621 1585 -628Q1575 -652 1586 -674L1611 -724Q1625 -753 1640 -711Q1648 -691 1658 -674Q1669 -657 1685 -644Q1706 -627 1689 -605ZM1854 -692Q1874 -735 1880 -672L1904 -428Q1934 -100 1890 -15Q1880 3 1871 0Q1861 -3 1862 -48Q1863 -86 1854 -174Q1845 -261 1827 -396L1806 -562Q1803 -583 1812 -603Z",
} as const;

export function SawadWord() {
  const { width, height, baseline, d: path } = SAWAD_WORD;
  return (
    <svg
      viewBox={`0 ${-baseline} ${width} ${height}`}
      style={{ display: "block", width: `${width / 1000}em`, height: `${height / 1000}em`, overflow: "visible" }}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

function experienceLabels(d: Dict, locale: Locale): ExperienceLabels {
  const { scene, close } = d.finder;
  const s = d.showcase;
  const offer = OFFER[locale];
  return {
    region: s.region,
    loading: scene.loading,
    stills: s.stills,
    load3d: s.load3d,
    heldBack: offer.heldBack,
    load3dSized: { low: offer.sized(formatNumber(LIVE_DOWNLOAD_MB.low, locale)), high: offer.sized(formatNumber(LIVE_DOWNLOAD_MB.high, locale)) },
    lost: offer.lost,
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
          labels={experienceLabels(d, locale)}
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
                <SawadWord />
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
