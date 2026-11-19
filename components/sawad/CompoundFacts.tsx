import type { Compound, Locale } from "@/lib/sawad/data";
import { countApartments, countHectares, countVillas, formatPercent } from "@/lib/sawad/format";
import { t } from "@/lib/sawad/i18n";

/** Site, landscape share, phase-one mix and handover, as a definition list. */
export function CompoundFacts({ compound, locale }: { compound: Compound; locale: Locale }) {
  const d = t(locale).facts;
  const sep = locale === "ar" ? " و" : ", ";
  return (
    <dl className="facts">
      <div>
        <dt>{d.site}</dt>
        <dd>{countHectares(compound.siteHa, locale)}</dd>
      </div>
      <div>
        <dt>{d.landscape}</dt>
        <dd>{formatPercent(compound.landscapePct, locale)}</dd>
      </div>
      <div>
        <dt>{d.phaseOne}</dt>
        <dd>
          {countVillas(compound.phaseOne.villas, locale)}
          {sep}
          {countApartments(compound.phaseOne.apartments, locale)}
        </dd>
      </div>
      <div>
        <dt>{d.handover}</dt>
        <dd>{compound.handover[locale]}</dd>
      </div>
    </dl>
  );
}
