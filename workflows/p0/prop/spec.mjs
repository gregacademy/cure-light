// workflows/p0/prop/spec.mjs — the generated input model: StoreSpec, its generator and shrinker.
//
// A StoreSpec is a JSON description of a pre-close run store: how many boxes, which mutations
// to apply, and (for engine self-tests) an injected `.probe.json`. It is the engine's
// "arbitrary" instance: a spec renders to a byte-deterministic store, so a spec is a
// replayable counterexample.
import { nat, oneOf, sample, subset } from "./gen.mjs";
import { MUTATION_NAMES, MUTATIONS, describeMutations } from "./mutations.mjs";

export const SPEC_SCHEMA = "store-spec/1";

function genParams(paramSpec, rng) {
  const params = {};
  for (const [key, meta] of Object.entries(paramSpec ?? {})) {
    if (meta.values) params[key] = rng.pick(meta.values);
    else params[key] = rng.range(Math.max(1, meta.min ?? 1), meta.max ?? 1);
  }
  return params;
}

function genMutation(rng, names) {
  const name = rng.pick(names);
  return { name, params: genParams(MUTATIONS[name]?.params, rng) };
}

/**
 * Default generator: a legal-vs-mutated mix over the mutation vocabulary.
 * `probeMax` > 0 injects `.probe.json` (engine self-tests only).
 */
export function genStoreSpec({ mutationNames = MUTATION_NAMES, maxMutations = 3, boxes = [1, 2], probeMax = 0 } = {}) {
  return {
    sample(rng) {
      const mutationCount = sample(oneOf([nat(1), nat(2), nat(maxMutations)]), rng, 0);
      const picked = sample(subset(mutationNames, { min: mutationCount, max: mutationCount }), rng, 0);
      const spec = { schema: SPEC_SCHEMA, boxes: rng.pick(boxes), mutations: picked.map((name) => ({ name, params: genParams(MUTATIONS[name]?.params, rng) })) };
      if (probeMax > 0) spec.probe = { n: rng.int(probeMax + 1) };
      return spec;
    },
  };
}

/** Convenience: a generator for specs whose mutation program is drawn from `names`. */
export function genSpecWith(names, options = {}) {
  return genStoreSpec({ mutationNames: names, ...options });
}

export function canonicalSpec(spec) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const key of Object.keys(node).sort()) out[key] = walk(node[key]);
      return out;
    }
    return node;
  };
  return JSON.stringify(walk(spec));
}

export function describeSpec(spec) {
  return `boxes=${spec.boxes} mutations=[${describeMutations(spec.mutations)}]${spec.probe ? ` probe=${JSON.stringify(spec.probe)}` : ""}`;
}

function withMutations(spec, mutations) {
  return { ...spec, mutations };
}

function withParams(spec, index, params) {
  return withMutations(
    spec,
    spec.mutations.map((mutation, i) => (i === index ? { ...mutation, params } : mutation)),
  );
}

/**
 * Shrink candidates, simplest-first: drop a mutation, halve a numeric parameter, collapse two
 * boxes to one, shrink the probe. Callers try each candidate and keep the first that still
 * fails, so the result is a local minimum over this ordering.
 */
export function shrinkStoreSpec(spec) {
  const out = [];
  for (let i = spec.mutations.length - 1; i >= 0; i--) out.push(withMutations(spec, spec.mutations.filter((_, j) => j !== i)));
  for (const [index, mutation] of spec.mutations.entries()) {
    for (const [key, value] of Object.entries(mutation.params ?? {})) {
      if (typeof value === "number" && value > 1) out.push(withParams(spec, index, { ...mutation.params, [key]: Math.floor(value / 2) }));
    }
  }
  if (spec.boxes === 2) out.push({ ...spec, boxes: 1 });
  if (spec.probe && spec.probe.n > 0) out.push({ ...spec, probe: { ...spec.probe, n: Math.floor(spec.probe.n / 2) } });
  return out;
}
