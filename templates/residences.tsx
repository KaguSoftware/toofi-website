import { Suspense } from "react";
import { Finder } from "@/components/sawad/finder/Finder";
import { TweaksPanel } from "@/components/sawad/TweaksPanel";
import { localeFromPath, t } from "@/lib/sawad/i18n";
import { parseExperience, showsExplorer, TWEAK_KEYS } from "@/lib/sawad/tweaks";
import type { TemplateDefinition } from "./types";

/**
 * Find a residence. Editable keys: head.title, head.lead. The finder is a client
 * island that reads the URL (?compound=&type=&beds=…), so it sits in Suspense:
 * the page shell prerenders, the finder hydrates with the real query.
 */
export const residencesTemplate: TemplateDefinition = {
  id: "residences",
  name: "Find a residence",
  description: "3D scene, filters and the list of residences.",
  component: ({ c, g, page }) => {
    const locale = localeFromPath(page.slug);
    const d = t(locale).finder;
    const showScene = showsExplorer(parseExperience(g?.text(TWEAK_KEYS.experience, "both")));
    const head = (
      <>
        <c.Text k="head.title" as="h1" className="t-display" fallback={d.title} />
        <c.Text k="head.lead" as="p" className="t-lead" fallback={d.lead} multiline />
      </>
    );
    return (
      <main id="main">
        <TweaksPanel g={g} locale={locale} />
        <Suspense
          fallback={
            <div className="finder-head">
              <div className="container stack">{head}</div>
            </div>
          }
        >
          <Finder locale={locale} showScene={showScene} head={head} />
        </Suspense>
      </main>
    );
  },
};
