// workflows/pack/test/acceptance.test.mjs — corrected-render acceptance (opt-in tier).
//
// Replays the recorded s1 store (SPEC §Outputs) on a scratch copy whose `join/` is deleted:
// the replay generates all 13 dispatch artifacts from the recorded inputs instead of
// overwriting a populated copy (the strict overwrite guard refuses while child/p05 artifacts
// exist). `--child-store` stays the recorded store path, so the pins describe the same
// corrected render. The recorded store's own instruction files carry the known payload-path
// defect (`<source>/units2/` instead of `<source>/units/units2/`); one test proves the pins
// are exactly those recorded bytes plus that single path fix, and the other proves the
// engine reproduces them.
//
// This is the only case that depends on an external artifact ($CURE_LIGHT_BASELINE_STORE or
// the known workspace path). A missing store FAILS the tier; set
// P0_PACK_ACCEPTANCE_OPTIONAL=1 to skip it explicitly in an environment without the store.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { artifactSha, cleanupTempDirs, sha256 } from "../../../kernel/tools/verify-testkit.mjs";
import { BASELINE_STORE_DEFAULT, baselineStream } from "../fixtures/streams.mjs";
import { runDraft } from "../testkit.mjs";

after(cleanupTempDirs);

const OPTIONAL = process.env.P0_PACK_ACCEPTANCE_OPTIONAL === "1";

/** Load the baseline copy or fail (unless the explicit opt-out is set). */
function requireBaseline(t) {
  if (!existsSync(BASELINE_STORE_DEFAULT)) {
    const message = `baseline store not found: ${BASELINE_STORE_DEFAULT} (set CURE_LIGHT_BASELINE_STORE)`;
    if (OPTIONAL) {
      t.skip(message);
      return null;
    }
    assert.fail(message);
  }
  return baselineStream();
}

describe("p0-pack acceptance", () => {
  it("pins are the recorded instruction bytes plus exactly the payload-path fix", (t) => {
    const stream = requireBaseline(t);
    if (!stream) return;
    const { source, pins } = stream;
    const boxIds = Object.keys(pins.instructions).sort();
    assert.equal(boxIds.length, 6, "expected 6 instruction pins");
    for (const boxId of boxIds) {
      const recorded = readFileSync(path.join(source, "join", `${boxId}.instructions.md`), "utf8");
      assert.ok(recorded.includes(`${source}/units2/`), `recorded ${boxId} does not carry the defect path`);
      const corrected = recorded.split(`${source}/units2/`).join(`${source}/units/units2/`);
      assert.equal(corrected.includes(`${source}/units2/`), false, `path fix left a defect occurrence in ${boxId}`);
      assert.equal(
        sha256(Buffer.from(corrected, "utf8")),
        pins.instructions[boxId],
        `pin is not the recorded bytes plus the path fix: ${boxId}`,
      );
    }
  });

  it("reproduces the recorded s1 inputs as the corrected render (13 outputs)", (t) => {
    const stream = requireBaseline(t);
    if (!stream) return;
    const { runRoot, source, pins } = stream;
    // Replay starts from an empty join/: generate all outputs from the recorded inputs.
    rmSync(path.join(runRoot, "join"), { recursive: true, force: true });
    const result = runDraft(runRoot, { ceiling: pins.ceiling, childStore: source });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "ok", `exit=${JSON.stringify(result.exit)}`);
    assert.equal(result.exit?.claims_list_sha256, pins.claimsList);
    assert.equal(artifactSha(runRoot, "join/claims-list.json"), pins.claimsList, "claims-list differs");
    for (const [boxId, expected] of Object.entries(pins.assignments)) {
      assert.equal(artifactSha(runRoot, `join/${boxId}.assignment.json`), expected, `assignment differs: ${boxId}`);
      assert.equal(result.exit?.boxes?.find((entry) => entry.box_id === boxId)?.assignment_sha256, expected, `exit assignment sha differs: ${boxId}`);
    }
    for (const [boxId, expected] of Object.entries(pins.instructions)) {
      assert.equal(artifactSha(runRoot, `join/${boxId}.instructions.md`), expected, `instructions differ: ${boxId}`);
    }
    assert.equal(result.exit?.boxes?.length, 6, "expected 6 boxes in the exit payload");
    assert.equal(result.exit?.promoted?.length, 13, "replay must generate all 13 outputs");
  });
});
