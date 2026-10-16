# Property engine — generated-input testing (QuickCheck-style)

The case table (`cases.mjs`) proves behavior on hand-picked inputs. The property engine proves
it over a *generated* input space: random mutation programs applied to the synthetic store,
each checked against an invariant that needs no oracle, with a failing input shrunk to a
minimal counterexample and replayed by seed or by spec.

```
node workflows/test/run.mjs prop                                  # opt-in tier
node workflows/test/prop-run.mjs --list
node workflows/test/prop-run.mjs engine --cases 40 --seed 1
node workflows/test/prop-run.mjs p0-close --driver stub --cases 10 --json
node workflows/test/prop-run.mjs <name> --spec '<store-spec JSON>' --driver host
```

Exit codes: `0` every property held · `1` a counterexample was found · `2` usage/infrastructure
error · `3` the workflow under test does not exist yet (skipped).

## 1. What this buys over more fixtures

- **Input space, not examples.** The mutation registry is the fault matrix as data: any
  combination of 0..3 mutations, over a 1- or 2-box store, with the numeric parameters
  (dropped units, ceiling drift, witness variant) chosen by the generator.
- **Invariants, not expected values.** "A refusal writes nothing", "an accept is complete and
  passes `verify join`", "the digest is stable", "the merge is packing-invariant" hold for
  every input, so no model of the merge is needed to test the merge.
- **Minimal counterexamples.** A failure is shrunk to the smallest spec that still fails, so the
  bug is reported as `boxes=1 mutations=[ceiling-drift(delta=1)]` rather than a random store.
- **Replay.** A counterexample is a JSON spec: `--seed S --cases N` replays the trial sequence,
  `--spec` replays one store, and both work under the stub host and the real pi CLI.
- **Honest coverage.** Every label (reason, box count, mutation, probe) is counted, and
  `cover` thresholds fail the property when the interesting branches were never exercised.

## 2. Determinism contract

| Level | Rule |
|---|---|
| Run | `--seed S` fixes the whole trial sequence; trial `i` uses `trialSeed = fnv1a(S, "trial", i)` |
| Store | a spec renders to byte-identical bytes (`renderStore`); no clock, PID or filesystem order enters it |
| Trial | one generated store is driven exactly as a sealed case: same runner, same report, same digest rules |
| Failure | reported with the trial index, the trial seed, the spec, the shrunk spec and both replay commands |
| Shrink | greedy over `shrinkStoreSpec`, cached by canonical spec, bounded by `--max-shrinks` (default 80) |

The engine never mutates the engine under test, the real store, or the frozen baseline: every
trial renders into its own case dir under `os.tmpdir()`.

## 3. Input model

```json
{ "schema": "store-spec/1",
  "boxes": 1 | 2,
  "mutations": [ { "name": "bad-witness", "params": { "variant": "mid-line" } }, ... ],
  "probe": { "n": 2 }            // engine self-tests only (written to <store>/.probe.json)
}
```

`boxes` selects one or two boxes, `mutations` is the program, and `probe` exists only for the
engine self-tests. Rendering starts from the same synthetic pre-close stream the sealed cases
use (`syntheticStream`), then applies the mutation program. Every mutation is a deterministic
edit; one that cannot apply (no rows to reorder, nothing left to drop) throws
`MutationNotApplicable`, which the runner counts as a **discard**, never a failure.

Mutation registry (`prop/mutations.mjs`), with the pipeline stage that decides a refusal:

| Mutation | Stage | Pinned reason |
|---|---|---|
| `drop-units(count)` | prewrite | `ok` (a smaller legal store) |
| `ceiling-drift(delta)` | prewrite | `needs-input` |
| `payload-missing` | prewrite | `needs-input` |
| `duplicate-pair` | merge | `validation-failed` |
| `row-order` | merge | `validation-failed` |
| `unknown-claim` | merge | `validation-failed` |
| `bad-witness(absent\|mid-line\|overlong\|multiline)` | merge | `validation-failed` |
| `missing-row` | merge | `validation-failed` |
| `extra-row` | merge | `validation-failed` |
| `zero-link` | merge | `ok` (recorded as `candidate_unclaimed`) |
| `unresolved` | merge | `ok` (a legal row state) |
| `non-ascii` | merge | `ok` (escaping probe) |
| `preexisting-draft` | freeze | `frozen-artifact` |
| `preexisting-envelope` | freeze | `frozen-artifact` |
| `preexisting-draft-equal` | freeze | **unpinned** (D4 idempotence) |
| `preexisting-envelope-equal` | freeze | **unpinned** (overwrite policy for equal bytes) |
| `p05-no-ceiling` | envelope | **unpinned** (token assumed `evidence-failed`) |

