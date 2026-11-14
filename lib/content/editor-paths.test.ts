import { describe, expect, it } from "vitest";
import { editEnableUrl, safeRelativePath } from "../../components/editable/paths";

describe("safeRelativePath", () => {
  it.each([
    ["/", "/"],
    ["/about", "/about"],
    ["/services/web-design", "/services/web-design"],
    ["/about?x=1#y", "/about"],
    ["/a/../b", "/b"],
  ])("accepts %s", (input, expected) => {
    expect(safeRelativePath(input)).toBe(expected);
  });

  it.each([
    "",
    "about",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\nfoo",
    "/\tfoo",
    "/" + "a".repeat(2_001),
  ])("rejects %j", (input) => {
    expect(safeRelativePath(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeRelativePath(undefined)).toBeNull();
    expect(safeRelativePath(42)).toBeNull();
    expect(safeRelativePath({ toString: () => "/" })).toBeNull();
  });
});

describe("editEnableUrl", () => {
  it("encodes the path", () => {
    expect(editEnableUrl("/about us")).toBe("/api/edit/enable?path=%2Fabout%20us");
  });
});
