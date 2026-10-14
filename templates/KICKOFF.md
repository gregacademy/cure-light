# KICKOFF — cure-light episode template

> Fill the fields below (or answer them the first time the process asks), then
> paste the bootstrap prompt into a fresh session. The kernel asks each field
> once and never infers a default for what only the operator can supply.

## 1. Target repository (`owner/repo`)

```
<owner/repo, e.g. agenticoding/pi-agenticoding>
```

## 2. Pull request number (`pr`)

```
<number, e.g. 27>
```

## 3. Vectors to run

- [x] Conformance (are the PR's claims delivered and every changed unit accounted for?)
- [x] Implementation bugs (does the shipped code work?)
- [x] Code debt (is the way it's built sustainable?)
- [ ] Yagni — optional pass (is the engineering used to deliver the claimed behavior over-built? any YAGNI?)
- [ ] Subset only: <list which>

## 4. Fleet groups (if this runtime provides the model-groups plugin)

- Phase-0 claims, join and mechanical verification: `fast` only (pause if unavailable; no substitution)
- Conformance: `flash` only (pause if unavailable; no substitution)
- Implementation: `code-review`
- Debt: `code-review`
- Yagni (if enabled): `code-review`

Required groups are binding: a group that is absent or degenerate (present but cannot resolve to a usable model/group) pauses the affected stage — no substitution (no inherited parent, `planner`/`coder`, or other group).

## 4b. Finding confirmation (opt-in pilot)

- [ ] Enable finding confirmation (`finding_confirmation.mode: off | pilot`) — independent adversarial checks of selected HIGH/thin V2/V3 findings (pre-gate) and of the rendered draft (pre-`before_post`); confirmed-only publication, no fourth vector (finding-confirmation.md)

## 5. Draft policy (never auto-post otherwise)

> Finalization = one aggregated review comment per run (summary, findings,
> suggested follow-up issues, footer). Potential issues are suggested inside it
> — the developer opens them; gh issue bodies are never drafted.

```
draft_comment: [false]   # review-only; draft the single review comment on explicit request
```

## 6. Pauses / operator gates

> Default: pause after each vector (`per_vector`). Tick any extra checkpoints you want.

**Mandatory gates (not checkboxes):**

- **Frame confirmation** — the frame is compiled unsealed, shown, and **waits for your explicit frame confirmation** before it is written, read back, and sealed/handed off (notebook-plan-contract.md).
- **Strict gate receipts** (opt-in; only when the host provides them) — later gates answer `{decision, frame_sha, decision_ref}`: `frame_sha` is the approved-plan SHA (never the engine commit or a mirror `frame.json` SHA), and `decision_ref` resolves the host-side immutable decision record. A missing, malformed, stale, replayed or wrong-gate receipt, or an unreadable ref, holds the gate at HOLD/error — never the generic auto-approval fallback. The first frame keeps the explicit confirmation above.
- **Before post** — **enforced** whenever `draft_comment` is enabled.
- **Repair pause** — a material unresolved contradiction between captured sources, or any other `repair_required` defect (missing designation/orientation included), pauses the run **before Vector 1**; continuing takes your explicit recorded `repair_required.continuation` mode (an evidence-only V1 run or an explicitly limited V1-only review), and neither clears the defect nor authorizes ordinary downstream work.

Optional pauses:

```
- [x] after each vector
- [ ] after closure re-review
```

## 7. Chhound rail (only when the pi-chhound plugin is present)

```
- [x] chunkhound PR sandbox as the review subject (recommended; plain worktree otherwise)
```

If checked and the rail is detected as installed, expect the coordinator to probe and
drive it itself (`ch-chhound`; consent prompts on the sandbox create/connect). Where model
tools are unavailable, expect one fallback request: run `/ch-status` at the frame gate and
report the output.

---

## 8. Phase-0 prerequisites and expectations

- **Engine tools**: Node 22+ and git, plus the zero-dependency `kernel/tools/chunker.mjs` and the pinned mechanical verifier `kernel/tools/verify.mjs` shipped with cure-light. The sealed frame stays immutable; its stage record records the chunker's path/exact-byte sha256/recipe and the verifier's path/sha256/tool_version at `cure_light_source_head_oid`; never run a subject-tree copy or a run-authored verification script. No census-plugin install or private-package credential is required. Engine identity is hash-only: executable source is fetched to disk at the resolved engine OID and hashed, and it is never printed or read into context (`kernel/references/context-loading.md` boot set).
- **Sequence**: capture source bytes → `#fast` claims (`claims-draft/3`, including source consistency) → chunker units → `#fast` witnessed join JSONL → delegated `fast` mechanical verification (`verify join`, the single boundary) after the merged candidate is prepared → coordinator P0.5 semantic gate consuming the pinned verdict. The single `verify join` invocation re-runs the claims and units validators internally as fatal prerequisites. That gate is not a second semantic gate: the `fast` child runs the pinned tool read-only and returns the verdict verbatim, and the coordinator never re-implements or reruns its checks. A nonzero, stale or mismatched verdict fails the mechanical boundary. `verify claims` / `verify units` remain available as optional diagnostics (repair-loop localization, per-class receipts) and never gate. `run-manifest.json` generation is coordinator prep via `verify envelope` (recording, not verification); the envelope sha256 is frozen in the frame before verification, and the mechanical verification itself remains delegated `fast`.
- **Packing/output**: full claims + whole units, in manifest order, bounded by input length only; no unit-count cap or output reservation. JSONL on disk is mandatory, appends optional. The gate checks the exact output paths and complete unit sweep, IDs/pairs/types/witnesses and recorded budgets; truncation is retried/re-split under the approved policy, never treated as “no match”. Reviewer/proposer terminal returns are bounded at 4096 UTF-8 bytes (`assets/child-pass-prompt-template.md`, bounded return transport); the mechanical verifier verdict stays verbatim and untruncated.
- **Authority**: draft links mean “look here”, never “this works”. Verification proves artifact mechanics only, never claim correctness. Phase 0 emits candidate-unclaimed only; V1 validates/freezes claims against captured sources, accounts for all units and alone finalizes UNCLAIMED. Material contradictions or missing designation still default to the repair pause before V1.
- **Notebook dedup**: the verbatim contract is written once per review state and later referenced with pins/counts; no prose restatement in every spawn or notebook update.
- **Open pilot checkpoints**: the operator-approved input ceiling stays a decision, while the witness bound (160), one retry, halves and depth ≤ 1 are recorded envelope constants; the byte output ceiling is monitoring-only unless declared — never convert bytes to tokens. Suite-level claim handling, possible `medium` tightening and the detailed V1 contract remain open; do not infer any of these from a simulation's numeric budget.
- **Coordinator context budget**: apply the operator-approved `context_budget` policy in `kernel/references/context-loading.md`: record resident occupancy and emitted/replayed traffic separately; use its soft checkpoints and hard HOLDs; never cut evidence to fit. The seal is immutable and composes with bounded stage records and a state head; record single emission, UTF-8 caps and active-section residency in `notebook-plan-contract.md`.
- **Coordinator thinking pilot**: use the operator-sealed coordinator-only allocation. Use the supported lower level only for fetching/hashing, field copying, bounded slice selection, rendering, promotion and receipt bookkeeping; restore the higher/current approved level for source designation, consistency/freeze judgment, V1 attribution/review basis, V2/V3 reconciliation, confirmation disputes and final wording. Record switching and restore it before semantic work. Missing capability means retain the approved level or delegate mechanical preparation, never silently substitute a model/group. Fleet and confirmation groups unchanged. If the harness cannot switch between prompts/turns, skip and report no saving; retained transcript reasoning is not removed.

---

## Bootstrap prompt (paste into the first session)

> Boot a cure-light PR review episode from the remote manifest at
> `https://raw.githubusercontent.com/grzegorznowak/cure-light/main/BOOTSTRAP.md`
> Fetch the manifest, follow its instructions exactly: fetch every listed file
> as raw markdown (no summarization, preserve bytes), report each file's line
> count, run the quick requirements check, ask the intake fields once (owner/
> repo, PR number, vectors, draft policy), compile the run plan unsealed and
> show the compiled frame (with the requirements result) for explicit
> confirmation, wait for that confirmation, then write + read back the frame and
> findings skeleton and — because this runtime provides the pi notebook +
> handoff — seal the compiled frame and hand off so the next context kicks off
> Phase 0 (pull subject + contract) then Vector 1. No clone or install.

## What happens next (expectation set)

1. The agent fetches the corpus to the pinned disk mirror, loads only the boot set (`kernel/references/context-loading.md`), and reports line counts.
2. It runs the quick requirements check (gh auth, repo, PR OID, planned subject mechanism, Node/git + shipped chunker and pinned-verifier identity, Phase-0 fast availability (proposers + mechanical verification), notebook, groups — the subject-tree rows defer to Phase 0).
3. It asks the intake fields **once** — usually nothing is missing if KICKOFF is filled.
4. It compiles the run frame unsealed and shows it for the operator's explicit confirmation — it waits there.
5. On the operator's explicit confirmation, it writes and reads back the frame + findings pages, and (if the runtime provides handoff) seals and hands off.
6. Phase 0 runs in the new context: pull the subject first; capture the verbatim contract (`contract-<owner>-<pr>-s<n>` on pi, disk fallback otherwise) and source refs/hashes; draft claims with `#fast` including source-consistency work; run the shipped chunker; propose links with `#fast` into per-box JSONL; delegate `fast` mechanical verification (`verify join`, the single boundary; optional `verify claims|units` diagnostics on demand) and run the coordinator P0.5 semantic gate against its pinned verdict; compile the capacity-bounded vector splits and record the V1 `fleet_plan` (shards × facets × depth budgets) in its bounded stage record. Record subject/base OIDs, changed files, chunker identity, the verifier pin, the join verdict ref/hash/exit code (plus any optional diagnostic verdicts), claims/unit/join refs/hashes, counts, hard cases, exclusions and budgets; complete deferred requirement rows and show the Phase-0 gate. `repair_required` defaults to pause before V1 unless you authorize the existing named, bounded exception. Notebook-less fallback still lacks the authoritative V1 claim/coverage/gate-disposition store and cannot assert complete coverage or readiness.
7. Vector 1 (conformance — validate/freeze claims, adjudicate claims, account for all units and finalize UNCLAIMED) fleets out; report; gate — the coordinator records the review basis (`ready` / `limited-only` / `blocked` / `unknown`) and any outstanding repair requirement before Vector 2 may be planned. Then the deterministic preflight (symbol map), Vector 2, Vector 3, then output.
8. On "the implementer worked on the review", the closure loop re-validates per finding and publishes the table.