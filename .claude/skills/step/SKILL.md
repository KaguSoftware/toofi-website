---
name: step
description: Runs the new-compound pipeline one step at a time, so a new compound gets the full Zaitun Hills treatment (site plan, buildings, materials, landscape, baked light, film and posters, web experience, QA) with nothing cut. Use whenever the user says "/step <n>", "step 1", "step 4 <slug>", "step status", "step approve", "step list", or asks to start, continue or check a new compound.
---

# New-compound pipeline

One step per session. Each step ends with a review page and waits for the owner's approval; the next step starts only after that.

All pipeline files live next to this file. All compound files live in the main checkout, by absolute path, even when you work in a worktree:

- Main checkout: `/Users/majedahdab/Desktop/All repos/tofy-web/toofi-website/`
- Pipeline overview: `docs/compounds/STATUS.md` (step 0 and one row per compound)
- Active compound: `docs/compounds/ACTIVE` (one line: the slug)
- Per compound: `docs/compounds/<slug>/` with `BRIEF.md`, `STATUS.md`, `inputs/` (the owner's uploads), `review/`

## The steps

| Step | Name | File | Zaitun tracks it covers | Model · effort | Needs from the owner |
|---|---|---|---|---|---|
| 0 | Foundation (once, not per compound) | `steps/0-foundation.md` | none (refactor) | Fable 5.2 · xhigh | a decision on where new showcases appear |
| 1 | Intake and brief | `steps/1-intake.md` | project inputs | Opus 5.5 · high | everything they have: CAD, drawings, details, references |
| 2 | Site plan | `steps/2-site-plan.md` | 0 | Fable 5.2 · max | answers to the brief's gaps |
| 3 | New assets (only what the brief flags) | `steps/3-assets.md` | 1A, 2, 3A, plus new building types and new settings (water, surroundings) | Opus 5.5 · high | elevations or plans for new building types, finishes, planting |
| 4 | Model and landscape | `steps/4-model-landscape.md` | 1B, 3B, 6A | Opus 5.5 · high | nothing |
| 5 | Light and export | `steps/5-light-export.md` | 4, 6B | Opus 5.5 · xhigh | the real north direction (blocks) |
| 6 | Scene and story | `steps/6-scene-story.md` | 7B, 7C | Fable 5.2 · xhigh | approval of the captions |
| 7 | Posters, stills, film | `steps/7-film.md` | 5A, 5B | Opus 5.5 · high | logo and music (film only) |
| 8 | Wiring and performance | `steps/8-wiring.md` | 7D | Opus 5.5 · high | nothing |
| 9 | Acceptance | `steps/9-qa.md` | QA | Sonnet 5.5 · medium (escalate failures to Opus) | final names and prices, a real phone session |

## Session check (runs first, before anything else)

This session is running at effort: **${CLAUDE_EFFORT}**. Its model ID is the one stated in the system prompt ("The exact model ID is ...").

Each step requires exactly this model and effort:

| Step | Model ID | Effort | Switch commands |
|---|---|---|---|
| 0 | `claude-fable-5-2` | xhigh | `/model claude-fable-5-2` then `/effort xhigh` |
| 1 | `claude-opus-5-5` | high | `/model claude-opus-5-5` then `/effort high` |
| 2 | `claude-fable-5-2` | max | `/model claude-fable-5-2` then `/effort max` |
| 3 | `claude-opus-5-5` | high | `/model claude-opus-5-5` then `/effort high` |
| 4 | `claude-opus-5-5` | high | `/model claude-opus-5-5` then `/effort high` |
| 5 | `claude-opus-5-5` | xhigh | `/model claude-opus-5-5` then `/effort xhigh` |
| 6 | `claude-fable-5-2` | xhigh | `/model claude-fable-5-2` then `/effort xhigh` |
| 7 | `claude-opus-5-5` | high | `/model claude-opus-5-5` then `/effort high` |
| 8 | `claude-opus-5-5` | high | `/model claude-opus-5-5` then `/effort high` |
| 9 | `claude-sonnet-5-5` | medium | `/model claude-sonnet-5-5` then `/effort medium` |

For `step <n>`, compare this session's model ID and effort with row n **before any tool call, file read or skill load**:

- **Both match:** say one line, `Model and effort OK: <model> · <effort>.`, and continue.
- **Either is wrong:** reply with only this, then stop and do nothing else:

  > **Switch to <Model name> · <effort>** for step <n> (this session: <current model> · <current effort>).
  > Run `<the row's switch commands>`, then send `/step <n>` again.
  > Or reply `continue` to run it on this session as it is.

  List only the commands that need changing (just `/effort ...` if only the effort is wrong). Start the work only if the owner sends `/step <n>` again on the right settings, or replies `continue`.
- **Effort unreadable** (the bold value above is empty or still reads as a placeholder): check the model as above, and if it matches, say `Model OK. Can't read the effort here: run /effort status, it should be <effort>.` and continue.

`status`, `approve`, `list` and `use` skip the check.

The model and effort only need to be right for the session that does the step's work. Sessions may hand small, well-defined jobs to cheaper subagents, never the step's judgment calls.

## Arguments

- `<n> [slug]`: run step n. Slug defaults to `docs/compounds/ACTIVE`. Step 1 without a slug starts a new compound.
- `status [slug]`: summarise the compound's STATUS.md (and step 0) in a few lines: done, awaiting approval, next step, missing inputs.
- `approve [slug]`: mark the step that is awaiting approval as **approved**, then say which step is next and what it needs from the owner.
- `list`: every compound, its current step and state. `use <slug>`: make it the active compound.

## Running "step <n>"

0. **Session check** first (above).
1. **Resolve the compound** (not for step 0). If no slug resolves, ask for it in one question.
2. **Gate.** Step 0 must be **approved** in `docs/compounds/STATUS.md` before any other step. The previous step must be **approved** or **skipped**. If it is "awaiting approval", ask one question: "Approve step <n-1> (<name>)?"; on yes, mark it approved and continue. If it is not started or in progress, stop and say which step to run first. Step 3 may be "skipped (not needed)" when step 1 found no new assets.
3. **Session check** already done (see above); if it asked to switch, you have stopped.
4. **Worktree.** If another step or Zaitun track is in progress, work in a git worktree on branch `compound/<slug>/<n>`. Otherwise the main checkout is fine. Never commit, merge or push unless the owner asks.
5. **Mark the row "in progress"** in the compound's STATUS.md (branch, today's date).
6. **Read before working:** the step's file, `quality-bar.md`, the compound's `BRIEF.md` and `STATUS.md`, and the sections of `docs/zaitun/SHOWCASE_PROMPT.md` the step names. Then invoke every skill the step lists (one Skill call each) plus `read-the-damn-docs`, and check its MCP servers respond. Say in one line which loaded and which failed.
7. **Do the work.** Edit only the files the step owns. If an input is missing, ask with a short list instead of guessing. If the step needs a change in a file another step owns, stop and say so.
8. **Finish.** Run `npm run check`. Compare against `quality-bar.md` and say which numbers this step affects and where they stand. Publish a review page (Artifact) with the renders, screenshots, drawings and numbers, before and after where it applies. Set the row to "awaiting approval" with a one-line note and the review link. Tell the owner what the next step needs from them.

