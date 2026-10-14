# implementation-pass.md — Vector 2: does the shipped code work?

**Question:** does the implemented code work safely, hold its invariants, and fail correctly?

**Fleet group:** `code-review`. **Stance:** *find user-visible correctness / compatibility / validation / state-transition bugs; classify origin; do not propose large refactors.*

## Split

By **sealed concept / invariant** — each child owns one data flow or invariant the review already established (a second only under the recorded two-concept exception below), NOT an open-ended file sweep. Examples from a real run:

- derivation core edge cases (ordering, empty sets, casts)
- persistence atomicity / security / version boundaries
- spawn fail-early reachability + session lifecycle
- orchestration / TUI escaping, focus, state retention
- test integrity (would a regression stay green?)

The split is derived from the V1 **matrix projection** — the adjudicated claims/invariants with their implementation/test anchors, the relevant coverage refs and carried uncertainty (conformance-pass.md, Artifacts) — paged and bounded: read only the projection rows and coverage slices your concept needs, never the coverage-ledger bulk, and never one child per changed unit/hunk.

The projection has a second consequence. `UNCLAIMED` groups stay Vector 1's accounting: disclosed uncertainty, not an automatic V2 lane and not an invariant source. The gate result compiles the split **and records it as V2's `fleet_plan`** (concept → shard → depth budget) on the frame page before any child spawns: only named, grounded invariants become children — the compiler refuses a split with no adjudicated invariant, and when the V1 gate recorded `limited-only`/`blocked`/`unknown` or an outstanding `repair_required`, only the operator's exact named authorization may proceed. One child owns at most two sealed concepts unless the plan records why a larger load is safe; each child's depth budget is its named `read` checks (per owned concept) plus its four `blast` judgment rows. A thin or empty contract — or a projection with no adjudicated invariant worth a split — stops V2 planning at the gate: the operator requests author scope, skips or explicitly limits Vector 2, or approves a specifically evidenced invariant to review. An unmet but clear requirement remains a valid invariant (a GAP is an excellent anchor); a docs-only deliverable is never forced into a code invariant, and V3/skip routes cannot expand the authorized scope.

## Subsystem research protocol (Vector 2)

Vector 2 uses the run manifest's research policy (`research.mode`) before direct source inspection, so each split understands its subsystem beyond the assigned files. The mandate is **uniform**: it applies to every split, including test-integrity concepts — deeper subsystem understanding yields better insights regardless of split type.

