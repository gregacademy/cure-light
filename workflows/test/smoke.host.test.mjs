// workflows/test/smoke.host.test.mjs — host-tier self-test (opt-in): proves the harness
// really drives the installed pi CLI and that the stub host and the real host agree.
//
// The fixture (`fixtures/smoke-echo.js`) is deterministic, uses no model turns and touches
// only the store handed to it in `--store`, so it is the plumbing proof for everything the
// harness observes: the verbatim args string, shell I/O, artifact bytes, the checkpoint,
// the exit payload, the transcript records and the purity rerun digest.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupTempDirs } from "../../kernel/tools/verify-testkit.mjs";
import { SMOKE_CASES } from "./cases.mjs";
import { runCase } from "./casekit.mjs";

after(cleanupTempDirs);

describe("host harness (real pi CLI)", () => {
  for (const spec of SMOKE_CASES) {
    let hostDigest = null;

    it(`${spec.id}: runs through the real host with a stable result`, () => {
      const hostReport = runCase(spec, { driver: "host" });
      assert.equal(hostReport.ok, true, hostReport.failure ?? JSON.stringify(hostReport.checks));
      assert.equal(hostReport.error, null, `host-level error: ${hostReport.error} (${hostReport.paths.caseDir})`);
      if (spec.purity !== false) {
        assert.equal(hostReport.purity?.equal, true, "two host runs produced different result digests");
      }
      assert.equal(hostReport.usage.turns, 0, "the fixture must not spend model turns");
      assert.ok(hostReport.exit, "no workflow-exit record was captured");
      hostDigest = hostReport.resultDigest;
    });

    it(`${spec.id}: the stub host and the real host agree on the canonical result`, () => {
      const stub = runCase(spec, { driver: "stub" });
      assert.equal(stub.ok, true, stub.failure ?? JSON.stringify(stub.checks));
      assert.ok(hostDigest, "the host run did not produce a digest");
      assert.equal(
        stub.resultDigest,
        hostDigest,
        "host-independent purity broken: the same case digest differs between the stub host and the real host",
      );
    });
  }
});
