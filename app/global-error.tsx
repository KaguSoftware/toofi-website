"use client";

import { useReportError } from "@/components/monitoring/useReportError";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportError("app/global-error", error);
  return (
    <html lang="en">
      <body>
        <div role="alert" style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Something went wrong</h1>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
