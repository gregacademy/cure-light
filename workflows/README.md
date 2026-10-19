# workflows/ — pi `/workflow` scripts for the review engine

Deterministic mechanical workflows for cure-light coordinator phases, written in the
pi-schematic `/workflow` author contract. Host tooling: `kernel/` and the pinned tools
(`verify.mjs`, `chunker.mjs`) stay untouched, and `verify join` remains the sole mechanical
acceptance boundary.

Start here: [`AUTHORING.md`](AUTHORING.md) — the builder loop, the test surfaces and the
purity rules. Then the packages:

| Path | Role |
|---|---|
| `AUTHORING.md` | catchall entry point for anyone building under `workflows/` |
| `run.mjs` | tier runner: `fast \| acceptance \| compile \| host \| prop \| all` |
| `p0/` | the p0-close workflow: merge/validate/p05/envelope ([`p0/SPEC.md`](p0/SPEC.md)) |
| `pack/` | the p0-pack workflow: P0.4 packing bridge — claims-list, assignments, instructions ([`pack/SPEC.md`](pack/SPEC.md)) |
| `testkit/` | shared host harness: stub host, case runner, real pi CLI driver, smoke cases, CLIs ([`testkit/HOST-HARNESS.md`](testkit/HOST-HARNESS.md)) |

Status: **p0-close is merged**. The `p0-pack` implementation is under review in the
uncommitted `mods/p0-pack` worktree. It is not merged, installed or adopted by the engine.
Engine call-site adoption is a separate decision. Review-pass verification (2026-10-19):
fast 60, host 55, prop 41, acceptance 3, compile 4. Rerun the tiers for the current counts.
Compile needs a complete pi-schematic checkout: set `PI_SCHEMATIC_CHECKOUT` if the default
checkout lacks `workflow/types.js`. That missing file is an environment failure, not a
draft failure.

Proposals this follows (workspace root, outside this repo):

- `cure-light-p0-close-workflow-proposal.md` — merge/validate/p05 + envelope
- `cure-light-records-workflow-proposal.md` — stage/state-head page write + read-back (not built; host invocation gap)

## Test tiers

Run these commands from the cure-light repo root.

| Tier | Runs | Role |
|---|---|---|
| fast (default) | `testkit/`, `p0/test/`, `pack/test/` without a tier token | fixture sanity, stub-host self-test, sealed contracts |
| host | `*.host.test.mjs` | the same cases through the real pi CLI + purity reruns |
| prop | `*.prop.test.mjs` | generated-input properties over mutation programs |
| acceptance | `*.acceptance.test.mjs` | frozen-baseline byte equality on a scratch copy; baseline required unless `P0_PACK_ACCEPTANCE_OPTIONAL=1` |
| compile | `*.compile.test.mjs` | `node --check` + canonical compile with a complete pi-schematic checkout |

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
