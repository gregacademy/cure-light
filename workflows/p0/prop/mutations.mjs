// workflows/p0/prop/mutations.mjs — the store mutation vocabulary for the property engine.
//
// A mutation is a named, deterministic edit of a pre-close store. The engine generates
// mutation programs (0..n mutations), applies them in order, and drives the workflow over
// the result. Each entry declares:
//   summary   one-line description (reports, docs)
//   params    generation/shrinking metadata for the mutation's parameters
//   expected  the sealed exit reason the mutation must produce, or null when the sealed
//             spec does not decide it yet (`note` then records the assumption)
//   apply     (runRoot, params) -> void; throws MutationNotApplicable when the pre-close
//             store has no suitable target (the runner counts that as a discard)
//
// Domain rules mirrored from workflows/p0/SPEC.md (do not widen without a spec change):
//   pre-write validation mismatch -> needs-input
//   merge validation error        -> validation-failed
//   existing differing target     -> frozen-artifact
//   envelope not ok               -> evidence-failed
//   zero-link / unresolved rows are LEGAL row states, not errors
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { artifactSha, readBoxRows, readBytes, readJson, unitPayloadAbs, writeBoxRows, writeBytes, writeJson, SEED_DIR } from "../../../kernel/tools/verify-testkit.mjs";

export class MutationNotApplicable extends Error {
  constructor(message) {
    super(message);
    this.name = "MutationNotApplicable";
    this.code = "E_MUTATION_NOT_APPLICABLE";
  }
}

const MANIFEST = "units/units2/manifest.json";
const CAPTURE = "claims/sources/capture-manifest.json";
const JOIN_DRAFT = "join/join-draft.v1.json";
const RUN_MANIFEST = "run-manifest.json";
const BOX = (id) => `join/${id}.jsonl`;
const ASSIGNMENT = (id) => `join/${id}.assignment.json`;

/** Every box whose rows exist, in box order. */
export function listBoxes(runRoot) {
  return readdirSync(`${runRoot}/join`)
    .filter((name) => /^box-.*\.jsonl$/.test(name))
    .map((name) => name.replace(/\.jsonl$/, ""))
    .sort();
}

function rowsOf(runRoot, boxId) {
  return readBoxRows(runRoot, BOX(boxId));
}

function firstLinkRow(runRoot, boxId) {
  const rows = rowsOf(runRoot, boxId);
  const row = rows.find((candidate) => candidate.links.length > 0);
  if (!row) throw new MutationNotApplicable(`no row with links in ${boxId}`);
  return { rows, row };
}

function dropUnits(runRoot, { count }) {
  const manifest = readJson(runRoot, MANIFEST);
  const ids = manifest.units.map((unit) => unit.unit_id);
  const dropped = new Set(ids.slice(Math.max(1, ids.length - count)));
  if (dropped.size === 0) throw new MutationNotApplicable("nothing left to drop");
  const droppedUnits = manifest.units.filter((unit) => dropped.has(unit.unit_id));
  const payloadPaths = droppedUnits.map((unit) => unitPayloadAbs(runRoot, unit.unit_id));
  manifest.units = manifest.units.filter((unit) => !dropped.has(unit.unit_id));
  recomputeUnitCounts(manifest);
  writeJson(runRoot, MANIFEST, manifest);
  // A legal inventory never leaves a payload file unassigned (units.payload), and the
  // changed-file sweep must still match the capture inventory (units.counts).
  for (const abs of payloadPaths) rmSync(abs, { force: true });
  const survivingPaths = new Set(manifest.units.map((unit) => unit.path));
  const capture = readJson(runRoot, CAPTURE);
  if (capture.changed_files.some((path) => !survivingPaths.has(path))) {
    capture.changed_files = capture.changed_files.filter((path) => survivingPaths.has(path));
    capture.changed_files_count = capture.changed_files.length;
    writeJson(runRoot, CAPTURE, capture);
  }
  for (const boxId of listBoxes(runRoot)) {
    writeBoxRows(runRoot, BOX(boxId), rowsOf(runRoot, boxId).filter((row) => !dropped.has(row.unit_id)));
  }
  resealAssignments(runRoot);
}

