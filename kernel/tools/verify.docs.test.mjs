// RED-first docs/identity-chain contract tests for the pinned verifier P5
// phase (plan §4 batch E / §5 items 1–12). They assert that the operator-facing
// docs carry the verifier identity chain + delegation contract, and that stale
// "chunker-only / not a shipped gate tool" exclusivity is gone. These tests
// were authored BEFORE the docs edits (the intended failure mode is a missing
// clause, not a crash). Run with:
//
//   node --test kernel/tools/verify.docs.test.mjs
//
// The tool invocation pointer lives ONLY in kernel/tools/verify.mjs's header;
// no operator-facing doc may carry a suite pointer (asserted below).
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOX_0000_ASSIGNMENT, CAPTURE_MANIFEST, CLAIMS_DRAFT, CLAIMS_LIST, JOIN_DRAFT,
  P05_CHECK, P05_EVIDENCE, RUN_MANIFEST,
  cleanupTempDirs, editJson, findCheck, findFailedCheck, materializeRun,
  readBytes, readJson, readText, resealEnvelope, resealRun, runVerifier, sha256, writeText,
} from "./verify-testkit.mjs";

after(cleanupTempDirs);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const norm = (s) => s.replace(/\s+/g, " ").trim();

const CHILD_TEMPLATE = "assets/child-pass-prompt-template.md";
const INTAKE = "kernel/references/intake-and-scope.md";
const CONFORMANCE = "kernel/references/conformance-pass.md";
const IMPLEMENTATION = "kernel/references/implementation-pass.md";
const DEBT = "kernel/references/debt-pass.md";
const CLOSURE = "kernel/references/closure-verification.md";
const REQUIREMENTS = "libs/pi-driver/references/requirements-check.md";
const KICKOFF = "templates/KICKOFF.md";
const BOOTSTRAP = "BOOTSTRAP.md";
const SKILL = "kernel/SKILL.md";
const NOTEBOOK_CONTRACT = "libs/pi-driver/references/notebook-plan-contract.md";
const PI_SKILL = "libs/pi-driver/SKILL.md";
const ARTIFACT_CONTRACTS = "kernel/references/artifact-contracts.md";
const CONTEXT_LOADING = "kernel/references/context-loading.md";
const YAGNI = "kernel/references/yagni-pass.md";
const README = "README.md";
const CHANGELOG = "CHANGELOG.md";
const CHUNKER = "kernel/references/chunker.md";
const EVIDENCE = "kernel/references/evidence-format.md";
const VALIDATION_PLAN = "docs/contract-adequacy-validation-plan.md";
const PIPELINE = "kernel/references/pipeline-model.md";

function has(file, snippet, label) {
  const body = norm(read(file));
  assert.ok(
    body.includes(norm(snippet)),
    `${file}: missing ${label}\n  wanted: ${norm(snippet)}`,
  );
}

function lacks(file, re, label) {
  const body = read(file);
  assert.doesNotMatch(body, re, `${file}: stale ${label} still present`);
}

function row(text, prefix) {
  const line = text.split("\n").find((l) => l.startsWith(prefix));
  assert.ok(line, `missing table row ${prefix}`);
  return line;
}

// ---------------------------------------------------------------------------
// Behavioral doc-profile tests (fix 4 + envelope-prep docs).
//
// The docs duplicate load-bearing profiles and constants, so these tests parse
// the documented `claims-draft/3` profile, the pilot policy, the verifier pin
// and the `verify envelope` flags OUT of the docs and drive the real verifier
// over materialized fixture copies. A future doc/tool drift fails here. The
// mutation matrix encodes today's tool behavior; the doc-content assertions
// (envelope prep mode, fail-closed rules, CHANGELOG, KICKOFF, the enforced
// `candidate_unclaimed` token) were red before the matching docs edits.
// ---------------------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function report(r) {
  return [
    `command: ${r.command}`,
    `status: ${r.status} signal: ${r.signal} error: ${r.error?.message ?? "none"}`,
    `parseError: ${r.parseError}`,
    `stdout: ${JSON.stringify(r.stdout)}`,
    `stderr: ${JSON.stringify(r.stderr)}`,
  ].join("\n");
}

function expectVerdict(r, status, label = "") {
  assert.equal(r.status, status, `${label}: expected exit ${status}\n${report(r)}`);
  assert.ok(r.verdict, `${label}: expected exactly one JSON verdict on stdout\n${report(r)}`);
  assert.equal(r.verdict.ok, status === 0, `${label}: ok must be ${status === 0}\n${report(r)}`);
  return r.verdict;
}

function expectFailedCheck(r, status, check, detail, label = "") {
  const verdict = expectVerdict(r, status, label);
  const failed = findFailedCheck(verdict, check);
  assert.ok(failed, `${label}: missing failed check "${check}"\n${JSON.stringify(verdict.checks)}\n${report(r)}`);
  if (detail !== undefined) {
    if (detail instanceof RegExp) assert.match(failed.detail, detail, `${label}\n${report(r)}`);
    else assert.equal(failed.detail, detail, `${label}\n${report(r)}`);
  }
  return { verdict, failed };
}

/**
 * The documented profiles are written in two grammars: the child template uses
 * `name[{field,...}]` / `name[{...,[opt]}]`, intake restates `name `{field,...}``
 * with the doc alias `candidates` (= JSON `missing_source_candidates`). This
 * parser reads either grammar (bracketed notation only; a parenthetical prose
 * clause is not part of the parsed field set) and returns per record:
 * `{required:[{name,nested}], optional:[names]}`.
 */
function parseProfileBlock(raw) {
  const s = raw.replace(/\s+/g, " ").trim();
  const alias = { candidates: "missing_source_candidates" };
  const records = {};
  let i = 0;
  const fail = (message) => {
    throw new Error(`profile parse at ${i}: ${message}; near ${JSON.stringify(s.slice(Math.max(0, i - 30), i + 30))}`);
  };
  const readName = () => {
    let out = "";
    while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) out += s[i++];
    return out;
  };
  const skipSeparators = () => {
    while (i < s.length && ",;. ".includes(s[i])) i++;
  };
  const parseFields = () => {
    if (s[i] !== "{") fail("expected {");
    i++;
    const required = [];
    const optional = [];
    for (;;) {
      while (s[i] === " ") i++;
      if (s[i] === "}") { i++; break; }
      const name = readName();
      if (!name) fail("expected field name");
      while (s[i] === " ") i++;
      let nested = null;
      if (s[i] === "[") {
        if (s[i + 1] === "{") {
          i++;
          nested = parseFields();
          if (s[i] !== "]") fail("expected ] after nested field list");
          i++;
        } else {
          i++;
          for (;;) {
            while (s[i] === " ") i++;
            if (s[i] === "]") { i++; break; }
            if (s[i] === ",") { i++; continue; }
            const opt = readName();
            if (!opt) fail("expected optional field name");
            optional.push(opt);
          }
        }
      }
      required.push({ name, nested });
      while (s[i] === " ") i++;
      if (s[i] === ",") { i++; continue; }
      if (s[i] === "}") { i++; break; }
      fail(`unexpected ${JSON.stringify(s[i])}`);
    }
    return { required, optional };
  };
  while (i < s.length) {
    skipSeparators();
    if (i >= s.length) break;
    const name = readName();
    if (!name) fail("expected record name");
    while (s[i] === " ") i++;
    if (s[i] === "`") i++;
    if (s[i] === "[") i++;
    const parsed = parseFields();
    if (s[i] === "]") i++;
    if (s[i] === "`") i++;
    records[alias[name] ?? name] = parsed;
    // The child template carries one parenthetical prose clause after the notes
    // record; it is not part of the bracketed field notation (asserted prose is
    // handled separately in the behavioral items below).
    while (s[i] === " ") i++;
    if (s[i] === "(") {
      while (i < s.length && s[i] !== ")") i++;
      if (s[i] === ")") i++;
    }
  }
  return records;
}

const canonFields = (list) => ({
  required: list.required.map((f) => ({ name: f.name, nested: f.nested ? canonFields(f.nested) : null })),
  optional: [...list.optional].sort(),
});

function canonProfile(profile) {
  const out = {};
  for (const key of Object.keys(profile).sort()) out[key] = canonFields(profile[key]);
  return out;
}

/** Slice one profile block out of a doc between its opening marker and terminal. */
function profileBlock(file, startMarker, terminal) {
  const text = read(file);
  const start = text.indexOf(startMarker);
  assert.ok(start !== -1, `${file}: missing profile start marker ${JSON.stringify(startMarker)}`);
  const from = start + startMarker.length;
  const end = text.indexOf(terminal, from);
  assert.ok(end !== -1, `${file}: missing profile terminal ${JSON.stringify(terminal)}`);
  return text.slice(from, end);
}

/** Every documented required field as a deletable JSON-pointer probe. */
function requiredProbes(profile) {
  const probes = [];
  for (const record of ["sources", "claims", "nonclaims", "conflicts", "notes", "missing_source_candidates"]) {
    for (const field of profile[record].required) {
      probes.push({ pointer: `/${record}/0/${field.name}`, path: [record, 0, field.name] });
      for (const nested of field.nested?.required ?? []) {
        probes.push({
          pointer: `/${record}/0/${field.name}/0/${nested.name}`,
          path: [record, 0, field.name, 0, nested.name],
        });
      }
    }
  }
  return probes;
}

function deleteAtPath(obj, parts) {
  let cursor = obj;
  for (let k = 0; k < parts.length - 1; k++) cursor = cursor[parts[k]];
  delete cursor[parts[parts.length - 1]];
}

describe("docs contract — child prompt template (verifier block)", () => {
  it("carries the mechanical verification child block", () => {
    has(CHILD_TEMPLATE, "### Mechanical verification child (`fast`; not a reviewer)", "verifier block heading");
  });

  it("mandates a fast child, read-only with no interpret/repair, and hash verification", () => {
    has(CHILD_TEMPLATE, "MUST spawn a `fast` child", "fast-child mandate");
    has(CHILD_TEMPLATE, "verifies the frame-recorded `{verifier_path}` / `{verifier_sha256}`", "recorded path/sha verification");
    has(CHILD_TEMPLATE, "do not interpret, repair or normalize", "read-only no-interpret clause");
    has(CHILD_TEMPLATE, "do not substitute checks", "no-check-substitution clause");
    has(CHILD_TEMPLATE, "Missing/degenerate `fast` pauses; no coordinator fallback", "pause, no fallback clause");
    has(CHILD_TEMPLATE, "must NOT read the subject", "no-subject-read clause");
  });

  it("fails the mechanical gate on nonzero, mismatch, missing or inconsistent verdicts", () => {
    has(
      CHILD_TEMPLATE,
      "A nonzero exit, a missing or unparseable verdict, a truncated return, a tool/hash mismatch, or an ok/exit inconsistency fails this mechanical gate",
      "mechanical-gate failure clause",
    );
  });

  it("coordinator consumes the verdict and never re-implements; semantics stay coordinator/V1", () => {
    has(
      CHILD_TEMPLATE,
      "The coordinator consumes the verdict; it never overrides, reimplements or reruns checks in its own context",
      "consume-only clause",
    );
    has(
      CHILD_TEMPLATE,
      "dispositions remain coordinator/V1 semantic work",
      "semantic-disposition clause",
    );
  });

  it("declares the five frame slots", () => {
    for (const slot of ["{verifier_command}", "{verifier_path}", "{verifier_sha256}", "{run_root}", "{artifact_class}"]) {
      has(CHILD_TEMPLATE, slot, `slot ${slot}`);
    }
  });

  it("aligns the P0.2 draft shape with the frozen claims profile", () => {
    has(CHILD_TEMPLATE, "sources[{source_ref,locator,path,role,sha256,byte_length[,blob_subject]}]", "sources profile");
    has(CHILD_TEMPLATE, "claims[{id,statement,source_ref,quote,also_in}]", "claims profile");
    has(CHILD_TEMPLATE, "nonclaims[{id,statement,source_ref,quote,reason}]", "nonclaims profile");
    has(CHILD_TEMPLATE, "conflicts[{id,kind,materiality,quotes[{source_ref,quote,offset_bytes}]", "conflicts profile");
    has(CHILD_TEMPLATE, "notes[{note}]", "notes profile");
    has(CHILD_TEMPLATE, "missing_source_candidates[{resource,affected_claim_ids,reference_quote,why_it_matters}]", "candidates profile");
  });

  it("uses the separate P0.4 removes/changes role tokens", () => {
    has(CHILD_TEMPLATE, "necessary-support | removes | changes", "separate removes/changes tokens");
    lacks(CHILD_TEMPLATE, /remove[s]?\/changes/, "slash-drift removes/changes token");
  });

  it("retains original worker attempts", () => {
    has(CHILD_TEMPLATE, "Retain the original worker attempts", "original-attempts clause");
  });
});

