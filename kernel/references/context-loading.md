# context-loading.md — boot set, stage map, read-once rule

Fresh-context loading policy. Fetching every document to a pinned disk mirror is expected; fetching a document to disk is not loading it into model context. Only the boot set enters context before intake; each later document is loaded completely when its stage starts — and only then.

## Boot set (pre-intake)

- `BOOTSTRAP.md` — overview and inventory (the fetch list).
- `kernel/SKILL.md` — overview + global operating rules.
- `kernel/references/context-loading.md` — this stage map.
- Runtime pin metadata: the runtime frame's identity/files-hashes projection + FRAME-NOTE where provided.
- On pi additionally: `libs/pi-driver/SKILL.md` and `libs/pi-driver/references/requirements-check.md` in full before any preflight.

"Overview + stage map + hashes" is not permission to skip preflight; these short runtime documents are mandatory boot prerequisites. There is no full pipeline/vector/intake/child/lens/example corpus at boot. Engine executables are disk-only (`BOOTSTRAP.md` hash-only fetching). All documents may be prefetched byte-exact to disk; only active documents enter context.

## Stage map

Nothing outside the active stage's row is loaded at that stage.

| Stage | Additional required reads | Notes |
|---|---|---|
| Frame/intake compile, before showing the proposal | `templates/KICKOFF.md`; `kernel/references/pipeline-model.md`; `libs/pi-driver/references/notebook-plan-contract.md`; the mechanical-verification-child subsection of `assets/child-pass-prompt-template.md` verbatim | the literal rendered contract is mandatory at seal; `kernel/references/chhound-driver.md` Presence section only when presence/rail is being evaluated; preserve operator confirmation BEFORE notebook frame/skeleton write/readback/seal; no subject read pre-pull |
| Phase 0, before work | `kernel/references/intake-and-scope.md`; `kernel/references/chunker.md`; `kernel/references/artifact-contracts.md`; the P0 child sections of `assets/child-pass-prompt-template.md` | load `kernel/references/conformance-pass.md` before the capacity-bound V1 split compile at the Phase-0 gate (earlier than V1 execution); rail pull section when relevant |
| V1 | `kernel/references/conformance-pass.md`; `kernel/references/evidence-format.md`; `assets/finding-schema.json`; applicable `kernel/references/hygiene-lens.md`; the vector template + invariants + coverage sections of `assets/child-pass-prompt-template.md` | captured source and validated-universe access remain mandatory |
| V2 | `kernel/references/implementation-pass.md`; `kernel/references/blast-lens.md`; hygiene if not resident; the symbol sweep/research/fallback sections of `kernel/references/chhound-driver.md` even for the direct-tree recipe; template Variant A/review checks; bounded prior projections | read actual source evidence normally |
| V3 | `kernel/references/debt-pass.md`; `kernel/references/quality-lens.md`; needed hygiene/research sections; template Variant C; bounded V1/V2 projections | the independent lead thread is unchanged |
| Optional yagni | `kernel/references/yagni-pass.md` plus its template slots and required evidence/lens refs | only if the operator selected the pass |
| Output/drafting | `kernel/references/finding-confirmation.md` + `kernel/references/evidence-format.md` if not resident | text-stage confirmation between drafting and `before_post`; early confirmation checks load `kernel/references/finding-confirmation.md` at each vector's own stage |
| Closure | `kernel/references/closure-verification.md`; `kernel/references/evidence-format.md` if not resident | `docs/example-review.md` is optional on explicit need, never compulsory boot |

## Read-once rule

Load each required section completely once per surviving context, then reference it afterwards. Identity key: (engine OID, relative path, section range/hash, context generation). Track a small loaded-doc index (path + range/hash), not a content copy. Compaction or handoff loses residency: the successor reloads ONLY its active required stage documents from the pinned mirror and never pretends page refs or a summary equal the normative text. An engine OID change invalidates the load cache. Minimal compile extracts do not replace stage execution reads.
