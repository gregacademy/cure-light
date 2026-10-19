# workflows/pack — p0-pack build spec

Entry point: [`../AUTHORING.md`](../AUTHORING.md) — the builder loop, the two test surfaces
and the purity rules. This file specifies **what** `p0-pack` must do. Host verification
facts: [`../testkit/HOST-HARNESS.md`](../testkit/HOST-HARNESS.md); generated-input
semantics: [`prop/PROP-ENGINE.md`](prop/PROP-ENGINE.md).

Status: **adopted by the kernel call site** in the uncommitted `mods/p0-pack` worktree.
`p0-close` is merged. `p0-pack` is not merged or installed. Review-pass verification
(2026-10-19):
fast 61/61 overall (p0-pack 43), host 57/57 overall (p0-pack 39), prop 41/41 overall
(p0-pack 9), acceptance 3/3 (13 baseline outputs + pin provenance), and compile 4/4 with
a complete pi-schematic checkout. Claims-list and the first four assignments match the
recorded `ai068` artifacts byte for byte. The six instructions match the corrected-render
pins byte for byte; they differ from the recorded files where payload paths change from
`units2` to `units/units2` and where the witness rule now states the line-boundary /
diff-marker requirement already enforced by `p0-close` and `verify join`. The corrected
fixed input moves u0293 from box-0004 to box-0005; the acceptance replay pins that moved
render.
A bounded pre-review run by path on a synthetic store exited `ok` with 0 turns and 2
checkpoints. A resume run exited `ok`, with `promoted: []` and all targets skipped.

## What it replaces

`p0-pack` is designed to replace the hand-rolled `ai068` placement step of the P0.4
join pass with one deterministic script. It turns the recorded inputs (units manifest + payloads, the claims
draft) into the three P0.4 dispatch artifacts `p0-close` already consumes as pinned
required inputs:

- `join/claims-list.json` — the exact `{id, statement}` projection of the claims draft, in
  draft order;
- `join/box-<NNNN>.assignment.json` — the greedy box assignment (input-length packing only);
- `join/box-<NNNN>.instructions.md` — the per-box child instructions, with payload paths
  derived from `units_dir` + `basename(unit.file)`.

It is the sibling of `p0-close`: same class (in-repo host tooling under `workflows/`,
hash-pinned, shell-only, no model turn), same call route (headless `pi` CLI), and
the same division of labour — the workflow produces and promotes artifacts; the delegated
`verify join` boundary and the coordinator's P0.5 gate still decide.

## Governance

| Rule | Detail |
|---|---|
| In-repo only | host tooling stays under `workflows/`; `kernel/tools/*` stays untouched |
| Sole acceptance boundary | `verify.mjs` stays byte-identical; `verify join` remains the mechanical acceptance boundary |
| Copies only | all verification and live runs operate on copies; the real store and the frozen baseline stay untouched |
| No install | no installation into `~/.pi/agent/workflows/` before verification and operator sign-off |
| Controlled arm | not used by the controlled replication arm without explicit operator approval (no new tool/generator during the arm; the P0 preparation bridge is a measured comparator) |
| Author contract | exactly one `return defineWorkflow((workflow) => { ... })`; synchronous; no imports; `workflow.shell` as the only I/O; effects serial; model handles unused |

## Invocation

Pi `/workflow` argument template (replace all placeholders with local values):

```
/workflow workflows/pack/p0-pack.js \
  --store /…/store/<run> \
  --input-ceiling-bytes 196608 \
  --run-id chunkhound/pi-schematic#72 --review-state s1 \
  --base-oid <40 hex> --subject-oid <40 hex> \
  [--child-store /…/store/<run>] [--allow-overwrite]
```

- Value flags accept `--flag value` or `--flag=value`. Values may use single or double
  quotes; backslash escapes work outside single quotes. Empty values, duplicate value
  flags, unknown flags and missing required flags refuse `needs-input` before any write.
  `--allow-overwrite` is bare or `--allow-overwrite=true`; no other value is accepted.
  The `/workflow` first token selects the file.
- No hidden engine path and no pin defaults: the ceiling is an explicit flag.
- `--store` may be relative. `--child-store` must be absolute, with no `..` path segments,
  whitespace or control characters because the helper embeds the path in child instructions.
  The helper resolves an existing path to its real path. If omitted, it uses the resolved
  `--store`. Acceptance uses a scratch copy as `--store` and the recorded path as
  `--child-store`; an ordinary call site uses the same path for both.
