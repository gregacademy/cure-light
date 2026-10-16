// workflows/p0/fixtures/streams.mjs — input streams for the P0 workflow tests.
//
// Two streams:
//   synthetic(label?, {boxes, fault}) — engine testkit seed, split into boxes and reduced
//     to the pre-close state (no merged draft, no envelope); optional single fault.
//   baseline({src, dest}) — copy of a captured run store plus the original output pins
//     for byte-equality acceptance.
//
// CLI:
//   node workflows/p0/fixtures/streams.mjs list
//   node workflows/p0/fixtures/streams.mjs synthetic <dest> [--boxes 1|2] [--fault NAME]
//   node workflows/p0/fixtures/streams.mjs baseline  <dest> [--src DIR]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  artifactSha,
  editJson,
  materializeRun,
  readBoxRows,
  readBytes,
  readJson,
  splitIntoTwoBoxes,
  tempDir,
  writeBoxRows,
  writeJson,
} from "../../../kernel/tools/verify-testkit.mjs";

export const BASELINE_STORE_DEFAULT =
  process.env.CURE_LIGHT_BASELINE_STORE ??
  "/workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1";

const BOX_0000 = "join/box-0000.jsonl";
const BOX_0001 = "join/box-0001.jsonl";
const BOX_0000_ASSIGNMENT = "join/box-0000.assignment.json";
const BOX_0000_INSTRUCTIONS = "join/box-0000.instructions.md";
const JOIN_DRAFT = "join/join-draft.v1.json";
const RUN_MANIFEST = "run-manifest.json";

/**
 * Derive a legal greedy two-box packing of the seed inventory.
 *
 * The verifier rejects a current box that could have held its neighbour's first unit
 * (`join.budget`, J8), and a two-box packing is only greedy when the prefix fills box-0000
 * while the remainder still fits the same ceiling. The seed inventory is smaller than the
 * seed's 196608-byte pilot ceiling, so a greedy split needs a derived ceiling: pick the
 * split index nearest the middle whose remainder is smaller than the next prefix, then set
 * the ceiling so box-0001's input exactly fills it (box-0000 then has less headroom than
 * the next unit needs).
 */
function greedySplit(runRoot) {
  const manifest = readJson(runRoot, "units/units2/manifest.json");
  const byteLen = new Map(manifest.units.map((unit) => [unit.unit_id, unit.byte_len]));
  const ids = readBoxRows(runRoot, BOX_0000).map((row) => row.unit_id);
  const total = ids.reduce((sum, id) => sum + byteLen.get(id), 0);
  const assignment = readJson(runRoot, BOX_0000_ASSIGNMENT);
  const fixed = assignment.claims_list_bytes + readBytes(runRoot, BOX_0000_INSTRUCTIONS).length;
  let prefix = 0;
  let best = null;
  for (let index = 1; index < ids.length; index++) {
    prefix += byteLen.get(ids[index - 1]);
    const rest = total - prefix;
    const next = byteLen.get(ids[index]);
    if (rest >= prefix + next) continue; // the next unit would still fit: not greedy
    const score = Math.abs(index - ids.length / 2);
    if (best === null || score < best.score) best = { splitIndex: index, ceiling: rest + fixed, score };
  }
  if (best === null) throw new Error("no greedy two-box split exists for this seed inventory");
  return { splitIndex: best.splitIndex, ceiling: best.ceiling };
}

/** All fault names the synthetic stream understands. */
export const FAULT_NAMES = [
  "duplicate-pair",
  "row-order",
  "unknown-claim",
  "bad-witness",
  "missing-row",
  "preexisting-draft",
];

const FAULTS = {
  "duplicate-pair"(runRoot) {
    const rows = readBoxRows(runRoot, BOX_0000);
    const row = rows.find((candidate) => candidate.links.length > 0);
    if (!row) throw new Error("fixture has no links to duplicate");
    row.links.push(structuredClone(row.links[0]));
    writeBoxRows(runRoot, BOX_0000, rows);
  },
  "row-order"(runRoot) {
    const rows = readBoxRows(runRoot, BOX_0000);
    if (rows.length < 2) throw new Error("fixture needs at least two rows");
    const first = rows[0];
    rows[0] = rows[1];
    rows[1] = first;
    writeBoxRows(runRoot, BOX_0000, rows);
  },
  "unknown-claim"(runRoot) {
    const rows = readBoxRows(runRoot, BOX_0000);
    const row = rows.find((candidate) => candidate.links.length > 0);
    if (!row) throw new Error("fixture has no links");
    row.links[0].claim_id = "C99";
    writeBoxRows(runRoot, BOX_0000, rows);
  },
  "bad-witness"(runRoot) {
    const rows = readBoxRows(runRoot, BOX_0000);
    const row = rows.find((candidate) => candidate.links.length > 0);
    if (!row) throw new Error("fixture has no links");
    row.links[0].witness = "workflow-fixture-absent-witness";
    writeBoxRows(runRoot, BOX_0000, rows);
  },
  "missing-row"(runRoot) {
    const rows = readBoxRows(runRoot, BOX_0000);
    if (rows.length < 2) throw new Error("fixture needs at least two rows");
    rows.pop();
    writeBoxRows(runRoot, BOX_0000, rows);
  },
  "preexisting-draft"(runRoot) {
    writeJson(runRoot, JOIN_DRAFT, { preexisting: true });
  },
};

