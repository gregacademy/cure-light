// workflows/pack/test/prop.test.mjs — generated-input properties for p0-pack (opt-in `prop` tier).
//
// Where the contract tier drives hand-picked faults, this tier drives the *generated* input
// space: random mutation programs over synthetic pre-pack stores, checked against invariants
// that need no oracle (a refusal writes nothing; an accept is a complete ordered partition
// under the ceiling; resume skips every target; the corrected path is rendered). A
// counterexample is printed with its shrunk form and a replay command — promote it into the
// sealed case table when it must never regress.
//
// The draft exists, so this tier is green by construction of the properties; the red-first
// signal lives in the sealed contract tier.
//
//   node workflows/run.mjs prop
//   node workflows/pack/prop-run.mjs p0-pack --cases 10 --driver stub --json
//   PROP_DRIVER=host PROP_CASES=3 node --test workflows/pack/test/prop.test.mjs
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupTempDirs } from "../../../kernel/tools/verify-testkit.mjs";
import { PACK_PROPERTIES } from "../prop/catalog.mjs";
import { runProperty } from "../prop/runner.mjs";

after(cleanupTempDirs);

const DRIVER = process.env.PROP_DRIVER ?? "stub";
const CASES = Number(process.env.PROP_CASES ?? (DRIVER === "host" ? 3 : 10));

describe(`p0-pack properties (${DRIVER} host)`, () => {
  for (const def of PACK_PROPERTIES) {
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
