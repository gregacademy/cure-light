// workflows/test/p0-close.contract.test.mjs — the red-first executable specification for
// workflows/p0/p0-close.js (fast tier).
//
// Every case below was authored BEFORE the draft exists; until it lands each one fails
// with `workflow draft missing: .../workflows/p0/p0-close.js`. Once the draft is green the
// same cases become the regression suite. Scope: the synthetic pre-close stream and its
// fault variants — exit reasons, artifact shapes, refusal invariants, the `verify join`
// boundary. The frozen-store byte-equality replay lives in p0-close.acceptance.test.mjs.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { artifactSha, cleanupTempDirs, readBoxRows, readJson, snapshotTree, tempDir } from "../../kernel/tools/verify-testkit.mjs";
import { syntheticStream } from "./streams.mjs";
import { runWorkflow } from "./harness.mjs";
import { DRAFT, runDraft, VERIFIER, VERIFIER_SHA } from "./p0-close-testkit.mjs";

after(cleanupTempDirs);

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
});
