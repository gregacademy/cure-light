// workflows/pack/prop/spec.mjs — the generated input model: PackSpec, its generator and shrinker.
//
// A PackSpec is a JSON description of a synthetic pre-pack run store: how many units, how
// many bytes each payload carries, the explicit `--input-ceiling-bytes` to pack under, the
// explicit `--child-store` token to render into the instructions, which mutations to apply,
// and (for engine self-tests) an injected `.probe.json`. It is the engine's "arbitrary"
// instance: a spec renders to a byte-deterministic store, and the args the store is driven
// with are a pure function of the spec, so a spec is a replayable counterexample.
//
// Coherence rules (never generate a store the packer cannot start from):
//   * generic draws keep `unitBytes <= ceiling - FIXED_INPUT_SLACK`, a safe bound, so at
//     least one whole unit fits an empty box in a clean store; a fit refusal in the generated
//     space therefore always comes from a mutation (`oversized-unit`) or an all-opaque
//     inventory. Boundary draws instead derive `unitBytes` from the measured fixed input, so
//     a box lands exactly on the ceiling; they are still coherent (fixed input + one unit
//     <= ceiling), they just use the real fixed-input size rather than a conservative bound.
//   * `ceiling <= 200000`, which is what lets `oversized-unit` (extra >= 300000) pin a fit
//     refusal without reading the workflow's own packing math.
import { nat, oneOf, sample, subset } from "./gen.mjs";
import { MUTATION_NAMES, MUTATIONS, describeMutations } from "./mutations.mjs";

export const SPEC_SCHEMA = "pack-spec/1";

export const UNIT_COUNTS = Array.from({ length: 12 }, (_, index) => index + 1);
export const CEILING_MIN = 20000;
export const CEILING_MAX = 200000;
export const UNIT_BYTES_MIN = 1000;
export const UNIT_BYTES_MAX = 60000;
/** Instructions (~100 bytes per unit line + identity text) plus the claims list stay well under this. */
export const FIXED_INPUT_SLACK = 4096;

/**
 * Fixed-input byte model used by boundary draws. Every constant is calibrated against
 * p0-pack's own renderer (`renderInstructions`, box-0000, the fixture identity) and every
 * consumer is guarded by `prop-engine.prop.test.mjs`, which asserts a boundary spec lands a
 * box exactly on the ceiling. If the workflow template changes, that guard fails and these
 * constants must be recalibrated: a stale model only loses boundary coverage, it never
 * produces an incoherent store.
 *
 *   instruction bytes = TEMPLATE (no child store, no unit lines)
 *                     + 2 * child-store bytes (write path + claims path)
 *                     + per unit: 22 (line punctuation + "units/units2/") + child-store
 *                       bytes + unit-id bytes + 9 ("uNNNN.txt" basename)
 */
export const PACK_INSTRUCTION_TEMPLATE_BYTES = 1807;
/** The three default claims, serialized by p0-pack's Python-compatible writer. */
export const PACK_CLAIMS_LIST_BYTES = 246;
export const PACK_UNIT_LINE_BYTES = 22;
export const PACK_PAYLOAD_BASENAME_BYTES = 9;

/** Non-ASCII claim statements (BMP and an astral pair): the projection must escape them. */
export const NON_ASCII_CLAIM_STATEMENTS = [
  "The change keeps behavior 1 stable. \u2603 \u00E9",
  "The change keeps behavior 1 stable. \u{1F680} \u00E9",
];

/** Odd but safe unit-id styles: ASCII letters/digits plus `.`, `-`, `_`; no separators. */
export const ODD_UNIT_ID_STYLES = [
  (index) => `u.${index}`,
  (index) => `u-${index}`,
  (index) => `u_${index}`,
  (index) => `unit.${index}-x_y`,
];

/** UTF-8 bytes p0-pack charges before the unit payloads (instructions + claims list). */
export function packFixedInputBytes({ unitIds = [], childStore = "", claimsBytes = PACK_CLAIMS_LIST_BYTES } = {}) {
  const storeBytes = Buffer.byteLength(childStore, "utf8");
  let bytes = PACK_INSTRUCTION_TEMPLATE_BYTES + 2 * storeBytes + claimsBytes;
  for (const unitId of unitIds) {
    bytes += PACK_UNIT_LINE_BYTES + storeBytes + Buffer.byteLength(unitId, "utf8") + PACK_PAYLOAD_BASENAME_BYTES;
  }
  return bytes;
}
/**
 * Generated trials pin `--child-store` to one of these stable absolute tokens. The workflow
 * renders the child store path into every instruction line, so leaving it at the default
 * (`--store`, a per-trial temp path) would make the rendered bytes depend on the case-dir
 * path — and with it the packing boundary and every byte hash. A pinned child store makes a
 * spec render-independent of the temp root, so shrink candidates and `--spec` replays
 * reproduce exactly. The child==store default is covered by the sealed cases and acceptance.
 */
