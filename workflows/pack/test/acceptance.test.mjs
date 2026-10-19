// workflows/pack/test/acceptance.test.mjs — corrected-render acceptance (opt-in tier).
//
// Replays the recorded s1 store (SPEC §Outputs) on a scratch copy whose `join/` is deleted:
// the replay generates all 13 dispatch artifacts from the recorded inputs instead of
// overwriting a populated copy (the strict overwrite guard refuses while child/p05 artifacts
// exist). `--child-store` stays the recorded store path, so the pins describe the same
// corrected render. The recorded store's own instruction files carry the known payload-path
// defect (`<source>/units2/` instead of `<source>/units/units2/`); one test proves the pins
// are exactly those recorded bytes plus that path fix and the 2026-10-19 witness-clause
// correction (line-boundary rule), and the other proves the engine reproduces them.
//
// This is the only case that depends on an external artifact ($CURE_LIGHT_BASELINE_STORE or
// the known workspace path). A missing store FAILS the tier; set
// P0_PACK_ACCEPTANCE_OPTIONAL=1 to skip it explicitly in an environment without the store.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { artifactSha, cleanupTempDirs, readJson, sha256 } from "../../../kernel/tools/verify-testkit.mjs";
import { BASELINE_STORE_DEFAULT, baselineStream } from "../fixtures/streams.mjs";
import { runDraft } from "../testkit.mjs";

after(cleanupTempDirs);

const OPTIONAL = process.env.P0_PACK_ACCEPTANCE_OPTIONAL === "1";

const RECORDED_WITNESS_RULE = "Witness: nonempty verbatim fragment from THIS unit's file, include its diff marker, single line, <=160 characters; never quote another unit.";
const CORRECTED_WITNESS_RULE = "Witness: nonempty verbatim fragment from THIS unit's file, starting at a line boundary (payload byte 0 or directly after a newline) with a real diff marker (`+`, `-`, a context space, or `@@ `), single line, <=160 Unicode code points; never quote another unit. File metadata units also accept their recognized metadata prefixes.";

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

// The corrected witness clause adds fixed input. On the recorded s1 store this moves the
// greedy boundary: u0293 leaves box-0004 and joins box-0005. Those two instruction pins
// are the corrected render for the moved unit set, re-proved by the replay test below.
const MOVED_BY_FIXED_INPUT = new Set(["box-0004", "box-0005"]);

describe("p0-pack acceptance", () => {
  it("pins are the recorded instruction bytes plus the two fixes where the unit set is unchanged", (t) => {
    const stream = requireBaseline(t);
    if (!stream) return;
    const { source, pins } = stream;
    const boxIds = Object.keys(pins.instructions).sort();
    assert.equal(boxIds.length, 6, "expected 6 instruction pins");
    for (const boxId of boxIds) {
      if (MOVED_BY_FIXED_INPUT.has(boxId)) continue;
      const recorded = readFileSync(path.join(source, "join", `${boxId}.instructions.md`), "utf8");
      assert.ok(recorded.includes(`${source}/units2/`), `recorded ${boxId} does not carry the defect path`);
      assert.ok(recorded.includes(RECORDED_WITNESS_RULE), `recorded ${boxId} does not carry the recorded witness rule`);
      const corrected = recorded
        .split(`${source}/units2/`).join(`${source}/units/units2/`)
        .split(RECORDED_WITNESS_RULE).join(CORRECTED_WITNESS_RULE);
      assert.equal(corrected.includes(`${source}/units2/`), false, `path fix left a defect occurrence in ${boxId}`);
      assert.equal(corrected.includes(RECORDED_WITNESS_RULE), false, `witness fix left the old rule in ${boxId}`);
      assert.ok(corrected.includes(CORRECTED_WITNESS_RULE), `witness fix did not apply in ${boxId}`);
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
    // The witness clause adds fixed input, so the greedy boundary moves the last unit of
    // box-0004 to the front of box-0005. This is the expected corrected render.
    const recorded4 = readJson(source, "join/box-0004.assignment.json").units;
    const recorded5 = readJson(source, "join/box-0005.assignment.json").units;
    const replayed4 = readJson(runRoot, "join/box-0004.assignment.json").units;
    const replayed5 = readJson(runRoot, "join/box-0005.assignment.json").units;
    assert.deepEqual(replayed4, recorded4.slice(0, -1), "box-0004 should lose its last unit to the corrected fixed input");
    assert.deepEqual(replayed5, [recorded4.at(-1), ...recorded5], "box-0005 should gain the moved unit");
    assert.equal(result.exit?.boxes?.length, 6, "expected 6 boxes in the exit payload");
    assert.equal(result.exit?.promoted?.length, 13, "replay must generate all 13 outputs");
  });
});
