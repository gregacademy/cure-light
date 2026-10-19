// workflows/pack/cases.mjs — the sealed p0-pack case table: inputs, expected reason, invariants.
//
// One case = one input recipe + one oracle. The same case objects are driven through the stub
// host (test/contract.test.mjs) and the real pi CLI (test/host.test.mjs), so a green fast tier
// and a green host tier mean the draft is a pure function of its explicit parameters on both.
// Case shape and authoring rules: ../AUTHORING.md.
//
// The synthetic stream sizes are chosen so the greedy split is deterministic under the
// default ceiling: 6 × 40000-byte units, ceiling 130000 → 3 + 3 units (a fourth unit needs
// ~163 KiB); ceiling 300000 → one box.
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  artifactSha,
  readBytes,
  readJson,
  readText,
  sha256,
  snapshotTree,
} from "../../kernel/tools/verify-testkit.mjs";
import { BASELINE_STORE_DEFAULT, baselineStream, packStream } from "./fixtures/streams.mjs";
import { DRAFT, packArgs, shellQuote } from "./testkit.mjs";

/** Host runs are bounded: the workflow has checkpoints, so the soft time target applies. */
const HOST_FLAGS = Object.freeze(["--workflow-time", "300000"]);

const TWO_BOX = Object.freeze({ unitCount: 6, unitBytes: 40000, ceiling: 130000 });
const SINGLE_BOX = Object.freeze({ unitCount: 6, unitBytes: 40000, ceiling: 300000 });
const SMALL_CEILING = 5000;
/** Longer than Number can represent exactly: parses to Infinity, must be refused. */
const HUGE_CEILING = "9".repeat(400);

/** Copy a materialized synthetic pre-pack stream into the case dir. */
function packed(label, options = {}) {
  return (caseDir) => {
    const origin = packStream(label, options);
    const runRoot = path.join(caseDir, "run");
    cpSync(origin, runRoot, { recursive: true });
    return { runRoot };
  };
}

/** Copy the stream to an explicit path inside the case dir (used to exercise spaces). */
function packedAt(destName, options = {}) {
  return (caseDir) => {
    const origin = packStream(`at-${destName}`, options);
    const runRoot = path.join(caseDir, destName);
    rmSync(runRoot, { recursive: true, force: true });
    cpSync(origin, runRoot, { recursive: true });
    return { runRoot };
  };
}

/**
 * Copy the recorded baseline store and keep its corrected-render pins. The recorded `join/`
 * is deleted: replay generates all 13 outputs from the recorded inputs, and the strict
 * overwrite guard refuses while child/p05 artifacts exist.
 */
function baseline(caseDir) {
  const seeded = baselineStream({ destParent: caseDir });
  rmSync(path.join(seeded.runRoot, "join"), { recursive: true, force: true });
  return { runRoot: seeded.runRoot, pins: seeded.pins };
}

const boxIds = (runRoot) =>
  readdirSync(path.join(runRoot, "join"))
    .filter((name) => /^box-\d{4}\.assignment\.json$/.test(name))
    .map((name) => name.slice(0, -".assignment.json".length))
    .sort();

/**
 * The shared accept oracle: claims-list projection, assignment contract, greedy boundary and
 * the corrected instruction render. It asserts structure against the recorded inputs; the
 * acceptance tier owns exact bytes.
 */
