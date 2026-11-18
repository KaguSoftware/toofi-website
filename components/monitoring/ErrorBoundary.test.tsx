// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb(): never {
  throw new Error("kaboom");
}

afterEach(() => {
  setErrorSink(null);
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when nothing fails", () => {
    render(
      <ErrorBoundary name="Ok">
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeTruthy();
  });

  it("shows the fallback and reports the failing component by name", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    setErrorSink(sink);
    render(
      <ErrorBoundary name="SiteHeader" fallback={<p>fallback</p>}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fallback")).toBeTruthy();
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0][0]).toMatchObject({ component: "SiteHeader", message: "kaboom" });
    expect(sink.mock.calls[0][0].context.componentStack).toBeTypeOf("string");
  });
});
