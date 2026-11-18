// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import GlobalError from "./global-error";

afterEach(() => setErrorSink(null));

describe("GlobalError", () => {
  it("reports as app/global-error and lets the user retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    setErrorSink(sink);
    const reset = vi.fn();
    render(<GlobalError error={new Error("root failed")} reset={reset} />);
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "app/global-error", message: "root failed" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
