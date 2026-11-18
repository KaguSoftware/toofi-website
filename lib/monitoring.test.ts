import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError, setErrorSink, type ErrorReport } from "./monitoring";

afterEach(() => {
  setErrorSink(null);
  vi.restoreAllMocks();
});

describe("reportError", () => {
  it("names the component and carries message, stack and context", () => {
    const sink = vi.fn();
    setErrorSink(sink);
    const report = reportError("SiteHeader", new Error("boom"), { path: "/" });
    expect(sink).toHaveBeenCalledOnce();
    const sent = sink.mock.calls[0][0] as ErrorReport;
    expect(sent.component).toBe("SiteHeader");
    expect(sent.message).toBe("boom");
    expect(sent.stack).toContain("boom");
    expect(sent.context).toEqual({ path: "/" });
    expect(report).toBe(sent);
  });

  it("keeps the Next.js digest when present", () => {
    const sink = vi.fn();
    setErrorSink(sink);
    reportError("/admin", Object.assign(new Error("x"), { digest: "abc123" }));
    expect(sink.mock.calls[0][0].digest).toBe("abc123");
  });

  it("handles non-Error throwables", () => {
    const sink = vi.fn();
    setErrorSink(sink);
    reportError("X", "plain string");
    reportError("X", { weird: true });
    expect(sink.mock.calls[0][0].message).toBe("plain string");
    expect(sink.mock.calls[1][0].message).toBe("Unknown error");
  });

  it("writes structured JSON to console.error by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportError("Footer", new Error("bad"));
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", component: "Footer", message: "bad" });
  });

  it("never throws when the sink fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorSink(() => {
      throw new Error("sink down");
    });
    expect(() => reportError("X", new Error("y"))).not.toThrow();
  });
});
