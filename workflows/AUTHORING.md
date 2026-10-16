# Authoring workflows

Catchall entry point for anyone building under `workflows/` — the draft workflows and their
specs/tests. Read this first, then the build spec of the workflow you are implementing, then
the harness reference you need.

Semantics stay per-workflow: this file never restates what a workflow must do. The current
one, `p0-close`, is specified in `workflows/p0/SPEC.md`.

## Read in this order

| # | File | What you get |
|---|---|---|
| 1 | `workflows/AUTHORING.md` (this file) | the loop, the two test surfaces, the rules |
| 2 | `workflows/p0/SPEC.md` | what the draft must do: steps 0–6, the six exit reasons, the 15-output byte-equality table |
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

The spec and the tests are written; the draft is not. That is deliberate — the suite is the
executable specification. Build the draft until each tier goes green, in cost order:

```bash
node workflows/run.mjs fast        # stub host, sub-second — iterate here
node workflows/run.mjs prop        # generated-input properties (stub by default)
node workflows/run.mjs host        # real pi CLI + purity rerun — the host contract
node workflows/run.mjs acceptance  # frozen-baseline byte equality (15 outputs)
node workflows/run.mjs compile     # draft toolchain conformance
```

Current red-first state (2026-10-16, draft absent):

| Tier | State |
|---|---|
| fast | 17 tests: 6 pass, 11 fail (`E_WORKFLOW_MISSING`) |
| host | smoke 4 pass; p0-close 12 red |
| prop | 17 tests: 10 pass (engine self-tests), 7 skipped (p0-close) |
| acceptance | red (baseline present, draft missing) |
| compile | 2 skipped |

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
| Table | `workflows/p0/cases.mjs` | `workflows/p0/prop/catalog.mjs` |

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
`workflows/p0/test/host.test.mjs` iterates the same objects through the real pi CLI. Add the
case to the table — no test-file change. A new workflow gets its own folder (with the same
`cases.mjs` / `testkit.mjs` / `test/` split) and a group entry in
`workflows/testkit/host-run.mjs`; add its test dir to `workflows/run.mjs`.

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
  title: "every run answers with one of the six authored exit reasons",
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

- `gen` defaults to `genStoreSpec()` — 0..N mutations over 1–2 boxes. Constrain it
  (`genStoreSpec({ mutationNames: [], probeMax: 1 })`) for focused properties.
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
program into `workflows/p0/cases.mjs` as a sealed case: the case keeps the incident dead,
the property keeps guarding the class. Property CLI exit codes: 0 held · 1 counterexample ·
2 usage/engine error · 3 workflow absent.

## Extend the input space

A mutation is data in `workflows/p0/prop/mutations.mjs`: `summary`, `stage`
(`prewrite|pin|merge|freeze|envelope`), `expected` (sealed exit reason, or `null` + `note`
when the spec is undecided), `params` (generation/shrink metadata), `apply(runRoot, params)`.
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
unpinned. Unpinned programs are classified, never asserted. The three unpinned rows (D4
draft-equal, envelope-equal, p05-no-ceiling) are operator decisions: never invent a reason
for them.

## Purity rules (non-negotiable)

1. **Explicit inputs only.** Every input arrives in the args string. No ambient reads: no
   `$PWD` discovery, no store search, no defaults for pins.
2. **The exit payload is the machine result.** Stable values only — hashes, counts, relative
   paths. No timestamps, PIDs, durations or absolute evidence paths; declare volatile keys
   in `purity.ignore`.
3. **A rerun writes the same bytes and exits with the same reason.**
4. **No model turns in a pure case.** Anything context-derived belongs in a separate
   resolver layer that produces the explicit args; a case that needs a turn must set
   `purity: false` and pin its records.
5. **Stay inside the six authored exit reasons.** Reserved tokens are never authored.
6. **Probe error paths.** A tool that is only exercised on the happy path hides bugs:
   test the refusal paths, the missing inputs and the failed reruns explicitly.

## Run and read

| Command | Use |
|---|---|
| `node workflows/run.mjs fast` | stub contracts — the always-run loop |
| `node workflows/run.mjs host` | real pi CLI; spawns one pi per case |
| `node workflows/testkit/host-run.mjs --list` | list cases |
| `node workflows/testkit/host-run.mjs <case\|group> --driver host --json` | full report: checks, digest, evidence paths |
| `node workflows/testkit/host-run.mjs --live --workflow <path> --store <copy> --args "<verbatim>"` | bounded ad-hoc run, keeps its evidence |
| `node workflows/p0/prop-run.mjs <prop\|group> --cases N --seed S [--driver host]` | generated trials; the same seed replays the same sequence |
| `node workflows/p0/prop-run.mjs <prop> --spec '<json>' --driver host` | replay one store |
| `node workflows/run.mjs all` | every tier |

Exit codes: `host-run.mjs` 0 pass · 1 assertion failure · 2 usage/harness error.
`prop-run.mjs` 0 held · 1 counterexample · 2 usage/engine error · 3 workflow absent.

## Constraints

- Host runs are opt-in; the fast tier stays a sub-second loop.
- Every case runs on a copy under `os.tmpdir()`; the real store and the frozen baseline are
  read-only inputs.
- `kernel/tools/*` is never modified. `verify.mjs` stays byte-identical.
- `workflows/p0/p0-close.js` must keep the fast tier at its red-first count until it lands:
  green tiers after the draft exists, never before.

## Reference index

- `workflows/testkit/HOST-HARNESS.md` — §1 host observation surface, §2 case model, §3 purity
  contract, §4 agent CLI, §5 MCP finding, §6 tiers and files.
- `workflows/p0/prop/PROP-ENGINE.md` — §2 determinism, §3 input model + mutation table, §4
  generators, §5 properties + `ctx`, §6 coverage/discards/budget, §7 promotion to a case,
  §8 non-goals.
- `workflows/p0/SPEC.md` — p0-close invocation, steps, exit reasons, artifact table, tiers,
  ladder, non-goals.
- `kernel/tools/verify-testkit.mjs` — store read helpers and `runVerifier` used by cases and
  fixtures.
