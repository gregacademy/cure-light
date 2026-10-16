// workflows/test/p0-close.prop.test.mjs — generated-input properties for p0-close (opt-in `prop` tier).
//
// Where the contract tier drives hand-picked faults, this tier drives the *generated* input
// space: random mutation programs over the synthetic store, checked against invariants that
// need no oracle (a refusal writes nothing; an accept is complete and verifiable; the digest
// is stable; the merge is packing-invariant). A counterexample is printed with its shrunk
// form and a replay command — promote it into the sealed case table when it must never regress.
//
// Red-first: until workflows/p0/p0-close.js exists every property reports `skipped`, and this
// file skips with that reason. The sealed contract tier carries the red signal.
//
//   node workflows/test/run.mjs prop
//   node workflows/test/prop-run.mjs p0-close --cases 10 --driver stub --json
//   PROP_DRIVER=host PROP_CASES=4 node --test workflows/test/p0-close.prop.test.mjs
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupTempDirs } from "../../kernel/tools/verify-testkit.mjs";
import { P0_CLOSE_PROPERTIES } from "./prop/catalog.mjs";
import { runProperty } from "./prop/runner.mjs";

after(cleanupTempDirs);

const DRIVER = process.env.PROP_DRIVER ?? "stub";
const CASES = Number(process.env.PROP_CASES ?? (DRIVER === "host" ? 3 : 10));

describe(`p0-close properties (${DRIVER} host)`, () => {
  for (const def of P0_CLOSE_PROPERTIES) {
    it(def.title, (t) => {
      const report = runProperty(def, { cases: CASES, seed: Number(process.env.PROP_SEED ?? 20261016), driver: DRIVER });
      if (report.skipped) {
        t.skip(report.skipped);
        return;
      }
      assert.equal(report.infraError, null, `infrastructure error: ${report.infraError}`);
      const failure = report.failures[0];
      const detail = failure
        ? `${failure.detail}\n  counterexample: ${failure.description}\n  shrunk: ${failure.shrunk?.description}\n  replay: ${failure.replay.minimal?.bySpec ?? failure.replay.initial.bySeed}\n  evidence: ${report.paths.caseRoot}`
        : report.coverage.checks.filter((check) => !check.ok).map((check) => `cover ${check.label}: ${check.actualPct}% < ${check.minPct}%`).join("\n");
      assert.equal(report.ok, true, detail);
      assert.ok(report.trials > 0, "no trial ran");
    });
  }
});
