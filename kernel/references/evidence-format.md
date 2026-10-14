# evidence-format.md — finding schema, severity, origin

Every finding in a cure-light run conforms to this shape. It is the interop contract between fleet children, the coordinator, the notebook, and gh artifacts.

## Finding schema

```yaml
id: V1-<n> | V2-<n> | D3-<n> | Y-<n>   # V1 conformance, V2 implementation, D3 debt, Y yagni; e.g. V1-03, V2-03, D3-01, Y-01
vector: conformance | implementation | debt | yagni
lens: type | dead | read | name | blast | test | security | yagni | quality | none   # optional; see hygiene-lens.md + blast-lens.md + quality-lens.md
lens-checked: [<lens>, ...]       # lenses proven exercised on this artifact
summary: one line
evidence:
  file: path:line            # primary anchor in the subject tree
  code: <verbatim or exact shape>
  side: subject | base | metadata    # optional; required when the anchor is not a surviving subject-tree line
  oid: <tree OID the anchor was read from>   # optional; old/base-side or metadata-event provenance
  range_or_event: <old-side range / metadata event ref at its OID>   # optional; deletion / rename / mode / binary anchors
severity: HIGH | MED | LOW
origin: PR-introduced | pre-existing   # Vector 2+ ; conformance is PR-only by definition
disposition: fix-in-PR | pre-existing-debt | deferred-decision | track-separately
             # fix-in-PR = in scope (introduced or enforced); pre-existing-debt = out-of-scope
             # follow-up (recommended or downstream); deferred-decision / track-separately record
             # an accepted deferral or an own ticket
conformance_kind: claim-gap | unclaimed-delivery   # optional; Vector-1 findings only (see below)
coverage_ref: <coverage page ref + V1 frozen claim IDs / manifest unit group or selector + frozen claims ref/hash + units_manifest ref/hash + join_draft ref/hash>   # optional; ties a V1 finding to state-bound accounting and draft leads, never plugin permission
failure_mode: <concrete failure: divergence for claim-gap; undeclared delivered behavior for unclaimed-delivery>
status: open | verified-fixed | re-classified | test-only | doc-only | deferred-decision | closed-by-operator | re-opened
owner: <implementer | operator | subsystem>
subject_oid: <tree OID this row's evidence was read from>   # optional in schema; the coordinator fills it on every new/updated row
linked: <external follow-up URL | none>
confirmation: <optional confirmation-pilot object — see below; never a finding status>   # optional
```

`assets/finding-schema.json` is the machine form. `lens` and `lens-checked`
are optional (a conformance finding usually has `lens: none`); when they are
absent the row still counts toward the vector, but the **lens matrix** (see
pipeline-model.md) is what proves per-lens coverage of the run.

**Confirmation metadata (optional).** A finding row may carry an optional `confirmation` metadata object (the confirmation pilot, finding-confirmation.md): `target: finding` for finding rows; `draft` / `comment-section` records use the same shape as confirmation-trail entries, not as finding-schema instances. Fields: `target` (`finding | draft | comment-section`), `outcome` (`confirmed | mechanism-confirmed | adjudicated | refuted | inconclusive | disputed | pending | not-required | not-run`), `run`, `review_state`, `subject_oid`, `proposal_sha256` or `draft_sha256`, `policy_ref`, `reason`, `attempt_refs[]`, `current_attempt_ref`. This adds **not new finding `status` values** and leaves `verify.mjs` untouched; existing enums and required sets are unchanged, and absence never implies confirmation. A draft-target record carries the exact `draft_sha256` of the verified draft. **state invalidation** — any edit to the verified target, or a new or revised state, invalidates the badge, which is never transferred to another version.

**Coverage is not a taxonomy.** Vector 1 keeps per-unit accounting in the
coverage ledger (notebook pages, below); only two narrow kinds become findings:
`conformance_kind: claim-gap` (the old GAP shape — missing backing,
contradiction, overstatement) and `conformance_kind: unclaimed-delivery` —
delivered behavior absent from the captured declared scope, evidenced by unit
IDs plus the attribution audit. An unclaimed-delivery finding is **in-scope and
blocking**: the owner declares/justifies the behavior in the PR description or
removes it (a declaration changes the contract and lands as a closed/new state,
closure-verification.md). It is never demoted to a follow-up; its narrow
failure-mode exception is documented under Writing findings.

