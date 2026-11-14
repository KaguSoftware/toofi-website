"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listBlockRevisions, restoreRevision, type RevisionSummary } from "@/lib/content/actions";
import { richTextToPlain } from "@/lib/content/render-rich";
import type { BlockContent } from "@/lib/content/schemas";
import type { FocusedBlock } from "./context";

function preview(content: BlockContent): string {
  switch (content.type) {
    case "text":
      return content.value.text;
    case "richtext":
      return richTextToPlain(content.value);
    case "link":
      return `${content.value.text} → ${content.value.href}`;
    case "image":
      return content.value.alt || content.value.src.split("/").pop() || "Image";
    case "list":
      return `${content.value.items.length} item${content.value.items.length === 1 ? "" : "s"}`;
  }
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type State = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; revisions: RevisionSummary[] };

export function HistoryPanel({
  block,
  onRestored,
}: {
  block: FocusedBlock;
  /** Called after a revision was restored into the draft. */
  onRestored: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBlockRevisions(block.scope, block.key).then(
      (res) => {
        if (cancelled) return;
        setState(res.ok ? { status: "ready", revisions: res.revisions } : { status: "error", error: res.error });
      },
      () => !cancelled && setState({ status: "error", error: "Could not load history." }),
    );
    return () => {
      cancelled = true;
    };
  }, [block.scope, block.key]);

  const restore = async (id: string) => {
    setRestoring(id);
    try {
      const res = await restoreRevision(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Version restored as a draft.");
      onRestored();
    } catch {
      toast.error("Could not restore this version.");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="toofi-history">
      <p className="toofi-history-title">
        History · <code>{block.key}</code>
      </p>
      {state.status === "loading" && (
        <p className="toofi-hint" role="status">
          Loading…
        </p>
      )}
      {state.status === "error" && (
        <p className="toofi-error" role="alert">
          {state.error}
        </p>
      )}
      {state.status === "ready" && state.revisions.length === 0 && (
        <p className="toofi-hint">No published versions yet.</p>
      )}
      {state.status === "ready" && state.revisions.length > 0 && (
        <ol className="toofi-history-list">
          {state.revisions.map((r) => (
            <li key={r.id}>
              <div className="toofi-history-meta">
                <time dateTime={r.createdAt}>{dateFmt.format(new Date(r.createdAt))}</time>
                <span className="toofi-history-preview">{preview(r.content) || "(empty)"}</span>
              </div>
              <button
                type="button"
                className="toofi-btn"
                disabled={restoring !== null}
                aria-busy={restoring === r.id || undefined}
                onClick={() => restore(r.id)}
              >
                {restoring === r.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
