"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { COMPOUNDS, getCompound, getResidence, type Locale } from "@/lib/sawad/data";
import {
  CONTACT_WAYS,
  INTERESTS,
  emptyEnquiry,
  parseInterest,
  validateEnquiry,
  type Enquiry,
  type EnquiryErrors,
} from "@/lib/sawad/enquiry";
import { t } from "@/lib/sawad/i18n";
import { buttonClass } from "@/components/ui";

/**
 * Enquiry form. The demo has no backend: on a valid submit it says plainly that
 * nothing was sent (never a fake success). Prefills from ?residence=&compound=&interest=.
 */
export function ContactForm({ locale }: { locale: Locale }) {
  const d = t(locale).contact;
  const params = useSearchParams();
  const uid = useId();
  const [values, setValues] = useState<Enquiry>(() => {
    const residence = getResidence(params.get("residence"));
    return emptyEnquiry({
      interest: parseInterest(params.get("interest")),
      compound: residence?.compound ?? getCompound(params.get("compound"))?.id ?? "",
      residence: residence?.id ?? "",
    });
  });
  const [errors, setErrors] = useState<EnquiryErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (submitted) resultRef.current?.focus();
  }, [submitted]);

  const set = <K extends keyof Enquiry>(k: K, v: Enquiry[K]) => setValues((s) => ({ ...s, [k]: v }));
  const id = (k: string) => `${uid}-${k}`;
  const describe = (k: keyof EnquiryErrors, hint?: boolean) =>
    [errors[k] ? id(`${k}-err`) : null, hint ? id(`${k}-hint`) : null].filter(Boolean).join(" ") || undefined;
  const errorText = (k: keyof EnquiryErrors) =>
    errors[k] ? (
      <p id={id(`${k}-err`)} className="field__error">
        <span aria-hidden="true">!</span>
        {d.errors[errors[k]!]}
      </p>
    ) : null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validateEnquiry(values);
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="notice notice--brass" role="status" style={{ padding: "var(--space-8)" }}>
        <h2 ref={resultRef} tabIndex={-1} className="t-headline">
          {d.demoTitle}
        </h2>
        <p>{d.demoBody}</p>
        <div>
          <button type="button" className={buttonClass({ variant: "secondary" })} onClick={() => setSubmitted(false)}>
            {d.edit}
          </button>
        </div>
      </div>
    );
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form className="form" noValidate onSubmit={onSubmit} aria-labelledby={id("title")}>
      <h2 id={id("title")} className="t-headline">
        {d.formTitle}
      </h2>
      {errorCount > 0 && (
        <div ref={summaryRef} tabIndex={-1} className="form-summary" role="alert">
          {d.errors.summary}
        </div>
      )}

      <fieldset>
        <legend className="field__label" style={{ marginBottom: "var(--space-2)" }}>
          {d.interest}
        </legend>
        <div className="segmented__options">
          {INTERESTS.map((k) => (
            <label key={k} className="segmented__option">
              <input type="radio" name="interest" value={k} checked={values.interest === k} onChange={() => set("interest", k)} />
              <span>{d.interests[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={id("name")}>
          {d.name}
        </label>
        <input
          id={id("name")}
          className="input"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describe("name")}
          required
        />
        {errorText("name")}
      </div>

      <div className="form__pair">
        <div className="field">
          <label className="field__label" htmlFor={id("phone")}>
            {d.phone}
          </label>
          <input
            id={id("phone")}
            className="input"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describe("phone")}
            required
          />
          {errorText("phone")}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={id("email")}>
            {d.email} <span className="field__optional">({d.optional})</span>
          </label>
          <input
            id={id("email")}
            className="input"
            name="email"
            type="email"
            autoComplete="email"
            dir="ltr"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describe("email")}
          />
          {errorText("email")}
        </div>
      </div>

      <fieldset>
        <legend className="field__label" style={{ marginBottom: "var(--space-2)" }}>
          {d.contactBy}
        </legend>
        <div className="segmented__options">
          {CONTACT_WAYS.map((k) => (
            <label key={k} className="segmented__option">
              <input type="radio" name="contactBy" value={k} checked={values.contactBy === k} onChange={() => set("contactBy", k)} />
              <span>{d.contactWays[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {values.interest === "buyer" && (
        <div className="form__pair">
          <div className="field">
            <label className="field__label" htmlFor={id("compound")}>
              {d.compound}
            </label>
            <select id={id("compound")} className="select" name="compound" value={values.compound} onChange={(e) => set("compound", e.target.value)}>
              <option value="">{d.anyCompound}</option>
              {COMPOUNDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name[locale]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={id("residence")}>
              {d.residence} <span className="field__optional">({d.optional})</span>
            </label>
            <input
              id={id("residence")}
              className="input"
              name="residence"
              dir="ltr"
              value={values.residence}
              onChange={(e) => set("residence", e.target.value.toUpperCase())}
              aria-describedby={values.residence ? id("residence-hint") : undefined}
            />
            {values.residence && (
              <p id={id("residence-hint")} className="field__hint">
                {d.residenceHint}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="field">
        <label className="field__label" htmlFor={id("message")}>
          {d.message} <span className="field__optional">({d.optional})</span>
        </label>
        <textarea
          id={id("message")}
          className="textarea"
          name="message"
          value={values.message}
          onChange={(e) => set("message", e.target.value)}
          aria-describedby={id("message-hint")}
        />
        <p id={id("message-hint")} className="field__hint">
          {d.messageHint}
        </p>
      </div>

      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            name="consent"
            checked={values.consent}
            onChange={(e) => set("consent", e.target.checked)}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={describe("consent")}
          />
          <span>{d.consent}</span>
        </label>
        {errorText("consent")}
      </div>

      <div>
        <button type="submit" className={buttonClass({ variant: "primary" })}>
          {d.submit}
        </button>
      </div>
    </form>
  );
}
