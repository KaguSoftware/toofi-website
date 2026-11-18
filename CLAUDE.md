# Engineering rules (enforced)

## Testing: nothing ships untested
- **Every new or changed source file gets a test in the same change.** Foo.tsx -> Foo.test.tsx, foo.ts -> foo.test.ts, next to the file. This includes components, pages, route files, server actions, lib modules and templates.
- Component tests use `// @vitest-environment jsdom` and `@testing-library/react`. Test behaviour (render, interaction, error/empty states), not implementation.
- A bug fix starts with a failing test that reproduces it.
- Never delete or weaken a test, or lower a coverage threshold in `vitest.config.mts`, to make a change pass. Raise thresholds when coverage grows.
- `scripts/untested-baseline.json` lists legacy files without tests. It may only shrink. Never add to it. When you touch a legacy file, write its test and run `node scripts/check-tests.mjs --update`.

## Monitoring: every error names its source
- Report errors through `reportError(component, error, context)` from `lib/monitoring.ts`. The first argument is the component, route or module name. Never swallow an error in an empty `catch`.
- Wrap each new client component group that can fail in `<ErrorBoundary name="...">` (`components/monitoring/ErrorBoundary.tsx`).
- Every `error.tsx` / `global-error.tsx` must call `useReportError("<segment>", error)`.
- Server errors are reported automatically by `instrumentation.ts` (tagged with the route path).

## Before you say work is done
Run `npm run check` (typecheck, lint, test gate, tests with coverage). The git pre-commit hook (`.githooks/`, installed by `npm install` via `prepare`) runs the same command and blocks failing commits. Do not bypass it with `--no-verify`.
