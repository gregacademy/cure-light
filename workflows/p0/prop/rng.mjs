// workflows/p0/prop/rng.mjs — deterministic PRNG and seed derivation for the property engine.
//
// The whole engine is seed-addressed: a run seed determines every trial, and a trial seed is
// derived from the run seed plus the trial index. Re-running with the same seed replays the
// identical sequence of stores and the identical failures, which is what makes a generated
// counterexample actionable.
export function hashSeed(...parts) {
  // FNV-1a over the NUL-joined parts: stable, dependency-free, 32-bit.
  const text = parts.map(String).join("\u0000");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function trialSeed(runSeed, index) {
  return hashSeed(runSeed, "trial", index);
}

/** mulberry32: small, fast, good enough for test generation, fully deterministic. */
export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive));
  return {
    seed,
    next,
    int,
    /** Inclusive integer range. */
    range: (min, max) => (max <= min ? min : min + int(max - min + 1)),
    float: next,
    bool: (probability = 0.5) => next() < probability,
    pick: (items) => items[int(items.length)],
    /** Fisher-Yates on a copy. */
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
