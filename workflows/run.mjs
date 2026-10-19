#!/usr/bin/env node
// workflows/run.mjs — tier runner for the whole workflows tree.
//
//   node workflows/run.mjs             # fast (default): fixtures + contracts
//   node workflows/run.mjs acceptance  # frozen-baseline byte-equality replay
//   node workflows/run.mjs compile     # draft toolchain conformance
//   node workflows/run.mjs host        # the same cases through the real pi CLI
//   node workflows/run.mjs prop        # generated-input properties (QuickCheck-style)
//   node workflows/run.mjs all
//
// Test files live in three packages: workflows/testkit/ (harness and engine self-tests),
// workflows/p0/test/ (the p0-close suite) and workflows/pack/test/ (the p0-pack suite). Tiers
// are selected by the tier token at the end of the filename (`.../host.test.mjs` and
// `.../smoke.host.test.mjs` both count); every other *.test.mjs is fast. The repo has no
// package.json, so this script is the single place that knows the tier globs and the
// `node --test` invocation. Real host runs never happen by default: they spawn pi and take
// seconds each.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIRS = [path.join(HERE, "testkit"), path.join(HERE, "p0", "test"), path.join(HERE, "pack", "test")];
const ALL = TEST_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => path.join(dir, name)),
).sort();
const OPT_IN = /(acceptance|compile|host|prop)\.test\.mjs$/;
const TIERS = {
  fast: ALL.filter((name) => !OPT_IN.test(name)),
  acceptance: ALL.filter((name) => /acceptance\.test\.mjs$/.test(name)),
  compile: ALL.filter((name) => /compile\.test\.mjs$/.test(name)),
  host: ALL.filter((name) => /host\.test\.mjs$/.test(name)),
  prop: ALL.filter((name) => /prop\.test\.mjs$/.test(name)),
  all: ALL,
};

const tier = process.argv[2] ?? "fast";
if (!(tier in TIERS)) {
  console.error(`unknown tier: ${tier} (expected ${Object.keys(TIERS).join("|")})`);
  process.exit(2);
}
const files = TIERS[tier];
if (files.length === 0) {
  console.error(`no test files for tier: ${tier}`);
  process.exit(2);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
