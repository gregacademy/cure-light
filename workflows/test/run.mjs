#!/usr/bin/env node
// workflows/test/run.mjs — tier runner for the workflow test suite.
//
//   node workflows/test/run.mjs             # fast (default): fixtures + contracts
//   node workflows/test/run.mjs acceptance  # frozen-baseline byte-equality replay
//   node workflows/test/run.mjs compile     # draft toolchain conformance
//   node workflows/test/run.mjs host        # the same cases through the real pi CLI
//   node workflows/test/run.mjs prop        # generated-input properties (QuickCheck-style)
//   node workflows/test/run.mjs all
//
// Tiers are selected by filename suffix: *.acceptance.test.mjs, *.compile.test.mjs and
// *.host.test.mjs are opt-in; every other *.test.mjs is fast. The repo has no package.json,
// so this script is the single place that knows the tier globs and the `node --test`
// invocation. Real host runs never happen by default: they spawn pi and take seconds each.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ALL = readdirSync(HERE).filter((name) => name.endsWith(".test.mjs")).sort();
const OPT_IN = [".acceptance.test.mjs", ".compile.test.mjs", ".host.test.mjs", ".prop.test.mjs"];
const TIERS = {
  fast: ALL.filter((name) => !OPT_IN.some((suffix) => name.endsWith(suffix))),
  acceptance: ALL.filter((name) => name.endsWith(".acceptance.test.mjs")),
  compile: ALL.filter((name) => name.endsWith(".compile.test.mjs")),
  host: ALL.filter((name) => name.endsWith(".host.test.mjs")),
  prop: ALL.filter((name) => name.endsWith(".prop.test.mjs")),
  all: ALL,
};

const tier = process.argv[2] ?? "fast";
if (!(tier in TIERS)) {
  console.error(`unknown tier: ${tier} (expected ${Object.keys(TIERS).join("|")})`);
  process.exit(2);
}
const files = TIERS[tier].map((name) => path.join(HERE, name));
if (files.length === 0) {
  console.error(`no test files for tier: ${tier}`);
  process.exit(2);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
