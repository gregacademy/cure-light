#!/usr/bin/env node
// workflows/testkit/host-run.mjs — the orchestration entry point for the workflow test harness.
//
// An agent (or a human) drives the harness with this CLI: pick cases, run them through the
// stub host or the real pi CLI, read one JSON report per case, act on the failure detail
// and the retained case dir. Deterministic exit codes:
//
//   0  every selected case passed (or was skipped)
//   1  at least one case failed an assertion
//   2  usage or harness error (unknown case, no selection, driver blew up)
//
//   node workflows/testkit/host-run.mjs --list
//   node workflows/testkit/host-run.mjs smoke --driver host
//   node workflows/testkit/host-run.mjs merge-valid --reruns 3
//   node workflows/testkit/host-run.mjs p0-close --driver stub
//   node workflows/testkit/host-run.mjs --all --driver host --json
//   node workflows/testkit/host-run.mjs --live --workflow workflows/p0/p0-close.js \
//     --store /tmp/run-copy --args "--verifier ... --input-ceiling-bytes 196608 ..." \
//     --workflow-time 300000 --json
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SMOKE_CASES } from "./cases.mjs";
import { P0_CLOSE_BASELINE_CASE, P0_CLOSE_CASES } from "../p0/cases.mjs";
import { runCase, summarizeReports } from "./casekit.mjs";
import { hostInvocation, HOST_FLAGS } from "./hostdriver.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

/** Every case group the CLI can run: the smoke self-test plus each workflow's table. */
const CASE_GROUPS = {
  smoke: SMOKE_CASES,
  "p0-close": [...P0_CLOSE_CASES, P0_CLOSE_BASELINE_CASE],
};

const allCases = () => Object.values(CASE_GROUPS).flat();
const findCase = (id) => allCases().find((spec) => spec.id === id) ?? null;
function groupCases(group) {
  const specs = CASE_GROUPS[group];
  if (!specs) throw new Error(`unknown case group: ${group} (expected ${Object.keys(CASE_GROUPS).join(", ")})`);
  return specs;
}

const USAGE = `host-run.mjs — run workflow cases through the stub host or the real pi CLI

usage:
  node workflows/testkit/host-run.mjs --list
  node workflows/testkit/host-run.mjs <case-id|group>... [options]

groups: ${Object.keys(CASE_GROUPS).join(", ")}

options:
  --driver <stub|host>   which host runs the workflow (default: host)
  --reruns <n>           runs per case; the digest must match (default: 2 on host, 1 on stub)
  --timeout <ms>         per-run host timeout (default 600000)
  --json                 write the full report object to stdout
  --keep                 keep every case dir, not only the failing ones
  --case-dir <dir>       reuse one case dir for a single case (debugging)
  --live                 ad-hoc single run: --workflow <path> --args "<verbatim args>"
  --workflow <path>      workflow file for --live (absolute or repo-relative)
  --args "<string>"      verbatim workflow args for --live
  --store <path>         --live sugar: prepended as '--store <abs path>' to --args
  --workflow-time <ms>   --live sugar: soft wall-clock target handed to pi
  --list                 list cases (id, group, title) and exit
  --quiet                only the summary line

evidence: <caseDir> holds run/ (the store), cwd/ (workflow shell cwd), host/ (pi captures)
and report.json; failing cases always keep their dir.`;

