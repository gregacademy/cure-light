// workflows/test/prop-engine.prop.test.mjs — the property engine's self-test (opt-in `prop` tier).
//
// The engine is only trustworthy if it (a) generates replayable stores, (b) finds a planted
// violation, (c) shrinks it to a minimal counterexample, (d) replays that counterexample, and
// (e) reports coverage and discards honestly. Every check below runs against the probe fixture
// (`fixtures/probe-mark.js`), which needs no draft and no model turn, so it is green today.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTempDirs, snapshotTree } from "../../kernel/tools/verify-testkit.mjs";
import { findProperty } from "./prop/catalog.mjs";
import { sample } from "./prop/gen.mjs";
import { MUTATION_NAMES, MUTATIONS } from "./prop/mutations.mjs";
import { renderStore } from "./prop/render.mjs";
import { runProperty, runSingleSpec } from "./prop/runner.mjs";
import { makeRng, trialSeed } from "./prop/rng.mjs";
import { canonicalSpec, genStoreSpec } from "./prop/spec.mjs";

after(cleanupTempDirs);

const sha = (tree) => tree.map((entry) => `${entry.rel}:${entry.sha256}`).join("|");

describe("property engine", () => {
  it("renders the same spec to the same store bytes", () => {
    const gen = genStoreSpec();
    for (const seed of [1, 2, 3]) {
      const spec = sample(gen, makeRng(trialSeed(seed, 0)));
      const left = mkdtempSync(path.join(os.tmpdir(), "cure-light-render-a-"));
      const right = mkdtempSync(path.join(os.tmpdir(), "cure-light-render-b-"));
      const a = renderStore(spec, left).runRoot;
      const b = renderStore(spec, right).runRoot;
      assert.equal(sha(snapshotTree(a)), sha(snapshotTree(b)), `render of ${canonicalSpec(spec)} is not deterministic`);
      assert.equal(spec.boxes === 2 ? 2 : 1, snapshotTree(a).filter((entry) => /^join\/box-.*\.jsonl$/.test(entry.rel)).length);
      rmSync(left, { recursive: true, force: true });
      rmSync(right, { recursive: true, force: true });
    }
  });

  it("derives the same trial sequence from the same run seed", () => {
    const gen = genStoreSpec();
    const draw = (seed, cases) => Array.from({ length: cases }, (_, index) => canonicalSpec(sample(gen, makeRng(trialSeed(seed, index)))));
    assert.deepEqual(draw(1234, 6), draw(1234, 6), "same seed produced a different trial sequence");
    assert.notDeepEqual(draw(1234, 6), draw(4321, 6), "different seeds produced the same trial sequence");
  });

  it("finds the planted violation and shrinks it to the minimal counterexample", () => {
    const def = findProperty("probe-refusal-writes-nothing");
    const report = runProperty(def, { cases: 12, seed: 1, driver: "stub" });
    assert.equal(report.ok, false, "the planted violation was not detected");
    assert.equal(report.failures.length, 1);
    const failure = report.failures[0];
    assert.equal(failure.shrunk.spec.probe.n, 2, `expected the minimal probe counterexample, got ${JSON.stringify(failure.shrunk.spec)}`);
    assert.equal(failure.shrunk.spec.mutations.length, 0, "the shrinker kept an irrelevant mutation");
    assert.ok(failure.shrunk.steps >= 1, "no shrink steps were taken");
    assert.match(failure.replay.minimal.bySpec, /prop-run\.mjs/, "no replay command was reported");
    assert.ok(report.coverage.labels.some((entry) => entry.label === "reason=needs-input"), "coverage lost the refusal label");
  });

  it("replays the shrunk counterexample through the stub host and through the real host", () => {
    const def = findProperty("probe-refusal-writes-nothing");
    const shrunk = { schema: "store-spec/1", boxes: 1, mutations: [], probe: { n: 2 } };
    const stub = runSingleSpec(def, shrunk, { driver: "stub" });
    assert.equal(stub.ok, false, "the shrunk spec no longer reproduces the failure under the stub host");
    assert.match(stub.detail, /wrote to the store/);
    const host = runSingleSpec(def, shrunk, { driver: "host" });
    assert.equal(host.ok, false, "the shrunk spec no longer reproduces the failure under the real host");
    assert.match(host.detail, /wrote to the store/);
  });

  it("fails on a coverage threshold without inventing a counterexample", () => {
    const def = { ...findProperty("probe-clean-run-accepts"), cover: [{ label: "probe=99", minPct: 90 }] };
    const report = runProperty(def, { cases: 5, seed: 2, driver: "stub" });
    assert.equal(report.ok, false, "the unmet cover threshold did not fail the property");
    assert.equal(report.failures.length, 0, "a coverage miss must not be reported as a counterexample");
    assert.equal(report.coverage.checks[0].ok, false);
  });

  it("counts inapplicable mutations as discards, never as failures", () => {
    const spec = { schema: "store-spec/1", boxes: 1, mutations: [{ name: "drop-units", params: { count: 45 } }, { name: "missing-row", params: {} }] };
    const def = { ...findProperty("probe-clean-run-accepts"), cover: [], gen: { sample: () => spec } };
    const report = runProperty(def, { cases: 3, seed: 3, driver: "stub" });
    assert.equal(report.discarded, 3, `expected 3 discards, got ${report.discarded}`);
    assert.equal(report.trials, 0);
    assert.equal(report.failures.length, 0);
    assert.equal(report.ok, true, "discards must not fail a property");
  });

  it("keeps the mutation registry well formed", () => {    for (const name of MUTATION_NAMES) {
      const mutation = MUTATIONS[name];
      assert.ok(["prewrite", "pin", "merge", "freeze", "envelope"].includes(mutation.stage), `${name}: invalid stage`);
      assert.ok(mutation.summary, `${name}: no summary`);
      assert.equal(typeof mutation.apply, "function", `${name}: no apply`);
      for (const [key, meta] of Object.entries(mutation.params ?? {})) {
        assert.ok(meta.values || meta.max >= 1, `${name}.${key}: no generation metadata`);
        assert.ok(meta.values || typeof meta.shrink === "function", `${name}.${key}: no shrinker`);
      }
      if (mutation.expected === null) assert.ok(mutation.note, `${name}: unpinned mutations must document the assumption`);
    }
  });

  it("applies p05-no-ceiling on both box layouts (no sidecar crash)", () => {
    // Regression: the 1-box stream has no join/box-0000.p05-evidence.json, only the seed's
    // global sidecar. A mutation that reads the wrong path used to throw a raw ENOENT.
    for (const boxes of [1, 2]) {
      const spec = { schema: "store-spec/1", boxes, mutations: [{ name: "p05-no-ceiling", params: {} }] };
      const dir = mkdtempSync(path.join(os.tmpdir(), "cure-light-p05-"));
      const { runRoot } = renderStore(spec, dir);
      const rel = boxes === 2 ? "join/box-0000.p05-evidence.json" : "join/p05-evidence.json";
      const evidence = JSON.parse(readFileSync(path.join(runRoot, rel), "utf8"));
      assert.equal("input_ceiling_bytes" in (evidence.budget ?? {}), false, `${rel} was not mutated`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops on an unexpected engine error with a report, never a silent pass", () => {
    const broken = { schema: "store-spec/1", boxes: 1, mutations: [{ name: "no-such-mutation", params: {} }] };
    const def = { ...findProperty("probe-clean-run-accepts"), cover: [], gen: { sample: () => broken } };
    const report = runProperty(def, { cases: 3, seed: 4, driver: "stub" });
    assert.match(report.infraError ?? "", /no-such-mutation/, "the engine error was not reported");
    assert.equal(report.ok, false);
    assert.equal(report.failures.length, 0, "an engine error must not masquerade as a counterexample");
  });

  it("never reports a vacuous pass when the workflow under test is absent", () => {
    const def = findProperty("mutation-program-reaches-its-sealed-reason");
    const result = runSingleSpec(def, { schema: "store-spec/1", boxes: 1, mutations: [{ name: "preexisting-draft-equal", params: {} }] }, { driver: "stub" });
    assert.equal(result.ok, false, "a replay with no workflow to run reported a pass");
    assert.match(result.skipped ?? "", /workflow draft missing/);
  });
});
