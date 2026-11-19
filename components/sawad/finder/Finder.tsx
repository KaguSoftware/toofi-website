"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { COMPOUNDS, getCompound, getResidence, residencesIn, sceneImage, type Locale } from "@/lib/sawad/data";
import {
  filterResidences,
  finderStateToQuery,
  isFiltered,
  mergeFinderQuery,
  parseFinderState,
  toggleCompare,
  type FinderState,
} from "@/lib/sawad/finder";
import { countHomes } from "@/lib/sawad/format";
import { t } from "@/lib/sawad/i18n";
import { VIEW_IDS, type ViewId } from "@/lib/sawad/tweaks";
import { ErrorBoundary } from "@/components/monitoring/ErrorBoundary";
import { buttonClass } from "@/components/ui";
import { SceneViewport } from "../scene/SceneViewport";
import type { SceneMarker } from "../scene/types";
import { StatusMark } from "../StatusMark";
import { ComparePanel } from "./ComparePanel";
import { FinderFilters } from "./FinderFilters";
import { ResidenceList } from "./ResidenceList";
import { residenceText } from "./residence-text";

const DESKTOP = "(min-width: 64rem)";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True on wide screens. Server and first paint assume mobile (no 3D autoload). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

export type FinderProps = {
  locale: Locale;
  /** Owner setting: false when Tweaks experience = "film" (no interactive scene). */
  showScene: boolean;
  defaultView?: ViewId;
  /** Server-rendered (editable) title and lead. */
  head: ReactNode;
};

export function Finder({ locale, showScene, defaultView = "aerial", head }: FinderProps) {
  const d = t(locale).finder;
  const params = useSearchParams();
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const [state, setState] = useState<FinderState>(() => parseFinderState(params, defaultView));
  const [fromScene, setFromScene] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const compound = getCompound(state.compound)!;
  const comingSoon = compound.status === "coming-soon";
  const all = useMemo(() => residencesIn(state.compound), [state.compound]);
  const results = useMemo(() => filterResidences(all, state), [all, state]);

  // A selection hidden by the filters is cleared, so the scene and list never disagree.
  const home = state.home && results.some((r) => r.id === state.home) ? state.home : null;

  // Mirror state into the URL (shareable searches) without a navigation.
  useEffect(() => {
    const query = mergeFinderQuery(window.location.search, finderStateToQuery({ ...state, home }, defaultView));
    if (window.location.search !== query) window.history.replaceState(null, "", `${pathname}${query}`);
  }, [state, home, pathname, defaultView]);

  const update = useCallback((patch: Partial<FinderState>) => setState((s) => ({ ...s, ...patch })), []);

  const select = useCallback(
    (id: string | null, source: "list" | "scene") => {
      setFromScene(source === "scene");
      update({ home: id });
      const r = getResidence(id);
      if (r) {
        const txt = residenceText(r, locale);
        setAnnouncement(`${r.id}, ${txt.title}, ${txt.status}, ${txt.price}`);
      }
    },
    [locale, update],
  );

  const markers: SceneMarker[] = useMemo(
    () =>
      results.map((r) => ({
        id: r.id,
        kind: r.kind,
        slot: r.slot,
        status: r.status,
        label: `${r.id}, ${residenceText(r, locale).title}`,
      })),
    [results, locale],
  );

  const resultsLabel = results.length ? countHomes(results.length, locale) : d.noResults;
  const poster = {
    src: sceneImage(compound.variant, state.view),
    alt: `${compound.name[locale]}, ${d.views[state.view]}. ${d.illustrative}`,
  };

  return (
    <>
      <div className="finder-head">
        <div className="container">
          <div className="finder-head__row">
            <div className="stack" style={{ ["--stack" as string]: "var(--space-3)" }}>
              {head}
            </div>
            <fieldset className="segmented">
              <legend>{d.compound}</legend>
              <div className="segmented__options">
                {COMPOUNDS.map((c) => (
                  <label key={c.id} className="segmented__option">
                    <input
                      type="radio"
                      name="finder-compound"
                      value={c.id}
                      checked={state.compound === c.id}
                      onChange={() => update({ compound: c.id, home: null })}
                    />
                    <span>{c.name[locale]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </div>

      <div className="finder">
        <div className="finder__stage">
          {showScene ? (
            <ErrorBoundary name="FinderScene" fallback={<Image src={poster.src} alt={poster.alt} fill sizes="60vw" style={{ objectFit: "cover" }} />}>
              <SceneViewport
                // Remount when the screen class flips, so autoLoad is read once per mount.
                key={isDesktop ? "desktop" : "mobile"}
                mode="explorer"
                variant={compound.variant}
                view={state.view}
                poster={poster}
                markers={markers}
                selectedId={home}
                onSelect={(id) => select(id, "scene")}
                labels={d.scene}
                autoLoad={isDesktop}
              />
            </ErrorBoundary>
          ) : (
            <Image src={poster.src} alt={poster.alt} fill sizes="(min-width: 64rem) 60vw, 100vw" style={{ objectFit: "cover" }} />
          )}
          <div className="finder__stage-ui">
            <div className="viewpoints" role="group" aria-label={d.viewpoint}>
              {VIEW_IDS.map((v) => (
                <button key={v} type="button" aria-pressed={state.view === v} onClick={() => update({ view: v })}>
                  {d.views[v]}
                </button>
              ))}
            </div>
            {!comingSoon && (
              <ul className="legend" aria-label={d.legend}>
                {(["available", "reserved", "sold"] as const).map((s) => (
                  <li key={s}>
                    <StatusMark status={s} />
                    {d.statuses[s]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="finder__panel">
          <FinderFilters state={state} locale={locale} onChange={update} comingSoon={comingSoon} />
          <div className="filters__foot" style={{ paddingBlock: "var(--space-4)" }}>
            <p className="results-count" role="status">
              {resultsLabel}
            </p>
            {isFiltered(state) && (
              <button
                type="button"
                className={buttonClass({ variant: "ghost", size: "sm" })}
                onClick={() => update({ kind: "all", beds: null, budget: null, statuses: ["available", "reserved"] })}
              >
                {d.reset}
              </button>
            )}
          </div>
          {comingSoon && (
            <p className="notice notice--brass" style={{ marginBottom: "var(--space-4)" }}>
              {d.comingSoon}
            </p>
          )}
          {results.length ? (
            <ResidenceList
              residences={results}
              locale={locale}
              selectedId={home}
              compare={state.compare}
              onSelect={(id) => select(id, "list")}
              onToggleCompare={(id) => update({ compare: toggleCompare(state.compare, id) })}
              revealSelected={fromScene}
            />
          ) : (
            <div className="notice">
              <strong>{d.noResults}</strong>
              <span>{d.noResultsHint}</span>
            </div>
          )}
          <ComparePanel
            ids={state.compare}
            locale={locale}
            onRemove={(id) => update({ compare: state.compare.filter((x) => x !== id) })}
            onClear={() => update({ compare: [] })}
          />
          <p className="visually-hidden" aria-live="polite">
            {announcement}
          </p>
        </div>
      </div>
    </>
  );
}