function take(argv, index) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${argv[index]}`);
  return value;
}

export function parseArgs(argv) {
  const options = { driver: "host", json: false, keep: false, quiet: false, reruns: null, timeout: 600_000, caseDir: null, list: false, live: false, workflow: null, args: null, store: null, workflowTime: null, selectors: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--list") options.list = true;
    else if (token === "--json") options.json = true;
    else if (token === "--keep") options.keep = true;
    else if (token === "--quiet") options.quiet = true;
    else if (token === "--live") options.live = true;
    else if (token === "--driver") options.driver = take(argv, i++);
    else if (token === "--reruns") options.reruns = Number(take(argv, i++));
    else if (token === "--timeout") options.timeout = Number(take(argv, i++));
    else if (token === "--case-dir") options.caseDir = take(argv, i++);
    else if (token === "--workflow") options.workflow = take(argv, i++);
    else if (token === "--args") options.args = take(argv, i++);
    else if (token === "--store") options.store = take(argv, i++);
    else if (token === "--workflow-time") options.workflowTime = take(argv, i++);
    else if (token.startsWith("--")) throw new Error(`unknown option: ${token}`);
    else options.selectors.push(token);
  }
  if (!["stub", "host"].includes(options.driver)) throw new Error(`unknown driver: ${options.driver}`);
  if (options.reruns !== null && (!Number.isInteger(options.reruns) || options.reruns < 1)) throw new Error("--reruns must be a positive integer");
  if (options.live && !options.workflow) throw new Error("--live requires --workflow <path>");
  return options;
}

/** Build an ad-hoc case from CLI flags: one workflow, verbatim args, no input stream. */
export function liveCase(options) {
  const workflow = path.isAbsolute(options.workflow) ? options.workflow : path.resolve(REPO, options.workflow);
  const args = [options.store ? `--store ${path.resolve(options.store)}` : "", options.args ?? ""]
    .filter((part) => part !== "")
    .join(" ");
  return {
    id: "live",
    group: "live",
    title: "ad-hoc live run",
    workflow,
    prepare: () => ({ runRoot: null }),
    args: () => args,
    expect: {},
    hostFlags: options.workflowTime ? ["--workflow-time", String(options.workflowTime)] : [],
    purity: false,
  };
}

export function selectCases(options) {
  if (options.selectors.includes("--all") || options.selectors.includes("all")) return allCases();
  const picked = [];
  for (const selector of options.selectors) {
    const direct = findCase(selector);
    if (direct) picked.push(direct);
    else picked.push(...groupCases(selector));
  }
  return picked;
}

function formatLine(report) {
  const state = report.skipped ? "SKIP" : report.ok ? "PASS" : "FAIL";
  const parts = [state.padEnd(4), report.case.padEnd(20), (`${report.driver}${report.usage.turns ? ` turns=${report.usage.turns}` : ""}`).padEnd(12), `${report.durationMs}ms`.padStart(8)];
  if (report.reason) parts.push(`reason=${report.reason}`);
  if (report.skipped) parts.push(report.skipped);
  if (report.failure) parts.push(report.failure);
  return parts.join("  ");
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (problem) {
    stderr.write(`error: ${problem.message}\n\n${USAGE}\n`);
    return 2;
  }

  if (options.list || argv.length === 0) {
    const rows = (argv.length === 0 ? allCases() : allCases()).map((spec) => `${spec.group.padEnd(9)} ${spec.id.padEnd(20)} ${spec.title}`);
    stdout.write(rows.join("\n") + "\n");
    return argv.length === 0 ? 2 : 0;
  }

  let selected;
  try {
    selected = options.live ? [liveCase(options)] : selectCases(options);
  } catch (problem) {
    stderr.write(`error: ${problem.message}\n`);
    return 2;
  }
  if (selected.length === 0) {
    stderr.write(`error: no cases selected\n\n${USAGE}\n`);
    return 2;
  }
  if (options.caseDir && selected.length !== 1) {
    stderr.write("error: --case-dir requires exactly one case\n");
    return 2;
  }

  const reports = [];
  for (const spec of selected) {
    const report = runCase(spec, {
      driver: options.driver,
      keep: options.keep || options.live,
      reruns: options.reruns,
      timeoutMs: options.timeout,
      caseDir: options.caseDir ?? null,
    });
    reports.push(report);
    if (!options.json && !options.quiet) stdout.write(formatLine(report) + "\n");
  }

  const summary = summarizeReports(reports);
  if (options.json) {
    stdout.write(
      JSON.stringify(
        {
          driver: options.driver,
          summary,
          hostFlags: HOST_FLAGS,
          invocationExample: hostInvocation({ workflow: "<workflow>", args: "<args>" }).slice(-1)[0],
          reports,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    stdout.write(
      `\n${summary.passed}/${summary.total} passed${summary.missing ? ` (${summary.missing} missing draft)` : ""} — driver=${options.driver}\n`,
    );
  }
  return summary.failed === 0 ? 0 : 1;
}

const invoked = process.argv[1] ? existsSync(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) process.exit(main(process.argv.slice(2)));
