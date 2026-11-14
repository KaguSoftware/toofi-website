"use client";

import { useActionState, useRef } from "react";
import { uploadMedia } from "@/lib/admin/actions";
import { Field, Spinner, btnPrimary, inputCls } from "./ui";
import { useResultToast } from "./use-result-toast";

export function MediaUploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof uploadMedia>[0], fd: FormData) => {
    const res = await uploadMedia(prev, fd);
    if (res.ok) formRef.current?.reset();
    return res;
  }, null);
  useResultToast(state);
  const fe = (state && !state.ok ? state.fieldErrors : undefined) ?? {};
  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Image" htmlFor="file" errors={fe.file} hint="JPEG, PNG, WebP, GIF or AVIF, up to 8 MB.">
        <input
          id="file"
          name="file"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-2 file:py-1 file:text-xs`}
          aria-invalid={!!fe.file}
        />
      </Field>
      <Field label="Alt text" htmlFor="alt" errors={fe.alt} hint="Describe the image for screen readers.">
        <input id="alt" name="alt" maxLength={500} className={inputCls} />
      </Field>
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending && <Spinner />}
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