- The identity flags are cross-checks: the authoritative identity is the store's
  `claims/sources/capture-manifest.json`; a disagreement is recorded as a warning in the exit
  card (mirrors `p0-close`), never silently used.
- Shell discipline: shell-quoted paths via `quote()`; collision-checked heredoc delimiters;
  `parseTail` for the one JSON status line; refuse any result with `truncated === true`.
- Evidence dir per run: `"$PWD/.tmp/p0-pack/<UTCstamp>-$$"` — never overwritten, never
  deleted by the script.
- Checkpoints after the args gate and at the end; runs are bounded with `--workflow-time`
  (ms) plus shell timeouts.
- **Pipeline call.** The kernel coordinator calls this workflow headlessly before P0.4 —
  `pi --offline --no-session --mode json --print … --workflow-time 720000
  "/workflow <abs>/workflows/pack/p0-pack.js <verbatim args>"` — with cwd a writable
  run-scoped directory and the workflow token absolute. The receipt
  (`.tmp/pipeline/p0-pack/<stamp>-<pid>/`) is the result. The flag sources, three bounded
  reads and outcome routing live in [`kernel/references/intake-and-scope.md`](../../kernel/references/intake-and-scope.md)
  §0.3 "Packing prep", not here. Packing is mandatory for engine revisions that carry this
  workflow; there is no hand-packing fallback.

## Required inputs

Under `--store`:

- `claims/sources/capture-manifest.json` — run identity (`run`, `review_state`, `base_oid`, `subject_oid`)
- `claims/claims-draft.v3.json` — the `claims` array (`id`, `statement`), draft order
- `units/units2/manifest.json` — units in order (`unit_id`, `file`, `byte_len`, `boundary_kind`)
- `units/units2/<basename(unit.file)>` — one payload per unit

Pre-write validation: the ceiling is a nonnegative safe integer; each unit has a unique
`unit_id` and payload basename, a nonnegative safe-integer `byte_len`, and a payload
whose file size matches it. The capture manifest has 40-hex OIDs and a control-free review
state; its run parses as `<repo>#<n>` with safe repo characters. The claims array is
nonempty; each claim has a nonempty statement. The derived box count is at most 10,000.
Unreadable JSON inputs and scan errors refuse before any store artifact write. Input
violations return `needs-input`.

## Steps

0. **Args gate** — flags, format checks (`--input-ceiling-bytes` nonnegative safe integer,
   OIDs 40 lowercase hex), store probe (`test -d`), readonly posture, `node --version`
   probe; evidence dir; checkpoint `{phase:"args"}`.
1. **Pack helper (staging)** — materialize `pack.cjs` (self-contained Node, no dependencies,
   no backticks) into the evidence dir and run it in stage mode against the store. It:
   - reads the capture identity, claims draft and units manifest;
   - projects `claims-list.json` as Python `json.dumps(indent=2, ensure_ascii=True)` bytes
     plus one trailing newline;
   - renders each box's instructions byte-exactly (fixed template, `--child-store` paths,
     payload lines as `units_dir + "/" + basename(file)`);
   - packs greedily by **input length only**: instructions + the full claims list + whole
     units in manifest order, charging fixed input first and never splitting a unit; opaque
     units are excluded (they become `machine[]` rows in `p0-close`), and an empty-box fit
     failure refuses `needs-input`; refuse if more than 10,000 boxes result;
   - writes into the staging dir only and prints one JSON digest:
     `{ok, units, opaque_units, claims, claims_list{bytes,sha256}, manifest_sha256, boxes[]}`
     where each box carries `{box_id, unit_count, total_unit_bytes, box_input_bytes,
     instructions_sha256, assignment_sha256}`.
2. **Digest cross-check** — box unit counts plus `opaque_units` equal the manifest unit
   count; the claims-list sha256 is 64 hex; the box ids are `box-0000…` in order.
3. **Promotion** — hold an exclusive `.p0-pack.lock`. Every target is frozen: a differing
   existing target without `--allow-overwrite` refuses `frozen-artifact` before promotion;
   a byte-equal target is `skipped`. Even with `--allow-overwrite`, refuse if downstream
   outputs already exist: box-prefixed child/`p0-close` artifacts, the join draft, or a
   run envelope. Acceptance starts from an empty `join/`, so this guard does not apply
   there. Refuse any existing `join/box-NNNN.*` whose box id is outside the derived set:
   assignments, instructions, child `.jsonl`, p05 artifacts, and other suffixes. Scan
   errors also refuse. The workflow never deletes stale files. Pre-stage every changed
   target, then rename inside `join/`. On a handled rename or verification failure, roll
   back targets already promoted.
