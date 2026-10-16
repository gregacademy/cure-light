# Host harness — running the workflows through the real pi CLI

The stub host (`harness.mjs`) proves a draft's logic in-process. It cannot prove that the
real `/workflow` host resolves, compiles and runs the draft. This harness closes that gap:
the same case table is driven through both hosts, and a pure case must produce the same
canonical result on both.

```
node workflows/test/run.mjs             # fast: fixtures + contracts (stub host)
node workflows/test/run.mjs host        # opt-in: the same cases through the real pi CLI
node workflows/test/run.mjs compile     # opt-in: draft toolchain conformance
node workflows/test/run.mjs acceptance  # opt-in: frozen-baseline byte-equality
node workflows/test/run.mjs all
```

## 1. How a workflow is executed and observed (verified 2026-10-16, pi 1.3.0)

Invocation (one process per case; no shell involved, so args need no shell quoting):

```
pi --offline --no-session --mode json --print \
   --no-mcp --no-skills --no-prompt-templates --no-context-files \
   [--workflow-time <ms>] \
   "/workflow <workflow token> <verbatim args>"
```

Observation surface: the run writes JSONL events to stdout; extension records arrive as
`entry_appended` events. Nothing else is needed:

| Record | Carries |
|---|---|
| `workflow-shell` | per shell call: command, ok, exitCode, output, truncated, duration — LLM-invisible by design |
| `workflow-exit` | **the authoritative outcome**: `{reason, metadata: <the payload passed to workflow.exit()>}` |
| `workflow-summary` | reason, checkpoints, turns, classifySteps, cost, `limits`, `unbounded`, per-effect log |
| `workflow-log` | the workflow's own `console.log` text (the human card) |
| `workflow-limits` | only when **no** target flag is set: the headless no-target notice |
| `workflow-error` | `phase:"start"` when the workflow cannot be resolved/compiled/started |

Hard facts that shape the harness:

- **The process exit code is always 0** for a completed run, whatever the workflow reason
  (`frozen-artifact`, `error`, a compile failure all exit 0). Non-zero means a host-level
  failure only (bad flags, crash, spawn timeout). The harness therefore never reads the
  exit code as the result — except to flag an infrastructure error.
- **A command-only headless run persists no session file**, even with `--session-dir`.
  The stdout records are the only durable observation, so the driver captures them into
  the case dir (`host/pi.stdout.jsonl`, `host/pi.stderr`, `host/invocation.json`).
- `--workflow-time` and `--workflow-cost` are **pi CLI flags**, not workflow args. With a
  target set, the summary carries it (`limits.timeBudgetMs`); the `workflow-limits` record
  is written only when no target is set.
- A workflow that cannot be resolved reports `workflow-error {phase:"start", error:
  "Workflow not found: <token>. Available: ..."}` and writes no run records. The driver
  maps this to `E_WORKFLOW_MISSING`, the same code the stub host returns, so the red-first
  state fails identically in both tiers.
- A runtime throw becomes `workflow-exit {reason:"error", error:"<message>"}`.
- `workflow.shell` runs pi's bash tool with the invoking session cwd; the workflow's whole
  filesystem effect is therefore confined to the paths it is handed in `--args`.
- Nested invocation is safe: the harness spawns `pi` from inside a pi session's shell.

## 2. Case model — one input recipe, one oracle, two drivers

A case is data (`cases.mjs`): `workflow` (absolute path token), `prepare(caseDir)`
(materializes the input stream under `<caseDir>/run`), `args(runRoot)` (the verbatim
argument string), `expect.reason`, optional `expect.records`/`expect.excludes`,
`check(ctx)` (the invariants; throws on failure), `purity`, `hostFlags`, `skip()`.

`casekit.runCase(spec, {driver})` materializes, drives, evaluates and returns one report:

```
run-clean → exit-reason → record:<type> → checkId → purity-rerun
```

Both drivers return the same result shape (`{error, exit, logs, shellCalls, …}`), so the
same `check` body runs under either host. A failing case keeps its case dir and writes
`report.json`; a passing case removes it.

```
<caseDir>/run     the store (the only required input)
<caseDir>/cwd     the workflow's shell cwd — evidence dirs land here (cwd/.tmp/...)
<caseDir>/host    pi captures: stdout JSONL, stderr, invocation argv
<caseDir>/report.json
```

## 3. Purity contract

A case is **pure** when the same explicit parameters produce the same result. The harness
enforces three things:

1. **No ambient inputs**: `check` asserts the summary reports `turns == 0` and
   `classifySteps == 0` for pure cases — a model turn makes a run non-deterministic.
