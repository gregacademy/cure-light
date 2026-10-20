// workflows/pack/prop/catalog.mjs — the property table: generated-input properties for
// p0-pack, plus the engine's own self-tests.
//
// Adapted from workflows/p0/prop/catalog.mjs. A property is data:
//   {name, group, title, workflow, args, property(ctx), gen?, shrink?, cover?, note?}
// `ctx` exposes the driven store report, `classify(label)`, the metamorphic sibling run
// (`ctx.run(spec)`) and the idempotence rerun of the SAME store (`ctx.rerun(overrides)`).
//
// Properties are chosen so they need no oracle: they are invariants (a refusal writes
// nothing, an accept is a complete ordered partition under the ceiling, resume skips every
// target) or relations (a second run reproduces the digest). The mutation registry supplies
// the input space and its sealed expectations, so a generated program is the fault matrix
// generalized. The stage rule applies exactly as in p0: an unpinned mutation classifies,
// never asserts.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, readText } from "../../../kernel/tools/verify-testkit.mjs";
import { DRAFT, packArgs } from "../testkit.mjs";
import { genStoreSpec } from "./spec.mjs";
import { describeMutations, expectedReason, unpinnedMutations } from "./mutations.mjs";
import { PropertyViolation } from "./runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE_FIXTURE = path.join(HERE, "..", "fixtures", "probe-mark.js");

/** The only exit reasons the core may author (SPEC §Exit reasons; reserved tokens never). */
export const AUTHORED_REASONS = ["ok", "needs-input", "frozen-artifact", "evidence-failed"];

const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const assignmentRel = (boxId) => `join/${boxId}.assignment.json`;
const instructionsRel = (boxId) => `join/${boxId}.instructions.md`;
const basename = (ref) => {
  const idx = ref.lastIndexOf("/");
  return idx < 0 ? ref : ref.slice(idx + 1);
};

/** Every derived box id on disk, in box order. Refusals never leave stale ids behind. */
export function listBoxIds(runRoot) {
  return readdirSync(path.join(runRoot, "join"))
    .filter((name) => /^box-\d{4}\.assignment\.json$/.test(name))
    .map((name) => name.slice(0, -".assignment.json".length))
    .sort();
}

function readManifest(runRoot) {
  return readJson(runRoot, "units/units2/manifest.json");
}

function readAssignment(runRoot, boxId) {
  return readJson(runRoot, assignmentRel(boxId));
}

/** Generated args: ceiling and child store are pure functions of the spec, so a replay re-derives them. */
function packSpecArgs(runRoot, overrides = {}) {
  return packArgs(runRoot, {
    ceiling: overrides.ceiling ?? overrides.spec?.ceiling,
    childStore: overrides.childStore ?? overrides.spec?.childStore,
  });
}

// ------------------------------------------------------------- p0-pack properties ----

