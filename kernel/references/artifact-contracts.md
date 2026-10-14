# artifact-contracts.md — recorded artifact field contracts

The compact, operator-facing field contracts for the Phase-0 recorded artifacts that the pinned mechanical verifier (`kernel/tools/verify.mjs`) reads. This page documents existing tool behavior; the tool remains the executable authority and no new CLI exists — there is no `verify describe` or `verify --schema` mode. Every example below is **synthetic and current-profile-specific**: copy the shape, never the values.

Read this page when preparing or repairing P0.2/P0.4 artifacts and when V1 validates/freezes claims. Reconcile a failure with the error→field map (§7) before changing anything: a repair fixes the recorded field to the recorded meaning, never the meaning to pass the check (protocol in §8).

## 1. Capture manifest — `claims/sources/capture-manifest.json`

The capture manifest is **schema-less**: identity, source pins and the changed-file inventory only. **Omit `schema_version`.**

In every case, any declared value is refused by `verify envelope` (exit 2, `REFUSE envelope: unsupported capture schema_version: ...`, no document emitted). If a declared value reaches a validator through the envelope capture pin or the capture file, a nonempty unknown or wrong-family declaration refuses exit 2 (`unsupported schema_version` / `wrong schema kind`), while an empty or wrong-typed declaration fails shape with exit 1 (`invalid field: /capture_manifest/schema_version expected nonempty string`). The envelope capture pin is likewise exactly `{ref, sha256}` — no `schema_version`.

| Field | Required | Type | Rule |
|---|---|---|---|
| `run` | yes | nonempty string | must equal the claims/units/envelope `run` |
| `review_state` | yes | nonempty string | must equal the review state everywhere |
| `base_oid`, `subject_oid` | yes | 40-char lowercase hex | identity tuple; must agree across artifacts |
| `cure_light_source_head_oid` | yes | 40-char lowercase hex | engine source identity; must agree |
| `sources[]` | yes | array | at least one captured source |
| `sources[].locator` | yes | nonempty string | joins the claims-draft `sources[].source_ref` |
| `sources[].path` | yes | path under `claims/` | exact source bytes, e.g. `sources/pr-body.md` |
| `sources[].capture_sha256` | yes | 64-char lowercase hex | sha256 of the exact bytes at `path` |
| `sources[].capture_byte_length` | yes | nonneg integer | length of the exact bytes at `path` |
| `sources[].title_path` | optional | path under `claims/` | declared title bytes, e.g. `sources/pr-title.txt` |
| `sources[].title_sha256`, `sources[].title_byte_length` | with `title_path` | hex / integer | exact title bytes |
| `sources[].class`, `role`, `designating_pointer`, `version_ref` | provenance | strings | recorded designation context, not cross-checked byte-wise |
| `changed_files[]`, `changed_files_count` | recorded | array / integer | base..subject changed-file inventory |

**Path bases (the most common repair).** In a capture manifest, `path` and `title_path` resolve relative to `claims/` (the directory above `sources/`). In a claims draft, claims-draft `sources[].path` resolves relative to the run root. A path written with the wrong base fails `artifact.read`; the capture-side wrong-base fingerprint is `cannot read artifact: claims/claims/...`, and a claims-side path written capture-style resolves against the run root and misses.

**Locator completeness.** The coordinator registers every `source_ref` it will prescribe to P0.2 as a `sources[].locator` before delegating; locators are unique. A declared `sources[].source_ref` with no matching locator is refused by `verify claims` as `source ref not captured: "<ref>"` and cannot be repaired by the claims child: the coordinator re-captures the missing source, re-pins the capture manifest and re-runs P0.2.

<!-- capture-manifest-example -->
```json
{
  "run": "owner/repo#1",
  "review_state": "s1",
  "cure_light_source_head_oid": "1111111111111111111111111111111111111111",
  "subject_oid": "2222222222222222222222222222222222222222",
  "base_oid": "3333333333333333333333333333333333333333",
  "sources": [
    {
      "locator": "pr:body",
      "class": "api-document",
      "role": "declares",
      "designating_pointer": "the PR body itself",
      "path": "sources/pr-body.md",
      "capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "capture_byte_length": 42,
      "title_path": "sources/pr-title.txt",
      "title_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "title_byte_length": 7
    }
  ],
  "changed_files": ["README.md"],
  "changed_files_count": 1
}
```

## 2. Claims draft — `claims/claims-draft.v3.json` (`claims-draft/3`)

