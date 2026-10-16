# workflows/ — pi `/workflow` scripts for the review engine

Entry point for builders: [`AUTHORING.md`](AUTHORING.md) — the loop, the two test
surfaces, the purity rules. The p0-close build spec is [`p0/SPEC.md`](p0/SPEC.md).

Deterministic mechanical workflows for cure-light coordinator phases, written in the
pi-schematic `/workflow` author contract. Host tooling: `kernel/` and the pinned tools
(`verify.mjs`, `chunker.mjs`) stay untouched, and `verify join` remains the sole mechanical
acceptance boundary.

Status: **construction started 2026-10-15**, red-first. `workflows/p0/p0-close.js` does not
exist yet; the tests in `workflows/test/` are expected to fail until it lands.

Proposals this follows (workspace root, outside this repo):

- `cure-light-p0-close-workflow-proposal.md` — merge/validate/p05 + envelope
- `cure-light-records-workflow-proposal.md` — stage/state-head page write + read-back

## Layout

```
workflows/
  p0/                 P0-phase workflows (p0-close here; nothing else yet)
  test/
    streams.mjs                  the two input streams + fault injection + CLI
    harness.mjs                  stub workflow host (real shell, stubbed model/notebook handles)
    p0-close-testkit.mjs         shared draft path, pins and canonical invocation
    run.mjs                      tier runner (fast | acceptance | compile | all)
    streams.test.mjs             fixture sanity (fast, green)
    harness.test.mjs             stub-host self-test (fast, green)
    p0-close.contract.test.mjs   red-first executable specification (fast)
    p0-close.acceptance.test.mjs frozen-baseline byte-equality (opt-in tier)
    p0-close.compile.test.mjs    node --check + canonical compile (opt-in tier)
```

## Input streams

1. **synthetic** — the engine's own pinned-verifier fixture
   (`kernel/tools/verify-fixtures/seed/`, via `kernel/tools/verify-testkit.mjs`), split into
   `box-0000`/`box-0001` and reduced to the *pre-close* state: per-box assignments,
   instructions, JSONL and p05 records exist; the merged `join-draft/1` and the frozen
   envelope do not. Fault variants derive from it one at a time.
2. **baseline** — a copy of the captured run store
   (default `$CURE_LIGHT_BASELINE_STORE` or
   `/workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1`) together with
   the original output pins, used for byte-equality acceptance.

Materialize either one for eyeballing or a live run:

```bash
node workflows/test/streams.mjs list
node workflows/test/streams.mjs synthetic /tmp/p0-close-synthetic --fault duplicate-pair
node workflows/test/streams.mjs baseline  /tmp/p0-close-baseline
```

## Test tiers

| Tier | Files | Role | State today |
|---|---|---|---|
| **fast** (default) | `streams`, `harness`, `p0-close.contract` | fixture sanity, host self-test, red-first contracts | 6 pass / 11 fail, all `E_WORKFLOW_MISSING` |
| **acceptance** (opt-in) | `p0-close.acceptance` | proposal §5: frozen-baseline byte-equality on a scratch copy | red (`E_WORKFLOW_MISSING`); skips when the store is absent |
| **compile** (opt-in) | `p0-close.compile` | ladder step 1: `node --check` (CJS) + canonical compile | skipped until the draft lands |

```bash
node workflows/test/run.mjs             # fast (default) — the build loop
node workflows/test/run.mjs acceptance  # baseline replay (external store, ~2.6 MB copy)
node workflows/test/run.mjs compile     # draft toolchain conformance
node workflows/test/run.mjs all         # every tier

# raw equivalent for everything:
node --test "workflows/test/*.test.mjs"
```

The contract tier is the red-first executable specification for `p0-close.js`; once the draft
lands, those cases stop being red and become the regression suite pinned on the frozen
baseline.

## Governance

- Not used by the controlled replication arm unless the operator pins this branch; these
  workflows are not an engine tool and add no verify command, registry or schema.
- Workflow files follow the author contract: one top-level `return defineWorkflow(...)`,
  synchronous, no imports, `workflow.shell` as the only I/O, checkpoints for budgets.
- Verification ladder before any install: canonical compile, this simulation suite with a
  fault matrix, then one bounded live run by path (proposal documents).
