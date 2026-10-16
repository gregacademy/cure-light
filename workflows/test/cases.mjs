// workflows/test/cases.mjs — the sealed case table: inputs, expected exit reason, invariants.
//
// One case = one input recipe + one oracle. The same case object is driven through the
// stub host (fast tier) and the real pi CLI (host tier), so a green fast tier and a green
// host tier mean the workflow is a pure function of its explicit parameters on both hosts.
//
// Case shape:
//   id, group, title            identity (titles mirror the original contract suite)
//   workflow                    absolute path token handed to /workflow
//   prepare(caseDir)            materialize the run store under <caseDir>/run; returns {runRoot, pins}
//   args(runRoot, seeded)       the canonical argument string for this case
//   expect.reason               required exit reason
//   check(ctx)                  case invariants; throws on failure, returns notes
//   purity                      false disables the host rerun check; {ignore:[keys]} drops
//                               declared-volatile exit payload keys from the digest
//   hostFlags                   extra pi CLI flags (e.g. --workflow-time)
//   skip()                      optional: return a reason string to skip the case
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactSha,
  readBoxRows,
  readJson,
  snapshotTree,
} from "../../kernel/tools/verify-testkit.mjs";
import { BASELINE_STORE_DEFAULT, baselineStream, syntheticStream } from "./streams.mjs";
import { DRAFT, VERIFIER, VERIFIER_SHA, workflowArgs } from "./p0-close-testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SMOKE_FIXTURE = path.join(HERE, "fixtures", "smoke-echo.js");

/** Host runs are bounded: the workflow has checkpoints, so the soft time target applies. */
const HOST_FLAGS = Object.freeze(["--workflow-time", "300000"]);

/** Copy a materialized synthetic stream into the case dir (pre-close state). */
function synthetic(label, options = {}) {
  return (caseDir) => {
    const origin = syntheticStream(label, options);
    const runRoot = path.join(caseDir, "run");
    cpSync(origin, runRoot, { recursive: true });
    return { runRoot };
  };
}

/** Copy the captured baseline store into the case dir and keep its pins. */
function baseline(caseDir) {
  const seeded = baselineStream({ destParent: caseDir });
  return { runRoot: seeded.runRoot, pins: seeded.pins };
}

/** A fresh empty store dir: the case supplies its own preconditions through args only. */
function emptyStore(caseDir) {
  const runRoot = path.join(caseDir, "run");
  mkdirSync(runRoot, { recursive: true });
  return { runRoot };
}

const REASON_BY_FAULT = [
  { fault: "duplicate-pair", reason: "validation-failed" },
  { fault: "row-order", reason: "validation-failed" },
  { fault: "unknown-claim", reason: "validation-failed" },
  { fault: "bad-witness", reason: "validation-failed" },
  { fault: "missing-row", reason: "validation-failed" },
  { fault: "preexisting-draft", reason: "frozen-artifact" },
];

// --------------------------------------------------------------- smoke group ----

export const SMOKE_CASES = [
  {
    id: "smoke-echo",
    group: "smoke",
    title: "runs end to end: args, shell, store write, checkpoint, exit payload",
    workflow: SMOKE_FIXTURE,
    prepare: emptyStore,
    args: (runRoot) => `--store ${runRoot}`,
    expect: { reason: "ok", records: ["workflow-limits", "workflow-shell", "workflow-exit", "workflow-summary"] },
    hostFlags: [],
    check({ result, runRoot, driver }) {
      const notes = [];
      const sha = runRoot ? artifactSha(runRoot, "out.txt") : null;
      assert.ok(sha, "out.txt was not written into the store");
      assert.equal(result.exit?.artifacts?.out, sha, `exit payload sha != artifact sha: ${JSON.stringify(result.exit)}`);
      notes.push(`artifact out.txt 6B ${sha.slice(0, 12)}`);
      assert.equal(result.checkpointCount ?? 0, 1, `expected exactly one checkpoint, got ${result.checkpointCount}`);
      assert.equal(result.shellCalls.length, 2, `expected 2 shell calls, got ${result.shellCalls.length}`);
      assert.deepEqual(
        result.shellCalls.map((call) => call.ok),
        [true, true],
      );
      assert.equal(result.usage?.turns ?? 0, 0, "a pure case must not spend model turns");
      if (driver === "host") {
        // No target flag: the host records the no-target start so the run never looks
        // silently unbounded (with --workflow-time the summary carries the target instead).
        assert.equal(result.summary?.unbounded, false, "the fixture declares a checkpoint");
        assert.equal(result.summary?.limits?.timeBudgetMs, null);
      }
      return notes;
    },
    checkId: "smoke-contract",
  },
  {
    id: "smoke-time-target",
    group: "smoke",
    title: "honours --workflow-time: the summary carries the target and no limits record is written",
    workflow: SMOKE_FIXTURE,
    prepare: emptyStore,
    args: (runRoot) => `--store ${runRoot}`,
    expect: { reason: "ok", records: ["workflow-shell", "workflow-exit", "workflow-summary"], excludes: ["workflow-limits"] },
    hostFlags: ["--workflow-time", "60000"],
    // Flag plumbing, not determinism: one host run is enough.
    purity: false,
    check({ result, driver }) {
      if (driver === "host") {
        assert.equal(result.summary?.limits?.timeBudgetMs, 60000, `limits not applied: ${JSON.stringify(result.summary?.limits)}`);
        assert.equal(result.summary?.unbounded, false);
      }
      return ["timeBudgetMs=60000"];
    },
    checkId: "time-target",
  },
];