describe("docs contract — intake-and-scope (P0 delegation + pinned verifier)", () => {
  it("makes single `verify join` the delegated boundary; claims/units are optional diagnostics", () => {
    has(INTAKE, "Delegated mechanical boundary (`verify join`)", "delegated boundary");
    has(INTAKE, "single invocation is the mechanical acceptance boundary", "single-invocation boundary");
    has(INTAKE, "Optional claims diagnostic (`verify claims`)", "claims diagnostic");
    has(INTAKE, "Optional units diagnostic (`verify units`)", "units diagnostic");
    has(INTAKE, "never gates acceptance", "diagnostics never gate");
  });

  it("flows P0.5 as the coordinator semantic gate consuming the fast-child pinned verdict", () => {
    has(INTAKE, "P0.5 coordinator semantic gate", "P0.5 semantic-gate line");
    has(INTAKE, "consumes the fast-child pinned mechanical verdict", "verdict-consumption line");
  });

  it("replaces 'not a shipped gate tool' with shipped mechanical checks + coordinator merge decision", () => {
    lacks(INTAKE, /not a shipped gate tool/i, "not-a-shipped-gate-tool phrasing");
    has(INTAKE, "mechanical checks shipped in `kernel/tools/verify.mjs`", "shipped mechanical checks");
    has(INTAKE, "merge decision remains coordinator", "coordinator merge decision");
  });

  it("documents the pinned-verifier CLI, exit codes, fail-closed semantics and envelope", () => {
    has(INTAKE, "### Pinned mechanical verifier (`kernel/tools/verify.mjs`)", "verifier subsection");
    has(INTAKE, "node <pinned-engine>/kernel/tools/verify.mjs <claims|units|join> --run <run-root>", "CLI invocation");
    has(INTAKE, "Exactly one `--run`", "single --run rule");
    has(INTAKE, "Exit codes: 0 pass / 1 validation failure / 2 usage-or-unknown-schema refusal", "exit-code contract");
    has(INTAKE, "Nonzero is mechanically binding", "binding nonzero");
    has(INTAKE, "Fail-closed delegation", "fail-closed semantics");
    has(INTAKE, "run-verification/1", "envelope schema");
    has(INTAKE, "each command requires only its own evidence slice", "stage-scoped evidence");
    has(INTAKE, "never reads the subject tree", "read boundary");
  });

  it("documents the enforced floor(n/2) halves geometry (F5)", () => {
    has(INTAKE, "left = floor(n/2) units", "floor-left rule");
    has(INTAKE, "right larger for odd n", "right-larger rule");
    has(INTAKE, "no unit split", "no-unit-split rule");
    lacks(INTAKE, /exact half-split point stays coordinator policy/, "coordinator-policy half-split drift");
  });

  it("documents check suppression semantics (F11)", () => {
    has(INTAKE, "**Check suppression.**", "suppression heading");
    has(INTAKE, "Absence means NOT EVALUATED", "absence-not-evaluated");
    has(INTAKE, "can never be read as a pass", "absence-not-pass");
    has(INTAKE, "Duplicate JSON object keys", "duplicate-key limitation note");
  });

  it("documents the payload-walk boundary (F16)", () => {
    has(INTAKE, "The payload walk does not traverse symlinked directories", "payload-walk symlink-dir rule");
    has(INTAKE, "payload files must be regular files inside the run root (outside-root targets refuse)", "payload regular-file/inside-root rule");
  });

  it("marks ledger/findings/closure validators NOT IMPLEMENTED with no CLI placeholder", () => {
    has(INTAKE, "NOT IMPLEMENTED", "not-implemented marker");
    has(INTAKE, "no CLI placeholder", "no-placeholder clause");
  });

  it("requires the single join verdict ref/hash/code in the gate checklist", () => {
    has(INTAKE, "current delegated `verify join` verdict", "current delegated verdict");
    has(INTAKE, "(ref, sha256, exit code)", "verdict ref/hash/code shape");
  });

  it("keeps a join-only manifest healthy (diagnostics optional) and fails closed on join (R1/R2/R4)", () => {
    has(INTAKE, "verification: {join: {ref, sha256, exit_code}}", "join-only manifest record");
    has(INTAKE, "Optional `claims`/`units` diagnostic verdicts", "diagnostics recorded optionally");
    has(INTAKE, "a stale, missing or nonzero join verdict stops the mechanical boundary", "fail-closed join verdict");
    lacks(INTAKE, /verification: \{claims: \{ref, sha256, exit_code\}, units: \{ref, sha256, exit_code\}, join: \{ref, sha256, exit_code\}\}/, "three-verdict manifest record");
  });

  it("adds the verifier pin, verdict records, envelope ref/hash and approved policy to the output manifest", () => {
    has(INTAKE, "verifier: {path: kernel/tools/verify.mjs, sha256, tool_version: 1.0.0}", "verifier pin line");
    has(INTAKE, "verification: {join: {ref, sha256, exit_code}}", "join verdict record line");
    has(INTAKE, "run_envelope: {ref: run-manifest.json, sha256, schema_version: run-verification/1}", "envelope line");
    has(INTAKE, "pilot: {operator_ref, input_ceiling_bytes, witness_max_chars: 160", "pilot policy line");
  });
});

describe("docs contract — conformance-pass (V1 mechanical boundary)", () => {
  it("requires the single join verdict pinned to exact inputs; stale/nonzero stops the boundary", () => {
    has(CONFORMANCE, "current delegated `fast`-child `verify join` verdict", "current delegated verdict");
    has(CONFORMANCE, "the manifest `verification.join` ref/hash/exit code", "manifest join record");
    has(CONFORMANCE, "verdict stops the mechanical boundary", "stale/nonzero stop");
    has(CONFORMANCE, "never re-implements or reruns the tool's checks in its own context", "no-reimplementation clause");
    has(CONFORMANCE, "optional diagnostics", "diagnostics optional");
  });

  it("reuses the Phase-0 `verify join` surface against preserved refs, not claims-frozen under draft schema", () => {
    has(CONFORMANCE, "reuses the Phase-0 `verify join` surface", "phase-0 reuse");
    has(CONFORMANCE, "internal claims/units prerequisites validate those schemas", "internal prereq validation");
    has(CONFORMANCE, "never fed to the draft-schema validator", "frozen-directory separation");
  });

  it("marks ledger/findings/closure validators NOT IMPLEMENTED at reconciliation point 6", () => {
    has(CONFORMANCE, "ledger, findings and closure", "registry seam subjects");
    has(CONFORMANCE, "NOT IMPLEMENTED", "not-implemented marker");
    has(CONFORMANCE, "no `verify ledger|findings|closure` CLI placeholder", "no CLI placeholder");
  });
});

describe("docs contract — opaque quarantine and human pre-V1 pause", () => {
  it("defines /3 first-class opaque units, bounded descriptors and machine-only raw store", () => {
    has(CHUNKER, "code-units-sim/3 always, never code-units-sim/2", "hard schema migration");
    has(CHUNKER, "boundary_kind: opaque", "first-class opaque unit");
    has(CHUNKER, "opaque_occurrences[]", "occurrence records");
    has(CHUNKER, "opaque-descriptor/1", "metadata-only descriptor");
    has(CHUNKER, "1024-byte opaque descriptor limit", "descriptor byte cap");
    has(CHUNKER, "units2/raw/occ-NNNN.bin", "machine-only raw store");
    has(CHUNKER, "coverage.status: partial", "partial coverage accounting");
    has(CHUNKER, "counts.opaque_bytes", "raw-byte count separate from payload total_bytes");
  });

  it("opaque attribution is not semantic explanation; exclusions require evidence-linked policy_class", () => {
    has(CONFORMANCE, "opaque units initialize UNRESOLVED", "initial opaque state");
    has(CONFORMANCE, "certified pure move may be machine-attributed but never auto-EXPLAINED", "attribution/explanation split");
    has(CONFORMANCE, "EXCLUDED only via evidence-linked policy_class", "approved exclusion gate");
    has(CONFORMANCE, "suffix or minification alone cannot exclude an opaque unit", "no automatic filename waiver");
    has(CONFORMANCE, "security-relevant opaque units cannot be EXCLUDED", "security exception");
    has(CONFORMANCE, "security-relevant opaque units force limited-only or blocked", "review-basis downgrade");
  });

  it("deliberate skips surface to a human at pre-V1; partial review never silently launches children", () => {
    has(CONFORMANCE, "every deliberate skip bubbles clearly to the human reviewer at the pre-V1 pause", "OQ2 human-facing pause");
    has(CONFORMANCE, "occurrence ids, byte lengths, sha256, policy_class and rationale", "human-visible skip detail");
    has(CONFORMANCE, "policy_class is a reviewer-visible label, not an automatic waiver", "policy meaning");
    has(CONFORMANCE, "unapproved partial coverage pauses before V1: no Vector 1 children", "fail-closed pre-V1");
    has(CONFORMANCE, "missing designation keeps repair_required", "source designation gate");
    has(CONFORMANCE, "operator-approval/1", "operator-signed approval artifact");
    has(CONFORMANCE, "--approval <run-root-relative-ref>", "approval binding flag");
  });
});

describe("docs contract — requirements-check (row 10 + groups)", () => {
  it("binds the verifier path/sha256/tool_version in row 10 (engine OID)", () => {
    const text = read(REQUIREMENTS);
    const r10 = row(text, "| 10 |");
    assert.match(r10, /verify\.mjs/, "row 10 must name the verifier");
    assert.match(r10, /sha256/, "row 10 must bind exact bytes");
    assert.match(r10, /tool_version/, "row 10 must bind tool_version");
    assert.match(r10, /engine source|source identity|engine OID/i, "row 10 must bind the engine source identity");
  });

  it("includes the fast mechanical executor in row 7", () => {
    const text = read(REQUIREMENTS);
    const r7 = row(text, "| 7 |");
    assert.match(r7, /mechanical/i, "row 7 must cover the mechanical verification child");
    assert.match(r7, /fast/, "row 7 must remain fast-bound");
  });

  it("stops the mechanical gate on missing verifier/mismatch and forbids run-authored substitutes", () => {
    has(REQUIREMENTS, "Missing verifier", "missing-verifier stop");
    has(REQUIREMENTS, "run-authored verification script", "no run-authored substitute");
  });
});

describe("docs contract — KICKOFF / BOOTSTRAP / SKILL / notebook contract", () => {
  it("KICKOFF §8 carries verifier identity, delegated verification and the semantic-gate framing", () => {
    has(KICKOFF, "pinned mechanical verifier", "verifier identity");
    has(KICKOFF, "tool_version", "tool_version");
    has(KICKOFF, "delegated `fast` mechanical verification", "delegated verification");
    has(KICKOFF, "not a second semantic gate", "not-a-second-semantic-gate");
    has(KICKOFF, "never convert bytes to tokens", "byte-vs-token policy");
    has(KICKOFF, "Phase-0 claims, join and mechanical verification: `fast` only", "fast group covers verification");
  });

  it("BOOTSTRAP fetches the verifier as exact raw bytes with sha recorded at fetch from the immutable source", () => {
    has(BOOTSTRAP, "pinned mechanical verifier `$RAW_BASE/kernel/tools/verify.mjs`", "verifier fetch");
    has(BOOTSTRAP, "fetched as exact raw bytes", "exact raw bytes");
    has(BOOTSTRAP, "recorded at fetch time", "sha at fetch");
    has(BOOTSTRAP, "immutable resolved `cure_light_source_head_oid`", "immutable resolved source");
    has(BOOTSTRAP, "does not by itself prove the OID", "no false OID proof");
    has(BOOTSTRAP, "stop the executable gate", "stop clause");
  });

  it("kernel/SKILL carries the verifier pin, literal contract, phase order and no-override rule", () => {
    has(SKILL, "pinned mechanical verifier", "verifier in requirements");
    has(SKILL, "literal rendered verifier-child contract", "literal delegation contract");
    has(SKILL, "delegated verify claims", "phase-order claims");
    has(SKILL, "delegated verify units", "phase-order units");
    has(SKILL, "delegated verify join", "phase-order join");
    has(SKILL, "single mechanical boundary", "phase-order boundary");
    has(SKILL, "optional diagnostics", "phase-order diagnostics");
    has(SKILL, "never re-implements or reruns the verifier's checks", "no-override rule");
    has(SKILL, "no subject read", "no subject read");
  });

  it("notebook-plan-contract freezes the pin + literal contract and stores verdict bytes/code", () => {
    has(NOTEBOOK_CONTRACT, "verifier path/sha256/tool_version", "frame verifier pin");
    has(NOTEBOOK_CONTRACT, "literal delegated verification-child contract", "literal delegation contract");
    has(NOTEBOOK_CONTRACT, "current fast-child `verify join` verdict ref/hash/exit code", "verdict evidence bind");
    has(NOTEBOOK_CONTRACT, "freezes the verifier pin", "seal freeze");
  });
});

