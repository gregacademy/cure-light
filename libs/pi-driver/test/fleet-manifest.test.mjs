import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const readerModule = () => import("../tools/fleet-manifest.mjs");

const TOOL = fileURLToPath(new URL("../tools/fleet-manifest.mjs", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lines = (text) => text.split("\n").length; // Include the trailing empty line, as tools.read does.

function fixture(value) {
  const dir = mkdtempSync(path.join(tmpdir(), "cure-light-fleet-reader-"));
  const file = path.join(dir, "fleet.json");
  const bytes = Buffer.from(typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(file, bytes);
  return { file, bytes, hash: sha256(bytes) };
}

function cli(mode, source, id) {
  return spawnSync(process.execPath, [TOOL, mode, source.file, source.hash, ...(id === undefined ? [] : [id])], {
    encoding: "utf8",
    timeout: 10000,
  });
}

// Faithful to the independent tools.read limits; an incomplete JSON prefix is not a document.
function toolRead(text) {
  return Buffer.from(text).subarray(0, 50 * 1024).toString("utf8").split("\n").slice(0, 2000).join("\n");
}

function parseReturn(result, maxBytes) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(Buffer.byteLength(result.stdout) <= maxBytes);
  assert.ok(lines(result.stdout) <= 500);
  assert.equal(toolRead(result.stdout), result.stdout);
  return JSON.parse(toolRead(result.stdout));
}

test("acceptance: oversized fleet crosses capped transport only as complete, hash-bound selections", () => {
  const value = {
    schema: "synthetic-fleet/1",
    subject: "a".repeat(40),
    dispatch_ready: true, // Carried data is not an approval from this reader.
    unknown_root: { preserved: ["future", "fields"] },
    lanes: Array.from({ length: 13 }, (_, ordinal) => ({
      id: `lane-${ordinal}`,
      group: "synthetic-only",
      unknown_lane: { ordinal },
      records: Array.from({ length: 36 }, (_, index) => ({
        id: `${ordinal}:${index}`,
        evidence: `synthetic evidence ${"é".repeat(60)}`,
        required: true,
      })),
    })),
  };
  const source = fixture(value);
  assert.ok(source.bytes.length > 50 * 1024);
  assert.ok(lines(source.bytes.toString("utf8")) > 2000);
  assert.throws(() => JSON.parse(toolRead(source.bytes.toString("utf8"))));

  const index = parseReturn(cli("index", source), 12 * 1024);
  assert.equal(index.schema, "fleet-manifest-index/1");
  assert.deepEqual(index.source, { sha256: source.hash, bytes: source.bytes.length });
  assert.equal(index.lanes.length, 13);
  const lanes = index.lanes.map((entry, ordinal) => {
    assert.equal(entry.ordinal, ordinal);
    const result = cli("lane", source, entry.id);
    const selection = parseReturn(result, 16 * 1024);
    assert.equal(entry.sha256, sha256(result.stdout));
    assert.equal(entry.bytes, Buffer.byteLength(result.stdout));
    assert.equal(entry.lines, lines(result.stdout));
    assert.equal(selection.schema, "fleet-manifest-lane/1");
    assert.deepEqual(selection.source, index.source);
    assert.equal(selection.ordinal, ordinal);
    assert.equal(selection.lane.id, entry.id);
    return selection.lane;
  });
  assert.deepEqual({ ...index.frame, lanes }, value);
  assert.deepEqual(readFileSync(source.file), source.bytes);
});

function hold(result, code) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "", "a refusal must not return a partial selection");
  assert.deepEqual(JSON.parse(result.stderr), { status: "HOLD", code });
  assert.ok(Buffer.byteLength(result.stderr) < 256);
}

test("CLI refuses stale, missing, malformed and truncated sources without echoing them", () => {
  const source = fixture({ lanes: [{ id: "one" }] });
  hold(cli("index", { ...source, hash: "0".repeat(64) }), "SOURCE_HASH_MISMATCH");
  hold(cli("index", { ...source, hash: "not-a-hash" }), "INVALID_SOURCE_HASH");
  hold(cli("index", { ...source, file: `${source.file}.missing` }), "SOURCE_UNREADABLE");
  for (const text of ['{"lanes":[', '{"secret":"never echo this",}', toolRead("{\n".repeat(30000))]) {
    hold(cli("index", fixture(text)), "INVALID_JSON");
  }
  writeFileSync(source.file, Buffer.from([0xff]));
  source.hash = sha256(readFileSync(source.file));
  hold(cli("index", source), "INVALID_UTF8");
});

test("CLI validates mechanical lane identity and exact selectors only", () => {
  for (const value of [null, [], {}, { lanes: {} }, { lanes: [null] },
    { lanes: [{ id: "" }] }, { lanes: [{ id: 1 }] }, { lanes: [{ id: "  " }] },
    { lanes: [{ id: "same" }, { id: "same" }] }]) {
    hold(cli("index", fixture(value)), "INVALID_LANES");
  }
  const source = fixture({ lanes: [{ id: "one" }] });
  hold(cli("lane", source, "missing"), "LANE_NOT_FOUND");
  hold(cli("lane", source, "0"), "LANE_NOT_FOUND");
  const usage = cli("unknown", source);
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, "");
  assert.equal(JSON.parse(usage.stderr).code, "USAGE");
});

