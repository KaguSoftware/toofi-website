/** Enquiry form model + validation. Pure, so it is shared by the form and its tests. */

export const INTERESTS = ["buyer", "landowner", "investor", "supplier"] as const;
export type Interest = (typeof INTERESTS)[number];
export const CONTACT_WAYS = ["phone", "whatsapp", "email"] as const;
export type ContactWay = (typeof CONTACT_WAYS)[number];

export type Enquiry = {
  name: string;
  phone: string;
  email: string;
  interest: Interest;
  compound: string;
  residence: string;
  message: string;
  contactBy: ContactWay;
  consent: boolean;
};

export type EnquiryErrorCode = "name" | "phone" | "email" | "emailNeeded" | "consent";
export type EnquiryErrors = Partial<Record<"name" | "phone" | "email" | "consent", EnquiryErrorCode>>;

/** Arabic-Indic and Extended Arabic-Indic digits count as digits too. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

export function digitCount(s: string): number {
  return (normalizeDigits(s).match(/\d/g) ?? []).length;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEnquiry(v: Enquiry): EnquiryErrors {
  const errors: EnquiryErrors = {};
  if (v.name.trim().length < 2) errors.name = "name";
  const digits = digitCount(v.phone);
  if (digits < 7 || digits > 15) errors.phone = "phone";
  const email = v.email.trim();
  if (email && !EMAIL.test(email)) errors.email = "email";
  else if (!email && v.contactBy === "email") errors.email = "emailNeeded";
  if (!v.consent) errors.consent = "consent";
  return errors;
}

export function parseInterest(raw: string | null | undefined): Interest {
  return (INTERESTS as readonly string[]).includes(raw ?? "") ? (raw as Interest) : "buyer";
}

export function emptyEnquiry(init: Partial<Enquiry> = {}): Enquiry {
  return {
    name: "",
    phone: "",
    email: "",
    interest: "buyer",
    compound: "",
    residence: "",
    message: "",
    contactBy: "phone",
    consent: false,
    ...init,
  };
}
