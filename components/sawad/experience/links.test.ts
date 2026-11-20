import { describe, expect, it } from "vitest";
import { finderHref } from "./links";

describe("finderHref", () => {
  const home = { id: "ZH-V05", compound: "zaitun-hills" } as const;

  it("links the English finder with the compound and home selected", () => {
    expect(finderHref(home, "en")).toBe("/residences?compound=zaitun-hills&home=ZH-V05");
  });

  it("prefixes the Arabic route", () => {
    expect(finderHref(home, "ar")).toBe("/ar/residences?compound=zaitun-hills&home=ZH-V05");
  });
});