export const PACK_PROPERTIES = [
  {
    name: "reason-authored",
    group: "p0-pack",
    title: "every run answers with one of the four authored exit reasons",
    workflow: DRAFT,
    args: packSpecArgs,
    property(ctx) {
      const reason = ctx.report.reason;
      ctx.classify(`reason=${reason}`);
      if (!AUTHORED_REASONS.includes(reason)) throw new PropertyViolation(`unauthored exit reason: ${JSON.stringify(reason)}`);
      return reason;
    },
  },
  {
    name: "refusal-writes-nothing",
    group: "p0-pack",
    title: "a refusal never writes to the store (no partial state on any failure path)",
    workflow: DRAFT,
    args: packSpecArgs,
    property(ctx) {
      const { report } = ctx;
      ctx.classify(`reason=${report.reason}`);
      if (report.reason === "ok") return "accepted";
      if (!sameTree(report.snapshot.before, report.snapshot.after)) {
        const before = new Set(report.snapshot.before.map((entry) => `${entry.rel}:${entry.sha256}`));
        const added = report.snapshot.after.filter((entry) => !before.has(`${entry.rel}:${entry.sha256}`)).map((entry) => entry.rel);
        throw new PropertyViolation(`refusal ${report.reason} wrote to the store: ${added.join(", ") || "(changed bytes)"}`);
      }
      return `refused=${report.reason}`;
    },
  },
  {
    name: "coverage-and-order",
    group: "p0-pack",
    title: "an accepted run's boxes partition the packable units in manifest order, with no duplicates or omissions",
    workflow: DRAFT,
    args: packSpecArgs,
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const runRoot = ctx.report.paths.runRoot;
      const manifest = readManifest(runRoot);
      const packable = manifest.units.filter((unit) => unit.boundary_kind !== "opaque");
      const ids = listBoxIds(runRoot);
      const assigned = [];
      for (const boxId of ids) {
        const assignment = readAssignment(runRoot, boxId);
        if (assignment.box_id !== boxId) throw new PropertyViolation(`assignment ${boxId} declares box_id ${assignment.box_id}`);
        assigned.push(...assignment.units);
      }
      if (new Set(assigned).size !== assigned.length) throw new PropertyViolation("a unit is assigned to more than one box, or twice to one box");
      if (assigned.length !== packable.length) throw new PropertyViolation(`boxes cover ${assigned.length} unit(s), the packable manifest has ${packable.length}`);
      for (let i = 0; i < packable.length; i++) {
        if (assigned[i] !== packable[i].unit_id) {
          throw new PropertyViolation(`unit ${i} is ${assigned[i]}, expected ${packable[i].unit_id} (manifest order)`);
        }
      }
      const opaque = manifest.units.length - packable.length;
      if (ctx.report.exit.opaque_units !== opaque) throw new PropertyViolation(`exit opaque_units=${ctx.report.exit.opaque_units}, manifest has ${opaque}`);
      if (ctx.report.exit.units !== manifest.units.length) throw new PropertyViolation(`exit units=${ctx.report.exit.units}, manifest has ${manifest.units.length}`);
      const summed = ids.reduce((sum, boxId) => sum + readAssignment(runRoot, boxId).unit_count, 0);
      if (summed + opaque !== manifest.units.length) throw new PropertyViolation(`box unit sums ${summed} + opaque ${opaque} != manifest units ${manifest.units.length}`);
      return `boxes=${ids.length} units=${assigned.length} opaque=${opaque}`;
    },
  },
  {
    name: "greedy-ceiling",
    group: "p0-pack",
    title: "every box fits the ceiling and no box could have held the next box's first unit",
    workflow: DRAFT,
    args: packSpecArgs,
    note: "the ceiling, child store and next-line bytes come from the generated input (spec), not from the exit payload; the exit is only cross-checked. Adding a unit also adds its instruction line, so the boundary test charges the incremental line bytes (the workflow charges the candidate render), not only the unit payload",
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const runRoot = ctx.report.paths.runRoot;
      // The oracle is the generated input: the ceiling and child store are explicit flags
      // whose values the spec fixes. Reading them back from the exit payload would make the
      // check circular (the engine would be compared with itself).
      const ceiling = ctx.spec.ceiling;
      if (typeof ceiling !== "number") throw new PropertyViolation(`generated spec carries no numeric ceiling: ${JSON.stringify(ceiling)}`);
      if (ctx.report.exit.ceiling !== ceiling) {
        throw new PropertyViolation(`exit ceiling ${JSON.stringify(ctx.report.exit.ceiling)} != generated --input-ceiling-bytes ${ceiling}`);
      }
      const childStore = ctx.spec.childStore;
      if (typeof childStore !== "string" || childStore === "") {
        throw new PropertyViolation(`generated spec carries no child store: ${JSON.stringify(childStore)}`);
      }
      const manifest = readManifest(runRoot);
      const unitBy = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
      const unitBytes = new Map(manifest.units.map((unit) => [unit.unit_id, unit.byte_len]));
      const claimsBytes = statSync(path.join(runRoot, "join/claims-list.json")).size;
      const ids = listBoxIds(runRoot);
      for (let index = 0; index < ids.length; index++) {
        const boxId = ids[index];
        const assignment = readAssignment(runRoot, boxId);
        if (assignment.input_ceiling_bytes !== ceiling) throw new PropertyViolation(`box ${boxId} records ceiling ${assignment.input_ceiling_bytes}, exit says ${ceiling}`);
        const instructionsBytes = statSync(path.join(runRoot, instructionsRel(boxId))).size;
        let unitSum = 0;
        for (const unitId of assignment.units) {
          const size = unitBytes.get(unitId);
          if (typeof size !== "number") throw new PropertyViolation(`box ${boxId} assigns unknown unit ${unitId}`);
          unitSum += size;
        }
        const boxInput = instructionsBytes + claimsBytes + unitSum;
        if (boxInput > ceiling) throw new PropertyViolation(`box ${boxId} input ${boxInput} exceeds ceiling ${ceiling}`);
        const digest = ctx.report.exit.boxes?.[index];
        if (digest && digest.box_input_bytes !== boxInput) throw new PropertyViolation(`box ${boxId} digest input ${digest.box_input_bytes} != measured ${boxInput}`);
        const nextId = ids[index + 1];
        if (nextId) {
          const nextFirst = readAssignment(runRoot, nextId).units[0];
          const nextUnit = unitBy.get(nextFirst);
          const nextSize = unitBytes.get(nextFirst);
          if (!nextUnit || typeof nextSize !== "number") throw new PropertyViolation(`box ${nextId} assigns unknown first unit ${nextFirst}`);
          const nextLineBytes = Buffer.byteLength(`- ${nextFirst} \u2014 ${childStore}/units/units2/${basename(nextUnit.file)}\n`, "utf8");
          if (!(boxInput + nextLineBytes + nextSize > ceiling)) {
            throw new PropertyViolation(`box ${boxId} is not greedy: ${boxInput} + line ${nextLineBytes} + ${nextFirst} (${nextSize}) <= ${ceiling}`);
          }
        }
      }
      return `boxes=${ids.length} ceiling=${ceiling}`;
    },
  },
  {
    name: "resume-idempotent",
    group: "p0-pack",
    title: "a second run over an accepted store is ok, skips every target and changes no bytes",
    workflow: DRAFT,
    args: packSpecArgs,
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const runRoot = ctx.report.paths.runRoot;
      const targets = ["join/claims-list.json"];
      for (const boxId of listBoxIds(runRoot)) targets.push(assignmentRel(boxId), instructionsRel(boxId));
      const second = ctx.rerun();
      if (second.reason !== "ok") throw new PropertyViolation(`resume refused with ${second.reason}`);
      const promoted = second.exit.promoted ?? [];
      if (promoted.length !== 0) throw new PropertyViolation(`resume rewrote ${promoted.length} target(s): ${promoted.join(", ")}`);
      const skipped = [...(second.exit.skipped ?? [])].sort();
      if (JSON.stringify(skipped) !== JSON.stringify([...targets].sort())) {
        throw new PropertyViolation(`resume skipped [${skipped.join(", ")}], expected every target [${[...targets].sort().join(", ")}]`);
      }
      if (!sameTree(second.snapshot.before, second.snapshot.after)) throw new PropertyViolation("a skipped resume changed the store bytes");
      return "resume-idempotent";
    },
  },
  {
    name: "corrected-paths",
    group: "p0-pack",
    title: "every accepted instruction carries units/units2 paths per assigned unit and never the defect path",
    workflow: DRAFT,
    args: packSpecArgs,
    note: "the expected payload path is derived from the generated --child-store input and the manifest basename; the exit payload's child_store is only cross-checked, never used as the oracle",
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const runRoot = ctx.report.paths.runRoot;
      // Non-circular oracle: p0-pack renders the generated `--child-store` value and the
      // manifest basename. Deriving the expectation from the exit payload would let a wrong
      // path that the engine also reports wrong pass unnoticed.
      const childStore = ctx.spec.childStore;
      if (typeof childStore !== "string" || childStore === "") {
        throw new PropertyViolation(`generated spec carries no child store: ${JSON.stringify(childStore)}`);
      }
      if (ctx.report.exit.paths?.child_store !== undefined && ctx.report.exit.paths.child_store !== childStore) {
        throw new PropertyViolation(`exit child_store ${JSON.stringify(ctx.report.exit.paths.child_store)} != generated --child-store ${childStore}`);
      }
      const manifest = readManifest(runRoot);
      const unitBy = new Map(manifest.units.map((unit) => [unit.unit_id, unit]));
      const defect = `${childStore}/units2/`;
      for (const boxId of listBoxIds(runRoot)) {
        const assignment = readAssignment(runRoot, boxId);
        const instructions = readText(runRoot, instructionsRel(boxId));
        for (const unitId of assignment.units) {
          const unit = unitBy.get(unitId);
          if (!unit) throw new PropertyViolation(`box ${boxId} assigns unknown unit ${unitId}`);
          const want = `${childStore}/units/units2/${basename(unit.file)}`;
          if (!instructions.includes(want)) throw new PropertyViolation(`box ${boxId} instruction misses the corrected payload path for ${unitId}: ${want}`);
        }
        if (instructions.includes(defect)) throw new PropertyViolation(`box ${boxId} instruction carries the defect payload path: ${defect}`);
      }
      return "corrected-paths";
    },
  },
  {
    name: "strict-overwrite-and-stale-guard",
    group: "p0-pack",
    title: "an accept never rewrites a pre-existing target or ignores a stale box artifact",
    workflow: DRAFT,
    args: packSpecArgs,
    note: "uses the store snapshots taken before/after the run: an accept must leave every pre-existing join target byte-identical and must not accept while a box id outside the derived set exists. Refusals are already covered byte-for-byte by refusal-writes-nothing",
    property(ctx) {
      const { report } = ctx;
      const reason = report.reason;
      ctx.classify(`reason=${reason}`);
      const before = new Map(report.snapshot.before.map((entry) => [entry.rel, entry.sha256]));
      const joinArtifacts = [...before.keys()].filter((rel) => rel.startsWith("join/"));
      if (joinArtifacts.length === 0) return "no-preexisting-artifacts";
      if (reason !== "ok") return `refused=${reason}`;
      const after = new Map(report.snapshot.after.map((entry) => [entry.rel, entry.sha256]));
      const derived = new Set(listBoxIds(report.paths.runRoot));
      for (const [rel, sha] of before) {
        const isTarget = rel === "join/claims-list.json" || /^join\/box-\d{4}\.(assignment\.json|instructions\.md)$/.test(rel);
        if (isTarget) {
          const now = after.get(rel);
          if (now === undefined) throw new PropertyViolation(`accept deleted the pre-existing target ${rel}`);
          if (now !== sha) throw new PropertyViolation(`accept rewrote the pre-existing target ${rel} without --allow-overwrite`);
        }
        const box = /^join\/(box-\d{4})\./.exec(rel);
        if (box && !derived.has(box[1])) {
          throw new PropertyViolation(`accept ignored the stale box artifact ${rel} (derived ${[...derived].join(", ") || "none"})`);
        }
      }
      return "guard-held";
    },
  },
  {
    name: "mutation-program-reaches-its-sealed-reason",
    group: "p0-pack",
    title: "every mutation program reaches the reason the sealed spec pins for it",
    workflow: DRAFT,
    args: packSpecArgs,
    note: "programs containing an unpinned mutation (duplicate claim ids) are classified, not asserted",
    property(ctx) {
      const expected = expectedReason(ctx.spec.mutations);
      const reason = ctx.report.reason;
      ctx.classify(`reason=${reason}`);
      if (expected === null) {
        // Unpinned programs are classified, never asserted. The layering keeps them honest:
        // `reason-authored` still rejects a token outside the four, and
        // `refusal-writes-nothing` still rejects a refusal that wrote.
        const unpinned = unpinnedMutations(ctx.spec.mutations).join(", ");
        ctx.classify("unpinned");
        return `unpinned(${unpinned}) -> ${reason}`;
      }
      if (reason !== expected) {
        throw new PropertyViolation(`mutations [${describeMutations(ctx.spec.mutations)}] produced ${reason}, expected ${expected}`);
      }
      return `${describeMutations(ctx.spec.mutations)} -> ${reason}`;
    },
  },
  {
    name: "accepted-runs-have-a-stable-digest",
    group: "p0-pack",
    title: "an accepted run re-derived from the same spec reproduces its whole result",
    workflow: DRAFT,
    args: packSpecArgs,
    note: "generated specs pin --child-store, so the render does not depend on the temp store root and two roots are byte-comparable; the child==store default is covered by the sealed cases",
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const sibling = ctx.run(ctx.spec);
      if (sibling.reason !== "ok") throw new PropertyViolation(`rerun from the same spec refused with ${sibling.reason}`);
      if (sibling.resultDigest !== ctx.report.resultDigest) {
        throw new PropertyViolation(`result digest changed between identical runs (${ctx.report.resultDigest?.slice(0, 12)} != ${sibling.resultDigest?.slice(0, 12)})`);
      }
      return "digest-stable";
    },
  },
];