The root's `schema_version: "claims-draft/3"` is required. A missing or empty value fails shape with exit 1 (`invalid field: /schema_version expected nonempty string`); an unknown value refuses exit 2 (`unsupported schema_version`); a registered value of another family refuses exit 2 (`wrong schema kind`). The envelope `claims_draft` pin must carry the same nonempty `schema_version`.

Identity: `run`, `review_state` (nonempty strings), `subject_oid`, `base_oid` (lowercase OIDs) must agree with the envelope. Nested profile:

- `sources[]`: `{source_ref, locator, path, role, sha256, byte_length [, blob_subject]}` — `path` is **run-root relative** (e.g. `claims/sources/pr-body.md`); `sha256`/`byte_length` must equal both the capture record (`capture_sha256`/`capture_byte_length` for the matching `locator`) and the actual bytes.
- `claims[]`: `{id, statement, source_ref, quote, also_in}`; `nonclaims[]`: `{id, statement, source_ref, quote, reason}`.
- `conflicts[]`: `{id, kind, materiality, quotes[{source_ref, quote, offset_bytes}], affected_claim_ids, precedence, witness, reasoning}`. `kind` is one of `within-source` or `cross-source`, and `materiality` is one of `material` or `non-material` — **structural enums only**; a richer semantic subtype belongs in `witness`/`reasoning`, never in `kind`. `precedence` is a required nonempty string; use `"none"` when no explicit precedence is stated. Violations fail fast on check `claims.conflicts` (`invalid conflict kind: "<id>": "<value>"` / `invalid conflict materiality: "<id>": "<value>"`), and a missing/empty `precedence` fails shape (`invalid field: /conflicts/<i>/precedence expected nonempty string`).
- `notes[]`: `{note}` (a quote-bearing note carries the defined optional `source_ref` + `quote` pair).
- `missing_source_candidates[]`: `{resource, affected_claim_ids, reference_quote, why_it_matters}`.

**Quote containment (verbatim rule).** Every recorded quote must be an exact UTF-8 byte substring of the captured source bytes — copy it byte-for-byte; never normalize, re-wrap, Markdown-clean or paraphrase it:
- `claims[]` / `nonclaims[]` `quote`: contained in its declared `source_ref` (`claims.quote`; `quote not in source: "<id>"`, or `unknown source ref: "<ref>"` when the ref is not a captured source).
- `conflicts[].quotes[]` `quote`: contained in its declared `source_ref` (`claims.conflicts`; `quote not in source: "<conflict id>"`), and a non-null `offset_bytes` must equal the exact **zero-based byte offset of the quote's first occurrence** in that source (`quote offset mismatch: "<conflict id>"`; `offset_bytes` is `null` or a nonneg integer, and a repeated occurrence later in the source never licenses a later offset).
- `notes[]` `quote` (with its paired `source_ref`): contained in that source (`claims.notes`; `note quote not in source: /notes/<i>`).
- `missing_source_candidates[].reference_quote`: contained in **any** captured source (`claims.candidates`; `candidate quote not in captured sources: <i>`) — the source is unidentified by definition, so this is the one quote not bound to a declared `source_ref`.

- `source_consistency`: optional; **omit the key rather than record an empty value**. When present it must be an object: `status` (optional; nonempty string when present), `records[]` (optional; array of objects whose `id` must be a nonempty string that **resolves to a recorded `conflicts[].id`** — an unresolved id fails `claims.conflicts` with `consistency record not found: "<id>"`), and `notes` (optional; nonempty string when present). Empty strings fail shape (`invalid field: /source_consistency/... expected nonempty string`); a wrong container or wrong-typed `records` fails shape (`expected object` / `expected array`).

One concrete valid conflict record (synthetic; `offset_bytes` is `null` when the quote is recorded without an offset pin):

<!-- conflicts-example -->
```json
{
  "id": "X1",
  "kind": "cross-source",
  "materiality": "material",
  "quotes": [
    { "source_ref": "pr:body", "quote": "one payload-removed replay", "offset_bytes": null },
    { "source_ref": "issue:415:body", "quote": "no retries", "offset_bytes": null }
  ],
  "affected_claim_ids": ["C01"],
  "precedence": "none",
  "witness": "The two sources state incompatible request semantics.",
  "reasoning": "Cross-source contradiction with no explicit precedence stated."
}
```

