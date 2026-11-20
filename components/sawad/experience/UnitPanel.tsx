"use client";

import Link from "next/link";
import type { Locale, Residence } from "@/lib/sawad/data";
import { t } from "@/lib/sawad/i18n";
import { buttonClass } from "@/components/ui";
import { residenceText } from "../finder/residence-text";
import { finderHref } from "./links";
import { StatusLabel } from "../StatusMark";

export type UnitPanelProps = {
  residence: Residence;
  locale: Locale;
  labels: { panelTitle: string; close: string; inFinder: string };
  onClose: () => void;
};

/**
 * The home a visitor clicked while exploring: its type, size, outlook, status and guide price
 * (the same sample data the residence finder shows), with the way on to the finder and to the
 * enquiry form. Not a dialog: it sits beside the scene and the scene stays usable.
 */
export function UnitPanel({ residence, locale, labels, onClose }: UnitPanelProps) {
  const d = t(locale).finder;
  const txt = residenceText(residence, locale);
  const facts: Array<[string, string]> = [
    [d.bedrooms, txt.beds],
    [d.built, txt.built],
    ...(txt.land ? ([[d.land, txt.land]] as Array<[string, string]>) : []),
    ...(txt.floor ? ([[d.floor, txt.floor]] as Array<[string, string]>) : []),
    [d.outlook, txt.outlook],
    [d.handover, txt.handover],
  ];
  return (
    <aside className="xp__unit" aria-label={labels.panelTitle}>
      <header className="xp__unit-head">
        <p className="xp__unit-code">{residence.id}</p>
        <button type="button" className="xp__btn xp__unit-close" aria-label={labels.close} onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
          </svg>
        </button>
      </header>
      <h3 className="xp__unit-title">{txt.title}</h3>
      <StatusLabel status={residence.status} label={txt.status} />
      <dl className="xp__unit-facts">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="xp__unit-price">
        <span>{d.guidePrice}</span>
        <strong>{txt.price}</strong>
      </p>
      <div className="xp__unit-actions">
        {txt.canEnquire ? (
          <Link href={txt.enquireHref} className={buttonClass({ variant: "primary", size: "sm" })}>
            {txt.enquireLabel}
          </Link>
        ) : null}
        <Link href={finderHref(residence, locale)} className="link-arrow">
          {labels.inFinder}
        </Link>
      </div>
    </aside>
  );
}