function assertPacked(runRoot, { ceiling, boxes, childStore = runRoot }) {
  const manifestBytes = readBytes(runRoot, "units/units2/manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const draft = readJson(runRoot, "claims/claims-draft.v3.json");
  const claimsListBytes = readBytes(runRoot, "join/claims-list.json");
  const claimsList = JSON.parse(claimsListBytes.toString("utf8"));
  const unitById = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));

  assert.deepEqual(
    claimsList,
    draft.claims.map((claim) => ({ id: claim.id, statement: claim.statement })),
    "claims-list is not the draft projection",
  );
  assert.equal(claimsListBytes.at(-1), 0x0a, "claims-list must end with one newline");
  assert.notEqual(claimsList.length, 0);

  const ids = boxIds(runRoot);
  assert.deepEqual(ids, boxes.map((_, index) => `box-${String(index).padStart(4, "0")}`), "box id set differs");
  const packable = manifest.units.filter((unit) => unit.boundary_kind !== "opaque");
  let cursor = 0;
  for (let index = 0; index < ids.length; index++) {
    const boxId = ids[index];
    const assignment = readJson(runRoot, `join/${boxId}.assignment.json`);
    assert.deepEqual(Object.keys(assignment), [
      "box_id",
      "output_path",
      "units",
      "unit_count",
      "units_dir",
      "total_unit_bytes",
      "claims_list_path",
      "claims_list_bytes",
      "input_ceiling_bytes",
      "manifest_ref",
      "manifest_sha256",
    ]);
    assert.equal(assignment.box_id, boxId);
    assert.equal(assignment.output_path, `join/${boxId}.jsonl`);
    assert.equal(assignment.unit_count, boxes[index]);
    assert.deepEqual(assignment.units, packable.slice(cursor, cursor + boxes[index]).map((unit) => unit.unit_id));
    assert.equal(assignment.units_dir, "units/units2");
    assert.equal(assignment.manifest_ref, "units/units2/manifest.json");
    assert.equal(assignment.manifest_sha256, sha256(manifestBytes));
    assert.equal(assignment.claims_list_path, "join/claims-list.json");
    assert.equal(assignment.claims_list_bytes, claimsListBytes.length);
    assert.equal(assignment.input_ceiling_bytes, ceiling);
    const total = assignment.units.reduce((sum, id) => sum + unitById.get(id).byte_len, 0);
    assert.equal(assignment.total_unit_bytes, total);

    const instr = readText(runRoot, `join/${boxId}.instructions.md`);
    const lines = instr.split("\n");
    assert.ok(lines[0].includes("P0.4 join proposer"), "identity line missing");
    assert.ok(lines[0].includes("`fixture/p0-pack` PR #7"), "identity line differs: " + lines[0]);
    const body = instr.split("\n\n");
    const unitLines = body[2].split("\n").filter((line) => line.startsWith("- "));
    assert.equal(unitLines.length, assignment.units.length, "instruction unit lines differ");
    for (const id of assignment.units) {
      const unit = unitById.get(id);
      const want = `- ${id} — ${childStore}/units/units2/${path.posix.basename(unit.file)}`;
      assert.ok(instr.includes(want), `corrected payload line missing for ${id}: wanted ${want}`);
    }
    assert.equal(instr.includes(`${childStore}/units2/`), false, "defect payload path present");
    assert.equal(instr.includes(`Your only write path is: ${childStore}/join/${boxId}.jsonl`), true);
    assert.equal(instr.at(-1), "\n", "instructions must end with one newline");

    const boxInput = Buffer.byteLength(instr, "utf8") + claimsListBytes.length + total;
    assert.ok(boxInput <= ceiling, `box ${boxId} input ${boxInput} over ceiling ${ceiling}`);
    const next = ids[index + 1];
    if (next) {
      const nextFirst = readJson(runRoot, `join/${next}.assignment.json`).units[0];
      const nextSize = unitById.get(nextFirst)?.byte_len ?? 0;
      assert.ok(boxInput + nextSize > ceiling, `box ${boxId} is not greedy: could hold ${nextFirst}`);
    }
    cursor += boxes[index];
  }
  assert.equal(cursor, packable.length, "boxes do not cover the packable units");
  return [
    `boxes ${boxes.join("+")}`,
    `claims ${claimsList.length}`,
    `claims-list ${artifactSha(runRoot, "join/claims-list.json").slice(0, 12)}`,
  ];
}

