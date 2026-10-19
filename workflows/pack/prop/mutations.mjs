// workflows/pack/prop/mutations.mjs — the pre-pack store mutation vocabulary for the property engine.
//
// A mutation is a named, deterministic edit of a synthetic pre-pack store. The engine
// generates mutation programs (0..n mutations), applies them in order, and drives p0-pack
// over the result. Each entry declares:
//   summary   one-line description (reports, docs)
//   stage     the pipeline stage whose refusal it models (`prewrite|pack|freeze|promote`)
//   params    generation/shrinking metadata for the mutation's parameters
//   expected  the sealed exit reason the mutation must produce, or null when the sealed
//             spec does not decide it yet (`note` then records the assumption)
//   cancels   other mutation names whose effect this pick would erase (generator guard)
//   apply     (runRoot, params) -> void; throws MutationNotApplicable when the store has no
//             suitable target (the runner counts that as a discard)
//
// Domain rules mirrored from workflows/pack/SPEC.md (do not widen without a spec change):
//   pre-write validation mismatch -> needs-input
//   ceiling that cannot hold fixed input + one whole unit -> needs-input
//   existing differing target / stale box artifact -> frozen-artifact
//   a legal smaller/opaque/renamed inventory -> ok
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { readBytes, readJson, writeBytes, writeJson, writeText } from "../../../kernel/tools/verify-testkit.mjs";

export class MutationNotApplicable extends Error {
  constructor(message) {
    super(message);
    this.name = "MutationNotApplicable";
    this.code = "E_MUTATION_NOT_APPLICABLE";
  }
}

const CLAIMS_REL = "claims/claims-draft.v3.json";
const CAPTURE_REL = "claims/sources/capture-manifest.json";
const MANIFEST_REL = "units/units2/manifest.json";
const UNITS_DIR = "units/units2";
const CLAIMS_LIST_REL = "join/claims-list.json";
const assignmentRel = (boxId) => `join/${boxId}.assignment.json`;
const instructionsRel = (boxId) => `join/${boxId}.instructions.md`;

const basename = (ref) => {
  const idx = ref.lastIndexOf("/");
  return idx < 0 ? ref : ref.slice(idx + 1);
};
const payloadRel = (unit) => `${UNITS_DIR}/${basename(unit.file)}`;

function requireRel(runRoot, rel, what) {
  if (!existsSync(path.join(runRoot, rel))) throw new MutationNotApplicable(`${what} absent: ${rel}`);
}

function readManifest(runRoot) {
  requireRel(runRoot, MANIFEST_REL, "units manifest");
  return readJson(runRoot, MANIFEST_REL);
}

function readClaims(runRoot) {
  requireRel(runRoot, CLAIMS_REL, "claims draft");
  return readJson(runRoot, CLAIMS_REL);
}

function readCapture(runRoot) {
  requireRel(runRoot, CAPTURE_REL, "capture manifest");
  return readJson(runRoot, CAPTURE_REL);
}

function recomputeUnitCounts(manifest) {
  manifest.counts = manifest.counts ?? {};
  manifest.counts.units = manifest.units.length;
  manifest.counts.files = new Set(manifest.units.map((unit) => unit.file)).size;
  manifest.counts.line_split_units = manifest.units.filter((unit) => unit.boundary_kind === "line-split").length;
  manifest.counts.total_bytes = manifest.units.reduce((sum, unit) => sum + unit.byte_len, 0);
}

function packableCount(manifest) {
  return manifest.units.filter((unit) => unit.boundary_kind !== "opaque").length;
}

// ------------------------------------------------------------- pre-write mutations ----

/** The payload byte size no longer equals the manifest byte_len (a manifest/payload drift). */
function byteLenDrift(runRoot, { delta }) {
  const manifest = readManifest(runRoot);
  const unit = manifest.units.at(-1);
  if (!unit || !Number.isSafeInteger(unit.byte_len)) throw new MutationNotApplicable("no unit to drift");
  unit.byte_len += delta;
  manifest.counts.total_bytes += delta;
  writeJson(runRoot, MANIFEST_REL, manifest);
}

function missingPayload(runRoot) {
  const manifest = readManifest(runRoot);
  const unit = manifest.units[0];
  if (!unit) throw new MutationNotApplicable("units manifest is empty");
  const rel = payloadRel(unit);
  if (!existsSync(path.join(runRoot, rel))) throw new MutationNotApplicable(`payload absent: ${rel}`);
  rmSync(path.join(runRoot, rel), { force: true });
}

