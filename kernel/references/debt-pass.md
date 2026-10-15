# debt-pass.md — Vector 3: is the way it's built sustainable?

**Question:** what costs will the *next* change to this subsystem pay, because of how this PR delivered its feature?

**Fleet group:** `code-review`. **Stance:** *identify future-change cost or divergent ownership; distinguish design debt from bug; never line-by-line.*

## Split

By **bigger concepts**, drilled down from the facts Vectors 1–2 already established. The claim matrix / matrix projection and any disclosed coverage uncertainty travel as leads like any other — V3 never ingests the unit-accounting breadth (the coverage ledger's range detail) and never re-adjudicates attribution or inherits its ownership. Standard axes (pick the ones that apply):

1. **Pluggability / extensibility claim** — is an advertised "pluggable" surface real, or a hard-coded vertical slice? (The classic: a spec says "extensible to X constraints"; code ships one hard-coded constraint type. Count the touch points a 2nd type needs.)
2. **Boundary ownership** — which module owns what; does a persistence module now depend on host model resolution; are cap-invariants enforced at the right layer?
3. **Versioning / migrations** — is the version logic centralized or scattered with literal numbers; is refusal-to-downgrade a dead-end; any migration dispatcher?
4. **Projection / state representation** — derived vs persisted shapes; do transient fields leak into durable config; is there a projection boundary?
5. **Performance / operability** — unbounded re-derivation, missing caches/invalidation, unbounded fleet cost.
6. **Vocabulary / source-of-truth** — is there one enum/const, or re-declared prose/schemas that drift?

The V2 gate result compiles and records V3's `fleet_plan` (axis/lens → shard → depth budget) in its bounded stage record (state-head indexed) before any child spawns. One child owns at most two debt axes unless the plan records why a larger load is safe; each owned axis/lens carries its depth budget — at least two distinct search calls and one recorded evidence artifact (file:line) per owned axis/lens.

## Hygiene lenses owned here

Vector 3 co-owns the **`dead`**, **`read`** and **`name`** lenses (see
[hygiene-lens.md](hygiene-lens.md)) — a dead feature or unused surface is
*future-change cost*, which is exactly this vector's question:

- `dead` — exported/surfaces the PR leaves un-consumed, dead config/keys, commented-out feature blocks; hit = LOW, but **MED** when removing the symbol would change behavior (a live surface that just looks dead).
- `read` — statement density at the *concept* level: one axis doing several jobs, a shape that can't be parsed in one glance.
- `name` — vocabulary drift vs the repo's own source-of-truth term; a name that lies about its shape.
- `quality` — Vector 3 owns the **`quality`** lens outright (see
  [quality-lens.md](quality-lens.md)): big decision trees that outgrew their
  shape, coverage-without-assurance, error-handling drift, duplication — all
  four sub-checks are future-change cost, this vector's question. Every debt
  split records `tree` / `test` / `error` / `dupe` as hit / NOT-A-HIT /
  n/a-with-reason.

Routing priority for `quality` candidates: a *correctness / observability*
failure belongs to Vector 2; a *concrete future-change cost* is a debt finding;
only residual advisory shape / idiom / suite-strength concerns become
`quality` rows (link, don't duplicate).

All hygiene hits route to the lens trail (LOW default, operator-suppressible), not the debt table.

Each child receives: contract context, the relevant architecture files + diff, the relevant prior-vector facts (matrix/projection rows, disclosed uncertainty) as leads, and this stance. Reading is concept-directed, not exhaustive.

## Search-extensive research protocol (Vector 3)

Debt claims are repo-wide by nature ("no consumers", "count the touch points a 2nd type needs", "re-declared elsewhere") — when `research.mode = chhound-rail` (sandbox index under the frame's registered prefix `{ch_prefix}`), the exact `{ch_prefix}_search` tool is Vector 3's **default lead generator** and is used extensively:

Before the first search, read the run's **symbol map** (`symbol_sweep` artifact — chhound-driver.md, Symbol sweep): the diff symbols' occurrence census and usage heat, shared with this vector as a lead inventory. It is a convenience, not an exemption — the census covers the selected diff symbols only (literal-name occurrences, not resolved symbols), and the search requirements below are unchanged.

- For every owned concept and lens, lead with the exact `{ch_prefix}_search` tool — regex queries for concrete symbols/patterns (usage sites, imports, duplicated literals/keys/version numbers), semantic queries for concept-level correlation (touch points for a second constraint, sites reading a config key, candidate consumers of a surface). Iterate: refine queries from hits instead of stopping at the first result.
- Minimum per child (its depth budget): **at least two distinct search calls per owned concept/lens**, and every repo-wide claim (usage counts, absence of consumers, vocabulary duplication) must be preceded by a logged search attempt.
- `{ch_prefix}_code_research` may be used for architecture orientation when a concept needs it; it is never required here.
- Results are leads, never evidence: cite only lines re-read in the subject tree at `subject_oid`; PR-specific vs pre-existing segmentation stays base-diff based (`git show <base_oid>:<path>`). The index may lag the subject tree.
- Unready/failed mapped tool → one recorded direct-tree fallback (rg/grep-based tracing); never another `chh_*` namespace.
- The mandatory footer is the shared RESEARCH TRACE in `search-extensive` mode (canonical schema in implementation-pass.md; prompt filler in child-pass-prompt-template.md Variant C). Missing/noncompliant trace = `inconclusive`, rerun once with the corrected rendered prompt, then operator gate.
- Cost: wall-clock by the coordinator and the trace's `search-call-count` (self-reported — no child telemetry, see implementation-pass.md) are recorded at the Vector-3 gate; no preset budget until pilot data exists. Shadow splits follow the same operator opt-in (`research.shadow: on`).

## Child return format

The terminal return is wrapped by the bounded return transport (4096 UTF-8 bytes; `assets/child-pass-prompt-template.md` §Bounded return transport): full evidence goes unchanged to a child-exclusive run artifact, and the wrapper is transport only. The format below is unchanged.

```text
[D3-<n>] concept — why fragile/short-lived — concrete future failure when <2nd constraint | next version | new host> arrives — severity (HIGH blocks future feature work / MED / LOW)
```

- Verify with file:line where the shape is hard-coded.
- A debt must be *worth tracking*: if no future change pays it, it's noise.

## Aggregation + disposition

**Finding confirmation (pilot).** V3 debt hypotheses stay provisional until the vector's early-selection check reconciles them (finding-confirmation.md): after aggregation, HIGH or thin-evidence debt findings are selected (3–5 per vector, 1–2 cluster children) and adversarially checked before the gate. The early-selection hook creates no new gate and never presents unconfirmed debt as established; selected findings publish confirmed-only.

The coordinator groups findings:

1. **Concept-level finding + concrete future failure.**
2. **Scope segmentation** per evidence-format.md (External routing): debt the PR owns (introduced, or its change depends on / routes through / claims the flow) vs pre-existing debt the PR only touches in passing.
3. **Routing**:
   - **In scope** → `fix-in-PR` — addressed in this PR, never a follow-up suggestion.
   - **Out of scope** → `pre-existing-debt` in the comment's follow-up section: `recommended` when easy / best bang for the buck, otherwise a downstream candidate. The row moves to `deferred-decision` (recorded with rationale) or `track-separately` (own ticket) only when that resolution is accepted.

## Failure to avoid

- **Presenting debt as bug.** Debt lacks a current failure; if there is a live failure path, it belongs in Vector 2.
- **Unchecked "extensible" claims.** An aspiration in the spec is a debt when the code doesn't back it — verify, don't take the claim's word.
- **Inadequate intent recovered by generic axes.** Debt concepts consume the V1 matrix projection and disclosed uncertainty as leads; they never reconstruct a thin/contradictory captured contract, re-adjudicate attribution, or expand a `limited-only` scope.
- **Hiding defers.** Acknowledged-but-unfixed debt must be recorded, not silently dropped.