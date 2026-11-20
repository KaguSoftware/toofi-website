import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ROOT_URL, candidate, resolve } from "./ts-loader.mjs";

const fromScene = new URL("components/sawad/scene/landscape.ts", ROOT_URL).href;
const file = (p: string) => pathToFileURL(fileURLToPath(new URL(p, ROOT_URL))).href;

describe("ts-loader", () => {
  it("completes extensionless relative imports to the .ts file beside them", () => {
    expect(candidate("./layout", fromScene)).toBe(file("components/sawad/scene/layout.ts"));
  });

  it("maps the @/ alias to the repo root", () => {
    expect(candidate("@/lib/sawad/wind", fromScene)).toBe(file("lib/sawad/wind.ts"));
  });

  it("leaves packages, explicit extensions and missing files to Node", () => {
    expect(candidate("three", fromScene)).toBeNull();
    expect(candidate("./layout.ts", fromScene)).toBeNull();
    expect(candidate("./no-such-module", fromScene)).toBeNull();
  });

  it("hands Node the completed URL, or the specifier untouched", async () => {
    const next = vi.fn(async (s: string) => ({ url: s }));
    await resolve("./layout", { parentURL: fromScene }, next);
    expect(next).toHaveBeenLastCalledWith(file("components/sawad/scene/layout.ts"), { parentURL: fromScene });
    await resolve("three", { parentURL: fromScene }, next);
    expect(next).toHaveBeenLastCalledWith("three", { parentURL: fromScene });
  });
});
