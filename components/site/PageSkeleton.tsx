/** Suspense fallback while a page streams in. Quiet, layout-stable, motion-safe. */
export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="container" style={{ paddingBlock: "var(--section-y)" }}>
      <div className="skeleton" style={{ height: "3.5rem", width: "min(100%, 28rem)", margin: "0 auto" }} />
      <div className="skeleton" style={{ height: "1.25rem", width: "min(100%, 20rem)", margin: "1.5rem auto 0" }} />
      <div className="skeleton" style={{ height: "20rem", marginTop: "3rem" }} />
    </div>
  );
}
