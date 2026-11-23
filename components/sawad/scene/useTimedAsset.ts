import { useEffect, useRef, useState } from "react";
import { reportError } from "@/lib/monitoring";

/** How long the first frame waits for a baked asset before going on without it. */
export const MODEL_TIMEOUT_MS = 8000;

export type TimedAssetState<T> = {
  /** The asset, or null while loading and after a failure or timeout. */
  value: T | null;
  /** True once the outcome is known: it is in, it failed, or it took too long. */
  settled: boolean;
};

export type TimedAssetOptions<T> = {
  /** Starts the load. It reports its own failures; a rejection just settles without the asset. */
  load: () => Promise<T>;
  /** Frees an asset that is no longer wanted (torn down, superseded, or too late). */
  dispose: (value: T) => void;
  /** Named in the timeout report, e.g. "compound-model". */
  stage: string;
  /** Extra context for the timeout report. */
  context?: Record<string, unknown>;
  /** False skips the load and settles at once with nothing (the asset is not needed). */
  enabled?: boolean;
  /**
   * Keeps the asset through a hide instead of freeing it. Next hides a route it leaves in React
   * `<Activity mode="hidden">`, which runs this hook's cleanup although the component (and the
   * canvas) stay; on the way back the asset used to be fetched, decoded and uploaded again, and the
   * site showed without its buildings meanwhile (ledger T14). With `keep`, a cleanup only schedules
   * the release: it is freed after `ms`, or at once when `alive()` says the canvas is gone (a real
   * unmount); a reveal before then takes the same asset back.
   */
  keep?: { ms: number; alive: () => boolean };
};

/** How long a hidden scene keeps its assets before freeing them (a visit to another page and back). */
export const KEEP_HIDDEN_MS = 180_000;

/**
 * Loads one asset for the scene and says when the first frame may show. The poster hands over to
 * a finished picture, never to placeholders that pop into the real thing: an asset that arrives
 * after MODEL_TIMEOUT_MS is freed, not swapped in, and the timeout is reported as `sawad-scene`.
 * A change of `key` (a new tier or variant) starts again from a held, unsettled state.
 */
export function useTimedAsset<T>(key: string, { load, dispose, stage, context, enabled = true, keep }: TimedAssetOptions<T>): TimedAssetState<T> {
  // Results are tagged with the key they belong to, so a new key reads as held without a reset.
  const [state, setState] = useState<TimedAssetState<T> & { key: string }>({ value: null, settled: false, key: "" });
  // The latest callbacks; the effect restarts only when the key changes.
  const latest = useRef({ load, dispose, stage, context, keep });
  useEffect(() => {
    latest.current = { load, dispose, stage, context, keep };
  });
  // An asset kept through a hide (`keep`), with the timers that will free it unless it is taken back.
  const kept = useRef<{ key: string; value: T; timers: ReturnType<typeof setTimeout>[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closed = false; // settled, or torn down
    let owned: T | null = null;
    const { load: start, stage: name, context: extra } = latest.current;

    // Frees an asset now, and never hands it out again.
    const free = (value: T) => {
      latest.current.dispose(value);
      setState((s) => (s.value === value ? { value: null, settled: false, key: "" } : s));
    };
    // Lets go of what this effect owns: freed now, or kept for a reveal (`keep`).
    const letGo = (value: T) => {
      const rule = latest.current.keep;
      if (!rule) return free(value);
      const release = () => {
        if (kept.current?.value !== value) return;
        for (const t of kept.current.timers) clearTimeout(t);
        kept.current = null;
        free(value);
      };
      kept.current = { key, value, timers: [setTimeout(() => !rule.alive() && release(), 0), setTimeout(release, rule.ms)] };
    };

    // A reveal: the asset kept through the hide is taken back as it is.
    const held = kept.current;
    if (held) {
      for (const t of held.timers) clearTimeout(t);
      kept.current = null;
      if (held.key === key) {
        owned = held.value;
        // Always a new state object: whoever uses the asset must re-render on a reveal, as it did when
        // the asset was loaded again. The post chain depends on it: a reveal builds a new composer, and
        // PostFX hands it to the render pass only when it re-renders (without this the hero stays black).
        setState({ value: held.value, settled: true, key });
        return () => letGo(held.value);
      }
      // Kept for another key (a new tier or variant): it is not coming back.
      free(held.value);
    }

    const timer = setTimeout(() => {
      if (closed) return;
      closed = true;
      reportError("sawad-scene", new Error(`${name} not ready after ${MODEL_TIMEOUT_MS} ms; going on without it`), { stage: name, ...extra });
      setState({ value: null, settled: true, key });
    }, MODEL_TIMEOUT_MS);

    start().then(
      (value) => {
        // Too late (timed out) or torn down: keep what is on screen and free the asset.
        if (closed) {
          latest.current.dispose(value);
          return;
        }
        closed = true;
        clearTimeout(timer);
        owned = value;
        setState({ value, settled: true, key });
      },
      // The loader has reported the failure; the scene goes on without it.
      () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        setState({ value: null, settled: true, key });
      },
    );

    return () => {
      closed = true;
      clearTimeout(timer);
      // Never hand out a freed asset, even if this key loads again (`free`).
      if (owned) letGo(owned);
    };
  }, [key, enabled]);

  if (!enabled) return { value: null, settled: true };
  // Until the load for this key settles, it is held and empty.
  if (state.key !== key) return { value: null, settled: false };
  return { value: state.value, settled: state.settled };
}
