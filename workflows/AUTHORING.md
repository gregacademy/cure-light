# Authoring workflows

Catchall entry point for anyone building under `workflows/` — the draft workflows and their
specs/tests. Read this first, then the build spec of the workflow you are implementing, then
the harness reference you need.

Semantics stay per-workflow: this file never restates what a workflow must do. `p0-close`
(`workflows/p0/SPEC.md`) is merged. `p0-pack` (`workflows/pack/SPEC.md`) is adopted by
the kernel call site in the uncommitted `mods/p0-pack` worktree, but is not merged or
installed.

## Read in this order

| # | File | What you get |
|---|---|---|
| 1 | `workflows/AUTHORING.md` (this file) | the loop, the two test surfaces, the rules |
| 2 | `workflows/p0/SPEC.md` (or `workflows/pack/SPEC.md`) | what the draft must do: steps, exit reasons, the byte-equality table |
| 3 | `workflows/testkit/HOST-HARNESS.md` §2–§3 | the case model and the purity contract |
| 4 | `workflows/p0/prop/PROP-ENGINE.md` | the property engine, when hand-picked inputs are not enough |

## Where things live

```
workflows/
  AUTHORING.md          this file — the builder entry point
  run.mjs               tier runner (fast | host | prop | acceptance | compile | all)
  p0/                   the p0-close workflow
    SPEC.md             build spec
    fixtures/           synthetic + baseline streams, fault variants, probe fixture
    cases.mjs           sealed case table
    testkit.mjs         draft path, tool pins, canonical args
    prop/               property engine: catalog, mutations, spec, render, runner
    prop-run.mjs        property CLI
    test/               the p0-close suite (contract, host, prop, acceptance, compile)
  pack/                 the p0-pack workflow
    SPEC.md             build spec
    fixtures/           synthetic pre-pack streams (+ generated/ trees CLI), fault variants, corrected-render pins
    cases.mjs           sealed case table
    testkit.mjs         draft path, canonical args
    prop/               property engine (p0 copy): catalog, mutations, spec, render, runner
    prop-run.mjs        property CLI
    test/               the p0-pack suite (contract, host, prop, acceptance, compile)
  testkit/              shared harness
    harness.mjs         stub host (in-process)
    casekit.mjs         case runner + purity digest
    hostdriver.mjs      real pi CLI driver
    host-run.mjs        case CLI for agents and operators
    cases.mjs           smoke cases (the harness's own plumbing proof)
    fixtures/           smoke-echo.js
    HOST-HARNESS.md     harness design and verified host facts
```

`kernel/tools/*` is read-only: `verify.mjs` stays byte-identical and `verify join` remains
the sole mechanical acceptance boundary.

## The builder loop

The suite is the executable specification. Build or review the draft in cost order:

```bash
node workflows/run.mjs fast        # stub host, sub-second — iterate here
node workflows/run.mjs prop        # generated-input properties (stub by default)
node workflows/run.mjs host        # real pi CLI + purity rerun — the host contract
node workflows/run.mjs acceptance  # baseline required unless explicitly opted out (p0-close 15; p0-pack 13)
node workflows/run.mjs compile     # requires a complete pi-schematic checkout
```

The current `node workflows/run.mjs <tier>` output is the authority for counts. The
2026-10-19 review pass reported these counts in this worktree:

| Tier | Review-pass report |
|---|---|
| fast | 60/60 pass (testkit 3 + p0-close 14 + p0-pack 43) |
| host | 56/56 pass (smoke 4 + p0-close 13 + p0-pack 39) |
| prop | 41/41 pass (engine 15 + p0-close 17 + p0-pack 9) |
| acceptance | 3/3 pass (p0-close 15 outputs; p0-pack 13 outputs + pin provenance) |
| compile | 4/4 pass with a complete checkout; not guaranteed in the default checkout |

Canonical compile needs a complete pi-schematic checkout. Set `PI_SCHEMATIC_CHECKOUT` if
the default checkout lacks `workflow/types.js`. A missing file is an environment failure,
not a draft failure. Acceptance fails when the baseline is absent unless
`P0_PACK_ACCEPTANCE_OPTIONAL=1` is set.

The review pass ran 12 seeds x 25 p0-pack property cases; the 2026-10-17 pre-review check
used seeds 1..16. One runnable example is
`node workflows/pack/prop-run.mjs p0-pack --cases 10 --seed 1`. Use
`node workflows/p0/prop-run.mjs --list` to select a p0-close property.

Do not make a tier look green by weakening a case or by implementing the draft inside the
test session. Fix the draft, or fix the case/property and state the reason in the change.

Tiers are selected by the tier token at the end of the test filename: `contract.test.mjs`
is fast; `host.test.mjs`, `prop.test.mjs`, `acceptance.test.mjs` and `compile.test.mjs` are
opt-in (`smoke.host.test.mjs` and `prop-engine.prop.test.mjs` match too).

## Two surfaces, one runner

