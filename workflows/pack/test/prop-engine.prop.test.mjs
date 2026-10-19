// workflows/pack/test/prop-engine.prop.test.mjs — the property engine's self-test (opt-in `prop` tier).
//
// Ported from workflows/p0/test/prop-engine.prop.test.mjs. The engine is only trustworthy if
// it (a) generates replayable pack stores, (b) finds a planted violation, (c) shrinks it to
// the minimal counterexample, (d) replays that counterexample, and (e) reports coverage,
// discards and pinned mutation reasons honestly. Checks (b)–(e) run against the probe fixture
// (`fixtures/probe-mark.js`), which needs no p0-pack draft and no model turn.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTempDirs, snapshotTree } from "../../../kernel/tools/verify-testkit.mjs";
import { findProperty } from "../prop/catalog.mjs";
import { sample } from "../prop/gen.mjs";
import { MUTATION_NAMES, MUTATIONS, STAGE_ORDER } from "../prop/mutations.mjs";
import { renderStore } from "../prop/render.mjs";
import { runProperty, runSingleSpec } from "../prop/runner.mjs";
import { makeRng, trialSeed } from "../prop/rng.mjs";
import { canonicalSpec, genStoreSpec, packFixedInputBytes, UNIT_COUNTS } from "../prop/spec.mjs";

after(cleanupTempDirs);

const sha = (tree) => tree.map((entry) => `${entry.rel}:${entry.sha256}`).join("|");

const SHRUNK_PROBE = {
  schema: "pack-spec/1",
  units: 1,
  unitBytes: 1000,
  ceiling: 20000,
  childStore: "/cure-light/prop/child-store-a",
  mutations: [],
  probe: { n: 2 },
};

