// workflows/pack/fixtures/baseline-pins.mjs — corrected-render pins for the recorded s1 store.
//
// Source: /workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1 (compare to
// the p0 acceptance store — same run). Input pins prove the pins still describe that store.
//
// instruction pins are the **corrected render** of the recorded inputs. The recorded
// store's own instruction files came from the defective ai068 render: payload lines point
// at `<store>/units2/…` instead of `<store>/units/units2/…`. The corrected render applies
// exactly two transformations: that payload-path fix, and the 2026-10-19 witness-clause
// fix that adds the line-boundary / diff-marker rule already enforced by p0-close and
// verify.mjs. The corrected witness clause adds fixed input, so the greedy boundary moves
// u0293 from box-0004 to box-0005 on the recorded s1 store. Boxes 0-3 are the recorded
// bytes plus the two fixes; boxes 4-5 are the corrected render for that moved unit set,
// re-proved by the replay. Claims-list and the first four assignments are byte-identical to
// the recorded artifacts.
//
// Capture command (re-run only with a reviewed reason; rewrites the instruction pins):
//   none — the pins are not engine output. Provenance is re-proved on every acceptance run by
//   `workflows/pack/test/acceptance.test.mjs` > "pins are the recorded instruction bytes plus
//   exactly the payload-path and witness-clause fixes". That test reads the recorded store's
//   own `join/box-*.instructions.md`, replaces every `<source>/units2/` occurrence with
//   `<source>/units/units2/`, replaces the recorded witness sentence with the corrected one,
//   and asserts the sha256 equals the matching pin here. The replay test then runs the engine
//   on a copy with an empty `join/` (no --allow-overwrite) and asserts the same 13 hashes.

export const BASELINE_PINS = {
  store: "/workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1",
  ceiling: 196608,
  inputs: {
    manifest: "c2aca5c4e8aef094de7e2067e80b8b47119234424cd91d752c8682ea1710430d",
    claimsDraft: "717bb920369589990a91f5a1781f08911a941e38d65484db9ea87393b2f18f32",
  },
  claimsList: "b3c5adf4fe1952a8742f5a08bbb51089fe66e8683a5222d903ce6400d21e3205",
  assignments: {
    "box-0000": "dbc0a5273ee96e187b99159a7dc398e4cfb5f0b387052a8893a8ec8c682ea943",
    "box-0001": "e454c5924a2d0751c65c495e0fe639778f123e880d4c2f526039994d83e5dd1d",
    "box-0002": "78373d44cfe7b5e71f8af613a797376a423349e1bce3705f6b47ecbd840b00f1",
    "box-0003": "312583e6c1950d4db5fc1dafaafb03f8c0b748bb3f3a5d9f6e4d6068bcabac39",
    "box-0004": "194025a67890b4bfd8b01d520b7ed2894d18f6dc76d4b06c080f0c32f5d33dce",
    "box-0005": "298ac347659544a2b432b7453801663b4e41c72766ca80323a9ffd7138faeb83",
  },
  instructions: {
    "box-0000": "27bb7a70c957d3770749db755d1b3c240c6273101e8db33e19c392318836e4da",
    "box-0001": "bfc8b06e8fa6f55c6bb99856e4c6a256c517eaf13f0db286bc579f7f54614b76",
    "box-0002": "c0f2aacaa5325eb44f8f971d80749ca2a9efb1b832244b2b31ab169bf5812e4a",
    "box-0003": "186403d20da7090abea47e447b2c7b48dbb8a61cbb502d16fd302ad8de2cb8d9",
    "box-0004": "8337f71dcf1e447f2399a1c32f381cd1c59bc54f856808e4b368e4241807ce2c",
    "box-0005": "9eb691084ffbc77df542d963177be44913c17d39977f3bc82edd093b1ac02b89",
  },
};
