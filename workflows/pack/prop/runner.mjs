// workflows/pack/prop/runner.mjs — the property runner: generate, drive, shrink, report.
//
// Adapted from workflows/p0/prop/runner.mjs. The engine contract is identical; the pack
// adaptation is small and explicit:
//   * spec labels read the pack spec (units/unitBytes/ceiling), not `boxes`;
//   * generated args carry the spec, because `--input-ceiling-bytes` is an explicit flag
//     (a pure function of the spec) rather than a store fact;
//   * replay commands point at workflows/pack/prop-run.mjs.
//
// The engine follows QuickCheck's contract with one domain adaptation: inputs are generated
// store specs, and shrinking is an explicit `shrink(spec) -> spec[]` (JavaScript has no type
// classes), defaulting to `shrinkStoreSpec`. Every trial is a full run of the workflow under
// test through the case runner, so the property observes exactly what a sealed case observes.
//
// Report contract:
//   ok              every trial satisfied the property (and coverage thresholds held); a run
//                   that executed zero trials is never ok
//   skipped         the workflow under test does not exist yet (red-first state)
//   failures[0]     the first counterexample, with its class, shrunk form and replay commands;
//                   shrinking never replaces it with a different failure class
//   coverage        label counts (QuickCheck's classify/cover) plus threshold checks
//   budget          wall time and the number of store runs actually spent
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { GeneratorDiscard, sample } from "./gen.mjs";
import { MutationNotApplicable } from "./mutations.mjs";
import { driveExistingStore, driveStoreSpec } from "./render.mjs";
import { makeRng, trialSeed } from "./rng.mjs";
import { canonicalSpec, describeSpec, genStoreSpec, shrinkStoreSpec } from "./spec.mjs";

export const DEFAULT_SEED = 20261016;
export const PROP_REPORT = "property-report.json";
export const CLI_PATH = "workflows/pack/prop-run.mjs";

export class PropertyViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "PropertyViolation";
  }
}

/**
 * The failure class used to keep shrinking honest. A shrink candidate may explain the same
 * bug differently (a different message, a smaller spec) but it must not trade the original
 * class for an unrelated one. Default class = the error code, else the error name. A
 * definition may supply `classifyFailure(problem, ctx)` when its class is domain-specific.
 */
function failureClass(def, problem, ctx) {
  if (typeof def.classifyFailure === "function") return String(def.classifyFailure(problem, ctx));
  return String(problem?.code ?? problem?.name ?? "Error");
}

function specLabels(spec) {
  const labels = [
    `units=${spec.units}`,
    `unitBytes=${spec.unitBytes}`,
    `ceiling=${spec.ceiling}`,
    `childStore=${spec.childStore ?? "<default>"}`,
    `mutations=${Math.min(spec.mutations.length, 2)}`,
  ];
  for (const mutation of spec.mutations) labels.push(`mutation=${mutation.name}`);
  if (spec.probe) labels.push(`probe=${spec.probe.n}`);
  return labels;
}

function replayCommands(name, seed, trial, spec, driver) {
  return {
    bySeed: `node ${CLI_PATH} ${name} --seed ${seed} --cases ${trial + 1} --driver ${driver}`,
    bySpec: `node ${CLI_PATH} ${name} --spec '${canonicalSpec(spec)}' --driver ${driver}`,
  };
}

/**
 * Wrap the definition's args function so a trial's spec reaches it: p0-pack takes the
 * ceiling (and, for engine self-tests, the probe) as explicit invocation inputs, so the
 * spec must be part of the args derivation, not only of the store render.
 */
function withSpecArgs(def, spec) {
  return (runRoot, overrides) => (typeof def.args === "function" ? def.args(runRoot, { ...(overrides ?? {}), spec }) : def.args);
}

/**
 * Run one property.
 *
 * def = {
 *   name, group, title,
 *   workflow,            absolute path of the workflow under test
 *   args,                arg string or (runRoot, overrides) => string
 *   property(ctx),       throws on violation; may return a label string or string[]
 *   gen?,                generator of pack specs (default: genStoreSpec)
 *   shrink?,             shrink(spec) -> spec[] (default: shrinkStoreSpec)
 *   cover?,              [{label, minPct}] thresholds reported as checks
 *   note?,               documented assumptions printed with the report
 * }
 */
