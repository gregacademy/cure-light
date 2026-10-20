---
name: cure-light
description: Run a structured three-vector pull-request review — contract-vs-code conformance, implementation bugs, code debt — with a pulled-subject snapshot (one stable tree per review state), spawned fleet passes, and a closure-verification loop. Use when asked to review a GitHub pull request, assess a branch diff, or coordinate a multi-agent code review. Requires git, gh, optional child-agent spawning, and (on pi) the session notebook.
---

# cure-light — PR review pipeline

A **diagnostic review, not a fixer.** cure-light reviews a PR against its own stated contract and the surrounding codebase; it does not modify code. Findings surface as a **single review comment**, drafted only through operator-gated finalization.

**Boot loading is staged** — [references/context-loading.md](references/context-loading.md) is the boot set, stage map and read-once rule. At boot, load only: this SKILL's overview + global operating rules, the stage map, and the runtime pin metadata. The corpus below is fetched to the pinned disk mirror and each document is loaded completely once when its stage starts, then referenced — never a full-corpus read at boot:

1. [references/pipeline-model.md](references/pipeline-model.md) — the 3-vector model, phases, gates
2. [references/intake-and-scope.md](references/intake-and-scope.md) — Phase 0 pull subject + contract
3. [references/conformance-pass.md](references/conformance-pass.md) — Vector 1
4. [references/implementation-pass.md](references/implementation-pass.md) — Vector 2
5. [references/debt-pass.md](references/debt-pass.md) — Vector 3
6. [references/closure-verification.md](references/closure-verification.md) — the re-review loop
7. [references/hygiene-lens.md](references/hygiene-lens.md) — the lens dimension: code-hygiene family, deterministic preflight, lens trail
8. [references/blast-lens.md](references/blast-lens.md) — the `blast` lens (V2-owned: data × call-site blast radius, advisory rows vs blocking instances)
9. [references/yagni-pass.md](references/yagni-pass.md) — the optional over-engineering/YAGNI pass (fresh-context, post-handoff)
10. [references/quality-lens.md](references/quality-lens.md) — the `quality` lens (V3-owned: maintainable shape, suite strength, consistency)
11. [references/evidence-format.md](references/evidence-format.md) — finding schema, severity, origin
12. [references/chhound-driver.md](references/chhound-driver.md) — the chunkhound research rail (pi-chhound plugin): sandbox pull, MCP connect, tool names, the symbol-sweep preflight recipe, discovery-only rule
13. [references/chunker.md](references/chunker.md) — shipped Phase-0 unit chunker, CLI/IO, recipe and limits
14. [references/finding-confirmation.md](references/finding-confirmation.md) — the opt-in finding-confirmation pilot: early selective checks + text-stage draft confirmation, shared verifier binding, delta re-verify

Read [libs/pi-driver/SKILL.md](../libs/pi-driver/SKILL.md) only if this runtime provides the pi session notebook; its references define the requirements check and the notebook plan contract.

## Initialization contract

### 0. Run the quick requirements check (pi runtimes)

If the pi notebook driver applies, run it first per [requirements-check.md](../libs/pi-driver/references/requirements-check.md). Pre-pull rows check gh/git, Node 22+ for the zero-dependency shipped chunker and the pinned mechanical verifier (`kernel/tools/verify.mjs`, exact-byte sha256 + `tool_version` bound to the same source HEAD identity), both prep workflows (`workflows/pack/p0-pack.js`, `workflows/p0/p0-close.js`), notebook availability and the required Phase-0 `#fast` group (P0.2/P0.4 proposers + mechanical verification child). Subject-tree rows defer to the Phase-0 gate; the check completes only then. No census-plugin install, private package credential or plugin identity permission is required. Missing hard requirements pause before fleet cost; never substitute a subject-tree executable or silently change the Phase-0 proposer group. Never start a fleet on an unverified subject.

### 1. Ask the intake fields once

Collect exactly once; never infer defaults for what only the operator can supply:

| Field | Meaning | Example |
|---|---|---|
| `owner/repo` | target repository | `agenticoding/pi-agenticoding` |
| `pr` | pull request number | `27` |
| `vectors` | which vectors to run; yagni optional | `[conformance, implementation, debt]` or `+ yagni` |
| `draft_comment` | whether the pipeline may draft the single aggregated review comment for operator approval (alias: `auto_draft`) | `false` |
| `pauses` | operator checkpoints (default: pause after each vector) | `[per_vector]` |

Ask once. If an operator already answered via a filled `KICKOFF.md`, honor it verbatim.

### 2. Pull the review subject

