import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored Basis Universal transcoder (copied from three/examples/jsm/libs/basis).
    "public/sawad/basis/**",
    // Parallel agent worktrees (full checkouts) and Blender build output.
    ".claude/worktrees/**",
    "scripts/blender/out/**",
  ]),
]);

export default eslintConfig;