export const CHILD_STORES = ["/cure-light/prop/child-store-a", "/cure-light/prop/child-store-b"];

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
 * Drop picks whose effect would be erased by an earlier pick in the same program (a declared
 * `cancels` pair, e.g. making a unit opaque erases the oversized-unit fit failure). The
 * stage-rule expectation then holds for every generated program.
 */
function dropCancellingPicks(names) {
  const kept = [];
  for (const name of names) {
    const conflicts = MUTATIONS[name]?.cancels ?? [];
    const clashes = kept.some((other) => conflicts.includes(other) || (MUTATIONS[other]?.cancels ?? []).includes(name));
    if (!clashes) kept.push(name);
  }
  return kept;
}

function unitBytesCeiling(maxUnitBytes, ceiling) {
  return Math.max(UNIT_BYTES_MIN, Math.min(maxUnitBytes, ceiling - FIXED_INPUT_SLACK));
}

function genUnitBytes(rng, ceiling, unitBytesMax) {
  const upper = unitBytesCeiling(unitBytesMax, ceiling);
  const mode = rng.pick(["uniform", "uniform", "max", "small"]);
  if (mode === "max") return upper;
  if (mode === "small") return rng.range(UNIT_BYTES_MIN, Math.min(upper, UNIT_BYTES_MIN * 4));
  return rng.range(UNIT_BYTES_MIN, upper);
}

function oddUnitIds(units, rng) {
  const style = rng.pick(ODD_UNIT_ID_STYLES);
  return Array.from({ length: units }, (_, index) => style(index));
}

/**
 * A boundary draw: pick how many units fill the first box, then derive a per-unit size and
 * the ceiling so that `fixed input + inBox * unitBytes === ceiling` exactly. The next unit
 * therefore does NOT fit, which is the exact-ceiling case a strict `<` check would split.
 * Returns null when the bounds cannot express such a ceiling (caller falls back).
 */
function genBoundarySizes({ rng, units, ids, childStore, ceilingMin, ceilingMax, unitBytesMax }) {
  if (units < 2) return null;
  const inBox = rng.range(1, Math.min(4, units - 1));
  const fixed = packFixedInputBytes({ unitIds: ids.slice(0, inBox), childStore });
  const maxUnit = Math.min(unitBytesMax, Math.floor((ceilingMax - fixed) / inBox));
  const minUnit = Math.max(UNIT_BYTES_MIN, Math.ceil((ceilingMin - fixed) / inBox));
  if (minUnit > maxUnit) return null;
  const unitBytes = rng.range(minUnit, maxUnit);
  return { unitBytes, ceiling: fixed + inBox * unitBytes };
}

/** Mutations that change the claims-list size; boundary draws keep them out of the program. */
const CLAIM_SIZING_MUTATIONS = new Set(["non-ascii-claims", "duplicate-claim-ids"]);

/**
 * Default generator: a legal-vs-mutated mix over the mutation vocabulary, with coherent
 * unit counts, payload sizes and ceilings. `probeMax` > 0 injects `.probe.json`
 * (engine self-tests only).
 *
 * `boundaryEvery` forces every Nth draw (by generator size) onto the exact ceiling, so a
 * short run always reaches that boundary instead of relying on a rare random hit. A
 * boundary draw excludes mutations that change the claims-list size, because the ceiling
 * was derived from the default claims bytes.
 * `oddUnitIdShare` / `nonAsciiClaimShare` vary the input shape: safe odd unit ids and a
 * non-ASCII claim statement. Boundary draws keep the default claim statements because the
 * fixed-input model is calibrated for them.
 */