function missingClaims(runRoot) {
  requireRel(runRoot, CLAIMS_REL, "claims draft");
  rmSync(path.join(runRoot, CLAIMS_REL), { force: true });
}

function missingManifest(runRoot) {
  requireRel(runRoot, MANIFEST_REL, "units manifest");
  rmSync(path.join(runRoot, MANIFEST_REL), { force: true });
}

function missingCapture(runRoot) {
  requireRel(runRoot, CAPTURE_REL, "capture manifest");
  rmSync(path.join(runRoot, CAPTURE_REL), { force: true });
}

function emptyClaims(runRoot) {
  const draft = readClaims(runRoot);
  if (!Array.isArray(draft.claims) || draft.claims.length === 0) throw new MutationNotApplicable("claims are already empty");
  draft.claims = [];
  writeJson(runRoot, CLAIMS_REL, draft);
}

function emptyUnits(runRoot) {
  const manifest = readManifest(runRoot);
  if (manifest.units.length === 0) throw new MutationNotApplicable("units manifest is already empty");
  manifest.units = [];
  recomputeUnitCounts(manifest);
  writeJson(runRoot, MANIFEST_REL, manifest);
}

function badRunId(runRoot) {
  const capture = readCapture(runRoot);
  capture.run = "fixture/p0-pack-no-number";
  writeJson(runRoot, CAPTURE_REL, capture);
}

/** A capture identity field disappears: the completeness check refuses before any read. */
function emptyIdentity(runRoot) {
  const capture = readCapture(runRoot);
  if (!("review_state" in capture)) throw new MutationNotApplicable("review_state is already absent");
  delete capture.review_state;
  writeJson(runRoot, CAPTURE_REL, capture);
}

/** A claims-draft entry loses its statement: `{id, statement}` shape is violated. */
function invalidClaimEntry(runRoot) {
  const draft = readClaims(runRoot);
  const claim = draft.claims[0];
  if (!claim || claim.statement === undefined) throw new MutationNotApplicable("no claim statement to remove");
  delete claim.statement;
  writeJson(runRoot, CLAIMS_REL, draft);
}

function emptyUnitId(runRoot) {
  const manifest = readManifest(runRoot);
  const unit = manifest.units[0];
  if (!unit || unit.unit_id === "") throw new MutationNotApplicable("no unit id to empty");
  unit.unit_id = "";
  writeJson(runRoot, MANIFEST_REL, manifest);
}

/**
 * Duplicate claim ids in the draft. The pack spec only requires a nonempty array of
 * `{id, statement}` objects, so whether this must refuse is undecided — the row is
 * unpinned: the property classifies it and never asserts a reason.
 */
function duplicateClaimIds(runRoot) {
  const draft = readClaims(runRoot);
  if (!Array.isArray(draft.claims) || draft.claims.length < 2) throw new MutationNotApplicable("need two claims to duplicate an id");
  draft.claims.splice(1, 0, structuredClone(draft.claims[0]));
  writeJson(runRoot, CLAIMS_REL, draft);
}

// --------------------------------------------------------------- packing mutations ----

/**
 * Grow one packable unit's payload and manifest byte_len so it cannot fit an empty box.
 * `extra >= 300000` exceeds the generator's maximum ceiling (200000), so the fit failure is
 * guaranteed inside the generated space. The shrinker keeps `extra >= 300000` (see spec.mjs).
 */
function oversizedUnit(runRoot, { extra }) {
  const manifest = readManifest(runRoot);
  const unit = manifest.units.filter((candidate) => candidate.boundary_kind !== "opaque").at(-1);
  if (!unit) throw new MutationNotApplicable("no non-opaque unit to oversize");
  const rel = payloadRel(unit);
  if (!existsSync(path.join(runRoot, rel))) throw new MutationNotApplicable(`payload absent: ${rel}`);
  const after = Buffer.concat([readBytes(runRoot, rel), Buffer.alloc(extra, 0x78)]);
  writeBytes(runRoot, rel, after);
  unit.byte_len = after.length;
  manifest.counts.total_bytes += extra;
  writeJson(runRoot, MANIFEST_REL, manifest);
}

/** One unit becomes opaque: it is excluded from the boxes (a legal smaller inventory). */
function opaqueUnit(runRoot) {
  const manifest = readManifest(runRoot);
  const unit = manifest.units.find((candidate) => candidate.boundary_kind !== "opaque");
  if (!unit) throw new MutationNotApplicable("every unit is already opaque");
  if (packableCount(manifest) < 2) throw new MutationNotApplicable("opaque-unit would leave nothing to pack");
  unit.boundary_kind = "opaque";
  writeJson(runRoot, MANIFEST_REL, manifest);
}