/** Inject one named fault into an already-materialized synthetic run root. */
export function applyFault(runRoot, name) {
  const fn = FAULTS[name];
  if (!fn) throw new Error(`unknown fault: ${name}`);
  fn(runRoot);
  return runRoot;
}

/**
 * Materialize the synthetic stream in the pre-close state.
 * Returns the absolute run root (a fresh temp dir; clean with cleanupTempDirs()).
 */
export function syntheticStream(label = "p0-close", { boxes = 2, fault = null } = {}) {
  const runRoot = materializeRun(label);
  if (boxes === 2) {
    // A two-box stream must be a legal greedy packing, so the split is greedy and the
    // ceiling is the one that makes it greedy (see greedySplit); the seed's own ceiling
    // only fits the whole inventory in a single box.
    const { splitIndex, ceiling } = greedySplit(runRoot);
    editJson(runRoot, BOX_0000_ASSIGNMENT, (assignment) => { assignment.input_ceiling_bytes = ceiling; });
    splitIntoTwoBoxes(runRoot, splitIndex);
    // splitIntoTwoBoxes leaves a single shared instructions file; make the common
    // per-box layout explicit and drop the seed's single-box global p05 records.
    cpSync(path.join(runRoot, "join/box-0000.instructions.md"), path.join(runRoot, "join/box-0001.instructions.md"));
    rmSync(path.join(runRoot, "join/p05-check.json"), { force: true });
    rmSync(path.join(runRoot, "join/p05-evidence.json"), { force: true });
  } else if (boxes !== 1) {
    throw new Error(`boxes must be 1 or 2, got ${boxes}`);
  }
  // Pre-close state: boxes and p05 exist; merged draft and envelope do not.
  rmSync(path.join(runRoot, RUN_MANIFEST), { force: true });
  rmSync(path.join(runRoot, JOIN_DRAFT), { force: true });
  if (fault) applyFault(runRoot, fault);
  return runRoot;
}

/**
 * Copy the captured baseline store and read the original output pins.
 * Returns {runRoot, source, pins:{draft, envelope, p05:{name:sha}}}.
 */
export function baselineStream({ src = BASELINE_STORE_DEFAULT, destParent = null } = {}) {
  if (!existsSync(src)) throw new Error(`baseline store not found: ${src} (set CURE_LIGHT_BASELINE_STORE)`);
  const base = destParent ?? tempDir("baseline");
  mkdirSync(base, { recursive: true });
  const runRoot = path.join(base, "run");
  cpSync(src, runRoot, { recursive: true });
  const pins = {
    draft: artifactSha(src, JOIN_DRAFT),
    envelope: artifactSha(src, RUN_MANIFEST),
    p05: {},
  };
  for (const name of readdirSync(path.join(src, "join"))) {
    if (/^box-.*\.p05-(check|evidence)\.json$/.test(name)) {
      pins.p05[name] = artifactSha(src, path.join("join", name));
    }
  }
  return { runRoot, source: src, pins };
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
    console.log("streams: synthetic, baseline");
    console.log("faults: " + FAULT_NAMES.join(", "));
    return 0;
  }
  if (!dest) {
    console.error("usage: streams.mjs <synthetic|baseline> <dest> [--boxes N] [--fault NAME] [--src DIR]");
    return 2;
  }
  if (stream === "synthetic") {
    const boxes = Number(flagValue(rest, "--boxes") || "2");
    const fault = flagValue(rest, "--fault") || null;
    const runRoot = syntheticStream("cli", { boxes, fault });
    console.log("synthetic" + (fault ? ` (${fault})` : "") + " -> " + copyToDest(runRoot, dest));
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
