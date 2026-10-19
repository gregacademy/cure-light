// workflows/pack/prop/render.mjs — PackSpec -> on-disk pre-pack store, and one driven trial.
//
// Adapted from workflows/p0/prop/render.mjs: the only semantic change is the materializer —
// a pack spec renders through `packStream` (unit count, payload size), not through the
// p0-close synthetic stream. Rendering stays byte-deterministic: the same spec always
// produces the same store tree, so a counterexample JSON is enough to replay a failure.
// Driving reuses the case runner, so a generated trial yields the same report shape as a
// hand-written case (result digest, exit record, store snapshots, transcript types).
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { cleanupTempDirs, readJson, writeJson } from "../../../kernel/tools/verify-testkit.mjs";
import { runCase } from "../../testkit/casekit.mjs";
import { packStream } from "../fixtures/streams.mjs";
import { applyMutations } from "./mutations.mjs";

// p0-pack derives every path from the store/manifest and the explicit args, so a spec can
// vary unit ids and claim text without changing the invocation string. Both are applied
// after the stream materializes and before mutations run (a mutation must see the varied
// inputs). Unit ids are restricted to the generated safe alphabet: whitespace, control
// characters and path separators would make the instruction render ambiguous.
const SAFE_UNIT_ID = /^[A-Za-z0-9._-]+$/;

function applyInputVariation(runRoot, spec) {
  if (Array.isArray(spec.unitIds) && spec.unitIds.length > 0) {
    const manifest = readJson(runRoot, "units/units2/manifest.json");
    const limit = Math.min(spec.unitIds.length, manifest.units.length);
    for (let index = 0; index < limit; index++) {
      const unitId = spec.unitIds[index];
      if (typeof unitId !== "string" || !SAFE_UNIT_ID.test(unitId)) {
        throw new Error(`generated unit id is not safe: ${JSON.stringify(unitId)}`);
      }
      manifest.units[index].unit_id = unitId;
    }
    writeJson(runRoot, "units/units2/manifest.json", manifest);
  }
  if (spec.claimStatement !== undefined) {
    const draft = readJson(runRoot, "claims/claims-draft.v3.json");
    if (!Array.isArray(draft.claims) || draft.claims.length === 0) throw new Error("generated claim statement has no claim to replace");
    draft.claims[0].statement = spec.claimStatement;
    writeJson(runRoot, "claims/claims-draft.v3.json", draft);
  }
}

/**
 * Materialize `spec` at `<caseDir>/run` (replacing any earlier run) and return `{runRoot}` in
 * the shape casekit's `prepare` expects. The ceiling is an explicit workflow flag, not a
 * store fact: the runner supplies it through the args function (see `runner.mjs`).
 */
export function renderStore(spec, caseDir) {
  const runRoot = path.join(caseDir, "run");
  rmSync(runRoot, { recursive: true, force: true });
  const origin = packStream("prop", { unitCount: spec.units, unitBytes: spec.unitBytes });
  try {
    cpSync(origin, runRoot, { recursive: true });
  } finally {
    cleanupTempDirs();
  }
  applyInputVariation(runRoot, spec);
  applyMutations(runRoot, spec.mutations);
  if (spec.probe !== undefined) writeJson(runRoot, ".probe.json", spec.probe);
  return { runRoot };
}

/** The case spec a generated store is driven through: one run, no sealed expectations. */
export function storeCaseSpec(spec, { workflow, args, id = "prop-trial" }) {
  return {
    id,
    group: "prop",
    title: `generated pack store (${spec.units} unit(s), ceiling ${spec.ceiling}, ${spec.mutations.length} mutation(s))`,
    workflow,
    prepare: (caseDir) => renderStore(spec, caseDir),
    args: (runRoot, overrides) => (typeof args === "function" ? args(runRoot, overrides) : args),
    // One generated store, one run: no host rerun here. The exit payload still carries the
    // run-scoped evidence path, so declare it volatile exactly as the sealed cases do.
    purity: { ignore: ["paths"] },
  };
}

/** Drive one generated store; returns the case report plus the spec that produced it. */
export function driveStoreSpec(spec, { workflow, args, driver = "stub", caseDir, timeoutMs = 600_000 } = {}) {
  const report = runCase(storeCaseSpec(spec, { workflow, args }), { driver, caseDir, reruns: 1, timeoutMs });
  return { spec, report };
}

/**
 * Drive an existing store without rendering: the idempotence/resume primitive. The store is
 * never reset, so a property can observe what a second run does to an already-packed store.
 */
export function driveExistingStore(runRoot, { workflow, args, driver = "stub", caseDir, timeoutMs = 600_000 } = {}) {
  const spec = {
    id: "prop-rerun",
    group: "prop",
    title: "existing store",
    workflow,
    prepare: () => ({ runRoot }),
    args: (root, overrides) => (typeof args === "function" ? args(root, overrides) : args),
    purity: false,
  };
  return runCase(spec, { driver, caseDir, reruns: 1, timeoutMs });
}
