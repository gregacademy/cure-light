// workflows/test/fixtures/probe-mark.js — property-engine self-test fixture.
//
// A deliberately impure workflow with ONE planted violation: it refuses (needs-input)
// whenever the store's `.probe.json` says `n >= 2`, and in exactly that case it writes a
// marker file into the store first. The engine's job is to (a) detect that a refusal wrote
// to the store and (b) shrink the counterexample down to the minimal `n = 2`. Nothing here
// depends on the p0-close draft, so the engine is testable today.
return defineWorkflow((workflow) => {
  const args = load("args");
  const match = args.match(/--store\s+(\S+)/);
  if (!match) return workflow.exit({ reason: "needs-input", missing: "store" });
  const store = match[1];

  const probe = workflow.shell(`cat '${store}/.probe.json' 2>/dev/null || printf '{"n":0}'`);
  let n = 0;
  try {
    n = JSON.parse(probe.output).n ?? 0;
  } catch {
    n = 0;
  }
  if (n >= 2) workflow.shell(`printf 'marker\\n' > '${store}/marker.txt'`);
  return workflow.exit({ reason: n >= 2 ? "needs-input" : "ok", probe: n });
});