**Contract adequacy is a gate disposition, not a finding kind.** Description
defects — a misleading/empty body, missing source designation or orientation, a
material unresolved source contradiction — are author-facing conformance items
with the existing kinds/severity and a concrete remedy (source-declaration vs
delivery-role separation: conformance-pass.md §Sources declare); a
`review_basis` value (`ready` / `limited-only` / `blocked` / `unknown`) and its
basis blockers are coordinator process records (frame/claims pages), never an
omnibus "bad contract" finding, a new severity class, or a new comment section.
A ready basis never erases a blocking finding, and an accepted finding
disposition never establishes readiness.

**Artifact identity is not semantic proof.** Phase 0 records source captures,
claims-draft, units-manifest and join-draft refs/hashes plus the shipped chunker's
path/sha256/recipe and the pinned verifier's path/sha256/tool_version bound to
`cure_light_source_head_oid`, with the delegated `verify join` verdict
ref/hash/exit code bound to those exact inputs (optional `verify claims|units`
diagnostic verdicts use the same shape when run and never gate). The verifier
proves
recorded artifact mechanics (identity, pins, shapes, witnesses, budgets) only —
never claim correctness, source-universe completeness or final attribution.
Draft claim and unit IDs
are scoped to those artifacts, not canonical semantic identities. P0.5 validates
row mechanics and the assigned sweep, not claim correctness or final negative
attribution. V1 findings cite the validated/frozen claim directory and unit
inventory; an unknown ID, stale draft mapping or missing source evidence is
unresolved, never repaired by quietly inventing authority. V1 alone finalizes
UNCLAIMED after all three negative-attribution proof legs hold
([conformance-pass.md](conformance-pass.md)).

`subject_oid` is schema-optional for backward compatibility but **rule-required**
for every new or updated row: it records which review-state tree the row's
evidence was read from, so a findings page spanning several review states never
mixes trees silently. The coordinator fills it from the state's manifest.
Because a re-pull updates the tree in place, the working tree holds only the
latest subject: an older row's `file:line` is re-read at that row's `subject_oid`
(`git show <subject_oid>:<path>`), never from the current checkout.

A mechanical sweep that cannot run on the subject tree marks its lens
`inconclusive-mechanical` in the **lens trail** — checked by static sight, not
compiler output — never a silent skip and never a finding-status by itself.

## Severity semantics

- **HIGH** — data loss / security / wrong routing / a contract-mandated behavior is contradicted or unverifiable at the core and no backstop exists.
- **MED** — real user-visible defect or race, or a behavior claim missing the test that would catch its regression; backstopped so not catastrophic.
- **LOW** — brittle, fragile, or coverage-without-assurance; cosmetic; deferred by design.
- **Unclaimed-delivery findings (`conformance_kind`)**: LOW default; MED only for material undeclared behavior / API / operational commitment with an articulated review or compatibility consequence — never HIGH from the absence of a declaration alone; independent current harm is a Vector 2 finding.
- **Yagni rows (`yagni` lens)**: LOW default, MED ceiling — existence questions are advisory (non-blocking); current harm is V2's, future-change cost is V3's.
- **Quality rows (`quality` lens)**: LOW default, MED only when the quality problem's *own scale* is material — never HIGH, rated independently of product criticality (a spaghetti tree in a payments feature is not elevated because payments is critical); advisory (non-blocking), lens-trail only.
- **Blast rows (`blast` lens)**: LOW default, MED ceiling — never HIGH, suggestion-only; the concrete hazard instance is a Vector 2 finding at its own severity (blast-lens.md).
- **Deferred-consumer finding (`blast` lens, V2)**: a verified in-scope consumer's explicitly deferred compatibility obligation is a **LOW Vector 2 finding (assurance-gap)** — cite the deferred value, the consumer relation, the unchecked obligation, and the verification required; reviewer omission / an unread occurrence alone is not an author bug (the `sweep` row stays trail-only); concrete harm keeps the ordinary instance severity (blast-lens.md).

## Origin rule (Vector 2+)

Decide by **base diff**, never vibes:
`git show <base>:<path>` → is the mechanics present at base? If yes and the PR only touches it in passing → pre-existing. If the path (field/gate/logic/README-claim) is new → PR-introduced.

## Research traces are process metadata

