import type { ReactNode } from "react";

export const inputCls =
  "block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent,#0071e3)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-500";

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent,#0071e3)] disabled:cursor-not-allowed disabled:opacity-60";
export const btnPrimary = `${btnBase} bg-neutral-900 text-white hover:bg-neutral-700`;
export const btnSecondary = `${btnBase} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100`;
export const btnDanger = `${btnBase} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
export const btnSmall = "!px-2.5 !py-1 !text-xs";

export function Field({
  label,
  htmlFor,
  errors,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  errors?: string[];
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-neutral-800">
        {label}
      </label>
      {children}
      {hint && !errors?.length && (
        <p id={`${htmlFor}-hint`} className="text-xs text-neutral-500">
          {hint}
        </p>
      )}
      {errors?.length ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-red-600">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "neutral" | "blue" | "red"; children: ReactNode }) {
  const tones = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    neutral: "bg-neutral-100 text-neutral-700",
    blue: "bg-blue-100 text-blue-800",
    red: "bg-red-100 text-red-800",
  } as const;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

export function ReadOnlyNote() {
  return (
    <p className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
      You have read-only access. Ask an admin for the editor role to make changes.
    </p>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
