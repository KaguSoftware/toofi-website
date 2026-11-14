export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-neutral-200" />
      <div className="h-40 animate-pulse rounded-xl bg-neutral-200" />
    </div>
  );
}
