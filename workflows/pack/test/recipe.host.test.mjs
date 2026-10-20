// workflows/pack/test/recipe.host.test.mjs — prove the documented p0-pack receipt recipe.
//
// This is deliberately separate from cases.mjs: it tests the coordinator's bash command
// and three bounded receipt reads, not a workflow behavior case. The command must match
// kernel/references/intake-and-scope.md §0.3 "Packing prep".
import { spawnSync } from "node:child_process";
import { after, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cleanupTempDirs, tempDir } from "../../../kernel/tools/verify-testkit.mjs";
import { observeReceipt } from "../../testkit/hostdriver.mjs";
import { packStream } from "../fixtures/streams.mjs";
import { DRAFT, packArgs } from "../testkit.mjs";

after(cleanupTempDirs);

const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

function recipeRead(receipt, command) {
  const proc = spawnSync(`R=${shellQuote(receipt)}; ${command}`, {
    encoding: "utf8",
    shell: "/bin/bash",
    timeout: 30_000,
  });
  assert.equal(proc.error, undefined, `receipt read failed: ${proc.error?.message ?? "unknown error"}`);
  assert.equal(proc.status, 0, `receipt read failed: ${proc.stderr}`);
  return (proc.stdout ?? "").trim();
}

function receiptEntry(line, kind) {
  assert.notEqual(line, "", `missing ${kind} receipt record`);
  const record = JSON.parse(line);
  assert.equal(record.type, "entry_appended", `${kind} read returned a non-entry record`);
  assert.equal(record.entry?.customType, kind, `${kind} read returned the wrong record`);
  return record.entry;
}

it("documented p0-pack recipe reads the same exit, card and summary as the host driver", () => {
  const caseDir = tempDir("p0-pack-recipe");
  const runRoot = path.join(caseDir, "run");
  cpSync(packStream("recipe", { unitCount: 6, unitBytes: 40000 }), runRoot, { recursive: true });

  const cwd = path.join(caseDir, "cwd");
  mkdirSync(cwd, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const receiptDir = path.join(cwd, ".tmp", "pipeline", "p0-pack", `${stamp}-${process.pid}`);
  mkdirSync(receiptDir, { recursive: true });
  const receipt = path.join(receiptDir, "pi.stdout.jsonl");
  const stderr = path.join(receiptDir, "pi.stderr");
  const args = packArgs(runRoot, { ceiling: 130000 });
  const piBin = process.env.PI_BIN ?? "pi";

  // This is the §0.3 documented command. The working directory is writable and outside
  // --store, while the workflow token is the absolute path to the shipped workflow.
  const command = [
    `${shellQuote(piBin)} --offline --no-session --mode json --print --no-mcp --no-skills --no-prompt-templates --no-context-files`,
    `--workflow-time 720000 ${shellQuote(`/workflow ${DRAFT} ${args}`)}`,
    `> ${shellQuote(receipt)} 2> ${shellQuote(stderr)}`,
  ].join(" ");
  const proc = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: "/bin/bash",
    timeout: 720_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(proc.error, undefined, `host command failed: ${proc.error?.message ?? "unknown error"}`);
  assert.equal(proc.status, 0, `host command failed: ${readFileSync(stderr, "utf8")}`);

  // These are the §0.3 bounded reads, run as real shell commands rather than reimplemented.
  const exitLine = recipeRead(receipt, `grep '"customType":"workflow-exit"' "$R" | tail -n 1`);
  const logLine = recipeRead(receipt, `grep '"customType":"workflow-log"' "$R" | tail -n 1`);
  const summaryLine = recipeRead(receipt, `grep '"customType":"workflow-summary"' "$R" | tail -n 1`);

  const exitEntry = receiptEntry(exitLine, "workflow-exit");
  const logEntry = receiptEntry(logLine, "workflow-log");
  const summaryEntry = receiptEntry(summaryLine, "workflow-summary");
  const observed = observeReceipt(readFileSync(receipt, "utf8"));

  assert.equal(observed.error, null, observed.error?.message);
  assert.ok(observed.exit, "host driver did not observe a workflow-exit record");
  assert.equal(exitEntry.data?.reason, observed.reason, "exit record reason differs from driver observation");
  assert.equal(exitEntry.data?.metadata?.reason, observed.reason, "exit metadata reason differs from driver observation");
  assert.equal(logEntry.data?.text, observed.logs.at(-1), "workflow card differs from driver observation");
  assert.deepEqual(summaryEntry.data, observed.summary, "workflow summary differs from driver observation");
  assert.equal(observed.reason, "ok");
  assert.ok(logEntry.data?.text, "workflow-log card is missing");
  assert.ok(logEntry.data.text.split("\n").length <= 20, "workflow card exceeds 20 lines");

  // The receipt reason `ok` must mean the pack artifacts were actually promoted.
  const join = readdirSync(path.join(runRoot, "join")).sort();
  assert.ok(join.includes("claims-list.json"), "claims-list.json was not promoted");
  assert.equal(join.filter((name) => name.endsWith(".assignment.json")).length, 2, "expected two promoted boxes");
  assert.equal(join.filter((name) => name.endsWith(".instructions.md")).length, 2, "expected two promoted instruction files");
});
