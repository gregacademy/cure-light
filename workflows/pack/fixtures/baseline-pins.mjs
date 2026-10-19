// workflows/pack/fixtures/baseline-pins.mjs — corrected-render pins for the recorded s1 store.
//
// Source: /workspaces/chunkhound_workspace/store/cure-light-pi-schematic-pr72-s1 (compare to
// the p0 acceptance store — same run). Input pins prove the pins still describe that store.
//
// instruction pins are the **corrected render** of the recorded inputs, captured 2026-10-17
// during the p0-pack build. The recorded store's own instruction files came from the
// defective ai068 render: payload lines point at `<store>/units2/…` instead of
// `<store>/units/units2/…`. The delta is exactly that path fix; claims-list and assignments
// are byte-identical to the recorded artifacts.
//
// Capture command (re-run only with a reviewed reason; rewrites the instruction pins):
//   none — the pins are not engine output. Provenance is re-proved on every acceptance run by
//   `workflows/pack/test/acceptance.test.mjs` > "pins are the recorded instruction bytes plus
//   exactly the payload-path fix". That test reads the recorded store's own
//   `join/box-*.instructions.md`, replaces every `<source>/units2/` occurrence with
//   `<source>/units/units2/`, and asserts the sha256 equals the matching pin here. The replay
//   test then runs the engine on a copy with an empty `join/` (no --allow-overwrite) and
//   asserts the same 13 hashes. The pins were captured 2026-10-17 under this transformation;
//   do not rewrite them to match engine output.

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
    "box-0004": "c0ee524424384cea56eaa17fb1c07d2459d1eb2419618fff0d818dd5fd46749f",
    "box-0005": "f754dc7be4316ef62c9efbb2f93db9c81d5d0c601c9edf909583b188cd6ef44f",
  },
  instructions: {
    "box-0000": "9e81f2136af68981c10b0e48da2f1fa5675e93a24be9759e175b87ef26d03111",
    "box-0001": "35f988e98f87dbbb90d385470726a866b46577bad6366afa416d97c71f7a1637",
    "box-0002": "451faa9268e98538ea5ded81f8bbaa60abc4e113d2f766f02eaaeeb2820a49fc",
    "box-0003": "8044e243f4a37fc03af0160011f1ac18fafb1b42fb2b98b064fe79bcdcbfe374",
    "box-0004": "7d0f29eb0f908cc70e1534074b5134e34cdf44c2e635c3ba1ebc46b3107603e5",
    "box-0005": "c6f98f1a741c2ea1eef3ab9c4d757af9803009f31957654fed1e60f9aaf200a7",
  },
};