Pull the tree under review BEFORE any analysis or orientation in the target repo's checkouts: a chunkhound PR sandbox when the rail is live (chhound-driver.md §Presence), else a plain detached worktree (intake-and-scope.md §0.1). Until the pull, pre-pull work is remote-only (`gh repo view` / `gh pr view` / `gh pr diff --name-only`) plus presence probes (chhound-driver.md §Presence); the only pre-pull local git command is the cure-light source provenance capture (intake-and-scope.md, §Output). Whatever SHA the pull has is the **subject** — capture it (`subject_oid` / `subject_path`) into the run manifest at Phase 0. Every fleet child of this review state receives the same subject path + OID. The tree is stable for the whole state — nothing mutates it mid-state; only a deliberate re-pull at an operator gate starts a new review state, which obeys the same subject-first rule and updates the tree **in place** at that boundary (intake-and-scope.md §0.1). A tree that is gone or broken is pulled fresh instead.

### 3. Compile the process

From the intake fields, compile: the vector set and their fleet groups, the phase order and operator gates, the **planned subject mechanism** (chhound sandbox | plain worktree) and its planned location, the notebook pages (run frame + findings), and the output policy (what may be drafted, what waits). The research mode (chhound-rail | direct-tree — pipeline-model.md, research accelerator) is compiled from the planned mechanism and frozen with the frame; if the Phase 0 pull falls back from a planned rail to a plain worktree, the mode is re-recorded as `direct-tree` before Vector 1. Surface the compiled frame to the operator for confirmation before Phase 0 — the pre-pull gate approves the plan; the tree's reality (`subject_path` / `subject_oid`) is recorded at the Phase 0 gate. The sealed frame retains the literal rendered verifier-child contract and `{verifier_command}` template plus the immutable approved plan. Coordinator-owned stage records carry the shipped `kernel/tools/chunker.mjs` path, exact-byte sha256 and recipe, the pinned mechanical verifier's path/sha256/tool_version (both bound to `cure_light_source_head_oid`), P0.2/P0.4 + mechanical-verification `#fast` assignments, artifact refs/hashes, and input/output monitoring budgets; the state head orders these records. Phase-0 input ceiling and retry/re-split policy require an explicit pilot decision. The subject's own `tools/` and demos are reviewed content, never replacements for engine-side process tools.

## Phase order & gates

```text
Intake → Requirements check (pre-pull rows; subject-tree rows defer to Phase 0)
  → [operator gate: frame] — approves the PLAN: subject mechanism (chhound sandbox | plain worktree) + planned location, vectors, gates, output policy; no tree fields yet
  → Phase 0: P0.1 pull + source capture → P0.2 claims (#fast; source-consistency)
    → P0.3 shipped chunker
    → p0-pack prep (host workflow; shell-only, no model turn; promotes claims-list + assignments + instructions)
    → P0.4 join (#fast; compact JSONL; children consume the pack assignments)
    → p0-close prep (host workflow; shell-only, no model turn; promotes join-draft + p05 + envelope)
    → bind the prep receipt's envelope sha256
    → delegated verify join (#fast; single mechanical boundary, after merge prepared)
      (optional diagnostics, never gating: delegated verify claims / delegated verify units — repair-loop localization)
    → P0.5 coordinator semantic gate (consumes the pinned verdict) → capacity-bounded split
    → [gate: subject/base reality, source + claims/unit/join refs/hashes, counts, exclusions/budgets, hard cases; repair defaults to pause before V1]
  → Vector 1 conformance (flash; validate/freeze claims, adjudicate claims, account for all units, finalize UNCLAIMED) → [gate: review_basis + repair status]
  → Deterministic preflight (type/dead + the state's symbol map)
  → Vector 2 implementation (code-review) → [early confirmation (pilot)] → [gate]
  → Vector 3 debt (code-review) → [early confirmation (pilot)] → [gate]
  → Optional yagni pass (code-review; over-engineering/YAGNI — operator-enabled, fresh-context post-handoff) → [gate]
  → Output (one operator-gated review comment; text-stage confirmation (pilot) between drafting and `before_post`) → [closure loop on deliberate re-pull]
```

Each vector is a **fleet pass** with a defined split, per-child prompt contract (assets/child-pass-prompt-template.md), evidence return format (evidence-format.md), and aggregation rule. Truncated or timed-out child output is `inconclusive`, never a pass.

## Coordinator context budget and thinking pilot

Use the operator-approved `context_budget` policy and checkpoint rules in [references/context-loading.md](references/context-loading.md): record resident occupancy separately from emitted/replayed traffic, checkpoint only at safe phase boundaries, and HOLD rather than reduce evidence. Record the immutable frame composition, single-emission/two-transit discipline, byte caps, and section residency in the notebook contract; no cap permits truncation or a synthetic pass.

