import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => {
  const font = (variable: string) => () => ({ variable, className: variable });
  return {
    Young_Serif: font("f-young"),
    Manrope: font("f-manrope"),
    Amiri: font("f-amiri"),
    IBM_Plex_Sans_Arabic: font("f-plex-ar"),
  };
});

const { default: RootLayout, metadata, viewport } = await import("./layout");

describe("root layout", () => {
  it("exposes all four brand font variables on <html>", () => {
    const html = renderToStaticMarkup(RootLayout({ children: <p>hi</p> } as never));
    expect(html).toContain('class="f-young f-manrope f-amiri f-plex-ar"');
    expect(html).toContain("<p>hi</p>");
  });

  it("sets the base for absolute canonical links only when the site address is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.resetModules();
    expect((await import("./layout")).metadata.metadataBase).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.example.com");
    vi.resetModules();
    expect(String((await import("./layout")).metadata.metadataBase)).toBe("https://www.example.com/");
    vi.unstubAllEnvs();
  });

  it("names the site Sawad Holding", () => {
    expect(metadata.applicationName).toBe("Sawad Holding");
    expect(metadata.title).toEqual({ default: "Sawad Holding", template: "%s · Sawad Holding" });
    expect(viewport.themeColor).toBe("#f6f2ea");
  });
});
