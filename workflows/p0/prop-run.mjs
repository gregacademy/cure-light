#!/usr/bin/env node
// workflows/p0/prop-run.mjs — the property engine's CLI: generate, drive, shrink, replay.
//
//   node workflows/p0/prop-run.mjs --list
//   node workflows/p0/prop-run.mjs engine --cases 40 --seed 1
//   node workflows/p0/prop-run.mjs probe-refusal-writes-nothing --seed 7 --json
//   node workflows/p0/prop-run.mjs p0-close --driver stub --cases 10
//   node workflows/p0/prop-run.mjs <name> --spec '<store-spec JSON>' --driver host
//
// Exit codes: 0 every property held, 1 a counterexample was found, 2 usage/infrastructure
// error, 3 the workflow under test does not exist yet (skipped, red-first state).
//
// A failure is reported with the shrunk counterexample, its replay command and the retained
// case dir; `--seed S --cases N` replays the same trial sequence, `--spec` replays one spec.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROPERTY_GROUPS, allProperties, findProperty, groupProperties } from "./prop/catalog.mjs";
import { runProperty, runSingleSpec, summarizeProperties, DEFAULT_SEED } from "./prop/runner.mjs";
import { describeSpec } from "./prop/spec.mjs";

const USAGE = `prop-run.mjs — QuickCheck-style properties over generated run stores

usage:
  node workflows/p0/prop-run.mjs --list
  node workflows/p0/prop-run.mjs <property|group>... [options]

groups: ${Object.keys(PROPERTY_GROUPS).join(", ")}

options:
  --cases <n>        trials per property (default 25)
  --seed <n>         run seed: the same seed replays the same trial sequence (default ${DEFAULT_SEED})
  --driver <stub|host>  which host drives each trial (default stub; host costs ~2-4 s per run)
  --size <n>         initial generator size (default 0)
  --max-shrinks <n>  shrink budget per failure (default 80)
  --no-shrink        report the first counterexample without shrinking it
  --spec '<json>'    replay one explicit store spec instead of generating
  --timeout <ms>     per-run host timeout (default 600000)
  --keep             keep the case dir of every property, not only failing ones
  --json             write the full reports to stdout
  --quiet            only the summary line

evidence: a retained dir holds trials/<n>/ (store + cwd + host captures) and
property-report.json with the counterexample, its shrunk form and the replay commands.`;

