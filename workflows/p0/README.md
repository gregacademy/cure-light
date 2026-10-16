# workflows/p0 — the p0-close workflow

Entry point for builders: [`../AUTHORING.md`](../AUTHORING.md) — the loop, the two test
surfaces and the purity rules. The build spec is [`SPEC.md`](SPEC.md).

Status: **landed** (2026-10-16). `p0-close.js` is implemented and every tier is green:
fast 17/17 · host 17/17 · prop 17/17 · acceptance 1/1 (byte-exact baseline) · compile 2/2.

## What is here

| Path | Role |
|---|---|
| `SPEC.md` | what `p0-close` must do: invocation, inputs, steps 0–6, exit reasons, 15-output byte-equality acceptance |
| `p0-close.js` | the workflow: args gate, embedded merge helper, shadow-store envelope, staging-compare promotion |
| `fixtures/streams.mjs` | synthetic pre-close stream + fault variants + baseline copy (`node workflows/p0/fixtures/streams.mjs list`) |
| `fixtures/probe-mark.js` | planted-violation fixture for the property-engine self-test |
| `cases.mjs` | the sealed case table (one input recipe + one oracle per case) |
| `testkit.mjs` | draft path, pinned tool hashes, canonical `workflowArgs` |
| `prop/` | the property engine: `catalog.mjs` (properties), `mutations.mjs` (input space), `spec.mjs`, `render.mjs`, `runner.mjs`; spec in [`prop/PROP-ENGINE.md`](prop/PROP-ENGINE.md) |
| `prop-run.mjs` | property CLI (`--list`, `--cases`, `--seed`, `--spec`, `--json`) |
| `test/` | the p0-close suite: `contract`, `host`, `prop`, `acceptance`, `compile`, `streams`, `prop-engine` |

The property engine currently lives here because every store, mutation and property it
drives is p0's. Move it to `../testkit/` when a second workflow needs it.

## Running

```bash
node workflows/run.mjs fast        # stub contracts, sub-second — iterate here
node workflows/run.mjs prop        # generated-input properties
node workflows/run.mjs host        # the same cases through the real pi CLI
node workflows/testkit/host-run.mjs p0-close --driver stub --json
node workflows/p0/prop-run.mjs p0-close --cases 10 --seed 1
```

Tier state (2026-10-16, landed): fast 17/17, host 17/17, prop 17/17, acceptance 1/1,
compile 2/2. Generated-input properties also hold over seeds 1..16.
