// workflows/test/p0-close.test.mjs — red-first contract and behaviour tests for
// workflows/p0/p0-close.js. Run with:
//
//   node --test "workflows/test/*.test.mjs"
//
// Inputs come from workflows/test/streams.mjs: the synthetic stream (engine testkit seed,
// pre-close state, optional fault) and the captured baseline store copy. Shell effects are
// real; the workflow file is loaded by the stub host in workflows/test/harness.mjs.
//
// Expected state until p0-close lands: the stream meta-tests pass; every workflow test
// fails with "workflow draft missing".
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactSha, cleanupTempDirs, readBoxRows, readJson, tempDir } from "../../kernel/tools/verify-testkit.mjs";
import { baselineStream, FAULT_NAMES, syntheticStream } from "./streams.mjs";
import { runWorkflow } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const DRAFT = path.join(REPO, "workflows", "p0", "p0-close.js");
const VERIFIER = path.join(REPO, "kernel", "tools", "verify.mjs");
const CHUNKER = path.join(REPO, "kernel", "tools", "chunker.mjs");
const shaFile = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");
const VERIFIER_SHA = shaFile(VERIFIER);
const CHUNKER_SHA = shaFile(CHUNKER);

after(cleanupTempDirs);

function workflowArgs(runRoot, overrides = {}) {
  const manifest = readJson(runRoot, "units/units2/manifest.json");
  const identity = manifest.identity ?? {};
  const parts = [
    `--store ${runRoot}`,
    `--verifier ${VERIFIER}`,
    `--verifier-sha256 ${overrides.verifierSha ?? VERIFIER_SHA}`,
    `--chunker-sha256 ${CHUNKER_SHA}`,
    `--input-ceiling-bytes ${overrides.ceiling ?? 196608}`,
    `--operator-ref ${overrides.operatorRef ?? "fixture:p0-close"}`,
    `--run-id ${overrides.runId ?? "fixture/p0-close"}`,
    `--review-state ${overrides.reviewState ?? "s1"}`,
    `--base-oid ${overrides.baseOid ?? identity.base_oid ?? "0".repeat(40)}`,
    `--subject-oid ${overrides.subjectOid ?? identity.subject_oid ?? "1".repeat(40)}`,
  ];
  if (overrides.allowOverwrite) parts.push("--allow-overwrite");
  return parts.join(" ");
}

function runDraft(runRoot, overrides = {}) {
  return runWorkflow({ file: DRAFT, args: workflowArgs(runRoot, overrides), cwd: tempDir("p0-close-cwd") });
}

function snapshotTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[path.relative(root, abs)] = shaFile(abs);
    }
  };
  walk(root);
  return out;
}

// ------------------------------------------------------------- streams ----

describe("input streams", () => {
  it("synthetic stream is a complete pre-close run", () => {
    const runRoot = syntheticStream("meta");
    const required = [
      "units/units2/manifest.json",
      "claims/claims-draft.v3.json",
      "claims/sources/capture-manifest.json",
      "join/claims-list.json",
      "join/box-0000.jsonl",
      "join/box-0001.jsonl",
      "join/box-0000.assignment.json",
      "join/box-0001.assignment.json",
      "join/box-0000.instructions.md",
      "join/box-0001.instructions.md",
      "join/box-0000.p05-check.json",
      "join/box-0001.p05-check.json",
      "join/box-0000.p05-evidence.json",
      "join/box-0001.p05-evidence.json",
    ];
    for (const rel of required) assert.ok(existsSync(path.join(runRoot, rel)), `missing ${rel}`);
    assert.ok(!existsSync(path.join(runRoot, "join/join-draft.v1.json")), "draft must not pre-exist");
    assert.ok(!existsSync(path.join(runRoot, "run-manifest.json")), "envelope must not pre-exist");
    const manifest = readJson(runRoot, "units/units2/manifest.json");
    const unitsDir = path.join(runRoot, "units", "units2");
    for (const unit of manifest.units) {
      assert.ok(existsSync(path.join(unitsDir, path.basename(unit.file))), `missing payload ${unit.unit_id}`);
    }
  });

  it("fault variants materialize from the synthetic stream", () => {
    for (const fault of FAULT_NAMES) {
      const runRoot = syntheticStream(`meta-${fault}`, { fault });
      assert.ok(existsSync(path.join(runRoot, "join/box-0000.jsonl")), `fault ${fault} lost the box output`);
    }
    assert.throws(() => syntheticStream("meta-unknown", { fault: "nope" }), /unknown fault/);
  });

  it("baseline stream copies the captured store and pins its outputs", (t) => {
    let stream;
    try { stream = baselineStream(); } catch (problem) { t.skip(`baseline store unavailable: ${problem.message}`); return; }
    assert.equal(artifactSha(stream.runRoot, "join/join-draft.v1.json"), stream.pins.draft);
    assert.equal(artifactSha(stream.runRoot, "run-manifest.json"), stream.pins.envelope);
    assert.equal(Object.keys(stream.pins.p05).length, 12, "expected 6 boxes x check+evidence");
  });
});