/** Recompute the units-manifest counts from its own units array (the verifier re-derives them). */
function recomputeUnitCounts(manifest) {
  manifest.counts.units = manifest.units.length;
  manifest.counts.files = new Set(manifest.units.map((unit) => unit.path)).size;
  manifest.counts.line_split_units = manifest.units.filter((unit) => unit.boundary_kind === "line-split").length;
  manifest.counts.total_bytes = manifest.units.reduce((sum, unit) => sum + unit.byte_len, 0);
}

/**
 * Keep the assignment facts coherent after a manifest edit. The envelope generator re-binds
 * `manifest_sha256` to the exact manifest bytes and refuses a mismatch, and the delegated
 * join re-binds `unit_count`/`total_unit_bytes`; a mutation that models a legal store must
 * therefore write both, or the store is ill-formed rather than legal.
 */
function resealAssignments(runRoot) {
  const manifest = readJson(runRoot, MANIFEST);
  const byteLen = new Map(manifest.units.map((unit) => [unit.unit_id, unit.byte_len]));
  const known = new Set(manifest.units.map((unit) => unit.unit_id));
  const manifestSha = artifactSha(runRoot, MANIFEST);
  for (const boxId of listBoxes(runRoot)) {
    const assignment = readJson(runRoot, ASSIGNMENT(boxId));
    assignment.manifest_sha256 = manifestSha;
    assignment.units = assignment.units.filter((id) => known.has(id));
    assignment.unit_count = assignment.units.length;
    assignment.total_unit_bytes = assignment.units.reduce((sum, id) => sum + (byteLen.get(id) ?? 0), 0);
    writeJson(runRoot, ASSIGNMENT(boxId), assignment);
  }
}

