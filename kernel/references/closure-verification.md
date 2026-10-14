# closure-verification.md — the re-review loop

Triggered when the operator says the implementer "worked on the review" (or any instruction implying the PR advanced). This is **delta review**, not a pipeline re-run.

## 1. Capture the new subject

Closure runs after a deliberate re-pull (the operator decides at the gate; the coordinator updates the subject tree **in place** to the new head — or pulls fresh when the tree is gone/broken — see chhound-driver.md / intake-and-scope.md §0.1). Capture the new subject OID before trusting any diff:

```text
git -C <subject-path> rev-parse HEAD   → the new state's subject_oid
```

The code delta is `git diff <last-reviewed subject_oid>..<new subject_oid>` — old findings re-validated against the new tree, never against an assumed remote tip. If the subject did not change **and** the captured contract did not change, say so (no work has been pulled — no code and no contract change) or wait. A changed PR body/issue/locked decision with an unchanged subject OID is **contract-only repair**: no code work is pulled, but it is still a new review state — recapture the contract snapshot, rerun the P0.2 claims pass and P0.4/P0.5 join/gate against the new claims, then revalidate/freeze the V1 directory and re-adjudicate affected claim verdicts/attributions/projections. Reuse only identity-checked mechanical unit artifacts when base/subject/recipe/payload identity is unchanged; the delta under review is the contract delta, never an edited claims page, inherited draft links or inherited negatives. An in-diff source repair normally changes the subject OID even when executable code bytes are unchanged, and gets the same new-state treatment on the new `base..subject` pair. Old-state content is read at its own OID (`git show <old_subject_oid>:<path>`) — the working tree holds the new subject only.

## 2. Map findings → touched paths

For every open finding (and every `deferred-decision` the implementer claims to have addressed), determine which files/lines the fix would touch. The finding's evidence `file:line` is the anchor.

## 3. Re-validate per finding (targeted)