The operator-sealed coordinator-only allocation uses the higher/current approved level for semantic blocks: source designation, consistency/freeze judgment, V1 attribution/review basis, V2/V3 reconciliation, confirmation disputes, and final wording. Use a supported lower level only for fetching/hashing, field copying, bounded slice selection, rendering, promotion, and receipt bookkeeping. Keep switching recorded and restored before any semantic block; missing capability means retain the approved level or delegate mechanical preparation, never a silent model/group substitution. Fleet and confirmation groups remain unchanged. This is a pilot: if the harness cannot switch between prompts/turns, skip and report no saving. Retained transcript reasoning is not removed.

## Closure verification loop

When the operator says the implementer "worked on the review" (or re-pulls the PR), do NOT re-run the whole pipeline. The re-pull or contract repair is a new review state: update the subject tree in place to the new head (intake-and-scope.md §0.1; a contract-only repair pulls no new code but recaptures the contract), capture the new subject OID, diff the finding-touched paths last-reviewed-subject → new-subject, and classify each finding:

- `verified-fixed` — code + test evidence at old/new lines
- `re-classified` — category/claim changed
- `test-only` — only tests changed; behavior identical
- `doc-only` — only comments/docs changed
- `deferred-decision` — acknowledged but knowingly unfixed (never presented as fixed)
- `closed-by-operator` — operator suppressed it (e.g. "don't re-raise"); auditable, re-openable on new evidence
- `re-opened` — prior proof no longer holds

Publish a closure table. See closure-verification.md.

## Operating rules (short version)

