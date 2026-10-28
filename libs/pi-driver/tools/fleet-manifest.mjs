#!/usr/bin/env node
// Optional transport adapter. Full source bytes stay on disk; stdout is one bounded projection.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULTS = Object.freeze({ indexMaxBytes: 12 * 1024, laneMaxBytes: 16 * 1024, maxLines: 500 });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

class FleetManifestError extends Error {
  constructor(code) {
    super(`HOLD fleet-manifest: ${code}`);
    this.code = code;
  }
}
const hold = (code) => { throw new FleetManifestError(code); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function encode(value, maxBytes, maxLines, code) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const bytes = Buffer.byteLength(text, "utf8");
  // Count the final empty line too, matching tools.read's display-line accounting.
  const lines = text.split("\n").length;
  if (bytes > maxBytes || lines > maxLines) hold(code);
  return { text, bytes, lines };
}

// Run only after JSON syntax validation. Match whole strings so punctuation in values is inert.
function rejectDuplicateKeys(text) {
  const stack = [];
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g)) {
    const current = stack.at(-1);
    if (token === "{") stack.push({ keys: new Set(), key: true });
    else if (token === "[") stack.push({ keys: null });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && current?.keys) current.key = true;
    else if (token.startsWith('"') && current?.keys && current.key) {
      const key = JSON.parse(token);
      if (current.keys.has(key)) hold("DUPLICATE_KEY");
      current.keys.add(key);
      current.key = false;
    }
  }
}

/**
 * Read one exact-byte, hash-pinned snapshot. Returned methods emit only complete bounded JSON.
 * This checks transport/identity, not semantic coverage, model budgets or dispatch permission.
 * Limits may be lowered, never raised above the safe defaults.
 */
export function openFleetManifest(file, expectedSha256, limits = {}) {
  if (!isObject(limits) || Object.keys(limits).some((key) => !Object.hasOwn(DEFAULTS, key))) hold("INVALID_LIMITS");
  const caps = { ...DEFAULTS, ...limits };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Number.isSafeInteger(caps[key]) || caps[key] < 1 || caps[key] > DEFAULTS[key]) hold("INVALID_LIMITS");
  }
  if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) hold("INVALID_SOURCE_HASH");
  let bytes;
  try { bytes = readFileSync(file); } catch { hold("SOURCE_UNREADABLE"); }
  if (sha256(bytes) !== expectedSha256) hold("SOURCE_HASH_MISMATCH");
  let text;
  // Do not silently replace malformed UTF-8 or strip a BOM before JSON validation.
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { hold("INVALID_UTF8"); }
  let document;
  // Node 22+ preserves numeric source tokens: do not round large integers, turn overflow
  // into null, or erase negative zero while making derived selections.
  if (typeof JSON.rawJSON !== "function") hold("UNSUPPORTED_RUNTIME");
  try {
    document = JSON.parse(text, (_key, value, context) => {
      if (typeof value !== "number") return value;
      if (typeof context?.source !== "string") hold("UNSUPPORTED_RUNTIME");
      return JSON.rawJSON(context.source);
    });
  } catch (error) {
    if (error instanceof FleetManifestError) throw error;
    hold("INVALID_JSON");
  }
  rejectDuplicateKeys(text);
  if (!isObject(document) || !Array.isArray(document.lanes)) hold("INVALID_LANES");
  const ids = new Set();
  for (const lane of document.lanes) {
    if (!isObject(lane) || typeof lane.id !== "string" || !lane.id.trim() || ids.has(lane.id)
      || lane.id.includes("\0") || Buffer.from(lane.id, "utf8").toString("utf8") !== lane.id) hold("INVALID_LANES");
    ids.add(lane.id);
  }
  const source = { sha256: expectedSha256, bytes: bytes.length };
  const { lanes, ...frame } = document;
  const selection = (ordinal) => encode({
    schema: "fleet-manifest-lane/1", source, ordinal, lane: lanes[ordinal],
  }, caps.laneMaxBytes, caps.maxLines, "LANE_LIMIT");

  return Object.freeze({
    index() {
      // Validate every lane's transport before returning a complete directory. No dropped lanes.
      const entries = lanes.map((lane, ordinal) => {
        const result = selection(ordinal);
        return { id: lane.id, ordinal, sha256: sha256(result.text), bytes: result.bytes, lines: result.lines };
      });
      return encode({ schema: "fleet-manifest-index/1", source, frame, lanes: entries },
        caps.indexMaxBytes, caps.maxLines, "INDEX_LIMIT").text;
    },
    lane(id) {
      const ordinal = lanes.findIndex((lane) => lane.id === id);
      if (ordinal < 0) hold("LANE_NOT_FOUND");
      return selection(ordinal).text;
    },
  });
}

function main(args) {
  const [mode, file, hash, id] = args;
  if (!((mode === "index" && args.length === 3) || (mode === "lane" && args.length === 4))) {
    process.stderr.write('{"status":"HOLD","code":"USAGE"}\n');
    return 2;
  }
  try {
    const reader = openFleetManifest(file, hash);
    const result = mode === "index" ? reader.index() : reader.lane(id);
    process.stdout.write(result); // Buffer fully validated before the first output byte.
    return 0;
  } catch (error) {
    const code = error instanceof FleetManifestError ? error.code : "READER_ERROR";
    process.stderr.write(`${JSON.stringify({ status: "HOLD", code })}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