/** Explicit params for mutations whose generated params must be pinned for a singleton run. */
const SINGLETON_PARAMS = {
  "byte-len-drift": { delta: 8 },
  "oversized-unit": { extra: 300000 },
  "non-ascii-claims": { variant: "bmp" },
};

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
      assert.equal(
        snapshotTree(a).filter((entry) => /^units\/units2\/u\d+\.txt$/.test(entry.rel)).length,
        spec.units,
        "rendered payload count differs from the spec",
      );
      const manifest = JSON.parse(readFileSync(path.join(a, "units/units2/manifest.json"), "utf8"));
      assert.equal(manifest.units.length, spec.units, "rendered manifest size differs from the spec");
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
    assert.match(failure.replay.minimal.bySpec, /workflows\/pack\/prop-run\.mjs/, "no replay command was reported");
    assert.ok(report.coverage.labels.some((entry) => entry.label === "reason=needs-input"), "coverage lost the refusal label");
  });

  it("replays the shrunk counterexample through the stub host and through the real host", () => {
    const def = findProperty("probe-refusal-writes-nothing");
    const stub = runSingleSpec(def, SHRUNK_PROBE, { driver: "stub" });
    assert.equal(stub.ok, false, "the shrunk spec no longer reproduces the failure under the stub host");
    assert.match(stub.detail, /wrote to the store/);
    const host = runSingleSpec(def, SHRUNK_PROBE, { driver: "host" });
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

  it("counts inapplicable mutations as discards and fails a zero-trial run", () => {
    const spec = {
      schema: "pack-spec/1",
      units: 1,
      unitBytes: 1000,
      ceiling: 20000,
      childStore: "/cure-light/prop/child-store-a",
      mutations: [
        { name: "missing-claims", params: {} },
        { name: "empty-claims", params: {} },
      ],
    };
    const def = { ...findProperty("probe-clean-run-accepts"), cover: [], gen: { sample: () => spec } };
    const report = runProperty(def, { cases: 3, seed: 3, driver: "stub" });
    assert.equal(report.discarded, 3, `expected 3 discards, got ${report.discarded}`);
    assert.equal(report.trials, 0);
    assert.equal(report.failures.length, 0);
    assert.equal(report.ok, false, "a run that executed no trial must not report success");
    assert.match(report.zeroTrials ?? "", /no trial executed/);
  });

  it("fails a run that executes zero trials instead of reporting a vacuous pass", () => {
    const spec = {
      schema: "pack-spec/1",
      units: 1,
      unitBytes: 1000,
      ceiling: 20000,
      childStore: "/cure-light/prop/child-store-a",
      mutations: [{ name: "missing-claims", params: {} }, { name: "empty-claims", params: {} }],
    };
    const def = { ...findProperty("probe-clean-run-accepts"), cover: [], gen: { sample: () => spec } };
    const report = runProperty(def, { cases: 1, seed: 11, driver: "stub" });
    assert.equal(report.trials, 0);
    assert.equal(report.ok, false);
    assert.equal(report.failures.length, 0, "zero trials is a run-level failure, not a counterexample");
    assert.match(report.zeroTrials ?? "", /no trial executed/);
  });

  it("never replaces a counterexample with a shrink of a different failure class", () => {
    const base = {
      schema: "pack-spec/1",
      units: 1,
      unitBytes: 1000,
      ceiling: 20000,
      childStore: "/cure-light/prop/child-store-a",
      mutations: [],
    };
    class FirstClass extends Error {
      constructor() {
        super("first failure class");
        this.name = "FirstClass";
      }
    }
    class SecondClass extends Error {
      constructor() {
        super("second failure class");
        this.name = "SecondClass";
      }
    }
    const def = {
      name: "failure-class-preservation",
      group: "engine",
      title: "failure class preservation",
      workflow: findProperty("probe-refusal-writes-nothing").workflow,
      args: (runRoot) => `--store ${runRoot}`,
      gen: { sample: () => ({ ...base, probe: { n: 1 } }) },
      // The only shrink candidate fails for a different reason; it must be rejected.
      shrink: (spec) => [{ ...spec, probe: { n: 2 } }],
      property(ctx) {
        if (ctx.spec.probe?.n === 1) throw new FirstClass();
        if (ctx.spec.probe?.n === 2) throw new SecondClass();
        return "ok";
      },
    };
    const report = runProperty(def, { cases: 1, seed: 5, driver: "stub" });
    assert.equal(report.ok, false, "the planted failure was not reported");
    const failure = report.failures[0];
    assert.equal(failure.class, "FirstClass");
    assert.equal(failure.shrunk.class, "FirstClass", "the shrunk result lost the original failure class");
    assert.equal(failure.shrunk.spec.probe.n, 1, "a different-class candidate replaced the counterexample");
    assert.equal(failure.shrunk.steps, 0);
  });

  it("generates coherent specs over 1..12 units and reaches the exact ceiling", () => {
    assert.deepEqual(UNIT_COUNTS, Array.from({ length: 12 }, (_, index) => index + 1));
    const gen = genStoreSpec({ mutationNames: [] });
    // Sizes 0, 5, 10 are boundary draws; the rest are generic draws.
    const specs = Array.from({ length: 15 }, (_, index) => sample(gen, makeRng(trialSeed(17, index)), index));
    const exactBoundary = (spec) => {
      const ids = spec.unitIds ?? Array.from({ length: spec.units }, (_, index) => `u${String(index).padStart(4, "0")}`);
      for (let inBox = 1; inBox < spec.units; inBox++) {
        const fixed = packFixedInputBytes({ unitIds: ids.slice(0, inBox), childStore: spec.childStore });
        if (fixed + inBox * spec.unitBytes === spec.ceiling) return true;
      }
      return false;
    };
    for (const spec of specs) {
      const ids = spec.unitIds ?? Array.from({ length: spec.units }, (_, index) => `u${String(index).padStart(4, "0")}`);
      for (const unitId of ids) assert.match(unitId, /^[A-Za-z0-9._-]+$/, `unsafe generated unit id: ${unitId}`);
      assert.equal(new Set(ids).size, ids.length, "generated unit ids are not unique");
      const fixedOne = packFixedInputBytes({ unitIds: [ids[0]], childStore: spec.childStore });
      assert.ok(fixedOne + spec.unitBytes <= spec.ceiling, `incoherent spec: ${canonicalSpec(spec)}`);
      if (exactBoundary(spec)) {
        for (const mutation of spec.mutations) {
          assert.ok(!["non-ascii-claims", "duplicate-claim-ids"].includes(mutation.name), `boundary draw kept a claims-sizing mutation: ${canonicalSpec(spec)}`);
        }
      }
    }
    assert.ok(specs.some(exactBoundary), `no generated draw reached the exact ceiling: ${specs.map((spec) => spec.ceiling).join(", ")}`);
  });

  it("renders odd-but-safe unit ids and a non-ASCII claim statement", () => {
    const childStore = "/cure-light/prop/child-store-a";
    const spec = {
      schema: "pack-spec/1",
      units: 3,
      unitBytes: 5000,
      ceiling: 60000,
      childStore,
      unitIds: ["odd.0-x_y", "odd_1", "u-2"],
      claimStatement: "The change keeps behavior 1 stable. \u2603 \u00e9",
      mutations: [],
    };
    const result = runSingleSpec(findProperty("corrected-paths"), spec, { driver: "stub" });
    assert.equal(result.report.exit?.reason, "ok", `generated variation refused: ${result.report.exit?.detail}`);
    assert.equal(result.ok, true, result.detail);
    const runRoot = result.report.paths.runRoot;
    const instructions = readFileSync(path.join(runRoot, "join/box-0000.instructions.md"), "utf8");
    for (const unitId of spec.unitIds) assert.ok(instructions.includes(`- ${unitId} — `), `instruction misses odd unit id ${unitId}`);
    const claims = readFileSync(path.join(runRoot, "join/claims-list.json"), "utf8");
    assert.match(claims, /\\u2603/, "the claims list did not escape the non-ASCII claim statement");
    assert.ok(!claims.includes("\u2603"), "the claims list wrote a raw non-ASCII character");
  });

  it("lands a box exactly on the generated ceiling (non-circular greedy boundary)", () => {
    const childStore = "/cure-light/prop/child-store-a";
    const ids = ["u0000", "u0001", "u0002"];
    const unitBytes = 30000;
    const inBox = 2;
    const ceiling = packFixedInputBytes({ unitIds: ids.slice(0, inBox), childStore }) + inBox * unitBytes;
    assert.ok(ceiling >= 20000 && ceiling <= 200000, `boundary ceiling out of the generated space: ${ceiling}`);
    const spec = { schema: "pack-spec/1", units: 3, unitBytes, ceiling, childStore, mutations: [] };
    const result = runSingleSpec(findProperty("greedy-ceiling"), spec, { driver: "stub" });
    assert.equal(result.report.exit?.reason, "ok", `boundary spec refused: ${result.report.exit?.detail}`);
    assert.equal(result.ok, true, result.detail);
    const boxes = result.report.exit.boxes;
    assert.equal(boxes.length, 2);
    assert.equal(boxes[0].unit_count, inBox);
    assert.equal(boxes[0].box_input_bytes, ceiling, "the first box did not land exactly on the ceiling");
    assert.equal(boxes[0].box_input_bytes - inBox * unitBytes, packFixedInputBytes({ unitIds: ids.slice(0, inBox), childStore }));
  });

  it("keeps the mutation registry well formed", () => {
    for (const name of MUTATION_NAMES) {
      const mutation = MUTATIONS[name];
      assert.ok(STAGE_ORDER.includes(mutation.stage), `${name}: invalid stage ${mutation.stage}`);
      assert.ok(mutation.summary, `${name}: no summary`);
      assert.equal(typeof mutation.apply, "function", `${name}: no apply`);
      for (const [key, meta] of Object.entries(mutation.params ?? {})) {
        assert.ok(meta.values || meta.max >= 1, `${name}.${key}: no generation metadata`);
        assert.ok(meta.values || typeof meta.shrink === "function", `${name}.${key}: no shrinker`);
      }
      if (mutation.expected === null) assert.ok(mutation.note, `${name}: unpinned mutations must document the assumption`);
    }
    for (const mutation of Object.values(MUTATIONS)) {
      for (const cancelled of mutation.cancels ?? []) {
        assert.ok(MUTATIONS[cancelled], `unknown cancels target: ${cancelled}`);
      }
    }
  });

  it("reaches every mutation's pinned reason as a singleton program", () => {
    const def = findProperty("mutation-program-reaches-its-sealed-reason");
    for (const name of MUTATION_NAMES) {
      const spec = {
        schema: "pack-spec/1",
        units: 3,
        unitBytes: 40000,
        ceiling: 150000,
        childStore: "/cure-light/prop/child-store-a",
        mutations: [{ name, params: SINGLETON_PARAMS[name] ?? {} }],
      };
      const result = runSingleSpec(def, spec, { driver: "stub" });
      assert.equal(result.ok, true, `${name}: ${result.detail ?? "singleton program did not reach its pinned reason"}`);
    }
  });

  it("stops on an unexpected engine error with a report, never a silent pass", () => {
    const broken = {
      schema: "pack-spec/1",
      units: 1,
      unitBytes: 1000,
      ceiling: 20000,
      childStore: "/cure-light/prop/child-store-a",
      mutations: [{ name: "no-such-mutation", params: {} }],
    };
    const def = { ...findProperty("probe-clean-run-accepts"), cover: [], gen: { sample: () => broken } };
    const report = runProperty(def, { cases: 3, seed: 4, driver: "stub" });
    assert.match(report.infraError ?? "", /no-such-mutation/, "the engine error was not reported");
    assert.equal(report.ok, false);
    assert.equal(report.failures.length, 0, "an engine error must not masquerade as a counterexample");
  });

  it("never reports a vacuous pass when the workflow under test is absent", () => {
    const def = {
      ...findProperty("mutation-program-reaches-its-sealed-reason"),
      workflow: path.join(os.tmpdir(), "cure-light-absent-workflow.js"),
    };
    const result = runSingleSpec(def, { ...SHRUNK_PROBE, mutations: [{ name: "preexisting-assignment", params: {} }] }, { driver: "stub" });
    assert.equal(result.ok, false, "a replay with no workflow to run reported a pass");
    assert.match(result.skipped ?? "", /workflow draft missing/);
  });
});
