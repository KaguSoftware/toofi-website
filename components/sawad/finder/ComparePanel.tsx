"use client";

import { useId, useState } from "react";
import { getResidence, type Locale, type Residence } from "@/lib/sawad/data";
import { formatNumber } from "@/lib/sawad/format";
import { t } from "@/lib/sawad/i18n";
import { buttonClass } from "@/components/ui";
import { residenceText } from "./residence-text";

/** Side-by-side comparison of up to three homes (they may be in different compounds). */
export function ComparePanel({
  ids,
  locale,
  onRemove,
  onClear,
}: {
  ids: string[];
  locale: Locale;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const d = t(locale).finder;
  const tableId = useId();
  // Collapsed by default: a sticky bar that never hides the list behind it.
  const [open, setOpen] = useState(false);
  const homes = ids.map((id) => getResidence(id)).filter((r): r is Residence => Boolean(r));
  if (!homes.length) return null;
  const rows = homes.map((r) => residenceText(r, locale));
  const line = (label: string, get: (i: number) => string | null) => (
    <tr>
      <th scope="row">{label}</th>
      {rows.map((_, i) => (
        <td key={homes[i].id}>{get(i) ?? "–"}</td>
      ))}
    </tr>
  );

  return (
    <section className="compare" aria-label={d.compareTitle}>
      <div className="compare__head">
        <h2 className="t-label" style={{ color: "var(--fg)" }}>
          {d.compareTitle} ({formatNumber(homes.length, locale)}/{formatNumber(3, locale)})
        </h2>
        <div className="compare__actions">
          <button
            type="button"
            className={buttonClass({ variant: open ? "secondary" : "primary", size: "sm" })}
            aria-expanded={open}
            aria-controls={tableId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? d.compareHide : d.compareShow}
          </button>
          <button type="button" className={buttonClass({ variant: "ghost", size: "sm" })} onClick={onClear}>
            {d.compareClear}
          </button>
        </div>
      </div>
      <div id={tableId} className="compare__scroll" hidden={!open}>
        <table className="table">
          <thead>
            <tr>
              <td />
              {homes.map((r) => (
                <th key={r.id} scope="col">
                  <span className="res-row__code">{r.id}</span>
                  <br />
                  <button
                    type="button"
                    className="compare__remove"
                    onClick={() => onRemove(r.id)}
                    aria-label={`${d.compareRemove}: ${r.id}`}
                  >
                    {d.compareRemove}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {line(t(locale).facts.holding, (i) => rows[i].compound)}
            {line(d.kind, (i) => rows[i].title)}
            {line(d.bedrooms, (i) => rows[i].beds)}
            {line(d.built, (i) => rows[i].built)}
            {line(d.land, (i) => rows[i].land)}
            {line(d.floor, (i) => rows[i].floor)}
            {line(d.outlook, (i) => rows[i].outlook)}
            {line(t(locale).facts.status, (i) => rows[i].status)}
            {line(d.guidePrice, (i) => rows[i].price)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