describe("docs contract — fleet plans (experimental)", () => {
  it("intake-and-scope records the per-vector fleet plan, timing and depth budgets", () => {
    has(INTAKE, "**`fleet_plan`**", "fleet_plan record");
    has(INTAKE, "A vector without a recorded plan does not spawn", "no-plan no-spawn");
    has(INTAKE, "One child owns at most two sealed concepts (V2) or two debt axes (V3)", "per-child cap");
    has(INTAKE, "no facet may be folded into another child silently", "no silent folding");
    has(INTAKE, "the V1 `fleet_plan` (shard → group → owned claims/units → depth budget)", "phase-0 gate surface");
    has(INTAKE, "at-most-two-facets-per-child cap", "pre-pull fleet policy");
    has(INTAKE, "Any mid-run amendment to a plan is recorded at the next gate with a reason", "amendments recorded");
  });

  it("each vector's reference compiles and records its own fleet_plan at its gate", () => {
    has(CONFORMANCE, "V1's recorded `fleet_plan`", "V1 plan");
    has(IMPLEMENTATION, "V2's `fleet_plan`", "V2 plan");
    has(IMPLEMENTATION, "at most two sealed concepts unless the plan records why", "V2 cap");
    has(DEBT, "V3's `fleet_plan`", "V3 plan");
    has(DEBT, "at most two debt axes unless the plan records why", "V3 cap");
    has(DEBT, "at least two distinct search calls and one recorded evidence artifact (file:line) per owned axis/lens", "V3 depth budget");
    has(CLOSURE, "plan-vs-actual fleet check", "closure check");
    has(NOTEBOOK_CONTRACT, "per-vector `fleet_plan`", "frame field");
    has(SKILL, "recorded `fleet_plan`", "SKILL rule");
    has(PIPELINE, "recorded `fleet_plan`", "pipeline rule");
  });

  it("CHANGELOG appends the fleet-plan subsection above the single-join entry", () => {
    has(CHANGELOG, "### 2026-10-05 — fleet plans: recorded splits + per-facet depth budgets (experimental)", "new subsection");
    const body = read(CHANGELOG);
    const newAt = body.indexOf("### 2026-10-05 — fleet plans");
    const oldAt = body.indexOf("### 2026-10-05 — single `verify join` boundary");
    assert.ok(newAt !== -1 && oldAt !== -1 && newAt < oldAt, "fleet-plan subsection must sit above the single-join entry");
  });
});

describe("docs contract — README / CHANGELOG / consistency", () => {
  it("README layout mentions kernel/tools/verify.mjs as the pinned mechanical verifier", () => {
    has(README, "tools/verify.mjs", "layout verifier branch");
    has(README, "pinned mechanical verifier", "layout verifier label");
    has(README, "kernel/tools/verify.mjs", "explicit verifier path");
  });

  it("README does not absorb the pending F1/F2 items or a suite pointer", () => {
    lacks(README, /chunker\.mjs/, "F2 chunker listing");
    lacks(README, /Node 22/, "F1 requirements-summary sentence");
    lacks(README, /node --test|verify\.test\.mjs|verify-fixtures/, "test-suite pointer");
  });

  it("CHANGELOG appends a new Unreleased verifier subsection without rewriting history", () => {
    has(CHANGELOG, "### 2026-10-04 — pinned mechanical verifier (claims | units | join)", "new subsection");
    has(CHANGELOG, "kernel/tools/verify.mjs", "verifier path");
    has(CHANGELOG, "run-verification/1", "envelope schema");
    has(CHANGELOG, "fast", "fast delegation");
    has(CHANGELOG, "left = floor(n/2)", "changelog halves geometry");
    lacks(CHANGELOG, /exact half-split point remains coordinator policy/, "changelog half-split drift");
    assert.match(read(CHANGELOG), /NOT IMPLEMENTED/, "changelog must mark the follow-up seam");
    const body = read(CHANGELOG);
    const newAt = body.indexOf("### 2026-10-04 — pinned mechanical verifier");
    const oldAt = body.indexOf("### 2026-10-03 — V1 claim-validation boundary");
    assert.ok(newAt !== -1 && oldAt !== -1 && newAt < oldAt, "new subsection must sit above the 2026-10-03 history");
    assert.match(body, /The coordinator gate is not a shipped tool\./, "historical entry must remain as written");
    has(CHANGELOG, "### 2026-10-02 — Phase 0: claims → chunker → join → gate", "historical section intact");
  });

  it("chunker.md and evidence-format.md note verifier consumption under the /3 schema", () => {
    has(CHUNKER, "consumed mechanically by the pinned verifier", "chunker verify consumption");
    has(CHUNKER, "internal units prerequisite", "chunker internal prerequisite");
    has(CHUNKER, "code-units-sim/3 always, never code-units-sim/2", "hard schema migration");
    has(CHUNKER, "1024-byte opaque descriptor limit", "bounded opaque descriptor");
    has(EVIDENCE, "delegated `verify join` verdict", "evidence verdict ref");
    has(EVIDENCE, "diagnostic verdicts use the same shape when run and never gate", "evidence diagnostics non-gating");
  });

  it("no stale chunker-only / no-gate exclusivity remains in current operator docs", () => {
    const files = [
      CHILD_TEMPLATE, INTAKE, CONFORMANCE, REQUIREMENTS, KICKOFF, BOOTSTRAP,
      SKILL, NOTEBOOK_CONTRACT, README, CHUNKER, EVIDENCE, VALIDATION_PLAN, PIPELINE,
    ];
    const stale = [
      [/not a shipped gate tool/i, "not-a-shipped-gate-tool"],
      [/only the chunker/i, "chunker-only exclusivity"],
      [/chunker ships as a tool;\s*no gate/i, "chunker-only no-gate exclusivity"],
      [/not a second shipped tool/i, "not-a-second-shipped-tool"],
    ];
    for (const file of files) {
      for (const [re, label] of stale) lacks(file, re, `${label} in ${file}`);
    }
  });

  it("keeps the tool-invocation pointer out of every operator-facing doc", () => {
    const files = [
      CHILD_TEMPLATE, INTAKE, CONFORMANCE, REQUIREMENTS, KICKOFF, BOOTSTRAP,
      SKILL, NOTEBOOK_CONTRACT, README, CHANGELOG, CHUNKER, EVIDENCE, VALIDATION_PLAN, PIPELINE,
    ];
    for (const file of files) {
      lacks(file, /node --test|verify\.test\.mjs|verify-fixtures/, `suite pointer in ${file}`);
    }
  });
});

describe("docs behavior — claims-draft/3 profile drives the verifier", () => {
  it("parses the profile from both docs and the parsed field sets agree", () => {
    const child = parseProfileBlock(profileBlock(CHILD_TEMPLATE, "Write claims-draft/3 at {claims_draft_path}:", "."));
    const intake = parseProfileBlock(profileBlock(INTAKE, "frozen S28 structural profile:", ". No magic"));
    assert.deepEqual(canonProfile(intake), canonProfile(child), "child-template and intake claims profiles must agree");
    assert.deepEqual(
      child.sources.required.map((f) => f.name),
      ["source_ref", "locator", "path", "role", "sha256", "byte_length"],
      "documented sources profile",
    );
    assert.deepEqual(child.sources.optional, ["blob_subject"], "documented sources optional");
    assert.deepEqual(
      child.conflicts.required.find((f) => f.name === "quotes").nested.required.map((f) => f.name),
      ["source_ref", "quote", "offset_bytes"],
      "documented conflict-quote profile",
    );
    assert.equal(requiredProbes(child).length, 32, "documented required-field matrix size");
  });

  it("every documented required field fails removal with shape + its own pointer", () => {
    const profile = parseProfileBlock(profileBlock(CHILD_TEMPLATE, "Write claims-draft/3 at {claims_draft_path}:", "."));
    const probes = requiredProbes(profile);
    const run = materializeRun("docs-claims-removal");
    const pristine = readText(run, CLAIMS_DRAFT);
    for (const probe of probes) {
      editJson(run, CLAIMS_DRAFT, (draft) => deleteAtPath(draft, probe.path));
      resealEnvelope(run);
      const { failed } = expectFailedCheck(
        runVerifier(["claims", "--run", run], { runRoot: run }),
        1, "shape", undefined, `delete ${probe.pointer}`,
      );
      assert.match(
        failed.detail,
        new RegExp(`^invalid field: ${escapeRe(probe.pointer)} expected `),
        `delete ${probe.pointer}: shape pointer mismatch (got ${JSON.stringify(failed.detail)})`,
      );
      writeText(run, CLAIMS_DRAFT, pristine);
      resealEnvelope(run);
    }
  });

  it("documented optional blob_subject stays optional; representative wrong types fail", () => {
    const run = materializeRun("docs-claims-types");
    const pristine = readText(run, CLAIMS_DRAFT);
    const restore = () => { writeText(run, CLAIMS_DRAFT, pristine); resealEnvelope(run); };
    const mutate = (fn, detail, label) => {
      editJson(run, CLAIMS_DRAFT, fn);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, "shape", detail, label);
      restore();
    };

    editJson(run, CLAIMS_DRAFT, (draft) => { draft.sources[0].blob_subject = "deadbeef"; });
    resealEnvelope(run);
    expectVerdict(runVerifier(["claims", "--run", run], { runRoot: run }), 0, "blob_subject present");
    restore();
    expectVerdict(runVerifier(["claims", "--run", run], { runRoot: run }), 0, "blob_subject absent");

    mutate((draft) => { draft.sources[0].byte_length = "123"; }, "invalid field: /sources/0/byte_length expected nonnegative integer", "byte_length string");
    mutate((draft) => { draft.claims[0].also_in = "x"; }, "invalid field: /claims/0/also_in expected array", "also_in string");
    mutate((draft) => { draft.conflicts[0].quotes[0].offset_bytes = "0"; }, "invalid field: /conflicts/0/quotes/0/offset_bytes expected null or nonnegative integer", "offset_bytes string");
  });
});