<!-- claims-draft-example -->
```json
{
  "schema_version": "claims-draft/3",
  "run": "owner/repo#1",
  "review_state": "s1",
  "subject_oid": "2222222222222222222222222222222222222222",
  "base_oid": "3333333333333333333333333333333333333333",
  "sources": [
    {
      "source_ref": "pr:body",
      "locator": "pr:body",
      "path": "claims/sources/pr-body.md",
      "role": "declares",
      "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "byte_length": 42
    }
  ],
  "claims": [
    {
      "id": "C01",
      "statement": "The PR adds the documented flag.",
      "source_ref": "pr:body",
      "quote": "adds a flag",
      "also_in": []
    }
  ],
  "nonclaims": [],
  "conflicts": []
}
```

## 3. Units manifest and payloads — `units/units2/manifest.json` (`code-units-sim/3`)

The manifest carries `schema_version`, `identity: {base_oid, subject_oid}` agreeing with the envelope, `recipe` (field-by-field equal to the verifier's fixed recipe), ordered `units[]`, `opaque_occurrences[]`, `skips[]` and `coverage`. `units[]` entries carry `unit_id` and `file` (the payload ref); `boundary_kind` is one of `file`, `block`, `line-split` or `opaque`. Payload refs are the manifest's own `file` values resolved under the chunker OUTDIR — the parent of the `units2/` directory — not the run root. The envelope pins each payload as `unit_payloads[] = {unit_id, ref, sha256}` in manifest order; `chunker = {path: kernel/tools/chunker.mjs, sha256, recipe, cure_light_source_head_oid}` is the engine pin (external to the manifest).

Opaque occurrences record `{occurrence_id, path, side, state, pair_id, byte_length, sha256, ref}`; `ref` is the machine-only raw store `units2/raw/occ-NNNN.bin`, which never matches the `uNNNN.txt` model payload namespace. Bodies are the diff line without its marker and line terminator (CR retained; captured before decoding), byte-identical removed/added bodies may share one `pair_id` certificate, and uncertified outcomes are recorded in `skips[]` (`reason`: `unpaired`, `ambiguous`, `not-byte-equal`). `coverage.status` is `complete` or `partial` (a partial run still needs operator approval). Each opaque run also carries first-class descriptor units (`boundary_kind: opaque`, payload schema `opaque-descriptor/1`) whose metadata JSON is bounded to 1024 bytes and contains no occurrence bytes. `counts` adds `opaque_occurrences` and `opaque_bytes` (raw occurrence bytes, outside the payload-only `total_bytes`).

## 4. Run envelope — `run-manifest.json` (`run-verification/1`)

The envelope is the recorded-input projection generated by `verify envelope` (prep/recording, stdout only, never a verdict). Stage-dependent slices are absent until produced; each command needs only its own evidence slice. Discovery: the capture manifest is fixed at `claims/sources/capture-manifest.json`; the generator discovers the claims draft under `claims/` (a single `claims-draft*.json`) and the join draft under `join/` (a single `join-draft*.json`), while the units manifest is looked up at `units/units2/manifest.json` then `units2/manifest.json`; more than one candidate refuses as ambiguous, and absent slices are omitted (not defaulted).

| Slice | Fields | Notes |
|---|---|---|
| identity | `run`, `review_state`, `base_oid`, `subject_oid`, `cure_light_source_head_oid` | must agree with every primary/capture artifact |
| `verifier` | `{path, sha256, tool_version}` | path is exactly `kernel/tools/verify.mjs`; sha/sha of actual bytes; `tool_version` `1.0.0` |
| `capture_manifest` | `{ref, sha256}` | capture pin — exactly two fields, no `schema_version` |
| `claims_draft` | `{ref, sha256, schema_version}` | primary pin; `schema_version` nonempty and equal to the file's |
| `chunker` | `{path, sha256, recipe, cure_light_source_head_oid}` | engine pin; recipe must equal the units manifest recipe |
| `units_manifest` | `{ref, sha256, schema_version}` | primary pin; does not require `unit_count` — see §5 for the join draft's own four-field binding |
| `unit_payloads[]` | `{unit_id, ref, sha256}` | manifest order |
| `join_draft` | `{ref, sha256, schema_version}` | primary pin |
| `join_boxes[]` | `{box_id, assignment:{ref,sha256}, instructions:{ref,sha256}, claims_list:{ref,sha256}, p05_check:{ref,sha256}, p05_evidence:{ref,sha256}}` | per-box pins |
| `join_attempts[]` | `{attempt_id, box_id, parent_box_id, attempt, units[], output:{ref,sha256}, status}` | explicit recovery history; `status` records acceptance |
| `pilot` | `{operator_ref, input_ceiling_bytes, witness_max_chars: 160, retry_limit: 1, resplit: "halves", max_resplit_depth: 1, output_ceiling_bytes, approval?}` | approved policy; `output_ceiling_bytes` is `null` (monitoring-only) or a nonneg integer; `approval = {ref, sha256}` is recorded only with `--approval <run-root-relative-ref>` and pins the exact `operator-approval/1` artifact bytes |

<!-- run-envelope-example -->
```json
{
  "schema_version": "run-verification/1",
  "run": "owner/repo#1",
  "review_state": "s1",
  "base_oid": "3333333333333333333333333333333333333333",
  "subject_oid": "2222222222222222222222222222222222222222",
  "cure_light_source_head_oid": "1111111111111111111111111111111111111111",
  "verifier": {
    "path": "kernel/tools/verify.mjs",
    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "tool_version": "1.0.0"
  },
  "capture_manifest": {
    "ref": "claims/sources/capture-manifest.json",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "claims_draft": {
    "ref": "claims/claims-draft.v3.json",
    "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "schema_version": "claims-draft/3"
  },
  "chunker": {
    "path": "kernel/tools/chunker.mjs",
    "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "recipe": {"target_bytes": 4096, "ceiling_bytes": 6144, "context": 3, "block_preference": true},
    "cure_light_source_head_oid": "1111111111111111111111111111111111111111"
  },
  "units_manifest": {
    "ref": "units/units2/manifest.json",
    "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "schema_version": "code-units-sim/3"
  },
  "unit_payloads": [
    {"unit_id": "u0000", "ref": "u0000.txt", "sha256": "9999999999999999999999999999999999999999999999999999999999999999"}
  ],
  "join_draft": {
    "ref": "join/join-draft.v1.json",
    "sha256": "8888888888888888888888888888888888888888888888888888888888888888",
    "schema_version": "join-draft/1"
  },
  "join_boxes": [
    {
      "box_id": "box-0000",
      "assignment": {"ref": "join/box-0000.assignment.json", "sha256": "7777777777777777777777777777777777777777777777777777777777777777"},
      "instructions": {"ref": "join/box-0000.instructions.md", "sha256": "6666666666666666666666666666666666666666666666666666666666666666"},
      "claims_list": {"ref": "join/claims-list.json", "sha256": "5555555555555555555555555555555555555555555555555555555555555555"},
      "p05_check": {"ref": "join/p05-check.json", "sha256": "4444444444444444444444444444444444444444444444444444444444444444"},
      "p05_evidence": {"ref": "join/p05-evidence.json", "sha256": "aaaa000000000000000000000000000000000000000000000000000000000000"}
    }
  ],
  "join_attempts": [
    {
      "attempt_id": "box-0000-a1",
      "box_id": "box-0000",
      "parent_box_id": null,
      "attempt": 1,
      "units": ["u0000"],
      "output": {"ref": "join/box-0000.jsonl", "sha256": "1111000000000000000000000000000000000000000000000000000000000000"},
      "status": "accepted"
    }
  ],
  "pilot": {
    "operator_ref": "operator:s1",
    "input_ceiling_bytes": 196608,
    "witness_max_chars": 160,
    "retry_limit": 1,
    "resplit": "halves",
    "max_resplit_depth": 1,
    "output_ceiling_bytes": null
  }
}
```

## 5. Join draft and P0.4/P0.5 files — `join-draft/1`

The merged `join/join-draft.v1.json` carries `schema_version: "join-draft/1"`, identity agreeing with the envelope, `units_manifest` (the four-field binding below), `boxes[]` (entries below), `units[]` rows (`{unit_id, links[], unresolved}`) in manifest order, `machine[]` rows (`{unit_id, links: [], unresolved}`) accounting the opaque descriptor units in manifest order — every opaque unit exactly once, never assigned to a model box — and `candidate_unclaimed[]` (unique unit-ID strings in manifest order, exhaustive against all zero-link decidable units). Each link is `{claim_id, closeness: high|medium|low, role_hint: implements|tests|necessary-support|removes|changes, witness}`. A partial-coverage run (recorded `skips[]`) additionally requires the envelope-pinned `operator-approval/1` artifact; the delegated `verify join` binds its bytes, identity tuple, operator_ref and policy classes to the recorded skips (unknown or duplicate `policy_class` fails closed; `join.machine` unresolved text is bounded to 200 characters).

**Join-draft `units_manifest` binding.** The join draft carries its own `units_manifest` object — distinct from the envelope `units_manifest` pin (§4) and from a box assignment's `manifest_ref`/`manifest_sha256` pair. It has four required fields; the delegated `verify join` re-binds all four against the actual units manifest bytes, and any field removed or disagreeing fails `join.identity` with `join manifest binding mismatch` (a missing/non-object `units_manifest` fails shape with `invalid field: /units_manifest expected object`):

| Field | Type | Binding rule |
|---|---|---|
| `ref` | nonempty string | must equal the discovered units manifest ref (e.g. `units/units2/manifest.json`) |
| `sha256` | 64-char hex | sha256 of the exact units manifest bytes |
| `schema_version` | nonempty string | exactly `code-units-sim/3` — a binding failure here is `join.identity` (exit 1), not a schema-family dispatch refusal |
| `unit_count` | nonneg integer | must equal the units manifest's own `units[]` length — the **whole-manifest** count; a box assignment's `unit_count` is only that box's assigned subset |

These are required checks, not an exclusive allowed-key set. The envelope pin's `{ref, sha256, schema_version}` does not require `unit_count`; the join draft's binding always does.

`boxes[]` entries carry five required fields. Envelope prep records `box_id` and `path` with the draft; the merged check pins all five:

| Field | Type | Rule |
|---|---|---|
| `box_id` | nonempty string | box identity used by every assignment, pin and output ref (`join/<box_id>.jsonl`); joins its `join_boxes[]` entry |
| `path` | nonempty string | the child-written output ref (e.g. `join/box-0000.jsonl`); must equal the assignment's `output_path` |
| `sha256` | nonempty string | box output pin: must equal the sha256 of the exact `path` bytes |
| `rows` | nonnegative integer | must equal the actual row count of the box JSONL (`box count mismatch: "<box_id>":rows`) |
| `links` | nonnegative integer | must equal the actual total `links[]` count across the box's rows (`box count mismatch: "<box_id>":links`) |

**Envelope prep (pre-recording).** The generator discovers exactly one `join/join-draft*.json` under `join/` — two or more refuse `REFUSE envelope: ambiguous join draft` (§4) — requires `boxes` to be an array (`malformed join draft: boxes`), and requires every entry to be an object with nonempty `box_id` and `path` (`malformed join draft: boxes entry`). It then resolves each box's assignment, instructions, claims list and P0.5 files, refusing with their own `REFUSE envelope: <reason>` details (`assignment box`/`output`/`manifest mismatch`, `malformed assignment`, `ambiguous instructions` / `missing instructions`, `missing p05 check` / `missing p05 evidence`, `malformed p05 evidence`, `input ceiling mismatch`) when those bindings fail. `sha256`, `rows` and `links` are enforced by the delegated `verify join` (shape failures plus pin/count mismatches), not by the generator — but a draft must carry `box_id` and `path` for prep to record it.

Per-box inputs and outputs (all pinned in `join_boxes`): `box-<id>.assignment.json`, `box-<id>.instructions.md`, `join/claims-list.json`, the child-written `box-<id>.jsonl`, and the P0.5 records `p05-check.json` / `p05-evidence.json`. JSONL is one row per assigned unit in listed order; retains original attempts and retry/split records in `join_attempts[]` — the explicit history the generator cannot infer without `--attempts`.

**Assignment authoring contract (`join/box-<id>.assignment.json`).** Each box's assignment is a JSON object recording the box identity, its child output ref, and the exact inputs the box was packed from. The table lists every recorded field; it is **not an exclusive allowed-key set** (extra keys are ignored), and the refused condition is a recorded fact disagreeing with another record of the same fact — not an unexpected key.

| Field | Required | Type | Recorded meaning and enforcing check |
|---|---|---|---|
| `box_id` | yes | nonempty string | must equal the draft box and `join/<box_id>.jsonl`; generator: `assignment box mismatch: "<box_id>"` |
| `output_path` | yes | nonempty string | must equal the draft box `path` (e.g. `join/box-0000.jsonl`); generator: `assignment output mismatch: "<box_id>"` |
| `manifest_ref` | yes | nonempty string | must equal the discovered units manifest ref; generator: `assignment manifest mismatch: "<box_id>"` |
| `manifest_sha256` | yes | 64-char hex | sha256 of the exact units manifest bytes; same generator check |
| `claims_list_path` | yes | nonempty string | ref of the packed claims list; the generator reads and pins those bytes (`cannot read artifact: <ref>` when unreadable) |
| `units[]` | yes | unit-id strings | the assigned units, in the order the box JSONL must project |
| `units_dir` | yes | nonempty string | parent dir of the units manifest (payload base); delegated join: `box assignment binding mismatch: "<box_id>"` |
| `unit_count` | yes | nonneg integer | must equal `units.length`; delegated join: `assignment unit count mismatch: "<box_id>"` |
| `total_unit_bytes` | yes | nonneg integer | sum of the assigned payload bytes; delegated join: `budget metric mismatch: "<box_id>":total_unit_bytes` |
| `input_ceiling_bytes` | yes | nonneg integer | approved pilot ceiling; must equal the `--input-ceiling-bytes` flag and the p05 evidence ceiling; generator: `input ceiling mismatch: "<box_id>"` |
| `claims_list_bytes` | yes | nonneg integer | exact claims-list byte length; delegated join: `claims_list_bytes mismatch: "<box_id>"` |

**Derived assignment fields (do not hand-compute).** The coordinator authors the assignment as a byte-level projection of artifacts that already exist. `units_dir` must equal the parent directory of the discovered `manifest_ref` — `units_dir == dirname(manifest_ref)`; a `units/units2/manifest.json` ref implies `units_dir: "units/units2"`, never `"units"`. `manifest_ref`, `manifest_sha256`, `unit_count`, `total_unit_bytes`, `claims_list_path` and `claims_list_bytes` are copied from the discovered manifest/claims-list bytes; `input_ceiling_bytes` is copied from the approved pilot value. A hand-authored field that disagrees is refused as `box assignment binding mismatch: "<box_id>"` (delegated join) or by the prep-level generator check.

**Refusal order (generator).** Per box, the generator refuses the first failing check in this order: assignment is an object → `box_id` → `output_path` → manifest pair → `claims_list_path` → `units` array → input ceiling → instructions discovery → claims-list read → P0.5 discovery/read and evidence budget → box output read. `malformed assignment: "<ref>"` covers a non-object assignment, a missing/empty `claims_list_path`, or a non-array `units`; it names the file, not the offending key (key-level reporting is deferred). The table's "delegated join" checks run later, over the recorded envelope: the generator must pass first, and `verify join` re-binds the recorded facts — it never repairs them.

Valid skeleton (synthetic; one unit per box for brevity):

<!-- assignment-example -->
```json
{
  "box_id": "box-0000",
  "output_path": "join/box-0000.jsonl",
  "units": ["u0000"],
  "unit_count": 1,
  "units_dir": "units/units2",
  "claims_list_path": "join/claims-list.json",
  "claims_list_bytes": 61,
  "input_ceiling_bytes": 196608,
  "total_unit_bytes": 42,
  "manifest_ref": "units/units2/manifest.json",
  "manifest_sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
}
```

**Claims-list contract (`join/claims-list.json`).** The claims list is a top-level JSON array of exactly `{id, statement}` objects — one per claims-draft claim, in draft order, with no wrapper object and no other item keys. The envelope generator only reads and pins the bytes; the delegated `verify join` re-derives the exact array from the claims draft (length, order, two keys, exact strings): any difference fails `join.claim_list` with `claims list mismatch: "<box_id>"`, a top-level non-array fails shape with `invalid field: / expected array`, and the assignment's `claims_list_bytes` must equal the exact byte length.

<!-- claims-list-example -->
```json
[
  {"id": "C01", "statement": "The PR adds the documented flag."}
]
```

**P0.5 coordinator records (`join/p05-check.json`, `join/p05-evidence.json`).** Both are unversioned JSON objects written by the coordinator alongside the box output. A per-box `join/<box_id>.p05-check.json` and `join/<box_id>.p05-evidence.json` pair wins; the global pair is a single-box fallback. The generator pins both and requires each to be an object; the evidence's `budget.input_ceiling_bytes` must be a nonneg integer equal to the pilot ceiling (`malformed p05 evidence: "<ref>"` / `input ceiling mismatch: "<box_id>"` otherwise). The delegated `verify join` recomputes every count from the actual rows and the claims draft; prose fields (`witness_containment`, `retry_history`) are never trusted:

| Record | Field | Recomputed rule and observed failure |
|---|---|---|
| check | `file_rows`, `expected_rows` | actual box row count; `p05 count mismatch: "<box_id>":<field>` |
| check | `total_links` | actual total links; same failure family |
| evidence | `expected_rows`, `received_rows`, `total_links` | must equal the same recomputed counts |
| both | `zero_units`, `zero_claims`, `unresolved` | recomputed zero-link unit/claim ids and unresolved unit ids; `p05 zero/unresolved mismatch: "<box_id>":<field>` |
| both | `error_count` = 0, `errors` = [] | any recorded error: `p05 errors recorded: "<box_id>"` |
| evidence | `duplicate_pairs` = 0 | recomputed duplicate `(unit_id, claim_id)` pairs; `p05 count mismatch: "<box_id>":duplicate_pairs` |
| check | `claim_link_counts` | exact per-claim link-count map; `p05 claim_link_counts mismatch: "<box_id>"` |
| evidence | `budget.unit_bytes`, `budget.claims_list_bytes`, `budget.instructions_bytes`, `budget.box_input_bytes`, `budget.headroom_bytes`, `budget.output_bytes`, `budget.output_links` | recomputed budget metrics; `budget metric mismatch: "<box_id>":<field>` |

## 6. Budget, witness and recovery rules

- Packing is by input length only: instructions + the full `claims[].id`/`statement` list + whole units in manifest order; no unit-count cap, no reserved answer space, no unit split. Greedy box packing is enforced (`non-greedy box packing: <box>`); recovery halves are exempt.
- Witnesses are ≤160 Unicode code points (pilot constant), nonempty, single-line, and a byte-substring of the exact unit payload starting at a line boundary with a real diff marker (`+`, `-`, context space, `@@ `); `boundary_kind: 'file'` metadata units additionally allow the recognized metadata prefixes.
- Recovery is one retry on the same units, then halves: left = floor(n/2) units, right = the remainder (right larger for odd n), nonempty, order preserved, no unit split, depth ≤ 1; only accepted leaf attempts are the current sweep.

## 7. Error → field → doc anchor

| Observed check / detail | Field or cause | Anchor in this page |
|---|---|---|
| `schema`, `invalid field: /schema_version ...` | claims root `schema_version` missing/empty | §2 |
| `schema`, `invalid field: /capture_manifest/schema_version ...` | capture declared schema, empty/wrong-typed | §1 |
| `schema`, `unsupported schema_version` | unknown nonempty schema | §1/§2 |
| `artifact.discovery`, `wrong schema kind` | registered schema of another family | §1/§2 |
| `artifact.read`, `cannot read artifact` | path base or missing byte ref | §1/§2 |
| `artifact.path` | traversal/escape/URI/nonregular ref | §1 |
| `artifact.sha256`, `sha256 mismatch` / `sha256 pin missing` | stale pin after an edit | §1/§4 |
| `identity`, `identity mismatch: /<field>` | run/review_state/base_oid/subject_oid/engine OID disagree | §1/§2/§4 |
| `join.prerequisites`, `prerequisite failed: <class>` | an upstream claims/units slice failed | §2/§3 |
| `shape`, `invalid field: /boxes/<i>/<field> ...` | merged join-draft entry missing/empty `box_id`/`path`/`sha256`, or `rows`/`links` not nonnegative integers | §5 |
| `artifact.sha256`, `sha256 mismatch: "join/<box_id>.jsonl"` (may cascade into `join.recovery`, `stale accepted attempt`) / `join.merge`, `box count mismatch: "<box_id>":rows` or `:links` | box output pin or row/link counts changed without resealing the draft | §5 |
| `envelope`, `malformed join draft: boxes` / `malformed join draft: boxes entry` / `malformed join draft: schema_version` / `malformed join draft: /<field>` | pre-recording join draft: `boxes` not an array / entry without nonempty `box_id`+`path` / missing identity field | §4/§5 |
| `envelope`, `ambiguous join draft` / `ambiguous instructions` | more than one candidate draft / instructions file | §4/§5 |
| `envelope`, `assignment ... mismatch` / `missing instructions` / `missing p05 check` / `missing p05 evidence` / `input ceiling mismatch` | per-box assignment/instructions/P0.5 bindings refused at prep | §5 |
| `envelope`, `assignment box mismatch` / `assignment output mismatch` / `assignment manifest mismatch` | assignment `box_id` / `output_path` / manifest pair disagree with the draft box and discovered units manifest | §5 |
| `envelope`, `malformed assignment: "<ref>"` | assignment not an object, `claims_list_path` missing/empty, or `units` not an array — names the file, not the offending key | §5 |
| `envelope`, `malformed p05 evidence: "<ref>"` | p05 evidence not an object, or `budget` missing / ceiling not a nonneg integer | §5 |
| `envelope`, `cannot read artifact: <ref>` (assignment `claims_list_path` example: `cannot read artifact: join/nope.json`) | assignment `claims_list_path` has no readable bytes | §5 |
| `shape`, `invalid field: / expected array` | delegated join: claims-list top level is not an array | §5 |
| `join.claim_list`, `claims list mismatch` / `claims_list_bytes mismatch` | claims-list not the exact ordered `{id,statement}` projection, or the assignment byte length differs | §5 |
| `join.assignments`, `assignment unit count mismatch` / `box assignment binding mismatch` | delegated-join re-bind: `unit_count`, `units_dir`, manifest pair or refs disagree with the envelope pins | §5 |
| `join.identity`, `join manifest binding mismatch` | join-draft `units_manifest` `ref`/`sha256`/`schema_version`/`unit_count` removed or disagreeing with the discovered units manifest | §5 |
| `shape`, `invalid field: /units_manifest expected object` | join-draft `units_manifest` missing or not an object | §5 |
| `join.budget`, `budget metric mismatch: "<box_id>":<field>` | recomputed assignment/p05 budget metric differs | §5 |
| `join.p05`, `p05 count mismatch` / `p05 zero/unresolved mismatch` / `p05 claim_link_counts mismatch` | recorded p05 counts, zero/unresolved arrays or per-claim counts differ from the recomputation | §5 |
| `shape`, `invalid field: /source_consistency/...` | `source_consistency` present but empty-string or wrong-typed object/array | §2 |
| `claims.conflicts`, `consistency record not found: "<id>"` | `source_consistency.records[].id` not a recorded `conflicts[].id` | §2 |
| `claims.conflicts`, `invalid conflict kind: "<id>": "<value>"` | `conflicts[].kind` not `within-source`/`cross-source` (structural enum; no semantic subtypes) | §2 |
| `claims.conflicts`, `invalid conflict materiality: "<id>": "<value>"` | `conflicts[].materiality` not `material`/`non-material` | §2 |
| `shape`, `invalid field: /conflicts/<i>/precedence expected nonempty string` | `conflicts[].precedence` missing/empty (use `"none"`) | §2 |
| `claims.sources`, `source ref not captured: "<ref>"` | declared `sources[].source_ref` has no capture-manifest `sources[].locator` | §1, §2 |
| `claims.quote`, `quote not in source: "<id>"` / `unknown source ref: "<ref>"` | claim/nonclaim quote not an exact byte substring of its declared source (or the ref is not captured) | §2 |
| `claims.conflicts`, `quote not in source: "<conflict id>"` / `quote offset mismatch: "<conflict id>"` | conflict quote not contained, or non-null `offset_bytes` ≠ zero-based first-occurrence byte offset | §2 |
| `claims.notes`, `note quote not in source: /notes/<i>` | note quote not contained in its paired source | §2 |
| `claims.candidates`, `candidate quote not in captured sources: <i>` | `missing_source_candidates[].reference_quote` not contained in any captured source | §2 |

Fingerprint note: `box assignment binding mismatch: "<box_id>"` is one coarse fingerprint covering box-count/identity binding, `output_path`, the `units_dir`/manifest/claims-list bindings and the `units[]` shape — it does not name the disagreeing field (key-level reporting is deferred; localize from the §5 field rules). `source ref not captured` (`claims.sources`) is distinct from `unknown source ref` (`claims.quote`): the first is a declared source with no manifest locator; the second is a quote/nonclaim/note/conflict item pointing at a ref that was never declared or captured.

## 8. Repair protocol — a distinct `fast` artifact-preparation/repair child

The mechanical verifier child stays read-only: it verifies, runs the pinned tool and returns the verdict; it never interprets, repairs or normalizes. Repair is a different role. When an artifact failure needs a fix, the coordinator spawns a distinct `fast` artifact-preparation/repair child, passing the exact verdict/error refs, the pinned docs (this page) and the authorized artifact paths. The repair child is never the verification child and never the coordinator itself; it works over the run artifacts only and returns a bounded receipt, then the boundary is re-delegated.

The repair child never changes captured source meaning, witness bytes, policy or claims semantics just to pass: it restores the recorded field to the recorded meaning and regenerates/refreezes the envelope only under the existing rewrite rules (regeneration after the frame freeze is not verification, and a changed envelope needs a fresh frame pin and a fresh delegated verdict). Ambiguity or an identity/refusal case pauses for the operator — no guessing, no parent source reading and no parent verifier rerun. Tool-source diagnosis, if genuinely necessary, is isolated child work with a bounded return and requires operator escalation; it is not a new checker and there is no coordinator source reading.
