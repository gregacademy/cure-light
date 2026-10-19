// workflows/pack/fixtures/streams.mjs — input streams for the p0-pack tests.
//
// Two streams:
//   packStream(label?, {unitCount, unitBytes, claims, fault}) — a synthetic pre-pack store:
//     capture manifest, claims draft, units manifest and exactly-sized payloads. Sized so
//     the greedy packer's split is deterministic (see the ceiling math in the tests).
//   baselineStream({src, destParent}) — a copy of the recorded s1 store plus the pins of
//     the corrected render of its inputs (fixtures/baseline-pins.mjs).
//
// CLI:
//   node workflows/pack/fixtures/streams.mjs list
//   node workflows/pack/fixtures/streams.mjs pack     <dest> [--units N] [--unit-bytes N] [--claims N] [--fault NAME]
//   node workflows/pack/fixtures/streams.mjs baseline <dest> [--src DIR]
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { editJson, tempDir, writeBytes, writeJson, writeText } from "../../../kernel/tools/verify-testkit.mjs";
import { BASELINE_PINS } from "./baseline-pins.mjs";

export const BASELINE_STORE_DEFAULT =
  process.env.CURE_LIGHT_BASELINE_STORE ??
  "/workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1";

/** The pilot ceiling the recorded store was packed under. */
export const BASELINE_CEILING = 196608;

const CLAIMS_REL = "claims/claims-draft.v3.json";
const CAPTURE_REL = "claims/sources/capture-manifest.json";
const MANIFEST_REL = "units/units2/manifest.json";

/** All fault names the synthetic stream understands. */
export const FAULT_NAMES = [
  "preexisting-claims-list",
  "preexisting-assignment",
  "preexisting-instructions",
  "preexisting-p05-check",
  "preexisting-jsonl",
  "preexisting-join-draft",
  "preexisting-envelope",
  "stale-box",
  "store-lock",
  "join-regular-file",
  "missing-claims",
  "missing-manifest",
  "missing-payload",
  "missing-capture",
  "bad-identity",
  "byte-len-mismatch",
  "opaque-unit",
  "empty-claims",
  "duplicate-unit-id",
  "duplicate-payload-basename",
  "empty-statement",
  "whitespace-statement",
  "capture-review-state-newline",
  "capture-subject-oid",
  "non-ascii-claims",
];