// ----------------------------------------------------------- engine self-tests ----

export const ENGINE_PROPERTIES = [
  {
    name: "probe-refusal-writes-nothing",
    group: "engine",
    title: "engine self-test: a planted partial write on the refusal path is found and shrunk to n = 2",
    workflow: PROBE_FIXTURE,
    args: (runRoot) => `--store ${runRoot}`,
    gen: genStoreSpec({ mutationNames: [], probeMax: 4 }),
    cover: [{ label: "reason=needs-input", minPct: 10 }],
    property(ctx) {
      const { report } = ctx;
      ctx.classify(`reason=${report.reason}`);
      if (report.reason === "ok") return "accepted";
      if (!sameTree(report.snapshot.before, report.snapshot.after)) {
        throw new PropertyViolation(`refusal ${report.reason} wrote to the store (probe n=${ctx.spec.probe?.n})`);
      }
      return "refused-clean";
    },
  },
  {
    name: "probe-clean-run-accepts",
    group: "engine",
    title: "engine self-test: a property that holds reports no failures and full coverage",
    workflow: PROBE_FIXTURE,
    args: (runRoot) => `--store ${runRoot}`,
    gen: genStoreSpec({ mutationNames: [], probeMax: 1 }),
    cover: [{ label: "probe=0", minPct: 1 }],
    property(ctx) {
      const { report } = ctx;
      ctx.classify(`reason=${report.reason}`);
      if (report.reason !== "ok") throw new PropertyViolation(`expected ok for probe n<=1, got ${report.reason}`);
      if (!sameTree(report.snapshot.before, report.snapshot.after)) throw new PropertyViolation("an accept is not a clean write");
      return `ok(probe=${ctx.spec.probe?.n})`;
    },
  },
];

export const PROPERTY_GROUPS = {
  engine: ENGINE_PROPERTIES,
  "p0-pack": PACK_PROPERTIES,
};

export function allProperties() {
  return Object.values(PROPERTY_GROUPS).flat();
}

export function findProperty(name) {
  return allProperties().find((def) => def.name === name) ?? null;
}

export function groupProperties(group) {
  const defs = PROPERTY_GROUPS[group];
  if (!defs) throw new Error(`unknown property group: ${group} (expected ${Object.keys(PROPERTY_GROUPS).join(", ")})`);
  return defs;
}