test("indivisible lane and index overflow HOLD, never truncate or omit fields", () => {
  const tooManyLines = fixture({ lanes: [{ id: "one", records: Array.from({ length: 600 }, () => 0) }] });
  hold(cli("index", tooManyLines), "LANE_LIMIT");
  hold(cli("lane", tooManyLines, "one"), "LANE_LIMIT");
  const tooManyBytes = fixture({ lanes: [{ id: "one", evidence: "é".repeat(10000) }] });
  hold(cli("index", tooManyBytes), "LANE_LIMIT");
  hold(cli("lane", tooManyBytes, "one"), "LANE_LIMIT");
  hold(cli("index", fixture({ root: "x".repeat(13000), lanes: [] })), "INDEX_LIMIT");
  hold(cli("index", fixture({ lanes: Array.from({ length: 100 }, (_, i) => ({ id: `lane-${i}` })) })), "INDEX_LIMIT");
});

test("library counts exact UTF-8 bytes, final newline and display lines at cap boundaries", async () => {
  const { openFleetManifest } = await readerModule();
  const source = fixture({ future: true, lanes: [{ id: "one", text: "é😀\nquoted \"value\"" }] });
  const reader = openFleetManifest(source.file, source.hash);
  const lane = reader.lane("one");
  const index = reader.index();
  const laneBytes = Buffer.byteLength(lane);
  const indexBytes = Buffer.byteLength(index);
  assert.ok(laneBytes > lane.length);
  assert.ok(lane.endsWith("\n"));
  assert.equal(openFleetManifest(source.file, source.hash, { laneMaxBytes: laneBytes }).lane("one"), lane);
  assert.throws(() => openFleetManifest(source.file, source.hash, { laneMaxBytes: laneBytes - 1 }).lane("one"), /LANE_LIMIT/);
  assert.equal(openFleetManifest(source.file, source.hash, { indexMaxBytes: indexBytes }).index(), index);
  assert.throws(() => openFleetManifest(source.file, source.hash, { indexMaxBytes: indexBytes - 1 }).index(), /INDEX_LIMIT/);
  assert.equal(openFleetManifest(source.file, source.hash, { maxLines: lines(lane) }).lane("one"), lane);
  assert.throws(() => openFleetManifest(source.file, source.hash, { maxLines: lines(lane) - 1 }).lane("one"), /LANE_LIMIT/);
  for (const limits of [{ laneMaxBytes: 0 }, { maxLines: NaN }, { maxLines: 501 },
    { indexMaxBytes: 50001 }, { laneMaxBytes: 16385 }, { maxLines: 2.5 }, { typo: 1 }]) {
    assert.throws(() => openFleetManifest(source.file, source.hash, limits), /INVALID_LIMITS/);
  }
});

test("raw numeric tokens survive without rounding, overflow, underflow or negative-zero loss", () => {
  const source = fixture('{"root":9007199254740993,"lanes":[{"id":"one","values":[1e400,1e-4000,-0,0.10000000000000000001]}]}');
  const index = cli("index", source);
  const lane = cli("lane", source, "one");
  assert.equal(index.status, 0, index.stderr);
  assert.equal(lane.status, 0, lane.stderr);
  assert.match(index.stdout, /"root": 9007199254740993/);
  for (const token of ["1e400", "1e-4000", "-0", "0.10000000000000000001"]) {
    assert.ok(lane.stdout.includes(`      ${token}`), `missing exact numeric token ${token}`);
  }
});

test("duplicate JSON keys and IDs that cannot cross UTF-8 CLI arguments HOLD", () => {
  for (const text of [
    '{"lanes":[{"id":"lost"}],"lanes":[{"id":"kept"}]}',
    '{"lanes":[{"id":"one","id":"two"}]}',
    '{"lanes":[],"frame":{"a":1,"\\u0061":2}}',
    '{"lanes":[{"id":"one","nested":[{"__proto__":0,"__proto__":1}]}]}',
  ]) hold(cli("index", fixture(text)), "DUPLICATE_KEY");
  for (const id of ["nul\0id", "\ud800", "\udfff"]) {
    hold(cli("index", fixture({ lanes: [{ id }] })), "INVALID_LANES");
  }
  const source = fixture({ lanes: [{ id: "é😀", text: 'comma,colon:braces{} brackets[] escaped "quote"' }] });
  assert.equal(parseReturn(cli("lane", source, "é😀"), 16 * 1024).lane.id, "é😀");
});

test("unknown JSON keys survive; every new CLI read is bound to current exact source bytes", () => {
  const source = fixture('{"__proto__":{"preserve":true},"lanes":[{"id":"one","__proto__":{"also":true}}]}');
  const index = parseReturn(cli("index", source), 12 * 1024);
  const lane = parseReturn(cli("lane", source, "one"), 16 * 1024);
  assert.deepEqual({ ...index.frame, lanes: [lane.lane] }, JSON.parse(source.bytes));
  writeFileSync(source.file, `${source.bytes.toString("utf8")}\n`);
  hold(cli("index", source), "SOURCE_HASH_MISMATCH");
  hold(cli("lane", source, "one"), "SOURCE_HASH_MISMATCH");
});
