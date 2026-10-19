# pack property engine — generated-input testing (QuickCheck-style)

The case table (`workflows/pack/cases.mjs`) proves p0-pack behavior on hand-picked inputs.
This engine proves it over a *generated* input space: random mutation programs applied to a
synthetic pre-pack store, each checked against an invariant that needs no oracle, with a
failing input shrunk to a minimal counterexample and replayed by seed or by spec.

**This is a copy of the p0 engine** (`workflows/p0/prop/`, `workflows/p0/prop-run.mjs`), kept
as a copy so each workflow package stays self-contained. The determinism contract, generator
combinators, runner/shrinker/report shape, exit codes and the stage rule are identical. The
list of deliberate differences is at the end of this file — read it before comparing the two
copies.

```
node workflows/run.mjs prop                                        # opt-in tier (p0 + pack)
node workflows/pack/prop-run.mjs --list
node workflows/pack/prop-run.mjs engine --cases 20 --seed 1
node workflows/pack/prop-run.mjs p0-pack --cases 10 --seed 20261017 --json
node workflows/pack/prop-run.mjs <name> --spec '<pack-spec JSON>' --driver host
```

Exit codes: `0` every property held · `1` a counterexample was found · `2` usage/infrastructure
error · `3` the workflow under test does not exist yet (skipped). A run that executes zero
trials is a failure (`zeroTrials`), never a vacuous pass. Note that the engine group is
*expected* to exit `1` at the CLI: `probe-refusal-writes-nothing` must find its planted
violation; the tier test asserts exactly that.

## 1. Determinism contract

| Level | Rule |
|---|---|
| Run | `--seed S` fixes the whole trial sequence; trial `i` uses `trialSeed = fnv1a(S, "trial", i)` |
| Store | a spec renders to byte-identical bytes (`renderStore`); no clock, PID or filesystem order enters it |
| Args | ceiling and child store come from the spec alone; the same spec always drives the same invocation |
| Trial | one generated store is driven exactly as a sealed case: same runner, same report, same digest rules |
| Failure | reported with the trial index, the trial seed, the spec, the shrunk spec, the failure class and both replay commands |
| Shrink | greedy over `shrinkStoreSpec`, cached by canonical spec, bounded by `--max-shrinks` (default 80); a candidate of a different failure class never replaces the counterexample |

The engine never mutates the engine under test, the real store, or the frozen baseline: every
trial renders into its own case dir under `os.tmpdir()`.

**Path independence (pack-specific).** p0-pack renders the child-store path into every
instruction line. Generated specs therefore pin `--child-store` to a stable absolute token
(`CHILD_STORES`) instead of the default (`--store`, a per-trial temp path). Without that pin,
the rendered bytes — and the packing boundary — would depend on the temp dir name, so a
shrink candidate evaluated in `trials/<i>-shrink<n>` would not reproduce in a `--spec` replay
at a different root. The `child_store == store` default is covered by the sealed case table
and the acceptance tier, not by generated trials. With the pin, the p0 metamorphic digest
property is well-posed again: two store roots render byte-identical outputs.

## 2. Input model

```json
{ "schema": "pack-spec/1",
  "units": 6, "unitBytes": 13357, "ceiling": 55933,
  "childStore": "/cure-light/prop/child-store-a",
  "unitIds": ["u.0", "u.1"],      // optional: safe odd ids ([A-Za-z0-9._-])
  "claimStatement": "…",          // optional: BMP or astral non-ASCII text
  "mutations": [ { "name": "oversized-unit", "params": { "extra": 300000 } } ],
  "probe": { "n": 2 }            // engine self-tests only (written to <store>/.probe.json)
}
```

Rendering starts from `packStream` (`fixtures/streams.mjs`), then applies the mutation
program, then writes `.probe.json`. The generator draws 1..12 units. Every fifth draw is a
boundary draw: it derives `unitBytes` and `ceiling` from the measured fixed input so a box
lands exactly on the ceiling and the next unit cannot fit. Boundary draws keep the default
claim statements and exclude claims-sizing mutations. Generator coherence is a hard rule:

- `unitBytes <= ceiling - 4096` (`FIXED_INPUT_SLACK`), so a clean spec always fits at least
  one whole unit; a fit refusal in the generated space therefore always comes from a mutation
  (`oversized-unit`) or an all-opaque inventory;
- `ceiling <= 200000` and `oversized-unit.extra >= 300000`, so the oversized unit can never
  fit an empty box;
- the shrinker re-clamps `unitBytes` when it halves `ceiling`, and honours a mutation's own
  `params.<key>.shrink` when present (`oversized-unit` keeps `extra >= 300000`), so every
  shrink candidate stays inside the coherent space.

Mutation registry (`workflows/pack/prop/mutations.mjs`), with the pipeline stage that decides
a refusal (`STAGE_ORDER = prewrite, pack, freeze, promote`):

| Mutation | Stage | Pinned reason |
|---|---|---|
| `byte-len-drift(delta)` | prewrite | `needs-input` |
| `missing-payload` / `missing-claims` / `missing-manifest` / `missing-capture` | prewrite | `needs-input` |
| `empty-claims` / `empty-units` | prewrite | `needs-input` |
| `bad-run-id` / `empty-identity` | prewrite | `needs-input` |
| `invalid-claim-entry` / `empty-unit-id` | prewrite | `needs-input` |
| `duplicate-claim-ids` | prewrite | **unpinned** (shape valid; uniqueness is an operator decision) |
| `oversized-unit(extra)` | pack | `needs-input` (cannot fit an empty box) |
| `opaque-unit` | pack | `ok` (legal smaller inventory) |
| `all-opaque` | pack | `needs-input` (nothing to pack) |
| `nested-file-ref` | pack | `ok` (basename unchanged: the D1 path derivation probe) |
| `non-ascii-claims(bmp\|astral)` | pack | `ok` (projection escaping probe) |
| `preexisting-claims-list` / `preexisting-assignment` / `preexisting-instructions` | freeze | `frozen-artifact` |
| `stale-box` | freeze | `frozen-artifact` |

