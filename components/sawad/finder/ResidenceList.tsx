"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Locale, Residence } from "@/lib/sawad/data";
import { MAX_COMPARE } from "@/lib/sawad/finder";
import { t } from "@/lib/sawad/i18n";
import { buttonClass } from "@/components/ui";
import { StatusLabel, StatusMark } from "../StatusMark";
import { residenceText } from "./residence-text";

type Props = {
  residences: Residence[];
  locale: Locale;
  selectedId: string | null;
  compare: string[];
  onSelect: (id: string | null) => void;
  onToggleCompare: (id: string) => void;
  /** Scroll the selected row into view (set when the selection came from the 3D scene). */
  revealSelected: boolean;
};

/**
 * The accessible way through the 96 homes. Each row is a disclosure button; its
 * details expand inline right below it (no modal), and the 3D scene follows.
 */
export function ResidenceList({ residences, locale, selectedId, compare, onSelect, onToggleCompare, revealSelected }: Props) {
  const d = t(locale).finder;
  const selectedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (revealSelected && selectedRef.current) selectedRef.current.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedId, revealSelected]);

  return (
    <ul className="res-list" aria-label={d.listLabel}>
      {residences.map((r) => {
        const txt = residenceText(r, locale);
        const selected = r.id === selectedId;
        const detailId = `res-${r.id}`;
        const statusKey = txt.comingSoon ? "available" : r.status;
        const inCompare = compare.includes(r.id);
        const compareFull = !inCompare && compare.length >= MAX_COMPARE;
        return (
          <li key={r.id} className="res-row" data-selected={selected} ref={selected ? selectedRef : undefined}>
            <button
              type="button"
              className="res-row__button"
              aria-expanded={selected}
              aria-controls={selected ? detailId : undefined}
              onClick={() => onSelect(selected ? null : r.id)}
            >
              <StatusMark status={statusKey} className="res-row__mark" />
              <span className="res-row__main">
                <span className="res-row__title">
                  {txt.title}
                  <span className="visually-hidden">, {txt.status}</span>
                </span>
                <span className="res-row__meta">{txt.meta}</span>
              </span>
              <span className="res-row__side">
                <span className="res-row__price">{txt.price}</span>
                <span className="res-row__code">{r.id}</span>
              </span>
            </button>
            {selected && (
              <div id={detailId} className="res-detail" role="region" aria-label={`${r.id}, ${txt.title}`}>
                <div className="res-detail__head">
                  <div className="stack" style={{ ["--stack" as string]: "var(--space-2)" }}>
                    <StatusLabel status={statusKey} label={txt.status} />
                    <p className="t-small">{d.guidePrice}</p>
                    <p className="res-detail__price">{txt.price}</p>
                  </div>
                  <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => onSelect(null)}>
                    {d.close}
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>{d.bedrooms}</dt>
                    <dd>{txt.beds}</dd>
                  </div>
                  <div>
                    <dt>{d.built}</dt>
                    <dd>{txt.built}</dd>
                  </div>
                  {txt.land && (
                    <div>
                      <dt>{d.land}</dt>
                      <dd>{txt.land}</dd>
                    </div>
                  )}
                  {txt.floor && (
                    <div>
                      <dt>{d.floor}</dt>
                      <dd>{txt.floor}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{d.outlook}</dt>
                    <dd>{txt.outlook}</dd>
                  </div>
                  <div>
                    <dt>{d.handover}</dt>
                    <dd>{txt.handover}</dd>
                  </div>
                </dl>
                <p className="t-small">{d.priceNote}</p>
                <div className="res-detail__actions">
                  {txt.canEnquire && (
                    <Link href={txt.enquireHref} className={buttonClass({ variant: "primary" })}>
                      {txt.enquireLabel}
                    </Link>
                  )}
                  <button
                    type="button"
                    className={buttonClass({ variant: "secondary" })}
                    aria-pressed={inCompare}
                    disabled={compareFull}
                    aria-describedby={compareFull ? `${detailId}-full` : undefined}
                    onClick={() => onToggleCompare(r.id)}
                  >
                    {inCompare ? d.compareRemove : d.compareAdd}
                  </button>
                </div>
                {compareFull && (
                  <p id={`${detailId}-full`} className="t-small">
                    {d.compareFull}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
