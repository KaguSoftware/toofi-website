"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/admin/result";

/** Fires a toast when an action state changes (success message or error). */
export function useResultToast(state: ActionResult | null) {
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (state.message) toast.success(state.message);
    } else if (!state.fieldErrors) {
      toast.error(state.error);
    }
  }, [state]);
}