/** Shared accept assertions on the exit payload against the produced artifacts. */
function assertExit(result, runRoot, { ceiling, boxes }) {
  assert.equal(result.exit.claims_list_sha256, artifactSha(runRoot, "join/claims-list.json"));
  assert.equal(result.exit.manifest_sha256, artifactSha(runRoot, "units/units2/manifest.json"));
  assert.equal(result.exit.ceiling, ceiling);
  assert.equal(result.exit.boxes.length, boxes.length);
  for (let index = 0; index < boxes.length; index++) {
    const boxId = `box-${String(index).padStart(4, "0")}`;
    const entry = result.exit.boxes[index];
    assert.equal(entry.box_id, boxId);
    assert.equal(entry.unit_count, boxes[index]);
    assert.equal(entry.assignment_sha256, artifactSha(runRoot, `join/${boxId}.assignment.json`));
    assert.equal(entry.instructions_sha256, artifactSha(runRoot, `join/${boxId}.instructions.md`));
  }
}

function assertUntouched(runRoot, before) {
  assert.deepEqual(snapshotTree(runRoot), before);
  return [`store untouched (${before.length} files)`];
}

// ------------------------------------------------------------- p0-pack group ----

export const PACK_CASES = [
  {
    id: "pack-two-boxes",
    group: "p0-pack",
    title: "packs a sized inventory greedily into two boxes and renders corrected paths",
    workflow: DRAFT,
    prepare: packed("two-box", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      const notes = assertPacked(runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 3] });
      assertExit(result, runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 3] });
      assert.deepEqual([...result.exit.promoted].sort(), [
        "join/box-0000.assignment.json",
        "join/box-0000.instructions.md",
        "join/box-0001.assignment.json",
        "join/box-0001.instructions.md",
        "join/claims-list.json",
      ].sort());
      assert.deepEqual(result.exit.skipped, []);
      return notes;
    },
    checkId: "packed-two-boxes",
  },

  {
    id: "pack-single-box",
    group: "p0-pack",
    title: "packs the whole inventory into one box under a large ceiling",
    workflow: DRAFT,
    prepare: packed("single-box", SINGLE_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: SINGLE_BOX.ceiling }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      const notes = assertPacked(runRoot, { ceiling: SINGLE_BOX.ceiling, boxes: [6] });
      assertExit(result, runRoot, { ceiling: SINGLE_BOX.ceiling, boxes: [6] });
      return notes;
    },
    checkId: "packed-single-box",
  },

  {
    id: "opaque-unit-excluded",
    group: "p0-pack",
    title: "excludes an opaque unit from boxes and reports it in the exit payload",
    workflow: DRAFT,
    prepare: packed("opaque", { ...TWO_BOX, fault: "opaque-unit" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      const notes = assertPacked(runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 2] });
      assert.equal(result.exit.opaque_units, 1);
      const manifest = readJson(runRoot, "units/units2/manifest.json");
      const assigned = boxIds(runRoot).flatMap((boxId) => readJson(runRoot, `join/${boxId}.assignment.json`).units);
      assert.equal(assigned.includes("u0000"), false, "opaque unit assigned to a box");
      assert.equal(assigned.length + result.exit.opaque_units, manifest.units.length);
      return notes;
    },
    checkId: "opaque-excluded",
  },

  ...["preexisting-claims-list", "preexisting-assignment", "preexisting-instructions", "stale-box"].map((fault) => ({
    id: `fault-${fault}`,
    group: "p0-pack",
    title: `refuses ${fault} with frozen-artifact and leaves the store untouched`,
    workflow: DRAFT,
    prepare: packed(`fault-${fault}`, { ...TWO_BOX, fault }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "frozen-artifact" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot, before }) {
      assert.deepEqual(snapshotTree(runRoot), before);
      return [`store untouched (${before.length} files)`];
    },
    checkId: "store-untouched",
  })),

  ...["missing-claims", "missing-manifest", "missing-payload", "missing-capture", "bad-identity", "byte-len-mismatch", "empty-claims"].map((fault) => ({
    id: `fault-${fault}`,
    group: "p0-pack",
    title: `refuses ${fault} with needs-input and leaves the store untouched`,
    workflow: DRAFT,
    prepare: packed(`fault-${fault}`, { ...TWO_BOX, fault }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot, before }) {
      assert.deepEqual(snapshotTree(runRoot), before);
      return [`store untouched (${before.length} files)`];
    },
    checkId: "store-untouched",
  })),

  {
    id: "ceiling-below-unit",
    group: "p0-pack",
    title: "refuses a ceiling that cannot hold fixed input plus one whole unit",
    workflow: DRAFT,
    prepare: packed("small-ceiling", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: SMALL_CEILING }),
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
    id: "overwrite-allowed",
    group: "p0-pack",
    title: "rewrites a differing target only with --allow-overwrite",
    workflow: DRAFT,
    prepare: packed("overwrite", { ...TWO_BOX, fault: "preexisting-claims-list" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, allowOverwrite: true }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      const notes = assertPacked(runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 3] });
      assert.ok(result.exit.promoted.includes("join/claims-list.json"), "claims-list not promoted");
      return notes;
    },
    checkId: "overwrite",
  },

  {
    id: "missing-flags",
    group: "p0-pack",
    title: "refuses missing required flags with needs-input",
    workflow: DRAFT,
    prepare: () => ({ runRoot: null }),
    args: () => "--store /nonexistent-only-store",
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: false,
  },

  {
    id: "bad-ceiling-flag",
    group: "p0-pack",
    title: "refuses a non-integer ceiling flag with needs-input",
    workflow: DRAFT,
    prepare: packed("bad-ceiling", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: "abc" }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ runRoot, before }) {
      assert.deepEqual(snapshotTree(runRoot), before);
      return ["store untouched"];
    },
    checkId: "store-untouched",
  },

  // ------------------------------------------------ hardened argument contract ----

  {
    id: "ceiling-not-safe-integer",
    group: "p0-pack",
    title: "refuses a 400-digit ceiling instead of admitting an Infinity/null artifact",
    workflow: DRAFT,
    prepare: packed("huge-ceiling", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: HUGE_CEILING }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /nonnegative safe integer/);
      const text = JSON.stringify(result.exit);
      assert.equal(text.includes("Infinity"), false, "exit payload carries Infinity");
      assert.equal(text.includes("null"), false, "exit payload carries a null ceiling artifact");
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "empty-review-state-eq",
    group: "p0-pack",
    title: "refuses an explicit empty --review-state= value",
    workflow: DRAFT,
    prepare: packed("empty-review-state", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, {
      ceiling: TWO_BOX.ceiling,
      argsOverride: (base) => base.replace(/--review-state '[^']*'/, "--review-state="),
    }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /--review-state/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "duplicate-store-flag",
    group: "p0-pack",
    title: "refuses a duplicate --store flag",
    workflow: DRAFT,
    prepare: packed("duplicate-store", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, {
      ceiling: TWO_BOX.ceiling,
      argsOverride: (base) => `${base} --store ${shellQuote(runRoot)}`,
    }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /duplicate flag: --store/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "relative-child-store",
    group: "p0-pack",
    title: "refuses a relative --child-store (it is embedded in child instructions)",
    workflow: DRAFT,
    prepare: packed("relative-child-store", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, childStore: "relative/store" }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /absolute POSIX path/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "child-store-with-space",
    group: "p0-pack",
    title: "refuses a --child-store containing whitespace",
    workflow: DRAFT,
    prepare: packed("child-store-space", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, childStore: "/tmp/child store" }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /whitespace or control characters/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "store-path-with-space",
    group: "p0-pack",
    title: "accepts a quoted store path containing a space",
    workflow: DRAFT,
    prepare: packedAt("run store", TWO_BOX),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      assert.ok(runRoot.includes(" "), "case store path must contain a space");
      const notes = assertPacked(runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 3] });
      assertExit(result, runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 3] });
      return notes;
    },
    checkId: "packed-two-boxes",
  },

  // ----------------------------------------------------- hardened input checks ----

  {
    id: "duplicate-unit-id",
    group: "p0-pack",
    title: "refuses a duplicate unit_id in the manifest",
    workflow: DRAFT,
    prepare: packed("duplicate-unit-id", { ...TWO_BOX, fault: "duplicate-unit-id" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /duplicate unit_id: u0000/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "duplicate-payload-basename",
    group: "p0-pack",
    title: "refuses two units whose payload files share a basename",
    workflow: DRAFT,
    prepare: packed("duplicate-basename", { ...TWO_BOX, fault: "duplicate-payload-basename" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /duplicate unit basename: u0000\.txt/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  ...["empty-statement", "whitespace-statement"].map((fault) => ({
    id: `fault-${fault}`,
    group: "p0-pack",
    title: `refuses a claim with a ${fault.replace("-", " ")} value`,
    workflow: DRAFT,
    prepare: packed(`fault-${fault}`, { ...TWO_BOX, fault }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /no nonempty statement: C01/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  })),

  {
    id: "capture-review-state-newline",
    group: "p0-pack",
    title: "refuses a capture review_state containing a newline",
    workflow: DRAFT,
    prepare: packed("capture-review-newline", { ...TWO_BOX, fault: "capture-review-state-newline" }),
    // Keep the frame flags valid so the refusal comes from the capture manifest, not the args.
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, reviewState: "s1" }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /capture review_state contains control characters/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "capture-subject-oid",
    group: "p0-pack",
    title: "refuses a capture subject_oid that is not 40 lowercase hex",
    workflow: DRAFT,
    prepare: packed("capture-subject-oid", { ...TWO_BOX, fault: "capture-subject-oid" }),
    // Valid frame flag: the capture manifest itself must be the refused input.
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, subjectOid: "c".repeat(40) }),
    expect: { reason: "needs-input" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /capture subject_oid must be 40 lowercase hex/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  // ---------------------------------------------------- hardened freeze/IO paths ----

  {
    id: "fault-preexisting-p05-check",
    group: "p0-pack",
    title: "refuses an orphan p05-check box artifact with frozen-artifact",
    workflow: DRAFT,
    prepare: packed("fault-p05-check", { ...TWO_BOX, fault: "preexisting-p05-check" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "frozen-artifact" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /stale box artifacts.*box-0099/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "fault-child-jsonl-overwrite",
    group: "p0-pack",
    title: "refuses --allow-overwrite while a child jsonl output exists",
    workflow: DRAFT,
    prepare: packed("fault-child-jsonl", { ...TWO_BOX, fault: "preexisting-jsonl" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, allowOverwrite: true }),
    expect: { reason: "frozen-artifact" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /downstream artifacts exist.*box-0000\.jsonl/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "fault-join-draft-overwrite",
    group: "p0-pack",
    title: "refuses --allow-overwrite while a p0-close join draft exists",
    workflow: DRAFT,
    prepare: packed("fault-join-draft", { ...TWO_BOX, fault: "preexisting-join-draft" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, allowOverwrite: true }),
    expect: { reason: "frozen-artifact" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /downstream artifacts exist.*join-draft\.v1\.json/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "fault-envelope-overwrite",
    group: "p0-pack",
    title: "refuses --allow-overwrite while a run envelope exists",
    workflow: DRAFT,
    prepare: packed("fault-envelope", { ...TWO_BOX, fault: "preexisting-envelope" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling, allowOverwrite: true }),
    expect: { reason: "frozen-artifact" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /downstream artifacts exist.*run-manifest\.json/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "fault-store-lock",
    group: "p0-pack",
    title: "refuses a pre-existing store lock with frozen-artifact",
    workflow: DRAFT,
    prepare: packed("fault-store-lock", { ...TWO_BOX, fault: "store-lock" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "frozen-artifact" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /store lock exists/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  {
    id: "fault-join-regular-file",
    group: "p0-pack",
    title: "refuses a join path that is a regular file with evidence-failed",
    workflow: DRAFT,
    prepare: packed("fault-join-file", { ...TWO_BOX, fault: "join-regular-file" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "evidence-failed" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot, before }) {
      assert.match(String(result.exit?.detail), /join is not a directory/);
      return assertUntouched(runRoot, before);
    },
    checkId: "store-untouched",
  },

  // ------------------------------------------------------------- non-ASCII text ----

  {
    id: "claims-non-ascii",
    group: "p0-pack",
    title: "writes Python ensure_ascii=True escapes for BMP and astral claim text",
    workflow: DRAFT,
    prepare: packed("non-ascii", { ...TWO_BOX, fault: "non-ascii-claims" }),
    args: (runRoot) => packArgs(runRoot, { ceiling: TWO_BOX.ceiling }),
    expect: { reason: "ok" },
    hostFlags: HOST_FLAGS,
    purity: { ignore: ["paths"] },
    check({ result, runRoot }) {
      const expected =
        "[\n"
        + "  {\n"
        + '    "id": "C01",\n'
        + '    "statement": "caf\\u00e9"\n'
        + "  },\n"
        + "  {\n"
        + '    "id": "C02",\n'
        + '    "statement": "clef \\ud834\\udd1e"\n'
        + "  }\n"
        + "]\n";
      const bytes = readBytes(runRoot, "join/claims-list.json");
      assert.equal(bytes.toString("utf8"), expected, "claims-list bytes are not ensure_ascii output");
      assert.equal(bytes.includes(Buffer.from("\u00e9", "utf8")), false, "raw BMP char leaked into claims-list");
      assert.equal(bytes.includes(Buffer.from("\u{1d11e}", "utf8")), false, "raw astral char leaked into claims-list");
      assert.equal(result.exit.claims_list_sha256, sha256(bytes));
      const notes = assertPacked(runRoot, { ceiling: TWO_BOX.ceiling, boxes: [3, 3] });
      return [`exact ensure_ascii bytes (${bytes.length})`, ...notes];
    },
    checkId: "ensure-ascii-bytes",
  },
];

/** Host-tier replay of the recorded s1 store: corrected-render byte equality (13 outputs). */
export const PACK_BASELINE_CASE = {
  id: "baseline-replay",
  group: "p0-pack",
  title: "reproduces the recorded s1 inputs as the corrected render (13 outputs)",
  workflow: DRAFT,
  prepare: baseline,
  args: (runRoot, seeded) => packArgs(runRoot, { ceiling: seeded.pins.ceiling, childStore: seeded.pins.store }),
  expect: { reason: "ok" },
  hostFlags: HOST_FLAGS,
  // The baseline store is a required input: absent => failure, with an explicit opt-out
  // for environments that cannot host the recorded store.
  skip: () => (
    !existsSync(BASELINE_STORE_DEFAULT) && process.env.P0_PACK_ACCEPTANCE_OPTIONAL === "1"
      ? `baseline store not found: ${BASELINE_STORE_DEFAULT} (P0_PACK_ACCEPTANCE_OPTIONAL=1)`
      : null
  ),
  purity: { ignore: ["paths"] },
  check({ result, runRoot, pins }) {
    assert.equal(artifactSha(runRoot, "units/units2/manifest.json"), pins.inputs.manifest, "input manifest is not the pinned store");
    assert.equal(artifactSha(runRoot, "claims/claims-draft.v3.json"), pins.inputs.claimsDraft, "input claims draft is not the pinned store");
    assert.equal(artifactSha(runRoot, "join/claims-list.json"), pins.claimsList, "claims-list differs");
    for (const [boxId, expected] of Object.entries(pins.assignments)) {
      assert.equal(artifactSha(runRoot, `join/${boxId}.assignment.json`), expected, `assignment differs: ${boxId}`);
    }
    for (const [boxId, expected] of Object.entries(pins.instructions)) {
      assert.ok(!String(expected).startsWith("PENDING"), `instruction pins not captured yet (${boxId})`);
      assert.equal(artifactSha(runRoot, `join/${boxId}.instructions.md`), expected, `instructions differ: ${boxId}`);
    }
    return [`13 outputs byte-equal (${Object.keys(pins.assignments).length} boxes)`];
  },
  checkId: "byte-equality",
};
