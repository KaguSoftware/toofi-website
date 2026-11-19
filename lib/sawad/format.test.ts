import { describe, expect, it } from "vitest";
import {
  countApartments,
  countBedrooms,
  countHectares,
  countHomes,
  countVillas,
  formatArea,
  formatNumber,
  formatPercent,
  formatUsd,
  formatUsdShort,
  localeTag,
} from "./format";

describe("number formatting", () => {
  it("uses Arabic-Indic digits on Arabic pages and Western digits in English", () => {
    expect(localeTag("ar")).toContain("nu-arab");
    expect(formatNumber(96, "ar")).toBe("٩٦");
    expect(formatNumber(96, "en")).toBe("96");
  });

  it("formats prices", () => {
    expect(formatUsd(980000, "en")).toBe("$980,000");
    expect(formatUsd(980000, "ar")).toBe("٩٨٠٬٠٠٠ دولار");
    expect(formatUsdShort(300000, "en")).toBe("$300k");
    expect(formatUsdShort(300000, "ar")).toBe("٣٠٠ ألف دولار");
    expect(formatUsdShort(1500000, "en")).toBe("$1.5m");
    expect(formatUsdShort(2000000, "ar")).toBe("٢ مليون دولار");
  });

  it("formats areas and percentages", () => {
    expect(formatArea(520, "en")).toBe("520 m²");
    expect(formatArea(520, "ar")).toBe("٥٢٠ م²");
    expect(formatPercent(62, "en")).toBe("62%");
    expect(formatPercent(62, "ar")).toMatch(/٦٢/);
  });
});

describe("counted nouns", () => {
  it("English singular and plural", () => {
    expect(countHomes(1, "en")).toBe("1 home");
    expect(countHomes(32, "en")).toBe("32 homes");
    expect(countHectares(42, "en")).toBe("42 ha");
  });

  it("Arabic agreement for 1, 2, 3–10, 11–99 and 100+", () => {
    expect(countHomes(0, "ar")).toBe("لا منازل");
    expect(countHomes(1, "ar")).toBe("منزل واحد");
    expect(countHomes(2, "ar")).toBe("منزلان");
    expect(countHomes(5, "ar")).toBe("٥ منازل");
    expect(countHomes(32, "ar")).toBe("٣٢ منزلًا");
    expect(countHomes(100, "ar")).toBe("١٠٠ منزل");
    expect(countVillas(20, "ar")).toBe("٢٠ فيلا");
    expect(countApartments(8, "ar")).toBe("٨ شقق");
    expect(countBedrooms(2, "ar")).toBe("غرفتا نوم");
    expect(countBedrooms(4, "ar")).toBe("٤ غرف نوم");
    expect(countHectares(42, "ar")).toBe("٤٢ هكتارًا");
    expect(countVillas(1, "en")).toBe("1 villa");
    expect(countApartments(12, "en")).toBe("12 apartments");
    expect(countBedrooms(3, "en")).toBe("3 bedrooms");
  });
});