export function genStoreSpec({
  mutationNames = MUTATION_NAMES,
  maxMutations = 3,
  unitCounts = UNIT_COUNTS,
  childStores = CHILD_STORES,
  ceilingMin = CEILING_MIN,
  ceilingMax = CEILING_MAX,
  unitBytesMax = UNIT_BYTES_MAX,
  probeMax = 0,
  boundaryEvery = 5,
  oddUnitIdShare = 0.25,
  nonAsciiClaimShare = 0.2,
} = {}) {
  return {
    sample(rng, size = 0) {
      const units = rng.pick(unitCounts);
      const childStore = rng.pick(childStores);
      const ids = rng.float() < oddUnitIdShare ? oddUnitIds(units, rng) : null;
      const boundary = boundaryEvery > 0 && size % boundaryEvery === 0;
      const exact = boundary
        ? genBoundarySizes({
            rng,
            units,
            ids: ids ?? Array.from({ length: units }, (_, index) => `u${String(index).padStart(4, "0")}`),
            childStore,
            ceilingMin,
            ceilingMax,
            unitBytesMax,
          })
        : null;
      const ceiling = exact?.ceiling ?? rng.range(ceilingMin, ceilingMax);
      const unitBytes = exact?.unitBytes ?? genUnitBytes(rng, ceiling, unitBytesMax);
      const claimStatement = exact === null && rng.float() < nonAsciiClaimShare ? rng.pick(NON_ASCII_CLAIM_STATEMENTS) : null;
      const mutationCount = sample(oneOf([nat(1), nat(2), nat(maxMutations)]), rng, 0);
      const availableMutations = exact === null ? mutationNames : mutationNames.filter((name) => !CLAIM_SIZING_MUTATIONS.has(name));
      const picked = dropCancellingPicks(sample(subset(availableMutations, { min: mutationCount, max: mutationCount }), rng, 0));
      const spec = {
        schema: SPEC_SCHEMA,
        units,
        unitBytes,
        ceiling,
        childStore,
        mutations: picked.map((name) => ({ name, params: genParams(MUTATIONS[name]?.params, rng) })),
      };
      if (ids) spec.unitIds = ids;
      if (claimStatement) spec.claimStatement = claimStatement;
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
  const ids = Array.isArray(spec.unitIds) ? ` ids=[${spec.unitIds.join(",")}]` : "";
  const claim = spec.claimStatement ? ` claim=${JSON.stringify(spec.claimStatement)}` : "";
  return `units=${spec.units} unitBytes=${spec.unitBytes} ceiling=${spec.ceiling} childStore=${spec.childStore ?? "<default>"}${ids}${claim} mutations=[${describeMutations(spec.mutations)}]${spec.probe ? ` probe=${JSON.stringify(spec.probe)}` : ""}`;
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

function without(spec, keys) {
  const out = { ...spec };
  for (const key of keys) delete out[key];
  return out;
}

/**
 * Shrink candidates, simplest-first: drop a mutation, shrink a numeric parameter (using the
 * registry's own shrinker when it has one, so effect-preserving bounds survive), collapse
 * the unit count, halve payload size, halve the ceiling (re-clamping payload size to stay
 * coherent), shrink the probe. Callers try each candidate and keep the first that still
 * fails, so the result is a local minimum over this ordering.
 */
export function shrinkStoreSpec(spec) {
  const out = [];
  for (let i = spec.mutations.length - 1; i >= 0; i--) out.push(withMutations(spec, spec.mutations.filter((_, j) => j !== i)));
  // Drop optional input decorations: the default ids / claims are strictly simpler.
  if (spec.unitIds) out.push(without(spec, ["unitIds"]));
  if (spec.claimStatement) out.push(without(spec, ["claimStatement"]));
  for (const [index, mutation] of spec.mutations.entries()) {
    const meta = MUTATIONS[mutation.name]?.params ?? {};
    for (const [key, value] of Object.entries(mutation.params ?? {})) {
      if (typeof value !== "number" || value <= 1) continue;
      const next = typeof meta[key]?.shrink === "function" ? meta[key].shrink(value) : Math.floor(value / 2);
      if (next < value) out.push(withParams(spec, index, { ...mutation.params, [key]: next }));
    }
  }
  if (spec.units > 1) {
    const units = Math.max(1, Math.floor(spec.units / 2));
    out.push({ ...spec, units, ...(spec.unitIds ? { unitIds: spec.unitIds.slice(0, units) } : {}) });
  }
  if (spec.unitBytes > UNIT_BYTES_MIN) out.push({ ...spec, unitBytes: Math.max(UNIT_BYTES_MIN, Math.floor(spec.unitBytes / 2)) });
  if (spec.ceiling > CEILING_MIN) {
    const ceiling = Math.max(CEILING_MIN, Math.floor(spec.ceiling / 2));
    out.push({ ...spec, ceiling, unitBytes: unitBytesCeiling(spec.unitBytes, ceiling) });
  }
  if (spec.probe && spec.probe.n > 0) {
    out.push({ ...spec, probe: { ...spec.probe, n: Math.floor(spec.probe.n / 2) } });
    // Pack addition to the p0 shrinker: a step-down, so a threshold probe (refuse iff
    // n >= 2) shrinks to exactly 2 even when halving would jump below the threshold.
    if (spec.probe.n > 2) out.push({ ...spec, probe: { ...spec.probe, n: spec.probe.n - 1 } });
  }
  return out;
}
