# conformance-pass.md — Vector 1: contract vs changed units (both ends)

**Question:** does the delivered change match what the captured contract — PR description + linked issue (incl. locked decisions) + explicitly designated in-diff sources — claims, and is every changed unit accounted for against that contract?

**Fleet group:** `flash`. **Stance:** *prove every stated behavior and compatibility claim; account for every changed unit; cite evidence; do not redesign.*

Vector 1 owes two independent obligations:

1. **Claim adjudication** — every claim in the captured contract gets a verdict.
2. **Changed-unit accounting** — every unit in the state's chunker manifest ([intake-and-scope.md](intake-and-scope.md) §0.3) gets exactly one final accounting state. Missing, unread or disputed material remains explicit; a proposed link never clears the rest of a unit.

Neither obligation promises full semantic review: enumerated ≠ inspected ≠ explained ≠ correct ≠ adequately engineered. Semantic attribution is bounded judgment and is reported honestly when budget runs out. P0.4 links are witnessed **leads**, never verdicts or completed attribution. P0.5 checks their mechanics and complete assigned sweep; it grants no claim-completeness permission and never finalizes UNCLAIMED.

## Validate and freeze the claims; load the units

Before adjudication, confirm the mechanical boundary: the current delegated `fast`-child `verify join` verdict (the manifest `verification.join` ref/hash/exit code), pinned to the exact input refs/hashes being audited. A missing, stale (inputs changed) or nonzero verdict stops the mechanical boundary — no V1 semantic work on unverified artifact mechanics. The coordinator re-delegates a fresh verifier child or pauses; it never re-implements or reruns the tool's checks in its own context, and never substitutes a run-authored script. The boundary command reuses the Phase-0 `verify join` surface against the preserved draft, units and join refs — its internal claims/units prerequisites validate those schemas — and V1's frozen claim directory is never fed to the draft-schema validator. A passing verdict proves recorded mechanics only — it does not freeze claims semantically and never substitutes for this audit. `verify claims`/`verify units` remain optional diagnostics: their recorded verdicts, when present, are receipts and never gates.

Before adjudication, V1 validates the `claims-draft/3` against the captured authorized sources. This is a **draft audit, not a second consistency sweep**: V1 checks each claim's statement, verbatim quote and source refs, the claim/nonclaim split, and the draft's completeness against the authorized source set (promises and acceptance requirements, nonclaims, contradictions, notes and missing-source limitations). It dispositions P0.2's source-consistency records — accept, or dispute with a witness — and does not re-run the bounded within-/cross-source pass unless a designated source is missing or uncaptured, a quote/source ref fails fidelity, a recorded contradiction is disputed or unsupported, or validation itself surfaces a material contradiction the draft missed. A newly surfaced or unaccepted material contradiction enters the existing `repair_required` logic; the final status stays V1's. Freeze the state's validated claim directory and record its ref/hash, the consistency disposition and any changes from the draft. Draft IDs are run-scoped handles, not plugin canonical IDs; never silently relabel a draft link as if its claim meaning had not changed. The detailed freeze/change-mapping contract remains an operator checkpoint.

Load the state's units-manifest and join-draft by recorded refs/hashes; check source/base/subject identity and the P0.5 sweep record. Every manifest unit enters accounting, including zero-link candidates and unresolved units. The shipped chunker supplies diff windows with context, not the retired nonoverlapping changed-line/event census. Repeated original hunk ranges must not multiply the denominator or masquerade as unique changed-line counts. Unrepresented or unsupported changed surfaces invalidate a complete-coverage claim; preserve the limitation rather than inventing a unit or omitting a file.

Final negative attribution needs all three proof legs: the changed unit is real and inspected; the validated claim universe covers the authorized captured sources; alternate attribution was checked across that universe. If any leg is missing, retain UNRESOLVED. `candidate-unclaimed[]` is an input lead only; V1 alone finalizes UNCLAIMED. A missing defining source or an aggregate claim without a single-unit witness is an explicit hard case, not an automatic GAP or UNCLAIMED result.

## Split

