// workflows/pack/test/contract.test.mjs — the red-first executable specification for
// workflows/pack/p0-pack.js (fast tier, stub host).
//
// Every case was authored BEFORE the draft exists; until it lands each one fails with
// `workflow draft missing: …/workflows/pack/p0-pack.js`. Once the draft is green the same
// cases become the regression suite. Scope: the synthetic pre-pack stream and its fault
// variants — exit reasons, artifact contract, corrected instruction render, refusal
// invariants.
//
// The cases are the shared table in cases.mjs, so the host tier (host.test.mjs, opt-in)
// replays the identical inputs and oracle through the real pi CLI. Do not add assertions
// here: add them to the case in cases.mjs.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupTempDirs } from "../../../kernel/tools/verify-testkit.mjs";
import { PACK_CASES } from "../cases.mjs";
import { runCase } from "../../testkit/casekit.mjs";

after(cleanupTempDirs);

describe("p0-pack (stub host)", () => {
  for (const spec of PACK_CASES) {
    it(spec.title, () => {
      const report = runCase(spec, { driver: "stub" });
      assert.equal(report.ok, true, report.failure ?? JSON.stringify(report.checks));
    });
  }
});
