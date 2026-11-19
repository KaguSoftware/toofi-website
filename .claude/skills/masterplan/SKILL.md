---
name: masterplan
description: Starts or resumes a phase or track of the Zaitun Hills showcase plan (the cinematic film and the 3D web experience). Use whenever the user says "masterplan phase <id>" (for example "masterplan phase 0", "masterplan phase 7A", "masterplan phase 1"), "masterplan status", "approve phase <id>", or asks to continue the masterplan or the Zaitun showcase.
---

# Masterplan

The plan lives in three files. Read all three before doing anything else:

1. `docs/zaitun/SHOWCASE_PROMPT.md`: the full brief (role, inputs, phases 0–7, deliverables, acceptance criteria, work style). Follow it as your instructions for the track.
2. `docs/zaitun/PARALLEL_PLAN.md`: the tracks, what each one needs approved first, which files each one owns, the waves and the parallel-session rules.
3. `docs/zaitun/STATUS.md`: what is approved, in progress or blocked, and the owner inputs still missing.

These files live in the main checkout at `/Users/majedahdab/Desktop/All repos/tofy-web/toofi-website/docs/zaitun/`. Always read and update them there, by that absolute path, even when you work in a worktree: STATUS.md is shared by every parallel session, and a worktree may not contain these files at all.

Phase numbers follow the prompt: 0 is the 28 ha site masterplan, 1 is modelling, through 7, the web experience.

## "masterplan phase <id>"

1. **Resolve the track.** An exact ID (`0`, `1A`, `7B`, `QA`) is that track. A bare number with several tracks (`1`, `3`, `5`, `6`, `7`) means the first track of that phase, in the order the table lists them, whose prerequisites are approved and which is not approved yet. If it is still ambiguous, ask with one short question listing the options.
2. **Check prerequisites** in STATUS.md against the "Needs approved first" column. If any prerequisite is not **approved**, don't start. Say which ones are missing and which tracks can start right now instead, then stop.
3. **Check for parallel work.** If any other track is "in progress" in STATUS.md, work in a git worktree on branch `zaitun/<id>`. Otherwise you may work in the main checkout. Never commit, merge or push unless the user asks.
4. **Check the model and effort.** Look up the track's suggested model and effort in the "Session order" section of PARALLEL_PLAN.md. If this session runs a different model, say so in one line (for example "Suggested: Fable 5.2 at xhigh effort, running Sonnet 5.5; switch or continue?") and wait for the answer. If the model matches, just mention the suggested effort in one line and continue.
5. **Mark the row "in progress"** in STATUS.md (your row only, with the branch and today's date).
6. **Invoke every skill listed for the track** in the "Skills and tools per track" table of PARALLEL_PLAN.md, one Skill tool call each, before any other work, plus `read-the-damn-docs`. Then check that the track's MCP servers respond (for `blender`: Blender open with the add-on's server running; if it isn't, ask the user to start it, and meanwhile use the headless build scripts). Tell the user in one line which skills loaded and which failed.
7. **Do the work right away.** Don't re-ask questions the prompt already answers. Edit only the files your track owns. If you need a change in a file another track owns, stop and say so.
8. **Finish the track.** Run `npm run check` for any code change. Show the result (screenshots, renders, plan drawing, test output). Set your row to "awaiting approval" with a one-line note, then wait for the user.

## "approve phase <id>"

Set that row to **approved** with today's date. Then tell the user which tracks just became startable, so they can open new sessions for them.

## "masterplan status"

Summarise STATUS.md in a few lines: approved, in progress, awaiting approval, startable now, blocked, and missing owner inputs.

## Always

- The repo's own rules apply (`CLAUDE.md`, `AGENTS.md`): tests next to every changed source file, `reportError`, `ErrorBoundary`, read `node_modules/next/dist/docs/` before Next.js code, never bypass the pre-commit hook.
- Skills are not optional: the per-track list in PARALLEL_PLAN.md is the minimum to invoke. Invoke any other installed skill too when the work calls for it.
- The Blender model is built by `scripts/blender/build_compound.py`. Never hand-edit a `.blend`.
- Never guess the layout. `components/sawad/scene/layout.ts` is the source of truth; only track 0 changes it.
