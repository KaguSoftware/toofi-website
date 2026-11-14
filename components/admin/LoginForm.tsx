"use client";

import { useActionState } from "react";
import { login } from "@/lib/admin/actions";
import { Field, Spinner, btnPrimary, inputCls } from "./ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email" errors={fe?.email}>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus className={inputCls} aria-invalid={!!fe?.email} />
      </Field>
      <Field label="Password" htmlFor="password" errors={fe?.password}>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} aria-invalid={!!fe?.password} />
      </Field>
      <div aria-live="polite">
        {state && !state.ok && !fe && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
      </div>
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        {pending && <Spinner />}
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
