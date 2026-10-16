// workflows/test/hostdriver.mjs — real pi host driver for the workflow test harness.
//
// WHY: the stub host (`harness.mjs`) proves the draft's logic in-process; it cannot prove
// that the real `/workflow` host loads, compiles and runs the draft. This driver invokes
// the real CLI in JSON mode and turns the run's transcript records into the SAME result
// shape the stub host returns, so one case check runs against either driver:
//
//   stub  -> runWorkflow({file, args, cwd})      -> {error, exit, logs, shellCalls}
//   host  -> runHost({workflow, args, cwd, dir}) -> {error, exit, logs, shellCalls}
//
// Observation surface (verified against pi 1.3.0 + pi-schematic feat/workflow):
//   `pi --mode json --print "/workflow <token> <args>"` writes JSONL events to stdout.
//   Extension records arrive as `entry_appended` events: workflow-limits, workflow-shell,
//   workflow-exit, workflow-log, workflow-summary, workflow-error.
//   The process exit code is ALWAYS 0 for a completed run, whatever the workflow reason;
//   the `workflow-exit` record is the authoritative outcome. Non-zero means a host-level
//   failure only (bad flags, crash, timeout).
//   A command-only headless run persists no session file, so the transcript records on
//   stdout are the only durable observation (captured into the run dir).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Error code for a workflow the host could not resolve (mirrors harness.mjs). */
export const HOST_MISSING = "E_WORKFLOW_MISSING";

/**
 * Hermetic host flags: the real host, minus every subsystem a workflow must not need.
 * Determinism and startup cost improve; workflow semantics do not change (workflow.shell
 * uses pi's bash tool directly, never the LLM tool pipeline).
 */
export const HOST_FLAGS = Object.freeze([
  "--offline",
  "--no-session",
  "--mode", "json",
  "--print",
  "--no-mcp",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
]);

/** The exact argv the host receives; exported so reports and docs quote one source. */
export function hostInvocation({ workflow, args = "", flags = [] }) {
  const prompt = args.trim() === "" ? `/workflow ${workflow}` : `/workflow ${workflow} ${args}`;
  return [...HOST_FLAGS, ...flags, prompt];
}

function parseRecords(stdout) {
  const records = [];
  const unparsed = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch (problem) {
      unparsed.push({ line: line.slice(0, 200), error: String(problem.message ?? problem) });
    }
  }
  return { records, unparsed };
}

/** The workflow-authored payload: the host wraps `workflow.exit(x)` as `{reason, metadata:x}`. */
export function exitPayload(entry) {
  if (!entry) return null;
  const data = entry.data ?? {};
  if (data.metadata !== undefined) return data.metadata;
  return { reason: data.reason };
}

export function runHost({
  workflow,
  args = "",
  cwd,
  dir,
  flags = [],
  env = {},
  timeoutMs = 600_000,
  piBin = process.env.PI_BIN ?? "pi",
}) {
  mkdirSync(dir, { recursive: true });
  const argv = hostInvocation({ workflow, args, flags });
  const startedAt = Date.now();
  const proc = spawnSync(piBin, argv, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  writeFileSync(path.join(dir, "pi.stdout.jsonl"), stdout);
  writeFileSync(path.join(dir, "pi.stderr"), stderr);
  writeFileSync(path.join(dir, "invocation.json"), JSON.stringify({ piBin, argv, cwd }, null, 2) + "\n");

  const { records, unparsed } = parseRecords(stdout);
  const entries = records.filter((record) => record.type === "entry_appended").map((record) => record.entry);
  const of = (customType) => entries.filter((entry) => entry.customType === customType);

  const exitEntry = of("workflow-exit").at(-1) ?? null;
  const startError = of("workflow-error").find((entry) => entry.data?.phase === "start") ?? null;
  const runtimeError = of("workflow-error").find((entry) => entry.data?.phase !== "start") ?? null;
  const summary = of("workflow-summary").at(-1)?.data ?? null;
  const payload = exitPayload(exitEntry);
  const reason = exitEntry?.data?.reason ?? null;

  const timedOut = proc.error?.code === "ETIMEDOUT";
  let error = null;
  if (proc.error && !timedOut) {
    error = Object.assign(new Error(`host spawn failed: ${proc.error.message}`), { code: "E_HOST_SPAWN" });
  } else if (timedOut) {
    error = Object.assign(new Error(`host run exceeded ${timeoutMs} ms`), { code: "E_HOST_TIMEOUT" });
  } else if (startError) {
    error = Object.assign(new Error(startError.data.error ?? "workflow could not start"), {
      code: /not found/i.test(startError.data.error ?? "") ? HOST_MISSING : "E_WORKFLOW_START",
    });
  } else if (runtimeError) {
    error = Object.assign(new Error(runtimeError.data.error ?? "workflow error"), { code: "E_WORKFLOW_RUNTIME" });
  } else if (reason === "error") {
    error = Object.assign(new Error(exitEntry?.data?.error ?? "workflow failed at run time"), { code: "E_WORKFLOW_RUNTIME" });
  }

  return {
    driver: "host",
    error,
    exit: payload,
    exits: payload ? [payload] : [],
    reason,
    logs: of("workflow-log").map((entry) => entry.data?.text ?? ""),
    shellCalls: of("workflow-shell").map((entry) => ({
      command: entry.data?.detail ?? "",
      ok: entry.data?.ok === true,
      exitCode: entry.data?.exitCode ?? null,
      output: entry.data?.output ?? "",
      truncated: entry.data?.truncated === true,
    })),
    checkpoints: summary?.checkpoints ?? 0,
    entries: entries.map((entry) => entry.customType),
    summary,
    usage: {
      turns: summary?.turns ?? 0,
      classifySteps: summary?.classifySteps ?? 0,
      checkpoints: summary?.checkpoints ?? 0,
      costUsd: summary?.costUsd ?? 0,
    },
    process: { exitCode: proc.status, signal: proc.signal, timedOut, durationMs },
    transcript: { records, unparsed, entries },
    paths: { dir, stdout: path.join(dir, "pi.stdout.jsonl"), stderr: path.join(dir, "pi.stderr") },
  };
}
