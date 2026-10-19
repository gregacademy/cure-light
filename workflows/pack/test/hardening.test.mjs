// workflows/pack/test/hardening.test.mjs — permission-path regression (fast tier).
//
// Directory permissions are not part of the sealed case table (a case dir cannot rely on
// teardown after a broken chmod), so the unreadable-`join` path lives here with an explicit
// try/finally restore. The regular-file `join` case stays in cases.mjs: both must refuse with
// evidence-failed and neither may write to the store.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  artifactSha,
  cleanupTempDirs,
  readBytes,
  tempDir,
  writeBytes,
} from "../../../kernel/tools/verify-testkit.mjs";
import { packStream } from "../fixtures/streams.mjs";
import { runDraft } from "../testkit.mjs";

after(cleanupTempDirs);

describe("p0-pack permission hardening", () => {
  it("refuses an unreadable join with evidence-failed and restores permissions", (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("root bypasses directory permissions; the EACCES path needs a non-root user");
      return;
    }
    const runRoot = packStream("hardening-eacces");
    const join = path.join(runRoot, "join");
    mkdirSync(join, { recursive: true });
    const keep = Buffer.from("pre-existing join artifact\n", "utf8");
    writeBytes(runRoot, "join/keep.txt", keep);
    const manifestSha = artifactSha(runRoot, "units/units2/manifest.json");

    chmodSync(join, 0o000);
    let result = null;
    try {
      result = runDraft(runRoot, { ceiling: 130000 });
    } finally {
      // Always restore before any assertion, so a failed run cannot leak an unreadable dir.
      chmodSync(join, 0o755);
    }

    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "evidence-failed", `exit=${JSON.stringify(result.exit)}`);
    assert.match(String(result.exit?.detail), /join/);
    assert.deepEqual(readdirSync(join), ["keep.txt"], "refusal changed the join directory");
    assert.equal(readBytes(runRoot, "join/keep.txt").equals(keep), true, "refusal rewrote a join artifact");
    assert.equal(artifactSha(runRoot, "units/units2/manifest.json"), manifestSha, "refusal rewrote an input");
  });

  it("refuses a write-protected join before any rename and leaves the store unchanged", (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("root bypasses directory permissions; the EACCES path needs a non-root user");
      return;
    }
    const runRoot = packStream("hardening-promotion");
    const join = path.join(runRoot, "join");
    mkdirSync(join, { recursive: true });
    const keep = Buffer.from("pre-existing claims list\n", "utf8");
    writeBytes(runRoot, "join/claims-list.json", keep);

    chmodSync(join, 0o555);
    let result = null;
    try {
      // --allow-overwrite reaches promotion; the first tmp write must fail before any rename.
      result = runDraft(runRoot, { ceiling: 130000, allowOverwrite: true });
    } finally {
      chmodSync(join, 0o755);
    }

    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "evidence-failed", `exit=${JSON.stringify(result.exit)}`);
    assert.match(String(result.exit?.detail), /promotion staging failed/);
    assert.deepEqual(readdirSync(join), ["claims-list.json"], "staging leaked a tmp file or renamed a target");
    assert.equal(readBytes(runRoot, "join/claims-list.json").equals(keep), true, "staging rewrote a target");
  });

  it("refuses a join symlink and leaves the outside directory empty", () => {
    // The case table cannot host this case: snapshotTree cannot walk a symlinked join. Run
    // the same engine path directly and assert the refusal wrote nothing anywhere.
    const runRoot = packStream("hardening-symlink");
    const outside = tempDir("pack-outside");
    symlinkSync(outside, path.join(runRoot, "join"));
    const result = runDraft(runRoot, { ceiling: 130000 });
    assert.equal(result.error, null, String(result.error?.stack ?? ""));
    assert.equal(result.exit?.reason, "evidence-failed", `exit=${JSON.stringify(result.exit)}`);
    assert.match(String(result.exit?.detail), /join is a symlink/);
    assert.deepEqual(readdirSync(outside), [], "refusal wrote through the join symlink");
    assert.equal(lstatSync(path.join(runRoot, "join")).isSymbolicLink(), true, "join symlink was replaced");
    assert.deepEqual(readdirSync(runRoot).sort(), ["claims", "join", "units"], "refusal wrote into the store");
  });
});
