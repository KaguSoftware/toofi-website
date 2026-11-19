"use client";

import { useId } from "react";
import { BUDGET_BANDS, type Locale, type ResidenceStatus } from "@/lib/sawad/data";
import { ALL_STATUSES, BEDROOM_OPTIONS, budgetLabel, type FinderState } from "@/lib/sawad/finder";
import { formatNumber } from "@/lib/sawad/format";
import { t } from "@/lib/sawad/i18n";
import { StatusMark } from "../StatusMark";

type Props = {
  state: FinderState;
  locale: Locale;
  onChange: (patch: Partial<FinderState>) => void;
  comingSoon: boolean;
};

function Radio<T extends string>({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: T;
  checked: boolean;
  onSelect: (v: T) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="segmented__option">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onSelect(value)} />
      <span>{children}</span>
    </label>
  );
}

/** Native radios and checkboxes styled as segmented controls: keyboard and AT for free. */
export function FinderFilters({ state, locale, onChange, comingSoon }: Props) {
  const d = t(locale).finder;
  const uid = useId();
  const toggleStatus = (s: ResidenceStatus) => {
    const has = state.statuses.includes(s);
    const next = has ? state.statuses.filter((x) => x !== s) : [...state.statuses, s];
    if (next.length) onChange({ statuses: ALL_STATUSES.filter((x) => next.includes(x)) });
  };

  return (
    <div className="filters" role="group" aria-label={d.filters}>
      <div className="filters__row">
        <fieldset className="segmented">
          <legend>{d.kind}</legend>
          <div className="segmented__options">
            <Radio name={`${uid}-kind`} value="all" checked={state.kind === "all"} onSelect={() => onChange({ kind: "all" })}>
              {d.allKinds}
            </Radio>
            <Radio name={`${uid}-kind`} value="villa" checked={state.kind === "villa"} onSelect={() => onChange({ kind: "villa" })}>
              {d.villas}
            </Radio>
            <Radio
              name={`${uid}-kind`}
              value="apartment"
              checked={state.kind === "apartment"}
              onSelect={() => onChange({ kind: "apartment" })}
            >
              {d.apartments}
            </Radio>
          </div>
        </fieldset>
        <fieldset className="segmented">
          <legend>{d.bedrooms}</legend>
          <div className="segmented__options">
            <Radio name={`${uid}-beds`} value="any" checked={state.beds === null} onSelect={() => onChange({ beds: null })}>
              {d.anyBedrooms}
            </Radio>
            {BEDROOM_OPTIONS.map((n) => (
              <Radio key={n} name={`${uid}-beds`} value={String(n)} checked={state.beds === n} onSelect={() => onChange({ beds: n })}>
                {formatNumber(n, locale)}
              </Radio>
            ))}
          </div>
        </fieldset>
      </div>
      {!comingSoon && (
        <fieldset className="segmented">
          <legend>{d.status}</legend>
          <div className="segmented__options">
            {ALL_STATUSES.map((s) => (
              <label key={s} className="segmented__option">
                <input
                  type="checkbox"
                  checked={state.statuses.includes(s)}
                  // At least one status stays on, so the list can never be emptied by accident.
                  disabled={state.statuses.length === 1 && state.statuses[0] === s}
                  onChange={() => toggleStatus(s)}
                />
                <span>
                  <StatusMark status={s} />
                  {d.statuses[s]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="segmented">
        <legend>{d.budget}</legend>
        <div className="segmented__options">
          <Radio name={`${uid}-budget`} value="any" checked={state.budget === null} onSelect={() => onChange({ budget: null })}>
            {d.anyBudget}
          </Radio>
          {BUDGET_BANDS.map((b) => (
            <Radio key={b.id} name={`${uid}-budget`} value={b.id} checked={state.budget === b.id} onSelect={() => onChange({ budget: b.id })}>
              {budgetLabel(b.id, locale)}
            </Radio>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
