# workflows/ — pi `/workflow` scripts for the review engine

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
    streams.mjs       the two input streams + fault injection + CLI
    harness.mjs       stub workflow host (real shell, stubbed model/notebook handles)
    p0-close.test.mjs red-first contract and behaviour tests
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

## Run the tests

```bash
node --test "workflows/test/*.test.mjs"
```

Expected today: the stream meta-tests pass; every workflow test fails with
`workflow draft missing: .../workflows/p0/p0-close.js` — that is the red-first state.

## Governance

- Not used by the controlled replication arm unless the operator pins this branch; these
  workflows are not an engine tool and add no verify command, registry or schema.
- Workflow files follow the author contract: one top-level `return defineWorkflow(...)`,
  synchronous, no imports, `workflow.shell` as the only I/O, checkpoints for budgets.
- Verification ladder before any install: canonical compile, this simulation suite with a
  fault matrix, then one bounded live run by path (proposal documents).
