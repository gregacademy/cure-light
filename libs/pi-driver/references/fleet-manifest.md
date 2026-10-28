# Bounded fleet-manifest reader

A whole fleet JSON can exceed a tool's 50 KiB / 2000-line display limit. Do not parse that tool return. The optional `libs/pi-driver/tools/fleet-manifest.mjs` reads the exact source bytes on disk, checks their approved SHA-256, and emits one complete bounded JSON projection. It requires Node 22+ and no dependencies.

## Invocation

Use an engine checkout or fetch the executable's exact bytes at the recorded `cure_light_source_head_oid`. Record its path and SHA-256 at that engine source, as for the other pinned tools. Do not fetch executable source into coordinator context or use subject-tree code as the engine reader. This optional tool does not change the remote boot set.

```sh
node /pinned/engine/libs/pi-driver/tools/fleet-manifest.mjs index /durable/run/fleet.json APPROVED_SOURCE_SHA256
node /pinned/engine/libs/pi-driver/tools/fleet-manifest.mjs lane /durable/run/fleet.json APPROVED_SOURCE_SHA256 LANE_ID
```

`APPROVED_SOURCE_SHA256` is the recorded lowercase 64-hex digest, not a new digest computed to accept an unexpected edit. Keep the durable source path with that digest in the state record. Both commands reread and hash the full disk source before parsing. Quote paths and IDs when using a shell.

- `index` returns `fleet-manifest-index/1`: source `{sha256, bytes}`, `frame` (every root field except `lanes`), and the ordered lane directory. Each entry has `id`, `ordinal`, and the SHA-256, UTF-8 bytes and display lines of the exact lane command output, including its final newline. Index construction checks that every lane fits; no lane is omitted.
- `lane` returns `fleet-manifest-lane/1`: the same source identity, `ordinal`, and the complete `lane` object. Selection is by exact string ID, not array position. Unknown fields are retained. Numbers retain their original JSON tokens, including large integers and exponents; downstream numeric interpretation still needs a lossless parser if those values matter.
- The source must be a JSON object with a `lanes` array of objects. Each lane needs a unique, nonblank string `id` that can cross UTF-8 process arguments (no NUL or lone surrogate). Duplicate object member names at any depth are rejected, including escape-equivalent names. Invalid UTF-8 and invalid JSON are rejected.

Default limits apply to the **complete serialized return**, including wrappers and newline:

| Return | UTF-8 bytes | Display lines |
|---|---:|---:|
| Index | 12 KiB | 500 |
| Lane | 16 KiB | 500 |

Display lines include the final empty line, as tools.read does. Limits stay below both independent platform caps. If a lane, directory or root frame is too large, the reader HOLDs. It does not paginate this case automatically: prepare a separately pinned split or a bounded source-specific reader, then retry. Never remove proof fields or silently skip lanes to make a return fit.

Success writes one JSON document to stdout and exits 0. A data/limit failure exits 1, leaves stdout empty, and writes a small `{"status":"HOLD","code":"..."}` JSON record to stderr. Invalid command syntax exits 2 with `USAGE`. Errors do not echo source content. Common codes are `SOURCE_HASH_MISMATCH`, `SOURCE_UNREADABLE`, `INVALID_JSON`, `INVALID_UTF8`, `DUPLICATE_KEY`, `INVALID_LANES`, `LANE_NOT_FOUND`, `INDEX_LIMIT`, and `LANE_LIMIT`.

## Consumption and authority

Retain the index's exact output bytes. Read every required lane separately; verify each return's source identity, ID, ordinal, output hash, bytes and lines against that index. A missing, stale, clipped or mismatched return is HOLD, never an empty lane. Counts alone are not complete consumption. No command emits the whole fleet, even when carried fields say `dispatch_ready: true`.

`{ ...index.frame, lanes: selections.map(selection => selection.lane) }` reconstructs the parsed manifest fields, but its serialization is **not** the authoritative source bytes. Keep the exact original source and hash through closure; see [the notebook plan contract](notebook-plan-contract.md). These projections neither replace byte-exact source evidence nor relocate V1 notebook authority.

The reader checks transport and mechanical identity only. It does not read referenced prompts/reports, validate lane scope or model budgets, reserve capacity, spawn reviewers, or approve dispatch. Existing gates and required model groups remain binding.

## Library and development checks

`openFleetManifest(path, expectedSha256, limits?)` returns `{index(), lane(id)}` methods that return complete serialized JSON strings. It holds one pinned in-memory snapshot; reopen to check disk freshness. Optional `indexMaxBytes`, `laneMaxBytes`, and `maxLines` limits can only lower the defaults. No API returns the unbounded source document.

```sh
node --test libs/pi-driver/test/fleet-manifest.test.mjs
node workflows/run.mjs fast
node --test kernel/tools/verify.docs.test.mjs
```

The self-contained acceptance test builds 13 synthetic lanes, exceeds both display limits, demonstrates an incomplete unbounded JSON read, and checks full reconstruction through capped CLI returns. It uses no private review data or model calls. It runs in the default fast tier, not the opt-in frozen-baseline acceptance tier. Other cases check stale pins, invalid sources, selectors, indivisible overflow, exact UTF-8/line boundaries, numeric fidelity, duplicate keys and source-byte preservation.