2. **Rerun equality**: the host driver runs a pure case twice from the *identical* initial
   state (the store is re-materialized, `cwd/.tmp` cleared) and requires the same digest.
3. **Host independence**: the smoke tier asserts the stub host and the real host produce
   the *same* digest for the same case. This is the machine-checked version of "behave
   like a pure function".

```
digest = sha256(canonicalJson({
  reason,                       // the exit reason
  exit: redact(payload),        // the payload passed to workflow.exit()
  tree: snapshotTree(runRoot),  // sorted relative path, size, sha256 for every artifact
}))
```

Normalization rules (documented so a new volatile field fails loudly):

- Volatile roots (`<caseDir>`, the store, the cwd, the repo) are replaced by tokens, so the
  digest is location-independent.
- A case may declare `purity.ignore: [keys]` for payload keys that are volatile by design
  (p0-close declares `paths`, which carries the stamped evidence dir). Everything else must
  be stable.
- Log text is captured in the report but excluded from the digest: it is the human card and
  may carry the evidence stamp/PID (`cwd/.tmp/<workflow>/<stamp>-<pid>`).

Author rules that keep a workflow pure (the harness fails the case when these are broken):

1. Every input arrives in the args string. No ambient reads: no `$PWD` discovery, no store
   search, no defaults for pins, no environment lookups beyond what the args name.
2. The exit payload is the machine result: reason plus stable values (hashes, counts,
   relative paths). No timestamps, PIDs, durations or absolute evidence paths.
3. A rerun from the same store state writes the same bytes and exits with the same reason.
4. No model turns, no network, no wall-clock-dependent branching in the pure core. Anything
   context-derived belongs in a separate resolver layer that *produces* the explicit args
   (see the zero-arg plan) — then both layers can be tested: the resolver's output args are
   the core's input case.

## 4. Orchestration by an agent

`host-run.mjs` is the entry point an agent drives (deterministic exit codes: `0` pass,
`1` assertion failure, `2` usage/harness error):

```
node workflows/test/host-run.mjs --list
node workflows/test/host-run.mjs smoke --driver host
node workflows/test/host-run.mjs merge-valid --reruns 3
node workflows/test/host-run.mjs p0-close --driver host --json
node workflows/test/host-run.mjs --all --driver stub --quiet
node workflows/test/host-run.mjs --live --workflow workflows/p0/p0-close.js \
  --store /tmp/run-copy \
  --args "--verifier /abs/kernel/tools/verify.mjs --verifier-sha256 <hex> --chunker-sha256 <hex>
          --input-ceiling-bytes 196608 --operator-ref operator:x/pr72-s1 --run-id chunkhound/pi-schematic#72
          --review-state s1 --base-oid <40hex> --subject-oid <40hex>" \
  --workflow-time 300000 --json
```

Loop: pick cases → run → read `failure`, `checks`, `paths.caseDir`, `host/pi.stdout.jsonl`
→ fix the draft or the case → rerun. `--live` is the bounded single run of the verification
ladder (step 4) against a copy: it keeps the case dir and prints the exit record.

## 5. MCP: what exists today

`pi mcp list` reports no configured MCP servers; the ch-chhound MCP surface exposes
search/daemon/worktree tools only — **there is no workflow-runner tool to call**. Options
if an MCP entry point is wanted later:

1. Wrap this CLI in a small MCP server (one `workflow_run` tool, JSON report in/out) — no
   change to pi or to the engine.
2. Drive `pi --mode rpc` from a long-lived client (`prompt` + `entry_appended` events) —
   same records, one process for many cases.

Both are additive; nothing in this harness depends on them.

## 6. Tiers and files

| File | Tier | Role |
|---|---|---|
| `hostdriver.mjs` | — | real pi CLI driver: argv, transcript parsing, result normalization |
| `casekit.mjs` | — | case runner: materialize, drive, evaluate, purity digest, report |
| `cases.mjs` | — | the sealed case table (`smoke`, `p0-close`, `baseline-replay`) |
| `host-run.mjs` | — | CLI for operators and agents (`--list`, groups, `--live`) |
| `fixtures/smoke-echo.js` | — | deterministic pure-shell fixture (no model turns) |
| `smoke.host.test.mjs` | host | harness self-test: real host run, purity, stub≡host digest |
| `p0-close.host.test.mjs` | host | the p0-close cases through the real CLI (red until the draft lands) |
| `p0-close.contract.test.mjs` | fast | the same cases through the stub host |

Constraints honoured: `kernel/tools/*` is never modified; cases run on copies under
`os.tmpdir()`; the real store and the frozen baseline are only ever read (the baseline case
copies first); host runs are opt-in, so the fast tier stays a sub-second loop.
