// workflows/testkit/fixtures/smoke-echo.js — deterministic plumbing fixture for the host harness.
//
// The smallest workflow that still exercises every surface the harness observes: the
// verbatim args string, a shell probe, a store write, a checkpoint and a machine-readable
// exit payload. No model turns, no ambient inputs: same args + same store state => same
// artifact bytes and the same exit payload, which is what the purity rerun check asserts.
return defineWorkflow((workflow) => {
  const args = load("args");
  const match = args.match(/--store\s+(\S+)/);
  if (!match) return workflow.exit({ reason: "needs-input", missing: "store" });
  const store = match[1];

  const probe = workflow.shell(`test -d '${store}'`);
  if (!probe.ok) return workflow.exit({ reason: "needs-input", missing: "store" });

  const write = workflow.shell(`printf 'smoke\\n' > '${store}/out.txt' && sha256sum '${store}/out.txt'`);
  workflow.checkpoint({ phase: "smoke", artifacts: 1 });
  const sha = write.output.trim().split(/\s+/)[0] ?? "";
  return workflow.exit({ reason: write.ok ? "ok" : "evidence-failed", artifacts: { out: sha } });
});