4. **Checkpoint and exit** — checkpoint `{phase:"p0-pack", units, boxes, claims_list_sha}`;
   card (≤20 lines: box table with unit counts/bytes/headroom, shas, store, next line);
   `exit({reason:"ok", claims_list_sha256, manifest_sha256, units, opaque_units, claims,
   boxes:[…], paths:{store, child_store, evidence}})`.

## Exit reasons

| Reason | Trigger |
|---|---|
| `ok` | every step passed (promotion may be a no-op with `skipped`) |
| `needs-input` | invalid flags; missing, unreadable or invalid inputs; duplicate unit ids or payload basenames; oversized box count; a box cannot hold fixed input + one whole unit |
| `frozen-artifact` | differing target without `--allow-overwrite`; box-prefixed or p0-close downstream artifacts (including the join draft and run envelope) when overwrite is requested; any stale `join/box-NNNN.*` outside the derived set; an existing lock |
| `evidence-failed` | helper write/run produced no digest, scan error, lock failure, or handled promotion/verification failure |

Reserved tokens (e.g. `cost-limit`) are never authored. Pre-promotion refusals leave
artifact bytes unchanged. The lock is temporary; the helper can create `join/` before a
promotion refusal. Promotion pre-stages all changed targets, then renames them. It attempts
to roll back already-promoted targets on handled rename or verification failure. Rollback
can itself fail; an external process crash during the final rename sequence can also
leave partial state.

## Outputs and byte-equality acceptance

13 outputs for the recorded baseline: `join/claims-list.json`, 6 ×
`join/box-*.assignment.json`, 6 × `join/box-*.instructions.md`.

The acceptance tier replays these against the recorded s1 inputs
(`$CURE_LIGHT_BASELINE_STORE`, default
`/workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1`). An absent
baseline fails acceptance unless `P0_PACK_ACCEPTANCE_OPTIONAL=1` is set. The scratch
copy starts with an empty `join/`, so every output is generated rather than overwritten.
The tier also checks the pins independently: the recorded instruction bytes plus exactly
the payload-path fix must hash to each instruction pin.

- `claims-list.json`, the six assignments: byte equality against the recorded artifacts
  (they carry no absolute paths);
- the six instruction files: byte equality against the **corrected render** pins captured
  2026-10-17, plus the provenance check above (see below).

Capture note (documented once, in `fixtures/baseline-pins.mjs`): the recorded store's
instruction files were produced by the defective `ai068` render — payload lines point at
`<store>/units2/…` instead of `<store>/units/units2/…`. Reproduction is verified against the
canonical render of the same recorded inputs (pinned with `--child-store` set to the
recorded store path, so the pins are exact bytes). The delta is exactly the payload-path
fix; everything else in the template is unchanged.

Formatting pinch points to implement deliberately: Python `json.dumps(indent=2,
ensure_ascii=True)` bytes with one trailing newline (assignments and claims list);
instructions end with one `\n`; the assignment key order is `ai068`'s (`box_id`,
`output_path`, `units`, `unit_count`, `units_dir`, `total_unit_bytes`, `claims_list_path`,
`claims_list_bytes`, `input_ceiling_bytes`, `manifest_ref`, `manifest_sha256`).

Bounds: pack helper ≤300 s (one helper step; staging and promotion share the bound).

## Defect classes closed by construction

- D1 (path class): payload paths come from `units_dir` + basename, so the run-`01a13af9`
  instructions defect (`$STORE/units2/…`) cannot recur; a fast case asserts the exact
  rendered path and the absence of the bad one.
- Silent overwrite class: staging-compare with a frozen-target refusal; a repack with
  changed inputs never replaces bytes children may already have read.
- Untested generation class: packing, projection and render are byte-pinned by the
  acceptance tier and guarded by generated-input properties.

## Tests and tiers

From the cure-light repo root, run `node workflows/run.mjs fast` for the default tier.
Replace `fast` with `acceptance`, `compile`, `host`, `prop` or `all` for opt-in tiers.
The build loop is in [`../AUTHORING.md`](../AUTHORING.md) §The builder loop.

