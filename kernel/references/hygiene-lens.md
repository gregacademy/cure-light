# hygiene-lens.md — the lens dimension, code-hygiene family

cure-light previously surfaced the code-hygiene family only *operator-driven*: a
finding like "dead variable" or "line too dense to read" appeared when the review
attempted it, not because the pipeline forced it. **Lenses** fix that gap: a lens
is a named, repeatable check with an owning pass and a recorded outcome. Coverage
is proven **per lens**, not per vector.

This reference defines the concept, the current checklists, and the deterministic
preflight accelerator. It is the counterweight to the blanket "no style nits"
rule — hygiene is *mandatory to detect*, but *routed* so it never pollutes the
bug trail.

## What a lens is

A lens cross-cuts the vector model. A vector answers one big question (conformance
/ implementation / debt); a lens answers one small, repeatable one (is this symbol
used? Is this branch reachable? Can a human read this in one pass?). Lenses exist
because the fleet must not be allowed to skip them.

Every lens has:

1. **An owner.** One or more passes (or the deterministic preflight sweep)
   whose split explicitly exercises it. If no pass owns a lens, the run frame is
   malformed — the coordinator must not proceed.
2. **A checklist** of what counts as a hit and what is explicitly dismissed.
3. **A route**: where hits go (the lens trail) and their default severity.
4. **A determinism hint** — whether a mechanical detector can do the check cheaper
   than a model's opinion (see below).

## The code-hygiene family

Started with the family our stage-2 comparison showed we logged but never covered
systematically:

| Lens | Checklist (hit = cite file:line) | Dismiss (NOT-A-HIT) | Default severity | Determinism |
|---|---|---|---|---|
| `type` | strict-tsc / lint class: unused locals & params surfacing as compiler errors, unchecked index/parse looseness, unsafe casts, any TS4xxx the repo's own config would flag | checked-and-clean → NOT-A-HIT | LOW | high — run the repo's own compiler/lint |
| `dead` | dead code & unused surface: unused imports, unused locals/params, unreachable branches, exported symbols the PR leaves un-consumed, dead config/keys, commented-out blocks | checked-and-clean → NOT-A-HIT; a deliberate public/exported symbol or a host-invoked/config-driven surface the PR intends | dead → LOW, reachable → MED | high (unused-symbol sweep) |
| `read` | readability / statement density: a one-line block with side effects, >1 behavior packed into a single expression, over-nesting past obvious, magic literals at-use sites, a branch whose intent is not spottable in a glance | a deliberate compact idiom the repo already uses elsewhere | LOW | low (taste) |
| `name` | vocabulary drift: a newly introduced name colliding with or shadowing the repo's own source-of-truth term, a param/var that lies about its shape | naming that matches the repo's own convention | LOW | low (taste) |
| `quality` | maintainable shape + suite strength + consistency: big decision trees that outgrew their shape, coverage-without-assurance, error-handling drift, duplication — four sub-checks with a which-pattern-fits judgment, see [quality-lens.md](quality-lens.md) | a shape whose alternative would be more complex; a demonstrated gap owned by V1/V2/V3-debt (link, don't duplicate) | LOW; MED when the problem's own scale is material | low (taste) |

The family is open-ended; `quality` already carries the suite-strength and
shape checks, and the reserved `test` / `security` schema slots remain
available for a future split (e.g. a dedicated security lens). The matrix is
rendered in the run frame so a future expansion is audited. Lenses with their
own references: [quality-lens.md](quality-lens.md) (V3) and
[blast-lens.md](blast-lens.md) (V2, data × call-site blast radius).

## Deterministic preflight (mechanical accelerator)

For the mechanical lenses (`type`, `dead` in a typed repo) the fleet does not
guess. Where cheap and self-hosted, the review runs the **repo's own toolchain**
against the subject tree and cites the output verbatim:

- a TS repo: run its **own** configured strictness (`tsc` with the repo's
  `tsconfig` flags, including `noUnusedLocals` / `noUnusedParameters` where the
  repo already sets them), or the project's own lint/format check
  (`eslint`, `biome`, `dprint --check`, ...)
- a repo without a cheap runner: fall back to static inspection, flagged
  `inconclusive-mechanical` in the lens outcome — never a silent skip.

Rules — **mechanical preflight for `type` / `dead`**; taste lenses
(`read`, `name`, `quality`) have **no config/tool gate** — they run on the
fleet's best absolute judgment, and hits are pushback-able per instance (see
quality-lens.md for `quality`):

1. **Reuse the repo's config**, never invent a stricter one the PR never
   promised. If the repo ships its own strict flags, that is the conformance
   intent going through the `type` lens.
2. **Never install or auto-build.** If it cannot run in seconds on the subject
   tree, mark the lens `inconclusive-mechanical` and do it by static sight.
3. **Compiler hits are evidence, not guilt.** A flag may be a deliberate
   public/exported symbol (public API) or a config line the PR didn't touch — classify
   with the same base-diff rule as any finding.

## Routing: the lens trail

Findings that are hygiene, not bug, go to a **lens trail** — a distinct section on
the findings page, not the bug/debt table:

- Detection is **mandatory**. A lens not checked is a run-frame error, not a
  "nothing found".
- A hygiene finding is **LOW by default**; it may be escalated to MED only when a
  "dead-looking" symbol is actually a reachable live surface and its removal would
  change behavior.
- The **`quality` lens has its own MED exception** (quality-lens.md): rated by
  the scale of the quality problem itself — never by product criticality —
  never HIGH, suggestion-only.
- The operator may suppress individual lens hits (recorded `closed-by-operator`),
  but never the lens itself. Deterministic `type`/`dead` hits are surfaced to the
  implementer with the mechanical citation — opinion is not the basis.
- **finding confirmation (pilot) exclusion.** Pure lens-trail rows (hygiene
  included) are never confirmation targets (finding-confirmation.md); a lens hit is
  not a bug/debt finding, and confirmation never converts one.

## Cross-cutting rules

1. **A lens is not a vector.** It never blocks Vector 2/3 gating by itself; it is
   recorded and reported, and its hits are operator-suppressible per instance.
2. **Per-lens coverage is a frame assertion.** The run manifest lists each lens
   and its owning pass (see pipeline-model.md). If any **active** lens lacks an
   owner, the run does not start; lenses owned by a skipped optional pass (yagni)
   are inactive (`off` in the matrix) and need no owner.
3. **Cheap and always.** Lenses are budget-minimal by design; they are the reason
   the pipeline can promise "every PR gets its hygiene swept" without fleet
   inflation.
4. **Escalation stays honest.** A truly mechanical `type` hit cited from a compiler
   is stronger evidence than a flavor; the trail says which hits are mechanical and
   which are taste.