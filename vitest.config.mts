import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Note (Windows): run from a path with an uppercase drive letter (C:\...). A lowercase
// "c:\" cwd makes vitest load itself twice ("Cannot read properties of undefined (reading 'config')").
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", ".data/**"],
    environment: "node",
  },
});
