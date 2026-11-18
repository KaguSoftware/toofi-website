// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import AdminError from "./error";

afterEach(() => setErrorSink(null));

describe("AdminError", () => {
  it("reports under the admin segment and offers retry", () => {
    const sink = vi.fn();
    setErrorSink(sink);
    const reset = vi.fn();
    render(<AdminError error={new Error("load failed")} reset={reset} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "app/admin/(panel)", message: "load failed" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
