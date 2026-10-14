# child-pass-prompt-template.md

The per-vector fleet-child prompt contract. Every child receives a prompt shaped from this template; the coordinator fills the bracketed slots from the run manifest and the vector's split.

## Base template

```text
You are a {vector} review agent in a fleet. The review subject tree is
{SUBJECT_PATH} — subject OID {SUBJECT_OID} (stable for this review state;
record it on every finding row).

THIRD: read the contract from {contract_ref} (the relevant section only).
THEN READ the state's symbol map at {symbol_map_ref} when the slot is present
(V2/V3/yagni) — the diff symbols' occurrence census and usage heat. Leads only:
re-read every cited line in the subject tree at {SUBJECT_OID}, and let no map row
decide a consumer or a verdict.
Then read the assigned files: {file_list}.
Then read the diff slices for your surface: {diff_paths} (base..subject).
{coverage}
READ BOUNDARY: opaque occurrence bodies live in the machine-only raw store
(units2/raw/occ-*.bin); they are never model input. Never open, list, hash,
quote or otherwise ingest those files or any raw occurrence content, and never
treat opaque descriptor metadata (sha256/byte_length/occurrence ids) as
reviewable code. Skipped occurrences are surfaced to the operator at the
pre-V1 pause, not to you.
AUTHORIZED SCOPE: {authorized_scope} when the slot is present (V2/V3 — the V1
gate's recorded scope + explicit omissions; the coordinator must not spawn a
V2/V3 child with a missing/blank slot).
PROJECTION / PRIOR FINDINGS: {projection_ref} / {prior_findings_ref} when the
slots are present (V2: the V1 slice; V3: the V1+V2 slices, do-not-duplicate
framed; bounded slices, never ledger bulk). They are context, never scope:
they cannot narrow, redirect, or bound your assignment; they are not evidence,
and absence from them proves nothing. Run your own lenses/protocol over your
full authorized scope; return only evidence you inspected yourself. V3 additionally
carries at least one lead thread independent of prior findings (symbol map /
repo-wide search).

YOUR ANGLE: {angle}. Inspect completely within your declared assignment and report per
{return}.

YOUR LENSES: {lenses}. Run each lens checklist from
its owning reference — hygiene family: kernel/references/hygiene-lens.md; the
`quality` lens: kernel/references/quality-lens.md; the `blast` lens:
kernel/references/blast-lens.md; the `yagni` lens:
kernel/references/yagni-pass.md; a lens you check and clear
is explicitly NOT-A-HIT. Advisory lens hits go to the lens trail, never the bug
table — a concrete `blast` hazard instance is a Vector 2 finding instead.

REVIEW CHECKS: {review_checks}

RESEARCH STEP: then execute the research step per {research_protocol} when the
slot is present (Vector 2: code-research protocol; Vector 3: search-extensive
protocol; Vector 1/yagni: omitted). The slot carries the exact registered tool
names, the namespace binding, the fallback rule, and the mandatory RESEARCH TRACE
footer. MCP output is discovery only — every cited line is re-read in the
subject tree at {SUBJECT_OID} before it becomes evidence.

Your contract is the verbatim captured sources — PR description/title, linked
issue + locked decisions, and any explicitly designated in-diff source — never
a summary of intent or an unpointed lookalike. A source clause states an
expectation; its own bytes never verify its delivery (`declares` is source
provenance, not an EXPLAINED edge). Cite file:line in the subject tree. Do NOT
run tests unless told; do NOT propose large refactors; keep style mentions on
the lens trail (unrouted style noise is dropped).

Return per {return}: the vector's blocks/rows, plus a closing for any surface you
check and clear; include the RESEARCH TRACE footer when {research_protocol}
is present.
Under {budget} lines.
```

## Slot map

