import { describe, expect, it } from "vitest";
import { DICTIONARY, basePath, dirOf, globalKey, localeFromPath, localizedPath, t } from "./i18n";

function leaves(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("locale routing", () => {
  it("detects Arabic paths", () => {
    expect(localeFromPath("/ar")).toBe("ar");
    expect(localeFromPath("/ar/residences")).toBe("ar");
    expect(localeFromPath("/archive")).toBe("en");
    expect(localeFromPath("/")).toBe("en");
  });

  it("maps paths between languages", () => {
    expect(basePath("/ar")).toBe("/");
    expect(basePath("/ar/compounds")).toBe("/compounds");
    expect(basePath("/compounds")).toBe("/compounds");
    expect(localizedPath("/", "ar")).toBe("/ar");
    expect(localizedPath("/residences", "ar")).toBe("/ar/residences");
    expect(localizedPath("/ar/residences", "en")).toBe("/residences");
    expect(localizedPath("/ar/residences", "ar")).toBe("/ar/residences");
  });

  it("gives Arabic right-to-left direction and its own global keys", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
    expect(globalKey("ar", "footer.note")).toBe("ar.footer.note");
    expect(globalKey("en", "footer.note")).toBe("footer.note");
  });
});

describe("dictionary", () => {
  it("has the same keys in both languages, none empty", () => {
    expect(leaves(DICTIONARY.ar).sort()).toEqual(leaves(DICTIONARY.en).sort());
    for (const locale of ["en", "ar"] as const) {
      for (const key of leaves(DICTIONARY[locale])) {
        const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], DICTIONARY[locale]);
        expect(String(value).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("uses no em dashes and Arabic punctuation in Arabic copy", () => {
    const all = JSON.stringify(DICTIONARY);
    expect(all).not.toContain("—");
    for (const key of leaves(DICTIONARY.ar)) {
      const value = String(key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], DICTIONARY.ar));
      // Latin commas only appear around Latin examples (e.g. an email address).
      if (/[؀-ۿ]/.test(value) && !/[a-z]@/.test(value) && !/both|flight/.test(value)) expect(value, key).not.toMatch(/[؀-ۿ], /);
    }
  });

  it("returns the right language", () => {
    expect(t("ar").nav.contact).toBe("تواصل معنا");
    expect(t("en").nav.residences).toBe("Find a residence");
  });
});
