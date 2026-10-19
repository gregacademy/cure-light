// workflows/pack/test/host.test.mjs — the same sealed p0-pack cases, driven through the
// real pi CLI (opt-in host tier).
//
// Red-first like the fast tier: until workflows/pack/p0-pack.js exists every case fails with
// `workflow draft missing`. Once it lands, this tier proves the draft behaves identically
// under the real host — including the purity rerun (two runs from the same initial state
// must produce the same reason, exit payload and artifact tree).
//
// Purity is not proven by a defaulted zero. A pure case must carry a parsed
// `workflow-summary` record with `turns === 0`, and the raw host receipt must contain no
// model/assistant activity. `hostdriver.mjs` defaults a missing summary to zero, so testing
// `usage.turns` alone would pass a run whose summary never arrived.
//
// Run it explicitly:
//   node workflows/run.mjs host
//   node workflows/testkit/host-run.mjs p0-pack --driver host --json
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupTempDirs } from "../../../kernel/tools/verify-testkit.mjs";
import { PACK_BASELINE_CASE, PACK_CASES } from "../cases.mjs";
import { runCase } from "../../testkit/casekit.mjs";

const SCRATCH = [];

/** A case dir this tier owns, so `runCase` keeps the host receipt after a green run. */
function scratchCaseDir(id) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `cure-light-pack-host-${id.replace(/[^a-z0-9-]/gi, "-")}-`));
  SCRATCH.push(dir);
  return dir;
}

after(() => {
  for (const dir of SCRATCH.splice(0)) rmSync(dir, { recursive: true, force: true });
  cleanupTempDirs();
});

/** Session-record types a model turn emits; a pure workflow emits none of them. */
const MODEL_ACTIVITY_TYPES = new Set([
  "message",
  "message_start",
  "message_update",
  "message_end",
  "turn_start",
  "turn_end",
  "agent_start",
  "agent_end",
  "tool_execution_start",
  "tool_execution_end",
]);

function hasAssistantRole(node) {
  if (Array.isArray(node)) return node.some(hasAssistantRole);
  if (node && typeof node === "object") {
    if (node.role === "assistant") return true;
    return Object.values(node).some(hasAssistantRole);
  }
  return false;
}

function readReceipt(report) {
  const file = path.join(report.paths.hostDir, "pi.stdout.jsonl");
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/**
 * A pure case proves model-freedom on the real host: the host emitted a parsed workflow
 * summary, that summary and the normalized usage report zero turns, and the raw receipt
 * contains no message/turn/agent/tool event and no assistant-role record.
 */
function assertModelFree(report, spec) {
  const label = spec.id;
  assert.ok(
    report.summary && typeof report.summary === "object",
    `${label}: host produced no parsed workflow-summary; purity is unproven (${report.paths.caseDir})`,
  );
  assert.equal(report.summary.turns, 0, `${label}: workflow summary reports ${report.summary.turns} model turn(s)`);
  assert.equal(report.summary.classifySteps ?? 0, 0, `${label}: workflow summary reports classifier steps`);
  assert.equal(report.usage.turns, 0, `${label}: host usage reports ${report.usage.turns} model turn(s)`);

  const activity = report.summary.activity ?? {};
  // `activity` also counts tool work (shell, checkpoint) for a model-free workflow; only
  // model-facing counters are evidence of a turn.
  const busyActivity = Object.entries(activity).filter(
    ([key, value]) => /model|turn|classif|token|prompt|assistant|llm|cost/i.test(key) && value !== 0 && value !== null && value !== undefined && value !== false,
  );
  assert.deepEqual(busyActivity, [], `${label}: workflow summary reports activity: ${JSON.stringify(activity)}`);

  const records = readReceipt(report);
  const offenders = records.filter(
    (record) => MODEL_ACTIVITY_TYPES.has(record.type) || record.role === "assistant" || record.message?.role === "assistant" || hasAssistantRole(record.entry ?? null),
  );
  assert.deepEqual(
    offenders.map((record) => record.type),
    [],
    `${label}: host transcript contains model/assistant activity: ${JSON.stringify(offenders).slice(0, 800)}`,
  );
}

describe("p0-pack (real pi CLI)", () => {
  for (const spec of PACK_CASES) {
    it(spec.title, () => {
      const report = runCase(spec, { driver: "host", caseDir: scratchCaseDir(spec.id) });
      assert.equal(report.ok, true, `${report.failure} (case dir: ${report.paths.caseDir})`);
      if (spec.purity !== false) {
        assertModelFree(report, spec);
        assert.equal(report.purity?.equal, true, `rerun digests differ (${report.paths.caseDir})`);
      }
    });
  }

  it(PACK_BASELINE_CASE.title, (t) => {
    const report = runCase(PACK_BASELINE_CASE, { driver: "host", caseDir: scratchCaseDir(PACK_BASELINE_CASE.id) });
    if (report.skipped) {
      t.skip(report.skipped);
      return;
    }
    assert.equal(report.ok, true, `${report.failure} (case dir: ${report.paths.caseDir})`);
    assertModelFree(report, PACK_BASELINE_CASE);
    assert.equal(report.purity?.equal, true, "baseline replay digests differ between runs");
  });
});
