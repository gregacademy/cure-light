// workflows/pack/fixtures/generate.mjs — materialize the input/output fixture trees on disk.
//
// The test suite generates its stores in temp dirs; this script produces the same stores as
// browsable trees under workflows/pack/fixtures/generated/ (gitignored — the payloads are
// hundreds of KiB per variant). Each variant is a complete pre-pack store that has then been
// driven through workflows/pack/p0-pack.js once, so it holds both sides of the contract:
//
//   <variant>/claims/**, units/units2/**          the recorded inputs
//   <variant>/join/**                             the produced outputs (claims-list, assignments,
//                                                 instructions)
//
// No test reads this directory; regeneration is always safe.
//
//   node workflows/pack/fixtures/generate.mjs [--dest DIR] [--only NAME]
//   node workflows/pack/fixtures/generate.mjs --list
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanupTempDirs } from "../../../kernel/tools/verify-testkit.mjs";
import { runDraft } from "../testkit.mjs";
import { packStream } from "./streams.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GENERATED_DEFAULT = path.join(HERE, "generated");

/** The browsable variants: name, packStream options, and the ceiling used for the run. */
export const FIXTURE_VARIANTS = [
  { name: "two-box", options: { unitCount: 6, unitBytes: 40000 }, ceiling: 130000 },
  { name: "single-box", options: { unitCount: 6, unitBytes: 40000 }, ceiling: 300000 },
  { name: "opaque-unit", options: { unitCount: 6, unitBytes: 40000, fault: "opaque-unit" }, ceiling: 130000 },
];

function treeBytes(root) {
  let bytes = 0;
  let files = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = treeBytes(abs);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      bytes += statSync(abs).size;
      files += 1;
    }
  }
  return { bytes, files };
}

/** Materialize one variant under `destRoot` and drive the draft over it once. */
export function generateVariant(variant, destRoot) {
  const dest = path.join(destRoot, variant.name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  const origin = packStream(`gen-${variant.name}`, variant.options);
  try {
    cpSync(origin, dest, { recursive: true });
  } finally {
    cleanupTempDirs();
  }
  const result = runDraft(dest, { ceiling: variant.ceiling });
  if (result.error) throw new Error(`${variant.name}: ${result.error.message ?? result.error}`);
  if (result.exit?.reason !== "ok") throw new Error(`${variant.name}: expected ok, got ${result.exit?.reason}`);
  const { bytes, files } = treeBytes(dest);
  return {
    name: variant.name,
    dest,
    files,
    bytes,
    boxes: Array.isArray(result.exit.boxes) ? result.exit.boxes.length : 0,
    units: result.exit.units,
    opaque: result.exit.opaque_units,
    promoted: result.exit.promoted.length,
    skipped: result.exit.skipped.length,
  };
}

function main(argv) {
  let destRoot = GENERATED_DEFAULT;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv.at(i) === "--dest") destRoot = path.resolve(argv.at(++i));
    else if (argv.at(i) === "--only") only = argv.at(++i);
    else if (argv.at(i) === "--list") {
      for (const variant of FIXTURE_VARIANTS) console.log(`${variant.name}  ceiling=${variant.ceiling}  ${JSON.stringify(variant.options)}`);
      return 0;
    } else {
      console.error(`unknown option: ${argv.at(i)}`);
      return 2;
    }
  }
  const picked = only ? FIXTURE_VARIANTS.filter((variant) => variant.name === only) : FIXTURE_VARIANTS;
  if (picked.length === 0) {
    console.error(`unknown variant: ${only} (expected ${FIXTURE_VARIANTS.map((variant) => variant.name).join(", ")})`);
    return 2;
  }
  for (const variant of picked) {
    const report = generateVariant(variant, destRoot);
    console.log(
      `${report.name.padEnd(12)} -> ${report.dest}  files=${report.files} bytes=${report.bytes} `
      + `boxes=${report.boxes} units=${report.units} opaque=${report.opaque} promoted=${report.promoted} skipped=${report.skipped}`,
    );
  }
  cleanupTempDirs();
  return 0;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (invoked) process.exit(main(process.argv.slice(2)));