By **contract surface first**, not by file — same pattern as before (adjust to the PR's shape: derivation core / persistence-schema / spawn-router / main-session+TUI / tests), then **capacity-bounded** within the approved budget:

- **Claim/range shards** carry one surface's claims plus the changed ranges with candidate claim links. A claim has one *verdict owner* (other shards contribute evidence); every manifest unit has one *accounting owner*.
- **Residual attribution shards** carry units with no candidate claim, packaged by path/functionality only — work packaging, never an invented contract or a new invariant.

Test claims may draw evidence from other surfaces' shards without duplicating accountability. The split is V1's recorded `fleet_plan`, approved at the Phase-0 gate before any V1 child spawns; each shard's depth budget is its minimum checking load — a verdict for every assigned claim, an accounting state for every assigned unit, and the named checks it exercises. All V1 children stay `flash`; a missing or degenerate `flash` group pauses the vector — no substitution (templates/KICKOFF.md §4).

Each child receives: subject/base identity, its contract source slices (captured sources + designated in-diff sources with their provenance) and a queryable complete claim directory (paged — not injected wholesale), its assigned claim IDs and unit/range IDs plus input digest, exact diff slices, optional enclosing context, the scope of alternate claims it must check, budgets, and the coverage-return shape. The prompt carries the V1-validated/frozen claim-directory ref/hash, the source refs, and the state's units-manifest/join-draft refs/hashes ([child-pass-prompt-template.md](../../assets/child-pass-prompt-template.md)). IDs refer to those state-bound records, never cross-run canonical identities. P0 candidate links are leads and must be rechecked against the validated claim and the actual delivered bytes. Negative attribution requires enough claim access; otherwise the child returns the unit `UNRESOLVED`.

## Child return — two orthogonal blocks

The terminal return is wrapped by the bounded return transport (4096 UTF-8 bytes; `assets/child-pass-prompt-template.md` §Bounded return transport): full evidence goes unchanged to a child-exclusive run artifact, and the wrapper is transport only. The block formats below are unchanged.

Claim block, per assigned claim:

```text
CLAIM <claim_id> — VERIFIED: <implementation/test anchors file:line or range>
CLAIM <claim_id> — GAP: <concrete divergence: missing backing, contradiction, overstatement> (file:line / unit IDs)
CLAIM <claim_id> — INCONCLUSIVE: <what could not be decided and why>
```

Unit block, per assigned manifest unit (with exact subrange evidence where needed):

```text
ATTRIBUTED <unit_id> → <claim_id[,…]> — role: implements | tests | necessary-support | removes/changes | documents/specifies — why: <why this change serves this clause> — anchors: <file:line / range>
UNCLAIMED_CANDIDATE <unit_id> — <delivered behavior> — checked: <claim-directory scope searched>
EXCLUSION_REQUEST <unit_id> — class: <generated | vendor | lockfile | fixture | format | …> — proof: <evidence/tool output>
UNRESOLVED <unit_id> — reason: <unread | truncated | disputed | failed | insufficient claim access>
CLOSE <assignment digest> — processed: <n>/<n> — returned: <n> — remaining: <n>
```

Always explicit: `NONE` never substitutes for accounting, and the CLOSE line closes the assigned set. The claim block feeds the matrix; the unit block feeds the coverage ledger — a unit state is a coverage record, not a finding.

Supporting infrastructure need not be named verbatim by the author, but the dependency must be demonstrated. Same filename, lexical resemblance, a broad feature slogan, mere test existence, or a claim's VERIFIED status alone cannot explain a whole hunk. A change can be *attributable yet contradict* its claim — attribution and claim satisfaction are separate axes.

### Sources declare; delivery explains (no self-proof)

A source clause defines an expected behavior for changed targets — its own bytes never verify that the behavior is implemented, nor excuse the source unit's own attribution. `declares` is a **source/provenance role** (which captured block asserts the clause), **not** an EXPLAINED edge. A changed doc/spec unit is explained only through `documents/specifies` against an **independent purpose/target anchor** — e.g. the body/issue asking to revise X to require Y, or a distinct objective in an explicitly designated package whose repo-native change-process interprets its spec deltas as the package deliverable; necessary-support needs a demonstrated dependency, never "same package". Same-unit and mutual self-ratification are prohibited: a spec cannot clear itself by existing, and two documents cannot ratify each other. A missing or disputed anchor leaves the unit `UNRESOLVED` pending clarification — never invented intent, never speculative `UNCLAIMED`. Missing **designation** is a different case: without any pointed source, `repair_required` is recorded before V1; V1 may finalize the affected units as `UNCLAIMED` against the captured contract only after the inspected-delivery and alternate-attribution checks (intake-and-scope.md §0.2); `UNRESOLVED` is for a designated source whose purpose/target anchor cannot be established.

A docs-only PR that updates the actual specification is a **real deliverable**: compare the claimed text delta with the actual version, check scope/coherence/precedence, and mark well-anchored spec units `EXPLAINED` even with no executable code change — no phantom code, no behavior claim. A design-only deliverable with no code and no promise to implement code is not automatically a GAP. Multiple roles on one unit do not multiply the denominator; claim verdict and unit attribution stay orthogonal.

## Accounting states (exactly one per manifest unit)

| State | Meaning |
|---|---|
| `EXPLAINED` | at least one validated attribution edge to a captured claim (many edges allowed) — roles `implements` / `tests` / `necessary-support` / `removes/changes` / `documents/specifies`; source provenance (`declares`) is not an edge |
| `UNCLAIMED` | inspected delivered change with no defensible clause in the *captured contract*, after the documented claim-directory check: the child returns `UNCLAIMED_CANDIDATE`, the coordinator finalizes after an alternate-surface check |
| `EXCLUDED` | explicit approved waiver of attribution (generated/vendor/whitespace bulk, …), recorded with class, exact units, evidence, generator/source linkage, rationale and policy — a path suffix alone is never sufficient |
| `UNRESOLVED` | initial / unread / truncated / disputed / failed — never quietly relabeled |

Unclaimed is **not** "no lexical match", "no owner assigned", or child silence: if contract-search breadth is inadequate, the unit stays `UNRESOLVED`. Exclusions are waivers of attribution, never assertions of correctness — lock/dependency/security changes and hand-authored behavioral fixtures stay reviewable. Unknown formats and parser errors stay `UNRESOLVED`.

### Opaque units and the machine lane

opaque units initialize UNRESOLVED like every other manifest unit: a
byte-equality certificate is mechanical evidence, and a certified pure move may
be machine-attributed but never auto-EXPLAINED — attribution to the machine lane
is separate from claim satisfaction. An opaque unit is EXCLUDED only via
evidence-linked policy_class in the operator approval artifact; suffix or
minification alone cannot exclude an opaque unit, and security-relevant opaque
units cannot be EXCLUDED under any class. Where the skipped bytes are
security-relevant the basis is downgraded instead: security-relevant opaque units
force limited-only or blocked review basis until a human resolves them.

No skip may pass silently: every deliberate skip bubbles clearly to the human
reviewer at the pre-V1 pause, which presents occurrence ids, byte lengths,
sha256, policy_class and rationale for each skip — never hidden behind machine
metadata, never summarized away. policy_class is a reviewer-visible label, not an automatic waiver. The
operator signs the `operator-approval/1` artifact
(`approvals/operator-approval.json`) and the coordinator pins it with
--approval <run-root-relative-ref> in the run envelope; the delegated
`verify join` re-binds the artifact bytes, the identity tuple and the
operator_ref to the recorded skips. unapproved partial coverage pauses before
V1: no Vector 1 children are launched while any recorded skip lacks approval,
and missing designation keeps repair_required (a Phase-0 defect an approval can
never clear).

## Coordinator reconciliation

1. Initialize every manifest unit `UNRESOLVED`; load source captures, the V1-validated/frozen claim directory and its ref/hash, P0 join leads, assignments and approved exclusions. Do not initialize zero-link candidates as final negatives.
2. Validate each return: output OID, assignment digest, claim/unit references, range containment, a complete nonduplicated assignment return, required rationale/evidence, no self-ratifying or cyclic source→deliverable edge, budget/completion. Conflicts become `UNRESOLVED`; an unrelated claim ID or weak P0 witness cannot clear a unit.
3. Merge attribution evidence and claim verdicts separately; route cross-surface contributions to the verdict owner. V1 finalizes `UNCLAIMED` only after the inspected-unit, validated-universe and alternate-attribution checks, including every qualifying designated in-diff source clause. Keep contradictory claim evidence visible.
4. Compute `D = EXPLAINED ⊎ UNCLAIMED ⊎ EXCLUDED ⊎ UNRESOLVED` over the manifest unit IDs; report unit counts, evidence-supported side/range information, exclusion classes, claim totals and noncompliant children. Do not sum repeated/context hunk ranges as unique changed lines. Claim totals compare to the V1 frozen directory, not to a plugin registry or an unvalidated re-extraction. Enumeration, accounting, attribution and claim conformance are four distinct flags.
5. Retry/reslice bounded failures within budget; otherwise the gate offers the operator: extend budget, accept explicitly partial review, request richer contract / smaller PR, or stop.
6. Ledger detail is validated and materialized by the coordinator into the coverage pages; the gate shows the compact claim matrix plus coverage summary and exception groups — not full hunk returns. **Pinned-verifier coverage stops at claims/units/join**: the ledger, findings and closure validators are **NOT IMPLEMENTED** in `verify.mjs` (follow-up registry seam only — a future ledger validator would check one state/unit entry with its enums and counts, findings would check schema/IDs/severity/origin/subject anchors, and closure would check state identity and result enums). The coordinator still materializes these semantic records; there is no `verify ledger|findings|closure` CLI placeholder and no fabricated verdict may stand in for them.

## Artifacts

- **Claim × implementation/test matrix** — the semantic product: every claim marked `backed` / `unbacked` / `contradicted` with evidence, claim IDs and small coverage refs/counts.
- **Coverage ledger** — per-unit states, attribution edges, ranges, exclusions, recipe: coordinator-owned notebook coverage pages (notebook-plan-contract.md) — never scratch files, never rendered whole at the gate.
- **V2 projection** — Vector 2 consumes a paged, bounded **matrix projection**: adjudicated claims/invariants with anchors and the relevant coverage refs and uncertainty — not the ledger bulk.
- **Confirmation (pilot) exclusion** — early and text-stage finding confirmation (finding-confirmation.md) never selects V1 claim-gap/unclaimed-delivery rows, and a V1-rendering check only verifies that drafted sentences faithfully render the recorded adjudication — it never re-adjudicates V1 or reopens a finalized UNCLAIMED.

A thin or empty contract stops deeper planning at the gate: request author scope, or run an explicitly limited V1-only review; never fabricate a claim or silently launch an open-ended file sweep. Unclaimed units are disclosed as accounting, not automatically bug-reviewed or declared wrong.

## Aggregation

Claims deduplicate into the matrix. Confirmed unclaimed delivery is **V1 in-scope conformance** and **blocking** — grouped into one bounded finding per coherent missing scope declaration (representative subject/base anchors, exact group counts, unit selector/hash) with `conformance_kind: unclaimed-delivery`. Remedy: the owner declares/justifies the delivered behavior in the PR description or removes it — a declaration changes the captured contract, so it lands as a closed/new state (closure-verification.md), never silent rewriting. An operator-approved waiver stays `UNCLAIMED` with its resolution recorded, never fake claim coverage.

Severity: `LOW` default; `MED` only for material undeclared behavior/API/operational commitment with an articulated review or compatibility consequence — never merely many lines, never `HIGH` from absent declaration alone. Independent current harm routes to Vector 2. Groups beyond the output cap are disclosed with counts, never silently dropped.

Claim gaps keep their concrete divergence; the old "GAP without a user-visible divergence is dropped" rule is retired. For `unclaimed-delivery` the concrete failure is *delivered behavior absent from the captured declared scope*, evidenced by unit/contract IDs plus the attribution audit — no runtime failure is invented, and unclaimed ≠ wrong/over-engineered. Deletion and metadata findings carry explicit anchors `{side, oid, path, range_or_event}` plus the checked subject absence or surviving anchor.

## Failure to avoid

- **Paraphrased contracts** — compare against verbatim locked decisions, never a summary.
- **Unaccounted units** — an absent unit or digest mismatch stays `UNRESOLVED`; retries within cap; never inferred from a sibling.
- **False coverage from a broad slogan** — exact range evidence, role + rationale and separate satisfaction; one witnessed link cannot explain all bytes in a mixed-content unit. Keep unresolved residue explicit until the V1 accounting contract can account for it without gaps.
- **Over-claiming from tests** — "tested" ≠ "true"; mock-reality mismatch is itself a finding.
- **Mechanical completeness sold as semantic proof** — artifact hashes and P0.5 counts prove identity and assignment mechanics, not that all authorized sources were selected, that claims are semantically right, or that every unit is explained.
- **Silent claim drift** — retain the original draft and source evidence; V1 validates/freezes the claim directory and makes changes traceable. Never reinterpret a link under a different claim meaning without rechecking it.
- **False negatives from draft links** — zero links, child silence, truncated output or an unavailable claim directory never establishes UNCLAIMED. All three negative-attribution proof legs must hold in V1.
- **Guessed negatives** — every definitive `GAP` / `UNCLAIMED` and every basis blocker needs a concrete witness; a hunch, a high unclaimed ratio, a feature-like filename, "not clear", or the mere absence of a VERIFIED claim never decides. Check alternative attributions — including qualifying designated in-diff clauses — before finalizing.
- **Whole-diff ingestion** — no agent reads the full diff; ledger access is page/range-scoped.

## Disposition on completion

The claim matrix and coverage summary go to `pr-<n>-review` / the state's coverage pages. After the semantic verdicts and attribution reconciliation, and before the gate, the coordinator records the state's **review basis** — a planning disposition, not a finding and not a score:

- `ready` — a grounded basis supports the declared planned continuation (not "all claims VERIFIED" and not full-diff bug coverage).
- `limited-only` — a defensible bounded subset exists; the whole requested review implies unsupported scope.
- `blocked` — no worthwhile requested split exists.
- `unknown` — budget/evidence/source classification is insufficient; not an author-fault verdict and never a pass by default.

The record names the viable candidate surfaces (locked clauses, coherent expected behavior, implementation/absence anchors, material uncertainty), the **basis blockers** (requested surface, unavailable/incompatible source, affected claim IDs/findings/coverage groups, concrete witness, surviving permitted subset), the allowed next scope, and any operator disposition ref; it is bound to the state's base/subject OIDs, source versions/hashes, claims-draft, units-manifest and join-draft refs/hashes, the V1 frozen claim-directory identity, coverage hashes and V1 projection identity. A separate **`repair_required`** status records description defects and unresolved material source contradictions (provisional from Phase 0, final here) — it never computes evidence backing and is never waived by a ready basis. A provisional early-pass finding is never silently upgraded or downgraded at this gate: its witness records (conflicting quotes/offsets/source hashes/affected claim IDs) are carried as-is, and only a new review state with repaired sources can clear them.

Operator gate: Vector 2 proceeds when the basis is `ready` and no `repair_required` status is outstanding. Open gaps and unresolved units still don't block Vector 2 mechanically, but they are carried and disclosed; an accepted finding disposition never establishes readiness, and a ready basis never erases a blocking finding. `limited-only` proceeds only through an explicit, named operator authorization of the exact accepted basis, omissions, rationale, scope guard and state identity; `blocked` or `unknown` cannot proceed to ordinary Vector 2/V3 — the operator requests author repair, chooses a V1-only finish (findings/accounting preserved; V2/V3 recorded "not run — insufficient basis / explicit omission", never passed), authorizes a named bounded investigation, or stops. A blanket "proceed anyway" does not satisfy this gate: an override names the exact affected findings/surfaces/omissions, reason and authority, never waives truthful scope reporting, and never relabels `unknown` as known, a GAP as VERIFIED, or an unclaimed unit as explained. Mechanical completeness is always required for a complete coverage claim; valid `UNRESOLVED` units require explicit operator acceptance (extend / partial-review / stop).