describe("docs behavior — pilot policy, verifier pin, pin schema, candidate token", () => {
  it("documented pilot constants are the enforced join policy", () => {
    const pilotLine = read(INTAKE).split("\n").find((line) => line.startsWith("pilot: {"));
    assert.ok(pilotLine, "intake must carry the pilot policy line");
    const docWitness = Number(/witness_max_chars:\s*(\d+)/.exec(pilotLine)?.[1]);
    const docRetry = Number(/retry_limit:\s*(\d+)/.exec(pilotLine)?.[1]);
    const docResplit = /resplit:\s*([a-z]+)/.exec(pilotLine)?.[1];
    const docDepth = Number(/max_resplit_depth:\s*(\d+)/.exec(pilotLine)?.[1]);
    assert.equal(docWitness, 160, "documented witness bound");
    assert.equal(docRetry, 1, "documented retry limit");
    assert.equal(docResplit, "halves", "documented resplit policy");
    assert.equal(docDepth, 1, "documented resplit depth");
    assert.match(pilotLine, /operator_ref/, "documented operator ref");
    assert.match(pilotLine, /output_ceiling_bytes:\s*null/, "documented default output ceiling");
    has(CHILD_TEMPLATE, "witness_max_chars: 160", "child-template witness constant");
    has(CHILD_TEMPLATE, "one retry, halves, depth ≤ 1", "child-template recovery constants");

    const run = materializeRun("docs-pilot");
    const pristinePilot = readJson(run, RUN_MANIFEST).pilot;
    const withPilot = (mutate) => {
      editJson(run, RUN_MANIFEST, (env) => {
        env.pilot = structuredClone(pristinePilot);
        mutate(env.pilot);
      });
    };
    const probes = [
      { label: "witness_max_chars ≠ documented", mutate: (p) => { p.witness_max_chars = docWitness + 1; }, check: "join.budget", detail: "pilot witness_max_chars mismatch" },
      { label: "retry_limit ≠ documented", mutate: (p) => { p.retry_limit = docRetry + 1; }, check: "join.recovery", detail: "retry policy mismatch" },
      { label: "resplit ≠ documented", mutate: (p) => { p.resplit = "thirds"; }, check: "join.recovery", detail: "retry policy mismatch" },
      { label: "max_resplit_depth ≠ documented", mutate: (p) => { p.max_resplit_depth = docDepth + 1; }, check: "join.recovery", detail: "retry policy mismatch" },
      { label: "operator_ref missing", mutate: (p) => { delete p.operator_ref; }, check: "join.budget", detail: "pilot operator_ref missing" },
      { label: "output_ceiling_bytes wrong type", mutate: (p) => { p.output_ceiling_bytes = "1"; }, check: "join.budget", detail: "pilot output ceiling invalid" },
    ];
    for (const probe of probes) {
      withPilot(probe.mutate);
      expectFailedCheck(runVerifier(["join", "--run", run], { runRoot: run }), 1, probe.check, probe.detail, probe.label);
    }
    withPilot((p) => { p.output_ceiling_bytes = null; });
    const pass = expectVerdict(runVerifier(["join", "--run", run], { runRoot: run }), 0, "monitoring-only output ceiling");
    assert.match(findCheck(pass, "join.budget")?.detail ?? "", /monitoring only/, "null ceiling must stay monitoring-only");
  });

  it("documented verifier pin fields are enforced (path, identity, tool_version)", () => {
    const line = read(INTAKE).split("\n").find((l) => l.startsWith("verifier: {"));
    assert.ok(line, "intake must carry the verifier pin line");
    assert.equal(/path:\s*(\S+?)[,\s]/.exec(line)?.[1], "kernel/tools/verify.mjs", "documented verifier path");
    assert.match(line, /tool_version:\s*1\.0\.0/, "documented verifier tool_version");

    const run = materializeRun("docs-verifier-pin");
    const pristine = readJson(run, RUN_MANIFEST).verifier;
    const reset = () => editJson(run, RUN_MANIFEST, (env) => { env.verifier = structuredClone(pristine); });

    reset();
    editJson(run, RUN_MANIFEST, (env) => { delete env.verifier.path; });
    expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, "shape", "invalid field: /verifier/path expected nonempty string", "deleted verifier.path");

    reset();
    editJson(run, RUN_MANIFEST, (env) => { env.verifier.path = "kernel/tools/other.mjs"; });
    expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, "verifier.identity", "verifier path mismatch", "other verifier.path");

    reset();
    editJson(run, RUN_MANIFEST, (env) => { delete env.verifier.tool_version; });
    expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, "verifier.version", "verifier tool_version mismatch", "deleted verifier.tool_version");
  });

  it("envelope primary pin entries require a nonempty schema_version string", () => {
    const run = materializeRun("docs-pin-schema");
    editJson(run, RUN_MANIFEST, (env) => { delete env.claims_draft.schema_version; });
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      1, "schema", "invalid field: /claims_draft/schema_version expected nonempty string",
      "claims_draft pin schema_version",
    );
  });

  it("documented primary pin lines carry exactly ref + sha256 + schema_version", () => {
    // Parse-couple the intake output-manifest pin examples so removing a field
    // from the doc (not just from the envelope) fails this suite: the tool
    // enforces a recorded ref pair and schema per primary artifact.
    for (const key of ["claims_draft", "units_manifest", "join_draft"]) {
      const line = read(INTAKE).split("\n").find((l) => l.startsWith(`${key}: {`));
      assert.ok(line, `intake must document the ${key} pin entry`);
      const names = line
        .slice(line.indexOf("{") + 1, line.indexOf("}"))
        .split(",")
        .map((part) => part.trim().split(":")[0].trim());
      assert.deepEqual(names, ["ref", "sha256", "schema_version"], `documented ${key} pin fields`);
    }
  });

  it("the enforced join candidate field is `candidate_unclaimed` end-to-end", () => {
    lacks(INTAKE, /candidate-unclaimed/, "hyphenated candidate-unclaimed");
    lacks(CHILD_TEMPLATE, /candidate-unclaimed/, "hyphenated candidate-unclaimed");
    has(INTAKE, "candidate_unclaimed[]", "enforced candidate_unclaimed token");
    has(CHILD_TEMPLATE, "candidate_unclaimed", "enforced candidate_unclaimed token");

    const run = materializeRun("docs-candidates");
    editJson(run, JOIN_DRAFT, (join) => { delete join.candidate_unclaimed; });
    resealRun(run);
    expectFailedCheck(
      runVerifier(["join", "--run", run], { runRoot: run }),
      1, "join.candidates", "invalid field: /candidate_unclaimed expected array",
      "candidate_unclaimed removal",
    );
  });
});

describe("docs behavior — envelope prep mode + fail-closed rules (fix 4 docs)", () => {
  it("intake documents `verify envelope` and every flag the tool's usage advertises", () => {
    has(INTAKE, "verify envelope", "envelope prep mode");
    has(INTAKE, "stdout only", "stdout-only rule");
    has(INTAKE, "never writes files", "no-write rule");
    has(INTAKE, "binds the envelope sha256 before the delegated", "frame-bind-before-verify rule");
    has(INTAKE, "regeneration after that freeze is not verification", "regeneration rule");
    has(INTAKE, "REFUSE envelope:", "envelope refusal summary");
    has(INTAKE, "Without `--attempts` the generator records first-attempt acceptance", "recovery-history boundary");
    has(INTAKE, "recovery semantics are validated by the delegated `verify join`", "verifier owns recovery semantics");

    const refusal = expectVerdict(runVerifier(["envelope"]), 2, "envelope usage refusal");
    const usage = findFailedCheck(refusal, "cli")?.detail ?? "";
    const flags = [...new Set(usage.match(/--[a-z-]+/g) ?? [])].sort();
    assert.ok(flags.length >= 6, `expected the tool's envelope flags, got: ${flags.join(", ")}`);
    for (const flag of flags) has(INTAKE, flag, `documented envelope flag ${flag}`);
  });

  it("intake documents the fail-closed envelope identity rules", () => {
    has(INTAKE, "`verifier.path` is exactly `kernel/tools/verify.mjs`", "verifier path rule");
    has(INTAKE, "absent or non-string fails shape", "verifier path shape rule");
    has(INTAKE, "a different path fails `verifier.identity`", "verifier path identity rule");
    has(INTAKE, "40-char lowercase hex", "oid shape rule");
    has(INTAKE, "`pilot.operator_ref` is a required nonempty string", "operator_ref rule");
    has(INTAKE, "`pilot.output_ceiling_bytes` is exactly `null`", "output ceiling rule");
    has(INTAKE, "nonnegative integer", "output ceiling int rule");
    has(INTAKE, "nonempty `schema_version` string", "pin schema_version rule");
  });

  it("CHANGELOG adds the verifier follow-up above the pinned-verifier history", () => {
    const body = read(CHANGELOG);
    const followupAt = body.indexOf("### 2026-10-04 — verifier follow-up: fail-closed envelope + prep generator");
    const pinnedAt = body.indexOf("### 2026-10-04 — pinned mechanical verifier (claims | units | join)");
    assert.ok(followupAt !== -1, "missing verifier follow-up subsection");
    assert.ok(pinnedAt !== -1 && followupAt < pinnedAt, "follow-up subsection must sit above the pinned-verifier section");
    has(CHANGELOG, "operator_ref", "pilot operator_ref");
    has(CHANGELOG, "output_ceiling_bytes", "pilot output ceiling");
    has(CHANGELOG, "verifier.path", "verifier path");
    has(CHANGELOG, "nonempty `schema_version`", "pin schema_version");
    has(CHANGELOG, "verify envelope", "envelope prep generator");
    has(CHANGELOG, "frame", "frame-bind rule");
    assert.match(body, /The coordinator gate is not a shipped tool\./, "historical 2026-10-02 sentence must remain");
  });

  it("KICKOFF §8 records envelope generation as coordinator prep before delegated verification", () => {
    has(KICKOFF, "`run-manifest.json` generation is coordinator prep via `verify envelope`", "envelope prep clause");
    has(KICKOFF, "(recording, not verification)", "recording clause");
    has(KICKOFF, "envelope sha256 is frozen in the frame before verification", "frame freeze clause");
    has(KICKOFF, "mechanical verification itself remains delegated `fast`", "delegated verification clause");
  });
});

// ---------------------------------------------------------------------------
// Context-token budget engine docs (approved plan 2026-10-05, S1–S7).
//
// S2 is behavioral: the documented field contracts/repair map are parsed and
// the documented capture shape drives the real verifier end-to-end (envelope
// generation -> rewritten run-manifest.json -> delegated join), including the
// schema-class, pin and path-base refusal/failure matrix. S1/S3–S7 are
// mechanical clause/role tests over the docs: they prove the contract text is
// present and not contradicted, not that a model obeys it at runtime (plan §5).
// ---------------------------------------------------------------------------

/** Extract the first fenced ```json block after `marker`; doc examples carry no nested fences. */
function jsonExample(file, marker) {
  const text = read(file);
  const at = text.indexOf(marker);
  assert.ok(at !== -1, `${file}: missing example marker ${JSON.stringify(marker)}`);
  const fence = text.indexOf("```json", at);
  assert.ok(fence !== -1, `${file}: missing json fence after ${JSON.stringify(marker)}`);
  const from = fence + "```json".length;
  const end = text.indexOf("```", from);
  assert.ok(end !== -1, `${file}: unterminated json fence after ${JSON.stringify(marker)}`);
  try {
    return JSON.parse(text.slice(from, end));
  } catch (err) {
    assert.fail(`${file}: invalid JSON example after ${JSON.stringify(marker)}: ${err.message}`);
  }
}