| Tier | File | Role |
|---|---|---|
| fast | `workflows/pack/test/streams.test.mjs` | fixture sanity (stream shapes, faults) |
| fast | `workflows/pack/test/contract.test.mjs` | red-first executable specification: valid packings, refusal faults, allow-overwrite, ceiling and input refusals — the shared case table in `cases.mjs` driven by the stub host |
| host | `workflows/pack/test/host.test.mjs` | the identical cases + the baseline replay through the real `pi` CLI (`--mode json`); each pure case re-runs and compares result digests |
| host | `workflows/pack/test/recipe.host.test.mjs` | the documented kernel command + three bounded receipt reads against one synthetic store |
| acceptance | `workflows/pack/test/acceptance.test.mjs` | corrected-render byte equality against the recorded baseline pins |
| prop | `workflows/pack/test/prop.test.mjs` | invariants over generated inventories (coverage, greedy boundary, ceiling, resume idempotence) |
| prop | `workflows/pack/test/prop-engine.prop.test.mjs` | engine self-test of the copied property engine (render determinism, seed replay) |
| compile | `workflows/pack/test/compile.test.mjs` | `node --check` in a CJS scope + canonical compile |

Support files:

| File | Role |
|---|---|
| `workflows/pack/fixtures/streams.mjs` | synthetic pre-pack stores (sized inventories), fault injection, baseline copy |
| `workflows/pack/fixtures/generate.mjs` | materializes browsable input/output fixture trees under `fixtures/generated/` (gitignored) |
| `workflows/pack/fixtures/baseline-pins.mjs` | the corrected-render pins + capture provenance |
| `workflows/pack/testkit.mjs` | draft path, canonical invocation |
| `workflows/pack/cases.mjs` | the sealed case table |
| `workflows/pack/prop/*` | property engine (copy of the p0 engine, pack specs/mutations) |
| `workflows/pack/prop-run.mjs` | property CLI |

**Browsable fixture trees.** `fixtures/generate.mjs` materializes complete pre-pack stores
that have then been driven through the workflow once: `<variant>/claims/**` and
`<variant>/units/units2/**` are the inputs, `<variant>/join/**` the produced outputs
(`two-box`, `single-box`, `opaque-unit`; ~290 KiB each, gitignored at
`workflows/pack/fixtures/generated/`). No test reads that directory — the suite always
generates its own stores in temp dirs — so regenerating or deleting it is always safe.

## Verification ladder (before any install)

1. `node --check` in a CJS scope and canonical compile against a complete pi-schematic
   checkout (`PI_SCHEMATIC_CHECKOUT`, default
   `~/.pi/agent/git/github.com/chunkhound/pi-schematic`). The default checkout currently
   lacks `workflow/types.js`, so both canonical tests fail there (compile tier 2/4).
   Set `PI_SCHEMATIC_CHECKOUT` to a complete checkout. A missing file is an environment
   failure, not a draft failure.
2. Simulation suite: streams plus the fault matrix (fast tier).
3. Host replay of the same cases, purity included; generated-input properties.
4. Corrected-render byte-equality replay on a scratch copy (acceptance tier).
5. One bounded live run by path against a **copy** (`--workflow-time 300000`), evidence kept.
   `host-run.mjs --live`'s value guard rejects an `--args` string starting with `--`; prefix
   the args string with one space (the workflow trims it).
6. Record the revision sha in the runbook after the build; no pack proposal file exists.

## Non-goals

- No chunker invocation and no subject-tree read: inputs are recorded store artifacts only.
- No child dispatch: spawning the P0.4 box fleet stays coordinator work.
- No merge/p05/envelope/verdict work: that is `p0-close` and the delegated `verify join`.
- No deletion: stale box artifacts are refused and named, never removed.
- No page/notebook writes: the workflow is headless store-side tooling (a headless run's
  notebook is not the coordinator's notebook).

## Open items for the build

- Stale-box policy: always refuse artifacts outside the derived set. Overwrite applies
  only to derived targets and cannot repair a leftover box id.
- Instruction template ownership: the template lives in the workflow (byte-pinned); the
  child-facing contract text also exists in `assets/child-pass-prompt-template.md`. A drift
  test against that document is a candidate follow-up, not part of this slice.
- `--child-store` naming: keep the explicit flag (this spec) vs. derive a test-only render
  root another way.