// ------------------------------------------------------------- p0-close group ----

export const P0_CLOSE_CASES = [
  {
    id: "merge-valid",
    group: "p0-close",
    title: "merges, validates, records p05 and the envelope",
    workflow: DRAFT,
    prepare: synthetic("valid"),
    args: (runRoot) => workflowArgs(runRoot),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      const manifest = readJson(runRoot, "units/units2/manifest.json");
      const draft = readJson(runRoot, "join/join-draft.v1.json");
      assert.equal(draft.schema_version, "join-draft/1");
      assert.deepEqual(
        draft.units.map((row) => row.unit_id),
        manifest.units.map((unit) => unit.unit_id),
      );
      assert.equal(draft.boxes.length, 2);
      assert.deepEqual(draft.machine, []);

      const rows = [...readBoxRows(runRoot, "join/box-0000.jsonl"), ...readBoxRows(runRoot, "join/box-0001.jsonl")];
      const zeroLink = new Set(rows.filter((row) => row.links.length === 0 && row.unresolved === null).map((row) => row.unit_id));
      assert.deepEqual(
        draft.candidate_unclaimed,
        manifest.units.map((unit) => unit.unit_id).filter((id) => zeroLink.has(id)),
      );

      for (const boxId of ["box-0000", "box-0001"]) {
        const check = readJson(runRoot, `join/${boxId}.p05-check.json`);
        const evidence = readJson(runRoot, `join/${boxId}.p05-evidence.json`);
        assert.equal(check.error_count, 0);
        assert.deepEqual(check.errors, []);
        assert.equal(evidence.error_count, 0);
        assert.deepEqual(evidence.errors, []);
        assert.equal(evidence.duplicate_pairs, 0);
        assert.equal(evidence.budget.input_ceiling_bytes, 196608);
      }

      const envelope = readJson(runRoot, "run-manifest.json");
      assert.equal(envelope.schema_version, "run-verification/1");
      assert.equal(envelope.verifier.sha256, VERIFIER_SHA);
      assert.equal(envelope.join_boxes.length, 2);
      assert.equal(result.exit.draft_sha, artifactSha(runRoot, "join/join-draft.v1.json"));
      assert.equal(result.exit.envelope_sha, artifactSha(runRoot, "run-manifest.json"));

      // The merged artifacts must satisfy the sole mechanical acceptance boundary.
      const verdictOutput = execSync(`node '${VERIFIER}' join --run '${runRoot}'`, { encoding: "utf8" });
      assert.ok(verdictOutput.length > 0, "verify join produced no verdict output");
      return [`draft ${String(result.exit.draft_sha).slice(0, 12)}`, `envelope ${String(result.exit.envelope_sha).slice(0, 12)}`];
    },
    checkId: "artifacts-and-join",
  },

  ...REASON_BY_FAULT.map(({ fault, reason }) => ({
    id: `fault-${fault}`,
    group: "p0-close",
    title: `refuses ${fault} with ${reason} and leaves the store untouched`,
    workflow: DRAFT,
    prepare: synthetic(`fault-${fault}`, { fault }),
    args: (runRoot) => workflowArgs(runRoot),
    expect: { reason },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot, before }) {
      assert.deepEqual(snapshotTree(runRoot), before);
      return [`store untouched (${before.length} files)`];
    },
    checkId: "store-untouched",
  })),

  {
    id: "overwrite-allowed",
    group: "p0-close",
    title: "overwrites a pre-existing draft only with --allow-overwrite",
    workflow: DRAFT,
    prepare: synthetic("overwrite", { fault: "preexisting-draft" }),
    args: (runRoot) => workflowArgs(runRoot, { allowOverwrite: true }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot }) {
      const draft = readJson(runRoot, "join/join-draft.v1.json");
      assert.equal(draft.schema_version, "join-draft/1");
      return [`overwrote draft ${artifactSha(runRoot, "join/join-draft.v1.json").slice(0, 12)}`];
    },
    checkId: "overwrite",
  },

  {
    id: "ceiling-mismatch",
    group: "p0-close",
    title: "refuses a flag/assignment ceiling mismatch with needs-input",
    workflow: DRAFT,
    prepare: synthetic("ceiling"),
    args: (runRoot) => workflowArgs(runRoot, { ceiling: 1024 }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot, before }) {
      assert.deepEqual(snapshotTree(runRoot), before);
      return ["store untouched"];
    },
    checkId: "store-untouched",
  },

  {
    id: "verifier-pin",
    group: "p0-close",
    title: "refuses a verifier hash mismatch with verifier-pin-mismatch",
    workflow: DRAFT,
    prepare: synthetic("pin"),
    args: (runRoot) => workflowArgs(runRoot, { verifierSha: "0".repeat(64) }),
    expect: { reason: "verifier-pin-mismatch" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot, before }) {
      assert.deepEqual(snapshotTree(runRoot), before);
      return ["store untouched"];
    },
    checkId: "store-untouched",
  },

  {
    id: "missing-flags",
    group: "p0-close",
    title: "refuses missing required flags with needs-input",
    workflow: DRAFT,
    prepare: () => ({ runRoot: null }),
    args: () => "--store /nonexistent-only-store",
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: false,
  },
];