describe("docs contract — artifact contracts S2 (field contracts + repair protocol)", () => {
  it("documents the capture manifest as schema-less with identity, sources, title pins and changed files", () => {
    has(ARTIFACT_CONTRACTS, "schema-less", "schema-less capture rule");
    has(ARTIFACT_CONTRACTS, "Omit `schema_version`", "schema omission rule");
    has(ARTIFACT_CONTRACTS, "any declared value is refused by `verify envelope`", "generator refusal rule");
    has(ARTIFACT_CONTRACTS, "nonempty unknown or wrong-family declaration refuses exit 2", "unknown refusal class");
    has(ARTIFACT_CONTRACTS, "empty or wrong-typed declaration fails shape with exit 1", "empty/wrong-typed shape class");

    const example = jsonExample(ARTIFACT_CONTRACTS, "<!-- capture-manifest-example -->");
    assert.equal(example.schema_version, undefined, "capture example must omit schema_version");
    for (const field of ["run", "review_state", "subject_oid", "base_oid", "cure_light_source_head_oid", "sources", "changed_files"]) {
      assert.ok(field in example, `capture example missing ${field}`);
    }
    assert.ok(Array.isArray(example.sources) && example.sources.length > 0, "capture example sources nonempty");
    for (const field of ["locator", "path", "capture_sha256", "capture_byte_length"]) {
      assert.ok(field in example.sources[0], `capture example source missing ${field}`);
    }
    assert.ok("title_path" in example.sources[0], "capture example title pin");
  });

  it("parses the claims-draft/3 root schema example and the run-envelope example", () => {
    has(ARTIFACT_CONTRACTS, "`schema_version: \"claims-draft/3\"` is required", "claims root schema rule");
    const claims = jsonExample(ARTIFACT_CONTRACTS, "<!-- claims-draft-example -->");
    assert.equal(claims.schema_version, "claims-draft/3", "claims example root schema");
    for (const field of ["run", "review_state", "subject_oid", "base_oid", "sources", "claims", "nonclaims", "conflicts"]) {
      assert.ok(field in claims, `claims example missing ${field}`);
    }

    const envelope = jsonExample(ARTIFACT_CONTRACTS, "<!-- run-envelope-example -->");
    assert.equal(envelope.schema_version, "run-verification/1", "envelope example schema");
    assert.deepEqual(Object.keys(envelope.capture_manifest).sort(), ["ref", "sha256"], "capture pin is ref+sha256 only");
    for (const key of ["claims_draft", "units_manifest", "join_draft"]) {
      assert.deepEqual(Object.keys(envelope[key]).sort(), ["ref", "schema_version", "sha256"], `${key} primary pin fields`);
    }
    assert.equal(envelope.pilot.witness_max_chars, 160, "documented witness constant");
    assert.equal(envelope.pilot.retry_limit, 1, "documented retry constant");
    assert.equal(envelope.pilot.resplit, "halves", "documented resplit constant");
    assert.equal(envelope.pilot.max_resplit_depth, 1, "documented resplit depth");
  });

  it("documents the two path bases and drives the real claims validator on each", () => {
    has(ARTIFACT_CONTRACTS, "`path` and `title_path` resolve relative to `claims/`", "capture base rule");
    has(ARTIFACT_CONTRACTS, "claims-draft `sources[].path` resolves relative to the run root", "claims base rule");
    has(ARTIFACT_CONTRACTS, "cannot read artifact: claims/claims/", "wrong-base fingerprint");

    const run = materializeRun("s2-path-bases");
    const capturePristine = readText(run, CAPTURE_MANIFEST);
    const claimsPristine = readText(run, CLAIMS_DRAFT);
    const restore = () => {
      writeText(run, CAPTURE_MANIFEST, capturePristine);
      writeText(run, CLAIMS_DRAFT, claimsPristine);
      resealEnvelope(run);
    };
    expectVerdict(runVerifier(["claims", "--run", run], { runRoot: run }), 0, "baseline path bases");

    editJson(run, CAPTURE_MANIFEST, (c) => { c.sources[0].path = "claims/sources/pr-body.md"; });
    resealEnvelope(run);
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      1, "artifact.read", "cannot read artifact: claims/claims/sources/pr-body.md",
      "capture path with run-root base",
    );

    restore();
    editJson(run, CAPTURE_MANIFEST, (c) => { c.sources[0].title_path = "claims/sources/pr-title.txt"; });
    resealEnvelope(run);
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      1, "artifact.read", "cannot read artifact: claims/claims/sources/pr-title.txt",
      "capture title_path with run-root base",
    );

    restore();
    editJson(run, CLAIMS_DRAFT, (c) => { c.sources[0].path = "sources/pr-body.md"; });
    resealEnvelope(run);
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      1, "artifact.read", "cannot read artifact: sources/pr-body.md",
      "claims path with capture base",
    );

    restore();
    expectVerdict(runVerifier(["claims", "--run", run], { runRoot: run }), 0, "restored path bases");
  });

  it("regenerates the documented envelope from the real generator and passes the delegated join boundary", () => {
    const run = materializeRun("s2-envelope-prep");
    const seed = readJson(run, RUN_MANIFEST);
    const chunkerSha = sha256(readFileSync(path.join(ROOT, "kernel/tools/chunker.mjs")));
    const gen = runVerifier([
      "envelope", "--run", run,
      "--operator-ref", seed.pilot.operator_ref,
      "--chunker-sha256", chunkerSha,
      "--input-ceiling-bytes", String(seed.pilot.input_ceiling_bytes),
    ]);
    assert.equal(gen.status, 0, `envelope generation failed\n${report(gen)}`);
    const envelope = (() => {
      try { return JSON.parse(gen.stdout); } catch (err) { assert.fail(`envelope stdout must be one JSON document: ${err.message}\n${report(gen)}`); }
    })();
    assert.equal(envelope.schema_version, "run-verification/1", "envelope schema");
    assert.deepEqual(Object.keys(envelope.capture_manifest).sort(), ["ref", "sha256"], "capture pin carries no schema_version");
    assert.equal(envelope.capture_manifest.ref, "claims/sources/capture-manifest.json", "capture ref");
    assert.deepEqual(envelope.verifier, {
      path: "kernel/tools/verify.mjs",
      sha256: sha256(readFileSync(path.join(ROOT, "kernel/tools/verify.mjs"))),
      tool_version: "1.0.0",
    }, "verifier pin recomputed from actual bytes");
    assert.equal(envelope.chunker.path, "kernel/tools/chunker.mjs", "chunker path");
    assert.equal(envelope.chunker.sha256, chunkerSha, "chunker sha recorded");
    assert.deepEqual(
      Object.keys(envelope.pilot).sort(),
      ["input_ceiling_bytes", "max_resplit_depth", "operator_ref", "output_ceiling_bytes", "resplit", "retry_limit", "witness_max_chars"],
      "pilot field set",
    );
    assert.ok(Array.isArray(envelope.unit_payloads) && envelope.unit_payloads.length > 0, "unit payload pins");
    assert.deepEqual(Object.keys(envelope.unit_payloads[0]).sort(), ["ref", "sha256", "unit_id"], "unit payload pin shape");

    writeText(run, RUN_MANIFEST, gen.stdout);
    expectVerdict(runVerifier(["join", "--run", run], { runRoot: run }), 0, "regenerated envelope join");
  });

  it("classifies capture schema declarations per the documented refusal/shape matrix", () => {
    const chunkerSha = sha256(readFileSync(path.join(ROOT, "kernel/tools/chunker.mjs")));
    for (const [label, sv] of [["empty", ""], ["unknown", "unknown-family/1"]]) {
      const run = materializeRun(`s2-capture-file-schema-${label}`);
      editJson(run, CAPTURE_MANIFEST, (c) => { c.schema_version = sv; });
      const r = runVerifier(["envelope", "--run", run, "--operator-ref", "s2", "--chunker-sha256", chunkerSha, "--input-ceiling-bytes", "196608"]);
      const verdict = expectVerdict(r, 2, `capture file schema ${label}`);
      const failed = findFailedCheck(verdict, "envelope");
      assert.ok(failed, `capture file schema ${label}: envelope refusal check\n${report(r)}`);
      assert.match(failed.detail, /unsupported capture schema_version/);
      assert.ok(verdict.capture_manifest === undefined, "a refusal never emits an envelope");
    }

    const entryCases = [
      { sv: "", status: 1, check: "schema", detail: "invalid field: /capture_manifest/schema_version expected nonempty string" },
      { sv: 42, status: 1, check: "schema", detail: "invalid field: /capture_manifest/schema_version expected nonempty string" },
      { sv: "unknown-family/1", status: 2, check: "schema", detail: 'unsupported schema_version: "unknown-family/1"' },
      { sv: "claims-draft/3", status: 2, check: "artifact.discovery", detail: 'wrong schema kind: "claims-draft/3" for capture' },
    ];
    for (const probe of entryCases) {
      const run = materializeRun(`s2-capture-entry-${String(probe.sv).replace(/\W+/g, "-") || "empty"}`);
      editJson(run, RUN_MANIFEST, (env) => { env.capture_manifest.schema_version = probe.sv; });
      resealEnvelope(run);
      expectFailedCheck(
        runVerifier(["claims", "--run", run], { runRoot: run }),
        probe.status, probe.check, probe.detail,
        `capture entry schema ${JSON.stringify(probe.sv)}`,
      );
    }

    const run = materializeRun("s2-capture-pin");
    editJson(run, RUN_MANIFEST, (env) => { env.capture_manifest.sha256 = "0".repeat(64); });
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      1, "artifact.sha256", 'sha256 mismatch: "claims/sources/capture-manifest.json"',
      "capture pin mismatch",
    );
  });

  it("drives the documented claims root schema matrix through the real claims validator", () => {
    const run = materializeRun("s2-claims-root-schema");
    const pristine = readText(run, CLAIMS_DRAFT);
    const restore = () => { writeText(run, CLAIMS_DRAFT, pristine); resealEnvelope(run); };

    editJson(run, CLAIMS_DRAFT, (d) => { delete d.schema_version; });
    resealEnvelope(run);
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      1, "schema", "invalid field: /schema_version expected nonempty string",
      "deleted claims root schema",
    );

    restore();
    editJson(run, CLAIMS_DRAFT, (d) => { d.schema_version = "claims-draft/9"; });
    resealEnvelope(run);
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      2, "schema", 'unsupported schema_version: "claims-draft/9"',
      "unknown claims root schema",
    );

    restore();
    editJson(run, CLAIMS_DRAFT, (d) => { d.schema_version = "join-draft/1"; });
    resealEnvelope(run);
    expectFailedCheck(
      runVerifier(["claims", "--run", run], { runRoot: run }),
      2, "artifact.discovery", 'wrong schema kind: "join-draft/1" for claims',
      "wrong-family claims root schema",
    );

    restore();
    expectVerdict(runVerifier(["claims", "--run", run], { runRoot: run }), 0, "restored claims root schema");
  });

  it("carries the error-to-field repair map and the distinct repair-child protocol", () => {
    has(ARTIFACT_CONTRACTS, "Error → field → doc anchor", "repair map heading");
    for (const token of ["/schema_version", "artifact.read", "artifact.path", "artifact.sha256", "identity mismatch", "join.prerequisites", "wrong schema kind"]) {
      has(ARTIFACT_CONTRACTS, token, `repair map token ${token}`);
    }
    has(ARTIFACT_CONTRACTS, "distinct `fast` artifact-preparation/repair child", "distinct repair child");
    has(ARTIFACT_CONTRACTS, "never the verification child", "repair is not the verifier");
    has(ARTIFACT_CONTRACTS, "never changes captured source meaning, witness bytes, policy or claims semantics just to pass", "no semantics-by-repair");
    has(ARTIFACT_CONTRACTS, "Ambiguity or an identity/refusal case pauses", "pause rule");
    has(ARTIFACT_CONTRACTS, "operator escalation", "escalation rule");
    has(ARTIFACT_CONTRACTS, "no coordinator source reading", "coordinator boundary");

    has(INTAKE, "distinct `fast` artifact-preparation/repair child", "intake repair child");
    has(INTAKE, "The repair child is never the verification child", "intake repair role");
    has(INTAKE, "exact verdict/error refs", "intake verdict refs");
    has(CHILD_TEMPLATE, "distinct `fast` repair child", "child-template repair child");

    for (const [file, label] of [[INTAKE, "intake"], [CHILD_TEMPLATE, "child template"], [CHUNKER, "chunker"], [BOOTSTRAP, "BOOTSTRAP"], [CONTEXT_LOADING, "stage map"]]) {
      has(file, "artifact-contracts.md", `${label} link to artifact contracts`);
    }
  });
});

// ---------------------------------------------------------------------------
// S2 follow-up — S35 artifact-shape repair loop (2026-10-05):
// the merged join-draft `boxes[]` entry schema, the pre-recording envelope
// requirements, the `source_consistency` field rules and their repair-map
// rows. RED-first: the content assertions were red before the matching
// artifact-contracts.md edits; the mutation matrix encodes today's real
// verifier outcomes (probed live before authoring).
// ---------------------------------------------------------------------------