const FAULTS = {
  "preexisting-claims-list"(runRoot) {
    writeText(runRoot, "join/claims-list.json", "[]\n");
  },
  "preexisting-assignment"(runRoot) {
    writeJson(runRoot, "join/box-0000.assignment.json", { preexisting: true });
  },
  "preexisting-instructions"(runRoot) {
    writeText(runRoot, "join/box-0000.instructions.md", "preexisting instructions\n");
  },
  "preexisting-p05-check"(runRoot) {
    writeJson(runRoot, "join/box-0099.p05-check.json", { preexisting: true });
  },
  "preexisting-jsonl"(runRoot) {
    writeText(runRoot, "join/box-0000.jsonl", "preexisting child output\n");
  },
  "preexisting-join-draft"(runRoot) {
    writeJson(runRoot, "join/join-draft.v1.json", { schema_version: "join-draft/1", preexisting: true });
  },
  "preexisting-envelope"(runRoot) {
    writeJson(runRoot, "run-manifest.json", { schema_version: "run-manifest/1", preexisting: true });
  },
  "store-lock"(runRoot) {
    writeText(runRoot, ".p0-pack.lock", "{\"pid\":1,\"utc\":\"preexisting\"}\n");
  },
  "join-regular-file"(runRoot) {
    writeText(runRoot, "join", "join is a regular file, not a directory\n");
  },
  "stale-box"(runRoot) {
    writeJson(runRoot, "join/box-0099.assignment.json", { preexisting: true });
    writeText(runRoot, "join/box-0099.instructions.md", "stale box\n");
  },
  "missing-claims"(runRoot) {
    rmSync(path.join(runRoot, CLAIMS_REL), { force: true });
  },
  "missing-manifest"(runRoot) {
    rmSync(path.join(runRoot, MANIFEST_REL), { force: true });
  },
  "missing-payload"(runRoot) {
    rmSync(path.join(runRoot, "units/units2/u0000.txt"), { force: true });
  },
  "missing-capture"(runRoot) {
    rmSync(path.join(runRoot, CAPTURE_REL), { force: true });
  },
  "bad-identity"(runRoot) {
    editJson(runRoot, CAPTURE_REL, (capture) => { capture.run = "fixture/p0-pack-no-number"; });
  },
  "byte-len-mismatch"(runRoot) {
    editJson(runRoot, MANIFEST_REL, (manifest) => { manifest.units[0].byte_len += 1; });
  },
  "opaque-unit"(runRoot) {
    editJson(runRoot, MANIFEST_REL, (manifest) => { manifest.units[0].boundary_kind = "opaque"; });
  },
  "empty-claims"(runRoot) {
    editJson(runRoot, CLAIMS_REL, (draft) => { draft.claims = []; });
  },
  "duplicate-unit-id"(runRoot) {
    editJson(runRoot, MANIFEST_REL, (manifest) => { manifest.units[1].unit_id = manifest.units[0].unit_id; });
  },
  "duplicate-payload-basename"(runRoot) {
    editJson(runRoot, MANIFEST_REL, (manifest) => { manifest.units[1].file = manifest.units[0].file; });
  },
  "empty-statement"(runRoot) {
    editJson(runRoot, CLAIMS_REL, (draft) => { draft.claims[0].statement = ""; });
  },
  "whitespace-statement"(runRoot) {
    editJson(runRoot, CLAIMS_REL, (draft) => { draft.claims[0].statement = "  \t "; });
  },
  "capture-review-state-newline"(runRoot) {
    editJson(runRoot, CAPTURE_REL, (capture) => { capture.review_state = "s1\ns2"; });
  },
  "capture-subject-oid"(runRoot) {
    editJson(runRoot, CAPTURE_REL, (capture) => { capture.subject_oid = "not-40-lowercase-hex"; });
  },
  "non-ascii-claims"(runRoot) {
    editJson(runRoot, CLAIMS_REL, (draft) => {
      draft.claims = [
        { id: "C01", statement: "caf\u00e9" },
        { id: "C02", statement: "clef \u{1d11e}" },
      ];
    });
  },
};

/** Inject one named fault into an already-materialized synthetic run root. */
export function applyFault(runRoot, name) {
  const fn = FAULTS[name];
  if (!fn) throw new Error(`unknown fault: ${name}`);
  fn(runRoot);
  return runRoot;
}

/** A deterministic diff-shaped payload of exactly `size` UTF-8 bytes. */
export function payloadBytes(index, size) {
  const header = `diff --git a/src/f${index}.mjs b/src/f${index}.mjs\n@@ -1,1 +1,1 @@\n+`;
  const pad = size - Buffer.byteLength(header, "utf8");
  if (pad < 0) throw new Error(`unitBytes too small for the payload header: ${size}`);
  return Buffer.from(header + "x".repeat(pad), "utf8");
}

/**
 * Materialize a synthetic pre-pack store and return its absolute run root (a fresh temp
 * dir; clean with cleanupTempDirs()). Opaque units come from the `opaque-unit` fault, not
 * from arguments, so the default stream packs every unit.
 */
