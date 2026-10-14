---
name: cure-light-pi-driver
description: Binds the cure-light PR review pipeline to the pi session notebook, handoff, and model-groups plugin. Use after fetching the cure-light kernel when this runtime provides the pi notebook; runs the quick requirements check, compiles the run plan, shows it for explicit operator confirmation, then writes the notebook pages and seals via handoff for the kickoff context. Requires pi with notebook_index/notebook_read/notebook_write/handoff/spawn; optional model-groups plugin for fleet groups.
---

# cure-light pi driver

The pi binding for the cure-light pipeline. It answers two questions the kernel deliberately leaves to the runtime:

1. **Can this runtime run the fleet at all?** (requirements check)
2. **Where does the review state live between phases and across handoff?** (notebook plan contract)

## When to read

Boot per the stage map (`kernel/references/context-loading.md`): this skill and `references/requirements-check.md` are the pi boot set and are read in full before any preflight; `references/notebook-plan-contract.md` is loaded at the frame/intake compile stage. Later stages load only their active documents — never the whole corpus at boot. The coordinator never ingests executable source: the verifier/chunker are fetched hash-only to disk and enter context as pins (`{path, sha256, tool_version|recipe}`). Do not restate the contract page's prose in every spawn or notebook update — reference it by name with pins/counts.

## Boot sequence (pi)

1. Run the **quick requirements check** — `references/requirements-check.md`.
2. Ask the intake fields once (owner/repo, pr, vectors, draft_comment, pauses) — from the kernel's initialization contract.
3. **Compile the run frame** (held unsealed) per `references/notebook-plan-contract.md`: `pipeline-frame-<owner>-<pr>-s<n>` (frozen options + **planned subject mechanism** — chhound sandbox | plain worktree; no tree fields yet) + `pr-<n>-review` (findings skeleton), and **show the compiled frame to the operator**. `subject_path` / `subject_oid` are recorded into the frame at the Phase 0 gate, once the pull lands.
4. **Wait for the operator's explicit frame confirmation.** Do not write, read back or seal before it.
5. On confirmation, **write the frame + findings skeleton and read both back**, then — when `handoff` is available — seal the compiled frame and hand off with the kickoff instruction so the next context resumes from the sealed compile without re-reading the kernel. Only call `handoff` if this runtime actually provides it; otherwise continue in-session (the notebook pages still carry the state).

## Runtime assumptions (verify, don't assume)

- The **model-groups plugin** may or may not be present. Fleet groups (`flash`, `code-review`, …) exist only when it is. Check `pi.tools`/group list once. **Required groups are binding:** a required group that is absent or degenerate (present but cannot resolve to a usable model/group) **pauses the affected stage** — no substitution: no inherited parent, no `planner`/`coder`, no other group, for any stage, and no serialized-pass fallback. Pin the declared group on each Phase-0 claims/join and vector child — P0.2/P0.4 `fast`, Vector 1 `flash`, Vectors 2/3 `code-review`, and opt-in yagni `code-review` (templates/KICKOFF.md §4). Never use an unpinned spawn that silently inherits the coordinator's model.
- **Parallel spawn batches (pi).** Pi executes one assistant message's tool calls in parallel only when no call in the batch is `executionMode: "sequential"`; a single sequential-mode tool (notably `notebook_write` and `handoff`) makes the runner execute the whole batch call-by-call. Issue a split's spawn calls in their own message, with no other tool calls: mixing a notebook write into the spawn message serializes the fleet (a live two-worker V2 pass ran back-to-back ≈690 s where spawn-only batches overlapped ≈350 s). Coordinator writes go before the spawn batch or after the returns.
- The **chhound** rail (pi-chhound plugin) may or may not be available. When it is live (chhound-driver.md §Presence), Phase 0 pulls the subject as a chunkhound PR sandbox and the connection exposes the `chh_*` tools to the session — the research rail for coordinator and children. Otherwise, git + bash + the repo itself are the always-available evidence base. Never block on a missing/broken rail — fall back to `git diff`/`rg`.
- **Research enforcement (pi)**: when `research.mode: chhound-rail`, render the frame's exact registered tool names (`{ch_prefix}_daemon_status` / `_code_research` / `_search`) into every Vector-2/3 child's `{research_protocol}` slot (Variant A / Variant C in child-pass-prompt-template.md) — never generic aliases. Check each child's RESEARCH TRACE footer at the vector gate: missing/noncompliant trace = `inconclusive`, rerun once with the corrected rendered prompt, then operator gate. Traces are self-report — no child telemetry exists — so audit claimed `verified-correlated-sites` against the subject tree at `subject_oid`.
- **notebook** is the shared memory, not a database: no CAS, no audit — the plan contract is about page naming and ownership, not durability guarantees.
- **Finding confirmation (pilot).** When the frame sets `finding_confirmation.mode: pilot`, spawn one fresh confirmation child per cluster with the approved `code-review` binding — never a producer/co-producer, never an unpinned spawn. Record producer/confirmer IDs and family or `unknown` (never inferred from group names). Confirmation writes go only to the child-exclusive artifact; the coordinator owns the confirmation trail. Blindness is prompt-level only — never claim host isolation, and do not advertise sandbox-enforced blindness.

## Durability note (mirrors PhormOS)

The notebook advertises replay convenience, not a durability claim. The run frame and findings survive turns/compaction/handoff in the same pi installation; a fresh machine with no notebook history starts a new run (the manifest's subject OID in the frame is the continuity anchor, not the notebook).