Vector-2 and Vector-3 children attach a RESEARCH TRACE footer (implementation-pass.md / debt-pass.md). The trace records how leads were gathered; it is process metadata, not finding evidence:

- Index-derived `file:line` references and origin labels are invalid until verified in the subject tree / by base diff.
- A finding's evidence stands only on tree-verified anchors; a trace without verified anchors does not upgrade a finding.

## Writing findings

- Every finding needs a **concrete failure mode** — not a style opinion. The narrow exception: `unclaimed-delivery` states the undeclared delivered behavior and its unit evidence instead of an invented runtime failure; coverage states themselves are ledger records, not findings.
- Deletion / metadata findings state the anchor's `side`, `oid`, path and `range_or_event`, plus the checked subject absence (or the surviving subject anchor) — never a bare "file is gone".
- `NOT-A-BUG` results are listed too (checked and dismissed), cheap honesty that keeps the fleet honest.
- Hygiene hits follow the **lens trail** (hygiene-lens.md): detection mandatory, LOW by default, operator-suppressible per instance — they never pollute the bug table.
- `yagni` rows (yagni pass) follow the same lens trail with the same suppression/closure semantics — suggestion-only, never bug/debt tables.
- `quality` rows (V3 lens) follow the same lens trail — suggestion-only, rated by the problem's own scale, never bug/debt tables.
- `blast` rows (V2 lens) follow the same lens trail — suggestion-only, never bug/debt tables; the concrete data-hazard instance routes to the bug table as a Vector 2 finding (blast-lens.md).
- Evidence is read from the state's **subject tree** at its recorded `subject_oid` (intake-and-scope.md §0.1). Every row carries `subject_oid`; if a child read a different tree, its output is `inconclusive` — a checkout whose HEAD differs from the row's OID is a different tree.
- A completeness statement cites the state's source and claims-draft/units-manifest/join-draft refs/hashes, P0.5 sweep evidence, V1 frozen claim directory and V1 accounting evidence. Mechanical checks never substitute for semantic coverage; a candidate-unclaimed row is not a finalized negative, and unit/context counts are not unique changed-line counts.
- Child returns use the bounded transport (`assets/child-pass-prompt-template.md`): a receipt's `artifact_ref, sha256` address the full evidence; the coordinator consumes the artifact, never the receipt counts alone.

## Notebook layout

- `pipeline-frame-<owner>-<pr>-s<n>` — frozen run options, base OID, planned subject mechanism; the manifest's tree fields (`subject_path` / `subject_oid`, changed-file list), contract-source pins/designation, the P0.2 `source_consistency` outcome and the independent `repair_required` record (records + continuation) and the post-V1 `review_basis` record are recorded at their gates (notebook-plan-contract.md). Written at seal, completed at Phase 0 and the V1 gate.
- `symbol-map-<owner>-<pr>-s<n>` — the preflight symbol map (chhound-driver.md, Symbol sweep): selected symbols, census heat table, capped outside locations, provenance/caps. One per review state; a bounded state cache kept while the state's consumers run (V2 sweep, V3 seed, yagni), discarded when the state closes.
- `coverage-<owner>-<pr>-s<n>` — Vector 1 coverage summary/index: denominator and counts by state and side, completion flags, exclusion classes/policy, exact refs to the ledger shards. The paged ledger records themselves live in `coverage-<owner>-<pr>-s<n>-p<k>` pages (bounded, coordinator-owned, **in-notebook** — never scratch files); workers read only their assigned pages/slices. Kept through the state's closure/finalization window, retired after durable snapshots land.
- `claims-<owner>-<pr>-s<n>` — the source-bound claim directory: Phase-0 claims-draft ref/hash and proposed claims/nonclaims/notes/conflicts/missing sources, then V1 validation/freeze evidence and the resulting directory ref/hash. Preserve source class/designating pointer/interpretation and source-consistency witness records. Draft IDs are run-scoped; no plugin permission or canonical registry projection is required. The complete V1 directory remains queryable (paged `-p<k>` when long); an inaccessible or incomplete directory cannot support finalized negative attribution.
- `pr-<n>-review` — findings table (schema rows) + closure table + the Vector-2 review-check outcome trail (`checked-and-clear` | `advisory` | `question` | `finding`, implementation-pass.md; `question` outcomes are mirrored to the decisions page) + the confirmation trail (proposals, attempts, verdicts, dismissals, disagreements, rebind records; coordinator-owned, distinct from the lens/V1 coverage trails). Appended per vector.
- `decisions` (durable, survives the PR) — deferred-decision and closed-by-operator records with author/time/rationale/scope, plus V2 review-check `question` outcomes and the leading subarea open questions.