When `research.mode = chhound-rail` (sandbox index under the frame's registered prefix `{ch_prefix}`), every child MUST:

1. Call the exact `{ch_prefix}_daemon_status` tool and record `query_ready`.
2. If ready, call the exact `{ch_prefix}_code_research` tool with ONE question per owned sealed invariant — end-to-end callers, state transitions, failure paths, persistence/version boundaries, tests, correlated sites.
3. Use the exact `{ch_prefix}_search` tool at least once (regex for known symbols, semantic for behavior) to pinpoint a lead from that map.
4. Verify every cited or classified line in the subject tree with direct read/grep; decide origin only with `git show <base_oid>:<path>`.

The index may lag the subject tree: it is an orientation/navigation accelerator, never evidence authority (chhound-driver.md, Evidence rule). A not-ready or failed mapped tool triggers one honest direct-tree fallback that must be reported; it is NOT permission to use another `chh_*` namespace (all other live prefixes are excluded in the manifest).

When `research.mode = direct-tree` (plain worktree), trace the same invariant with git diff, rg/grep, direct reads, and git-show origin checks; do not invoke any `chh_*` namespace.

### RESEARCH TRACE footer (mandatory)

Every Vector-2 child closes its output with the shared footer; fields that do not apply to the mode are `n/a`:

```text
RESEARCH TRACE
mode: chhound-rail | search-extensive | direct-tree
tools-invoked-first-use: <exact names in order>
tool-call-count: <n>                                  # all modes: total exact-tool invocations (self-reported)
daemon-query-ready: true | false | error | n/a
orientation-question: <one line>                         # chhound-rail mode (Vector 2)
pinpoint-query: <type + query, or n/a with reason>       # chhound-rail mode (Vector 2)
search-log: <type + query per call, first-use order>     # search-extensive mode (Vector 3)
search-call-count: <n>                                   # search-extensive mode (Vector 3)
code_research-used: true | false                         # search-extensive mode (Vector 3; never required)
verified-correlated-sites: <path:line list, or checked-none>
fallback/error: none | <exact reason>
```

A missing or noncompliant trace makes the split `inconclusive`: rerun once with the corrected rendered prompt; a second failure reaches the operator gate. Traces are self-reported (current runtimes expose no child tool-call telemetry) — the coordinator spot-audits claimed `verified-correlated-sites` against the subject tree.

### Cost accounting and shadow splits

- Latency/cost is measured per child and recorded at the Vector-2 gate: wall-clock by the coordinator, exact-tool call count from the trace's `tool-call-count` (self-reported, as above). No preset budget applies until pilot data exists.
- Shadow splits — a paired direct-only control child on the same sealed concept, output compared for quality delta and excluded from the review — are **off by default**; they run only when the operator explicitly sets `research.shadow: on` in the manifest.

## Origin classification (mandatory)

Every finding gets an origin, decided by **base-diff evidence**, never vibes:

- **PR-introduced** — the code path is new to this PR (new field, new gate, new logic).
- **Pre-existing** — present at the PR base; the PR may touch the area but did not create it.

Verify by diffing the base commit (`git show <base>:<path>`) and citing where the mechanics come from. This feeds the disposition below.

## Child return format

The terminal return is wrapped by the bounded return transport (4096 UTF-8 bytes; `assets/child-pass-prompt-template.md` §Bounded return transport): full evidence goes unchanged to a child-exclusive run artifact, and the wrapper is transport only. The format below is unchanged.

```text
[V2-<n>] file:line — what — concrete failure mode (exploit or user-visible) — severity (HIGH/MED/LOW)
origin: PR-introduced | pre-existing (base evidence: <base:<path>:<line>)
```

- Label `NOT-A-BUG` when a suspected bug is checked and dismissed (cheap, honest).

## Lenses owned here

Vector 2 owns the **`read` lens** (readability / statement density) — see [hygiene-lens.md](hygiene-lens.md). Concretely:

- Each split names the `read` checks it exercised and marks `NOT-A-HIT` when clear — a lens not named is a frame error, never silence.
- A one-line expression packing several side effects, or a branch whose intent is not spottable in a glance = a `read` lens hit (LOW, lens trail). Naming/shape-lies belong to the `name` lens (owned by Vector 3), not `read`.
- Dense-but-repo-idiomatic code is a `NOT-A-HIT`, not a hit — the repo's own style is the baseline, never an invented one.

Vector 2 also owns the **`blast` lens** — data × call-site blast radius: the preflight produces the once-per-state symbol map, and each split records its four judgment rows (`data` / `semantics` / `fixture` / `gates`) as `hit` / `NOT-A-HIT` / `n/a-with-reason`, consuming the map's census rows for `sweep` ([blast-lens.md](blast-lens.md)). Rows are **advisory**; a *concrete* hazard instance is a **bug-table finding at its own severity**, and that finding is what blocks, never the lens.

**Style rule reconciled**: hygiene findings are *detected* by Vector 2 splits but do not enter the bug table — they route to the lens trail with LOW default severity and are operator-suppressible per instance. What the old rule forbade is *unrouted style noise in bug findings*; it never forbade systematic detection.

## Required review checks (justification + user impact)

Every Vector-2 child also runs two mandatory checks, rendered into its prompt's
`{review_checks}` slot (child-pass-prompt-template.md, Review-checks variant) and
closed `checked-and-clear` when they yield nothing — a check not run is a frame
error, like an unowned lens:

- **Justification** — the change's rationale as given (contract clause or code
  comment), the observable tradeoff it makes, and any evidence that contradicts
  that stated reason. A *contradiction you can evidence* — the code does not behave
  as the stated reason requires — is an ordinary Vector-2 finding; a *missing or
  unstated* rationale is an operator QUESTION, never invented intent and never a
  finding by itself. This challenges the change's reasoning, not Vector 1's intent
  match and not a refactor proposal.
- **User impact** — the affected actor, the task, the before/after behavior, the
  failure/recovery path, and any compatibility or migration cost. A concrete harm
  is a Vector-2 finding at its severity; a preference without harm stays on the lens
  trail.

Each mandatory check closes with one recorded outcome — `checked-and-clear` |
`advisory` | `question` | `finding` — in the `pr-<n>-review` trail
(evidence-format.md, Notebook layout): `checked-and-clear`/`advisory` are trail
rows like the hygiene and `blast` lens rows; a `question` (missing/unstated
rationale, unresolved impact judgement) routes to the decisions page; only an
*evidenced* contradiction or concrete harm is a `finding` and enters the bug
table, at its own severity.

## Aggregation + disposition

**Finding confirmation (pilot).** When `finding_confirmation.mode: pilot`, V2 bug-table hypotheses stay provisional until the vector's early-selection check reconciles them (finding-confirmation.md): after aggregation, HIGH or thin-evidence findings are selected (3–5 per vector, 1–2 cluster children) and adversarially checked before the gate. The early-selection hook creates no new gate, never changes `review_basis`/`repair_required`, and keeps unresolved items gate-visible; selected findings publish confirmed-only.

The coordinator segments findings into:

1. **Scope route** per evidence-format.md (External routing):
   - **In scope** (introduced or enforced — the PR owns the issue) → the comment's Findings, to be addressed; never a follow-up suggestion.
   - **Out of scope** → an optional follow-up row: `recommended` when easy / best bang for the buck, otherwise a downstream candidate (low-impact + heavy, or pre-existing and not introduced by the PR).
2. **Deferred** → recorded on the decisions page with rationale; never presented as fixed.

Lens-trail rows (hygiene + `blast`, from the section above) are aggregated **separately** into the lens trail of the findings page — not merged into the bug table — and each stays operator-gated.

Also produce the **pre-existing vs PR-introduced summary** — the operator needs to see directly which debt the PR itself owes (introduced or enforced) and which it merely inherits.

## Failure to avoid

- **Re-verifying Vector 1.** Vector 2 assumes conformance status is known; it hunts bugs, not contract gaps.
- **Missing the origin.** A pre-existing issue mislabeled as PR-introduced floods the review comment; a PR-introduced one mislabeled as pre-existing lets the PR merge with a regression.
- **Asserting bugs without reproduction path.** HIGH findings need the concrete failure sequence.