Mutations must resolve the files that actually exist: the 1-box stream carries the seed's global
`join/p05-evidence.json`, the 2-box stream carries per-box sidecars. A mutation that cannot find
its target throws `MutationNotApplicable` (a discard) rather than a raw filesystem error.

A property that pins reasons uses the stage rule: the **earliest stage** any applied mutation
touches decides the outcome (a pre-write mismatch refuses before the merge runs); an unpinned
mutation at that stage makes the program unpinned, and the property classifies instead of
asserting. This is how the engine avoids inventing semantics — the three unpinned rows are
operator decisions, not test gaps.

## 4. Generators

`prop/gen.mjs` — `constant`, `nat`, `chance`, `oneOf` (weighted), `array`, `subset`,
`elements`, `map`, `suchThat`. `prop/rng.mjs` — FNV-1a seed derivation and mulberry32.
`prop/spec.mjs` — `genStoreSpec({mutationNames, maxMutations, boxes, probeMax})`, the default
generator, plus `canonicalSpec`/`describeSpec`.

Rules for adding a generator: values must be JSON-serializable (a counterexample is stored as
JSON), the derived spec must render deterministically, and the shrinker must be able to make it
smaller (numbers → 0, collections → shorter).

## 5. Properties

A property is `(ctx) => void | label | label[]`; throwing fails the trial. `ctx` exposes:

| Member | Use |
|---|---|
| `ctx.report` | the case report of this trial: `reason`, `exit`, `resultDigest`, `snapshot`, `paths.runRoot` |
| `ctx.spec` | the store spec (mutations, boxes, probe) |
| `ctx.classify(label)` / returned labels | coverage |
| `ctx.run(siblingSpec)` | metamorphic: drive another store and compare digests/drafts |
| `ctx.rerun(overrides)` | idempotence: drive the **same** store again (never reset) |

The p0-close catalog (`prop/catalog.mjs`): `refuse-leaves-the-store-untouched`,
`reason-is-authored`, `accept-implies-complete-and-verifiable` (15 outputs + `verify join`),
`mutation-program-reaches-its-sealed-reason`, `accepted-runs-have-a-stable-digest`,
`packing-invariance`, `resume-never-rewrites-different-bytes`.

Engine self-tests (`engine` group) run against `fixtures/probe-mark.js`, a fixture with one
planted violation, and are green today: the engine must find the violation, shrink it to the
minimal counterexample, replay it through both hosts, honour `cover`, and count discards.

## 6. Coverage, discards and budget

**Failure taxonomy** — the engine distinguishes four outcomes, and only one of them is a bug in the
workflow under test:

| Outcome | Meaning | Reported as |
|---|---|---|
| property violation | the invariant did not hold for a generated store | counterexample (+ shrunk form, replay commands) |
| discard | the generator or a mutation could not produce this input (`GeneratorDiscard`, `MutationNotApplicable`) | `discarded` count, no failure |
| skip | the workflow under test does not exist yet | `skipped`, CLI exit `3` |
| engine error | a bug in the generator, renderer or a mutation (e.g. an unreadable sidecar) | `infraError`, report still written, CLI exit `2`, run stops |

A replay (`--spec`) applies the same rule: a run that did not happen is never a pass. A missing
draft reports `skipped`, any other run-level error reports the run failure itself.

- Labels come from the spec (boxes, mutation count, each mutation, probe) and from the property
  (typically `reason=<token>`); `coverage.labels` reports count and percentage over trials.
- `def.cover = [{label, minPct}]` turns a label into a requirement; an unmet threshold fails the
  property *without* inventing a counterexample.
- `discarded` counts generator rejections and inapplicable mutations; `budget.storeRuns` counts
  every store actually driven (including shrink attempts and sibling runs) — the real cost knob.
- Trials are cheap on the stub host (~10-30 ms) and expensive on the real host (~2-4 s): keep
  `--cases` in the tens for `stub`, in the single digits for `host`, and use `--spec` for host
  replays of a known counterexample.

## 7. From counterexample to regression case

A failing run prints the shrunk spec and a `--spec` replay command. To keep the bug dead, promote
it: add the spec's mutation program to the sealed case table (`cases.mjs`) as a case whose check
asserts the reason and the store invariants, then re-run the fast and host tiers. The property
then only guards the class; the sealed case guards the incident.

## 8. Non-goals and open items

- No model-turn properties: a `workflow.run` turn is non-deterministic. Such a workflow must be
  tested with `purity: false` cases and pinned records, not with generated input.
- No hostile filesystem or process faults (disk full, permissions, SIGKILL): the mutation
  vocabulary stays inside the store's own data.
- No concurrent trials: the workflow engine is one-run-per-process by design.
- Generation beyond the mutation model (unit payload shapes, multi-generation stores, real
  capture-manifest variance) is future work; the `drop-units` mutation covers size today.
- The three unpinned mutations stay unasserted until the operator decides D4-style semantics.