| | Sealed case | Property |
|---|---|---|
| Input | hand-written recipe (`prepare` + `args`) | generated store spec (`gen` → mutation program) |
| Oracle | `expect.reason` + `check(ctx)` assertions | invariant in `property(ctx)` — no expected value |
| Finds | regressions on known incidents | bugs across a whole input class |
| Cost | stub ms, real host seconds | stub trial ~10–30 ms, host trial ~2–4 s |
| Table | `workflows/p0/cases.mjs` or `workflows/pack/cases.mjs` | `workflows/p0/prop/catalog.mjs` or `workflows/pack/prop/catalog.mjs` |

Rule: **a case pins an incident; a property guards a class.** A failing property is shrunk
and replayed, then promoted into a sealed case. Both surfaces end in the same runner
(`testkit/casekit.mjs`): a property trial is one generated store driven exactly like a case.

## Author a sealed case

Shape — all fields are data; the runner is `casekit.runCase`:

```js
{ id, group, title, workflow,
  prepare(caseDir) -> { runRoot, pins? },
  args(runRoot) -> string,
  expect: { reason, records?, excludes? },
  check(ctx) { ... },          // throw to fail, return notes for the report
  purity?, hostFlags?, skip? }
```

`check(ctx)` receives `{ result, runRoot, before, pins, driver, caseDir }`. `result.exit` is
the payload passed to `workflow.exit()`; `before` is the pre-run content snapshot of the
store, so "refused ⇒ wrote nothing" is one line:

```js
{
  id: "fault-row-order", group: "p0-close",
  title: "refuses row-order with validation-failed and leaves the store untouched",
  workflow: DRAFT,
  prepare: synthetic("fault-row-order", { fault: "row-order" }),
  args: (runRoot) => workflowArgs(runRoot),
  expect: { reason: "validation-failed" },
  hostFlags: HOST_FLAGS,
  purity: { ignore: ["paths"] },
  check({ runRoot, before }) {
    assert.deepEqual(snapshotTree(runRoot), before);
    return [`store untouched (${before.length} files)`];
  },
  checkId: "store-untouched",
}
```

`DRAFT` and `workflowArgs` come from `workflows/p0/testkit.mjs`; `synthetic` and `HOST_FLAGS`
are local helpers in `workflows/p0/cases.mjs`.

Wiring: `workflows/p0/test/contract.test.mjs` iterates `P0_CLOSE_CASES` on the stub host;
`workflows/p0/test/host.test.mjs` uses the same cases through the real pi CLI.
`workflows/pack/test/contract.test.mjs` and `workflows/pack/test/host.test.mjs` use
`PACK_CASES` in the same way. Add a case to its package table — no test-file change.
A new workflow gets its own `cases.mjs` / `testkit.mjs` / `test/` split and a group
entry in `workflows/testkit/host-run.mjs`; add its test dir to `workflows/run.mjs`.

Defaults and evidence:

- The stub driver runs a case once; a pure host case runs twice from the identical initial
  state and compares the digest (`--reruns n` forces more on either driver).
- `expect.records`/`expect.excludes` are host-only transcript assertions (e.g.
  `workflow-limits`).
- Declare volatile payload keys in `purity.ignore`; `p0-close` declares `paths`.
- A failing case keeps `<caseDir>` with `run/`, `cwd/`, `host/pi.stdout.jsonl` and
  `report.json`; a passing case deletes it. `host-run.mjs --keep` retains all.

## Author a property

Shape:

```js
{ name, group, title, workflow, args(runRoot) -> string,
  property(ctx), gen?, shrink?, cover?, note? }
```

`ctx = { spec, report, driver, caseDir, classify(label), run(siblingSpec), rerun(overrides) }`.
Throw to fail; return a label string or array. `report` is the case report of the trial:
`{ reason, exit, resultDigest, snapshot, paths.runRoot, failure }`. A minimal, oracle-free
invariant:

```js
{
  name: "reason-is-authored", group: "p0-close",
  title: "every run answers with one of this workflow's authored exit reasons",
  workflow: DRAFT,
  args: (runRoot) => workflowArgs(runRoot),
  property(ctx) {
    const reason = ctx.report.reason;
    ctx.classify(`reason=${reason}`);
    if (!AUTHORED_REASONS.includes(reason)) {
      throw new PropertyViolation(`unauthored exit reason: ${JSON.stringify(reason)}`);
    }
    return reason;
  },
}
```

- In `p0-close`, `gen` defaults to its `genStoreSpec()` — 0..N mutations over 1–2
  boxes. Constrain it (`genStoreSpec({ mutationNames: [], probeMax: 1 })`) for focused
  properties. `p0-pack` uses its own unit-inventory `genStoreSpec()`.
- `cover` turns a label into a requirement; an unmet threshold fails the property without
  inventing a counterexample.
- Duplicate generated specs are served from the canonical-spec cache: `storeRuns < trials`
  is normal.

Failure loop — find, shrink, replay, promote:

```
FAIL  <name>  driver=stub  seed=7  trials=1
      counterexample (trial 0, trialSeed …): boxes=1 mutations=[clean] probe={"n":4}
      shrunk x1: boxes=1 mutations=[clean] probe={"n":2}
      replay: node workflows/p0/prop-run.mjs <name> --spec '<json>' --driver stub
```