export function runProperty(def, options = {}) {
  const {
    cases = 25,
    seed = DEFAULT_SEED,
    size = 0,
    driver = "stub",
    timeoutMs = 600_000,
    maxShrinks = 80,
    keep = false,
    root = null,
    stopOnFailure = true,
  } = options;

  const owned = root === null;
  const caseRoot = root ?? mkdtempSync(path.join(os.tmpdir(), `cure-light-prop-${def.name.replace(/[^a-z0-9-]/gi, "-")}-`));
  const gen = def.gen ?? genStoreSpec();
  const shrink = def.shrink ?? shrinkStoreSpec;
  const startedAt = Date.now();
  const coverage = new Map();
  const cache = new Map();
  let storeRuns = 0;
  let discarded = 0;
  let trials = 0;

  const runStore = (spec, dir) => {
    storeRuns += 1;
    mkdirSync(dir, { recursive: true });
    return driveStoreSpec(spec, { workflow: def.workflow, args: withSpecArgs(def, spec), driver, caseDir: dir, timeoutMs });
  };

  const inTrialDir = (index, suffix = "") => path.join(caseRoot, "trials", `${index}${suffix}`);

  /** Evaluate the property for one spec; results are cached by canonical spec. */
  const evaluate = (spec, index, dir) => {
    const key = canonicalSpec(spec);
    if (cache.has(key)) return cache.get(key);
    const { report } = runStore(spec, dir);
    const ctx = {
      spec,
      report,
      driver,
      caseDir: dir,
      labels: [],
      classify(label) {
        this.labels.push(String(label));
      },
      /** Metamorphic helper: drive a sibling spec (its own store, its own case dir). */
      run(sibling, suffix = `s${this.labels.length}`) {
        return runStore(sibling, inTrialDir(index, `-${suffix}`)).report;
      },
      /** Idempotence helper: drive the SAME store again (never reset), optionally with args overrides. */
      rerun(overrides, suffix = "rerun") {
        storeRuns += 1;
        return driveExistingStore(report.paths.runRoot, {
          workflow: def.workflow,
          args: withSpecArgs(def, spec),
          driver,
          caseDir: inTrialDir(index, `-${suffix}`),
          timeoutMs,
        });
      },
    };
    let outcome;
    if (report.error === "workflow-missing") {
      outcome = { ok: false, missing: true, detail: report.failure, labels: [] };
    } else if (report.result?.error?.code === "E_HOST_SPAWN" || report.result?.error?.code === "E_HOST_TIMEOUT") {
      outcome = { ok: false, infra: true, detail: report.failure, labels: [] };
    } else {
      try {
        const returned = def.property(ctx);
        const labels = [...(Array.isArray(returned) ? returned : returned === undefined ? [] : [returned]), ...ctx.labels];
        outcome = { ok: true, labels: labels.map(String), detail: null };
      } catch (problem) {
        outcome = {
          ok: false,
          labels: ctx.labels.map(String),
          detail: problem.message ?? String(problem),
          stack: problem.stack ?? null,
          class: failureClass(def, problem, ctx),
        };
      }
    }
    outcome.report = report;
    cache.set(key, outcome);
    return outcome;
  };

  const recordLabels = (labels) => {
    for (const label of labels) coverage.set(label, (coverage.get(label) ?? 0) + 1);
  };

  let failure = null;
  for (let index = 0; index < cases; index++) {
    const specSeed = trialSeed(seed, index);
    let spec;
    try {
      spec = sample(gen, makeRng(specSeed), size + index);
    } catch (problem) {
      if (problem instanceof GeneratorDiscard) {
        discarded += 1;
        continue;
      }
      throw problem;
    }
    let outcome;
    try {
      outcome = evaluate(spec, index, inTrialDir(index));
    } catch (problem) {
      if (problem instanceof MutationNotApplicable) {
        discarded += 1;
        rmSync(inTrialDir(index), { recursive: true, force: true });
        continue;
      }
      // An engine error is never a silent pass and never a counterexample: fail fast, keep
      // the report, and let the caller see the spec that broke the engine.
      return finish({ infraError: `engine error on trial ${index} (${describeSpec(spec)}): ${problem.message}`, breakTrial: index });
    }
    trials += 1;
    recordLabels([...specLabels(spec), ...outcome.labels]);
    if (outcome.missing) {
      return finish({ skipped: `workflow draft missing: ${def.workflow}` });
    }
    if (outcome.infra) {
      return finish({ infraError: outcome.detail });
    }
    if (!outcome.ok) {
      failure = { trial: index, trialSeed: specSeed, spec, detail: outcome.detail, stack: outcome.stack, class: outcome.class };
      if (stopOnFailure) break;
    }
  }

  let shrunk = null;
  if (failure) {
    let current = failure.spec;
    let detail = failure.detail;
    let steps = 0;
    const seen = new Set([canonicalSpec(current)]);
    for (let round = 0; round < maxShrinks; round++) {
      let advanced = false;
      for (const candidate of shrink(current)) {
        const key = canonicalSpec(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        let outcome;
        try {
          outcome = evaluate(candidate, failure.trial, inTrialDir(failure.trial, `-shrink${steps}`));
        } catch (problem) {
          if (problem instanceof MutationNotApplicable) continue;
          throw problem;
        }
        if (!outcome.ok && !outcome.missing && !outcome.infra) {
          // Preserve the failure class: a candidate that fails for a different reason is a
          // different bug and must not replace the counterexample. The limitation is that
          // two distinct violations of the same class (same error name/code) are not told
          // apart; the property author can define `classifyFailure` to narrow it further.
          if (outcome.class !== failure.class) continue;
          current = candidate;
          detail = outcome.detail;
          steps += 1;
          advanced = true;
          break;
        }
      }
      if (!advanced) break;
    }
    shrunk = { spec: current, specText: canonicalSpec(current), description: describeSpec(current), detail, class: failure.class, steps };
  }

  function finish(extra = {}) {
    const zeroTrials = trials === 0 && !extra.skipped && !extra.infraError;
    const labels = [...coverage.entries()].map(([label, count]) => ({ label, count, pct: trials === 0 ? 0 : Math.round((count / trials) * 1000) / 10 }));
    labels.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const checks = (def.cover ?? []).map(({ label, minPct }) => {
      const actualPct = labels.find((entry) => entry.label === label)?.pct ?? 0;
      return { label, minPct, actualPct, ok: actualPct >= minPct };
    });
    // A run that executed no trial proves nothing: zero trials is a failure, never a
    // vacuous pass. Every trial was discarded (inapplicable mutation) or `cases` was 0.
    const ok = !extra.skipped && !extra.infraError && !zeroTrials && !failure && checks.every((check) => check.ok);
    const report = {
      property: def.name,
      group: def.group ?? null,
      title: def.title,
      driver,
      seed,
      cases,
      trials,
      discarded,
      ok,
      skipped: extra.skipped ?? null,
      infraError: extra.infraError ?? null,
      zeroTrials: zeroTrials ? `no trial executed (cases=${cases}, discarded=${discarded})` : null,
      note: def.note ?? null,
      failures: failure
        ? [
            {
              trial: failure.trial,
              trialSeed: failure.trialSeed,
              spec: failure.spec,
              specText: canonicalSpec(failure.spec),
              description: describeSpec(failure.spec),
              detail: failure.detail,
              stack: failure.stack,
              class: failure.class,
              shrunk,
              replay: {
                initial: replayCommands(def.name, seed, failure.trial, failure.spec, driver),
                minimal: shrunk ? replayCommands(def.name, seed, failure.trial, shrunk.spec, driver) : null,
              },
            },
          ]
        : [],
      coverage: { trials, labels, checks },
      budget: { ms: Date.now() - startedAt, trials, storeRuns, discarded },
      paths: { caseRoot, retained: keep || !ok },
    };
    writeFileSync(path.join(caseRoot, PROP_REPORT), JSON.stringify(report, null, 2) + "\n");
    if (!report.paths.retained && owned) rmSync(caseRoot, { recursive: true, force: true, maxRetries: 3 });
    return report;
  }

  return finish();
}

/** Replay one explicit spec (the shrunk counterexample) through the property.
 * A run that did not happen is never a pass: a missing draft reports `skipped`, any other
 * run-level error reports the run failure itself. */
export function runSingleSpec(def, spec, options = {}) {
  const { driver = "stub", timeoutMs = 600_000, caseDir = null } = options;
  const dir = caseDir ?? mkdtempSync(path.join(os.tmpdir(), "cure-light-prop-replay-"));
  mkdirSync(dir, { recursive: true });
  const { report } = driveStoreSpec(spec, { workflow: def.workflow, args: withSpecArgs(def, spec), driver, caseDir: path.join(dir, "store"), timeoutMs });
  const base = { property: def.name, driver, spec, description: describeSpec(spec), caseDir: dir, report };
  if (report.error === "workflow-missing") {
    return { ...base, ok: false, skipped: `workflow draft missing: ${def.workflow}`, detail: `workflow draft missing: ${def.workflow}` };
  }
  if (report.error) {
    return { ...base, ok: false, skipped: null, detail: `run failed: ${report.failure}` };
  }
  const ctx = {
    spec,
    report,
    driver,
    caseDir: dir,
    labels: [],
    classify(label) {
      this.labels.push(String(label));
    },
    run(sibling, suffix = "s1") {
      return driveStoreSpec(sibling, { workflow: def.workflow, args: withSpecArgs(def, sibling), driver, caseDir: path.join(dir, suffix), timeoutMs }).report;
    },
    rerun(overrides, suffix = "rerun") {
      return driveExistingStore(report.paths.runRoot, { workflow: def.workflow, args: withSpecArgs(def, spec), driver, caseDir: path.join(dir, suffix), timeoutMs });
    },
  };
  let verdict;
  try {
    def.property(ctx);
    verdict = { ok: true, detail: null };
  } catch (problem) {
    verdict = { ok: false, detail: problem.message ?? String(problem) };
  }
  return { ...base, ...verdict };
}

export function summarizeProperties(reports) {
  return {
    total: reports.length,
    passed: reports.filter((report) => report.ok).length,
    failed: reports.filter((report) => !report.ok && !report.skipped && !report.infraError).length,
    skipped: reports.filter((report) => report.skipped).length,
    infra: reports.filter((report) => report.infraError).length,
    trials: reports.reduce((sum, report) => sum + report.trials, 0),
    properties: reports.map((report) => ({ property: report.property, driver: report.driver, ok: report.ok, trials: report.trials, firstFailure: report.failures[0]?.description ?? null })),
  };
}
