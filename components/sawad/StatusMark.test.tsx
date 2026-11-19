// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusLabel, StatusMark } from "./StatusMark";

describe("StatusMark", () => {
  it.each(["available", "reserved", "sold"] as const)("draws a distinct, decorative shape for %s", (status) => {
    const { container } = render(<StatusMark status={status} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.dataset.shape).toBe(status);
  });

  it("uses different geometry per status, so colour is never the only cue", () => {
    const shapes = (["available", "reserved", "sold"] as const).map((s) => render(<StatusMark status={s} />).container.innerHTML.replace(/var\(--st-\w+\)/g, ""));
    expect(new Set(shapes).size).toBe(3);
  });

  it("pairs the mark with a visible word", () => {
    render(<StatusLabel status="reserved" label="Reserved" />);
    const label = screen.getByText("Reserved");
    expect(label.dataset.status).toBe("reserved");
    expect(label.querySelector("svg")).not.toBeNull();
  });
});
