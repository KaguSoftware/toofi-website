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
};

/**
 * Loads one asset for the scene and says when the first frame may show. The poster hands over to
 * a finished picture, never to placeholders that pop into the real thing: an asset that arrives
 * after MODEL_TIMEOUT_MS is freed, not swapped in, and the timeout is reported as `sawad-scene`.
 * A change of `key` (a new tier or variant) starts again from a held, unsettled state.
 */
export function useTimedAsset<T>(key: string, { load, dispose, stage, context, enabled = true }: TimedAssetOptions<T>): TimedAssetState<T> {
  // Results are tagged with the key they belong to, so a new key reads as held without a reset.
  const [state, setState] = useState<TimedAssetState<T> & { key: string }>({ value: null, settled: false, key: "" });
  // The latest callbacks; the effect restarts only when the key changes.
  const latest = useRef({ load, dispose, stage, context });
  useEffect(() => {
    latest.current = { load, dispose, stage, context };
  });

  useEffect(() => {
    if (!enabled) return;
    let closed = false; // settled, or torn down
    let owned: T | null = null;
    const { load: start, stage: name, context: extra } = latest.current;
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
      if (owned) {
        const freed = owned;
        latest.current.dispose(freed);
        // Never hand out a freed asset, even if this key loads again.
        setState((s) => (s.value === freed ? { value: null, settled: false, key: "" } : s));
      }
    };
  }, [key, enabled]);

  if (!enabled) return { value: null, settled: true };
  // Until the load for this key settles, it is held and empty.
  if (state.key !== key) return { value: null, settled: false };
  return { value: state.value, settled: state.settled };
}
