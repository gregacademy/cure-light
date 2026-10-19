// workflows/pack/p0-pack.js — P0.4 packing bridge: claims-list + assignments + instructions.
//
// Spec: workflows/pack/SPEC.md. Builder loop and purity rules: workflows/AUTHORING.md.
//
// The workflow replaces the hand-rolled ai068 placement step with one hash-pinned host tool:
//   args gate -> pack helper (staging: project, render, greedy-pack) -> digest cross-check ->
//   staging-compare promotion -> card + exit.
// A validated refusal leaves the store byte-identical: all production happens in the evidence
// staging dir; the store is written only by the promotion phase, after every freeze check,
// as a pre-staged, snapshot-backed rename transaction that rolls back on any validated
// failure. The remaining window is an external process crash during the final rename
// sequence, which can still leave a prefix of renamed targets.
//
// Contract notes that matter for a future reader:
//   * Exactly one top-level `return defineWorkflow((workflow) => { ... })`; synchronous;
//     no imports; `workflow.shell` is the only I/O; model handles are never used.
//   * The pack helper is embedded (PACK_MAIN) and materialized into the evidence dir, so the
//     shell transcript carries no run-authored logic beyond one heredoc write.
//   * The exit payload is the machine result; never the process exit code.
//   * claims-list and assignments are emitted as Python `json.dumps(indent=2,
//     ensure_ascii=True)` bytes with one trailing newline; instructions are UTF-8 text with
//     one trailing newline. The acceptance tier is the proof of byte equality.

