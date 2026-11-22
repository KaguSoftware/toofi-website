#!/usr/bin/env node
/** Prints the Markdown report of a saved request.mjs result: node scripts/perf/S7/show.mjs <result.json> */
import { readFileSync } from "node:fs";
import { report } from "./request.mjs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(report(r));