## Rules for every step

- **Where things come from.** Project inputs come from the compound's `BRIEF.md`. Standards come from `docs/zaitun/SHOWCASE_PROMPT.md`: CINEMATIC PRINCIPLES, the phase sections the step names, ACCEPTANCE CRITERIA. Where that prompt states something about Zaitun itself (Erbil, olives, its palette, its counts), that is Zaitun's input: use the brief instead. Numbers come from `quality-bar.md`.
- **No deductions.** Never take a lower-quality path to finish a step: no fallback model, no AO-only bake, no reused Zaitun posters or stills, no skipped LODs, no copied Zaitun branch with the numbers changed. If a quality-bar number can't be met, stop and present the options with their costs (as track 6B did) and let the owner decide.
- **Zaitun stays exactly as it is.** Every step keeps Zaitun's tests and its reference frames from step 0 unchanged (mean diff under 1/255). A step that changes shared code reruns them.
- **Every compound has its own setting.** Location, land, water, surroundings, climate, plants, sky, haze, sun and sound come from the brief's Setting section, never from Zaitun. Zaitun's stream, foothills, olive slopes, dusty-rose sky and Erbil sun are Zaitun's inputs only. A compound may have no water, flat land, a sea, a city around it, a desert, snow: whatever the brief says. If the brief leaves part of the setting open, ask; never fill it with Zaitun's.
- **One code path.** A new compound is data plus its own config files. If a step needs `if (slug === "...")` in shared code, the data model is missing a field: add the field (with a Zaitun value that keeps Zaitun identical) instead.
- **Owner uploads.** Files go in `docs/compounds/<slug>/inputs/`. If the owner attaches files in chat or gives paths, copy them there and list them in the brief's inputs table.
- **Repo rules apply** (`CLAUDE.md`, `AGENTS.md`): a test next to every changed source file, `reportError`, `ErrorBoundary`, read `node_modules/next/dist/docs/` before Next.js code, never bypass the pre-commit hook, `scripts/untested-baseline.json` only shrinks.
- **The model is scripted.** `scripts/blender/build_compound.py` and the layout data are the source. Never hand-edit a `.blend`. Only step 2 changes a compound's plan.
- Skills are the minimum, not the limit: invoke any other installed skill the work calls for.
