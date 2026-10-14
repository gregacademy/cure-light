# pipeline-model.md — the three vectors

cure-light reviews a pull request through **three independent vectors**. Each answers a different question; running them in order means later vectors build on a verified substrate.

| Vector | Question | Fleet group | Focus |
|---|---|---|---|
| 1. Conformance | Does the code deliver what the PR *claims* it delivers — and is every changed unit accounted for against the contract? | `flash` | Two ends: claim adjudication (captured sources — PR description + issue + locked decisions + explicitly designated in-diff sources → code) and changed-unit accounting (manifest units → claims) |
| 2. Implementation | Does the shipped code actually *work* safely? | `code-review` | Sealed concepts / invariants, drilling from established facts |
| 3. Debt | Is the *way* it's built sustainable? | `code-review` | Bigger concepts, future-change cost, not line-by-line |

## Why three vectors

- **Conformance alone is blind to implementation bugs** (spec-satisfying but broken code), and **bugs alone miss contract gaps** (working code that does the wrong thing).
- **Debt is a different granularity.** It looks at boundary ownership, pluggability, versioning, projections, performance — the costs the next feature will pay, not the current failure.

## Sequenced, gated

```text
Intake → Phase 0:
  P0.1 pull + source capture → P0.2 claims (#fast; includes source-consistency)
  → P0.3 shipped chunker → P0.4 join (#fast; JSONL)
  → P0.5 coordinator gate → capacity-bounded split → [operator gate: manifest]
  → Vector 1 (validate/freeze claims; claim adjudication + unit accounting; finalize UNCLAIMED)
  → [gate: review_basis + repair status] → Deterministic preflight
  → Vector 2 → Vector 3 → Output (single review comment; text-stage confirmation between drafting and `before_post`)
  → Closure loop (deliberate re-pull or contract repair)
```

With `finding_confirmation.mode: pilot`, each of Vector 2 and Vector 3 gains an early
finding confirmation pass between vector aggregation and the vector gate.

A provisional `repair_required` from P0.2 defaults to pause before V1; only the existing named, bounded operator exception may cross that boundary.

- Vector 2 runs only when the V1 gate recorded `review_basis: ready` with no outstanding `repair_required` — or the operator explicitly authorizes a named limited scope (exact accepted basis + omissions) or an explicit skip. `limited-only`/`blocked`/`unknown` never continue as ordinary V2; V3 and skip routes observe the same boundary.
- Vector 3 runs only when the implementation evidence is stable.
- The operator gates between phases. No autonomous new-commit loops.

## Cross-cutting rules

