import type { Locale, Residence } from "@/lib/sawad/data";
import { localizedPath, ROUTES } from "@/lib/sawad/i18n";

/** The home's place in the residence finder: its compound, with this home selected. */
export function finderHref(residence: Pick<Residence, "id" | "compound">, locale: Locale): string {
  return `${localizedPath(ROUTES.residences, locale)}?compound=${residence.compound}&home=${residence.id}`;
}