return defineWorkflow((workflow) => {
  const REASONS = ["ok", "needs-input", "frozen-artifact", "evidence-failed"];
  const VALUE_FLAGS = ["--store", "--input-ceiling-bytes", "--run-id", "--review-state", "--base-oid", "--subject-oid"];
  const OPTIONAL_FLAGS = ["--child-store"];
  const HEX64 = /^[0-9a-f]{64}$/;
  const OID40 = /^[0-9a-f]{40}$/;
  const UINT = /^\d+$/;
  const BOX_ID = /^box-\d{4}$/;
  const CONTROL = /[\x00-\x1f\x7f]/;
  const SPACE_OR_CONTROL = /[\s\x00-\x1f\x7f]/;
  const RUN_ID = /^([^#\s]+)#(\d+)$/;
  const MAX_BOXES = 10000;
  const PACK_TAG = "P0_PACK_HELPER"; // heredoc delimiter; the collision loop keeps it safe
  const PACK_TIMEOUT_S = 300; // SPEC bound: the helper step (staging or promotion)

  const clip = (value, max) => {
    const text = String(value === null || value === undefined ? "" : value);
    return text.length <= max ? text : text.slice(0, max);
  };
  const quote = (value) => "'" + String(value).split("'").join("'\\''") + "'";
  // The box-id space is box-0000..box-9999; pad4 never wraps a fifth digit.
  const pad4 = (value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > MAX_BOXES - 1) {
      throw new RangeError("box id out of range: " + String(value));
    }
    return ("000" + String(number)).slice(-4);
  };
  const parseAll = (text) => {
    try {
      return JSON.parse(String(text === null || text === undefined ? "" : text));
    } catch (problem) {
      return null;
    }
  };
  const parseTail = (text) => {
    const lines = String(text === null || text === undefined ? "" : text).trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const one = lines.at(i).trim();
      if (one === "") continue;
      const value = parseAll(one);
      if (value !== null) return value;
    }
    return null;
  };
  // Quote-aware tokenizer for the raw `args` string: single quotes are literal, double
  // quotes and unquoted text take backslash escapes, and an unterminated quote or trailing
  // escape is a malformed argument string (refused, never guessed).
  const tokenize = (text) => {
    const words = [];
    let current = "";
    let started = false;
    let quoted = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (quoted === "'") {
        if (ch === "'") quoted = "";
        else current += ch;
        continue;
      }
      if (quoted === '"') {
        if (ch === '"') quoted = "";
        else if (ch === "\\") {
          if (i + 1 >= text.length) return null;
          i += 1;
          current += text.charAt(i);
        } else current += ch;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quoted = ch;
        started = true;
        continue;
      }
      if (ch === "\\") {
        if (i + 1 >= text.length) return null;
        i += 1;
        current += text.charAt(i);
        started = true;
        continue;
      }
      if (/\s/.test(ch)) {
        if (started) {
          words.push(current);
          current = "";
          started = false;
        }
        continue;
      }
      current += ch;
      started = true;
    }
    if (quoted !== "") return null;
    if (started) words.push(current);
    return words;
  };
  const heredoc = (tag, payload, file) => {
    let delim = tag;
    while (payload.indexOf(delim) >= 0) delim = delim + "_";
    return "cat > " + quote(file) + " <<'" + delim + "'\n" + payload + "\n" + delim + "\n";
  };
  // The payload builder is pure: workflow.exit is called from the workflow arrow body
  // itself, because the canonical compiler rejects the workflow object in a nested scope.
  const refuse = (reason, metadata) => {
    const payload = { reason: REASONS.indexOf(reason) >= 0 ? reason : "evidence-failed" };
    if (metadata) Object.assign(payload, metadata);
    return payload;
  };

  // ---------------------------------------------------------------------------------------
  // Arg gate — unknown or missing flags refuse before any shell effect (SPEC step 0).
  // ---------------------------------------------------------------------------------------
  const rawArgs = typeof load("args") === "string" ? load("args") : "";
  const tokens = rawArgs.trim() === "" ? [] : tokenize(rawArgs);
  if (tokens === null) {
    return workflow.exit(refuse("needs-input", { detail: "the argument string has an unterminated quote or escape" }));
  }
  const values = new Map();
  let allowOverwrite = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens.at(i);
    let name = token;
    let value = "";
    let hasValue = false;
    const eq = token.indexOf("=");
    if (token.indexOf("--") === 0 && eq > 0) {
      name = token.slice(0, eq);
      value = token.slice(eq + 1);
      hasValue = true;
    }
    if (name === "--allow-overwrite") {
      if (hasValue && value !== "true") {
        return workflow.exit(refuse("needs-input", { detail: "--allow-overwrite accepts no value or =true" }));
      }
      allowOverwrite = true;
      continue;
    }
    const known = VALUE_FLAGS.indexOf(name) >= 0 || OPTIONAL_FLAGS.indexOf(name) >= 0;
    if (!known) return workflow.exit(refuse("needs-input", { detail: "unknown flag: " + clip(name, 80) }));
    // `--flag=` is an explicit empty value: refuse it instead of consuming the next token.
    if (hasValue && value === "") {
      return workflow.exit(refuse("needs-input", { detail: "flag value is empty: " + clip(name, 80) }));
    }
    if (!hasValue) {
      i += 1;
      if (i >= tokens.length) return workflow.exit(refuse("needs-input", { detail: "flag has no value: " + clip(name, 80) }));
      value = tokens.at(i);
      if (value === "") return workflow.exit(refuse("needs-input", { detail: "flag value is empty: " + clip(name, 80) }));
    }
    if (values.has(name)) return workflow.exit(refuse("needs-input", { detail: "duplicate flag: " + clip(name, 80) }));
    values.set(name, value);
  }
  for (const name of VALUE_FLAGS) {
    if (!values.get(name)) return workflow.exit(refuse("needs-input", { detail: "missing required flag: " + name }));
  }
  const store = values.get("--store");
  const inputCeiling = values.get("--input-ceiling-bytes");
  const runId = values.get("--run-id");
  const reviewState = values.get("--review-state");
  const baseOid = values.get("--base-oid");
  const subjectOid = values.get("--subject-oid");
  const childStoreFlag = values.get("--child-store") || "";
  // A 400-digit value parses to Infinity, which would render as `null` in the assignment:
  // require an exact nonnegative safe integer at both ends (here and in the helper).
  if (!UINT.test(inputCeiling) || !Number.isSafeInteger(Number(inputCeiling))) {
    return workflow.exit(refuse("needs-input", { detail: "--input-ceiling-bytes must be a nonnegative safe integer" }));
  }
  if (!OID40.test(baseOid)) return workflow.exit(refuse("needs-input", { detail: "--base-oid must be 40 lowercase hex" }));
  if (!OID40.test(subjectOid)) return workflow.exit(refuse("needs-input", { detail: "--subject-oid must be 40 lowercase hex" }));
  if (!RUN_ID.test(runId)) return workflow.exit(refuse("needs-input", { detail: "--run-id must match <repo>#<n> without whitespace" }));
  if (CONTROL.test(reviewState)) return workflow.exit(refuse("needs-input", { detail: "--review-state must not contain control characters" }));
  if (runId === "" || reviewState === "" || store === "") {
    return workflow.exit(refuse("needs-input", { detail: "--store, --run-id and --review-state must be nonempty" }));
  }
  if (childStoreFlag !== "") {
    let childDetail = "";
    if (childStoreFlag.charAt(0) !== "/") {
      childDetail = "--child-store must be an absolute POSIX path (it is embedded in child instructions)";
    } else if (childStoreFlag.split("/").indexOf("..") >= 0) {
      childDetail = "--child-store must not contain '..' segments (it is embedded in child instructions)";
    } else if (SPACE_OR_CONTROL.test(childStoreFlag)) {
      childDetail = "--child-store must not contain whitespace or control characters (it is embedded in child instructions)";
    }
    if (childDetail !== "") return workflow.exit(refuse("needs-input", { detail: childDetail }));
  }

  // ---------------------------------------------------------------- args gate, part two
  const boot = workflow.shell("printf '%s\\n' \"$PWD\" \"$(date -u +%Y%m%dT%H%M%SZ)\" \"$$\"", { timeout: 30 });
  if (!boot.ok || boot.truncated === true) {
    return workflow.exit(refuse("needs-input", { detail: "cannot determine the working directory" }));
  }
  const bootLines = String(boot.output || "").split("\n");
  const cwd = (bootLines.at(0) || "").trim() || ".";
  const stamp = (bootLines.at(1) || "").trim() || "run";
  const pid = (bootLines.at(2) || "").trim() || "0";
  // Evidence dir per run: "$PWD/.tmp/<workflow>/<UTCstamp>-$$" (SPEC §Invocation).
  const evidenceDir = cwd.replace(/\/+$/, "") + "/.tmp/p0-pack/" + stamp + "-" + pid;
  const stageDir = evidenceDir + "/stage";

  const storeCheck = workflow.shell("test -d " + quote(store), { timeout: 30 });
  if (!storeCheck.ok) return workflow.exit(refuse("needs-input", { detail: "store is not a directory" }));
  const posture = workflow.state();
  if (posture && posture.readonly === true) {
    return workflow.exit(refuse("needs-input", { detail: "the session is readonly; p0-pack writes evidence under .tmp" }));
  }
  const nodeProbe = workflow.shell("node --version", { timeout: 30 });
  if (!nodeProbe.ok) return workflow.exit(refuse("needs-input", { detail: "node is not available" }));
  workflow.checkpoint({ phase: "args", store: store, evidence: evidenceDir });

  const mkdir = workflow.shell("mkdir -p " + quote(stageDir), { timeout: 30 });
  if (!mkdir.ok) return workflow.exit(refuse("needs-input", { detail: "cannot create the evidence directory" }));

  // --------------------------------------------------------------- pack helper (embed)
  // PACK_MAIN is materialized as the evidence-dir program. It is self-contained: no imports
  // beyond node builtins, no backticks (heredoc extraction), and the only writer of the
  // store is its `--promote` mode.
  const PACK_MAIN = function () {
    "use strict";
    const fs = require("node:fs");
    const path = require("node:path");
    const crypto = require("node:crypto");

    const UNITS_DIR = "units/units2";
    const MANIFEST_REL = "units/units2/manifest.json";
    const CLAIMS_REL = "claims/claims-draft.v3.json";
    const CAPTURE_REL = "claims/sources/capture-manifest.json";
    const CLAIMS_LIST_REL = "join/claims-list.json";
    const TARGETS_REL = "pack-targets.json";
    const ASSIGNMENT_SUFFIX = ".assignment.json";
    const INSTRUCTIONS_SUFFIX = ".instructions.md";
    const JOIN = "join";
    const MAX_BOXES = 10000;
    const OID40 = /^[0-9a-f]{40}$/;
    const RUN_ID = /^([^#\s]+)#(\d+)$/;
    const REPO_PART = /^[A-Za-z0-9._\/-]+$/;
    const CONTROL = /[\x00-\x1f\x7f]/;
    const SPACE_OR_CONTROL = /[\s\x00-\x1f\x7f]/;

    const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
    const isObject = (value) => value !== null && typeof value === "object" && Array.isArray(value) === false;
    const isText = (value) => typeof value === "string" && value.length > 0;
    const isCount = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const posixBasename = (ref) => {
      const idx = ref.lastIndexOf("/");
      return idx < 0 ? ref : ref.slice(idx + 1);
    };
    // The box-id space is box-0000..box-9999; pad4 never wraps a fifth digit.
    const pad4 = (value) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0 || number > MAX_BOXES - 1) {
        throw new RangeError("box id out of range: " + String(value));
      }
      return ("000" + String(number)).slice(-4);
    };

    // Python `json.dumps(..., indent=2, ensure_ascii=True)` compatible writer. The acceptance
    // tier pins byte equality, so escaping must match exactly (the same writer as p0-close).
    const pyString = (value) => {
      let out = '"';
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        const char = value.charAt(i);
        if (char === '"') out += '\\"';
        else if (char === "\\") out += "\\\\";
        else if (code === 8) out += "\\b";
        else if (code === 12) out += "\\f";
        else if (code === 10) out += "\\n";
        else if (code === 13) out += "\\r";
        else if (code === 9) out += "\\t";
        else if (code < 32) out += "\\u" + ("000" + code.toString(16)).slice(-4);
        else if (code < 127) out += char;
        else if (
          code >= 0xd800 && code <= 0xdbff && i + 1 < value.length
          && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff
        ) {
          out += "\\u" + ("000" + code.toString(16)).slice(-4) + "\\u" + ("000" + value.charCodeAt(i + 1).toString(16)).slice(-4);
          i += 1;
        } else {
          out += "\\u" + ("000" + code.toString(16)).slice(-4);
        }
      }
      return out + '"';
    };
    const pyValue = (value, depth) => {
      const indent = (level) => {
        let out = "";
        for (let i = 0; i < level; i++) out += "  ";
        return out;
      };
      if (value === null || value === undefined) return "null";
      if (typeof value === "boolean") return value ? "true" : "false";
      if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
      if (typeof value === "string") return pyString(value);
      if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        return "[\n" + value.map((item) => indent(depth + 1) + pyValue(item, depth + 1)).join(",\n") + "\n" + indent(depth) + "]";
      }
      const entries = Object.entries(value);
      if (entries.length === 0) return "{}";
      return "{\n" + entries.map((entry) => indent(depth + 1) + pyString(entry[0]) + ": " + pyValue(entry[1], depth + 1)).join(",\n") + "\n" + indent(depth) + "}";
    };

    const argv = process.argv.slice(2);
    const flagValue = (name) => {
      for (let i = 0; i < argv.length; i++) {
        if (argv.at(i) === name) return i + 1 < argv.length ? argv.at(i + 1) : "";
        if (argv.at(i).indexOf(name + "=") === 0) return argv.at(i).slice(name.length + 1);
      }
      return "";
    };
    const storeArg = flagValue("--store");
    const stagingArg = flagValue("--staging");
    const childStoreArg = flagValue("--child-store");
    const ceilingArg = flagValue("--input-ceiling-bytes");
    const runId = flagValue("--run-id");
    const reviewState = flagValue("--review-state");
    const baseOid = flagValue("--base-oid");
    const subjectOid = flagValue("--subject-oid");
    const allowOverwrite = argv.indexOf("--allow-overwrite") >= 0;
    const promoteMode = argv.indexOf("--promote") >= 0;
    const errorText = (problem) => String(problem && problem.message ? problem.message : problem);
    // The store is resolved once (symlinks included) and every later path is built from it.
    let store = "";
    let storeError = "";
    if (storeArg) {
      try {
        store = fs.realpathSync(path.resolve(storeArg));
      } catch (problem) {
        storeError = errorText(problem);
      }
    }
    const staging = stagingArg ? path.resolve(stagingArg) : "";
    let childStore = store;
    if (childStoreArg) {
      const resolvedChild = path.resolve(childStoreArg);
      try {
        childStore = fs.realpathSync(resolvedChild);
      } catch (problem) {
        childStore = resolvedChild;
      }
    }
    childStore = childStore.replace(/\/+$/, "");
    const out = (value) => process.stdout.write(JSON.stringify(value) + "\n");
    const refuse = (reason, error) => {
      out({ ok: false, reason: reason, error: String(error) });
      return 0;
    };

    const isInside = (parent, child) => {
      const rel = path.relative(parent, child);
      return rel !== "" && rel !== ".." && rel.indexOf(".." + path.sep) !== 0 && !path.isAbsolute(rel);
    };
    const hasDotDot = (target) => target.split("/").indexOf("..") >= 0;

    // A failed scan is an error, never an empty list: an unreadable `join` must not silently
    // look like "no stale boxes". Only ENOENT (no join yet) means "nothing to scan".
    const joinNames = () => {
      let names;
      try {
        names = fs.readdirSync(path.join(store, JOIN));
      } catch (problem) {
        if (problem && problem.code === "ENOENT") return { names: [], error: null };
        return { names: [], error: "cannot scan " + JOIN + ": " + errorText(problem) };
      }
      return { names: names, error: null };
    };

    // The resolved `join` must be a real directory exactly inside the resolved store. A
    // symlinked `join` (or a realpath that escapes the store) is refused, so no write can be
    // redirected outside the store. `create` is true only in promote mode.
    const joinDir = (create) => {
      const join = path.join(store, JOIN);
      let stat = null;
      try {
        stat = fs.lstatSync(join);
      } catch (problem) {
        if (!problem || problem.code !== "ENOENT") {
          return { dir: "", error: "cannot inspect " + JOIN + ": " + errorText(problem) };
        }
      }
      if (stat && stat.isSymbolicLink()) return { dir: "", error: JOIN + " is a symlink; refusing to follow it for writes" };
      if (!stat) {
        if (!create) return { dir: "", error: null };
        try {
          fs.mkdirSync(join, { recursive: true });
        } catch (problem) {
          return { dir: "", error: "cannot create " + JOIN + ": " + errorText(problem) };
        }
      } else if (!stat.isDirectory()) {
        return { dir: "", error: JOIN + " is not a directory" };
      }
      let real = "";
      try {
        real = fs.realpathSync(join);
      } catch (problem) {
        return { dir: "", error: "cannot resolve " + JOIN + ": " + errorText(problem) };
      }
      if (!isInside(store, real)) return { dir: "", error: JOIN + " resolves outside the store: " + real };
      return { dir: real, error: null };
    };

    // Existing box artifacts whose id is not in the derived set cannot be repaired by a
    // rewrite, so they refuse the run (the workflow never deletes).
    const staleTargets = (names, derivedIds) => {
      const known = new Set(derivedIds);
      const stale = [];
      for (const name of names) {
        if (name.indexOf("box-") !== 0) continue;
        const dot = name.indexOf(".");
        if (dot < 0) continue;
        const boxId = name.slice(0, dot);
        if (!/^box-\d{4}$/.test(boxId)) continue;
        if (!known.has(boxId)) stale.push(boxId);
      }
      return Array.from(new Set(stale)).sort();
    };

    // The per-box child instructions. The identity derives from the capture manifest; payload
    // paths derive from units_dir + basename (the D1 class cannot recur).
    const renderInstructions = (boxId, units, identity) => {
      const lines = [];
      lines.push("You are a P0.4 join proposer in a cure-light review of `" + identity.repo + "` PR #" + identity.pr + " (review state " + identity.state + ", subject OID " + identity.subjectOid + ").");
      lines.push("");
      lines.push("Your only write path is: " + childStore + "/join/" + boxId + ".jsonl");
      lines.push("");
      lines.push("Claims: read " + childStore + "/join/claims-list.json — read every id/statement; ignore anything outside it.");
      lines.push("Units in order (read each exact payload file):");
      for (const unit of units) lines.push("- " + unit.unit_id + " — " + childStore + "/" + UNITS_DIR + "/" + posixBasename(unit.file));
      lines.push("");
      lines.push("Write compact JSONL, exactly one row per assigned unit in listed order:");
      lines.push('{"unit_id":"…","links":[{"claim_id":"…","closeness":"high","role_hint":"implements","witness":"…"}],"unresolved":null}');
      lines.push("");
      lines.push('A link says "look here", not "this works". high = plainly where the claim\'s subject lives; medium = partially related; low = weak. Include every witnessed link; no per-unit cap. Never duplicate a (unit_id,claim_id) pair. claim_id must exist in the complete supplied claims list. role_hint is implements | tests | necessary-support | removes | changes.');
      lines.push('Witness: nonempty verbatim fragment from THIS unit\'s file, include its diff marker, single line, <=160 characters; never quote another unit. If the unit cuts a block, reason only from bytes present. Use unresolved:null when decidable; otherwise a specific reason. Zero links still needs a row with links:[]; missing output is not an empty match. No fences or prose in the file. Appending is optional. Copy the output path character-for-character and verify that exact file exists before reporting success.');
      lines.push("");
      lines.push('Return one JSON object, no fences: {"status":"complete"|"inconclusive"|"blocked","box_id":"' + boxId + '","units_processed":<n>,"rows":<n>,"links_by_closeness":{"high":<n>,"medium":<n>,"low":<n>},"zero_link_units":[…],"unresolved_units":[…],"artifact_ref":"join/' + boxId + '.jsonl","sha256":"<sha256 of the file>"}. Do not paste JSONL. Do not write anywhere else; do not modify the subject tree; do not run tests.');
      return Buffer.from(lines.join("\n") + "\n", "utf8");
    };

    function stage() {
      if (!/^\d+$/.test(ceilingArg) || !Number.isSafeInteger(Number(ceilingArg))) {
        return refuse("needs-input", "--input-ceiling-bytes must be a nonnegative safe integer");
      }
      const ceiling = Number(ceilingArg);

      const joinCheck = joinDir(false);
      if (joinCheck.error) return refuse("evidence-failed", joinCheck.error);

      let capture;
      try {
        capture = JSON.parse(fs.readFileSync(path.join(store, CAPTURE_REL), "utf8"));
      } catch (problem) {
        return refuse("needs-input", "capture manifest unreadable or malformed: " + CAPTURE_REL);
      }
      if (!isObject(capture)) return refuse("needs-input", "capture manifest is not an object: " + CAPTURE_REL);
      if (!isText(capture.run) || !isText(capture.review_state) || !isText(capture.base_oid) || !isText(capture.subject_oid)) {
        return refuse("needs-input", "capture manifest is missing an identity field");
      }
      const runMatch = capture.run.match(RUN_ID);
      if (!runMatch) return refuse("needs-input", "capture run does not parse as <repo>#<n>: " + capture.run);
      if (!REPO_PART.test(runMatch[1])) {
        return refuse("needs-input", "capture run repo has characters outside [A-Za-z0-9._/-]: " + runMatch[1]);
      }
      if (!OID40.test(capture.base_oid)) {
        return refuse("needs-input", "capture base_oid must be 40 lowercase hex: " + CAPTURE_REL);
      }
      if (!OID40.test(capture.subject_oid)) {
        return refuse("needs-input", "capture subject_oid must be 40 lowercase hex: " + CAPTURE_REL);
      }
      if (CONTROL.test(capture.review_state)) {
        return refuse("needs-input", "capture review_state contains control characters: " + CAPTURE_REL);
      }
      const identity = { repo: runMatch[1], pr: runMatch[2], state: capture.review_state, subjectOid: capture.subject_oid };
      const warnings = [];
      if (isText(runId) && runId !== capture.run) warnings.push("frame run disagrees with the capture manifest");
      if (isText(reviewState) && reviewState !== capture.review_state) warnings.push("frame review_state disagrees with the capture manifest");
      if (isText(baseOid) && baseOid !== capture.base_oid) warnings.push("frame base_oid disagrees with the capture manifest");
      if (isText(subjectOid) && subjectOid !== capture.subject_oid) warnings.push("frame subject_oid disagrees with the capture manifest");

      let draft;
      try {
        draft = JSON.parse(fs.readFileSync(path.join(store, CLAIMS_REL), "utf8"));
      } catch (problem) {
        return refuse("needs-input", "claims draft unreadable or malformed: " + CLAIMS_REL);
      }
      if (!isObject(draft) || !Array.isArray(draft.claims) || draft.claims.length === 0) {
        return refuse("needs-input", "claims draft has no claims: " + CLAIMS_REL);
      }
      const claims = [];
      for (let claimIndex = 0; claimIndex < draft.claims.length; claimIndex++) {
        const claim = draft.claims.at(claimIndex);
        if (!isObject(claim) || !isText(claim.id)) {
          return refuse("needs-input", "claims draft entry invalid: " + CLAIMS_REL + " #" + claimIndex);
        }
        if (typeof claim.statement !== "string" || claim.statement.trim() === "") {
          return refuse("needs-input", "claims draft entry has no nonempty statement: " + claim.id);
        }
        claims.push(claim);
      }

      let manifestBuf;
      let manifest;
      try {
        manifestBuf = fs.readFileSync(path.join(store, MANIFEST_REL));
        manifest = JSON.parse(manifestBuf.toString("utf8"));
      } catch (problem) {
        return refuse("needs-input", "units manifest unreadable or malformed: " + MANIFEST_REL);
      }
      if (!isObject(manifest) || !Array.isArray(manifest.units) || manifest.units.length === 0) {
        return refuse("needs-input", "units manifest shape invalid: " + MANIFEST_REL);
      }
      const manifestSha = sha256(manifestBuf);

      const units = [];
      const packable = [];
      let opaqueCount = 0;
      const seenUnitIds = new Set();
      const seenBasenames = new Set();
      for (const unit of manifest.units) {
        if (!isObject(unit) || !isText(unit.unit_id) || !isText(unit.file) || !isCount(unit.byte_len)) {
          return refuse("needs-input", "units manifest entry invalid: " + MANIFEST_REL);
        }
        if (SPACE_OR_CONTROL.test(unit.unit_id)) {
          return refuse("needs-input", "unit_id contains whitespace or control characters: " + unit.unit_id);
        }
        if (seenUnitIds.has(unit.unit_id)) return refuse("needs-input", "duplicate unit_id: " + unit.unit_id);
        seenUnitIds.add(unit.unit_id);
        const base = posixBasename(unit.file);
        if (base === "") return refuse("needs-input", "unit file has no basename: " + unit.unit_id);
        if (seenBasenames.has(base)) {
          return refuse("needs-input", "duplicate unit basename: " + base + " (unit " + unit.unit_id + ")");
        }
        seenBasenames.add(base);
        const rel = UNITS_DIR + "/" + base;
        let size = -1;
        try {
          size = fs.statSync(path.join(store, rel)).size;
        } catch (problem) {
          return refuse("needs-input", "unit payload missing: " + unit.unit_id);
        }
        if (size !== unit.byte_len) {
          return refuse("needs-input", "unit payload size disagrees with the manifest: " + unit.unit_id + " (" + size + " != " + unit.byte_len + ")");
        }
        units.push(unit);
        if (unit.boundary_kind === "opaque") opaqueCount += 1;
        else packable.push(unit);
      }
      if (packable.length === 0) return refuse("needs-input", "every unit is opaque; nothing to pack");

      const projection = claims.map((claim) => ({ id: claim.id, statement: claim.statement }));
      const claimsListBytes = Buffer.from(pyValue(projection, 0) + "\n", "utf8");
      const claimsListSha = sha256(claimsListBytes);

      // Greedy packing by input length only: instructions + the full claims list + whole
      // units in manifest order, charging fixed input first; never split a unit.
      const boxes = [];
      let index = 0;
      while (index < packable.length) {
        if (boxes.length > MAX_BOXES - 1) {
          return refuse("needs-input", "packing would derive more than " + MAX_BOXES + " boxes (ids box-0000..box-9999); raise --input-ceiling-bytes or split the inventory");
        }
        const candidate = [];
        while (index < packable.length) {
          const trial = candidate.concat([packable.at(index)]);
          const trialId = "box-" + pad4(boxes.length);
          const trialInstr = renderInstructions(trialId, trial, identity);
          let trialUnits = 0;
          for (const unit of trial) trialUnits += unit.byte_len;
          if (trialInstr.length + claimsListBytes.length + trialUnits <= ceiling) {
            candidate.push(packable.at(index));
            index += 1;
          } else {
            break;
          }
        }
        if (candidate.length === 0) {
          return refuse("needs-input", "unit " + packable.at(index).unit_id + " byte_len=" + packable.at(index).byte_len + " does not fit an empty box at ceiling " + ceiling);
        }
        boxes.push(candidate);
      }

      const derivedIds = boxes.map((entry, i) => "box-" + pad4(i));
      const listed = joinNames();
      if (listed.error) return refuse("evidence-failed", listed.error);
      const stale = staleTargets(listed.names, derivedIds);
      if (stale.length > 0) return refuse("frozen-artifact", "stale box artifacts outside the derived set: " + stale.join(", "));

      fs.mkdirSync(path.join(staging, "join"), { recursive: true });
      fs.writeFileSync(path.join(staging, CLAIMS_LIST_REL), claimsListBytes);
      const boxDigests = [];
      for (let i = 0; i < boxes.length; i++) {
        const boxId = derivedIds.at(i);
        const instr = renderInstructions(boxId, boxes.at(i), identity);
        const ids = [];
        let total = 0;
        for (const unit of boxes.at(i)) {
          ids.push(unit.unit_id);
          total += unit.byte_len;
        }
        const assignment = {
          box_id: boxId,
          output_path: "join/" + boxId + ".jsonl",
          units: ids,
          unit_count: ids.length,
          units_dir: UNITS_DIR,
          total_unit_bytes: total,
          claims_list_path: CLAIMS_LIST_REL,
          claims_list_bytes: claimsListBytes.length,
          input_ceiling_bytes: ceiling,
          manifest_ref: MANIFEST_REL,
          manifest_sha256: manifestSha,
        };
        const assignmentBytes = Buffer.from(pyValue(assignment, 0) + "\n", "utf8");
        fs.writeFileSync(path.join(staging, "join", boxId + ASSIGNMENT_SUFFIX), assignmentBytes);
        fs.writeFileSync(path.join(staging, "join", boxId + INSTRUCTIONS_SUFFIX), instr);
        boxDigests.push({
          box_id: boxId,
          unit_count: ids.length,
          total_unit_bytes: total,
          box_input_bytes: instr.length + claimsListBytes.length + total,
          instructions_sha256: sha256(instr),
          assignment_sha256: sha256(assignmentBytes),
        });
      }
      const targets = [CLAIMS_LIST_REL];
      for (const boxId of derivedIds) {
        targets.push("join/" + boxId + ASSIGNMENT_SUFFIX);
        targets.push("join/" + boxId + INSTRUCTIONS_SUFFIX);
      }
      fs.writeFileSync(path.join(staging, TARGETS_REL), JSON.stringify({ boxes: derivedIds, targets: targets }, null, 2) + "\n");

      out({
        ok: true,
        units: units.length,
        opaque_units: opaqueCount,
        claims: claims.length,
        ceiling: ceiling,
        claims_list: { path: CLAIMS_LIST_REL, bytes: claimsListBytes.length, sha256: claimsListSha },
        manifest_sha256: manifestSha,
        boxes: boxDigests,
        warnings: warnings,
      });
      return 0;
    }

    function promote() {
      const targetsPath = path.join(staging, TARGETS_REL);
      if (!fs.existsSync(targetsPath)) return refuse("needs-input", "staged target list missing: " + TARGETS_REL);
      let plan;
      try {
        plan = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
      } catch (problem) {
        return refuse("needs-input", "staged target list is malformed: " + TARGETS_REL);
      }
      if (!isObject(plan) || !Array.isArray(plan.boxes) || !Array.isArray(plan.targets)) {
        return refuse("needs-input", "staged target list shape invalid: " + TARGETS_REL);
      }
      for (const boxId of plan.boxes) {
        if (typeof boxId !== "string" || !/^box-\d{4}$/.test(boxId)) return refuse("needs-input", "staged box id invalid: " + String(boxId));
      }

      // One promotion at a time. The lock is created with `wx` (EEXIST => another run owns
      // it) and always removed in `finally`, including every refusal path. Stale-lock
      // recovery is manual: the file records pid and UTC time; inspect it and remove it only
      // when no p0-pack process is active. A crash between the final renames can still leave
      // a prefix of rewritten targets (see the header note).
      const lockPath = path.join(store, ".p0-pack.lock");
      let lockHeld = false;
      try {
        try {
          fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, utc: new Date().toISOString() }) + "\n", { flag: "wx" });
          lockHeld = true;
        } catch (problem) {
          if (problem && problem.code === "EEXIST") {
            return refuse("frozen-artifact", "store lock exists: " + lockPath + " (pid/utc inside; remove it only if no p0-pack run is active)");
          }
          return refuse("evidence-failed", "cannot create the store lock " + lockPath + ": " + errorText(problem));
        }

        const joinCheck = joinDir(true);
        if (joinCheck.error) return refuse("evidence-failed", joinCheck.error);
        const joinReal = joinCheck.dir;

        const listed = joinNames();
        if (listed.error) return refuse("evidence-failed", listed.error);
        const stale = staleTargets(listed.names, plan.boxes);
        if (stale.length > 0) return refuse("frozen-artifact", "stale box artifacts outside the derived set: " + stale.join(", "));

        // Overwrite guard: rewriting the dispatch while recorded downstream outputs exist
        // would silently invalidate them. It applies to every overwrite, including a replay
        // render; replay cases start from an empty `join/` instead of copying downstream
        // artifacts into the scratch store.
        if (allowOverwrite) {
          const downstream = [];
          for (const name of listed.names) {
            if (name === "join-draft.v1.json") {
              downstream.push(name);
              continue;
            }
            const dot = name.indexOf(".");
            if (dot < 0) continue;
            const boxId = name.slice(0, dot);
            if (!/^box-\d{4}$/.test(boxId)) continue;
            const suffix = name.slice(dot);
            if (suffix !== ASSIGNMENT_SUFFIX && suffix !== INSTRUCTIONS_SUFFIX) downstream.push(name);
          }
          for (const name of ["run-manifest.json", "run-manifest.json.sha256"]) {
            if (fs.existsSync(path.join(store, name))) downstream.push(name);
          }
          if (downstream.length > 0) {
            return refuse("frozen-artifact", "downstream artifacts exist; --allow-overwrite would rewrite dispatch under them: " + downstream.sort().join(", "));
          }
        }

        // Freeze check and write plan. Every read is guarded: an unreadable target is an
        // evidence failure, never a silent skip.
        const changed = [];
        const skipped = [];
        for (const target of plan.targets) {
          if (typeof target !== "string" || target.indexOf("join/") !== 0 || hasDotDot(target) || CONTROL.test(target)) {
            return refuse("needs-input", "staged target path invalid: " + String(target));
          }
          const sourcePath = path.join(staging, target);
          const targetAbs = path.join(store, target);
          if (path.dirname(targetAbs) !== joinReal) return refuse("needs-input", "staged target escapes join: " + target);
          let source;
          try {
            source = fs.readFileSync(sourcePath);
          } catch (problem) {
            return refuse("needs-input", "staged artifact missing: " + target);
          }
          let existing = null;
          try {
            existing = fs.lstatSync(targetAbs);
          } catch (problem) {
            if (!problem || problem.code !== "ENOENT") {
              return refuse("evidence-failed", "cannot inspect target " + target + ": " + errorText(problem));
            }
          }
          if (existing && existing.isSymbolicLink()) {
            return refuse("evidence-failed", "target is a symlink; refusing to write through it: " + target);
          }
          if (existing) {
            let current;
            try {
              current = fs.readFileSync(targetAbs);
            } catch (problem) {
              return refuse("evidence-failed", "cannot read target " + target + ": " + errorText(problem));
            }
            if (current.equals(source)) {
              skipped.push(target);
              continue;
            }
            if (!allowOverwrite) {
              return refuse("frozen-artifact", target + " exists with different bytes; pass --allow-overwrite to rewrite it");
            }
          }
          changed.push({
            target: target,
            targetAbs: targetAbs,
            source: source,
            existed: Boolean(existing),
            original: null,
            tmpAbs: targetAbs + ".p0-pack-tmp-" + process.pid + "-" + crypto.randomBytes(8).toString("hex"),
          });
        }

        // Pre-stage every changed target before the first rename. A staging failure removes
        // all tmps and leaves the store untouched.
        try {
          for (const entry of changed) {
            fs.mkdirSync(path.dirname(entry.targetAbs), { recursive: true });
            fs.writeFileSync(entry.tmpAbs, entry.source);
          }
        } catch (problem) {
          for (const entry of changed) {
            try { fs.rmSync(entry.tmpAbs, { force: true }); } catch (ignored) { /* best-effort cleanup */ }
          }
          return refuse("evidence-failed", "promotion staging failed (" + errorText(problem) + "); no target was written");
        }

        // Snapshot the bytes of every changed target before the first rename, so a failed
        // rename or verification can restore the previous store state.
        try {
          for (const entry of changed) {
            if (entry.existed) entry.original = fs.readFileSync(entry.targetAbs);
          }
        } catch (problem) {
          for (const entry of changed) {
            try { fs.rmSync(entry.tmpAbs, { force: true }); } catch (ignored) { /* best-effort cleanup */ }
          }
          return refuse("evidence-failed", "cannot snapshot target bytes (" + errorText(problem) + "); no target was written");
        }

        const promoted = [];
        const renamed = [];
        let failure = "";
        try {
          for (const entry of changed) {
            fs.renameSync(entry.tmpAbs, entry.targetAbs);
            renamed.push(entry);
            promoted.push(entry.target);
          }
          for (const entry of changed) {
            const written = fs.readFileSync(entry.targetAbs);
            if (!written.equals(entry.source)) throw new Error("verification mismatch: " + entry.target);
          }
        } catch (problem) {
          failure = errorText(problem);
        }
        if (failure !== "") {
          let rolledBack = true;
          for (let i = renamed.length - 1; i >= 0; i--) {
            const entry = renamed.at(i);
            try {
              if (entry.original) fs.writeFileSync(entry.targetAbs, entry.original);
              else fs.rmSync(entry.targetAbs, { force: true });
            } catch (problem) {
              rolledBack = false;
            }
          }
          for (const entry of changed) {
            try { fs.rmSync(entry.tmpAbs, { force: true }); } catch (problem) { rolledBack = false; }
          }
          return refuse("evidence-failed", "promotion failed (" + failure + "); rollback " + (rolledBack ? "succeeded" : "FAILED - the store may be inconsistent"));
        }

        const claimsListSha = sha256(fs.readFileSync(path.join(staging, CLAIMS_LIST_REL)));
        out({ ok: true, promoted: promoted, skipped: skipped, claims_list_sha256: claimsListSha, boxes: plan.boxes });
        return 0;
      } finally {
        if (lockHeld) {
          try { fs.unlinkSync(lockPath); } catch (ignored) { /* lock cleanup is best-effort */ }
        }
      }
    }

    if (!store) return refuse("needs-input", "store is not a readable directory" + (storeError ? ": " + storeError : ""));
    if (!staging) return refuse("needs-input", "--staging is required");
    if (childStoreArg !== "") {
      if (childStoreArg.charAt(0) !== "/" || hasDotDot(childStoreArg) || SPACE_OR_CONTROL.test(childStoreArg)) {
        return refuse("needs-input", "--child-store must be an absolute POSIX path without '..' segments or whitespace/control characters (it is embedded in child instructions)");
      }
    }
    return promoteMode ? promote() : stage();
  };

  // ------------------------------------------------------------------ pack (SPEC step 1)
  const packPath = evidenceDir + "/pack.cjs";
  const writePack = workflow.shell(heredoc(PACK_TAG, "(" + PACK_MAIN.toString() + ")();\n", packPath), { timeout: 30 });
  if (!writePack.ok) return workflow.exit(refuse("needs-input", { detail: "cannot write the pack helper" }));
  const stageCall =
    "node " + quote(packPath)
    + " --store " + quote(store)
    + " --staging " + quote(stageDir)
    + " --input-ceiling-bytes " + inputCeiling
    + " --run-id " + quote(runId)
    + " --review-state " + quote(reviewState)
    + " --base-oid " + quote(baseOid)
    + " --subject-oid " + quote(subjectOid)
    + (childStoreFlag === "" ? "" : " --child-store " + quote(childStoreFlag));
  const stageRun = workflow.shell(stageCall, { timeout: PACK_TIMEOUT_S });
  const digest = parseTail(stageRun.output);
  if (stageRun.truncated === true || !digest || typeof digest !== "object") {
    return workflow.exit(refuse("evidence-failed", { detail: "pack helper produced no digest: " + clip(String(stageRun.output || ""), 200) }));
  }
  if (digest.ok !== true) {
    const reason = REASONS.indexOf(digest.reason) >= 0 ? digest.reason : "evidence-failed";
    return workflow.exit(refuse(reason, { detail: clip(digest.error || "pack refused", 300) }));
  }

  // ------------------------------------------------------------ digest cross-check (step 2)
  const units = typeof digest.units === "number" ? digest.units : 0;
  const opaqueUnits = typeof digest.opaque_units === "number" ? digest.opaque_units : 0;
  const claimsCount = typeof digest.claims === "number" ? digest.claims : 0;
  const boxes = Array.isArray(digest.boxes) ? digest.boxes : [];
  const claimsListSha = digest.claims_list && typeof digest.claims_list.sha256 === "string" ? digest.claims_list.sha256 : "";
  if (!HEX64.test(claimsListSha)) return workflow.exit(refuse("evidence-failed", { detail: "claims-list sha256 is not 64 lowercase hex" }));
  if (boxes.length === 0) return workflow.exit(refuse("evidence-failed", { detail: "the digest carries no boxes" }));
  if (boxes.length > MAX_BOXES) return workflow.exit(refuse("evidence-failed", { detail: "the digest carries more boxes than the id space (box-0000..box-9999)" }));
  const boxUnitSum = boxes.reduce((sum, entry) => sum + (entry.unit_count || 0), 0);
  if (boxUnitSum + opaqueUnits !== units) {
    return workflow.exit(refuse("evidence-failed", { detail: "unit count cross-check failed: boxes " + boxUnitSum + " + opaque " + opaqueUnits + " != units " + units }));
  }
  for (let i = 0; i < boxes.length; i++) {
    const boxId = boxes.at(i) && typeof boxes.at(i).box_id === "string" ? boxes.at(i).box_id : "";
    if (boxId !== "box-" + pad4(i)) return workflow.exit(refuse("evidence-failed", { detail: "box id sequence failed at index " + i }));
  }

  // --------------------------------------------------- staging-compare promotion (step 3)
  const promoteCall =
    "node " + quote(packPath)
    + " --store " + quote(store)
    + " --staging " + quote(stageDir)
    + " --promote"
    + (childStoreFlag === "" ? "" : " --child-store " + quote(childStoreFlag))
    + (allowOverwrite ? " --allow-overwrite" : "");
  const promoteRun = workflow.shell(promoteCall, { timeout: PACK_TIMEOUT_S });
  const promotion = parseTail(promoteRun.output);
  if (promoteRun.truncated === true || !promotion || typeof promotion !== "object") {
    return workflow.exit(refuse("evidence-failed", { detail: "promotion produced no digest: " + clip(String(promoteRun.output || ""), 200) }));
  }
  if (promotion.ok !== true) {
    const reason = REASONS.indexOf(promotion.reason) >= 0 ? promotion.reason : "evidence-failed";
    return workflow.exit(refuse(reason, { detail: clip(promotion.error || "promotion refused", 300) }));
  }
  if (promotion.claims_list_sha256 !== claimsListSha) {
    return workflow.exit(refuse("evidence-failed", { detail: "promotion digest disagrees with the staged digest" }));
  }
  const promoted = Array.isArray(promotion.promoted) ? promotion.promoted : [];
  const skipped = Array.isArray(promotion.skipped) ? promotion.skipped : [];

  // ------------------------------------------------------------- checkpoint, card, exit
  workflow.checkpoint({ phase: "p0-pack", units: units, boxes: boxes.length, claims_list_sha: claimsListSha });
  const lines = [
    "p0-pack — P0.4 dispatch artifacts promoted (production only; verify join decides nothing here)",
    "reason ok · units " + units + " (opaque " + opaqueUnits + ") · claims " + claimsCount + " · boxes " + boxes.length + " · ceiling " + inputCeiling,
    "claims-list " + claimsListSha.slice(0, 12) + " · manifest " + String(digest.manifest_sha256 || "").slice(0, 12),
  ];
  for (const entry of boxes) {
    lines.push("box " + String(entry.box_id) + " · units " + String(entry.unit_count) + " · bytes " + String(entry.total_unit_bytes) + " · input " + String(entry.box_input_bytes) + " · headroom " + String(Number(inputCeiling) - Number(entry.box_input_bytes)));
  }
  if (Array.isArray(digest.warnings)) {
    for (const warning of digest.warnings.slice(0, 3)) lines.push("warning " + clip(warning, 120));
  }
  lines.push("promoted " + promoted.length + " · skipped " + skipped.length + " · store " + store);
  lines.push("evidence " + evidenceDir);
  lines.push("next: dispatch the P0.4 box fleet, then p0-close prep");
  console.log(lines.join("\n"));
  return workflow.exit({
    reason: "ok",
    claims_list_sha256: claimsListSha,
    manifest_sha256: digest.manifest_sha256,
    ceiling: Number(inputCeiling),
    units: units,
    opaque_units: opaqueUnits,
    claims: claimsCount,
    boxes: boxes,
    promoted: promoted,
    skipped: skipped,
    paths: { store: store, child_store: childStoreFlag === "" ? store : childStoreFlag, evidence: evidenceDir },
  });
});