describe("docs contract — artifact contracts S2 follow-up (boxes[], source_consistency, repair map)", () => {
  const envelopeArgs = (run, seed) => [
    "envelope", "--run", run,
    "--operator-ref", seed.pilot.operator_ref,
    "--chunker-sha256", sha256(readFileSync(path.join(ROOT, "kernel/tools/chunker.mjs"))),
    "--input-ceiling-bytes", String(seed.pilot.input_ceiling_bytes),
  ];

  it("documents the merged join-draft boxes[] entry schema and drives every shape mutation", () => {
    for (const phrase of [
      "entries carry five required fields",
      "box output pin",
      "must equal the sha256 of the exact",
      "must equal the actual row count",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `boxes[] entry contract phrase ${phrase}`);
    }

    const baseline = materializeRun("s2f-box-baseline");
    expectVerdict(runVerifier(["join", "--run", baseline], { runRoot: baseline }), 0, "baseline join");

    const mutations = [
      ["sha256 removed", (j) => { delete j.boxes[0].sha256; }, "invalid field: /boxes/0/sha256 expected nonempty string"],
      ["path removed", (j) => { delete j.boxes[0].path; }, "invalid field: /boxes/0/path expected nonempty string"],
      ["box_id removed", (j) => { delete j.boxes[0].box_id; }, "invalid field: /boxes/0/box_id expected nonempty string"],
      ["rows negative", (j) => { j.boxes[0].rows = -1; }, "invalid field: /boxes/0/rows expected nonnegative integer"],
      ["links non-integer", (j) => { j.boxes[0].links = "2"; }, "invalid field: /boxes/0/links expected nonnegative integer"],
    ];
    for (const [label, mutate, detail] of mutations) {
      const run = materializeRun(`s2f-box-${label.replace(/\W+/g, "-")}`);
      editJson(run, JOIN_DRAFT, mutate);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["join", "--run", run], { runRoot: run }), 1, "shape", detail, label);
    }
  });

  it("documents the pre-recording join-draft rules and drives the real envelope generator refusals", () => {
    for (const phrase of [
      "malformed join draft: boxes entry",
      "malformed join draft: boxes",
      "ambiguous join draft",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `envelope-prep contract phrase ${phrase}`);
    }

    const baseline = materializeRun("s2f-env-baseline");
    const baselineSeed = readJson(baseline, RUN_MANIFEST);
    const gen = runVerifier(envelopeArgs(baseline, baselineSeed), { runRoot: baseline });
    assert.equal(gen.status, 0, `baseline envelope prep failed\n${report(gen)}`);

    const cases = [
      ["boxes not an array", (run) => { editJson(run, JOIN_DRAFT, (j) => { j.boxes = {}; }); }, "malformed join draft: boxes"],
      ["entry without path", (run) => { editJson(run, JOIN_DRAFT, (j) => { delete j.boxes[0].path; }); }, "malformed join draft: boxes entry"],
      ["entry with empty box_id", (run) => { editJson(run, JOIN_DRAFT, (j) => { j.boxes[0].box_id = ""; }); }, "malformed join draft: boxes entry"],
      ["two join drafts", (run) => { writeText(run, "join/join-draft.alt.json", readText(run, JOIN_DRAFT)); }, "ambiguous join draft"],
    ];
    for (const [label, mutate, detail] of cases) {
      const run = materializeRun(`s2f-env-${label.replace(/\W+/g, "-")}`);
      const seed = readJson(run, RUN_MANIFEST);
      mutate(run);
      expectFailedCheck(runVerifier(envelopeArgs(run, seed), { runRoot: run }), 2, "envelope", detail, label);
    }
  });

  it("documents source_consistency field rules and drives the claims validator", () => {
    for (const phrase of [
      "resolves to a recorded `conflicts[].id`",
      "omit the key rather than record an empty value",
      "consistency record not found",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `source_consistency contract phrase ${phrase}`);
    }

    const valid = materializeRun("s2f-sc-valid");
    editJson(valid, CLAIMS_DRAFT, (c) => {
      c.source_consistency = { status: "recorded-inconsistency", records: [], notes: "no recorded items" };
    });
    resealEnvelope(valid);
    expectVerdict(runVerifier(["claims", "--run", valid], { runRoot: valid }), 0, "empty records with notes present");

    const cases = [
      ["notes empty", (c) => { c.source_consistency.notes = ""; }, "shape", "invalid field: /source_consistency/notes expected nonempty string"],
      ["record id empty", (c) => { c.source_consistency.records[0].id = ""; }, "shape", "invalid field: /source_consistency/records/0/id expected nonempty string"],
      ["status wrong type", (c) => { c.source_consistency.status = 42; }, "shape", "invalid field: /source_consistency/status expected nonempty string"],
      ["records wrong type", (c) => { c.source_consistency.records = {}; }, "shape", "invalid field: /source_consistency/records expected array"],
      ["record id unresolved", (c) => { c.source_consistency.records[0].id = "X99"; }, "claims.conflicts", 'consistency record not found: "X99"'],
    ];
    for (const [label, mutate, check, detail] of cases) {
      const run = materializeRun(`s2f-sc-${label.replace(/\W+/g, "-")}`);
      editJson(run, CLAIMS_DRAFT, mutate);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, check, detail, label);
    }
  });

  it("extends the repair map with the observed envelope/join/source_consistency refusals", () => {
    const body = read(ARTIFACT_CONTRACTS);
    const map = norm(body.slice(body.indexOf("## 7. Error → field → doc anchor")));
    for (const token of [
      "malformed join draft: boxes",
      "malformed join draft: boxes entry",
      "ambiguous join draft",
      "/boxes/<i>/",
      "source_consistency",
      "consistency record not found",
    ]) {
      assert.ok(map.includes(norm(token)), `§7 repair map missing token ${token}`);
    }
  });
});

// ---------------------------------------------------------------------------
// S36 follow-up: the conflicts[] vocabulary the verifier enforces (kind,
// materiality, precedence) was documented as a field list only; S36 Phase 0
// invented kind subtypes ("retry-semantics") and a graded materiality
// ("medium"), failing `claims.conflicts` and cascading into the join
// prerequisite. The content assertions were RED before the matching
// artifact-contracts.md and child-template edits; the mutation matrix encodes
// today's real verifier outcomes (probed live before authoring).
// ---------------------------------------------------------------------------

describe("docs contract — conflicts[] vocabulary (S36 follow-up)", () => {
  it("documents the conflicts[] kind/materiality enums and precedence rule", () => {
    for (const phrase of [
      "kind` is one of `within-source` or `cross-source`",
      "materiality` is one of `material` or `non-material`",
      "structural enums only",
      "precedence` is a required nonempty string",
      "invalid conflict kind",
      "invalid conflict materiality",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `conflicts[] contract phrase ${phrase}`);
    }
    has(CHILD_TEMPLATE, "kind is `within-source` or `cross-source`", "P0.2 conflicts kind enum");
    has(CHILD_TEMPLATE, "materiality is `material` or `non-material`", "P0.2 conflicts materiality enum");
    has(CHILD_TEMPLATE, "precedence is a required nonempty string", "P0.2 precedence requirement");
  });

  it("parses the valid conflicts[] vocabulary example", () => {
    const example = jsonExample(ARTIFACT_CONTRACTS, "<!-- conflicts-example -->");
    assert.equal(example.kind, "cross-source", "example kind enum");
    assert.equal(example.materiality, "material", "example materiality enum");
    assert.equal(example.precedence, "none", "example precedence convention");
    assert.ok(Array.isArray(example.quotes) && example.quotes.length > 0, "example quotes present");
    assert.ok(Array.isArray(example.affected_claim_ids) && example.affected_claim_ids.length > 0, "example affected ids present");
  });

  it("drives the real claims validator on the documented vocabulary", () => {
    const baseline = materializeRun("s36-cf-baseline");
    expectVerdict(runVerifier(["claims", "--run", baseline], { runRoot: baseline }), 0, "baseline claims");

    const cases = [
      ["invented kind subtype", (c) => { c.conflicts[0].kind = "retry-semantics"; }, "claims.conflicts",
        'invalid conflict kind: "X01": "retry-semantics"'],
      ["invented graded materiality", (c) => { c.conflicts[0].materiality = "medium"; }, "claims.conflicts",
        'invalid conflict materiality: "X01": "medium"'],
      ["precedence null", (c) => { c.conflicts[0].precedence = null; }, "shape",
        "invalid field: /conflicts/0/precedence expected nonempty string"],
    ];
    for (const [label, mutate, check, detail] of cases) {
      const run = materializeRun(`s36-cf-${label.replace(/\W+/g, "-")}`);
      editJson(run, CLAIMS_DRAFT, mutate);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, check, detail, label);
    }
  });

  it("extends the repair map with the conflicts[] vocabulary refusals", () => {
    const body = read(ARTIFACT_CONTRACTS);
    const map = norm(body.slice(body.indexOf("## 7. Error → field → doc anchor")));
    for (const token of [
      "invalid conflict kind",
      "invalid conflict materiality",
      "/conflicts/<i>/precedence",
    ]) {
      assert.ok(map.includes(norm(token)), `§7 repair map missing token ${token}`);
    }
  });
});

// ---------------------------------------------------------------------------
// S37 follow-up: the box-assignment, claims-list and P0.5 authoring contract.
// In S37 the coordinator trial-and-errored the accepted assignment shape
// through 57 refused envelope invocations (~87 s wall) because no doc outside
// verify.mjs/tests described it; the refusal loop also triggered a tool-source
// diagnosis child. RED-first: the content assertions were red before the
// matching artifact-contracts.md edits; the mutation matrix encodes today's
// real generator/join outcomes (probed live before authoring).
// ---------------------------------------------------------------------------