| Slot | Filled from |
|---|---|
| vector | conformance / implementation / debt / yagni |
| SUBJECT_PATH | the subject tree root (sandbox or worktree dir) — run manifest `subject_path` |
| SUBJECT_OID | run manifest subject_oid |
| owner/repo | the review target `<owner>/<repo>` (intake `owner/repo`) — Variants A/C subject description |
| contract_ref | run-manifest `contract_ref`: the notebook page `contract-<owner>-<pr>-s<n>` (captured sources incl. designated in-diff sources; pi runs) or the disk CONTRACT slice (fallback runs) |
| symbol_map_ref | run manifest `symbol_sweep` — the state's symbol map ref (notebook page `symbol-map-<owner>-<pr>-s<n>` on pi runs; scratch path in fallback runs) |
| file_list | the assigned files for this surface/split |
| diff_paths | the focused diff hunks for the surface |
| angle | the surface (conformance) / sealed invariant (implementation) / bigger concept (debt) / functionality unit (yagni) |
| lenses | the lens list this split owns, from the run lens matrix (pipeline-model.md; checklists per owning reference: hygiene-lens.md, blast-lens.md, quality-lens.md, yagni-pass.md) |
| return | from the pass contract: conformance: claim block + unit block + `CLOSE` (conformance-pass.md); implementation/debt: `[V2-<n>] file:line`, `[D3-<n>] concept`; yagni: `ENGINEERING` / `[Y-<n>]` / `NOT-YAGNI` (yagni-pass.md) |
| budget | output-size cap (lines); enforced; truncation = inconclusive |
| coverage | the vector's coverage block (below): V1 assignment + return shape; yagni scoring inputs; omitted for V2/V3 |
| review_checks | from the pass contract: Vector 2 renders the justification + user-impact checks (Review-checks variant below); other vector-template passes render `n/a`; separate Phase-0/non-vector bindings are exempt |
| claim_directory_ref | run manifest `coverage.claims_ref` — the V1-validated/frozen, complete queryable claim directory, with source refs and a recorded hash; never a Phase-0 draft alone |
| claim_basis_ref | the V1 validation/freeze evidence and source refs/hashes, plus claims-draft / units-manifest / join-draft refs/hashes and P0.5 sweep evidence; no plugin gate permission |
| claim_ids | the state-bound IDs assigned from the V1 frozen directory (V1) / the unit's matrix rows (yagni); retain traceability to draft IDs and never silently change meaning |
| unit_ids | the changed-unit/range IDs assigned to this shard (V1) |
| candidate_scope | the alternate claim/attribution scope to check before returning `UNCLAIMED_CANDIDATE` |
| authorized_scope | the V1 gate's recorded allowed next scope + explicit omissions (`review_basis` record, conformance-pass.md) — rendered into V2/V3 prompts; missing/blank = frame error, do not spawn; expands nothing |
| projection_ref | the V1 matrix projection — the paged, bounded adjudicated claims/invariants with anchors and the relevant coverage refs and uncertainty (conformance-pass.md, Artifacts), bound to the state's coverage pages (notebook-plan-contract.md); rendered into V2/V3 prompts; never ledger bulk |
| prior_findings_ref | the prior-vector findings slice — V2: the V1 slice; V3: the V1+V2 slices under do-not-duplicate framing; bounded, never ledger bulk |
| coverage_ref | the state's coverage summary page + the ledger shard pages for this assignment (notebook-plan-contract.md) |
| assignment_digest | coordinator-computed digest of this shard's assignment (claims + units + contract/ledger refs) |
| research_protocol | run-manifest `research` block rendered per the variants below (Vector 2: Variant A; Vector 3: Variant C; Vector 1/yagni: omitted) |
| ch_prefix | the frame's registered `chh_*` prefix in rail mode; `none` in direct-tree |
| ch_daemon_status_tool / ch_code_research_tool / ch_search_tool | `{ch_prefix}_daemon_status` / `_code_research` / `_search` — exact registered names |
| excluded_namespaces | other live `chh_*` prefixes (other sandboxes) — never to be used |
| BASE_OID | run manifest base_oid (for origin checks) |
| verifier_command | the frame-recorded exact invocation template (actual: `node <pinned-engine>/kernel/tools/verify.mjs <claims\|units\|join> --run <run-root>`) |
| verifier_path | the frame/run-manifest verifier path (`kernel/tools/verify.mjs`) |
| verifier_sha256 | the frame-recorded exact-byte sha256 of the pinned verifier |
| run_root | the run-artifact root (the `--run` target) — never the subject tree |
| artifact_class | `claims` \| `units` \| `join` — the command to run |

