// workflows/test/prop/render.mjs — StoreSpec -> on-disk store, and one driven trial.
//
// Rendering is byte-deterministic: the same spec always produces the same store tree, so a
// counterexample JSON is enough to replay a failure. Driving reuses the case runner, so a
// generated trial yields the same report shape as a hand-written case (result digest, exit
// record, store snapshots, transcript types).
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { cleanupTempDirs, writeJson } from "../../../kernel/tools/verify-testkit.mjs";
import { runCase } from "../casekit.mjs";
import { syntheticStream } from "../streams.mjs";
import { applyMutations } from "./mutations.mjs";

/**
 * Materialize `spec` at `<caseDir>/run` (replacing any earlier run) and return `{runRoot}` in
 * the shape casekit's `prepare` expects.
 */
export function renderStore(spec, caseDir) {
  const runRoot = path.join(caseDir, "run");
  rmSync(runRoot, { recursive: true, force: true });
  const origin = syntheticStream("prop", { boxes: spec.boxes });
  try {
    cpSync(origin, runRoot, { recursive: true });
  } finally {
    cleanupTempDirs();
  }
  applyMutations(runRoot, spec.mutations);
  if (spec.probe !== undefined) writeJson(runRoot, ".probe.json", spec.probe);
  return { runRoot };
}

/** The case spec a generated store is driven through: one run, no sealed expectations. */
export function storeCaseSpec(spec, { workflow, args, id = "prop-trial" }) {
  return {
    id,
    group: "prop",
    title: `generated store (${spec.boxes} box, ${spec.mutations.length} mutation(s))`,
    workflow,
    prepare: (caseDir) => renderStore(spec, caseDir),
    args: (runRoot, overrides) => (typeof args === "function" ? args(runRoot, overrides) : args),
    purity: false,
  };
}

/** Drive one generated store; returns the case report plus the spec that produced it. */
export function driveStoreSpec(spec, { workflow, args, driver = "stub", caseDir, timeoutMs = 600_000 } = {}) {
  const report = runCase(storeCaseSpec(spec, { workflow, args }), { driver, caseDir, reruns: 1, timeoutMs });
  return { spec, report };
}

/**
 * Drive an existing store without rendering: the idempotence/resume primitive. The store is
 * never reset, so a property can observe what a second run does to an already-complete store.
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
