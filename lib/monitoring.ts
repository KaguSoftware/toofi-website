/**
 * Central error reporting. Every caught error should say WHICH component or
 * route produced it, so a log line is enough to find the source.
 *
 * Default sink writes one structured JSON line to console.error. Plug in a
 * provider (Sentry, Logtail, ...) once with setErrorSink().
 */

export type ErrorReport = {
  /** Component, route or module that produced the error, e.g. "SiteHeader" or "/admin/pages". */
  component: string;
  message: string;
  stack?: string;
  /** Next.js error digest, links client reports to server logs. */
  digest?: string;
  /** Extra context: component stack, request path, route type... */
  context?: Record<string, unknown>;
  timestamp: string;
};

export type ErrorSink = (report: ErrorReport) => void;

const consoleSink: ErrorSink = (report) => {
  console.error(JSON.stringify({ level: "error", ...report }));
};

let sink: ErrorSink = consoleSink;

export function setErrorSink(next: ErrorSink | null): void {
  sink = next ?? consoleSink;
}

export function reportError(component: string, error: unknown, context?: Record<string, unknown>): ErrorReport {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : undefined;
  const report: ErrorReport = {
    component,
    message: err.message,
    stack: err.stack,
    digest,
    context,
    timestamp: new Date().toISOString(),
  };
  try {
    sink(report);
  } catch {
    // Monitoring must never take the app down.
    console.error(`[monitoring] sink failed while reporting error in ${component}`);
  }
  return report;
}