`{projection_ref}` / `{prior_findings_ref}` composition: V2 gets the V1 slice
(the state's matrix projection + coverage pages); V3 gets the V1+V2 slices
under do-not-duplicate framing — a prior finding is a lead, not a lane. Both
slots carry bounded slices, never ledger bulk. V3 additionally carries at least
one lead thread independent of prior findings (its own symbol-map / repo-wide
search thread).

> `{projection_ref}` / `{prior_findings_ref}` are **context, never scope**: they cannot narrow, redirect, or bound your assignment; they are not evidence, and absence from them proves nothing. Run your own lenses/protocol over your full authorized scope; return only evidence you inspected yourself.

## Child contract invariants (always)

1. Analyze the **subject tree** at {SUBJECT_PATH} only; every row carries `subject_oid`; a tree whose HEAD differs from {SUBJECT_OID} is `inconclusive` (should not happen — the tree is stable for the state).
2. Compare against the **verbatim** captured sources and their designation/interpretation, never a paraphrase or an unpointed lookalike.
3. Evidence = file:line in the subject tree, plus base evidence for origin (Vector 2+).
4. No **unrouted** style nits, no redesign, no unrequested tests. Style hits go to the lens trail.
5. Explicitly label `NOT-A-BUG` when a checked suspicion clears — that keeps the coordinator from re-checking.
6. Return compact records; do not write the notebook (coordinator owns writes).
7. When {research_protocol} is present, run it and close with the RESEARCH TRACE footer; a missing trace is `inconclusive`, never a pass.
8. Vector 1: close with `CLOSE <assignment digest> — processed n/total`. An absent unit, digest mismatch, or missing claim verdict stays unresolved; `NONE` never substitutes for accounting. The complete claim directory must be queryable before any negative attribution — read the scope you need; insufficient access means `UNRESOLVED`, not `UNCLAIMED`. Use the V1-validated/frozen directory and its source evidence ({claim_basis_ref}); P0.5 success or draft links alone never authorize negative attribution. Insufficient validation or access leaves affected units `UNRESOLVED`. Before returning `UNCLAIMED_CANDIDATE`, check every qualifying designated in-diff clause; a doc/spec unit is explained only through `documents/specifies` against an independent purpose/target anchor (conformance-pass.md).

## Given budget & cost

- Set a per-child timeout and line budget at spawn. Over-budget or timed-out output is recorded as `inconclusive`, never `pass`.
- The coordinator fans out a vector's compiled children as one concurrent batch (bounded by the concurrency cap), merges their records into the findings page, and never awaits one child before spawning the next; no coordinator write shares the spawn batch.

## Bounded return transport (reviewer/proposer children)

Every reviewer or proposer child's terminal return is capped at **4096 UTF-8 bytes** serialized (measured on the actual serialized string; multibyte content counts its UTF-8 bytes). The return is one JSON object, no fences:

`{status, counts, finding_ids, artifact_ref, sha256}`

plus the typed binding fields `run, review_state, subject_oid, assignment_digest` where applicable.

- `status` is `complete | inconclusive | blocked`; `complete` means report delivery, not semantic or gate pass.
- `finding_ids` is capped at 32 entries inline; an overflow, a count mismatch or any truncation is recorded in `counts`, and the full ID index lives in the pinned artifact — never silently omitted as "none".
- Full vector blocks, lens trail, CLOSE digest, research trace, uncertainty and findings go unchanged to a child-exclusive run artifact; the wrapper is transport, not a replacement finding schema.
- P0 children keep their exact existing output paths and formats; a P0 receipt points to their output or an evidence report referencing those pins, never wraps or rewrites the join JSONL.
- Missing, stale, unreadable, truncated or over-cap receipt => `inconclusive`; no silent truncation, and no syntactically plausible success is fabricated.
- Shared-disk availability is a prerequisite: without it the operator pauses or explicitly retains the legacy transport with no savings claim.

The coordinator owns notebook writes and adjudication. It must consume ALL required claim/unit/closure/trace records in bounded artifact slices before asserting completion, never trusting counts or cherry-picking findings.

**Mechanical-verdict exemption.** This cap does not apply to the mechanical verification child: it returns the stdout JSON verdict verbatim plus exit code and stderr under the existing contract, untruncated (a missing or truncated verdict already fails the mechanical gate).

## Phase-0 children — separate bindings

Phase-0 children are not vector children and do not use the vector template.
The P0.2 claims pass, the P0.4 join proposer and the mechanical verification
child use `#fast`; if unavailable, pause rather than silently substitute a
group. Their outputs are drafts/leads, not plugin canonical artifacts or V1
verdicts. The engine ships the chunker and the pinned mechanical verifier
(`kernel/tools/verify.mjs`); the P0.5 merge/acceptance decision is coordinator
behavior that consumes the verifier's pinned verdict.

### P0.2 Claims draft

```text
Read the authorized captured sources at {source_capture_refs}, with designation,
role/precedence and version/hash evidence. Do not inspect delivery to invent intent.
Write claims-draft/3 at {claims_draft_path}:
sources[{source_ref,locator,path,role,sha256,byte_length[,blob_subject]}],
claims[{id,statement,source_ref,quote,also_in}],
nonclaims[{id,statement,source_ref,quote,reason}],
conflicts[{id,kind,materiality,quotes[{source_ref,quote,offset_bytes}],
           affected_claim_ids,precedence,witness,reasoning}],
notes[{note}] (a quote-bearing note carries the defined optional
source_ref+quote pair),
missing_source_candidates[{resource,affected_claim_ids,reference_quote,why_it_matters}].
Conflicts vocabulary is exact: kind is `within-source` or `cross-source`;
materiality is `material` or `non-material` (structural enums only — put the
richer subtype wording in witness/reasoning); precedence is a required nonempty
string, `"none"` when no precedence is stated.
Quote rule (mechanical): every quote must be an exact UTF-8 byte substring of
the captured source bytes — copy byte-for-byte, never normalized, re-wrapped or
Markdown-cleaned; claims/nonclaims quotes bind to their source_ref, a note quote
to its paired source_ref, a missing_source_candidates reference_quote to some
captured source, and a conflict quote's non-null offset_bytes is the zero-based
byte offset of its first occurrence.
Use run-scoped draft IDs. Include stated fixes and acceptance requirements;
separate background/advisory/evidence from promises and never duplicate a clause
as both claim and nonclaim. Absorb bounded within-/cross-source consistency:
record witnessed contradictions/materiality and missing sources, never choose an
unstated precedence or silently authorize a resource. Preserve source quotes.
Return the artifact path and compact counts/hard cases, not a semantic verdict.
Before returning: confirm every `sources[].source_ref` you declared resolves to a capture-manifest `sources[].locator`; a missing locator is a hard case to return (name the ref) — never edit the capture manifest yourself, the coordinator re-captures and re-pins it.
```

This nested profile is the frozen `claims-draft/3` structural shape (the S28
profile); no alternate shape is accepted by the pinned `verify claims` command.
V1 validates/freezes claims against sources before adjudication. The inline quote rule above restates the mechanical containment contract in artifact-contracts.md §2.

### P0.4 Per-box join JSONL

The coordinator packs by input length only: instructions + the **full**
`claims[].id` / `statement` list + whole units in manifest order. Never trim the
claims, split a unit between children, set a unit-count cap or reserve answer
space in packing. Fixed input or one whole unit that cannot fit requires a pause.
Use the approved input ceiling; output tokens are monitored separately.

```text
You propose links, never claim satisfaction. Your only write path is:
{exact_box_jsonl_path}
Claims: {claims_draft_ref} — read every claims[].id and statement;
ignore nonclaims/notes/conflicts for matching.
Units in order: {assigned_unit_ids_and_exact_paths}.

Write compact JSONL, exactly one row per assigned unit in listed order:
{"unit_id":"…","links":[{"claim_id":"…","closeness":"high","role_hint":"implements","witness":"…"}],"unresolved":null}

A link says “look here”, not “this works”. high = plainly where the claim's
subject lives; medium = partially related; low = weak. Include every witnessed
link; no per-unit cap. Never duplicate a (unit_id,claim_id) pair. claim_id must
exist in the complete supplied claims list. role_hint is implements | tests |
necessary-support | removes | changes.
Witness: nonempty verbatim fragment from THIS unit's file, include its diff
marker, single line, <=160 characters in this pilot; never quote another unit.
If the unit cuts a block, reason only from bytes present. Use unresolved:null
when decidable; otherwise a specific reason. Zero links still needs a row with
links:[]; missing output is not an empty match. No fences or prose in the file.
Appending is optional. Copy the output path character-for-character and verify
that exact file exists before reporting success. Return path, units processed,
links/by-closeness, zero-link units and unresolved units; do not paste JSONL.
```

P0.5 validates file existence, strict types/fields, every assigned unit exactly
once, valid IDs/enums and unique pairs, witness bounds and exact-byte containment,
and the recorded budgets. Retain the original worker attempts plus failed
attempts and retry/re-split records under the approved policy; do not invent
links or turn missing rows into candidates.
The merged join-draft carries candidate_unclaimed only; V1 finalizes negatives.

The 160-character witness cap and the retry/re-split constants are recorded
pilot policy (the run envelope pins `witness_max_chars: 160`, one retry, halves,
depth ≤ 1; the verifier refuses other values); the operator-approved input
ceiling remains a pilot decision, and tightening `medium` remains an open
semantic checkpoint.

### Mechanical verification child (`fast`; not a reviewer)

The coordinator MUST spawn a `fast` child explicitly to execute the pinned
`{verifier_command}` against artifact class `{artifact_class}`. The child
verifies the frame-recorded `{verifier_path}` / `{verifier_sha256}`, reads run
artifacts only, runs the tool, and returns the stdout JSON verdict verbatim
plus the exit code and stderr summary. Read-only: do not interpret, repair or
normalize, do not write artifacts or the notebook, do not run subject code, and
do not substitute checks. Missing/degenerate `fast` pauses; no coordinator
fallback. A nonzero exit, a missing or unparseable verdict, a truncated return,
a tool/hash mismatch, or an ok/exit inconsistency fails this mechanical gate.
The coordinator consumes the verdict; it never overrides, reimplements or
reruns checks in its own context. It may obtain repaired artifacts as new
retained attempts and re-delegate, or pause. Materiality, source
authority/precedence, `repair_required`, `review_basis`, attribution and
dispositions remain coordinator/V1 semantic work. This child is not under the
vector template's subject-read invariant: the verifier must NOT read the
subject tree, never executes subject code, git or the network, and treats
`{run_root}` as the artifact root — never the subject.

The frame fills `{verifier_command}`, `{verifier_path}`, `{verifier_sha256}`,
`{run_root}` and `{artifact_class}`; a missing or blank slot is a frame error —
do not spawn. The verifier pin freezes at frame seal and the artifact refs land
at their gates.

**Preparation/repair is a distinct role.** A distinct `fast` repair child
(never this verification child, never the coordinator) prepares or repairs
artifacts from the coordinator's exact verdict/error refs, the pinned
`kernel/references/artifact-contracts.md` and the authorized artifact paths; it
never changes captured source meaning, witness bytes, policy or claims
semantics to pass, and ambiguity pauses for the operator.

## Coverage block variants (filler for {coverage})

Vector 1 always fills the slot; the yagni pass fills it with its coverage
inputs; V2/V3 add no coverage-assignment block — their matrix-projection /
prior-vector facts travel in the `{projection_ref}` / `{prior_findings_ref}`
slots (above), and their `{return}` is unchanged. The coordinator renders the
V1 gate's **authorized scope + explicit omissions** into every V2/V3 prompt
(`{authorized_scope}`, from the `review_basis` record — conformance-pass.md);
a missing/blank `{authorized_scope}` in a V2/V3 prompt is a frame error — do
not spawn. A child may not widen beyond the recorded scope.

### Vector 1 — assignment + accounting

```text
COVERAGE ASSIGNMENT (required — Vector 1)
You own claims {claim_ids} and changed-unit ranges {unit_ids} from the state's
coverage page {coverage_ref}; one accounting owner per unit, one verdict owner
per claim. Input digest: {assignment_digest}.
The captured contract is verbatim at {contract_ref}; the complete claim
directory is paged at {claim_directory_ref} — read the pages you need; your
local contract slice is never the whole universe. Claim IDs refer to the state's
V1-validated/frozen directory and source evidence ({claim_basis_ref}); never
silently reinterpret or invent one. P0 links and candidate_unclaimed entries
are leads only. Insufficient validation or claim access → UNRESOLVED.
Designated in-diff clauses are ordinary claim sources with recorded
provenance — never evidence that their own deliverable exists. Before returning
UNCLAIMED_CANDIDATE for a unit, check the candidate scope {candidate_scope}
(alternate claims / attribution surfaces, including qualifying designated
in-diff clauses); insufficient access → UNRESOLVED.
Return per conformance-pass.md: claim block (VERIFIED / GAP / INCONCLUSIVE)
plus unit block (ATTRIBUTED / UNCLAIMED_CANDIDATE / EXCLUSION_REQUEST /
UNRESOLVED), closed by CLOSE <digest> — processed n/total, returned, remaining.
A unit state is an accounting record, not a finding; NONE is never used in
place of a record.
```

### Yagni — scoring inputs

```text
COVERAGE INPUTS (yagni)
Read your unit's EXPLAINED range groups from {coverage_ref} — which behavior
each range was accepted to deliver — and the claim-matrix rows for {claim_ids}.
Leads only: re-read the code in the subject tree; do not re-adjudicate
attribution or coverage ownership, and do not treat a claim GAP as excluding
its explained ranges. The full contract is at {contract_ref}. Return per
yagni-pass.md: ENGINEERING JUSTIFIED/CHALLENGED, Y rows, NOT-YAGNI, NONE.
```

## Review-checks variant (filler for {review_checks})

Vector 2 fills the slot with both checks below; other vector-template passes render
`n/a`. P0.2/P0.4 children and the non-vector preflight sweep use separate bindings
and do not receive this slot.
They are **mandatory in a Vector 2 prompt** — a check not run is a frame error,
like an unowned lens — and each is closed `checked-and-clear` when it yields
nothing. This is the external-reviewer "reasoning behind / effects on the user"
premise (rationale challenge + user consequence), scoped to Vector 2 so it does not
re-open Vector 1's intent match or Vector 3's architecture review.

```text
REVIEW CHECKS (Vector 2; both mandatory)
- JUSTIFICATION: state the change's rationale as given (contract clause or code
  comment), the observable tradeoff it makes, and any evidence that contradicts
  that stated reason. A contradiction you can evidence — the code does not behave
  as the stated reason requires — is a finding; a missing or unstated rationale is
  an operator QUESTION, never invented intent and never a finding by itself.
- USER IMPACT: name the affected actor, the task, the before/after behavior, the
  failure/recovery path, and any compatibility or migration cost. A concrete harm
  is a Vector-2 finding at its severity; a preference without harm stays on the
  lens trail.
Close each check `checked-and-clear` when it yields nothing.
```

## Research protocol variants (filler for {research_protocol})

Vector 2 always fills the slot with Variant A; Vector 3 always fills it with Variant C (search-extensive); Vector 1 omits the slot. In `direct-tree` runs (no rail) the coordinator fills Variant B for both vectors. The coordinator resolves every placeholder (exact prefixed tool names, subject path, prefix, excluded namespaces, HEAD/base OID) before spawning — children see exact registered names, never generic aliases.

### Variant A — Vector 2, rail index (`research.mode: chhound-rail`)

```text
SUBSYSTEM RESEARCH (required — Vector 2)
The subject tree {SUBJECT_PATH} ({owner/repo} at {SUBJECT_OID}) is covered by the
sandbox index bound under prefix {ch_prefix}. Use ONLY these exact tools:
1. {ch_daemon_status_tool}
2. {ch_code_research_tool}
3. {ch_search_tool}
Do NOT use any other chhound namespace, including {excluded_namespaces} — those
index other repositories or review states.

Call {ch_daemon_status_tool}. If query_ready, call {ch_code_research_tool} to
trace "{angle}" end-to-end (callers, state transitions, failure paths,
persistence/version boundaries, tests, correlated sites), then {ch_search_tool}
(regex or semantic) to pinpoint at least one correlated site. Verify every
relevant line with read/grep in {SUBJECT_PATH}. The index may lag {SUBJECT_OID}:
never cite it as evidence and never decide origin from it. Origin requires
`git show {BASE_OID}:<path>`.

If the mapped tool is unavailable, not ready, or errors: make one honest
direct-tree fallback and record the reason; do not substitute another namespace.

Close your output with:

RESEARCH TRACE
mode: chhound-rail | direct-tree
tools-invoked-first-use: <exact names in order>
tool-call-count: <n>
daemon-query-ready: true | false | error
orientation-question: <one line>
pinpoint-query: <type + query, or n/a with reason>
search-log: n/a
search-call-count: n/a
code_research-used: n/a
verified-correlated-sites: <path:line list, or checked-none>
fallback/error: none | <exact reason>
```

### Variant B — no rail index (`research.mode: direct-tree`)

```text
SUBSYSTEM RESEARCH (required — direct-tree)
The manifest records no chhound rail covering this review; mode is direct-tree.
Do NOT invoke any chhound namespace, including {excluded_namespaces} — they
index other repositories or review states. Trace "{angle}" with git diff,
rg/grep, and direct reads in {SUBJECT_PATH}; follow the invariant/concept to
correlated sites beyond the assigned files. Verify origin only with
`git show {BASE_OID}:<path>`.

Close your output with:

RESEARCH TRACE
mode: direct-tree
tools-invoked-first-use: <exact names in order>
tool-call-count: n/a
daemon-query-ready: n/a
orientation-question: n/a
pinpoint-query: n/a
search-log: n/a
search-call-count: n/a
code_research-used: n/a
verified-correlated-sites: <path:line list, or checked-none>
fallback/error: no covering index
```

### Variant C — Vector 3, rail index search-extensive (`research.mode: chhound-rail`)

```text
SEARCH-EXTENSIVE RESEARCH (required — Vector 3)
The subject tree {SUBJECT_PATH} ({owner/repo} at {SUBJECT_OID}) is covered by the
sandbox index bound under prefix {ch_prefix}. Use ONLY these exact tools:
1. {ch_daemon_status_tool}
2. {ch_search_tool}
3. {ch_code_research_tool}   # allowed, never required
Do NOT use any other chhound namespace, including {excluded_namespaces}.

Call {ch_daemon_status_tool} first. If query_ready, lead every owned concept and
lens with {ch_search_tool}:
- regex queries for concrete symbols/patterns (usage sites, imports, duplicated
  literals/keys, version numbers);
- semantic queries for concept-level correlation (touch points for a second
  constraint, sites reading a config key, candidate consumers of a surface);
- iterate: refine queries from hits instead of stopping at the first result.
Minimum: at least TWO distinct search calls per owned concept/lens, and every
repo-wide claim (usage counts, absence of consumers, vocabulary duplication)
must be preceded by a logged search attempt. {ch_code_research_tool} may orient
a concept; it is never required.

Verify every cited line with read/grep in {SUBJECT_PATH}. The index may lag
{SUBJECT_OID}: search results are leads, never evidence. PR-specific vs
pre-existing stays base-diff based (`git show {BASE_OID}:<path>`).

If the mapped tool is unavailable, not ready, or errors: make one honest
direct-tree fallback and record the reason; do not substitute another namespace.

Close your output with:

RESEARCH TRACE
mode: search-extensive | direct-tree
tools-invoked-first-use: <exact names in order>
tool-call-count: <n>
daemon-query-ready: true | false | error
orientation-question: n/a
pinpoint-query: n/a
search-log: <type + query per call, first-use order>
search-call-count: <n>
code_research-used: true | false
verified-correlated-sites: <path:line list, or checked-none>
fallback/error: none | <exact reason>
```

### Preflight sweep child (the symbol map, once per review state)

Before Vector 2, the coordinator spawns one non-vector sweep child with the exact
Symbol sweep recipe (chhound-driver.md, Symbol sweep): subject tree + `{BASE_OID}` /
`{SUBJECT_OID}`, the symbols (or the command that extracts them), the census scope +
command, the exact `{ch_daemon_status_tool}` + `{ch_search_tool}` names or `mode: rg`,
page-size and caps, and the map schema. It returns the bounded **symbol map** —
header (selected / dropped / operator-added symbols, census scope + command,
completion, rail triage marked discovery-only) + the heat table `symbol | change |
total | in-diff | outside | outside locations (capped) | note` — chunk dumps and
pagination stay inside the child; the coordinator writes the map to `{symbol_map_ref}`.
It may reuse the state's changed-range inventory (hash/recipe identity) but still
runs its own census; symbol coverage never clears V1 attribution or vice versa.

### Shadow control (only when the operator opts in)

When the manifest sets `research.shadow: on` for a split, the coordinator additionally spawns one control child with the direct-tree variant (Variant B), prefixed `SHADOW CONTROL — your output is compared for measurement only and excluded from the review.` Its findings never enter aggregation; the comparison lands in the Vector-2/3 compliance record.