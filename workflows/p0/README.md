# workflows/p0 — Phase 0 mechanical workflows

`p0-close` is the first P0 workflow: it replaces the ad-hoc merge/validate/p05 step
(`ai070`) and the envelope/repair steps (`ai071`/`ai072`) with one deterministic script.
It merges the box JSONL outputs into `join-draft/1`, validates coverage/links/witnesses,
writes the per-box p05 records with real error content, and generates the frozen
`run-verification/1` envelope with the pinned verifier.

Status: **red-first, draft absent** (2026-10-15). `p0-close.js` does not exist yet; the
contract tier fails with `E_WORKFLOW_MISSING` until it lands.

Design source of record: `cure-light-p0-close-workflow-proposal.md` (workspace root,
outside this repo). This file is the in-repo build spec; the draft lives at
`workflows/p0/p0-close.js` and runs **by path** during development.

## Governance

- Host tooling ships in-repo under `workflows/`; `kernel/tools/*` untouched; `verify.mjs`
  stays byte-identical and `verify join` remains the sole mechanical acceptance boundary.
- Not used by the controlled replication arm without explicit operator approval.
- All verification and live runs operate on **copies**; the real store and the frozen
  baseline stay untouched.
- No installation into `~/.pi/agent/workflows/` before verification and operator sign-off.
- Author contract: exactly one `return defineWorkflow((workflow) => { ... })`;
  synchronous; no imports; `workflow.shell` as the only I/O; effects serial; model handles
  (`run`, `classify`, `handoff`, `new`, `entries`) unused by this workflow.

## Invocation

```
/workflow workflows/p0/p0-close.js \
  --store /…/store/<run> \
  --verifier /…/kernel/tools/verify.mjs \
  --verifier-sha256 <64 hex> --chunker-sha256 <64 hex> \
  --input-ceiling-bytes 196608 \
  --operator-ref operator:<name>/<run> \
  --run-id chunkhound/pi-schematic#72 --review-state s1 \
  --base-oid <40 hex> --subject-oid <40 hex> \
  [--allow-overwrite]
```

- Args accept `--flag value` and `--flag=value`; the `/workflow` first token selects the
  file. Unknown or missing required flags → `needs-input` before any write.
- No hidden engine path and no pin defaults: every pin is an explicit flag.
- Shell discipline: single-quoted paths via `quote()`; collision-checked heredoc
  delimiters; `parseTail` for the one JSON status line; refuse any result with
  `truncated === true`.
- Evidence dir per run: `"$PWD/.tmp/<workflow>/<UTCstamp>-$$"` — never overwritten, never
  deleted by the script.
- Checkpoints after the args gate and at the end; runs are bounded with `--workflow-time`
  (ms) plus shell timeouts.

## Required inputs

Under `--store`:

- `units/units2/manifest.json`
- `claims/claims-draft.v3.json`
- `join/claims-list.json`
- `join/box-*.assignment.json` (≥1, sorted by `box_id`)
- `join/box-*.instructions.md`
- `join/box-*.jsonl`

Pre-write validation: all assignments share one `input_ceiling_bytes` equal to the flag;
`output_path`, `units_dir` and `manifest_ref` resolve; a payload file exists for every
unit. Any mismatch → `needs-input`.

## Steps

0. Args gate; store probe (`test -d`); evidence dir; `node --version` probe.
1. **Verifier identity**: `sha256sum "$verifier"` must equal `--verifier-sha256`;
   mismatch → `verifier-pin-mismatch` with no writes.
2. **Merge helper**: materialize `merge.cjs` (self-contained Node, no dependencies, no
   backticks) into the evidence dir and run
   `node merge.cjs --store … --staging … [--allow-overwrite]`. The helper:
   - reads manifest order and payloads (`units_dir` + basename of `unit.file`), claim ids,
     claims-list, assignments, instructions and box JSONL;
   - builds `join-draft/1` with the `ai070` field set (`schema_version`, `run`,
     `review_state`, `base_oid`, `subject_oid`,
     `units_manifest{ref,sha256,schema_version,unit_count}`, `boxes[]`, `units[]` sorted to
     manifest order, `machine[]`, `candidate_unclaimed[]`);
   - validates: exactly one row per manifest unit and only known units; row order equal to
     the assignment `units`; known claim ids; `closeness`/`role_hint` enums; witness
     single-line, ≤160 chars, byte-exact line-start containment in the payload
     (`witness_ok`); duplicate `(unit_id, claim_id)` pairs counted; `unresolved` handling;
     zero-link unit/claim tallies;
   - writes draft and p05 records into the staging dir only; `run-manifest.json` is not yet
     touched;
   - p05 records carry real `errors`, `error_count`, `duplicate_pairs`; the evidence budget
     keeps the `ai072` key order (`input_ceiling_bytes, unit_bytes, claims_list_bytes,
     instructions_bytes, box_input_bytes, headroom_bytes, output_bytes, output_links`);
   - prints one JSON digest line:
     `{ok, units, links, error_count, errors[≤10], draft{path,bytes,sha256}, p05[], warnings, non_ascii}`.