function take(argv, index) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argv[index]}`);
  return value;
}

export function parseArgs(argv) {
  const options = {
    cases: 25,
    seed: DEFAULT_SEED,
    driver: "stub",
    size: 0,
    maxShrinks: 80,
    shrink: true,
    spec: null,
    timeout: 600_000,
    keep: false,
    json: false,
    quiet: false,
    list: false,
    selectors: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--list") options.list = true;
    else if (token === "--json") options.json = true;
    else if (token === "--keep") options.keep = true;
    else if (token === "--quiet") options.quiet = true;
    else if (token === "--no-shrink") options.shrink = false;
    else if (token === "--cases") options.cases = Number(take(argv, i++));
    else if (token === "--seed") options.seed = Number(take(argv, i++));
    else if (token === "--size") options.size = Number(take(argv, i++));
    else if (token === "--max-shrinks") options.maxShrinks = Number(take(argv, i++));
    else if (token === "--timeout") options.timeout = Number(take(argv, i++));
    else if (token === "--driver") options.driver = take(argv, i++);
    else if (token === "--spec") options.spec = take(argv, i++);
    else if (token.startsWith("--")) throw new Error(`unknown option: ${token}`);
    else options.selectors.push(token);
  }
  if (!["stub", "host"].includes(options.driver)) throw new Error(`unknown driver: ${options.driver}`);
  if (!Number.isInteger(options.cases) || options.cases < 1) throw new Error("--cases must be a positive integer");
  if (!Number.isInteger(options.seed)) throw new Error("--seed must be an integer");
  return options;
}

export function selectProperties(options) {
  const picked = [];
  for (const selector of options.selectors) {
    const direct = findProperty(selector);
    if (direct) picked.push(direct);
    else picked.push(...groupProperties(selector));
  }
  return picked;
}

function formatReport(report) {
  const state = report.skipped ? "SKIP" : report.ok ? "PASS" : "FAIL";
  const lines = [`${state}  ${report.property}  driver=${report.driver}  seed=${report.seed}  trials=${report.trials}${report.discarded ? ` discarded=${report.discarded}` : ""}  ${report.budget.ms}ms`];
  if (report.skipped) lines.push(`      ${report.skipped}`);
  if (report.infraError) lines.push(`      infrastructure error: ${report.infraError}`);
  for (const check of report.coverage.checks.filter((entry) => !entry.ok)) lines.push(`      cover ${check.label}: ${check.actualPct}% < ${check.minPct}%`);
  for (const failure of report.failures) {
    lines.push(`      counterexample (trial ${failure.trial}, trialSeed ${failure.trialSeed}): ${failure.description}`);
    lines.push(`      ${failure.detail}`);
    if (failure.shrunk) lines.push(`      shrunk x${failure.shrunk.steps}: ${failure.shrunk.description}`);
    if (failure.replay?.minimal) lines.push(`      replay: ${failure.replay.minimal.bySpec}`);
  }
  const top = report.coverage.labels.slice(0, 6).map((entry) => `${entry.label} ${entry.pct}%`).join(" · ");
  if (top) lines.push(`      coverage: ${top}`);
  if (!report.ok && report.paths.retained) lines.push(`      evidence: ${report.paths.caseRoot}`);
  return lines.join("\n");
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (problem) {
    stderr.write(`error: ${problem.message}\n\n${USAGE}\n`);
    return 2;
  }

  if (options.list) {
    stdout.write(allProperties().map((def) => `${def.group.padEnd(9)} ${def.name.padEnd(36)} ${def.title}`).join("\n") + "\n");
    return 0;
  }

  let selected;
  try {
    selected = selectProperties(options);
  } catch (problem) {
    stderr.write(`error: ${problem.message}\n`);
    return 2;
  }
  if (selected.length === 0) {
    stderr.write(`error: no properties selected\n\n${USAGE}\n`);
    return 2;
  }

  // Explicit-spec replay: run the same spec through every selected property.
  if (options.spec) {
    let spec;
    try {
      spec = JSON.parse(options.spec);
    } catch (problem) {
      stderr.write(`error: --spec is not valid JSON: ${problem.message}\n`);
      return 2;
    }
    const results = selected.map((def) => runSingleSpec(def, spec, { driver: options.driver, timeoutMs: options.timeout }));
    for (const result of results) {
      const state = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
      if (!options.json && !options.quiet) stdout.write(`${state}  ${result.property}  ${result.description}${result.ok ? "" : `\n      ${result.detail}`}\n`);
    }
    if (options.json) stdout.write(JSON.stringify({ spec, results: results.map(({ report, ...rest }) => rest) }, null, 2) + "\n");
    if (results.some((result) => result.skipped)) return 3;
    return results.every((result) => result.ok) ? 0 : 1;
  }

  const reports = [];
  for (const def of selected) {
    const report = runProperty(def, {
      cases: options.cases,
      seed: options.seed,
      size: options.size,
      driver: options.driver,
      timeoutMs: options.timeout,
      maxShrinks: options.shrink ? options.maxShrinks : 0,
      keep: options.keep,
    });
    reports.push(report);
    if (!options.json && !options.quiet) stdout.write(formatReport(report) + "\n");
  }

  const summary = summarizeProperties(reports);
  if (options.json) {
    stdout.write(JSON.stringify({ driver: options.driver, seed: options.seed, cases: options.cases, summary, reports }, null, 2) + "\n");
  } else if (!options.quiet && reports.length > 1) {
    stdout.write(`\n${summary.passed}/${summary.total} properties held over ${summary.trials} trials — driver=${options.driver}\n`);
  }

  if (summary.infra > 0) return 2;
  if (summary.skipped > 0 && summary.failed === 0) return 3;
  return summary.failed === 0 ? 0 : 1;
}

const invoked = process.argv[1] ? existsSync(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) process.exit(main(process.argv.slice(2)));