function duplicatePair(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const { rows, row } = firstLinkRow(runRoot, boxId);
  row.links.push(structuredClone(row.links[0]));
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function rowOrder(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const rows = rowsOf(runRoot, boxId);
  if (rows.length < 2) throw new MutationNotApplicable("need two rows to reorder");
  [rows[0], rows[1]] = [rows[1], rows[0]];
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function unknownClaim(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const { rows, row } = firstLinkRow(runRoot, boxId);
  row.links[0].claim_id = "C99";
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function badWitness(runRoot, { variant }) {
  const boxId = listBoxes(runRoot)[0];
  const { rows, row } = firstLinkRow(runRoot, boxId);
  const original = row.links[0].witness;
  row.links[0].witness =
    variant === "absent"
      ? "workflow-fixture-absent-witness"
      : variant === "mid-line"
        ? `X${original}`
        : variant === "overlong"
          ? "x".repeat(161)
          : `${original}\nsecond line`;
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function missingRow(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const rows = rowsOf(runRoot, boxId);
  if (rows.length < 2) throw new MutationNotApplicable("need two rows to drop one");
  rows.pop();
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function extraRow(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const rows = rowsOf(runRoot, boxId);
  if (rows.length === 0) throw new MutationNotApplicable("no rows to clone");
  const clone = structuredClone(rows[0]);
  clone.unit_id = "u9999";
  rows.push(clone);
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function zeroLink(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const { rows, row } = firstLinkRow(runRoot, boxId);
  row.links = [];
  row.unresolved = null;
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function unresolvedRow(runRoot) {
  const boxId = listBoxes(runRoot)[0];
  const { rows, row } = firstLinkRow(runRoot, boxId);
  row.links = [];
  row.unresolved = "fixture-unresolved";
  writeBoxRows(runRoot, BOX(boxId), rows);
}

function ceilingDrift(runRoot, { delta }) {
  const boxId = listBoxes(runRoot).at(-1);
  const assignment = readJson(runRoot, ASSIGNMENT(boxId));
  assignment.input_ceiling_bytes = assignment.input_ceiling_bytes + delta;
  writeJson(runRoot, ASSIGNMENT(boxId), assignment);
}

function payloadMissing(runRoot) {
  const manifest = readJson(runRoot, MANIFEST);
  rmSync(unitPayloadAbs(runRoot, manifest.units[0].unit_id), { force: true });
}

/** The p05 sidecar that exists on disk: per-box (2-box stream) or the seed's global one. */
function p05EvidenceRel(runRoot) {
  for (const rel of ["join/box-0000.p05-evidence.json", "join/p05-evidence.json"]) {
    if (existsSync(path.join(runRoot, rel))) return rel;
  }
  throw new MutationNotApplicable("no p05 evidence sidecar in this store");
}

function p05NoCeiling(runRoot) {
  const rel = p05EvidenceRel(runRoot);
  const evidence = readJson(runRoot, rel);
  if (!evidence.budget || !("input_ceiling_bytes" in evidence.budget)) {
    throw new MutationNotApplicable(`no input_ceiling_bytes in ${rel}`);
  }
  delete evidence.budget.input_ceiling_bytes;
  writeJson(runRoot, rel, evidence);
}

function copyFromSeed(runRoot, rel) {
  writeBytes(runRoot, rel, readBytes(SEED_DIR, rel));
}

function nonAscii(runRoot) {
  const manifest = readJson(runRoot, MANIFEST);
  const unit = manifest.units[0];
  const abs = unitPayloadAbs(runRoot, unit.unit_id);
  const before = readFileSync(abs);
  // A valid diff content line, so the payload stays diff-framed (U7) while carrying
  // non-ASCII bytes through the escape-sensitive writers.
  const suffix = Buffer.from("\n+\t# snowman \u2603 \u00e9\u00e8\n", "utf8");
  const after = Buffer.concat([before, suffix]);
  writeBytes(runRoot, abs.slice(`${runRoot}/`.length), after);
  const updated = readJson(runRoot, MANIFEST);
  const target = updated.units.find((candidate) => candidate.unit_id === unit.unit_id);
  updated.counts.total_bytes += after.length - target.byte_len;
  target.byte_len = after.length;
  writeJson(runRoot, MANIFEST, updated);
  resealAssignments(runRoot);
}

export const MUTATIONS = {
  "drop-units": {
    stage: "prewrite",
    summary: "drop the last N units from the manifest, assignments and box rows (legal store)",
    expected: "ok",
    params: { count: { max: 8, shrink: (value) => Math.floor(value / 2) } },
    apply: dropUnits,
  },
  "duplicate-pair": {
    stage: "merge",
    summary: "duplicate one (unit_id, claim_id) pair",
    expected: "validation-failed",
    params: {},
    apply: duplicatePair,
  },
  "row-order": {
    stage: "merge",
    summary: "swap two rows so the box order no longer matches the assignment",
    expected: "validation-failed",
    params: {},
    apply: rowOrder,
  },
  "unknown-claim": {
    stage: "merge",
    summary: "point one link at a claim id outside the claims list",
    expected: "validation-failed",
    params: {},
    apply: unknownClaim,
  },
  "bad-witness": {
    stage: "merge",
    summary: "break one witness (absent / mid-line / overlong / multiline)",
    expected: "validation-failed",
    params: { variant: { values: ["absent", "mid-line", "overlong", "multiline"] } },
    apply: badWitness,
  },
  "missing-row": {
    stage: "merge",
    summary: "drop a row from a box (one manifest unit loses its row)",
    expected: "validation-failed",
    params: {},
    apply: missingRow,
  },
  "extra-row": {
    stage: "merge",
    summary: "append a row for a unit id that is not in the manifest",
    expected: "validation-failed",
    params: {},
    apply: extraRow,
  },
  "zero-link": {
    stage: "merge",
    summary: "a row with no links and no unresolved note (legal: it becomes candidate_unclaimed)",
    expected: "ok",
    // Clearing the first link row erases a claim/witness error planted there by a
    // link-error mutation, so the pair would not reach the stage-rule reason.
    cancels: ["duplicate-pair", "unknown-claim", "bad-witness"],
    params: {},
    apply: zeroLink,
  },
  unresolved: {
    stage: "merge",
    summary: "a row with links cleared and an unresolved note (legal row state)",
    expected: "ok",
    cancels: ["duplicate-pair", "unknown-claim", "bad-witness"],
    params: {},
    apply: unresolvedRow,
  },
  "ceiling-drift": {
    stage: "prewrite",
    summary: "one assignment's input_ceiling_bytes no longer equals the flag",
    expected: "needs-input",
    params: { delta: { max: 4096, shrink: (value) => Math.floor(value / 2) } },
    apply: ceilingDrift,
  },
  "payload-missing": {
    stage: "prewrite",
    summary: "delete the payload file of one unit",
    expected: "needs-input",
    params: {},
    apply: payloadMissing,
  },
  "p05-no-ceiling": {
    stage: "envelope",
    summary: "remove input_ceiling_bytes from one p05 evidence budget",
    expected: null,
    note: "envelope refusal; the token is assumed evidence-failed until the spec pins it",
    params: {},
    apply: p05NoCeiling,
  },
  "preexisting-draft": {
    stage: "freeze",
    summary: "a junk draft already exists (different bytes: the sealed frozen-artifact case)",
    expected: "frozen-artifact",
    params: {},
    apply: (runRoot) => writeJson(runRoot, JOIN_DRAFT, { preexisting: true }),
  },
  "preexisting-draft-equal": {
    stage: "freeze",
    summary: "the seed draft is pre-placed: a legitimate-looking but stale draft (no `machine`, old key order)",
    expected: "frozen-artifact",
    note: "D4 staging-compare refuses a differing target; the seed fixture's draft is not byte-equal to the `join-draft/1` this build derives (the seed predates the ai070 field set), so this pins the refuse-different half. The accept-equal half is covered by `resume-never-rewrites-different-bytes` and the overwrite case.",
    params: {},
    apply: (runRoot) => copyFromSeed(runRoot, JOIN_DRAFT),
  },
  "preexisting-envelope": {
    stage: "freeze",
    summary: "a junk envelope already exists",
    expected: "frozen-artifact",
    params: {},
    apply: (runRoot) => writeJson(runRoot, RUN_MANIFEST, { preexisting: true }),
  },
  "preexisting-envelope-equal": {
    stage: "freeze",
    summary: "the seed's envelope already exists (different bytes once the store changes)",
    expected: "frozen-artifact",
    note: "the seed envelope pins seed refs and a seed operator_ref, so it is never byte-equal to the derived envelope; staging-compare refuses the differing target (D4).",
    params: {},
    apply: (runRoot) => copyFromSeed(runRoot, RUN_MANIFEST),
  },
  "non-ascii": {
    stage: "merge",
    summary: "append a non-ASCII line to a payload (escaping divergence probe)",
    expected: "ok",
    params: {},
    apply: nonAscii,
  },
};

export const MUTATION_NAMES = Object.keys(MUTATIONS);

/** Mutations that leave the store legal: a property that expects an accept must use only these. */
export const LEGAL_MUTATION_NAMES = MUTATION_NAMES.filter((name) => MUTATIONS[name].expected === "ok" || MUTATIONS[name].expected === null);

/** Apply a mutation program in order; throws MutationNotApplicable on an unsuitable store. */
export function applyMutations(runRoot, mutations) {
  for (const { name, params } of mutations) {
    const mutation = MUTATIONS[name];
    if (!mutation) throw new Error(`unknown mutation: ${name}`);
    mutation.apply(runRoot, params ?? {});
  }
}

export const STAGE_ORDER = ["prewrite", "pin", "merge", "freeze", "envelope"];

/**
 * The pinned reason for a mutation program, or null when the spec does not decide it.
 *
 * The core checks in stages, so the EARLIEST stage that refuses decides the outcome: a
 * pre-write mismatch refuses before the merge ever runs. Stages whose mutations are all
 * legal (`expected: "ok"`) are passed through, exactly as the workflow does, so a later
 * refusal is not masked by an earlier legal mutation. Within a refusing stage an unpinned
 * expectation (D4-style ambiguity) makes the whole program unpinned.
 */
export function expectedReason(mutations) {
  for (const stage of STAGE_ORDER) {
    const involved = mutations.map(({ name }) => MUTATIONS[name]).filter((mutation) => mutation && mutation.stage === stage);
    if (involved.length === 0) continue;
    if (involved.some((mutation) => mutation.expected === null)) return null;
    const refusal = involved.find((mutation) => mutation.expected !== "ok");
    if (refusal) return refusal.expected;
  }
  return "ok";
}

export function unpinnedMutations(mutations) {
  return mutations.filter(({ name }) => MUTATIONS[name]?.expected === null).map(({ name }) => name);
}

export function describeMutations(mutations) {
  return (
    mutations.map(({ name, params }) => (Object.keys(params ?? {}).length ? `${name}(${Object.values(params).join(",")})` : name)).join(" + ") || "clean"
  );
}
