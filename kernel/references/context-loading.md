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

Load each required section completely once per surviving context, then reference it afterwards. Identity key: `(OID, path, section range/hash, generation)` — equivalently `(engine OID, relative path, section range/hash, context generation)`. Track a small loaded-doc index (path + range/hash), not a content copy. Compaction or handoff loses residency: the successor reloads ONLY its active required stage documents from the pinned mirror and never pretends page refs or a summary equal the normative text. An engine OID change invalidates the load cache. Minimal compile extracts do not replace stage execution reads.

### Section-residency inventory

Before each stage, record an explicit active-section ranges/hash inventory: `{OID, path, section range, section hash, generation}` for every required section. On rehydration, rehydrate only complete active required sections and enforce the approved `(OID, path, section range/hash, generation)` load identity. A changed engine OID invalidates the cache: the engine OID change invalidates the cache. The V1 inventory contains only the vector template + invariants + coverage sections named in the stage map; **Do not read all 551 template lines during V1.** A section reference or a summary is not a substitute for the complete required section.

## Coordinator `context_budget` policy (pilot)

This policy is operator-approved, NOT global defaults; it is a pilot allocation for a ~1M window. It belongs to the semantic frame; the operator approves values, the coordinator records phases/checkpoints, and the harness observes usage. These are pilot allocation choices for a ~1M window, not quality quotas or verifier limits. Smaller windows need operator-scaled values. The seal policy includes absolute tokens and the actual model window.

| Logical stage / segment | Target | Soft checkpoint | Hard HOLD |
|---|---:|---:|---:|
| Boot + frame compile/seal | ≤60K | 60K | 75K |
| P0 preparation/join/gate | ≤130K | 150K | 180K |
| V1 setup/freeze/dispatch/terminal receipts | ≤120K | 130K | 160K |
| V1 reconciliation + ledger + vector gate, after resume when needed | ≤110K | 120K | 150K |
| Preflight + V2, including enabled early confirmation | ≤110K | 120K | 150K |
| V3, including enabled early confirmation | ≤110K | 120K | 150K |
| Optional yagni | ≤90K | 100K | 130K |
| Output/draft + enabled text confirmation | ≤90K | 100K | 130K |
| Closure state/delta cycle | ≤110K | 120K | 150K |

### Meters, thresholds, and receipts

Keep two separate meters:

1. **Resident occupancy:** latest request `input + cacheRead + cacheWrite`; record its peak per logical phase and context generation.
2. **Emitted/replayed traffic:** phase-added content/transport plus total coordinator request traffic and output/thinking usage, across ALL generations.

Prefer actual provider usage. Label char/4 estimates explicitly. Child `details.stats` is not parent context; a context reset does not eliminate emitted bytes, and an occupancy reset is not a content saving.

At the soft threshold, finish the current block, stop starting new large blocks, write a checkpoint. At the hard threshold, HOLD, only bounded checkpoint/error reporting. An exceeded target is a recorded exception/continuation segment, never evidence truncation, dropped work, or manufacturing pass/partial-coverage acceptance. The operator can extend a named budget or authorize handoff. A docs rule is not a pre-ingestion firewall: report overshoots honestly.

A phase receipt records: phase, generation, peak, context before/after checkpoint, engine/state identity, warnings/exceptions, next-task refs. Retain raw metrics outside the notebook.

### Safe checkpoint placement

Preserve seal→P0 and P0→V1. Add a P0 checkpoint after source/claims/unit preparation and before join dispatch; carry pending failures explicitly. Make the V1 checkpoint after all terminal fleet receipts and before reconciliation/materialization. V2/V3 may checkpoint between fleet collection and confirmation/aggregation; output checkpoints are between version rounds; closure checkpoints follow durable delta inputs. Never hand off during an unresolved spawn batch; parallel spawn-only batching stays binding.

On continuity, a same-state handoff never re-pulls/rebuilds the subject or inherits a fresh semantic verdict. The 20–35K reload is an allocation estimate; report reload cost separately, never as a content saving. It reloads active normative sections and bounded state records, then still consumes all required evidence.
