// workflows/pack/testkit.mjs — shared helpers for the p0-pack test tiers.
//
// The suite imports from here so the draft path and the canonical CLI argument string are
// defined exactly once. Identity flags are read from the store's capture manifest (the
// workflow treats them as cross-checks and warns on disagreement).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, tempDir } from "../../kernel/tools/verify-testkit.mjs";
import { runWorkflow } from "../testkit/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const DRAFT = path.join(REPO, "workflows", "pack", "p0-pack.js");

/** The pilot ceiling used when a test does not pass one explicitly (recorded s1 store). */
export const DEFAULT_CEILING = 196608;

/** The canonical invocation against a materialized pre-pack run root (SPEC §Invocation). */

/** Single-quote one shell argument, escaping embedded single quotes (`'` -> `'\''`). */
export function shellQuote(value) {
  return "'" + String(value).split("'").join("'\\''") + "'";
}

export function packArgs(runRoot, overrides = {}) {
  // A fault case may remove the capture manifest; the workflow refuses on its own, so the
  // testkit only needs a parseable identity for the argument string.
  let capture = {};
  try { capture = readJson(runRoot, "claims/sources/capture-manifest.json"); } catch { capture = {}; }
  const parts = [
    `--store ${shellQuote(overrides.store ?? runRoot)}`,
    `--input-ceiling-bytes ${shellQuote(overrides.ceiling ?? DEFAULT_CEILING)}`,
    `--run-id ${shellQuote(overrides.runId ?? capture.run ?? "fixture/p0-pack#7")}`,
    `--review-state ${shellQuote(overrides.reviewState ?? capture.review_state ?? "s1")}`,
    `--base-oid ${shellQuote(overrides.baseOid ?? capture.base_oid ?? "b".repeat(40))}`,
    `--subject-oid ${shellQuote(overrides.subjectOid ?? capture.subject_oid ?? "c".repeat(40))}`,
  ];
  if (overrides.childStore) parts.push(`--child-store ${shellQuote(overrides.childStore)}`);
  if (overrides.allowOverwrite) parts.push("--allow-overwrite");
  const canonical = parts.join(" ");
  // Escape hatch for a case that needs a raw argument string (duplicate flags, `--flag=`
  // forms, malformed tokens). A function receives the canonical string built above.
  if (overrides.argsOverride !== undefined) {
    return typeof overrides.argsOverride === "function"
      ? String(overrides.argsOverride(canonical))
      : String(overrides.argsOverride);
  }
  return canonical;
}

/** Run the draft by path under the stub host in a fresh cwd. */
export function runDraft(runRoot, overrides = {}) {
  return runWorkflow({ file: DRAFT, args: packArgs(runRoot, overrides), cwd: tempDir("p0-pack-cwd") });
}