3. **Digest cross-check**: sum of box `unit_count` equals the manifest unit count; sum of
   box links equals digest links; draft sha256 is 64 hex. `ok !== true` →
   `validation-failed` with the store untouched and samples in the card.
4. **Promotion**: copy staged artifacts into the store (`cp` + `cmp`), tmp+rename inside the
   store; existing targets are refused unless `--allow-overwrite` → `frozen-artifact`.
5. **Envelope**:
   `node "$verifier" envelope --run "$store" --operator-ref … --chunker-sha256 … --input-ceiling-bytes … > "$staging/run-manifest.json"`;
   `ok === true` required (else `evidence-failed`, stderr tail ≤300 chars in the card).
   Read back (`cat` + `JSON.parse`): `schema_version == "run-verification/1"` and the
   embedded `verifier.sha256` equals the pin. Promote, then write
   `run-manifest.json.sha256`.
6. Checkpoint `{phase:"p0-close", units, links, draft_sha, envelope_sha}`; card (≤20 lines);
   `exit({reason:"ok", draft_sha, envelope_sha, units, links, paths})`.

Exit reasons: `ok`, `needs-input`, `evidence-failed`, `verifier-pin-mismatch`,
`validation-failed`, `frozen-artifact`. Reserved tokens (e.g. `cost-limit`) are never
authored. No partial store state on any failure path: helpers write to staging, promotion
uses tmp+rename, and the store keeps its earlier bytes.

## Outputs and byte-equality acceptance

15 outputs: `join/join-draft.v1.json`, 12 × `join/box-*.p05-{check,evidence}.json`,
`run-manifest.json`, `run-manifest.json.sha256`.

Baseline store `/workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1/`:

| Artifact | Baseline sha256 |
|---|---|
| `join/join-draft.v1.json` | `4b731b606cc69ea9633c75a6c06ef030515af97c8a070d935279a71b1d9bd91b` |
| `run-manifest.json` | `89fff51c821a3ca4d3440bbe31fb462b4ce45bdf6e1b4eb15b75ed1df756651c` |
| `join/box-0000.p05-check.json` | `87ce8ee78444915df08a23215fa3ea1f01f4ff86a366e4f4bf9441a7d311582c` |
| `join/box-0000.p05-evidence.json` | `1cce53c718e2c9000b2a6cfdc6345d030711de610238bc5db2dd5011b576b8e1` |

Formatting pinch points to implement deliberately: `indent=2`; the draft has **no**
trailing newline while p05 files have one; Python `json.dumps` escapes non-ASCII as
`\uXXXX` (Node must reproduce `ensure_ascii`); the p05 evidence key order is `ai072`'s;
envelope bytes are the tool's (identical inputs and args ⇒ identical bytes). The
`non_ascii` digest flag exists to catch latent divergence. Sizes are verified with
`wc -c`; the digest line and the envelope read are clip-safe.

Bounds: merge ≤300 s; envelope ≤120 s.

## Defects fixed by construction (classes from the mechanism assessment)

- D2: p05 records carry real error fields.
- D3: `ok`/`exitCode` come from the shell handle, never from `$?`.
- D5: the dead statement is gone.
- D6: a row-order mismatch is a validation error, never a silent re-sort.
- D1 class: payload paths come from `units_dir` + basename, so the bad path class cannot
  recur.
- Pre-freeze refusal: `input_ceiling_bytes` is written on the first pass.

## Tests

Tier runner (no package.json in this repo, so `run.mjs` owns the `node --test` globs):

```bash
node workflows/test/run.mjs             # fast (default) — the build loop, stub host
node workflows/test/run.mjs host        # the same cases through the real pi CLI (opt-in)
node workflows/test/run.mjs prop        # generated-input properties (opt-in, QuickCheck-style)
node workflows/test/run.mjs acceptance  # frozen-baseline byte-equality replay
node workflows/test/run.mjs compile     # draft toolchain conformance
node workflows/test/run.mjs all
```

