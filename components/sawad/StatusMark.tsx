import type { ResidenceStatus } from "@/lib/sawad/data";

/**
 * Status is shape + colour + word, never colour alone. Shapes match the 3D markers:
 *   available = filled disc · reserved = half-filled ring · sold = grey disc with a cross.
 * Decorative (aria-hidden): the visible word next to it carries the meaning.
 */
export function StatusMark({ status, className = "status-mark" }: { status: ResidenceStatus; className?: string }) {
  const color = `var(--st-${status})`;
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false" data-shape={status}>
      {status === "available" && <circle cx="8" cy="8" r="6.5" fill={color} />}
      {status === "reserved" && (
        <>
          <circle cx="8" cy="8" r="5.75" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M8 2.25a5.75 5.75 0 0 1 0 11.5z" fill={color} />
        </>
      )}
      {status === "sold" && (
        <>
          <circle cx="8" cy="8" r="6.5" fill={color} />
          <path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function StatusLabel({ status, label }: { status: ResidenceStatus; label: string }) {
  return (
    <span className="status" data-status={status}>
      <StatusMark status={status} />
      {label}
    </span>
  );
}
