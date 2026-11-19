import type { Locale } from "./data";

/**
 * Number formatting. Arabic pages use Arabic-Indic digits (٠١٢…), the norm in Iraq,
 * consistently in prose, tables and prices. English uses Western digits.
 */
export function localeTag(locale: Locale): string {
  return locale === "ar" ? "ar-IQ-u-nu-arab" : "en-GB";
}

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: Locale, opts: Intl.NumberFormatOptions = {}) {
  const key = locale + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeTag(locale), opts);
    cache.set(key, f);
  }
  return f;
}

export function formatNumber(n: number, locale: Locale): string {
  return nf(locale).format(n);
}

/** "$980,000" / "٩٨٠٬٠٠٠ دولار" */
export function formatUsd(n: number, locale: Locale): string {
  if (locale === "ar") return `${formatNumber(n, "ar")} دولار`;
  // Plain "$": en-GB currency style would print "US$".
  return `$${formatNumber(Math.round(n), "en")}`;
}

/** Compact, for filter chips: "$300k" / "٣٠٠ ألف دولار" */
export function formatUsdShort(n: number, locale: Locale): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return locale === "ar" ? `${formatNumber(m, "ar")} مليون دولار` : `$${formatNumber(m, "en")}m`;
  }
  const k = Math.round(n / 1000);
  return locale === "ar" ? `${formatNumber(k, "ar")} ألف دولار` : `$${formatNumber(k, "en")}k`;
}

/** "520 m²" / "٥٢٠ م²" (non-breaking space). */
export function formatArea(n: number, locale: Locale): string {
  return `${formatNumber(n, locale)} ${locale === "ar" ? "م²" : "m²"}`;
}

export function formatPercent(n: number, locale: Locale): string {
  return nf(locale, { style: "percent", maximumFractionDigits: 0 }).format(n / 100);
}

export type ArabicForms = {
  /** 0 */ zero: string;
  /** 1, written without the digit, e.g. "منزل واحد" */ one: string;
  /** 2, the dual, e.g. "منزلان" */ two: string;
  /** 3–10: plural noun after the number, e.g. "منازل" */ few: string;
  /** 11–99: singular accusative after the number, e.g. "منزلًا" */ many: string;
  /** 100+: singular genitive after the number, e.g. "منزل" */ other: string;
};

const arPlural = new Intl.PluralRules("ar");

/** Arabic counted noun with correct number agreement. */
export function arCount(n: number, forms: ArabicForms): string {
  const cat = arPlural.select(n) as keyof ArabicForms;
  if (cat === "zero") return forms.zero;
  if (cat === "one") return forms.one;
  if (cat === "two") return forms.two;
  return `${formatNumber(n, "ar")} ${forms[cat] ?? forms.other}`;
}

/** English counted noun: "1 home", "32 homes". */
export function enCount(n: number, one: string, many: string): string {
  return `${formatNumber(n, "en")} ${n === 1 ? one : many}`;
}

export const AR_HOMES: ArabicForms = { zero: "لا منازل", one: "منزل واحد", two: "منزلان", few: "منازل", many: "منزلًا", other: "منزل" };
export const AR_VILLAS: ArabicForms = { zero: "لا فلل", one: "فيلا واحدة", two: "فيلتان", few: "فلل", many: "فيلا", other: "فيلا" };
export const AR_APARTMENTS: ArabicForms = { zero: "لا شقق", one: "شقة واحدة", two: "شقتان", few: "شقق", many: "شقة", other: "شقة" };
export const AR_BEDROOMS: ArabicForms = { zero: "بلا غرف نوم", one: "غرفة نوم واحدة", two: "غرفتا نوم", few: "غرف نوم", many: "غرفة نوم", other: "غرفة نوم" };
export const AR_HECTARES: ArabicForms = { zero: "صفر هكتار", one: "هكتار واحد", two: "هكتاران", few: "هكتارات", many: "هكتارًا", other: "هكتار" };

export function countHomes(n: number, locale: Locale) {
  return locale === "ar" ? arCount(n, AR_HOMES) : enCount(n, "home", "homes");
}
export function countVillas(n: number, locale: Locale) {
  return locale === "ar" ? arCount(n, AR_VILLAS) : enCount(n, "villa", "villas");
}
export function countApartments(n: number, locale: Locale) {
  return locale === "ar" ? arCount(n, AR_APARTMENTS) : enCount(n, "apartment", "apartments");
}
export function countBedrooms(n: number, locale: Locale) {
  return locale === "ar" ? arCount(n, AR_BEDROOMS) : enCount(n, "bedroom", "bedrooms");
}
export function countHectares(n: number, locale: Locale) {
  return locale === "ar" ? arCount(n, AR_HECTARES) : `${formatNumber(n, "en")} ha`;
}