- **Engine executables enter context as hashes, never as source.** Fetch the pinned verifier/chunker to disk at the resolved engine OID and hash the bytes; carry only `{path, sha256, tool_version|recipe}`. The coordinator must never read, search, grep or window their source in its own context. Executing the pinned CLI is not source ingestion. This forbids engine process code, not subject code: when the review subject is cure-light itself, assigned reviewer children inspect subject code as evidence like any other target. Missing `fast` pauses — never substitute a `fast` child, a run-authored script or coordinator reruns for the delegated boundary.
- **Host workflows are shipped engine tooling, read back from the receipt.** The `p0-pack` packing workflow (`workflows/pack/p0-pack.js`) and the `p0-close` prep workflow (`workflows/p0/p0-close.js`) are hash-pinned engine-side host tooling under `workflows/` — the same class as `chunker.mjs` — not run-authored scripts, so invoking them does not violate the run-authored-script prohibition; they enter the coordinator's context as `{path, sha256}` only. Each workflow result is the last `workflow-exit` record in its receipt, never the process exit code (always 0 for a completed run); reason `ok` means the artifacts were promoted, never that they were verified, and `verify join` stays the sole mechanical boundary.
- **Review the pulled subject tree, not the remote tip.** Whatever SHA the pull has is the version reviewed; capture it at Phase 0 and anchor every finding to it.
- **Subject-first: no orientation before the subject pull.** Until Phase 0 pulls the subject, nothing in the target repo's local checkouts is read or used for orientation — per review state (a deliberate re-pull starts a new state under the same rule). Pre-pull access is remote-only plus presence probes (chhound-driver.md §Presence); the only pre-pull local git command is the cure-light source provenance capture.
- **Findings need file:line evidence and a concrete failure mode.** Opinion without evidence does not enter the report.
- **Coverage accounting is not a findings taxonomy.** Vector 1 keeps `EXPLAINED` / `UNCLAIMED` / `EXCLUDED` / `UNRESOLVED` per-unit states in the in-notebook coverage pages; approved exclusions are evidence-linked policy records, and an unread / truncated / disputed range stays `UNRESOLVED` — disclosed, never silently dropped, relabeled, or inferred from a sibling.
- **Unclaimed delivery is blocking.** A confirmed `unclaimed-delivery` finding is in-scope Vector 1 conformance the owner must address in the PR body — declare/justify the delivered behavior or remove it; never demoted to a follow-up. Severity stays LOW default / MED material / never HIGH from the absence of a declaration alone (evidence-format.md).
- **Sources enter the contract only by explicit designation.** The PR body, linked issue or a locked decision must point at any in-diff spec/design material; repo convention interprets a designated package, never authorizes one (intake-and-scope.md §0.2). A material unresolved source contradiction pauses the run before Vector 1 unless the operator records a named evidence-only V1 authorization — and any other `repair_required` defect (missing designation/orientation) defaults to the same repair pause; never a reviewer-reconciled contract.
- **Continuation is a recorded basis, not an accounting side effect.** After Vector 1, the coordinator records `review_basis` (`ready` / `limited-only` / `blocked` / `unknown`) with any outstanding `repair_required` status; ordinary V2/V3 proceeds only from `ready` with no outstanding repair, and `limited-only` proceeds only through an explicit named scope (conformance-pass.md). A basis disposition never relabels findings, and an accepted finding never establishes readiness.
- **Contract repair is a new state.** A body/issue edit with an unchanged subject OID, or an in-diff source edit with unchanged code blobs, starts a new review state with a recaptured contract; reuse only identity-checked unit artifacts, re-adjudicate affected claims — never silently inherit findings (closure-verification.md).
- **Partial coverage is stated honestly.** Mechanical enumeration and accounting are always complete for a complete-coverage claim; semantic residue and any accepted partial review are reported with their limits and require explicit operator acceptance at the gate (conformance-pass.md).
- **Closure discloses coverage gaps.** A closure re-review surfaces newly added unexplained ranges outside finding-touched paths, or states plainly that Vector 1 coverage was not re-run — it never claims new full coverage from old dispositions (closure-verification.md).
- **Pre-existing vs PR-introduced is a first-class classification**, decided by base-diff, not vibes — and scope routes the comment: introduced-or-enforced items are addressed, never deferred downstream; out-of-scope items are only recommended or suggested.
- **Never draft external artifacts automatically.** The single review comment is operator-gated; the `before_post` gate is mandatory whenever drafting is enabled — and in `pilot` mode the text-stage finding confirmation runs **between drafting and the `before_post` gate**, with unresolved items blocking posting absent explicit operator acceptance (finding-confirmation.md).
- **Finding confirmation is an opt-in pilot overlay — no fourth vector.** With `finding_confirmation.mode: pilot`, selected HIGH/thin V2/V3 findings are adversarially confirmed **between vector aggregation and the vector gate**, and the rendered draft is confirmed **between drafting and the `before_post` gate** (finding-confirmation.md). It must preserve the three-vector identity, the frozen fleet groups and `verify.mjs` behavior; it never changes `review_basis`/`repair_required`, never launders absence or `inconclusive` into a pass, and publishes confirmed-only.
- **Deferred is not closed.** Record it in the decisions page with rationale.
- **Phase 0 produces drafts and checked leads, not verdicts.** Sources → claims (`#fast`) → shipped chunker → p0-pack prep (host workflow; shell-only, no model turn; promotes claims-list, assignments and instructions) → join (`#fast`, JSONL; children consume the pack assignments) → p0-close prep (host workflow; shell-only, no model turn; promotes the merged candidate, the p05 records and the envelope) → bind the receipt's envelope sha256 → delegated `verify join` (the single mechanical boundary, after merge prepared; it re-runs the claims and units validators internally as fatal prerequisites) → coordinator P0.5 semantic gate consuming the pinned verdict. Each prep workflow's result is read from its receipt (`pack.receipt` / `prep.receipt`), never from the process exit code. `verify claims` / `verify units` stay available as optional diagnostics (repair-loop localization, per-class receipts) and their absence never gates. The frame binds artifact refs/hashes, the chunker and the verifier pin to the state's source identity. The verifier runs read-only over the run artifacts — no subject read, no git/network, no run-authored checks — and the coordinator never re-implements or reruns the verifier's checks. Pack full claims + whole units by input length only; no unit-count cap or output reservation. Appends are optional, JSONL mandatory; validate exact paths and the complete unit sweep, recover truncation under the approved retry/re-split policy, and disclose residue. P0 emits candidate-unclaimed only; V1 alone finalizes UNCLAIMED after validating/freezing the claims and checking alternate attribution. No canonical plugin IDs, census denominator or gate_check permission remains ([intake-and-scope.md](references/intake-and-scope.md)).
- **Fleets are budgeted and parallel.** Cap children, timeouts, output; a split's compiled children spawn as one concurrent batch, never one child after another, and no coordinator write shares a spawn batch — notebook writes serialize via the coordinator, before the batch or after the returns. Each vector's split is a recorded `fleet_plan` (facet → owner → minimum depth budget) compiled before its children spawn and surfaced at that vector's gate; no facet is folded into another child silently, and any amendment is recorded with a reason ([intake-and-scope.md](references/intake-and-scope.md)).
- **Lens coverage is a frame assertion.** The run frame must map every active lens to an owning pass (lens matrix, see hygiene-lens.md); a lens without an owner blocks the run.
- **Optional passes are opt-in.** The yagni pass (over-engineering of the claimed delivery — not size accounting, yagni-pass.md) runs only when the operator enables it; a skipped pass deactivates its lens (matrix shows `off`, exempt from the coverage assertion).
- **Subsystem research is mandatory-if-ready on the chhound rail.** When the frame's research mode is `chhound-rail`, Vector 2 runs the code-research protocol (implementation-pass.md) and Vector 3 the search-extensive protocol (debt-pass.md): exact registered tool names are rendered into every child prompt, and a missing RESEARCH TRACE footer makes a split `inconclusive`. In `direct-tree` mode (plain worktree) children never invoke a `chh_*` namespace. Shadow splits are off unless the operator opts in.
