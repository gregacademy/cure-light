# workflows/p0 — Phase 0 mechanical workflows

`p0-close.js` (not implemented yet) will merge the box JSONL outputs into `join-draft/1`,
validate coverage/links/witnesses, write the per-box p05 records, and generate the frozen
`run-verification/1` envelope with the pinned verifier.

Spec: `cure-light-p0-close-workflow-proposal.md` (workspace root). Tests:
`workflows/test/p0-close.test.mjs`. Inputs: `workflows/test/streams.mjs`.

Out of scope here: `verify join` dispatch and verdict capture (coordinator child), and any
packing/instructions/claims-list generation (deferred item 6).
