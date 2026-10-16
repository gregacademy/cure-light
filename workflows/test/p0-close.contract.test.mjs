// workflows/test/p0-close.contract.test.mjs — the red-first executable specification for
// workflows/p0/p0-close.js (fast tier, stub host).
//
// Every case was authored BEFORE the draft exists; until it lands each one fails with
// `workflow draft missing: .../workflows/p0/p0-close.js`. Once the draft is green the same
// cases become the regression suite. Scope: the synthetic pre-close stream and its fault
// variants — exit reasons, artifact shapes, refusal invariants, the `verify join` boundary.
//
// The cases are the shared table in cases.mjs, so the host tier
// (`p0-close.host.test.mjs`, opt-in) replays the identical inputs and oracle through the
// real pi CLI. Do not add assertions here: add them to the case in cases.mjs.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupTempDirs } from "../../kernel/tools/verify-testkit.mjs";
import { P0_CLOSE_CASES } from "./cases.mjs";
import { runCase } from "./casekit.mjs";

after(cleanupTempDirs);

describe("p0-close (stub host)", () => {
  for (const spec of P0_CLOSE_CASES) {
    it(spec.title, () => {
      const report = runCase(spec, { driver: "stub" });
      assert.equal(report.ok, true, report.failure ?? JSON.stringify(report.checks));
    });
  }
});
