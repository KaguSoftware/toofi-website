import { describe, expect, it } from "vitest";
import { digitCount, emptyEnquiry, normalizeDigits, parseInterest, validateEnquiry } from "./enquiry";

const valid = emptyEnquiry({ name: "Zainab Ali", phone: "+964 770 123 4567", consent: true });

describe("enquiry validation", () => {
  it("accepts a complete enquiry", () => {
    expect(validateEnquiry(valid)).toEqual({});
  });

  it("requires a name, a real phone number and consent", () => {
    expect(validateEnquiry(emptyEnquiry())).toEqual({ name: "name", phone: "phone", consent: "consent" });
    expect(validateEnquiry({ ...valid, phone: "12345" }).phone).toBe("phone");
    expect(validateEnquiry({ ...valid, phone: "1".repeat(16) }).phone).toBe("phone");
  });

  it("counts Arabic-Indic digits in phone numbers", () => {
    expect(normalizeDigits("٠٧٧٠")).toBe("0770");
    expect(normalizeDigits("۰۷۷")).toBe("077");
    expect(digitCount("٠٧٧٠ ١٢٣ ٤٥٦٧")).toBe(11);
    expect(validateEnquiry({ ...valid, phone: "٠٧٧٠ ١٢٣ ٤٥٦٧" })).toEqual({});
  });

  it("checks email only when given, and requires it for email contact", () => {
    expect(validateEnquiry({ ...valid, email: "nope" }).email).toBe("email");
    expect(validateEnquiry({ ...valid, contactBy: "email" }).email).toBe("emailNeeded");
    expect(validateEnquiry({ ...valid, contactBy: "email", email: "z@example.iq" })).toEqual({});
  });

  it("parses the interest from the URL", () => {
    expect(parseInterest("investor")).toBe("investor");
    expect(parseInterest("hacker")).toBe("buyer");
    expect(parseInterest(null)).toBe("buyer");
  });
});
