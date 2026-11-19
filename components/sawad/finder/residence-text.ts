import { COMPOUNDS, RESIDENCE_TYPES, type Locale, type Residence } from "@/lib/sawad/data";
import { countBedrooms, formatArea, formatNumber, formatUsd } from "@/lib/sawad/format";
import { localizedPath, ROUTES, t } from "@/lib/sawad/i18n";

/** Display strings for one residence, shared by the list, details and compare table. */
export function residenceText(r: Residence, locale: Locale) {
  const d = t(locale).finder;
  const type = RESIDENCE_TYPES[r.type];
  const compound = COMPOUNDS.find((c) => c.id === r.compound)!;
  const comingSoon = compound.status === "coming-soon";
  const floor = r.floor === null ? null : r.floor === 0 ? d.ground : formatNumber(r.floor, locale);
  return {
    title: type.name[locale],
    beds: countBedrooms(r.bedrooms, locale),
    built: formatArea(r.builtM2, locale),
    land: r.landM2 === null ? null : formatArea(r.landM2, locale),
    floor,
    outlook: d.outlooks[r.outlook],
    price: formatUsd(r.priceUsd, locale),
    status: comingSoon ? d.registerStatus : d.statuses[r.status],
    handover: compound.handover[locale],
    compound: compound.name[locale],
    comingSoon,
    // The type is the row title already; the meta line adds what differs.
    meta: [countBedrooms(r.bedrooms, locale), formatArea(r.builtM2, locale), d.outlooks[r.outlook]].join(" · "),
    enquireHref: `${localizedPath(ROUTES.contact, locale)}?residence=${r.id}&compound=${r.compound}`,
    enquireLabel: comingSoon ? d.register : d.enquire,
    canEnquire: r.status !== "sold",
  };
}