1. **One stable subject per review state.** All vectors in a state analyze the same pulled tree (`subject_path` / `subject_oid`, see intake-and-scope.md); nothing mutates it mid-state. A re-pull is a new state — gated by the operator and executed at that state boundary: the tree is updated **in place** to the new head (or pulled fresh when it is gone/broken). Findings carry the subject OID their evidence was read from; prior evidence is read at that OID (evidence-format.md).
2. **Origin classification is mandatory** (pre-existing vs PR-introduced), decided by base-diff.
3. **Two-axis severity**: impact (HIGH/MED/LOW) × disposition (fix-in-PR / pre-existing-debt / deferred-decision / track-separately).
4. **Notebook is the shared memory.** The coordinator writes run frame + findings pages; children return compact evidence records, they do not compete for writes. P0.4 children may write their own single-writer JSONL box files; notebook writes remain coordinator-owned.
5. **Inconclusive = no pass.** A child timeout/truncation means the finding is unverified, not accepted.
6. **Fleets are budgeted and parallel.** Per-phase child counts, timeouts, output caps, and a cheap re-review path (delta-only) are mandatory; a split's compiled children spawn as one concurrent batch — never one child after another — and no coordinator write shares the spawn batch. Each vector's split is a recorded `fleet_plan` (facet → owner → depth budget) compiled and surfaced before its children spawn — V1 before the Phase-0 gate (approved at it), V2 at the V1 gate, V3 at the V2 gate; no facet is folded into another child silently, and any amendment is recorded with a reason (intake-and-scope.md §0.3b).
7. **Review is diagnostic.** cure-light proposes; the operator gates the single external review comment (see evidence-format.md, External routing).
8. **Coverage completeness is asserted per run.** Vector 1 owes two obligations: a verdict for every captured claim, and exactly one accounting state for every eligible changed unit (conformance-pass.md). The run reports four distinct completion flags — enumeration, accounting, attribution, claim conformance — and keeps mechanical completeness separate from semantic judgment: `UNRESOLVED` residue is disclosed and requires explicit operator acceptance at the gate, never a silent pass.
9. **Vector 1 coverage is a frame assertion, separate from the lens table.** The run must map an owner for every claim and every eligible changed unit (intake-and-scope.md §0.3); the lens table proves only that each active lens has an owning pass. A claim or unit without an owner is a frame error, like an unowned lens.
10. **Contract adequacy gates continuation.** The bounded source-consistency work within the P0.2 claims pass pauses the run before Vector 1 on a witnessed material contradiction unless the operator records a named evidence-only V1 authorization (intake-and-scope.md §0.2/§0.4); any other `repair_required` defect (missing designation/orientation) defaults to the same repair pause. After Vector 1 the coordinator records `review_basis` (`ready` / `limited-only` / `blocked` / `unknown`) plus any outstanding `repair_required` status before the V1 gate (conformance-pass.md). Sources enter the contract only by explicit designation; convention interprets, never authorizes. A contract repair — including a body-only edit with an unchanged subject OID — is a new review state, never an in-place reconciliation. This is a gate classification, not a fourth vector, lens, finding kind or comment section.
11. **Mechanical checks and semantic judgments are separate records.** The shipped chunker establishes a state-bound unit inventory; P0.4 proposes witnessed links and P0.5 checks typed rows, identities, duplicates, witnesses, budgets and the complete assigned sweep. Links are leads, never verdicts. No plugin grants canonical claim identities or permission to finalize negatives. V1 validates/freezes the draft claims against sources, adjudicates claims, accounts for all units and alone finalizes UNCLAIMED. Source coherence, designation and `review_basis` remain evidenced agentic judgments. **Gate timing:** source and draft/unit/join refs/hashes plus P0.5 evidence exist before the Phase-0 gate; neither a successful mechanical gate nor a zero-link row proves contract adequacy or negative attribution ([intake-and-scope.md](intake-and-scope.md) §0.2–§0.4).
12. **Finding confirmation is an opt-in pilot overlay — a semantic companion, not a fourth vector.** With `finding_confirmation.mode: pilot`, selected HIGH/thin V2/V3 findings receive an independent adversarial check between vector aggregation and the vector gate, and the rendered draft is checked between drafting and `before_post` (finding-confirmation.md). It creates **no new lens**, no new comment section and no gate semantics; it never changes `review_basis`/`repair_required` and publishes confirmed-only. The pilot forecast is ≈48.9% of the lens+drafter stage (row-consistent field denominator) — tight against the ≤50% keep-pilot threshold and unvalidated.

## The research accelerator (cross-cutting; Vector 2 + Vector 3)

Cure-light treats the chhound research rail (chhound-driver.md) as an **accelerator** for understanding the subject's subsystems — never as an evidence source. The mode is compiled from the planned subject mechanism and frozen in the run manifest at the plan gate; the Phase 0 gate **re-records** it against the pulled reality — a planned rail that fell back to a plain worktree flips the mode to `direct-tree` (`ch_prefix: none`) before Vector 1 (requirements-check stop conditions):

- `research.mode: chhound-rail` — the rail is live and Phase 0 pulls the subject as a chunkhound PR sandbox whose own index is bound under the frame's registered prefix `{ch_prefix}`. The manifest records the prefix and the exact tool names (`{ch_prefix}_daemon_status`, `{ch_prefix}_code_research`, `{ch_prefix}_search`) and lists every other live `chh_*` prefix as excluded.
- `research.mode: direct-tree` — plain detached worktree (rail unconfirmed/broken). The run proceeds with git/rg/read; the fallback is explicit in the manifest, never silent.

Vector 2 enforces subsystem research **mandatory-if-ready and uniform across every split — including test-integrity concepts** (deeper subsystem understanding yields better insights regardless of split type): one scoped `code_research` orientation question per sealed invariant, then at least one `search` pinpoint, then tree verification. Vector 3 enforces a **search-extensive** protocol — children read the state's symbol map (`symbol_sweep`, chhound-driver.md) first as a lead inventory, then `search` leads every concept and lens sweep (repo-wide claims need logged searches); `code_research` may orient but is never required there. The per-child prompt slots, workflows, and the mandatory RESEARCH TRACE footer are defined in [implementation-pass.md](implementation-pass.md), [debt-pass.md](debt-pass.md) and [child-pass-prompt-template.md](../../assets/child-pass-prompt-template.md).

