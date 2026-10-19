# pack/ — p0-pack: the P0.4 packing bridge as one deterministic workflow

Build spec: [`SPEC.md`](SPEC.md) (what the workflow must do). Builder loop, purity rules and
the case/property authoring shapes: [`../AUTHORING.md`](../AUTHORING.md). Harness facts:
[`../testkit/HOST-HARNESS.md`](../testkit/HOST-HARNESS.md).

`p0-pack` is designed to replace the hand-rolled `ai068` placement step of the P0.4 join
pass. It projects
`join/claims-list.json` from the claims draft, renders the per-box child instructions, and
packs whole units greedily by input length into `join/box-<NNNN>.assignment.json`. Its
outputs are exactly the files `p0-close` already consumes as pinned required inputs, so the
P0 mechanical chain is `p0-pack` → box fleet → `p0-close` → `verify join`.

| Path | Role |
|---|---|
| `SPEC.md` | build spec: invocation, inputs, steps, exit reasons, outputs, tiers |
| `p0-pack.js` | the workflow draft (one `defineWorkflow`, shell-only, no model turns) |
| `fixtures/streams.mjs` | synthetic pre-pack stores, fault injection, baseline copy |
| `fixtures/generate.mjs` | materializes browsable input/output fixtures under `fixtures/generated/` (gitignored) |
| `fixtures/baseline-pins.mjs` | corrected-render pins + capture provenance (acceptance) |
| `cases.mjs` | the sealed case table (id, input recipe, expected reason, invariants) |
| `testkit.mjs` | draft path and the canonical invocation |
| `prop/` | property engine (copy of the p0 engine) + pack catalog/mutations |
| `prop-run.mjs` | property CLI: `--list`, `--cases`, `--seed`, `--spec`, `--json` |
| `test/` | the suite: streams, contract (fast), host + documented-recipe probe, prop, acceptance, compile |

Status: **adopted by the kernel call site** in the uncommitted `mods/p0-pack` worktree.
`p0-close` is merged. `p0-pack` is not merged or installed. Review-pass verification
(2026-10-19):
fast 60/60 overall (p0-pack 43), host 56/56 overall (p0-pack 39), prop 41/41 overall
(p0-pack 9), acceptance 3/3 (13 baseline outputs + pin provenance), and compile 4/4 with
a complete pi-schematic checkout. Rerun the tiers for the current counts. Canonical
compile needs a complete pi-schematic checkout. Set `PI_SCHEMATIC_CHECKOUT` if the
default checkout lacks `workflow/types.js`; a missing file is an environment failure, not
a draft failure. Acceptance needs the recorded store: absence fails unless
`P0_PACK_ACCEPTANCE_OPTIONAL=1` is set.

From the cure-light repo root, you can materialize browsable fixtures (inputs and
produced outputs). These trees are gitignored, ~290 KiB per variant. No test reads them:

```bash
node workflows/pack/fixtures/generate.mjs          # two-box, single-box, opaque-unit
node workflows/pack/fixtures/generate.mjs --list   # variants and their ceilings
```

```bash
node workflows/run.mjs             # fast (default)
node workflows/run.mjs host        # real pi CLI, opt-in
node workflows/run.mjs prop        # generated-input properties
node workflows/run.mjs acceptance  # corrected-render byte equality; baseline store required unless opted out
node workflows/run.mjs compile     # node --check + canonical compile; needs complete pi-schematic checkout
```

Governance mirrors `p0/`: in-repo only, `kernel/tools/*` untouched, `verify join` stays the
sole mechanical acceptance boundary, copies only, no install, no controlled-replication use
without operator approval.
