// workflows/test/prop/catalog.mjs — the property table: generated-input properties for the
// workflows under test, plus the engine's own self-tests.
//
// A property is data:
//   {name, group, title, workflow, args, property(ctx), gen?, shrink?, cover?, note?}
// `ctx` exposes the driven store report, `classify(label)`, the metamorphic sibling run
// (`ctx.run(spec)`) and the idempotence rerun of the SAME store (`ctx.rerun(overrides)`).
//
// Properties are chosen so they need no oracle: they are invariants (refusal writes nothing,
// accept is complete and verifiable, the digest is stable) or relations (packing invariance,
// resume never rewrites different bytes). The mutation registry supplies the input space and
// its sealed expectations, so a generated program is the fault matrix generalized.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactSha, readJson, runVerifier } from "../../../kernel/tools/verify-testkit.mjs";
import { DRAFT, workflowArgs } from "../p0-close-testkit.mjs";
import { genStoreSpec } from "./spec.mjs";
import { describeMutations, expectedReason, unpinnedMutations } from "./mutations.mjs";
import { PropertyViolation } from "./runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE_FIXTURE = path.join(HERE, "..", "fixtures", "probe-mark.js");

/** The only exit reasons the core may author (README: reserved tokens are never authored). */
export const AUTHORED_REASONS = ["ok", "needs-input", "evidence-failed", "verifier-pin-mismatch", "validation-failed", "frozen-artifact"];

/** Every output a successful close must leave behind, derived from the store's own boxes. */
export function acceptedOutputs(runRoot) {
  const outputs = ["join/join-draft.v1.json", "run-manifest.json", "run-manifest.json.sha256"];
  for (const name of readdirSync(path.join(runRoot, "join"))) {
    if (/^box-.*\.jsonl$/.test(name)) {
      const boxId = name.replace(/\.jsonl$/, "");
      outputs.push(`join/${boxId}.p05-check.json`, `join/${boxId}.p05-evidence.json`);
    }
  }
  return outputs;
}

function outputHashes(runRoot) {
  const hashes = {};
  for (const rel of acceptedOutputs(runRoot)) hashes[rel] = existsSync(path.join(runRoot, rel)) ? artifactSha(runRoot, rel) : null;
  return hashes;
}

const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------ p0-close properties ----

export const P0_CLOSE_PROPERTIES = [
  {
    name: "refuse-leaves-the-store-untouched",
    group: "p0-close",
    title: "a refusal never writes to the store (no partial state on any failure path)",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
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
    name: "reason-is-authored",
    group: "p0-close",
    title: "every run answers with one of the six authored exit reasons",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
    property(ctx) {
      const reason = ctx.report.reason;
      ctx.classify(`reason=${reason}`);
      if (!AUTHORED_REASONS.includes(reason)) throw new PropertyViolation(`unauthored exit reason: ${JSON.stringify(reason)}`);
      return reason;
    },
  },
  {
    name: "accept-implies-complete-and-verifiable",
    group: "p0-close",
    title: "an accepted run leaves every output behind and passes `verify join`",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
    property(ctx) {
      const { report } = ctx;
      if (report.reason !== "ok") return `refused=${report.reason}`;
      const runRoot = report.paths.runRoot;
      const missing = acceptedOutputs(runRoot).filter((rel) => !existsSync(path.join(runRoot, rel)));
      if (missing.length > 0) throw new PropertyViolation(`accepted run left ${missing.length} output(s) missing: ${missing.join(", ")}`);
      const verdict = runVerifier(["join", "--run", runRoot], { runRoot });
      if (verdict.verdict?.ok !== true) throw new PropertyViolation(`verify join failed after an accepted run: ${verdict.verdict?.summary ?? verdict.parseError ?? verdict.stderr.slice(0, 200)}`);
      return "accepted+verified";
    },
  },
  {
    name: "mutation-program-reaches-its-sealed-reason",
    group: "p0-close",
    title: "every mutation program reaches the reason the sealed spec pins for it",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
    note: "programs containing an unpinned mutation (D4-style ambiguity) are classified, not asserted",
    property(ctx) {
      const expected = expectedReason(ctx.spec.mutations);
      const reason = ctx.report.reason;
      ctx.classify(`reason=${reason}`);
      if (expected === null) {
        // Unpinned programs are classified, never asserted. The layering keeps them honest:
        // `reason-is-authored` still rejects a token outside the six, and
        // `refuse-leaves-the-store-untouched` still rejects a refusal that wrote.
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
    group: "p0-close",
    title: "an accepted run re-derived from the same state reproduces its whole result",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const sibling = ctx.run(ctx.spec);
      if (sibling.reason !== "ok") throw new PropertyViolation(`rerun from the same state refused with ${sibling.reason}`);
      if (sibling.resultDigest !== ctx.report.resultDigest) {
        throw new PropertyViolation(`result digest changed between identical runs (${ctx.report.resultDigest?.slice(0, 12)} != ${sibling.resultDigest?.slice(0, 12)})`);
      }
      return "digest-stable";
    },
  },
  {
    name: "packing-invariance",
    group: "p0-close",
    title: "the merged unit set does not depend on how the units were packed into boxes",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
    note: "compares only accepts; a refusal on either packing is reported, not asserted",
    property(ctx) {
      const other = ctx.run({ ...ctx.spec, boxes: ctx.spec.boxes === 1 ? 2 : 1 });
      if (ctx.report.reason !== "ok" || other.reason !== "ok") return `skip(${ctx.report.reason}/${other.reason})`;
      const left = readJson(ctx.report.paths.runRoot, "join/join-draft.v1.json");
      const right = readJson(other.paths.runRoot, "join/join-draft.v1.json");
      assert.deepEqual(
        left.units.map((row) => row.unit_id),
        right.units.map((row) => row.unit_id),
        "unit order differs between packings",
      );
      assert.deepEqual(left.units, right.units, "merged rows differ between packings");
      assert.deepEqual(left.candidate_unclaimed, right.candidate_unclaimed);
      return "packing-invariant";
    },
  },
  {
    name: "resume-never-rewrites-different-bytes",
    group: "p0-close",
    title: "a second run over an already-complete store either refuses or reproduces identical bytes",
    workflow: DRAFT,
    args: (runRoot) => workflowArgs(runRoot),
    property(ctx) {
      if (ctx.report.reason !== "ok") return `refused=${ctx.report.reason}`;
      const runRoot = ctx.report.paths.runRoot;
      const before = outputHashes(runRoot);
      const rerun = ctx.rerun();
      const after = outputHashes(runRoot);
      if (rerun.reason === "ok") {
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new PropertyViolation("a second run rewrote outputs to different bytes");
        return "idempotent-rewrite";
      }
      if (rerun.reason !== "frozen-artifact") throw new PropertyViolation(`a second run refused with ${rerun.reason}, expected ok or frozen-artifact`);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new PropertyViolation("a refused second run changed the outputs");
      return "refused-frozen-artifact";
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
  "p0-close": P0_CLOSE_PROPERTIES,
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
