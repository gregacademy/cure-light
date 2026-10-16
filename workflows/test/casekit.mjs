// workflows/test/casekit.mjs — case runner: one case spec, two drivers, one oracle.
//
// A case is pure data:
//   {id, group, title, workflow, args(runRoot), prepare(caseDir), expect, purity, hostFlags, check}
// The runner materializes the input stream into a fresh case dir, drives the workflow
// through the selected driver (stub host or real pi CLI), evaluates the case checks, and
// — for `purity` cases on the real host — re-runs from the identical initial state and
// compares a canonical result digest.
//
// Layout of a case dir (all inside it, so a case never touches the repo or the real store):
//   <caseDir>/run    the run store handed to the workflow (the only required input)
//   <caseDir>/cwd    the workflow's shell cwd (evidence dirs land here, e.g. cwd/.tmp/...)
//   <caseDir>/host   host driver captures: pi.stdout.jsonl, pi.stderr, invocation.json
//   <caseDir>/report.json
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTempDirs, snapshotTree } from "../../kernel/tools/verify-testkit.mjs";
import { runWorkflow } from "./harness.mjs";
import { runHost } from "./hostdriver.mjs";

/** Stable JSON: object keys sorted, so a digest never depends on key order. */
export function canonicalJson(value) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const key of Object.keys(node).sort()) out[key] = walk(node[key]);
      return out;
    }
    return node;
  };
  return JSON.stringify(walk(value));
}

/** Replace every literal root with a token so a digest is location-independent. */
export function redactText(text, redactions) {
  let out = String(text);
  for (const [abs, token] of redactions) {
    if (!abs) continue;
    out = out.split(abs).join(token);
  }
  return out;
}

function redactValue(value, redactions) {
  if (typeof value === "string") return redactText(value, redactions);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactions));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactValue(item, redactions);
    return out;
  }
  return value;
}

/**
 * The purity oracle: same inputs must yield the same reason, the same exit payload and
 * byte-identical artifacts. Volatile time fields and the declared ignore keys are dropped;
 * log text is captured in the report but excluded (it is a human card and may carry the
 * evidence stamp/PID, e.g. `cwd/.tmp/p0-close/<stamp>-<pid>`).
 */
export function purityDigest({ reason, exit, tree, redactions = [], ignore = [] }) {
  const payload = { ...(exit ?? {}) };
  for (const key of ignore) delete payload[key];
  const comparable = {
    reason: redactValue(reason, redactions),
    exit: redactValue(payload, redactions),
    tree,
  };
  return createHash("sha256").update(canonicalJson(comparable)).digest("hex");
}

function materialize(spec, caseDir) {
  // Every run starts from the identical initial state; reruns re-materialize.
  rmSync(path.join(caseDir, "run"), { recursive: true, force: true });
  const seeded = spec.prepare(caseDir);
  cleanupTempDirs();
  const runRoot = seeded?.runRoot ?? null;
  return { runRoot, pins: seeded?.pins ?? null, args: spec.args(runRoot, seeded ?? {}) };
}

function drive(spec, { driver, caseDir, cwd, args, timeoutMs }) {
  if (driver === "stub") {
    return runWorkflow({ file: spec.workflow, args, cwd });
  }
  if (driver === "host") {
    return runHost({
      workflow: spec.workflow,
      args,
      cwd,
      dir: path.join(caseDir, "host"),
      flags: spec.hostFlags ?? [],
      timeoutMs,
    });
  }
  throw new Error(`unknown driver: ${driver}`);
}

/** Normalize a driver result so checks and reports read one shape regardless of driver.
 * Both drivers report an unresolvable draft as E_WORKFLOW_MISSING; the message becomes one
 * string so the fast and host tiers fail identically in the red-first state. */
function normalizeResult(result, spec) {
  if (result.error?.code === "E_WORKFLOW_MISSING") {
    result.error = Object.assign(new Error(`workflow draft missing: ${spec.workflow}`), { code: "E_WORKFLOW_MISSING" });
  }
  // The stub returns checkpoint payloads; the host returns a summary count.
  result.checkpointCount = Array.isArray(result.checkpoints) ? result.checkpoints.length : result.checkpoints ?? 0;
  return result;
}

