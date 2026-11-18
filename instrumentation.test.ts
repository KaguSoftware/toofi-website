import { afterEach, describe, expect, it, vi } from "vitest";
import { setErrorSink } from "@/lib/monitoring";
import { onRequestError } from "./instrumentation";

afterEach(() => setErrorSink(null));

describe("onRequestError", () => {
  it("reports the route path as the component", async () => {
    const sink = vi.fn();
    setErrorSink(sink);
    await onRequestError(
      Object.assign(new Error("db down"), { digest: "d1" }),
      { path: "/admin/pages?x=1", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/admin/pages", routeType: "render", renderSource: "react-server-components", revalidateReason: undefined },
    );
    expect(sink.mock.calls[0][0]).toMatchObject({
      component: "/admin/pages",
      message: "db down",
      digest: "d1",
      context: { path: "/admin/pages?x=1", method: "GET", routeType: "render" },
    });
  });
});
