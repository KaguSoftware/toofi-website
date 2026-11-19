// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { globalEditables } = await import("@/test/sawad-helpers");
const { SiteShell } = await import("./SiteShell");

describe("SiteShell", () => {
  it("wraps Arabic pages right-to-left with a translated skip link", () => {
    const { container } = render(
      <SiteShell g={globalEditables()} locale="ar" path="/ar">
        <main id="main">محتوى</main>
      </SiteShell>,
    );
    const site = container.querySelector(".site")!;
    expect(site.getAttribute("lang")).toBe("ar");
    expect(site.getAttribute("dir")).toBe("rtl");
    expect(screen.getByRole("link", { name: "انتقل إلى المحتوى" }).getAttribute("href")).toBe("#main");
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("contentinfo")).toBeDefined();
  });

  it("defaults to English", () => {
    const { container } = render(
      <SiteShell g={globalEditables()}>
        <main id="main">Content</main>
      </SiteShell>,
    );
    expect(container.querySelector(".site")!.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("Skip to content")).toBeDefined();
  });
});
