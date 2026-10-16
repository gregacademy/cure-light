# workflows/ — pi `/workflow` scripts for the review engine

Deterministic mechanical workflows for cure-light coordinator phases, written in the
pi-schematic `/workflow` author contract. Host tooling: `kernel/` and the pinned tools
(`verify.mjs`, `chunker.mjs`) stay untouched, and `verify join` remains the sole mechanical
acceptance boundary.

Start here: [`AUTHORING.md`](AUTHORING.md) — the builder loop, the test surfaces and the
purity rules. Then the two packages:

| Path | Role |
|---|---|
| `AUTHORING.md` | catchall entry point for anyone building under `workflows/` |
| `run.mjs` | tier runner: `fast \| acceptance \| compile \| host \| prop \| all` |
| `p0/` | the p0-close workflow: build spec, fixtures, cases, property engine, tests ([`p0/README.md`](p0/README.md)) |
| `testkit/` | shared host harness: stub host, case runner, real pi CLI driver, smoke cases, CLIs ([`testkit/HOST-HARNESS.md`](testkit/HOST-HARNESS.md)) |

Status: **construction started 2026-10-15**, red-first. `workflows/p0/p0-close.js` does not
exist yet; the p0-close tests are expected to fail until it lands.

Proposals this follows (workspace root, outside this repo):

- `cure-light-p0-close-workflow-proposal.md` — merge/validate/p05 + envelope
- `cure-light-records-workflow-proposal.md` — stage/state-head page write + read-back

## Test tiers

| Tier | Runs | Role |
|---|---|---|
| fast (default) | `testkit/`, `p0/test/` without a tier token | fixture sanity, stub-host self-test, red-first contracts |
| host | `*.host.test.mjs` | the same cases through the real pi CLI + purity reruns |
| prop | `*.prop.test.mjs` | generated-input properties over mutation programs |
| acceptance | `*.acceptance.test.mjs` | frozen-baseline byte equality on a scratch copy |
| compile | `*.compile.test.mjs` | `node --check` + canonical compile |

```bash
node workflows/run.mjs             # fast (default) — the build loop
node workflows/run.mjs host        # real pi CLI, opt-in (seconds per case)
node workflows/run.mjs all         # every tier
```

## Governance

- Not used by the controlled replication arm unless the operator pins this branch; these
  workflows are not an engine tool and add no verify command, registry or schema.
- Workflow files follow the author contract: one top-level `return defineWorkflow(...)`,
  synchronous, no imports, `workflow.shell` as the only I/O, checkpoints for budgets.
- Verification ladder before any install: canonical compile, the simulation suite with a
  fault matrix, then one bounded live run by path (see `p0/SPEC.md`).
