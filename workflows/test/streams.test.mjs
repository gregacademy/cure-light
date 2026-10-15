// workflows/test/streams.test.mjs — fixture sanity tier (fast, green).
//
// Verifies that the two input streams in workflows/test/streams.mjs really are what the
// contract and acceptance tiers assume: a complete pre-close synthetic run, materializable
// fault variants, and a baseline copy whose pins match the captured store. A red contract
// tier on top of a broken stream would be noise, so this tier is green before p0-close lands.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { artifactSha, cleanupTempDirs, readJson } from "../../kernel/tools/verify-testkit.mjs";
import { baselineStream, FAULT_NAMES, syntheticStream } from "./streams.mjs";

after(cleanupTempDirs);

describe("input streams", () => {
  it("synthetic stream is a complete pre-close run", () => {
    const runRoot = syntheticStream("meta");
    const required = [
      "units/units2/manifest.json",
      "claims/claims-draft.v3.json",
      "claims/sources/capture-manifest.json",
      "join/claims-list.json",
      "join/box-0000.jsonl",
      "join/box-0001.jsonl",
      "join/box-0000.assignment.json",
      "join/box-0001.assignment.json",
      "join/box-0000.instructions.md",
      "join/box-0001.instructions.md",
      "join/box-0000.p05-check.json",
      "join/box-0001.p05-check.json",
      "join/box-0000.p05-evidence.json",
      "join/box-0001.p05-evidence.json",
    ];
    for (const rel of required) assert.ok(existsSync(path.join(runRoot, rel)), `missing ${rel}`);
    assert.ok(!existsSync(path.join(runRoot, "join/join-draft.v1.json")), "draft must not pre-exist");
    assert.ok(!existsSync(path.join(runRoot, "run-manifest.json")), "envelope must not pre-exist");
    const manifest = readJson(runRoot, "units/units2/manifest.json");
    const unitsDir = path.join(runRoot, "units", "units2");
    for (const unit of manifest.units) {
      assert.ok(existsSync(path.join(unitsDir, path.basename(unit.file))), `missing payload ${unit.unit_id}`);
    }
  });

  it("fault variants materialize from the synthetic stream", () => {
    for (const fault of FAULT_NAMES) {
      const runRoot = syntheticStream(`meta-${fault}`, { fault });
      assert.ok(existsSync(path.join(runRoot, "join/box-0000.jsonl")), `fault ${fault} lost the box output`);
    }
    assert.throws(() => syntheticStream("meta-unknown", { fault: "nope" }), /unknown fault/);
  });

  it("baseline stream copies the captured store and pins its outputs", (t) => {
    let stream;
    try { stream = baselineStream(); } catch (problem) { t.skip(`baseline store unavailable: ${problem.message}`); return; }
    assert.equal(artifactSha(stream.runRoot, "join/join-draft.v1.json"), stream.pins.draft);
    assert.equal(artifactSha(stream.runRoot, "run-manifest.json"), stream.pins.envelope);
    assert.equal(Object.keys(stream.pins.p05).length, 12, "expected 6 boxes x check+evidence");
  });
});