/** Every unit becomes opaque: nothing to pack, a documented needs-input. */
function allOpaque(runRoot) {
  const manifest = readManifest(runRoot);
  if (manifest.units.length === 0) throw new MutationNotApplicable("units manifest is empty");
  for (const unit of manifest.units) unit.boundary_kind = "opaque";
  writeJson(runRoot, MANIFEST_REL, manifest);
}

/**
 * Point a unit at a nested `file` ref whose basename is unchanged. p0-pack derives the
 * payload path from `units_dir + basename(file)`, so this is legal — and it is the D1
 * regression probe: the path must still resolve to `units/units2/<basename>`.
 */
function nestedFileRef(runRoot) {
  const manifest = readManifest(runRoot);
  const unit = manifest.units[0];
  if (!unit || typeof unit.file !== "string") throw new MutationNotApplicable("no unit file ref to repoint");
  if (unit.file.startsWith("units2/nested/")) throw new MutationNotApplicable("file ref is already nested");
  unit.file = "units2/nested/" + basename(unit.file);
  writeJson(runRoot, MANIFEST_REL, manifest);
}

/** Non-ASCII claim text (BMP or an astral pair): the projection must escape it, not break. */
function nonAsciiClaims(runRoot, { variant }) {
  const draft = readClaims(runRoot);
  const claim = draft.claims[0];
  if (!claim || typeof claim.statement !== "string") throw new MutationNotApplicable("no claim statement to extend");
  const suffix = variant === "astral" ? " \u{1F680} \u00E9" : " \u2603 \u00E9";
  claim.statement = claim.statement + suffix;
  writeJson(runRoot, CLAIMS_REL, draft);
}

// ----------------------------------------------------------------- freeze mutations ----

function preexistingClaimsList(runRoot) {
  writeText(runRoot, CLAIMS_LIST_REL, "[]\n");
}

function preexistingAssignment(runRoot) {
  writeJson(runRoot, assignmentRel("box-0000"), { preexisting: true });
}

function preexistingInstructions(runRoot) {
  writeText(runRoot, instructionsRel("box-0000"), "preexisting instructions\n");
}

/** A leftover box id outside any derived set: it cannot be repaired by a rewrite. */
function staleBox(runRoot) {
  writeJson(runRoot, assignmentRel("box-0099"), { preexisting: true });
  writeText(runRoot, instructionsRel("box-0099"), "stale box\n");
}

