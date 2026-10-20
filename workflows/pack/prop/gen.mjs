// workflows/pack/prop/gen.mjs — generator combinators for the property engine.
//
// Copied from workflows/p0/prop/gen.mjs (the engine is shared by copy, see PROP-ENGINE.md).
// A Gen is `{sample(rng, size) -> value}`. Values must be JSON-serializable, because a
// counterexample is persisted and replayed as JSON. Shrinking is NOT derived from the
// generator (JavaScript has no type classes): the property declares an explicit
// `shrink(value) -> value[]`, and for pack specs that is `shrinkStoreSpec`.
export function constant(value) {
  return { sample: () => value };
}

/** Uniform integer 0..max. The shrinker for derived specs prefers 0, so generation leans small. */
export function nat(max) {
  return { sample: (rng) => rng.int(max + 1) };
}

export function chance(probability = 0.5) {
  return { sample: (rng) => rng.bool(probability) };
}

export function oneOf(entries) {
  const weighted = entries.map((entry) => (Array.isArray(entry) ? { weight: entry[1], gen: entry[0] } : { weight: 1, gen: entry }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    sample(rng, size) {
      let ticket = rng.float() * total;
      for (const entry of weighted) {
        ticket -= entry.weight;
        if (ticket <= 0) return sample(entry.gen, rng, size);
      }
      return sample(weighted.at(-1).gen, rng, size);
    },
  };
}

export function array(gen, { min = 0, max = 3 } = {}) {
  return {
    sample(rng, size) {
      const count = min + rng.int(max - min + 1);
      const out = [];
      for (let i = 0; i < count; i++) out.push(sample(gen, rng, size));
      return out;
    },
  };
}

/** Distinct picks from a fixed pool, order preserved, bounded by the pool size. */
export function subset(pool, { min = 0, max = 3 } = {}) {
  return {
    sample(rng) {
      const count = Math.min(pool.length, min + rng.int(max - min + 1));
      return rng.shuffle(pool).slice(0, count);
    },
  };
}

/** Values from an explicit list, weight = list order (first entries are the common case). */
export function elements(values) {
  return { sample: (rng) => values[rng.int(values.length)] };
}

export function map(gen, fn) {
  return { sample: (rng, size) => fn(sample(gen, rng, size)) };
}

/** Sample a generator; `size` scales with the trial index (QuickCheck's size parameter). */
export function sample(gen, rng, size = 0) {
  return gen.sample(rng, size);
}

/**
 * Retry-until-predicate. When the predicate never holds the generator throws
 * `GeneratorDiscard`, which the runner counts as a discard (not a failure) and retries.
 */
export class GeneratorDiscard extends Error {
  constructor(message) {
    super(message);
    this.name = "GeneratorDiscard";
    this.code = "E_GENERATOR_DISCARD";
  }
}

export function suchThat(gen, predicate, { tries = 20, why = "predicate" } = {}) {
  return {
    sample(rng, size) {
      for (let i = 0; i < tries; i++) {
        const value = sample(gen, rng, size);
        if (predicate(value)) return value;
      }
      throw new GeneratorDiscard(`no value satisfied ${why} after ${tries} tries`);
    },
  };
}