A mutation that cannot find its target throws `MutationNotApplicable` — a **discard**, never
a failure. A program containing an unpinned mutation is **classified, never asserted**: the
stage rule takes the earliest stage any applied mutation touches, and an unpinned expectation
at that stage leaves the program unpinned. `cancels` declares pairs whose effects would erase
each other (`opaque-unit`/`all-opaque` vs `oversized-unit`); the generator drops the later
pick so every generated program's stage-rule reason holds.

## 3. Properties

A property is `(ctx) => void | label | label[]`; throwing fails the trial. `ctx` exposes
`report`, `spec`, `classify(label)`, the metamorphic sibling run (`ctx.run(spec)`) and the
idempotence rerun of the SAME store (`ctx.rerun(overrides)`).

Catalog (`workflows/pack/prop/catalog.mjs`), group `p0-pack`:

| Property | Guards |
|---|---|
| `reason-authored` | every exit reason is one of `ok, needs-input, frozen-artifact, evidence-failed` |
| `refusal-writes-nothing` | every non-`ok` run leaves the store tree byte-identical (pre/post snapshot) |
| `coverage-and-order` | every `ok` box set partitions the non-opaque units in manifest order, no duplicates/omissions, and `box unit sums + opaque == manifest units` |
| `greedy-ceiling` | every `ok` box input (instructions bytes + claims-list bytes + unit `byte_len` sum) `<= ceiling`, and `box_input + next instruction line bytes + next first unit bytes > ceiling` |
| `resume-idempotent` | a second run over the accepted store is `ok`, skips every target, changes no store bytes |
| `corrected-paths` | every `ok` instruction carries `<child_store>/units/units2/<basename>` per assigned unit and never `<child_store>/units2/` |
| `mutation-program-reaches-its-sealed-reason` | the stage rule (unpinned programs are classified) |
| `accepted-runs-have-a-stable-digest` | the same spec at a different root reproduces the whole result digest |

The `greedy-ceiling` boundary charges the *incremental instruction line*: adding a unit also
adds `- <unit_id> — <child_store>/units/units2/<basename>\n` to the box instructions, and
p0-pack's fit check charges the candidate render. The task-level shorthand
`box_input + next_unit_bytes > ceiling` alone would over-report at tight ceilings (a seed-12
counterexample under the earlier formulation is recorded in the build log). The engine
charges bytes (`Buffer.length` of the rendered instructions), matching the acceptance oracle.

Group `engine` (self-tests, probe fixture `fixtures/probe-mark.js`): a planted partial write
on the refusal path must be found and shrunk to probe `n = 2`, and a property that holds must
report no failures with full coverage.

## 4. Differences from the p0 engine (exhaustive)

1. `render.mjs` materializes through `packStream` (`units`, `unitBytes`) instead of
   `syntheticStream` (`boxes`); the probe stays a store-side `.probe.json`.
2. `spec.mjs` schema is `pack-spec/1`: `units`, `unitBytes`, `ceiling`, `childStore`,
   `mutations`, optional `probe`. `describeSpec`/labels report those fields.
3. Args are a pure function of the spec: `ceiling` and `childStore` are explicit p0-pack
   flags, so `runner.mjs` wraps `def.args` to merge the current spec into the overrides
   (the p0 engine needs no such wrapper).
4. Generated trials pin `--child-store` (see §1).
5. `shrinker`: uses a registry `params.<key>.shrink` when present, re-clamps `unitBytes` when
   halving `ceiling`, and adds a probe step-down (`n - 1`) beside the halving candidate.
6. `greedy-ceiling` charges the incremental instruction line (see §3).
7. Catalog: nine p0-pack properties (eight invariants plus the stage-rule property) with
   pack reasons, including the strict overwrite/stale guard; the p0 `verify join` and
   packing-invariance properties do not apply (there is no merge here, and packing
   invariance is subsumed by `coverage-and-order`).
8. `prop-run.mjs` sets `process.exitCode` instead of calling `process.exit`, so a large
   `--json` report flushes to a pipe instead of truncating at the 64 KiB pipe buffer (the p0
   CLI still has that latent truncation).

## 5. Failure loop

```
FAIL  <name>  driver=stub  seed=7  trials=1
      counterexample (trial 0, trialSeed …): units=6 unitBytes=13357 ceiling=55933 …
      shrunk x1: units=1 …
      replay: node workflows/pack/prop-run.mjs <name> --spec '<json>' --driver stub
```

The shrunk spec is the bug report. Replay it on both drivers, then promote its mutation
program into `workflows/pack/cases.mjs` as a sealed case: the case keeps the incident dead,
the property keeps guarding the class. If the workflow under test is at fault, do not fix it
silently — report the counterexample, the replay command and the retained evidence dir.

## 6. Non-goals

- No model-turn properties, no hostile filesystem faults, no concurrent trials (identical to
  the p0 engine).
- No coverage of the `child_store == store` default in generated trials: that pairing is the
  sealed cases' and the acceptance tier's job (see §1).
- Generation beyond the mutation model (multi-generation stores, real capture-manifest
  variance, `--allow-overwrite` in generated args) is future work.
- `duplicate-claim-ids` stays unasserted until the operator decides whether duplicate claim
  ids must refuse.
