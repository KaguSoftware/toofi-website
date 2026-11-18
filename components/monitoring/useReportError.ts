"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/monitoring";

/** Used by error.tsx / global-error.tsx files: reports the error once, tagged with the route segment. */
export function useReportError(component: string, error: Error & { digest?: string }) {
  useEffect(() => {
    reportError(component, error);
  }, [component, error]);
}
