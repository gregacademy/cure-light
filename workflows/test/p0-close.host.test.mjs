// workflows/test/p0-close.host.test.mjs — the same sealed p0-close cases, driven through the
// real pi CLI (opt-in host tier).
//
// Red-first like the fast tier: until workflows/p0/p0-close.js exists every case fails with
// `workflow draft missing`. Once it lands, this tier proves the draft behaves identically
// under the real host — including the purity rerun (two runs from the same initial state
// must produce the same reason, exit payload and artifact tree).
//
// Run it explicitly:
//   node workflows/test/run.mjs host
//   node workflows/test/host-run.mjs p0-close --driver host --json
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupTempDirs } from "../../kernel/tools/verify-testkit.mjs";
import { P0_CLOSE_BASELINE_CASE, P0_CLOSE_CASES } from "./cases.mjs";
import { runCase } from "./casekit.mjs";

after(cleanupTempDirs);

describe("p0-close (real pi CLI)", () => {
  for (const spec of P0_CLOSE_CASES) {
    it(spec.title, () => {
      const report = runCase(spec, { driver: "host" });
      assert.equal(report.ok, true, `${report.failure} (case dir: ${report.paths.caseDir})`);
      assert.equal(report.usage.turns, 0, "p0-close must stay a model-free workflow");
      if (spec.purity !== false) {
        assert.equal(report.purity?.equal, true, `rerun digests differ (${report.paths.caseDir})`);
      }
    });
  }

  it(P0_CLOSE_BASELINE_CASE.title, (t) => {
    const report = runCase(P0_CLOSE_BASELINE_CASE, { driver: "host" });
    if (report.skipped) {
      t.skip(report.skipped);
      return;
    }
    assert.equal(report.ok, true, `${report.failure} (case dir: ${report.paths.caseDir})`);
    assert.equal(report.purity?.equal, true, "baseline replay digests differ between runs");
  });
});
