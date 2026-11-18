"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/monitoring";

type Props = {
  /** Required. Appears in every error report so the failing component is identifiable. */
  name: string;
  children: ReactNode;
  fallback?: ReactNode;
};

/** Catches render errors below it and reports them tagged with `name`. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(this.props.name, error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
