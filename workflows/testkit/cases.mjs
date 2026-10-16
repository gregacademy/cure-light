// workflows/testkit/cases.mjs — the smoke case table: the harness's own plumbing proof.
//
// One case = one input recipe + one oracle. These cases contain no product semantics: they
// prove that the harness observes args, shell I/O, store writes, the checkpoint and the exit
// payload, and that the stub host and the real pi CLI agree. The p0-close case table lives in
// ../p0/cases.mjs; host-run.mjs registers both groups.
//
// Case shape:
//   id, group, title            identity
//   workflow                    absolute path token handed to /workflow
//   prepare(caseDir)            materialize the run store under <caseDir>/run
//   args(runRoot, seeded)       the canonical argument string for this case
//   expect.reason               required exit reason
//   check(ctx)                  case invariants; throws on failure, returns notes
//   purity                      false disables the host rerun check; {ignore:[keys]} drops
//                               declared-volatile exit payload keys from the digest
//   hostFlags                   extra pi CLI flags (e.g. --workflow-time)
//   skip()                      optional: return a reason string to skip the case
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifactSha } from "../../kernel/tools/verify-testkit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SMOKE_FIXTURE = path.join(HERE, "fixtures", "smoke-echo.js");

/** A fresh empty store dir: the case supplies its own preconditions through args only. */
function emptyStore(caseDir) {
  const runRoot = path.join(caseDir, "run");
  mkdirSync(runRoot, { recursive: true });
  return { runRoot };
}

// --------------------------------------------------------------- smoke group ----

export const SMOKE_CASES = [
  {
    id: "smoke-echo",
    group: "smoke",
    title: "runs end to end: args, shell, store write, checkpoint, exit payload",
    workflow: SMOKE_FIXTURE,
    prepare: emptyStore,
    args: (runRoot) => `--store ${runRoot}`,
    expect: { reason: "ok", records: ["workflow-limits", "workflow-shell", "workflow-exit", "workflow-summary"] },
    hostFlags: [],
    check({ result, runRoot, driver }) {
      const notes = [];
      const sha = runRoot ? artifactSha(runRoot, "out.txt") : null;
      assert.ok(sha, "out.txt was not written into the store");
      assert.equal(result.exit?.artifacts?.out, sha, `exit payload sha != artifact sha: ${JSON.stringify(result.exit)}`);
      notes.push(`artifact out.txt 6B ${sha.slice(0, 12)}`);
      assert.equal(result.checkpointCount ?? 0, 1, `expected exactly one checkpoint, got ${result.checkpointCount}`);
      assert.equal(result.shellCalls.length, 2, `expected 2 shell calls, got ${result.shellCalls.length}`);
      assert.deepEqual(
        result.shellCalls.map((call) => call.ok),
        [true, true],
      );
      assert.equal(result.usage?.turns ?? 0, 0, "a pure case must not spend model turns");
      if (driver === "host") {
        // No target flag: the host records the no-target start so the run never looks
        // silently unbounded (with --workflow-time the summary carries the target instead).
        assert.equal(result.summary?.unbounded, false, "the fixture declares a checkpoint");
        assert.equal(result.summary?.limits?.timeBudgetMs, null);
      }
      return notes;
    },
    checkId: "smoke-contract",
  },
  {
    id: "smoke-time-target",
    group: "smoke",
    title: "honours --workflow-time: the summary carries the target and no limits record is written",
    workflow: SMOKE_FIXTURE,
    prepare: emptyStore,
    args: (runRoot) => `--store ${runRoot}`,
    expect: { reason: "ok", records: ["workflow-shell", "workflow-exit", "workflow-summary"], excludes: ["workflow-limits"] },
    hostFlags: ["--workflow-time", "60000"],
    // Flag plumbing, not determinism: one host run is enough.
    purity: false,
    check({ result, driver }) {
      if (driver === "host") {
        assert.equal(result.summary?.limits?.timeBudgetMs, 60000, `limits not applied: ${JSON.stringify(result.summary?.limits)}`);
        assert.equal(result.summary?.unbounded, false);
      }
      return ["timeBudgetMs=60000"];
    },
    checkId: "time-target",
  },
];