The coordinator owns writes. Children return compact records; they never race the notebook.

## External routing

Finalization is **one aggregated review comment per run** — never per-finding comments, never separate issue drafts. The pipeline drafts it only when the intake field `draft_comment` is `true`; with `false`, the run is review-only: findings and suggested issues stay in the notebook, and a draft is prepared only on explicit request.

The single review comment contains:

```text
## Summary                     — owner/repo pr# @ head OID, vectors run, review
                                basis + any outstanding repair requirement,
                                approved/omitted scope; coverage accounting
                                totals/limits by state and side
## Findings                    — in scope of this PR (introduced or enforced by it;
                                origin may still be pre-existing): file:line evidence,
                                severity, origin — to be addressed
## Symbol impact               — the preflight symbol map, when the diff changes a
                                shared sentinel / identifier: top rows by outside-
                                occurrence count (census over the declared scope at
                                `<subject_oid>`), provenance, caps — mechanical
                                counts only, never triage labels, heuristic splits,
                                verdicts, or a claim that unread remainders were
                                cleared; never a lens-row judgment
## Potential follow-up issues  — out of this PR's scope, optional, never required:
                                · recommended — easy / best bang for the buck items,
                                  worth addressing while the area is open
                                · downstream — only low-impact + heavy implementation,
                                  or pre-existing issues this PR did not introduce
[attribution footer — see below]
```

**Scope routes the comment.** `origin` is base-diff evidence, not the routing key. **In scope** = the PR owns the issue: introduced by the PR, or pre-existing on a path the PR's own change now depends on, routes through, or claims to guarantee (a new gate, validation, dependency, standard, or contract claim). **Out of scope** = the PR neither introduces the issue nor depends on/claims that path — a passing touch does not make it enforced. In-scope items go to Findings, to be addressed — never a follow-up suggestion; only out-of-scope items may appear under follow-ups.
- **Coverage accounting renders in Summary; confirmed unclaimed delivery renders in Findings.** `EXPLAINED` / `EXCLUDED` / `UNRESOLVED` totals, exclusion classes and honest limits stay in the summary and the coverage pages; grouped `unclaimed-delivery` rows are in-scope, blocking, to be addressed — never follow-ups. No fourth comment section.

- **Never auto-post.** The single draft is operator-gated at the `before_post` pause — mandatory whenever `draft_comment` is enabled — and the operator may edit or veto it.
- **Confirmation is confirmed-only.** In `finding_confirmation.mode: pilot`, selected V2/V3 findings and draft claims enter Findings/follow-ups only when confirmed; unresolved text-stage items block posting absent explicit named operator acceptance (labeled `unconfirmed/operator-accepted`, disclosed in the Summary) — never laundered as confirmed. Coverage, resolved limits and unresolved counts are stated in the Summary; no new comment section.
- **Lens-trail rows stay in the notebook** (hygiene / blast / quality / yagni) and are never included in the comment; the one exception is the mechanical `Symbol impact` table — outside-occurrence counts with census scope, provenance, and caps (chhound-driver.md, Symbol sweep), never a row's advisory judgment.
- **Issues are suggested, not drafted.** cure-light never composes `gh issue` bodies; a developer may open follow-up issues from the "Potential follow-up issues" section. A `linked` value may be added later, when a developer or operator has created the issue.
- **Attribution footer.** The single review comment ends with the cure-light attribution footer, composed **solely from run-manifest values**:

  ```text
  _Reviewed with [cure-light](https://github.com/grzegorznowak/cure-light) @ <cure_light_source_head_oid short form> — reviewed subject <subject_oid>_
  ```

  - `cure_light_source_head_oid` (intake-and-scope.md, §Output) is the cure-light source checkout's HEAD at intake — the "version at the time of reviewing", frozen once so it survives handoffs. Never re-derived per vector (no live `git rev-parse`, `gh` lookup, or CHANGELOG semver).
  - The footer appears only on the review comment — never on notebook pages.
  - If the source commit could not be established at intake, **omit the footer rather than fabricate one**.
  - A new review state (deliberate re-pull, closure loop) uses its own `subject_oid` in the footer.