// workflows/test/harness.test.mjs — stub-host self-test tier (fast, green).
//
// The contract tier trusts harness.mjs as its instrument: E_WORKFLOW_MISSING is the
// red-first signal, checkpoints/exits are captured, shell effects are real, notebook
// handles are in-memory, and model handles stay traps. Verify that instrument here so a
// contract failure is always attributable to the draft, never to the harness.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupTempDirs, tempDir } from "../../kernel/tools/verify-testkit.mjs";
import { runWorkflow, WORKFLOW_MISSING } from "./harness.mjs";

after(cleanupTempDirs);

function draftFile(source) {
  const file = path.join(tempDir("harness-draft"), "draft.js");
  writeFileSync(file, source);
  return file;
}

describe("stub workflow host", () => {
  it("reports a missing draft as E_WORKFLOW_MISSING with no exit", () => {
    const file = path.join(tempDir("harness-absent"), "absent.js");
    const result = runWorkflow({ file });
    assert.equal(result.error?.code, WORKFLOW_MISSING);
    assert.match(String(result.error.message), /workflow draft missing/);
    assert.equal(result.exit, null);
    assert.deepEqual(result.exits, []);
  });

  it("passes args through, captures checkpoints/exits and runs real shell", () => {
    const file = draftFile(`return defineWorkflow((workflow) => {
      const args = load("args");
      const probe = workflow.shell("echo harness-probe");
      workflow.checkpoint({ phase: "probe", args, stdout: probe.output.trim() });
      workflow.exit({ reason: "ok", stdout: probe.output.trim() });
    });`);
    const result = runWorkflow({ file, args: "--store /x" });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "ok");
    assert.equal(result.exit?.stdout, "harness-probe");
    assert.equal(result.checkpoints[0]?.args, "--store /x");
    assert.equal(result.checkpoints[0]?.stdout, "harness-probe");
    assert.equal(result.shellCalls[0]?.ok, true);
  });

  it("keeps notebook handles in-memory and model handles trapped", () => {
    const file = draftFile(`return defineWorkflow((workflow) => {
      workflow.notebookWrite({ name: "page-a", content: "body" });
      const body = workflow.notebookRead("page-a");
      workflow.exit({ reason: "ok", body });
    });`);
    const result = runWorkflow({ file });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.pages.get("page-a"), "body");
    assert.equal(result.exit?.body, "body");

    const trapped = runWorkflow({ file: draftFile(`return defineWorkflow((workflow) => { workflow.run({ input: "x" }); });`) });
    assert.match(String(trapped.error?.message), /unexpected workflow\.run\(\)/);
  });
});
