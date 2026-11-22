#!/bin/sh
# Track S4: every measurement behind docs/zaitun/perf/findings/S4.md, in the order the findings
# use them. Each command takes the rig's lock for itself, so other sessions get turns in between.
# About 100 minutes on the charger (the rig refuses to time on battery or in Low Power Mode).
#
#   sh scripts/perf/S4/all.sh [out-dir]
set -u
cd "$(dirname "$0")/../../.."
OUT="${1:-scripts/perf/results/S4}"
run() {
  echo "── $*"
  node scripts/perf/S4/run.mjs "$@" --out "$OUT" || echo "FAILED: $*"
}

# What each frame is made of, and what it holds in memory.
run describe
run memory --shots dusk --name memory-dusk

# Frame time split by render pass: every camera at each tier's best level, the other levels at four.
run passes --tiers high --name passes-high
run passes --tiers high --levels 1,2 --shots opening,stop-1,stop-3,aerial --name passes-high-l12
run passes --tiers low --name passes-low
run passes --tiers low --levels 0 --shots opening,stop-1,stop-3 --name passes-low-l0

# Knock-outs: what each part of the frame costs (paired: shipped and changed frame in one load).
run knockouts --tiers high --shots stop-1,stop-3,aerial --variants shadow-off,shadow-frozen,shadow-2048,shadow-1024,shadow-one-lookup,no-ao,no-ao-rerenders,no-dof,no-bloom,no-smaa,no-vegetation,no-buildings,no-terrain,no-water,no-sky,no-life,no-shafts,flat,no-environment,sky-last,ground-last --reps 2 --name knockouts-high
run knockouts --tiers high --shots dusk --variants no-ao,no-ao-rerenders,no-dof,no-bloom,no-smaa,no-vegetation,no-buildings,flat --reps 2 --name knockouts-high-dusk
run knockouts --tiers high --shots stop-1,stop-3 --variants level-2-chain --reps 2 --name knockouts-ao
run knockouts --tiers low --shots stop-1,stop-3,aerial --reps 2 --name knockouts-low

# Levels and pixel ratios, each against the tier's best level.
run levels --shots stop-1,stop-3 --reps 2

# Fragments shaded per material: the shipped draw order at every camera, the two reorderings at four.
run overdraw --variants base --name overdraw
run overdraw --variants sky-last,ground-last --shots opening,stop-1,stop-3,aerial --name overdraw-reordered

# The first frames.
run startup --reps 3

# Candidate fixes against the shipped picture.
run look --shots opening,stop-1,stop-3,stop-5,aerial,dusk --variants shadow-frozen,shadow-2048,shadow-1024,shadow-one-lookup,no-ao-rerenders,no-environment,sky-last,ground-last
run look --tiers high --shots opening,stop-1,stop-3,stop-5,aerial,dusk --variants level-2-chain --name look-ao

echo "── done: $OUT"
