// workflows/pack/test/streams.test.mjs — fixture sanity tier (fast, green).
//
// Verifies that the input streams in workflows/pack/fixtures/streams.mjs really are what the
// contract and acceptance tiers assume: a complete pre-pack store, materializable fault
// variants, and a baseline copy whose input pins match the recorded store. A red contract
// tier on top of a broken stream would be noise, so this tier is green before p0-pack lands.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { artifactSha, cleanupTempDirs, readBytes, readJson, snapshotTree } from "../../../kernel/tools/verify-testkit.mjs";
import { BASELINE_STORE_DEFAULT, baselineStream, FAULT_NAMES, packStream } from "../fixtures/streams.mjs";

after(cleanupTempDirs);

describe("p0-pack input streams", () => {
  it("synthetic stream is a complete pre-pack store", () => {
    const runRoot = packStream("meta");
    const required = [
      "claims/sources/capture-manifest.json",
      "claims/claims-draft.v3.json",
      "units/units2/manifest.json",
    ];
    for (const rel of required) assert.ok(existsSync(path.join(runRoot, rel)), `missing ${rel}`);
    assert.ok(!existsSync(path.join(runRoot, "join")), "join/ must not pre-exist in a fresh stream");
    const manifest = readJson(runRoot, "units/units2/manifest.json");
    const unitsDir = path.join(runRoot, "units", "units2");
    for (const unit of manifest.units) {
      const abs = path.join(unitsDir, path.basename(unit.file));
      assert.ok(existsSync(abs), `missing payload ${unit.unit_id}`);
      assert.equal(readBytes(runRoot, path.posix.join("units/units2", path.basename(unit.file))).length, unit.byte_len, `payload size differs: ${unit.unit_id}`);
    }
    const draft = readJson(runRoot, "claims/claims-draft.v3.json");
    assert.ok(draft.claims.length > 0);
  });

  it("fault variants materialize without losing the rest of the input store", () => {
    // Each fault removes or edits exactly its target; everything else stays materialized.
    const removals = {
      "missing-claims": "claims/claims-draft.v3.json",
      "missing-manifest": "units/units2/manifest.json",
      "missing-payload": "units/units2/u0000.txt",
      "missing-capture": "claims/sources/capture-manifest.json",
    };
    for (const fault of FAULT_NAMES) {
      const runRoot = packStream(`meta-${fault}`, { fault });
      const removed = removals[fault] ?? null;
      for (const rel of [
        "claims/claims-draft.v3.json",
        "units/units2/manifest.json",
        "claims/sources/capture-manifest.json",
        "units/units2/u0000.txt",
      ]) {
        if (rel === removed) assert.ok(!existsSync(path.join(runRoot, rel)), `fault ${fault} kept ${rel}`);
        else assert.ok(existsSync(path.join(runRoot, rel)), `fault ${fault} lost ${rel}`);
      }
      if (fault === "preexisting-claims-list") assert.equal(readJson(runRoot, "join/claims-list.json").length, 0);
      if (fault === "stale-box") assert.ok(existsSync(path.join(runRoot, "join/box-0099.assignment.json")));
      assert.ok(snapshotTree(runRoot).length > 0, `fault ${fault} produced an empty store`);
    }
    assert.throws(() => packStream("meta-unknown", { fault: "nope" }), /unknown fault/);
  });

  it("baseline stream copies the recorded store and pins its inputs", (t) => {
    if (!existsSync(BASELINE_STORE_DEFAULT)) {
      const message = `baseline store not found: ${BASELINE_STORE_DEFAULT} (set CURE_LIGHT_BASELINE_STORE)`;
      if (process.env.P0_PACK_ACCEPTANCE_OPTIONAL === "1") {
        t.skip(message);
        return;
      }
      assert.fail(message);
    }
    const stream = baselineStream();
    assert.equal(artifactSha(stream.runRoot, "units/units2/manifest.json"), stream.pins.inputs.manifest);
    assert.equal(artifactSha(stream.runRoot, "claims/claims-draft.v3.json"), stream.pins.inputs.claimsDraft);
    assert.equal(artifactSha(stream.runRoot, "join/claims-list.json"), stream.pins.claimsList);
    assert.equal(Object.keys(stream.pins.assignments).length, 6, "expected 6 boxes");
    assert.equal(Object.keys(stream.pins.instructions).length, 6, "expected 6 instruction pins");
  });
});
