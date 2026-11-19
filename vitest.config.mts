import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Note (Windows): run from a path with an uppercase drive letter (C:\...). A lowercase
// "c:\" cwd makes vitest load itself twice ("Cannot read properties of undefined (reading 'config')").
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", ".data/**"],
    environment: "node", // component tests opt in with `// @vitest-environment jsdom`
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "templates/**/*.{ts,tsx}", "instrumentation.ts"],
      exclude: ["**/*.test.*", "**/*.d.ts", "**/types.ts"],
      reporter: ["text-summary", "json-summary"],
      // Ratchet: raise these as coverage grows; never lower them.
      thresholds: { lines: 50, functions: 45, branches: 38, statements: 50 },
    },
  },
});
