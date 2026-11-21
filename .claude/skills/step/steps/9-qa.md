# Step 9: Acceptance

**Goal:** the compound checked against every line of `quality-bar.md`, the same way Zaitun was, with a written report.

Method: `docs/zaitun/QA.md` (production build from a throwaway worktree, Chrome through the MCP servers, the phone profile). Report: `docs/compounds/<slug>/QA.md` in the same shape: result per criterion with evidence, what was fixed, what was not, what is left for the owner.

## Skills

`webapp-testing`, `web-design-guidelines`, `next-bundle-optimizer`, `threejs-performance`, `arabic-writing`. MCP: playwright, chrome-devtools.

## Work

1. `npm run check`, then a production build.
2. Every criterion in `quality-bar.md`, EN and AR, desktop and the phone profile: fps, draw calls, triangles, load, Lighthouse accessibility, best practices and SEO, real clicks on homes, reduced motion, gating, walk mode and joystick, handover, console errors.
3. The "still open" measurements, reported next to Zaitun's.
4. Zaitun re-checked: its frames against step 0's capture and its QA numbers.
5. Small fixes the owner asks for may be made here (as Zaitun's QA did), each with a test; anything larger goes back to the step that owns it.

## Done when

- `docs/compounds/<slug>/QA.md` written; every bar line passes, or the owner has decided on each miss.
- Review page with the report; row 9 set to "awaiting approval". On approval, set the compound's row in `docs/compounds/STATUS.md` to **done**.