/** Host-tier replay of the frozen baseline: byte-equality of all 15 outputs. */
export const P0_CLOSE_BASELINE_CASE = {
  id: "baseline-replay",
  group: "p0-close",
  title: "reproduces the captured baseline store byte-for-byte through the real host",
  workflow: DRAFT,
  prepare: baseline,
  args: (runRoot) =>
    workflowArgs(runRoot, {
      allowOverwrite: true,
      operatorRef: "operator:grzegorznowak/pr72-s1",
      runId: "chunkhound/pi-schematic#72",
      reviewState: "s1",
    }),
  expect: { reason: "ok" },
  hostFlags: HOST_FLAGS,
  skip: () => (existsSync(BASELINE_STORE_DEFAULT) ? null : `baseline store not found: ${BASELINE_STORE_DEFAULT}`),
  purity: { ignore: ["paths"] },
  check({ result, runRoot, pins }) {
    assert.equal(artifactSha(runRoot, "join/join-draft.v1.json"), pins.draft, "join draft differs");
    assert.equal(artifactSha(runRoot, "run-manifest.json"), pins.envelope, "envelope differs");
    for (const [name, expected] of Object.entries(pins.p05)) {
      assert.equal(artifactSha(runRoot, `join/${name}`), expected, `p05 differs: ${name}`);
    }
    assert.equal(result.exit?.draft_sha, pins.draft);
    assert.equal(result.exit?.envelope_sha, pins.envelope);
    return [`15 outputs byte-equal (draft ${pins.draft.slice(0, 12)}, envelope ${pins.envelope.slice(0, 12)})`];
  },
  checkId: "byte-equality",
};

export const CASE_GROUPS = {
  smoke: SMOKE_CASES,
  "p0-close": [...P0_CLOSE_CASES, P0_CLOSE_BASELINE_CASE],
};

export function allCases() {
  return Object.values(CASE_GROUPS).flat();
}

export function findCase(id) {
  return allCases().find((spec) => spec.id === id) ?? null;
}

export function groupCases(group) {
  const specs = CASE_GROUPS[group];
  if (!specs) throw new Error(`unknown case group: ${group} (expected ${Object.keys(CASE_GROUPS).join(", ")})`);
  return specs;
}