// ------------------------------------------------------------ p0-close ----

describe("p0-close", () => {
  it("merges, validates, records p05 and the envelope", () => {
    const runRoot = syntheticStream("valid");
    const result = runDraft(runRoot);
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "ok", `exit=${JSON.stringify(result.exit)}`);

    const manifest = readJson(runRoot, "units/units2/manifest.json");
    const draft = readJson(runRoot, "join/join-draft.v1.json");
    assert.equal(draft.schema_version, "join-draft/1");
    assert.deepEqual(draft.units.map((row) => row.unit_id), manifest.units.map((unit) => unit.unit_id));
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
  });

  const refusalCases = [
    { fault: "duplicate-pair", reason: "validation-failed" },
    { fault: "row-order", reason: "validation-failed" },
    { fault: "unknown-claim", reason: "validation-failed" },
    { fault: "bad-witness", reason: "validation-failed" },
    { fault: "missing-row", reason: "validation-failed" },
    { fault: "preexisting-draft", reason: "frozen-artifact" },
  ];
  for (const { fault, reason } of refusalCases) {
    it(`refuses ${fault} with ${reason} and leaves the store untouched`, () => {
      const runRoot = syntheticStream(`fault-${fault}`, { fault });
      const before = snapshotTree(runRoot);
      const result = runDraft(runRoot);
      assert.equal(result.error, null, String(result.error?.stack ?? ""));
      assert.equal(result.exit?.reason, reason, `exit=${JSON.stringify(result.exit)}`);
      assert.deepEqual(snapshotTree(runRoot), before);
    });
  }

  it("overwrites a pre-existing draft only with --allow-overwrite", () => {
    const runRoot = syntheticStream("overwrite", { fault: "preexisting-draft" });
    const result = runDraft(runRoot, { allowOverwrite: true });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "ok");
    const draft = readJson(runRoot, "join/join-draft.v1.json");
    assert.equal(draft.schema_version, "join-draft/1");
  });

  it("refuses a flag/assignment ceiling mismatch with needs-input", () => {
    const runRoot = syntheticStream("ceiling");
    const before = snapshotTree(runRoot);
    const result = runDraft(runRoot, { ceiling: 1024 });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "needs-input", `exit=${JSON.stringify(result.exit)}`);
    assert.deepEqual(snapshotTree(runRoot), before);
  });

  it("refuses a verifier hash mismatch with verifier-pin-mismatch", () => {
    const runRoot = syntheticStream("pin");
    const before = snapshotTree(runRoot);
    const result = runDraft(runRoot, { verifierSha: "0".repeat(64) });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "verifier-pin-mismatch", `exit=${JSON.stringify(result.exit)}`);
    assert.deepEqual(snapshotTree(runRoot), before);
  });

  it("refuses missing required flags with needs-input", () => {
    const result = runWorkflow({ file: DRAFT, args: "--store /nonexistent-only-store", cwd: tempDir("p0-close-cwd") });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "needs-input", `exit=${JSON.stringify(result.exit)}`);
  });

  it("reproduces the captured baseline store byte-for-byte", (t) => {
    let stream;
    try { stream = baselineStream(); } catch (problem) { t.skip(`baseline store unavailable: ${problem.message}`); return; }
    const { runRoot, pins } = stream;
    const result = runDraft(runRoot, {
      allowOverwrite: true,
      operatorRef: "operator:grzegorznowak/pr72-s1",
      runId: "chunkhound/pi-schematic#72",
      reviewState: "s1",
    });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "ok", `exit=${JSON.stringify(result.exit)}`);
    assert.equal(artifactSha(runRoot, "join/join-draft.v1.json"), pins.draft, "join draft differs");
    assert.equal(artifactSha(runRoot, "run-manifest.json"), pins.envelope, "envelope differs");
    for (const [name, expected] of Object.entries(pins.p05)) {
      assert.equal(artifactSha(runRoot, `join/${name}`), expected, `p05 differs: ${name}`);
    }
  });
});