- **Code touched?** Diff the finding's path. If the relevant code is byte-identical → the finding is NOT fixed regardless of what any comment says.
- **Behavior changed?** Re-read the new code at old/new lines (old lines from the old `subject_oid`). Run the relevant tests if they exist and are cheap (`bun test <file>` / `node --test` style — use the repo's own runner).
- **If architecture changed** (e.g. the fix refactored the module): re-run the original fleet slice rather than spot-verify, since evidence paths moved.

## 4. Classify

| Class | Meaning | Green requires |
|---|---|---|
| `verified-fixed` | code + test evidence at old/new lines | diff addresses behavior + targeted validation passes |
| `re-classified` | category/claim changed (e.g. "bug" → "documented intentional") | honest re-framing; if it changes a HIGH, flag to operator |
| `test-only` | only tests changed; behavior identical | acknowledge; behavior finding still open |
| `doc-only` | only comments/docs changed | acknowledge; behavior finding still open |
| `deferred-decision` | acknowledged but knowingly unfixed | recorded decision + rationale, NOT presented as fixed |
| `closed-by-operator` | operator suppressed it (e.g. "don't re-raise X") | never re-raised unless new evidence outside the decision's scope |
| `re-opened` | prior proof no longer holds, or regression introduced | concrete new evidence |

Contract repair re-enters the loop the same way — as a new state with a new contract snapshot, not an in-place reconciliation. Prior evidence stays historically cited (its own `subject_oid`/source hash), never silently closed; **code-unchanged findings stay open unless specifically reclassified on valid new authority** — a body/spec repair never counts as fixing code. When the doc/spec unit is itself the designated deliverable, its closure is judged on its own anchor evidence (recaptured contract + the actual doc delta), not as a "doc-only" acknowledgement of an implementation finding.

**Confirmation badges.** Any edit to a verified target invalidates its confirmation, and a new or repaired state invalidates its confirmation: applicability is re-decided on the new state's pins, and a confirmation badge from an earlier version is never transferred (finding-confirmation.md). Ordinary `verified-fixed` closure remains its own distinct check.

## 5. Publish a closure table

```text
finding | prior evidence (old file:line) | new evidence/tests (new file:line) | class | remaining decision
```

Output to the notebook findings page, not as a fresh review. This is the artifact the operator reads to decide merge.

Re-validated rows update their `subject_oid` to the new subject — a row's `subject_oid` is the tree its current evidence was read from (evidence-format.md); a row not (yet) re-validated keeps its own `subject_oid` and is read at it.

**Fleet check.** The closure report records the state's plan-vs-actual fleet check: per vector, planned vs spawned children and per-facet coverage against the agreed depth budgets. Any deviation carries its reason (an amendment recorded at a gate, a failed/timed-out child, an operator waiver); a planned facet that received no coverage is an explicit note or finding, never silence.

**Closure publication.** By default, after closure verification, update the single review comment **in place**: fold in new or changed dispositions and note the new subject OID in its attribution footer. The `before_post` gate still applies. Post a separate fresh comment only when the operator prefers one.

**Symbol map in a closure render.** The map belongs to a review state: a closure
render that updates the comment to a new `subject_oid` either regenerates that
state's census — written to `symbol-map-<owner>-<pr>-s<n>`, the `rg` pass alone
suffices and the old state's rail triage is stale — or omits the `Symbol impact`
section; old-state counts are never carried into a new-state comment.

## 6. Honesty rules

- **Unchanged code cannot be green.** A "fixed" claim with no diff = re-open.
- **Do not present decision-deferrals as fixes.** "Locked as intentional" is a decision, not a fix — record it and surface the decision author to the operator.
- **Do not resurrect closed-by-operator items** unless the operator reopens them or new evidence clearly falls outside the suppression scope.
- **Do not re-raise closed decisions through confirmation.** A confirmation check on a statement covered by a recorded accepted decision returns `adjudicated`; the confirmer never challenges the decision itself, and never re-raises it unless the recorded rationale no longer holds (finding-confirmation.md).
- **Doc/test-only closures are acknowledged as such**, so the operator knows the behavior itself is untouched — and a contract-only repair never flips a code finding green.
- **A fresh manifest per state; no inherited negatives.** A contract-only repair or any new state recaptures sources and records fresh claim/join refs/hashes, P0.5 sweep evidence and V1 validation. Re-verify the shipped chunker path/sha256/recipe against the recorded cure-light source identity. Old draft links, candidate-unclaimed lists, zero-error reports and final negatives never count as coverage of the new contract; only identity-checked mechanical unit inputs may be reused.

## Coverage in closure

A closure run is a new review state: the prior state's coverage pages describe
their own `subject_oid`, and the delta loop above re-validates findings without
re-running Vector 1 unit accounting. Two rules keep that honest:

- **New ranges are surfaced, or their absence is disclosed.** Compare the
delta's added ranges against the old state's coverage page or its durable
snapshot (`coverage-<owner>-<pr>-s<n>`, notebook-plan-contract.md — the durable
snapshot in findings/decisions once retired): newly added
unexplained ranges outside the finding-touched paths are either checked in the
closure run or the closure render states plainly that V1 coverage was not
re-run. Old dispositions are never presented as coverage of the new head —
never claim new full coverage from them.
- **Re-adjudication is per finding, on new pins.** Reclassify only against the new state's contract snapshot/source hash, validated unit inventory and frozen V1 claim directory; a changed contract can affect every formerly unclaimed group, so affected claim verdicts and attributions are recompiled rather than inherited.
- **`unclaimed-delivery` closes only through the contract.** When an author
declaration/justification resolves such a finding, the PR body changed the
captured contract: recapture it in the new state with the author declaration
recorded as a source of that capture before closing the
row, and record that basis with it. Never rewrite the contract silently, and
never close the finding on silence. Removing the delivered behavior closes the
row on the ordinary code+tests basis.

## Lens trail in closure

Lens-trail rows (hygiene, `blast`, `quality`, `yagni`) are classified with the
same table; two lens-specific notes (see hygiene-lens.md):

- A lens hit that a later head removes is `verified-fixed` only when the lens
  sweep on the new head cites the old→new lines — `closed-by-operator`
  suppression does not make it fixed.
- Non-fix closures (deferred / closed-by-operator) must not flip `lens-checked`
  to false: the lens remains exercised; only the specific hit was disposed.

A `blast` row's *concrete* hazard instance is a Vector 2 finding and follows
ordinary finding closure; its advisory rows close like any other lens-trail row
(blast-lens.md).