// workflows/test/harness.mjs — stub workflow host for draft tests (BUILDING_WORKFLOWS.md §11.3).
//
// Real shell effects; notebook handles are an in-memory map so `records`-style drafts can
// be tested later; model/classify/handoff/new/entries are traps. No pi runtime is needed:
// the draft is loaded with `new Function("defineWorkflow", "load", "console", source)`.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

export const WORKFLOW_MISSING = "E_WORKFLOW_MISSING";
const STRUCTURED_OUTPUT_MAX_BYTES = 1024 * 1024; // pi's structured-output read cap

export function runWorkflow({ file, args = "", cwd = process.cwd(), env = {} }) {
  const calls = { shell: [], checkpoint: [], exit: [], readonly: [], notebook: [], unexpected: [] };
  const logs = [];
  const pages = new Map();
  let error = null;

  const shell = (command, options = {}) => {
    const timeoutMs = (options.timeout ?? 120) * 1000;
    const started = Date.now();
    try {
      const raw = execSync("exec 2>&1\n" + command, {
        cwd,
        shell: "/bin/bash",
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...env },
      });
      let output = raw;
      let truncated = false;
      if (Buffer.byteLength(output) > STRUCTURED_OUTPUT_MAX_BYTES) {
        output = output.slice(0, STRUCTURED_OUTPUT_MAX_BYTES);
        truncated = true;
      }
      calls.shell.push({ command, ok: true, exitCode: 0 });
      return { ok: true, exitCode: 0, output, display: output, truncated, killed: false, wallTimeSeconds: (Date.now() - started) / 1000 };
    } catch (problem) {
      const output = String(problem.stdout ?? "") + String(problem.stderr ?? "");
      calls.shell.push({ command, ok: false, exitCode: problem.status ?? 1 });
      return { ok: false, exitCode: problem.status ?? 1, output, display: "", truncated: false, killed: false, wallTimeSeconds: (Date.now() - started) / 1000 };
    }
  };

  const trap = (name) => {
    calls.unexpected.push(name);
    return () => { throw new Error(`unexpected workflow.${name}() in this test harness`); };
  };

  const workflow = {
    shell,
    checkpoint(metadata) { calls.checkpoint.push(metadata); return metadata; },
    exit(metadata) { calls.exit.push(metadata); return metadata; },
    budget() { return { cost: 0, costRemaining: null, timeRemainingMs: null }; },
    state() { return { readonly: false, notebookTopic: null }; },
    readonly(enabled) { calls.readonly.push(Boolean(enabled)); return { readonly: Boolean(enabled) }; },
    notebookIndex() { return [...pages.keys()]; },
    notebookRead(name) { calls.notebook.push({ op: "read", name }); if (!pages.has(name)) throw new Error(`no such page: ${name}`); return pages.get(name); },
    notebookWrite({ name, content }) { calls.notebook.push({ op: "write", name }); pages.set(name, content); return { name }; },
    notebookTopic() { return null; },
    entries: trap("entries"),
    run: trap("run"),
    classify: trap("classify"),
    handoff: trap("handoff"),
    new: trap("new"),
  };

  const capture = {
    log: (...parts) => logs.push(parts.map(String).join(" ")),
    error: (...parts) => logs.push(parts.map(String).join(" ")),
    warn: (...parts) => logs.push(parts.map(String).join(" ")),
  };

  let source = null;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return { error: Object.assign(new Error(`workflow draft missing: ${file} (red-first state)`), { code: WORKFLOW_MISSING }), exit: null, exits: [], checkpoints: [], shellCalls: calls.shell, logs, pages, calls };
  }

  try {
    const arrow = new Function("defineWorkflow", "load", "console", source)(
      (fn) => fn,
      (key) => (key === "args" || key === "intent" ? args : ""),
      capture,
    );
    arrow(workflow);
  } catch (problem) {
    error = problem;
  }

  return {
    error,
    exit: calls.exit.at(-1) ?? null,
    exits: calls.exit,
    checkpoints: calls.checkpoint,
    shellCalls: calls.shell,
    logs,
    pages,
    calls,
  };
}