export const MUTATIONS = {
  "byte-len-drift": {
    stage: "prewrite",
    summary: "one unit's manifest byte_len no longer equals its payload size",
    expected: "needs-input",
    params: { delta: { min: 1, max: 4096, shrink: (value) => Math.floor(value / 2) } },
    apply: byteLenDrift,
  },
  "missing-payload": {
    stage: "prewrite",
    summary: "delete the payload file of one unit",
    expected: "needs-input",
    params: {},
    apply: missingPayload,
  },
  "missing-claims": {
    stage: "prewrite",
    summary: "delete the claims draft",
    expected: "needs-input",
    params: {},
    apply: missingClaims,
  },
  "missing-manifest": {
    stage: "prewrite",
    summary: "delete the units manifest",
    expected: "needs-input",
    params: {},
    apply: missingManifest,
  },
  "missing-capture": {
    stage: "prewrite",
    summary: "delete the capture manifest",
    expected: "needs-input",
    params: {},
    apply: missingCapture,
  },
  "empty-claims": {
    stage: "prewrite",
    summary: "the claims draft has an empty claims array",
    expected: "needs-input",
    params: {},
    apply: emptyClaims,
  },
  "empty-units": {
    stage: "prewrite",
    summary: "the units manifest has an empty units array",
    expected: "needs-input",
    params: {},
    apply: emptyUnits,
  },
  "bad-run-id": {
    stage: "prewrite",
    summary: "the capture run id no longer parses as <repo>#<n>",
    expected: "needs-input",
    params: {},
    apply: badRunId,
  },
  "empty-identity": {
    stage: "prewrite",
    summary: "a capture identity field is missing",
    expected: "needs-input",
    params: {},
    apply: emptyIdentity,
  },
  "invalid-claim-entry": {
    stage: "prewrite",
    summary: "a claims-draft entry is not an {id, statement} object",
    expected: "needs-input",
    params: {},
    apply: invalidClaimEntry,
  },
  "empty-unit-id": {
    stage: "prewrite",
    summary: "a units-manifest entry has an empty unit_id",
    expected: "needs-input",
    params: {},
    apply: emptyUnitId,
  },
  "duplicate-claim-ids": {
    stage: "prewrite",
    summary: "the claims draft repeats a claim id (shape valid, uniqueness undecided)",
    expected: null,
    note: "the pack spec only requires a nonempty array of {id, statement}; whether duplicate ids must refuse is an operator decision — the property classifies this program and never asserts a reason",
    params: {},
    apply: duplicateClaimIds,
  },
  "oversized-unit": {
    stage: "pack",
    summary: "grow the last packable unit past any generated ceiling: it cannot fit an empty box",
    expected: "needs-input",
    note: "the pinned refusal assumes the generated ceiling bound (<= 200000); the shrinker keeps extra >= 300000, and a ceiling above that bound is outside the generated space",
    params: { extra: { min: 300000, max: 600000, shrink: (value) => Math.max(300000, Math.floor(value / 2)) } },
    cancels: ["opaque-unit", "all-opaque"],
    apply: oversizedUnit,
  },
  "opaque-unit": {
    stage: "pack",
    summary: "one unit becomes opaque and is excluded from the boxes (legal smaller inventory)",
    expected: "ok",
    cancels: ["oversized-unit", "all-opaque"],
    params: {},
    apply: opaqueUnit,
  },
  "all-opaque": {
    stage: "pack",
    summary: "every unit is opaque: nothing to pack, a documented needs-input",
    expected: "needs-input",
    cancels: ["oversized-unit", "opaque-unit"],
    params: {},
    apply: allOpaque,
  },
  "nested-file-ref": {
    stage: "pack",
    summary: "a unit file ref becomes units2/nested/<name> (basename unchanged: legal, path must still resolve)",
    expected: "ok",
    params: {},
    apply: nestedFileRef,
  },
  "non-ascii-claims": {
    stage: "pack",
    summary: "append non-ASCII claim text (BMP or astral) — the projection must escape it",
    expected: "ok",
    params: { variant: { values: ["bmp", "astral"] } },
    apply: nonAsciiClaims,
  },
  "preexisting-claims-list": {
    stage: "freeze",
    summary: "a differing claims-list already exists (frozen target, no overwrite)",
    expected: "frozen-artifact",
    params: {},
    apply: preexistingClaimsList,
  },
  "preexisting-assignment": {
    stage: "freeze",
    summary: "a differing box-0000.assignment.json already exists",
    expected: "frozen-artifact",
    params: {},
    apply: preexistingAssignment,
  },
  "preexisting-instructions": {
    stage: "freeze",
    summary: "a differing box-0000.instructions.md already exists",
    expected: "frozen-artifact",
    params: {},
    apply: preexistingInstructions,
  },
  "stale-box": {
    stage: "freeze",
    summary: "a box-0099 artifact exists outside any derived box set (stale, never deleted)",
    expected: "frozen-artifact",
    params: {},
    apply: staleBox,
  },
};

export const MUTATION_NAMES = Object.keys(MUTATIONS);

/** Mutations that leave the store runnable to an accept (or an undecided accept): legal programs. */
export const LEGAL_MUTATION_NAMES = MUTATION_NAMES.filter((name) => MUTATIONS[name].expected === "ok" || MUTATIONS[name].expected === null);

/** Apply a mutation program in order; throws MutationNotApplicable on an unsuitable store. */
export function applyMutations(runRoot, mutations) {
  for (const { name, params } of mutations) {
    const mutation = MUTATIONS[name];
    if (!mutation) throw new Error(`unknown mutation: ${name}`);
    mutation.apply(runRoot, params ?? {});
  }
}

/** Pipeline stages in refusal order: the earliest stage that refuses decides the outcome. */
export const STAGE_ORDER = ["prewrite", "pack", "freeze", "promote"];

/**
 * The pinned reason for a mutation program, or null when the spec does not decide it.
 *
 * The workflow checks in stages, so the EARLIEST stage that refuses decides the outcome: a
 * pre-write mismatch refuses before the pack helper ever packs. Stages whose mutations are
 * all legal (`expected: "ok"`) are passed through, exactly as the workflow does, so a later
 * refusal is not masked by an earlier legal mutation. Within a refusing stage an unpinned
 * expectation makes the whole program unpinned.
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