export function packStream(label = "p0-pack", { unitCount = 6, unitBytes = 40000, fault = null } = {}) {
  const runRoot = tempDir(`pack-${label}`);
  const claims = [];
  const claimsCount = 3;
  for (let i = 0; i < claimsCount; i++) {
    claims.push({ id: `C0${i + 1}`, statement: `The change keeps behavior ${i + 1} stable.` });
  }
  const units = [];
  for (let i = 0; i < unitCount; i++) {
    const id = `u${String(i).padStart(4, "0")}`;
    const file = `${id}.txt`;
    const bytes = payloadBytes(i, unitBytes);
    writeBytes(runRoot, `units/units2/${file}`, bytes);
    units.push({
      unit_id: id,
      file: `units2/${file}`,
      path: `src/f${i}.mjs`,
      ranges: [{ old_start: 1, old_count: 1, new_start: 1, new_count: 1 }],
      hunk_count: 1,
      byte_len: bytes.length,
      blocks: 1,
      boundary_kind: "hunk",
    });
  }
  writeJson(runRoot, MANIFEST_REL, {
    schema_version: "code-units-sim/3",
    recipe: { chunker: "chunker.mjs", target_bytes: 4096, ceiling_bytes: 6144, context: 3, block_preference: true },
    identity: {
      repo: "/tmp/fixture/p0-pack",
      base_ref: "b".repeat(40),
      subject_ref: "c".repeat(40),
      base_oid: "b".repeat(40),
      subject_oid: "c".repeat(40),
    },
    counts: { units: units.length, files: units.length, line_split_units: 0, total_bytes: units.length * unitBytes, opaque_occurrences: 0, opaque_bytes: 0 },
    units,
  });
  writeJson(runRoot, CLAIMS_REL, { schema_version: "claims-draft/3", claims });
  writeJson(runRoot, CAPTURE_REL, {
    run: "fixture/p0-pack#7",
    review_state: "s1",
    cure_light_source_head_oid: "d".repeat(40),
    subject_oid: "c".repeat(40),
    base_oid: "b".repeat(40),
    subject_path: "/tmp/fixture/p0-pack",
    sources: [],
  });
  if (fault) applyFault(runRoot, fault);
  return runRoot;
}

/**
 * Copy the recorded s1 store and return the corrected-render pins. The copy includes the
 * recorded `join/`; replay callers delete it (a replay generates all 13 outputs from the
 * recorded inputs instead of overwriting a populated copy, and the strict overwrite guard
 * refuses while child/p05 artifacts exist). The source is never modified.
 */
export function baselineStream({ src = BASELINE_STORE_DEFAULT, destParent = null } = {}) {
  if (!existsSync(src)) throw new Error(`baseline store not found: ${src} (set CURE_LIGHT_BASELINE_STORE)`);
  const base = destParent ?? tempDir("pack-baseline");
  mkdirSync(base, { recursive: true });
  const runRoot = path.join(base, "run");
  cpSync(src, runRoot, { recursive: true });
  return { runRoot, source: src, pins: { ...BASELINE_PINS, store: src } };
}

// ---------------------------------------------------------------- CLI ----

function copyToDest(runRoot, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(runRoot, dest, { recursive: true });
  return dest;
}

function flagValue(tokens, name) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens.at(i) === name) return i + 1 < tokens.length ? tokens.at(i + 1) : "";
    if (tokens.at(i).indexOf(name + "=") === 0) return tokens.at(i).slice(name.length + 1);
  }
  return "";
}

function main(argv) {
  const [stream, dest, ...rest] = argv;
  if (stream === "list" || stream === undefined) {
    console.log("streams: pack, baseline");
    console.log("faults: " + FAULT_NAMES.join(", "));
    return 0;
  }
  if (!dest) {
    console.error("usage: streams.mjs <pack|baseline> <dest> [--units N] [--unit-bytes N] [--fault NAME] [--src DIR]");
    return 2;
  }
  if (stream === "pack") {
    const unitCount = Number(flagValue(rest, "--units") || "6");
    const unitBytes = Number(flagValue(rest, "--unit-bytes") || "40000");
    const fault = flagValue(rest, "--fault") || null;
    const runRoot = packStream("cli", { unitCount, unitBytes, fault });
    console.log("pack" + (fault ? ` (${fault})` : "") + " -> " + copyToDest(runRoot, dest));
    return 0;
  }
  if (stream === "baseline") {
    const src = flagValue(rest, "--src") || BASELINE_STORE_DEFAULT;
    const { runRoot } = baselineStream({ src });
    const moved = copyToDest(runRoot, dest);
    console.log("baseline (" + src + ") -> " + moved);
    return 0;
  }
  console.error(`unknown stream: ${stream}`);
  return 2;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (invoked) process.exit(main(process.argv.slice(2)));
