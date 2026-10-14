# cure-light — Remote Boot

Boot a **cure-light PR review episode** without cloning or installing anything locally. Everything resolves against `main`.

## Raw base

```text
RAW_BASE = https://raw.githubusercontent.com/grzegorznowak/cure-light/main
```

## Files to fetch

These seed the session so it can compile the review process. Fetch them in order as **raw** markdown — preserve every byte, never use a summarizer or paraphrase.

### Kernel (the review method)

1. `$RAW_BASE/kernel/SKILL.md`
2. `$RAW_BASE/kernel/references/pipeline-model.md`
3. `$RAW_BASE/kernel/references/intake-and-scope.md`
4. `$RAW_BASE/kernel/references/conformance-pass.md`
5. `$RAW_BASE/kernel/references/implementation-pass.md`
6. `$RAW_BASE/kernel/references/debt-pass.md`
7. `$RAW_BASE/kernel/references/closure-verification.md`
8. `$RAW_BASE/kernel/references/hygiene-lens.md` — the lens dimension (code-hygiene family, deterministic preflight, lens trail)
9. `$RAW_BASE/kernel/references/blast-lens.md` — the `blast` lens (V2-owned: data × call-site blast radius, advisory rows vs blocking instances)
10. `$RAW_BASE/kernel/references/yagni-pass.md` — the optional over-engineering/YAGNI pass (fresh-context, post-handoff)
11. `$RAW_BASE/kernel/references/quality-lens.md` — the `quality` lens (V3-owned: maintainable shape, suite strength, consistency)
12. `$RAW_BASE/kernel/references/chhound-driver.md` — the chunkhound research rail (pi-chhound plugin): model-tool setup (`ch-chhound`), sandbox pull, MCP connect, tool names, the symbol-sweep preflight recipe, discovery-only rule
13. `$RAW_BASE/kernel/references/evidence-format.md`
14. `$RAW_BASE/kernel/references/context-loading.md` — boot set + stage map + read-once rule
15. `$RAW_BASE/kernel/references/artifact-contracts.md` — recorded artifact field contracts + repair map
16. `$RAW_BASE/kernel/references/chunker.md` — the shipped Phase-0 unit chunker (CLI/IO, recipe, limits)
17. `$RAW_BASE/kernel/references/finding-confirmation.md` — the opt-in finding-confirmation pilot (early selective + text-stage checks)

### Pi driver (notebook + handoff + model-groups binding — only if this runtime provides the pi notebook)

18. `$RAW_BASE/libs/pi-driver/SKILL.md`
19. `$RAW_BASE/libs/pi-driver/references/requirements-check.md`
20. `$RAW_BASE/libs/pi-driver/references/notebook-plan-contract.md`

### Templates / assets (keep for reference during the episode)

21. `$RAW_BASE/templates/KICKOFF.md`
22. `$RAW_BASE/assets/finding-schema.json`
23. `$RAW_BASE/assets/child-pass-prompt-template.md`

### Worked example (optional, read after compiling the process)

24. `$RAW_BASE/docs/example-review.md`

## Fetching rules

- Use `curl -sL <url>` or an equivalent raw-download tool.
- Do **not** summarize, paraphrase, or truncate. The kernel text is normative.
- Hold the fetched text in a scratch location you can re-read during the session.
- Report `file: <line-count>` for every file before proceeding.
- The Phase-0 engine executables — `$RAW_BASE/kernel/tools/chunker.mjs` and the pinned mechanical verifier `$RAW_BASE/kernel/tools/verify.mjs` — must be fetched as exact raw bytes (never markdown-normalized), and each sha256 recorded at fetch time together with the verifier path and `tool_version`, before the Phase-0 run. Fetch executables from the immutable resolved `cure_light_source_head_oid` raw URL, not a moving `main` after freeze. Resolve the actual source identity or stop the executable gate: a raw `main` URL does not by itself prove the OID. The existing remote-boot source-binding checkpoint for the wider docs fetch stands; no install and no test/fixture fetch is needed.
- **Executable fetching is hash-only.** Fetch the two engine executables as exact bytes to disk at the immutable resolved `cure_light_source_head_oid`, compute their sha256 there, and bring back only metadata: `{path, sha256, tool_version}` for the verifier and `{path, sha256, recipe}` for the chunker. There is no windowed printing of executable source — no `cat`, `read`, `head`, `tail` or any window over the bytes — and no version extracted by reading or executing the script. An expected no-command exit 2 is a version smoke/usage refusal, never a verification pass.
- **Fetching to disk is not loading into context.** The fetched corpus lives on the pinned disk mirror; only the boot set and each active stage's documents (`kernel/references/context-loading.md`, `kernel/references/artifact-contracts.md` when preparing artifacts) enter model context. No full-corpus read at boot.

## After fetching

1. Run the **quick requirements check** (pi-driver `requirements-check.md`) — pre-pull rows only; the subject-tree rows (5/8/9) defer to the Phase 0 gate, where the check completes.
2. Ask the **intake fields once** (from `KICKOFF.md` — see below for the field list).
3. Compile the run frame (frozen options + planned subject mechanism — no tree fields yet; held unsealed) and show the compiled frame with the requirements-check result to the operator.
4. **Wait for the operator's explicit frame confirmation.** Do not write, read back or seal before it.
5. On confirmation, write the frame page + findings skeleton and read both back (notebook-plan-contract.md), then — if `handoff` is available in this runtime — seal the compiled frame and hand off so the next context starts from the sealed compile, pulls the subject (the first tree read — no local target checkout is read before it), records `subject_path` / `subject_oid` at the Phase 0 gate, and runs **Phase 0 → Vector 1**. Else continue in-session.

## Bootstrap prompt (paste into a fresh session)

> Boot a cure-light PR review episode from the remote manifest at
> `https://raw.githubusercontent.com/grzegorznowak/cure-light/main/BOOTSTRAP.md`
> Fetch the manifest, then follow its instructions exactly: fetch the listed
> files as raw markdown (no summarization, preserve bytes), report each file's
> line count, run the quick requirements check, ask the intake fields once
> (owner/repo, PR number, vectors, auto-draft policy — from KICKOFF.md), compile
> the run plan unsealed and show the compiled frame (with the requirements
> result) for explicit confirmation, wait for that confirmation, then write +
> read back the frame and findings skeleton and — because this runtime provides
> the pi notebook + handoff — seal the compiled frame and hand off so the next
> context kicks off Phase 0 (pull subject + contract) then Vector 1. No clone
> or install.