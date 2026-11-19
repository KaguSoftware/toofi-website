import {
  BUDGET_BANDS,
  COMPOUNDS,
  getCompound,
  type BudgetBandId,
  type CompoundId,
  type Residence,
  type ResidenceKind,
  type ResidenceStatus,
} from "./data";
import { parseView, type ViewId } from "./tweaks";

/** Finder state, mirrored in the URL so a search can be shared or bookmarked. */
export type FinderState = {
  compound: CompoundId;
  kind: ResidenceKind | "all";
  beds: number | null;
  statuses: ResidenceStatus[];
  budget: BudgetBandId | null;
  home: string | null;
  view: ViewId;
  compare: string[];
};

export const ALL_STATUSES: ResidenceStatus[] = ["available", "reserved", "sold"];
export const DEFAULT_STATUSES: ResidenceStatus[] = ["available", "reserved"];
export const BEDROOM_OPTIONS = [2, 3, 4, 5];
export const MAX_COMPARE = 3;

type ParamsLike = { get(name: string): string | null };

export function defaultFinderState(view: ViewId = "aerial"): FinderState {
  return {
    compound: COMPOUNDS[0].id,
    kind: "all",
    beds: null,
    statuses: [...DEFAULT_STATUSES],
    budget: null,
    home: null,
    view,
    compare: [],
  };
}

export function parseFinderState(params: ParamsLike, defaultView: ViewId = "aerial"): FinderState {
  const base = defaultFinderState(defaultView);
  const compound = getCompound(params.get("compound"))?.id ?? base.compound;
  const kindRaw = params.get("type");
  const kind = kindRaw === "villa" || kindRaw === "apartment" ? kindRaw : "all";
  const bedsN = Number(params.get("beds"));
  const beds = BEDROOM_OPTIONS.includes(bedsN) ? bedsN : null;
  const statusRaw = params.get("status");
  const statuses = statusRaw
    ? ALL_STATUSES.filter((s) => statusRaw.split(",").includes(s))
    : base.statuses;
  const budgetRaw = params.get("budget");
  const budget = BUDGET_BANDS.some((b) => b.id === budgetRaw) ? (budgetRaw as BudgetBandId) : null;
  const home = params.get("home")?.toUpperCase() || null;
  const compare = (params.get("compare") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_COMPARE);
  return {
    compound,
    kind,
    beds,
    statuses: statuses.length ? statuses : base.statuses,
    budget,
    home,
    view: parseView(params.get("view"), defaultView),
    compare,
  };
}

/** Query keys the finder owns. Anything else in the URL (utm_*, capture…) is preserved. */
export const FINDER_KEYS = ["compound", "type", "beds", "status", "budget", "home", "view", "compare"] as const;

/** Replace the finder's keys in an existing query string, keeping all other parameters. */
export function mergeFinderQuery(currentSearch: string, finderQuery: string): string {
  const out = new URLSearchParams(currentSearch);
  for (const k of FINDER_KEYS) out.delete(k);
  new URLSearchParams(finderQuery).forEach((v, k) => out.set(k, v));
  const q = out.toString();
  return q ? `?${q}` : "";
}

/** Serialise only what differs from the defaults, to keep URLs short. */
export function finderStateToQuery(s: FinderState, defaultView: ViewId = "aerial"): string {
  const p = new URLSearchParams();
  const d = defaultFinderState(defaultView);
  if (s.compound !== d.compound) p.set("compound", s.compound);
  if (s.kind !== "all") p.set("type", s.kind);
  if (s.beds) p.set("beds", String(s.beds));
  const statusKey = ALL_STATUSES.filter((x) => s.statuses.includes(x)).join(",");
  if (statusKey !== d.statuses.join(",")) p.set("status", statusKey);
  if (s.budget) p.set("budget", s.budget);
  if (s.home) p.set("home", s.home);
  if (s.view !== d.view) p.set("view", s.view);
  if (s.compare.length) p.set("compare", s.compare.join(","));
  const q = p.toString();
  return q ? `?${q}` : "";
}

export function matchesBudget(price: number, budget: BudgetBandId | null): boolean {
  if (!budget) return true;
  const band = BUDGET_BANDS.find((b) => b.id === budget)!;
  return price >= band.min && price < band.max;
}

export function filterResidences(list: Residence[], s: FinderState): Residence[] {
  return list.filter(
    (r) =>
      r.compound === s.compound &&
      (s.kind === "all" || r.kind === s.kind) &&
      (s.beds === null || r.bedrooms === s.beds) &&
      s.statuses.includes(r.status) &&
      matchesBudget(r.priceUsd, s.budget),
  );
}

export function isFiltered(s: FinderState): boolean {
  return (
    s.kind !== "all" ||
    s.beds !== null ||
    s.budget !== null ||
    ALL_STATUSES.filter((x) => s.statuses.includes(x)).join(",") !== DEFAULT_STATUSES.join(",")
  );
}

/** Budget band labels: "Under $300k", "$300k to $600k" / "من ٣٠٠ إلى ٦٠٠ ألف دولار". */
export function budgetLabel(id: BudgetBandId, locale: "en" | "ar"): string {
  const band = BUDGET_BANDS.find((b) => b.id === id)!;
  const k = (n: number) => new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-arab" : "en-GB").format(n / 1000);
  if (locale === "ar") {
    if (band.min === 0) return `أقل من ${k(band.max)} ألف دولار`;
    if (band.max === Infinity) return `${k(band.min)} ألف دولار فأكثر`;
    return `من ${k(band.min)} إلى ${k(band.max)} ألف دولار`;
  }
  if (band.min === 0) return `Under $${k(band.max)}k`;
  if (band.max === Infinity) return `$${k(band.min)}k and above`;
  return `$${k(band.min)}k to $${k(band.max)}k`;
}

export function toggleCompare(compare: string[], id: string): string[] {
  if (compare.includes(id)) return compare.filter((x) => x !== id);
  if (compare.length >= MAX_COMPARE) return compare;
  return [...compare, id];
}