Authority rules (bind all vectors):

1. Index output is **discovery only**: its citations are leads, not evidence — every cited line is re-read in the subject tree at `subject_oid` before it may appear in a finding (chhound-driver.md, Evidence rule).
2. Origin (PR-introduced vs pre-existing) is decided by base diff only, never from the index.
3. Vector 1 may use the tools where the coordinator judges it useful; nothing is mandatory there.
4. Shadow splits (paired direct-only control children that measure the accelerator's quality delta) are **off by default** — enabled only by explicit operator choice (`research.shadow: on`).

## The lens dimension (cross-cutting coverage)

Vectors ask **one big question**; lenses ask small, repeatable checks the fleet must not be allowed to skip just because a child got assigned a different angle. A lens has an owner (≥1 pass exercises it), a checklist, a route, and an optional deterministic accelerator. The code-hygiene family — the stage-3 gap from our phase-2 lens comparison — is defined in [hygiene-lens.md](hygiene-lens.md). Non-hygiene lenses carry their own references: the V3-owned `quality` lens ([quality-lens.md](quality-lens.md)) and the V2-owned `blast` lens — data × call-site blast radius ([blast-lens.md](blast-lens.md)).

Every run manifest renders a **lens matrix** — a closed table of lens × owning passes:

```text
LENS TABLE (run <head OID>)
lens    | owner(s)              | mechanical | trail
type    | deterministic preflight | yes       | lens
dead    | preflight + v3        | yes       | lens
read    | v2 split + v3 split   | no        | lens
name    | v3 split              | no        | lens (NOT-A-HIT when clear)
blast   | preflight + v2 split  | yes (sweep) | lens
yagni   | yagni pass (when active) | no    | lens
quality | v3 split              | no        | lens
```

Rules:

1. **Per-lens coverage is a frame assertion.** If any **active** lens has no owner, the run does not start — coverage is proven per lens, not per vector. A lens whose activating pass does not run is **inactive** (matrix shows `off`) and needs no owner.
2. **A lens outcome is `checked-and-clear` + a trail.** A lens not checked is a frame error, never "nothing found".
3. **Hygiene hits route to the lens trail**, never the bug/debt table (see hygiene-lens.md). Lens hits are never external: they stay in the notebook (see evidence-format.md, External routing).
4. **The family is extensible.** Adding a lens is an auditable manifest change, not silent scope drift.
5. **`quality` is advisory** (quality-lens.md): LOW default, MED only when the
   quality problem's own scale is material, never HIGH, rated independently of
   product criticality — suggestion-only on the lens trail.
6. **`blast` rows are advisory, its instances are findings** (blast-lens.md): row
   hits follow the lens trail; a concrete data-hazard instance routes to the bug
   table as a Vector 2 finding at its own severity; a verified in-scope
   consumer's explicitly deferred compatibility obligation is a **LOW Vector 2
   finding (assurance-gap)** — reviewer omission / an unread occurrence alone is
   not an author bug, and concrete harm keeps the ordinary instance severity; the
   preflight's mechanical symbol map may surface as the comment's `Symbol
   impact` section (chhound-driver.md / evidence-format.md).

## Optional pass: yagni (over-engineering / YAGNI)

Beyond the three vectors sits one **optional, vector-shaped pass**: yagni — is
the engineering used to deliver the claimed behavior justified, or over-built?
It owns no size accounting — that is Vector 1's changed-unit accounting
(yagni-pass.md). It runs only when the operator enables it (intake checkbox or on-demand
after the Vector 3 gate), post-handoff in a fresh context, on the same run manifest and subject tree. It owns the `yagni` lens while active (yagni-pass.md); when skipped,
that lens is inactive (`off`) and needs no owner. Hits route to the lens trail,
never the bug/debt table.

## When NOT to run the full pipeline

- Trivial/merge-bot PRs: run Vector 1 only, single pass — and never the yagni pass.
- Pre-merge iterations you already reviewed: run the closure loop, not the fleets.
- Repo unreachable or unindexed: run preflight, take the fallback (git/rg), or stop.