// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import { useReportError } from "./useReportError";

afterEach(() => setErrorSink(null));

describe("useReportError", () => {
  it("reports once per error with the given component name", () => {
    const sink = vi.fn();
    setErrorSink(sink);
    const error = new Error("nope");
    const { rerender } = renderHook(() => useReportError("app/admin", error));
    rerender();
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "app/admin", message: "nope" });
  });
});
