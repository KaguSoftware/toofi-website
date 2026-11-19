// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HtmlLang } from "./HtmlLang";

describe("HtmlLang", () => {
  it("syncs <html lang/dir> with the page language", () => {
    const { rerender } = render(<HtmlLang lang="ar" dir="rtl" />);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    rerender(<HtmlLang lang="en" dir="ltr" />);
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });
});