export function runCase(spec, { driver = "stub", caseDir = null, keep = false, reruns = null, timeoutMs = 600_000 } = {}) {
  const skipReason = spec.skip?.() ?? null;
  if (skipReason) {
    return {
      case: spec.id,
      group: spec.group ?? null,
      title: spec.title,
      driver,
      ok: true,
      skipped: skipReason,
      checks: [],
      failure: null,
      reason: null,
      exit: null,
      resultDigest: null,
      snapshot: { before: null, after: null },
      transcriptTypes: [],
      purity: null,
      usage: { turns: 0, checkpoints: 0, shells: 0, costUsd: 0, hostMs: null },
      invocation: { workflow: spec.workflow, args: null, cwd: null },
      paths: { caseDir: null, runRoot: null, hostDir: null, retained: false },
      durationMs: 0,
      error: null,
    };
  }
  const owned = caseDir === null;
  const dir = caseDir ?? mkdtempSync(path.join(os.tmpdir(), `cure-light-case-${spec.id.replace(/[^a-z0-9-]/gi, "-")}-`));
  mkdirSync(dir, { recursive: true });
  const cwd = path.join(dir, "cwd");
  mkdirSync(cwd, { recursive: true });
  const wanted = reruns ?? (driver === "host" && spec.purity !== false ? 2 : 1);
  const redactions = [[dir, "{CASE}"], [path.dirname(spec.workflow), "{REPO}"]];
  const purityCfg = spec.purity === false ? {} : spec.purity ?? {};
  const ignore = purityCfg.ignore ?? [];
  const startedAt = Date.now();

  const attempts = [];
  let runRoot = null;
  let pins = null;
  let before = null;
  let args = null;

  for (let attempt = 0; attempt < wanted; attempt++) {
    const seeded = materialize(spec, dir);
    runRoot = seeded.runRoot;
    pins = seeded.pins;
    args = seeded.args;
    before = runRoot ? snapshotTree(runRoot) : null;
    // Same start state for every attempt: captures, evidence and staging are cleared.
    rmSync(path.join(dir, "host"), { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(cwd, { recursive: true });
    const result = normalizeResult(drive(spec, { driver, caseDir: dir, cwd, args, timeoutMs }), spec);
    const tree = runRoot ? snapshotTree(runRoot) : [];
    const digest = purityDigest({
      reason: result.exit?.reason ?? null,
      exit: result.exit,
      tree,
      // Most specific root first, so the store keeps its own token.
      redactions: [[runRoot, "{STORE}"], [cwd, "{CWD}"], ...redactions],
      ignore,
    });
    attempts.push({ result, tree, digest, attempt });
    // A failed attempt cannot prove purity; stop instead of paying for a second host run.
    if (result.error) break;
  }

  const last = attempts.at(-1);
  const checks = [];

  const missing = last.result.error?.code === "E_WORKFLOW_MISSING";
  if (missing) {
    checks.push({ name: "run-clean", ok: false, detail: String(last.result.error.message) });
  } else if (last.result.error) {
    checks.push({ name: "run-clean", ok: false, detail: String(last.result.error.stack ?? last.result.error.message ?? last.result.error) });
  } else {
    checks.push({ name: "run-clean", ok: true, detail: `${last.result.error === null ? "no error" : ""}`.trim() });
  }

  if (!missing && spec.expect?.reason !== undefined) {
    const got = last.result.exit?.reason ?? null;
    checks.push({
      name: "exit-reason",
      ok: got === spec.expect.reason,
      detail: got === spec.expect.reason ? got : `expected ${spec.expect.reason}, got ${got} (exit=${JSON.stringify(last.result.exit)})`,
    });
  }

  // Transcript records are a real-host surface; the stub host exposes no records by design.
  if (!missing && driver === "host" && (spec.expect?.records || spec.expect?.excludes)) {
    const types = last.result.entries ?? [];
    for (const wanted of spec.expect.records ?? []) {
      checks.push({ name: `record:${wanted}`, ok: types.includes(wanted), detail: types.includes(wanted) ? "present" : `missing; saw ${types.join(", ")}` });
    }
    for (const unwanted of spec.expect.excludes ?? []) {
      checks.push({ name: `record:!${unwanted}`, ok: !types.includes(unwanted), detail: types.includes(unwanted) ? "unexpectedly present" : "absent" });
    }
  }

  if (!missing && spec.check) {
    try {
      const notes = spec.check({ result: last.result, runRoot, before, pins, driver, caseDir: dir });
      checks.push({ name: spec.checkId ?? "case-invariants", ok: true, detail: (notes ?? []).join("; ") });
    } catch (problem) {
      checks.push({ name: spec.checkId ?? "case-invariants", ok: false, detail: String(problem.message ?? problem) });
    }
  }

  let purityInfo = null;
  if (attempts.length > 1 && !last.result.error) {
    const digests = attempts.map((attempt) => attempt.digest);
    const equal = digests.every((digest) => digest === digests[0]);
    purityInfo = { reruns: attempts.length, digests, equal, ignore };
    checks.push({
      name: "purity-rerun",
      ok: equal,
      detail: equal ? `identical result digest over ${attempts.length} runs (${digests[0].slice(0, 16)})` : `digests differ: ${digests.join(", ")}`,
    });
  }

  const failed = checks.filter((check) => !check.ok);
  const ok = failed.length === 0;
  const report = {
    case: spec.id,
    group: spec.group ?? null,
    title: spec.title,
    driver,
    ok,
    checks,
    failure: ok ? null : `${failed[0].name}: ${failed[0].detail}`,
    reason: last.result.exit?.reason ?? null,
    exit: last.result.exit ?? null,
    summary: last.result.summary ?? null,
    resultDigest: last.digest,
    /** Content snapshot of the store before and after the run: {"no writes"} assertions. */
    snapshot: { before, after: last.tree },
    transcriptTypes: last.result.entries ?? [],
    purity: purityInfo,
    usage: {
      turns: last.result.usage?.turns ?? last.result.summary?.turns ?? 0,
      checkpoints: last.result.checkpoints ?? last.result.summary?.checkpoints ?? 0,
      shells: last.result.shellCalls?.length ?? 0,
      costUsd: last.result.usage?.costUsd ?? last.result.summary?.costUsd ?? 0,
      hostMs: last.result.process?.durationMs ?? null,
    },
    invocation: { workflow: spec.workflow, args, cwd },
    paths: { caseDir: dir, runRoot, hostDir: path.join(dir, "host"), retained: false },
    durationMs: Date.now() - startedAt,
    error: missing ? "workflow-missing" : last.result.error ? "run-error" : null,
  };

  const retain = keep || !ok;
  report.paths.retained = retain;
  writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  if (!retain && owned) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });

  return report;
}

export function summarizeReports(reports) {
  const passed = reports.filter((report) => report.ok);
  return {
    total: reports.length,
    passed: passed.length,
    failed: reports.length - passed.length,
    missing: reports.filter((report) => report.error === "workflow-missing").length,
    cases: reports.map((report) => ({ case: report.case, driver: report.driver, ok: report.ok, reason: report.reason })),
  };
}
