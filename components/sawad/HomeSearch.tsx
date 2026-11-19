import { COMPOUNDS, type Locale } from "@/lib/sawad/data";
import { BEDROOM_OPTIONS } from "@/lib/sawad/finder";
import { formatNumber } from "@/lib/sawad/format";
import { localizedPath, ROUTES, t } from "@/lib/sawad/i18n";
import { buttonClass } from "@/components/ui";

/**
 * The opening search. A plain GET form to the finder: works with no JavaScript,
 * and the finder reads the same query parameters (compound, type, beds).
 */
export function HomeSearch({ locale }: { locale: Locale }) {
  const d = t(locale).search;
  return (
    <form action={localizedPath(ROUTES.residences, locale)} method="get" role="search" aria-label={d.legend}>
      <fieldset className="search-strip">
        <legend>{d.legend}</legend>
        <label className="field">
          <span className="field__label">{d.compound}</span>
          <select name="compound" className="select" defaultValue="">
            <option value="">{d.anyCompound}</option>
            {COMPOUNDS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name[locale]}
                {locale === "ar" ? "، " : ", "}
                {c.city[locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">{d.kind}</span>
          <select name="type" className="select" defaultValue="">
            <option value="">{d.anyKind}</option>
            <option value="villa">{d.villa}</option>
            <option value="apartment">{d.apartment}</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">{d.bedrooms}</span>
          <select name="beds" className="select" defaultValue="">
            <option value="">{d.anyBedrooms}</option>
            {BEDROOM_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {formatNumber(n, locale)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass({ variant: "primary" })}>
          {d.submit}
        </button>
      </fieldset>
    </form>
  );
}