describe("docs contract — artifact contracts S2 follow-up (assignment / claims-list / P0.5 authoring)", () => {
  const envelopeArgs = (run, seed) => [
    "envelope", "--run", run,
    "--operator-ref", seed.pilot.operator_ref,
    "--chunker-sha256", sha256(readFileSync(path.join(ROOT, "kernel/tools/chunker.mjs"))),
    "--input-ceiling-bytes", String(seed.pilot.input_ceiling_bytes),
  ];

  /** Normed §5 slice (join draft + assignment/claims-list/P0.5 authoring). */
  const section5 = () => {
    const body = read(ARTIFACT_CONTRACTS);
    const from = body.indexOf("## 5.");
    const to = body.indexOf("## 6.", from);
    assert.ok(from !== -1 && to !== -1, "artifact-contracts §5 section bounds");
    return norm(body.slice(from, to));
  };

  it("documents the assignment authoring contract, refusal order and skeleton example", () => {
    for (const phrase of [
      "Assignment authoring contract",
      "the generator refuses the first failing check in this order",
      "not an exclusive allowed-key set",
      "key-level reporting is deferred",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `assignment contract phrase ${phrase}`);
    }

    const example = jsonExample(ARTIFACT_CONTRACTS, "<!-- assignment-example -->");
    const fields = ["box_id", "output_path", "manifest_ref", "manifest_sha256", "claims_list_path", "units", "units_dir", "unit_count", "total_unit_bytes", "input_ceiling_bytes", "claims_list_bytes"];
    for (const field of fields) {
      assert.ok(field in example, `assignment example missing ${field}`);
      assert.ok(section5().includes(field), `§5 assignment contract missing field ${field}`);
    }
    assert.ok(Array.isArray(example.units) && example.units.length > 0, "assignment example units nonempty");
    assert.equal(example.unit_count, example.units.length, "assignment example unit_count must match units");
    assert.ok(Number.isInteger(example.total_unit_bytes) && example.total_unit_bytes >= 0, "assignment example total_unit_bytes integer");

    for (const token of [
      "assignment box mismatch", "assignment output mismatch", "assignment manifest mismatch",
      "malformed assignment", "input ceiling mismatch", "cannot read artifact",
      "assignment unit count mismatch", "box assignment binding mismatch",
      "claims_list_bytes mismatch", "budget metric mismatch",
    ]) {
      assert.ok(section5().includes(token), `§5 assignment contract missing enforcing check ${token}`);
    }
  });

  it("documents the authoring preflights: locator completeness, derived assignment fields, coarse fingerprints, P0.4 preflight", () => {
    has(ARTIFACT_CONTRACTS, "Locator completeness", "capture locator completeness rule");
    has(ARTIFACT_CONTRACTS, "source ref not captured", "capture-side source-ref fingerprint");
    has(ARTIFACT_CONTRACTS, "units_dir == dirname(manifest_ref)", "derived units_dir equality");
    has(ARTIFACT_CONTRACTS, "coarse fingerprint", "coarse join.assignments fingerprint note");
    has(CHILD_TEMPLATE, "never edit the capture manifest yourself", "claims-child capture-manifest read-only rule");
    has(INTAKE, "Preflight before packing P0.4", "P0.4 preflight recommendation");
  });

  it("drives the real envelope generator across the documented assignment refusal order", () => {
    const baseline = materializeRun("s37-asm-baseline");
    const baselineSeed = readJson(baseline, RUN_MANIFEST);
    const baselineGen = runVerifier(envelopeArgs(baseline, baselineSeed), { runRoot: baseline });
    assert.equal(baselineGen.status, 0, `baseline assignment envelope prep failed\n${report(baselineGen)}`);

    const asm = (mutate) => (run) => editJson(run, BOX_0000_ASSIGNMENT, mutate);
    const cases = [
      ["assignment box_id changed", asm((a) => { a.box_id = "box-9999"; }), 'assignment box mismatch: "box-0000"'],
      ["assignment output_path changed", asm((a) => { a.output_path = "join/box-9999.jsonl"; }), 'assignment output mismatch: "box-0000"'],
      ["assignment manifest_ref changed", asm((a) => { a.manifest_ref = "units/units2/other.json"; }), 'assignment manifest mismatch: "box-0000"'],
      ["assignment manifest_sha256 changed", asm((a) => { a.manifest_sha256 = "0".repeat(64); }), 'assignment manifest mismatch: "box-0000"'],
      ["assignment input ceiling changed", asm((a) => { a.input_ceiling_bytes = 1; }), 'input ceiling mismatch: "box-0000"'],
      ["assignment claims_list_path removed", asm((a) => { delete a.claims_list_path; }), 'malformed assignment: "join/box-0000.assignment.json"'],
      ["assignment units removed", asm((a) => { delete a.units; }), 'malformed assignment: "join/box-0000.assignment.json"'],
      ["assignment units not an array", asm((a) => { a.units = {}; }), 'malformed assignment: "join/box-0000.assignment.json"'],
      ["assignment not an object", (run) => writeText(run, BOX_0000_ASSIGNMENT, "[]"), 'malformed assignment: "join/box-0000.assignment.json"'],
      ["assignment claims-list ref without file", asm((a) => { a.claims_list_path = "join/nope.json"; }), "cannot read artifact: join/nope.json"],
      ["p05 evidence ceiling changed", (run) => editJson(run, P05_EVIDENCE, (e) => { e.budget.input_ceiling_bytes += 1; }), 'input ceiling mismatch: "box-0000"'],
      ["p05 evidence budget removed", (run) => editJson(run, P05_EVIDENCE, (e) => { delete e.budget; }), 'malformed p05 evidence: "join/p05-evidence.json"'],
    ];
    for (const [label, mutate, detail] of cases) {
      const run = materializeRun(`s37-asm-${label.replace(/\W+/g, "-")}`);
      const seed = readJson(run, RUN_MANIFEST);
      mutate(run);
      expectFailedCheck(runVerifier(envelopeArgs(run, seed), { runRoot: run }), 2, "envelope", detail, label);
    }
  });

  it("documents the claims-list projection and drives the join-side assignment/claims-list bindings", () => {
    for (const phrase of [
      "top-level JSON array of exactly `{id, statement}` objects",
      "claims list mismatch",
      "claims_list_bytes mismatch",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `claims-list contract phrase ${phrase}`);
    }
    const example = jsonExample(ARTIFACT_CONTRACTS, "<!-- claims-list-example -->");
    assert.ok(Array.isArray(example) && example.length > 0, "claims-list example is a nonempty array");
    assert.deepEqual(Object.keys(example[0]).sort(), ["id", "statement"], "claims-list example item keys");

    const baseline = materializeRun("s37-join-baseline");
    expectVerdict(runVerifier(["join", "--run", baseline], { runRoot: baseline }), 0, "baseline join");

    const asm = (mutate) => (run) => editJson(run, BOX_0000_ASSIGNMENT, mutate);
    const cases = [
      ["assignment unit_count changed", asm((a) => { a.unit_count = 45; }), "join.assignments", 'assignment unit count mismatch: "box-0000"'],
      ["assignment units_dir changed", asm((a) => { a.units_dir = "units"; }), "join.assignments", 'box assignment binding mismatch: "box-0000"'],
      ["assignment total_unit_bytes changed", asm((a) => { a.total_unit_bytes = 1; }), "join.budget", 'budget metric mismatch: "box-0000":total_unit_bytes'],
      ["assignment claims_list_bytes changed", asm((a) => { a.claims_list_bytes = 1; }), "join.claim_list", 'claims_list_bytes mismatch: "box-0000"'],
      ["claims-list object form", (run) => writeText(run, CLAIMS_LIST, "{}"), "shape", "invalid field: / expected array"],
      ["claims-list item extra key", (run) => editJson(run, CLAIMS_LIST, (list) => { list[0].extra = true; }), "join.claim_list", 'claims list mismatch: "box-0000"'],
      ["claims-list reordered", (run) => editJson(run, CLAIMS_LIST, (list) => { list.reverse(); }), "join.claim_list", 'claims list mismatch: "box-0000"'],
    ];
    for (const [label, mutate, check, detail] of cases) {
      const run = materializeRun(`s37-join-${label.replace(/\W+/g, "-")}`);
      mutate(run);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["join", "--run", run], { runRoot: run }), 1, check, detail, label);
    }
  });

  it("documents the P0.5 records and drives the join p05/budget recomputation", () => {
    for (const phrase of [
      "P0.5 coordinator records",
      "recomputes every count from the actual rows",
      "prose fields",
      "never trusted",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `P0.5 contract phrase ${phrase}`);
    }
    const fields = ["file_rows", "expected_rows", "total_links", "received_rows", "zero_units", "zero_claims", "unresolved", "error_count", "errors", "duplicate_pairs", "claim_link_counts"];
    for (const field of fields) {
      assert.ok(section5().includes(field), `§5 P0.5 contract missing field ${field}`);
    }
    for (const token of ["budget.unit_bytes", "budget.claims_list_bytes", "budget.instructions_bytes", "budget.box_input_bytes", "budget.headroom_bytes", "budget.output_bytes", "budget.output_links"]) {
      assert.ok(section5().includes(token), `§5 P0.5 contract missing budget token ${token}`);
    }

    const cases = [
      ["p05 check file_rows changed", (run) => editJson(run, P05_CHECK, (c) => { c.file_rows += 1; }), "join.p05", 'p05 count mismatch: "box-0000":file_rows'],
      ["p05 evidence zero_units invariant", (run) => editJson(run, P05_EVIDENCE, (e) => { e.zero_units = ["u0000"]; }), "join.p05", 'p05 zero/unresolved mismatch: "box-0000":zero_units'],
      ["p05 evidence unresolved array", (run) => editJson(run, P05_EVIDENCE, (e) => { e.unresolved = ["u0000"]; }), "join.p05", 'p05 zero/unresolved mismatch: "box-0000":unresolved'],
      ["p05 budget unit_bytes changed", (run) => editJson(run, P05_EVIDENCE, (e) => { e.budget.unit_bytes += 1; }), "join.budget", 'budget metric mismatch: "box-0000":unit_bytes'],
    ];
    for (const [label, mutate, check, detail] of cases) {
      const run = materializeRun(`s37-p05-${label.replace(/\W+/g, "-")}`);
      mutate(run);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["join", "--run", run], { runRoot: run }), 1, check, detail, label);
    }
  });

  it("extends the repair map with the assignment/claims-list/P0.5 refusals", () => {
    const body = read(ARTIFACT_CONTRACTS);
    const map = norm(body.slice(body.indexOf("## 7. Error → field → doc anchor")));
    for (const token of [
      "assignment box mismatch",
      "assignment output mismatch",
      "assignment manifest mismatch",
      "malformed assignment",
      "input ceiling mismatch",
      "malformed p05 evidence",
      "cannot read artifact: join/",
      "invalid field: / expected array",
      "claims list mismatch",
      "claims_list_bytes mismatch",
      "assignment unit count mismatch",
      "box assignment binding mismatch",
      "budget metric mismatch",
      "p05 count mismatch",
      "p05 zero/unresolved mismatch",
      "p05 claim_link_counts mismatch",
    ]) {
      assert.ok(map.includes(norm(token)), `§7 repair map missing token ${token}`);
    }
  });
});

// ---------------------------------------------------------------------------
// S38 follow-up: the join-draft `units_manifest` binding the coordinator
// missed (S38 followed §5's "(ref/hash identity)" literally → 2 tool-source
// diagnosis children + 1 repair + 1 extra verify round) and the quote-
// containment rule (candidate reference_quote `**Seals from review**` vs the
// source's `## Seals from review` → 1 diagnostic + 1 repair). RED-first: the
// content assertions were red before the matching artifact-contracts.md and
// child-template edits; the mutation matrices encode today's real claims/join
// outcomes (probed live before authoring).
// ---------------------------------------------------------------------------

describe("docs contract — artifact contracts S2 follow-up (join-draft units_manifest binding + quote containment)", () => {
  it("documents the join-draft units_manifest four-field binding and its distinction from the other manifest records", () => {
    for (const phrase of [
      "Join-draft `units_manifest` binding",
      "distinct from the envelope `units_manifest` pin",
      "must equal the discovered units manifest ref",
      "sha256 of the exact units manifest bytes",
      "exactly `code-units-sim/3`",
      "whole-manifest",
      "required checks, not an exclusive allowed-key set",
      "does not require `unit_count`",
      "see §5 for the join draft's own four-field binding",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `join binding contract phrase ${phrase}`);
    }
  });

  it("documents quote containment and drives the real claims validator on every quote family", () => {
    for (const phrase of [
      "Quote containment (verbatim rule)",
      "exact UTF-8 byte substring of the captured source bytes",
      "never normalize",
      "zero-based byte offset of the quote's first occurrence",
      "in **any** captured source",
      "unidentified by definition",
    ]) {
      has(ARTIFACT_CONTRACTS, phrase, `quote containment contract phrase ${phrase}`);
    }

    const cases = [
      ["claim quote", (c) => { c.claims[0].quote = "definitely-not-in-any-source"; }, "claims.quote", 'quote not in source: "C01"'],
      ["nonclaim quote", (c) => { c.nonclaims[0].quote = "definitely-not-in-any-source"; }, "claims.quote", 'quote not in source: "N01"'],
      ["unknown claim source ref", (c) => { c.claims[0].source_ref = "pr:nope"; }, "claims.quote", 'unknown source ref: "pr:nope"'],
      ["markdown-normalized claim quote", (c) => { c.claims[0].quote = `**${c.claims[0].quote}**`; }, "claims.quote", 'quote not in source: "C01"'],
      ["conflict quote", (c) => { c.conflicts[0].quotes[0].quote = "definitely-not-in-any-source"; }, "claims.conflicts", 'quote not in source: "X01"'],
      ["note quote", (c) => { c.notes[0].source_ref = c.claims[0].source_ref; c.notes[0].quote = "definitely-not-in-any-source"; }, "claims.notes", "note quote not in source: /notes/0"],
      ["candidate quote", (c) => { c.missing_source_candidates[0].reference_quote = "**Seals from review**"; }, "claims.candidates", "candidate quote not in captured sources: 0"],
    ];
    for (const [label, mutate, check, detail] of cases) {
      const run = materializeRun(`s38-quote-${label.replace(/\W+/g, "-")}`);
      editJson(run, CLAIMS_DRAFT, mutate);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["claims", "--run", run], { runRoot: run }), 1, check, detail, label);
    }
  });

  it("drives the real join validator across the documented units_manifest binding", () => {
    const baseline = materializeRun("s38-jb-baseline");
    expectVerdict(runVerifier(["join", "--run", baseline], { runRoot: baseline }), 0, "baseline join");

    const um = (mutate) => (run) => editJson(run, JOIN_DRAFT, (j) => mutate(j.units_manifest));
    const cases = [
      ["unit_count removed", um((m) => { delete m.unit_count; })],
      ["unit_count wrong", um((m) => { m.unit_count = 45; })],
      ["schema_version removed", um((m) => { delete m.schema_version; })],
      ["schema_version wrong", um((m) => { m.schema_version = "code-units-sim/9"; })],
      ["ref wrong", um((m) => { m.ref = "units/units2/other.json"; })],
      ["sha256 wrong", um((m) => { m.sha256 = "0".repeat(64); })],
      ["units_manifest removed", (run) => editJson(run, JOIN_DRAFT, (j) => { delete j.units_manifest; }), "shape", "invalid field: /units_manifest expected object"],
      ["units_manifest not an object", (run) => editJson(run, JOIN_DRAFT, (j) => { j.units_manifest = []; }), "shape", "invalid field: /units_manifest expected object"],
    ];
    for (const [label, mutate, check = "join.identity", detail = "join manifest binding mismatch"] of cases) {
      const run = materializeRun(`s38-jb-${label.replace(/\W+/g, "-")}`);
      mutate(run);
      resealEnvelope(run);
      expectFailedCheck(runVerifier(["join", "--run", run], { runRoot: run }), 1, check, detail, label);
    }
  });

  it("drives the conflict offset_bytes first-occurrence rule and its shape bound", () => {
    const run = materializeRun("s38-offset");
    const claims = readJson(run, CLAIMS_DRAFT);
    const capture = readJson(run, CAPTURE_MANIFEST);
    const cap = capture.sources.find((s) => s.locator === claims.conflicts[0].quotes[0].source_ref);
    assert.ok(cap, "seed conflict source must be captured");
    const sourceBytes = readBytes(run, `claims/${cap.path}`);
    const first = sourceBytes.indexOf("the");
    const second = sourceBytes.indexOf("the", first + 1);
    assert.ok(first >= 0 && second > first, "seed source must contain a repeated probe quote");

    const quote = (mutate) => (r) => editJson(r, CLAIMS_DRAFT, (c) => mutate(c.conflicts[0].quotes[0]));
    for (const [label, mutate] of [
      ["null offset", quote((q) => { q.offset_bytes = null; })],
      ["first-occurrence offset", quote((q) => { q.quote = "the"; q.offset_bytes = first; })],
    ]) {
      const r = materializeRun(`s38-off-ok-${label.replace(/\W+/g, "-")}`);
      mutate(r);
      resealEnvelope(r);
      expectVerdict(runVerifier(["claims", "--run", r], { runRoot: r }), 0, label);
    }

    for (const [label, mutate, check, detail] of [
      ["later-occurrence offset", quote((q) => { q.quote = "the"; q.offset_bytes = second; }), "claims.conflicts", 'quote offset mismatch: "X01"'],
      ["malformed offset type", quote((q) => { q.offset_bytes = "5"; }), "shape", "invalid field: /conflicts/0/quotes/0/offset_bytes expected null or nonnegative integer"],
    ]) {
      const r = materializeRun(`s38-off-${label.replace(/\W+/g, "-")}`);
      mutate(r);
      resealEnvelope(r);
      expectFailedCheck(runVerifier(["claims", "--run", r], { runRoot: r }), 1, check, detail, label);
    }
  });

  it("carries the drafting-time quote rule in the P0.2 child template", () => {
    for (const phrase of [
      "exact UTF-8 byte substring of the captured source bytes",
      "never normalized",
      "zero-based byte offset of its first occurrence",
      "artifact-contracts.md §2",
    ]) {
      has(CHILD_TEMPLATE, phrase, `P0.2 inline quote rule phrase ${phrase}`);
    }
  });

  it("extends the repair map with the join binding and quote-containment refusals", () => {
    const body = read(ARTIFACT_CONTRACTS);
    const map = norm(body.slice(body.indexOf("## 7. Error → field → doc anchor")));
    for (const token of [
      "join manifest binding mismatch",
      "invalid field: /units_manifest expected object",
      "quote not in source",
      "quote offset mismatch",
      "note quote not in source",
      "candidate quote not in captured sources",
    ]) {
      assert.ok(map.includes(norm(token)), `§7 repair map missing token ${token}`);
    }
  });
});