The shrunk spec is the bug report. Replay it on both drivers, then promote the mutation
program into the same package's `cases.mjs` as a sealed case: the case pins the incident,
the property guards the class. Property CLI exit codes: 0 held · 1 counterexample ·
2 usage/engine error · 3 workflow absent.

## Extend the input space

A mutation is data in the package's `prop/mutations.mjs`. This p0-close example uses
`summary`, `stage` (`prewrite|pin|merge|freeze|envelope`), `expected` (sealed exit reason,
or `null` + `note` when the spec is undecided), `params` (generation/shrink metadata),
and `apply(runRoot, params)`.
Throw `MutationNotApplicable` when the target is absent — the runner counts that as a
discard, never a failure.

```js
"row-order": {
  stage: "merge",
  summary: "swap two rows so the box order no longer matches the assignment",
  expected: "validation-failed",
  params: {},
  apply: rowOrder,
},
```

The **stage rule** decides the expectation: the earliest stage any applied mutation touches
decides the outcome, and one unpinned mutation at that stage makes the whole program
unpinned. Unpinned programs are classified, never asserted. The three p0-close unpinned
rows (D4 draft-equal, envelope-equal, p05-no-ceiling) are operator decisions: never invent
a reason for them.

## Purity rules (non-negotiable)

1. **Explicit inputs only.** Store and pin inputs arrive in the args string. Do not search
   for stores or default pins. `$PWD` is used only for run-scoped evidence.
2. **The exit payload is the machine result.** Compare stable values such as hashes and
   counts. Declare volatile keys, such as absolute `paths`, in `purity.ignore`; never
   compare timestamps, PIDs or durations.
3. **A rerun writes the same bytes and exits with the same reason.**
4. **No model turns in a pure case.** Anything context-derived belongs in a separate
   resolver layer that produces the explicit args; a case that needs a turn must set
   `purity: false` and pin its records.
5. **Stay inside each workflow's authored exit reasons.** `p0-close` has six; `p0-pack`
   has `ok`, `needs-input`, `frozen-artifact`, `evidence-failed`. Reserved tokens are
   never authored.
6. **Probe error paths.** A tool that is only exercised on the happy path hides bugs:
   test the refusal paths, the missing inputs and the failed reruns explicitly.

## Run and read

Run these from the cure-light repo root. Entries with `<...>`, `N` or `S` are templates;
replace those values before running.

| Command | Use |
|---|---|
| `node workflows/run.mjs fast` | stub contracts — the always-run loop |
| `node workflows/run.mjs host` | real pi CLI; spawns one pi per case |
| `node workflows/testkit/host-run.mjs --list` | list cases |
| `node workflows/testkit/host-run.mjs <case\|group> --driver host --json` | full report: checks, digest, evidence paths |
| `node workflows/testkit/host-run.mjs --live --workflow <path> --store <copy> --args "<verbatim>"` | bounded ad-hoc run, keeps its evidence |
| `node workflows/p0/prop-run.mjs <prop\|group> --cases N --seed S [--driver host]` | p0-close trials; the same seed replays the same sequence |
| `node workflows/pack/prop-run.mjs <prop\|group> --cases N --seed S [--driver host]` | p0-pack trials; the same seed replays the same sequence |
| `node workflows/p0/prop-run.mjs <prop> --spec '<json>' --driver host` | replay one p0-close store |
| `node workflows/pack/prop-run.mjs <prop> --spec '<json>' --driver host` | replay one p0-pack store |
| `node workflows/run.mjs all` | every tier |

Exit codes: `host-run.mjs` 0 pass · 1 assertion failure · 2 usage/harness error.
`prop-run.mjs` 0 held · 1 counterexample · 2 usage/engine error · 3 workflow absent.

## Constraints

- Host runs are opt-in; the fast tier stays a sub-second loop.
- Every case runs on a copy under `os.tmpdir()`; the real store and the frozen baseline are
  read-only inputs.
- `kernel/tools/*` is never modified. `verify.mjs` stays byte-identical.
- A new draft must keep the fast tier red until implementation passes the sealed cases;
  never weaken cases to report a green tier.

## Reference index

- `workflows/testkit/HOST-HARNESS.md` — §1 host observation surface, §2 case model, §3 purity
  contract, §4 agent CLI, §5 MCP finding, §6 tiers and files.
- `workflows/p0/prop/PROP-ENGINE.md` (p0-close) or
  `workflows/pack/prop/PROP-ENGINE.md` (p0-pack) — §2 determinism, §3 input model + mutation table, §4
  generators, §5 properties + `ctx`, §6 coverage/discards/budget, §7 promotion to a case,
  §8 non-goals.
- `workflows/p0/SPEC.md` — p0-close invocation, steps, exit reasons, artifact table, tiers,
  ladder, non-goals.
- `kernel/tools/verify-testkit.mjs` — store read helpers and `runVerifier` used by cases and
  fixtures.