| Tier | File | Role | State (2026-10-16) |
|---|---|---|---|
| fast | `workflows/test/streams.test.mjs` | fixture sanity | 3 pass |
| fast | `workflows/test/harness.test.mjs` | stub-host self-test | 3 pass |
| fast | `workflows/test/p0-close.contract.test.mjs` | red-first executable specification: valid merge (incl. `verify join` on the merged store), six refusal faults, allow-overwrite, ceiling and verifier-pin refusals, missing flags — the shared case table in `cases.mjs` driven by the stub host | 11 fail, all `E_WORKFLOW_MISSING` |
| host | `workflows/test/p0-close.host.test.mjs` | the identical cases + the baseline replay driven through the real `pi` CLI (`--mode json`), each pure case re-run from the same initial state and compared by result digest | red until the draft lands |
| host | `workflows/test/smoke.host.test.mjs` | harness self-test: a pure-shell fixture through the real host, purity rerun, and stub≡host digest equality | 4 pass |
| acceptance | `workflows/test/p0-close.acceptance.test.mjs` | proposal §5 byte-equality replay on a scratch copy (in-process) | red; skips when the store is absent |
| prop | `workflows/test/p0-close.prop.test.mjs` | invariants over the generated input space (mutation programs, 1/2 boxes): refusal writes nothing, accept is complete and `verify join`-clean, digest stable, packing-invariant, resume never rewrites different bytes | skips until the draft lands |
| prop | `workflows/test/prop-engine.prop.test.mjs` | property engine self-test: render determinism, seed replay, shrinks a planted violation to the minimal counterexample, replays it on both hosts, honours `cover`, counts discards | 7 pass |
| compile | `workflows/test/p0-close.compile.test.mjs` | `node --check` in a CJS scope + canonical compile (`{code, hasCheckpoint:true}`) | skipped until the draft lands |

Support: `workflows/test/streams.mjs` (synthetic + baseline streams, fault injection, CLI),
`workflows/test/harness.mjs` (stub host: real shell, in-memory notebook,
`E_WORKFLOW_MISSING` for a missing draft), `workflows/test/p0-close-testkit.mjs` (draft
path, pinned tool hashes, canonical invocation), `workflows/test/cases.mjs` (the sealed
case table), `workflows/test/casekit.mjs` (runner, purity digest, report),
`workflows/test/hostdriver.mjs` (real pi CLI driver), `workflows/test/host-run.mjs` (CLI
for an agent: groups, `--json`, `--live`), `workflows/test/prop/*` (property engine: store
specs, mutation registry, generator, shrinker, runner), `workflows/test/prop-run.mjs`
(property CLI: `--list`, `--cases`, `--seed`, `--spec`, `--json`). Design and verified host
facts: `workflows/test/HOST-HARNESS.md`; property engine spec: `workflows/test/PROP-ENGINE.md`.

The fast tier keeps the sealed contracts exactly as authored; the host tier replays the
same case objects, so a case is written once and proven twice — under the stub host and
under the real one. Real host runs never happen by default (seconds each).

Deferred tiers and known gaps:

- The §7 fault matrix is wider than the current fixtures: extra row, zero-link unit,
  unresolved unit, mid-line / >160-char / multi-line witness, envelope refusal (p05
  missing `input_ceiling_bytes`), and a 1-box stream.
- §5 counts 15 outputs, but the baseline stream pins 14: `run-manifest.json.sha256` is
  neither pinned nor asserted yet.
- Rerun idempotence without a reset (re-run in the same store without `--allow-overwrite`
  → `frozen-artifact`) is not a case yet; the purity rerun resets the store by design.
- Card shape (≤20 lines) and checkpoint metadata shape are not asserted yet.
- Model-turn cases (any `workflow.run`) are out of scope for the host tier: a model turn
  makes a case non-deterministic, so such a case must set `purity: false` and pin its
  records instead of a digest.
- Three mutations stay unpinned until the operator decides: `preexisting-draft-equal` and
  `preexisting-envelope-equal` (D4 staging-compare idempotence) and `p05-no-ceiling`
  (envelope refusal token). Properties classify them instead of asserting a reason.

## Verification ladder (before any install)

1. `node --check` in a CJS scope and canonical compile against the pi-schematic checkout
   (`PI_SCHEMATIC_CHECKOUT`, default
   `~/.pi/agent/git/github.com/chunkhound/pi-schematic`) — the compile tier.
2. Simulation suite: streams plus the fault matrix (contract tier).
3. Host replay of the same cases, purity included — `node workflows/test/run.mjs host`.
   Generated-input properties over the same contracts — `node workflows/test/run.mjs prop`.
4. Baseline replay on a scratch copy (acceptance tier and `baseline-replay` in the host tier).
5. One bounded live run by path against a **copy**
   (`--workflow-time 300000`), evidence kept — `host-run.mjs --live`.
6. Record the revision sha in the proposal and the runbook after the build.

## Non-goals

- No packing, assignments or instructions rendering (deferred item 6).
- No child dispatch: `verify join` stays coordinator `run`-turn/spawn work.
- No verdict capture (separate slice).
- No new store artifacts on the clean path.

## Open items for the build

- `machine[]` in `join-draft/1`: keep empty (baseline) or record the pre-check verdict?
  Proposal: keep empty — `verify join` owns the semantic record.
- Overwrite policy: keep the `frozen-artifact` refusal; repairs pass `--allow-overwrite`
  and are recorded as new envelope generations.
