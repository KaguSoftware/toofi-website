import { describe, expect, it } from "vitest";
import { ADMIN_PACKAGES, bundlesTable, lazyTable, packageOf } from "./bundles.mjs";

describe("packageOf", () => {
  it("names the package for pnpm paths, scoped and plain", () => {
    expect(packageOf("[project]/node_modules/.pnpm/three@0.187.0/node_modules/three/build/three.core.js")).toBe("three");
    expect(packageOf("[project]/node_modules/.pnpm/@react-three+fiber@9.8.2_x/node_modules/@react-three/fiber/dist/index.js")).toBe("@react-three/fiber");
  });

  it("names the app folder for project files and the runtime for turbopack's own", () => {
    expect(packageOf("[project]/components/sawad/experience/ZaitunExperience.tsx")).toBe("app: components/sawad");
    expect(packageOf("[project]/app/layout.tsx")).toBe("app: app");
    expect(packageOf("[turbopack]/shared/runtime/runtime-utils.ts")).toBe("(turbopack runtime)");
  });

  it("lists the admin editor packages that must stay off public routes", () => {
    expect(ADMIN_PACKAGES).toEqual(expect.arrayContaining(["@tiptap/react", "@dnd-kit/core", "prosemirror-view"]));
  });
});

describe("tables", () => {
  it("shows each route's first-render JavaScript and its largest chunks", () => {
    const t = bundlesTable([{ route: "/(site)/[[...slug]]", js: { files: 2, raw: 300000, gzip: 100000, brotli: 90000 }, css: { files: 1, gzip: 20000 }, chunks: [{ file: "a.js", gzip: 60000 }, { file: "b.js", gzip: 40000 }] }]);
    expect(t).toContain("| /(site)/[[...slug]] | 100.0 KB | 90.0 KB | 300.0 KB | 2 | 20.0 KB | a.js 60.0 KB, b.js 40.0 KB |");
  });

  it("lists the chunks loaded on demand", () => {
    expect(lazyTable([{ file: "three.js", gzip: 334000, brotli: 275000, raw: 1200000 }])).toContain("| three.js | 334.0 KB | 275.0 KB | 1.20 MB |");
  });
});
