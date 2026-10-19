// RED-first contract tests for kernel/tools/verify.mjs — CLI/common/loader plus
// claims-draft/3 (C1–C9). Units and join suites live in verify.units.test.mjs /
// verify.join.test.mjs (later phases). Run with:
//
//   node --test "kernel/tools/*.test.mjs"
//
// These tests were authored BEFORE verify.mjs exists (plan §4 batch A/B): with
// the tool missing every case fails at "no parseable verdict"; the intended
// failure mode for each case is encoded here and becomes the regression gate.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  BOX_0000, CAPTURE_MANIFEST, CLAIMS_DRAFT, FIXTURES_DIR, JOIN_DRAFT,
  RAW_WITNESSES_PATH, RUN_MANIFEST, UNITS_MANIFEST,
  cleanupTempDirs, editJson, findFailedCheck, materializeRun,
  readBytes, readJson, readText, resealEnvelope, resealRun, runVerifier,
  sha256, snapshotTree, writeBytes, writeText,
} from "./verify-testkit.mjs";

after(cleanupTempDirs);

const USAGE = "usage: verify <claims|units|join> --run <run-root>";
const COUNTS_DETAIL = "claims=39 nonclaims=13 conflicts=1 notes=4 missing_source_candidates=6";
const PLAN_ONLY_QUOTE = "no source→deliverable edge is accepted";

function report(r) {
  return [
    `command: ${r.command}`,
    `status: ${r.status} signal: ${r.signal} error: ${r.error?.message ?? "none"}`,
    `parseError: ${r.parseError}`,
    `stdout: ${JSON.stringify(r.stdout)}`,
    `stderr: ${JSON.stringify(r.stderr)}`,
  ].join("\n");
}

function expectVerdict(r, status) {
  assert.equal(r.status, status, `expected exit ${status}\n${report(r)}`);
  assert.ok(r.verdict, `expected exactly one JSON verdict on stdout\n${report(r)}`);
  assert.equal(r.verdict.ok, status === 0, `ok must be ${status === 0}\n${report(r)}`);
  return r.verdict;
}

function expectRefusal(r, { check, detail }) {
  const v = expectVerdict(r, 2);
  assert.match(v.summary, /^REFUSE (claims|units|join|usage): /, `refusal summary\n${report(r)}`);
  const failed = findFailedCheck(v, check);
  assert.ok(failed, `missing failed check "${check}"\n${JSON.stringify(v.checks)}\n${report(r)}`);
  assert.equal(failed.detail, detail);
  return v;
}

function expectFailure(r, check, detail) {
  const v = expectVerdict(r, 1);
  assert.match(v.summary, /^FAIL (claims|units|join): \d+ of \d+ checks failed$/, `failure summary\n${report(r)}`);
  const failed = findFailedCheck(v, check);
  assert.ok(failed, `missing failed check "${check}"\n${JSON.stringify(v.checks)}\n${report(r)}`);
  if (detail !== undefined) assert.equal(failed.detail, detail);
  return v;
}

function expectFailurePrefix(r, check, prefix) {
  const v = expectVerdict(r, 1);
  const failed = findFailedCheck(v, check);
  assert.ok(failed, `missing failed check "${check}"\n${JSON.stringify(v.checks)}\n${report(r)}`);
  assert.ok(failed.detail.startsWith(prefix), `check ${check} detail ${JSON.stringify(failed.detail)} does not start with ${JSON.stringify(prefix)}\n${report(r)}`);
  return v;
}

function expectRefusalPrefix(r, check, prefix) {
  const v = expectVerdict(r, 2);
  assert.match(v.summary, /^REFUSE (claims|units|join|usage): /, `refusal summary\n${report(r)}`);
  const failed = findFailedCheck(v, check);
  assert.ok(failed, `missing failed check "${check}"\n${JSON.stringify(v.checks)}\n${report(r)}`);
  assert.ok(failed.detail.startsWith(prefix), `check ${check} detail ${JSON.stringify(failed.detail)} does not start with ${JSON.stringify(prefix)}\n${report(r)}`);
  return v;
}

/** Any failed check whose detail equals `detail` exactly (check name not pinned). */
function expectFailureDetail(r, detail) {
  const v = expectVerdict(r, 1);
  const failed = v.checks.find((c) => c.ok === false && c.detail === detail);
  assert.ok(failed, `no failed check with detail ${JSON.stringify(detail)}\n${JSON.stringify(v.checks)}\n${report(r)}`);
  return v;
}

