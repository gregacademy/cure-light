// workflows/test/p0-close-testkit.mjs — shared helpers for the p0-close test tiers.
//
// The three tiers import from here so the draft path, the pinned tool hashes and the
// canonical CLI argument string are defined exactly once:
//   p0-close.contract.test.mjs   (fast, red-first executable specification)
//   p0-close.acceptance.test.mjs (frozen-baseline replay, opt-in tier)
//   p0-close.compile.test.mjs    (toolchain conformance, opt-in tier)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, tempDir } from "../../kernel/tools/verify-testkit.mjs";
import { runWorkflow } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const DRAFT = path.join(REPO, "workflows", "p0", "p0-close.js");
export const VERIFIER = path.join(REPO, "kernel", "tools", "verify.mjs");
export const CHUNKER = path.join(REPO, "kernel", "tools", "chunker.mjs");
const shaFile = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");
export const VERIFIER_SHA = shaFile(VERIFIER);
export const CHUNKER_SHA = shaFile(CHUNKER);

/** The canonical invocation against a materialized run root (proposal §3). */
export function workflowArgs(runRoot, overrides = {}) {
  const manifest = readJson(runRoot, "units/units2/manifest.json");
  const identity = manifest.identity ?? {};
  const parts = [
    `--store ${runRoot}`,
    `--verifier ${VERIFIER}`,
    `--verifier-sha256 ${overrides.verifierSha ?? VERIFIER_SHA}`,
    `--chunker-sha256 ${CHUNKER_SHA}`,
    `--input-ceiling-bytes ${overrides.ceiling ?? 196608}`,
    `--operator-ref ${overrides.operatorRef ?? "fixture:p0-close"}`,
    `--run-id ${overrides.runId ?? "fixture/p0-close"}`,
    `--review-state ${overrides.reviewState ?? "s1"}`,
    `--base-oid ${overrides.baseOid ?? identity.base_oid ?? "0".repeat(40)}`,
    `--subject-oid ${overrides.subjectOid ?? identity.subject_oid ?? "1".repeat(40)}`,
  ];
  if (overrides.allowOverwrite) parts.push("--allow-overwrite");
  return parts.join(" ");
}

/** Run the draft by path under the stub host in a fresh cwd. */
export function runDraft(runRoot, overrides = {}) {
  return runWorkflow({ file: DRAFT, args: workflowArgs(runRoot, overrides), cwd: tempDir("p0-close-cwd") });
}
