import { describe, expect, it } from "vitest";
import { getResidence, residencesIn } from "@/lib/sawad/data";
import { residenceText } from "./residence-text";

describe("residenceText", () => {
  it("describes a villa in English", () => {
    const r = getResidence("BD-V01")!;
    const txt = residenceText(r, "en");
    expect(txt.title).toBe("Courtyard villa");
    expect(txt.beds).toBe("5 bedrooms");
    expect(txt.land).toBe("780 m²");
    expect(txt.floor).toBeNull();
    expect(txt.compound).toBe("Bustan Dijla");
    expect(txt.enquireHref).toBe("/contact?residence=BD-V01&compound=bustan-dijla");
    expect(txt.meta).toBe("5 bedrooms · 520\u00a0m² · River");
  });

  it("describes an apartment in Arabic, with the ground floor named", () => {
    const r = getResidence("BD-A01")!;
    const txt = residenceText(r, "ar");
    expect(txt.floor).toBe("الأرضي");
    expect(txt.land).toBeNull();
    expect(txt.enquireHref.startsWith("/ar/contact?")).toBe(true);
    expect(residenceText(getResidence("BD-A04")!, "ar").floor).toBe("٣");
  });

  it("offers registration, not enquiry, in a coming-soon compound, and no enquiry for sold homes", () => {
    const shatt = residenceText(residencesIn("shatt-gardens")[0], "en");
    expect(shatt.comingSoon).toBe(true);
    expect(shatt.enquireLabel).toBe("Register interest");
    expect(shatt.status).toBe("Open to register");
    const sold = residencesIn("bustan-dijla").find((r) => r.status === "sold")!;
    expect(residenceText(sold, "en").canEnquire).toBe(false);
  });
});
