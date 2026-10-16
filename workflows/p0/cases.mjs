// workflows/p0/cases.mjs — the sealed p0-close case table: inputs, expected reason, invariants.
//
// One case = one input recipe + one oracle. The same case objects are driven through the stub
// host (test/contract.test.mjs) and the real pi CLI (test/host.test.mjs), so a green fast tier
// and a green host tier mean the draft is a pure function of its explicit parameters on both.
// Case shape and authoring rules: ../AUTHORING.md.
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
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import {
  artifactSha,
  readBoxRows,
  readJson,
  snapshotTree,
} from "../../kernel/tools/verify-testkit.mjs";
import { BASELINE_STORE_DEFAULT, baselineStream, syntheticStream } from "./fixtures/streams.mjs";
import { DRAFT, VERIFIER, VERIFIER_SHA, workflowArgs } from "./testkit.mjs";

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

const REASON_BY_FAULT = [
  { fault: "duplicate-pair", reason: "validation-failed" },
  { fault: "row-order", reason: "validation-failed" },
  { fault: "unknown-claim", reason: "validation-failed" },
  { fault: "bad-witness", reason: "validation-failed" },
  { fault: "missing-row", reason: "validation-failed" },
  { fault: "preexisting-draft", reason: "frozen-artifact" },
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
