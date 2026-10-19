// workflows/p0/testkit.mjs — shared helpers for the p0-close test tiers.
//
// The p0 suite imports from here so the draft path, the pinned tool hashes and the
// canonical CLI argument string are defined exactly once:
//   test/contract.test.mjs   (fast, red-first executable specification)
//   test/host.test.mjs       (the same cases through the real pi CLI)
//   test/acceptance.test.mjs (frozen-baseline replay, opt-in tier)
//   test/compile.test.mjs    (toolchain conformance, opt-in tier)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, tempDir } from "../../kernel/tools/verify-testkit.mjs";
import { runWorkflow } from "../testkit/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const DRAFT = path.join(REPO, "workflows", "p0", "p0-close.js");
export const VERIFIER = path.join(REPO, "kernel", "tools", "verify.mjs");
export const CHUNKER = path.join(REPO, "kernel", "tools", "chunker.mjs");
const shaFile = (abs) => createHash("sha256").update(readFileSync(abs)).digest("hex");
export const VERIFIER_SHA = shaFile(VERIFIER);
export const CHUNKER_SHA = shaFile(CHUNKER);

/** The seed's single-box pilot ceiling; the single-box synthetic stream keeps the seed value. */
export const SEED_PILOT_CEILING = 196608;

/**
 * The canonical `--input-ceiling-bytes` value for a store. The two-box synthetic stream is
 * packed under a derived greedy ceiling (`greedySplit` in fixtures/streams.mjs), so the
 * value is read from the FIRST box; a single-box store keeps the seed's constant. Either
 * way the `ceiling-drift` mutation (which drifts the last box) disagrees with the flag.
 */
export function recordedCeiling(runRoot) {
  const names = readdirSync(path.join(runRoot, "join"))
    .filter((candidate) => /^box-.*\.assignment\.json$/.test(candidate))
    .sort();
  if (names.length <= 1) return SEED_PILOT_CEILING;
  return readJson(runRoot, `join/${names.at(0)}`).input_ceiling_bytes;
}

/** Single-quote one shell argument, escaping embedded single quotes (`'` -> `'\\''`). */
export function shellQuote(value) {
  return "'" + String(value).split("'").join("'\\''") + "'";
}

/** The canonical invocation against a materialized run root (proposal §3). */
export function workflowArgs(runRoot, overrides = {}) {
  const manifest = readJson(runRoot, "units/units2/manifest.json");
  const identity = manifest.identity ?? {};
  const parts = [
    `--store ${shellQuote(overrides.store ?? runRoot)}`,
    `--verifier ${shellQuote(VERIFIER)}`,
    `--verifier-sha256 ${shellQuote(overrides.verifierSha ?? VERIFIER_SHA)}`,
    `--chunker-sha256 ${shellQuote(CHUNKER_SHA)}`,
    `--input-ceiling-bytes ${shellQuote(overrides.ceiling ?? recordedCeiling(runRoot))}`,
    `--operator-ref ${shellQuote(overrides.operatorRef ?? "fixture:p0-close")}`,
    `--run-id ${shellQuote(overrides.runId ?? "fixture/p0-close")}`,
    `--review-state ${shellQuote(overrides.reviewState ?? "s1")}`,
    `--base-oid ${shellQuote(overrides.baseOid ?? identity.base_oid ?? "0".repeat(40))}`,
    `--subject-oid ${shellQuote(overrides.subjectOid ?? identity.subject_oid ?? "1".repeat(40))}`,
  ];
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
  return runWorkflow({ file: DRAFT, args: workflowArgs(runRoot, overrides), cwd: tempDir("p0-close-cwd") });
}
