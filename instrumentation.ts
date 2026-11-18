import type { Instrumentation } from "next";
import { reportError } from "@/lib/monitoring";

/** Every server-side error (render, route, action, proxy) is reported with the route that produced it. */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  reportError(context.routePath, err, {
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