describe("docs contract — context budget S1/S3 (hash-only executables + no coordinator source ingestion)", () => {
  it("BOOTSTRAP fetches executables hash-only and forbids windowed source printing", () => {
    has(BOOTSTRAP, "hash-only", "hash-only fetching");
    has(BOOTSTRAP, "as exact bytes to disk", "bytes-to-disk rule");
    has(BOOTSTRAP, "no windowed printing of executable source", "no windowed printing");
    has(BOOTSTRAP, "expected no-command exit 2 is a version smoke/usage refusal, never a verification pass", "exit-2 smoke semantics");
    has(BOOTSTRAP, "{path, sha256, tool_version}", "verifier metadata shape");
    has(BOOTSTRAP, "{path, sha256, recipe}", "chunker metadata shape");
  });

  it("requirements-check binds hash-only engine identity in rows 7/10 and the declared requirements", () => {
    has(REQUIREMENTS, "hash only", "hash-only declared requirement");
    has(REQUIREMENTS, "never reads or prints executable source into context", "no source ingestion in requirements");
    const text = read(REQUIREMENTS);
    assert.match(row(text, "| 10 |"), /hash their bytes/, "row 10 hash instruction");
    assert.match(row(text, "| 7 |"), /mechanical/i, "row 7 mechanical child");
  });

  it("KICKOFF §8 states the hash-only executable rule", () => {
    has(KICKOFF, "hash-only", "kickoff hash-only");
    has(KICKOFF, "never printed or read into context", "kickoff no-source rule");
  });

  it("kernel/SKILL forbids coordinator ingestion of engine executable source", () => {
    has(SKILL, "never read, search, grep or window their source", "coordinator read prohibition");
    has(SKILL, "Executing the pinned CLI is not source ingestion", "CLI execution exemption");
    has(SKILL, "when the review subject is cure-light itself", "self-review subject-code exemption");
    has(SKILL, "assigned reviewer children inspect subject code as evidence", "subject-code evidence rule");
    has(SKILL, "never substitute a `fast` child", "no coordinator fallback");
  });

  it("pi driver repeats the executable and repair boundaries", () => {
    has(PI_SKILL, "never ingests executable source", "pi no-source rule");
    has(PI_SKILL, "hash-only", "pi hash-only rule");
  });
});

describe("docs contract — context budget S4 (minimal boot + stage map + read-once)", () => {
  it("ships the stage map with the boot set and every stage", () => {
    for (const stage of ["Boot set", "Stage map", "Read-once rule", "Frame/intake compile", "Phase 0", "V1", "V2", "V3", "Optional yagni", "Closure"]) {
      has(CONTEXT_LOADING, stage, `stage map ${stage}`);
    }
    has(CONTEXT_LOADING, "fetching a document to disk is not loading it into model context", "disk-vs-context rule");
    has(CONTEXT_LOADING, "in full before any preflight", "mandatory pi preflight docs");
    has(CONTEXT_LOADING, "no full pipeline/vector/intake/child/lens/example corpus at boot", "no corpus at boot");
    has(CONTEXT_LOADING, "load `kernel/references/conformance-pass.md` before the capacity-bound V1 split compile at the Phase-0 gate", "early conformance read");
  });

  it("resolves every document the stage map references", () => {
    const text = read(CONTEXT_LOADING);
    const paths = new Set();
    for (const m of text.matchAll(/`([a-zA-Z0-9_./-]+\.(?:md|json))`/g)) {
      if (/^(kernel|libs|assets|templates|docs)\//.test(m[1])) paths.add(m[1]);
    }
    assert.ok(paths.size >= 15, `expected the stage corpus, found ${paths.size} referenced documents`);
    for (const rel of paths) assert.ok(existsSync(path.join(ROOT, rel)), `stage map references missing document ${rel}`);
    for (const required of [
      "kernel/references/pipeline-model.md", "kernel/references/intake-and-scope.md",
      "kernel/references/conformance-pass.md", "kernel/references/implementation-pass.md",
      "kernel/references/debt-pass.md", "kernel/references/closure-verification.md",
      "kernel/references/evidence-format.md", "kernel/references/hygiene-lens.md",
      "kernel/references/blast-lens.md", "kernel/references/quality-lens.md",
      "kernel/references/chhound-driver.md", "kernel/references/chunker.md",
      "kernel/references/artifact-contracts.md", "kernel/references/yagni-pass.md",
      "assets/child-pass-prompt-template.md", "assets/finding-schema.json",
      "templates/KICKOFF.md", "libs/pi-driver/references/notebook-plan-contract.md",
      "libs/pi-driver/references/requirements-check.md", "libs/pi-driver/SKILL.md",
      "docs/example-review.md",
    ]) {
      assert.ok(paths.has(required), `stage map must cover ${required}`);
    }
  });

  it("states the read-once identity and rehydration rules", () => {
    has(CONTEXT_LOADING, "(engine OID, relative path, section range/hash, context generation)", "identity key");
    has(CONTEXT_LOADING, "Compaction or handoff loses residency", "residency loss");
    has(CONTEXT_LOADING, "reloads ONLY its active required stage documents from the pinned mirror", "rehydration rule");
    has(CONTEXT_LOADING, "An engine OID change invalidates the load cache", "OID invalidation");
    has(CONTEXT_LOADING, "never pretends page refs or a summary equal the normative text", "no summary substitution");
  });

  it("removes the full-corpus boot loop from BOOTSTRAP, kernel SKILL and pi driver", () => {
    lacks(SKILL, /Read these references completely before establishing a process/, "old SKILL boot directive");
    lacks(PI_SKILL, /read this skill and its two references/, "old pi SKILL boot directive");
    for (const file of [BOOTSTRAP, SKILL, PI_SKILL]) {
      lacks(file, /read (all|every) (the )?(listed )?(files|references|documents|docs) (completely|fully|in full)/i, `full-corpus read in ${file}`);
    }
    has(BOOTSTRAP, "Fetching to disk is not loading into context", "BOOTSTRAP disk-vs-context");
    has(BOOTSTRAP, "context-loading.md", "BOOTSTRAP stage-map link");
    has(SKILL, "context-loading.md", "SKILL stage-map link");
    has(PI_SKILL, "context-loading.md", "pi SKILL stage-map link");
    has(KICKOFF, "context-loading.md", "KICKOFF stage-map link");
  });
});

describe("docs contract — context budget S5 (bounded child returns)", () => {
  it("child template declares the 4096-byte receipt, typed bindings and overflow handling", () => {
    const body = read(CHILD_TEMPLATE);
    const size = Number(/capped at \*\*(\d+) UTF-8 bytes\*\*/.exec(body)?.[1]);
    assert.equal(size, 4096, "documented byte cap");
    const ids = Number(/capped at (\d+) entries inline/.exec(body)?.[1]);
    assert.equal(ids, 32, "documented inline ID limit");
    has(CHILD_TEMPLATE, "{status, counts, finding_ids, artifact_ref, sha256}", "receipt shape");
    has(CHILD_TEMPLATE, "run, review_state, subject_oid, assignment_digest", "typed bindings");
    has(CHILD_TEMPLATE, "complete | inconclusive | blocked", "status enum");
    has(CHILD_TEMPLATE, "`complete` means report delivery, not semantic or gate pass", "status semantics");
    has(CHILD_TEMPLATE, "never silently omitted as \"none\"", "no silent omission");
    has(CHILD_TEMPLATE, "the wrapper is transport, not a replacement finding schema", "transport-not-schema");
    has(CHILD_TEMPLATE, "P0 children keep their exact existing output paths and formats", "P0 transport unchanged");
    has(CHILD_TEMPLATE, "does not apply to the mechanical verification child", "verifier exemption");
    has(CHILD_TEMPLATE, "no silent truncation", "fail-closed truncation");
    has(CHILD_TEMPLATE, "never trusting counts or cherry-picking findings", "complete consumption");
    has(CHILD_TEMPLATE, "Shared-disk availability is a prerequisite", "shared-disk prerequisite");
  });

  it("every pass reference points at the bounded transport without rewriting its vectors", () => {
    for (const [file, label] of [[CONFORMANCE, "conformance"], [IMPLEMENTATION, "implementation"], [DEBT, "debt"], [YAGNI, "yagni"]]) {
      has(file, "bounded return transport", `${label} bounded transport pointer`);
      has(file, "assets/child-pass-prompt-template.md", `${label} template pointer`);
    }
    has(NOTEBOOK_CONTRACT, "all required claim/unit/closure/trace records in bounded artifact slices", "coordinator full consumption");
    has(EVIDENCE, "artifact_ref, sha256", "evidence receipt addressing");
    has(KICKOFF, "4096 UTF-8 bytes", "KICKOFF transport cap");
  });
});

describe("docs contract — context budget S6 (notebook dedup)", () => {
  it("writes the contract once per state and references it afterwards", () => {
    has(NOTEBOOK_CONTRACT, "written once per review state, then referenced", "once-per-state rule");
    has(NOTEBOOK_CONTRACT, "no prose restatement", "no restatement");
    has(NOTEBOOK_CONTRACT, "never replaced with a hash-only reference", "literal contract stays");
    has(NOTEBOOK_CONTRACT, "A distinct new state still writes its own distinct verbatim contract", "new state contract");
    has(NOTEBOOK_CONTRACT, "never a full claims/join/symbol-map dump", "bounded derived reads");
    has(PI_SKILL, "Do not restate the contract page's prose in every spawn or notebook update", "pi dedup guidance");
    has(KICKOFF, "written once", "KICKOFF dedup");
  });
});

describe("docs contract — context budget S7 (gate receipts, opt-in)", () => {
  it("documents frame_sha, decision_ref and fail-closed receipt semantics", () => {
    has(NOTEBOOK_CONTRACT, "{decision, frame_sha, decision_ref}", "answer shape");
    has(NOTEBOOK_CONTRACT, "approved-plan SHA", "frame_sha meaning");
    has(NOTEBOOK_CONTRACT, "never the engine commit or a mirror `frame.json` SHA", "frame_sha exclusions");
    has(NOTEBOOK_CONTRACT, "trusted host-side immutable decision record", "decision_ref resolution");
    has(NOTEBOOK_CONTRACT, "no normalized or reserialized hash ambiguity", "exact-bytes hash");
    has(NOTEBOOK_CONTRACT, "HOLD/error, never the generic auto-approval fallback", "fail-closed receipts");
    has(NOTEBOOK_CONTRACT, "The container cannot approve itself", "container isolation");
    has(NOTEBOOK_CONTRACT, "never squeezed into a misleading accept token", "substantive change");
    has(NOTEBOOK_CONTRACT, "Unknown closure gates need an explicit decision", "no default accept");
    has(NOTEBOOK_CONTRACT, "never required for interactive engine users", "opt-in boundary");
    has(KICKOFF, "{decision, frame_sha, decision_ref}", "KICKOFF answer shape");
    has(KICKOFF, "never the generic auto-approval fallback", "KICKOFF fail-closed");
    has(KICKOFF, "explicit frame confirmation", "first-frame confirmation preserved");
  });
});