function mutateClaims(runRoot, fn) {
  editJson(runRoot, CLAIMS_DRAFT, fn);
  resealEnvelope(runRoot);
}

function claimsPass() {
  const runRoot = materializeRun("claims-pass");
  const r = runVerifier(["claims", "--run", runRoot], { runRoot });
  return { runRoot, r };
}

describe("CLI and refusal contract", () => {
  it("no arguments refuses with usage (exit 2)", () => {
    const r = runVerifier([]);
    expectRefusal(r, { check: "cli", detail: USAGE });
  });

  it("unknown commands ledger/findings/closure refuse with usage (exit 2)", () => {
    const runRoot = materializeRun("unknown-cmd");
    for (const cmd of ["ledger", "findings", "closure", "bogus"]) {
      const r = runVerifier([cmd, "--run", runRoot], { runRoot });
      expectRefusal(r, { check: "cli", detail: USAGE });
    }
  });

  it("missing --run, extra positionals, unknown flags and repeated --run refuse with usage (exit 2)", () => {
    const runRoot = materializeRun("usage-args");
    const cases = [
      ["claims"],
      ["claims", "--run", runRoot, "extra"],
      ["claims", "--run", runRoot, "--force"],
      ["claims", "--run", runRoot, "--run", runRoot],
    ];
    for (const args of cases) {
      const r = runVerifier(args, { runRoot });
      expectRefusal(r, { check: "cli", detail: USAGE });
    }
  });

  it("unknown envelope schema refuses (exit 2)", () => {
    const runRoot = materializeRun("envelope-schema-unknown");
    editJson(runRoot, RUN_MANIFEST, (env) => { env.schema_version = "run-verification/999"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusal(r, { check: "schema", detail: 'unsupported schema_version: "run-verification/999"' });
  });

  it("unknown embedded claims schema refuses (exit 2)", () => {
    const runRoot = materializeRun("embedded-schema-unknown");
    editJson(runRoot, RUN_MANIFEST, (env) => { env.claims_draft.schema_version = "claims-draft/999"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusal(r, { check: "schema", detail: 'unsupported schema_version: "claims-draft/999"' });
  });

  it("unknown primary claims schema refuses (exit 2)", () => {
    const runRoot = materializeRun("claims-schema-unknown");
    mutateClaims(runRoot, (claims) => { claims.schema_version = "claims-draft/999"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusal(r, { check: "schema", detail: 'unsupported schema_version: "claims-draft/999"' });
  });

  it("missing claims schema field fails with a schema error (exit 1)", () => {
    const runRoot = materializeRun("claims-schema-missing");
    mutateClaims(runRoot, (claims) => { delete claims.schema_version; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "schema", "invalid field: /schema_version expected nonempty string");
  });

  it("unknown units and join schemas refuse (exit 2)", () => {
    const unitsRun = materializeRun("units-schema-unknown");
    editJson(unitsRun, UNITS_MANIFEST, (m) => { m.schema_version = "code-units-sim/999"; });
    resealEnvelope(unitsRun);
    expectRefusal(runVerifier(["units", "--run", unitsRun], { runRoot: unitsRun }), {
      check: "schema", detail: 'unsupported schema_version: "code-units-sim/999"',
    });

    const joinRun = materializeRun("join-schema-unknown");
    editJson(joinRun, JOIN_DRAFT, (j) => { j.schema_version = "join-draft/9"; });
    resealEnvelope(joinRun);
    expectRefusal(runVerifier(["join", "--run", joinRun], { runRoot: joinRun }), {
      check: "schema", detail: 'unsupported schema_version: "join-draft/9"',
    });
  });
});

describe("artifact discovery and loader", () => {
  it("claims pass: exit 0, ok=true, schema, all checks true, C9 counts (item 1)", () => {
    const { r } = claimsPass();
    const v = expectVerdict(r, 0);
    assert.equal(v.schema, "claims-draft/3");
    assert.equal(v.tool_version, "1.0.0");
    assert.match(v.summary, /^PASS claims: \d+ checks$/);
    assert.ok(v.checks.length > 0, "at least one check");
    for (const check of v.checks) assert.equal(check.ok, true, `check ${check.name} must pass: ${check.detail}`);
    assert.ok(v.checks.some((c) => c.ok && c.detail === COUNTS_DETAIL), `counts detail ${COUNTS_DETAIL} missing`);
  });

  it("claims command writes or modifies no run artifacts", () => {
    const runRoot = materializeRun("no-writes");
    const before = snapshotTree(runRoot);
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectVerdict(r, 0);
    assert.deepEqual(snapshotTree(runRoot), before, "run root must be byte-identical after a read-only verify");
  });

  it("missing claims draft fails artifact discovery (exit 1)", () => {
    const runRoot = materializeRun("claims-missing");
    rmSync(path.join(runRoot, CLAIMS_DRAFT));
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailurePrefix(r, "artifact.discovery", "artifact missing:");
  });

  it("claims and units fail closed without the current pinned run-manifest.json (E2)", () => {
    for (const command of ["claims", "units"]) {
      const runRoot = materializeRun(`e2-no-envelope-${command}`);
      rmSync(path.join(runRoot, RUN_MANIFEST));
      const r = runVerifier([command, "--run", runRoot], { runRoot });
      expectFailure(r, "artifact.read", "cannot read artifact: run-manifest.json");
    }
  });

  it("two claims drafts refuse as ambiguous (exit 2)", () => {
    const runRoot = materializeRun("claims-ambiguous");
    copyFileSync(path.join(runRoot, CLAIMS_DRAFT), path.join(runRoot, "claims/claims-draft.v2.json"));
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusalPrefix(r, "artifact.discovery", "ambiguous artifact:");
  });

  it("wrong schema kind refuses (exit 2)", () => {
    const runRoot = materializeRun("claims-wrong-kind");
    mutateClaims(runRoot, (claims) => { claims.schema_version = "join-draft/1"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusal(r, { check: "artifact.discovery", detail: 'wrong schema kind: "join-draft/1" for claims' });
  });

  it("truncated claims JSON with stale pins reports invalid JSON (exit 1, item 5)", () => {
    const runRoot = materializeRun("claims-truncated");
    writeBytes(runRoot, CLAIMS_DRAFT, Buffer.from("{"));
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.json", `invalid JSON: "${CLAIMS_DRAFT}"`);
    // stale pins may additionally fail the checksum guard; never a zero-claims pass
    expectVerdict(r, 1);
  });

  it("invalid UTF-8 claims bytes reports invalid UTF-8 (exit 1)", () => {
    const runRoot = materializeRun("claims-utf8");
    const buf = readBytes(runRoot, CLAIMS_DRAFT);
    const at = Buffer.byteLength("grzegorznowak");
    const corrupted = Buffer.concat([buf.subarray(0, at), Buffer.from([0xff]), buf.subarray(at + 1)]);
    writeBytes(runRoot, CLAIMS_DRAFT, corrupted);
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailureDetail(r, `invalid UTF-8: "${CLAIMS_DRAFT}"`);
  });

  it("claims draft sha pin mismatch reports sha256 mismatch (exit 1)", () => {
    const runRoot = materializeRun("claims-pin-mismatch");
    editJson(runRoot, RUN_MANIFEST, (env) => { env.claims_draft.sha256 = "0".repeat(64); });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.sha256", `sha256 mismatch: "${CLAIMS_DRAFT}"`);
  });

  it("missing claims draft sha pin reports sha256 pin missing (exit 1)", () => {
    const runRoot = materializeRun("claims-pin-missing");
    editJson(runRoot, RUN_MANIFEST, (env) => { delete env.claims_draft.sha256; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.sha256", `sha256 pin missing: "${CLAIMS_DRAFT}"`);
  });

  it("capture manifest sha pin mismatch reports sha256 mismatch (exit 1)", () => {
    const runRoot = materializeRun("capture-pin-mismatch");
    editJson(runRoot, RUN_MANIFEST, (env) => { env.capture_manifest.sha256 = "0".repeat(64); });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.sha256", `sha256 mismatch: "${CAPTURE_MANIFEST}"`);
  });

  it("state identity mismatch reports identity mismatch (exit 1)", () => {
    const runRoot = materializeRun("identity-mismatch");
    mutateClaims(runRoot, (claims) => { claims.run = "someone/else#1"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailurePrefix(r, "identity", "identity mismatch:");
  });

  it("verifier sha pin mismatch reports verifier sha256 mismatch (exit 1)", () => {
    const runRoot = materializeRun("verifier-pin-mismatch");
    editJson(runRoot, RUN_MANIFEST, (env) => { env.verifier.sha256 = "0".repeat(64); });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "verifier.identity", "verifier sha256 mismatch");
  });

  it("lexical claims source path escape refuses (exit 2)", () => {
    const runRoot = materializeRun("claims-path-escape");
    // Both recorded copies of the source path must escape: the claims-draft path
    // is run-root-relative, the capture path is claims/-relative.
    mutateClaims(runRoot, (claims) => { claims.sources[0].path = "../outside.md"; });
    editJson(runRoot, CAPTURE_MANIFEST, (capture) => { capture.sources[0].path = "../../outside.md"; });
    resealEnvelope(runRoot);
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusalPrefix(r, "artifact.path", "artifact path escapes run root: ");
  });

  it("symlinked source escaping the run root refuses (exit 2)", () => {
    const runRoot = materializeRun("claims-symlink-escape");
    const sourceAbs = path.join(runRoot, "claims/sources/pr-body.md");
    const outsideAbs = path.join(path.dirname(runRoot), "outside-pr-body.md");
    copyFileSync(sourceAbs, outsideAbs);
    rmSync(sourceAbs);
    symlinkSync(outsideAbs, sourceAbs);
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectRefusalPrefix(r, "artifact.path", "artifact path escapes run root: ");
  });

  it("corrupt box JSONL via the join command reports the invalid line (exit 1)", () => {
    const runRoot = materializeRun("join-jsonl-corrupt");
    const lines = readText(runRoot, BOX_0000).split("\n");
    lines[0] = lines[0].replace('"unit_id"', '"unit_id";;');
    writeText(runRoot, BOX_0000, lines.join("\n"));
    resealRun(runRoot);
    const r = runVerifier(["join", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.jsonl", `invalid JSONL: "${BOX_0000}":1`);
  });

  it("malformed run-manifest.json reports invalid JSON (exit 1)", () => {
    const runRoot = materializeRun("envelope-truncated");
    writeBytes(runRoot, RUN_MANIFEST, Buffer.from("{"));
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.json", `invalid JSON: "${RUN_MANIFEST}"`);
  });
});

describe("claims-draft/3 structure (C1)", () => {
  it("missing sources array fails shape validation (exit 1)", () => {
    const runRoot = materializeRun("c1-missing-sources");
    mutateClaims(runRoot, (claims) => { delete claims.sources; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "shape", "invalid field: /sources expected array");
  });

  it("claims not an array fails shape validation (exit 1)", () => {
    const runRoot = materializeRun("c1-claims-not-array");
    mutateClaims(runRoot, (claims) => { claims.claims = {}; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "shape", "invalid field: /claims expected array");
  });

  it("non-string state OID fails shape validation (exit 1)", () => {
    const runRoot = materializeRun("c1-bad-state");
    mutateClaims(runRoot, (claims) => { claims.base_oid = 42; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailurePrefix(r, "shape", "invalid field: /base_oid");
  });

  it("null claim source_ref fails shape validation (exit 1)", () => {
    const runRoot = materializeRun("c1-nullable");
    mutateClaims(runRoot, (claims) => { claims.claims[0].source_ref = null; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailurePrefix(r, "shape", "invalid field: /claims/0/source_ref");
  });
});

describe("claims IDs (C2)", () => {
  it("duplicate claim id fails (exit 1, item 2)", () => {
    const runRoot = materializeRun("c2-duplicate-claim");
    mutateClaims(runRoot, (claims) => { claims.claims[1].id = claims.claims[0].id; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.ids", 'duplicate claim id: "C01"');
  });

  it("duplicate nonclaim id fails (exit 1)", () => {
    const runRoot = materializeRun("c2-duplicate-nonclaim");
    mutateClaims(runRoot, (claims) => { claims.nonclaims[1].id = claims.nonclaims[0].id; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.ids", 'duplicate nonclaim id: "N01"');
  });

  it("claim/nonclaim id collision fails (exit 1)", () => {
    const runRoot = materializeRun("c2-collision");
    mutateClaims(runRoot, (claims) => { claims.nonclaims[0].id = claims.claims[0].id; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.ids", 'claim/nonclaim id collision: "C01"');
  });

  it("duplicate conflict id fails (exit 1, F12)", () => {
    const runRoot = materializeRun("c2-duplicate-conflict");
    mutateClaims(runRoot, (claims) => { claims.conflicts.push(structuredClone(claims.conflicts[0])); });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.ids", 'duplicate conflict id: "X01"');
  });
});

describe("claims sources (C3)", () => {
  it("duplicate source ref fails (exit 1)", () => {
    const runRoot = materializeRun("c3-duplicate-source");
    mutateClaims(runRoot, (claims) => { claims.sources[1].source_ref = claims.sources[0].source_ref; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.sources", 'duplicate source ref: "pr:body"');
  });

  it("source ref not captured fails (exit 1)", () => {
    const runRoot = materializeRun("c3-uncaptured-source");
    mutateClaims(runRoot, (claims) => { claims.sources[1].source_ref = "repo:missing"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.sources", 'source ref not captured: "repo:missing"');
  });

  it("source byte_length mismatch fails (exit 1)", () => {
    const runRoot = materializeRun("c3-byte-length");
    mutateClaims(runRoot, (claims) => { claims.sources[0].byte_length += 1; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.sources", 'source byte_length mismatch: "pr:body"');
  });

  it("source sha256 mismatch fails (exit 1)", () => {
    const runRoot = materializeRun("c3-source-sha");
    mutateClaims(runRoot, (claims) => { claims.sources[0].sha256 = sha256("not the captured body"); });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.sources", 'source sha256 mismatch: "pr:body"');
  });
});

describe("claims quotes (C4)", () => {
  it("claim quote absent from its declared source fails (exit 1)", () => {
    const runRoot = materializeRun("c4-claim-quote");
    mutateClaims(runRoot, (claims) => { claims.claims[1].quote = "fixture-quote-absent-from-all-sources-xyz"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.quote", 'quote not in source: "C02"');
  });

  it("nonclaim quote absent from its declared source fails (exit 1, item 3)", () => {
    const runRoot = materializeRun("c4-nonclaim-quote");
    mutateClaims(runRoot, (claims) => { claims.nonclaims[0].quote = "fixture-quote-absent-from-all-sources-xyz"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.quote", 'quote not in source: "N01"');
  });

  it("quote present only in the other captured source fails (exit 1, item 3)", () => {
    const runRoot = materializeRun("c4-other-source-quote");
    const body = readText(runRoot, "claims/sources/pr-body.md");
    assert.ok(!body.includes(PLAN_ONLY_QUOTE), "test premise: phrase must not be in pr:body");
    mutateClaims(runRoot, (claims) => { claims.claims[0].quote = PLAN_ONLY_QUOTE; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.quote", 'quote not in source: "C01"');
  });
});

describe("claims also_in (C5)", () => {
  it("also_in references an unknown source (exit 1, item 4)", () => {
    const runRoot = materializeRun("c5-also-in-unknown");
    mutateClaims(runRoot, (claims) => { claims.claims[0].also_in = ["repo:nope"]; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.also_in", 'also_in ref not found: "C01" -> "repo:nope"');
  });

  it("also_in that is not an array fails shape validation (exit 1)", () => {
    const runRoot = materializeRun("c5-also-in-type");
    mutateClaims(runRoot, (claims) => { claims.claims[0].also_in = "repo:nope"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailureDetail(r, "invalid field: /claims/0/also_in expected array");
  });
});

describe("claims conflicts (C6)", () => {
  it("affected claim id that does not resolve fails (exit 1, item 4)", () => {
    const runRoot = materializeRun("c6-affected-unknown");
    mutateClaims(runRoot, (claims) => { claims.conflicts[0].affected_claim_ids = ["C99"]; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.conflicts", 'affected claim id not found: "X01" -> "C99"');
  });

  it("non-null conflict quote offset that does not match fails (exit 1)", () => {
    const runRoot = materializeRun("c6-offset");
    mutateClaims(runRoot, (claims) => { claims.conflicts[0].quotes[0].offset_bytes = 0; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.conflicts", 'quote offset mismatch: "X01"');
  });

  it("source_consistency record id that resolves no conflict fails (exit 1)", () => {
    const runRoot = materializeRun("c6-consistency");
    mutateClaims(runRoot, (claims) => { claims.source_consistency.records[0].id = "X99"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.conflicts", 'consistency record not found: "X99"');
  });
});

describe("claims notes (C7)", () => {
  it("empty note fails shape validation (exit 1)", () => {
    const runRoot = materializeRun("c7-empty-note");
    mutateClaims(runRoot, (claims) => { claims.notes[0].note = ""; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "shape", "invalid field: /notes/0/note expected nonempty string");
  });

  it("note quote without source_ref fails (exit 1)", () => {
    const runRoot = materializeRun("c7-note-pair");
    mutateClaims(runRoot, (claims) => { claims.notes.push({ note: "opaque fixture note", quote: "opaque" }); });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    const v = expectVerdict(r, 1);
    const hit = v.checks.some((c) => c.ok === false && (c.name === "claims.notes" || c.detail.startsWith("invalid field: /notes/4")));
    assert.ok(hit, `no claims.notes/shape failure for quote-without-source\n${JSON.stringify(v.checks)}\n${report(r)}`);
  });
});

describe("claims candidates (C8)", () => {
  it("candidate reference_quote not present in any captured source fails (exit 1, item 4)", () => {
    const runRoot = materializeRun("c8-candidate-quote");
    mutateClaims(runRoot, (claims) => { claims.missing_source_candidates[0].reference_quote = "quote-that-nowhere-appears-zzz"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.candidates", "candidate quote not in captured sources: 0");
  });

  it("candidate affected_claim_ids that do not resolve fails (exit 1, item 4)", () => {
    const runRoot = materializeRun("c8-candidate-ids");
    mutateClaims(runRoot, (claims) => { claims.missing_source_candidates[0].affected_claim_ids = ["N02"]; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.candidates", 'candidate affected claim id not found: 0 -> "N02"');
  });

  it("duplicate candidate affected_claim_ids fails (exit 1, F12)", () => {
    const runRoot = materializeRun("c8-candidate-dup-ids");
    mutateClaims(runRoot, (claims) => {
      claims.missing_source_candidates[0].affected_claim_ids = ["C11", "C11"];
    });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "claims.candidates", 'duplicate candidate affected claim id: 0 -> "C11"');
  });
});

describe("claims counts (C9)", () => {
  it("counts are computed from the five arrays; no counts object is required", () => {
    const { runRoot, r } = claimsPass();
    const claims = readJson(runRoot, CLAIMS_DRAFT);
    assert.ok(!("counts" in claims), "seed must not carry a counts object");
    const v = expectVerdict(r, 0);
    const counts = v.checks.find((c) => c.ok === true && c.detail === COUNTS_DETAIL);
    assert.ok(counts, `computed counts check missing\n${JSON.stringify(v.checks)}\n${report(r)}`);
    assert.equal(v.checks.filter((c) => c.ok === false).length, 0);
  });
});

// P8 adversarial-review regressions: capture-entry fail-closed (F1), capture
// schema family dispatch (F4), claims_counts shape (F8), BOM rejection (F9) and
// verifier.path shape (F13).
describe("P8 regressions — loader/capture hardening (F1/F4/F8/F9/F13)", () => {
  it("F1: missing capture_manifest envelope entry fails shape (exit 1, no silent fallback)", () => {
    const runRoot = materializeRun("p8-capture-absent");
    editJson(runRoot, RUN_MANIFEST, (env) => { delete env.capture_manifest; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "shape", "invalid field: /capture_manifest expected object");
  });

  it("F1: non-object capture_manifest envelope entry fails shape (exit 1)", () => {
    for (const [label, value] of [["string", "claims/sources/capture-manifest.json"], ["array", []]]) {
      const runRoot = materializeRun(`p8-capture-nonobject-${label}`);
      editJson(runRoot, RUN_MANIFEST, (env) => { env.capture_manifest = value; });
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectFailure(r, "shape", "invalid field: /capture_manifest expected object");
    }
  });

  it("F1: capture_manifest entry without sha256 stays sha256 pin missing (exit 1)", () => {
    const runRoot = materializeRun("p8-capture-no-sha");
    editJson(runRoot, RUN_MANIFEST, (env) => { delete env.capture_manifest.sha256; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.sha256", `sha256 pin missing: "${CAPTURE_MANIFEST}"`);
  });

  it("F4: unknown capture schema refuses (exit 2, envelope entry and capture file)", () => {
    for (const [label, mutate] of [
      ["entry", (runRoot) => editJson(runRoot, RUN_MANIFEST, (env) => { env.capture_manifest.schema_version = "capture-manifest/999"; })],
      ["file", (runRoot) => { editJson(runRoot, CAPTURE_MANIFEST, (capture) => { capture.schema_version = "capture-manifest/999"; }); resealEnvelope(runRoot); }],
    ]) {
      const runRoot = materializeRun(`p8-capture-unknown-${label}`);
      mutate(runRoot);
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectRefusal(r, { check: "schema", detail: 'unsupported schema_version: "capture-manifest/999"' });
    }
  });

  it("F4: wrong-family capture schema refuses (exit 2, envelope entry and capture file)", () => {
    for (const [label, mutate] of [
      ["entry", (runRoot) => editJson(runRoot, RUN_MANIFEST, (env) => { env.capture_manifest.schema_version = "claims-draft/3"; })],
      ["file", (runRoot) => { editJson(runRoot, CAPTURE_MANIFEST, (capture) => { capture.schema_version = "claims-draft/3"; }); resealEnvelope(runRoot); }],
    ]) {
      const runRoot = materializeRun(`p8-capture-wrong-family-${label}`);
      mutate(runRoot);
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectRefusal(r, { check: "artifact.discovery", detail: 'wrong schema kind: "claims-draft/3" for capture' });
    }
  });

  it("F8: non-object claims_counts fails shape (exit 1)", () => {
    for (const [label, value] of [["array", []], ["string", "39/13/1/4/6"]]) {
      const runRoot = materializeRun(`p8-counts-${label}`);
      editJson(runRoot, RUN_MANIFEST, (env) => { env.claims_counts = value; });
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectFailure(r, "shape", "invalid field: /claims_counts expected object");
    }
  });

  it("F9: BOM-prefixed claims JSON fails invalid JSON (never silently stripped)", () => {
    const runRoot = materializeRun("p8-bom-claims");
    const buf = readBytes(runRoot, CLAIMS_DRAFT);
    writeBytes(runRoot, CLAIMS_DRAFT, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]));
    resealEnvelope(runRoot);
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "artifact.json", `invalid JSON: "${CLAIMS_DRAFT}"`);
  });

  it("F13: non-string/nonempty verifier.path fails shape when present (exit 1)", () => {
    for (const value of ["", 42]) {
      const runRoot = materializeRun(`p8-verifier-path-${typeof value}${String(value).length}`);
      editJson(runRoot, RUN_MANIFEST, (env) => { env.verifier.path = value; });
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectFailure(r, "shape", "invalid field: /verifier/path expected nonempty string");
    }
  });
});

describe("P10 regressions — falsy JSON top levels fail shape (F14)", () => {
  const SHAPE_OBJECT = "invalid field: / expected object";

  it("envelope null/0/false/empty-string: exit 1 with the object shape check", () => {
    for (const [label, text] of [["null", "null"], ["zero", "0"], ["false", "false"], ["empty-string", '""']]) {
      const runRoot = materializeRun(`p10-envelope-${label}`);
      writeText(runRoot, RUN_MANIFEST, text);
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectFailure(r, "shape", SHAPE_OBJECT);
    }
  });

  it("claims draft null/0/false/empty-string: exit 1 with the object shape check", () => {
    for (const [label, text] of [["null", "null"], ["zero", "0"], ["false", "false"], ["empty-string", '""']]) {
      const runRoot = materializeRun(`p10-claims-${label}`);
      writeText(runRoot, CLAIMS_DRAFT, text);
      resealEnvelope(runRoot);
      const r = runVerifier(["claims", "--run", runRoot], { runRoot });
      expectFailure(r, "shape", SHAPE_OBJECT);
    }
  });

  it("capture manifest null: exit 1 with the object shape check", () => {
    const runRoot = materializeRun("p10-capture-null");
    writeText(runRoot, CAPTURE_MANIFEST, "null");
    resealEnvelope(runRoot);
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "shape", SHAPE_OBJECT);
  });
});

// P12 fail-closed fixes (post-push review, fix 2): verifier.path is a required
// canonical identity, the envelope identity tuple is shape-checked for every
// command (deleted/typed holes used to slip through to the equality checks),
// and primary pin entries must declare a nonempty schema_version string.
describe("P12 regressions — fail-closed envelope identity, verifier path, pin schema (fix 2)", () => {
  const OID_FIELDS = ["base_oid", "subject_oid", "cure_light_source_head_oid"];

  it("verifier.path absent fails shape (exit 1, path is required)", () => {
    const runRoot = materializeRun("p12-verifier-path-absent");
    editJson(runRoot, RUN_MANIFEST, (env) => { delete env.verifier.path; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    expectFailure(r, "shape", "invalid field: /verifier/path expected nonempty string");
  });

  it("verifier.path naming another tool fails verifier.identity path mismatch (exit 1)", () => {
    const runRoot = materializeRun("p12-verifier-path-wrong");
    editJson(runRoot, RUN_MANIFEST, (env) => { env.verifier.path = "kernel/tools/chunker.mjs"; });
    const r = runVerifier(["claims", "--run", runRoot], { runRoot });
    const v = expectFailure(r, "verifier.identity", "verifier path mismatch");
    const version = v.checks.find((c) => c.name === "verifier.version");
    assert.ok(version && version.ok === true, `tool_version check must still run\n${report(r)}`);
  });

  it("envelope run/review_state must be nonempty strings (deleted or numeric)", () => {
    for (const field of ["run", "review_state"]) {
      for (const [label, value] of [["deleted", undefined], ["numeric", 42]]) {
        const runRoot = materializeRun(`p12-identity-${field}-${label}`);
        editJson(runRoot, RUN_MANIFEST, (env) => {
          if (value === undefined) delete env[field];
          else env[field] = value;
        });
        const r = runVerifier(["claims", "--run", runRoot], { runRoot });
        expectFailure(r, "shape", `invalid field: /${field} expected nonempty string`);
      }
    }
  });

  it("envelope OID fields require 40-char lowercase hex (deleted/numeric/uppercase/39-hex)", () => {
    const badValues = [
      ["deleted", undefined],
      ["numeric", 42],
      ["uppercase", "C79A54C57322B45498FFD01DB45A876A4712E138"],
      ["39-hex", "c79a54c57322b45498ffd01db45a876a4712e13"],
    ];
    for (const field of OID_FIELDS) {
      for (const [label, value] of badValues) {
        const runRoot = materializeRun(`p12-oid-${field}-${label}`);
        editJson(runRoot, RUN_MANIFEST, (env) => {
          if (value === undefined) delete env[field];
          else env[field] = value;
        });
        const r = runVerifier(["claims", "--run", runRoot], { runRoot });
        expectFailure(r, "shape", `invalid field: /${field} expected 40-char lowercase hex oid`);
      }
    }
  });

  it("primary pin entries require a nonempty schema_version (deleted or numeric)", () => {
    for (const [command, field] of [["claims", "claims_draft"], ["units", "units_manifest"], ["join", "join_draft"]]) {
      for (const [label, value] of [["deleted", undefined], ["numeric", 42]]) {
        const runRoot = materializeRun(`p12-pin-${field}-${label}`);
        editJson(runRoot, RUN_MANIFEST, (env) => {
          if (value === undefined) delete env[field].schema_version;
          else env[field].schema_version = value;
        });
        const r = runVerifier([command, "--run", runRoot], { runRoot });
        expectFailure(r, "schema", `invalid field: /${field}/schema_version expected nonempty string`);
      }
    }
  });
});

// Fixture provenance guard: the committed seed must stay self-contained and the
// raw markerless witnesses must stay available for the P4 join regression suite.
describe("fixture seed provenance", () => {
  it("committed seed carries no /work/runs absolute references", () => {
    const hits = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (readFileSync(abs, "utf8").includes("/work/runs")) hits.push(abs);
      }
    };
    walk(path.join(FIXTURES_DIR, "seed"));
    assert.deepEqual(hits, []);
  });

  it("raw markerless S28 witness samples are preserved as rejection evidence", () => {
    const raw = JSON.parse(readFileSync(RAW_WITNESSES_PATH, "utf8"));
    assert.ok(raw.cases.some((c) => c.unit_id === "u0000" && c.claim_id === "C21" && c.witness === "__pycache__/"));
  });
});
