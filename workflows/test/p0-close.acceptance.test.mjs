// workflows/test/p0-close.acceptance.test.mjs — frozen-baseline acceptance (opt-in tier).
//
// Replays the captured run store (proposal §5): run the draft on a scratch copy of the
// store and require the draft, envelope and all 12 p05 records to be byte-equal to the
// original pins. This is the only case that depends on an external artifact
// ($CURE_LIGHT_BASELINE_STORE or the known workspace path); it skips when the store is
// absent, which is why it is kept out of the fast tier.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { artifactSha, cleanupTempDirs } from "../../kernel/tools/verify-testkit.mjs";
import { baselineStream } from "./streams.mjs";
import { runDraft } from "./p0-close-testkit.mjs";

after(cleanupTempDirs);

describe("p0-close acceptance", () => {
  it("reproduces the captured baseline store byte-for-byte", (t) => {
    let stream;
    try { stream = baselineStream(); } catch (problem) { t.skip(`baseline store unavailable: ${problem.message}`); return; }
    const { runRoot, pins } = stream;
    const result = runDraft(runRoot, {
      allowOverwrite: true,
      operatorRef: "operator:grzegorznowak/pr72-s1",
      runId: "chunkhound/pi-schematic#72",
      reviewState: "s1",
    });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "ok", `exit=${JSON.stringify(result.exit)}`);
    assert.equal(artifactSha(runRoot, "join/join-draft.v1.json"), pins.draft, "join draft differs");
    assert.equal(artifactSha(runRoot, "run-manifest.json"), pins.envelope, "envelope differs");
    for (const [name, expected] of Object.entries(pins.p05)) {
      assert.equal(artifactSha(runRoot, `join/${name}`), expected, `p05 differs: ${name}`);
    }
  });
});
