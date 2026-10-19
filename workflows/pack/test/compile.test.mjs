// workflows/pack/test/compile.test.mjs — toolchain conformance (opt-in tier).
//
// Verification ladder step 1 for workflows/pack/p0-pack.js: the draft must pass
// `node --check` in a CJS scope and the checkout's canonical compile must return
// `{code, hasCheckpoint:true}`. Both cases skip while the draft is missing or the
// pi-schematic checkout is unavailable — the red-first signal lives in the contract tier.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cleanupTempDirs, tempDir } from "../../../kernel/tools/verify-testkit.mjs";
import { DRAFT } from "../testkit.mjs";

after(cleanupTempDirs);

const CHECKOUT = process.env.PI_SCHEMATIC_CHECKOUT ?? path.join(os.homedir(), ".pi", "agent", "git", "github.com", "chunkhound", "pi-schematic");
const COMPILE_TS = path.join(CHECKOUT, "workflow", "compile.ts");
const draftReady = (t) => {
  if (existsSync(DRAFT)) return true;
  t.skip("draft not implemented yet (red-first); contract tier carries the red signal");
  return false;
};

describe("p0-pack compile", () => {
  it("passes node --check in a CJS scope", (t) => {
    if (!draftReady(t)) return;
    const probe = path.join(tempDir("p0-pack-check"), "draft.cjs");
    writeFileSync(probe, readFileSync(DRAFT));
    const check = spawnSync(process.execPath, ["--check", probe], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
  });

  it("compiles canonically with a checkpoint declared", async (t) => {
    if (!draftReady(t)) return;
    if (!existsSync(COMPILE_TS)) {
      t.skip(`pi-schematic checkout unavailable at ${CHECKOUT} (set PI_SCHEMATIC_CHECKOUT)`);
      return;
    }
    const { compileWorkflow } = await import(pathToFileURL(COMPILE_TS).href);
    const compiled = compileWorkflow(readFileSync(DRAFT, "utf8"));
    assert.equal(typeof compiled, "object", "canonical compile must return {code, hasCheckpoint}");
    assert.equal(typeof compiled.code, "string");
    assert.equal(compiled.hasCheckpoint, true, "the draft must declare at least one checkpoint");
  });
});
