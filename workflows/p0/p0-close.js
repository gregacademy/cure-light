// workflows/p0/p0-close.js — merge + validate + p05 + envelope, as one deterministic run.
//
// Spec: workflows/p0/SPEC.md. Builder loop and purity rules: workflows/AUTHORING.md.
// Design source of record: cure-light-p0-close-workflow-proposal.md (workspace root).
//
// The workflow replaces the ad-hoc ai070/ai071/ai072 step with one hash-pinned host tool:
//   args gate -> verifier identity -> merge/validate/p05 (staging) -> digest cross-check ->
//   envelope (shadow store) -> staging-compare promotion -> card + exit.
// Every refusal leaves the store byte-identical: all production happens in the evidence
// staging dir or a shadow copy of the store; the store is written only by the promotion
// phase, and only after every freeze check has passed.
//
// Contract notes that matter for a future reader:
//   * Exactly one top-level `return defineWorkflow((workflow) => { ... })`; synchronous;
//     no imports; `workflow.shell` is the only I/O; model handles are never used.
//   * The merge helper is embedded (MERGE_MAIN) and materialized into the evidence dir, so
//     the shell transcript carries no run-authored logic beyond one heredoc write.
//   * The exit payload is the machine result; never the process exit code.
//   * The draft is emitted as Python `json.dumps(indent=2, ensure_ascii=True)` bytes (no
//     trailing newline); the p05 records are the same writer plus one trailing newline.
//     The baseline acceptance tier is the proof of byte equality.

return defineWorkflow((workflow) => {
  const REASONS = ["ok", "needs-input", "verifier-pin-mismatch", "validation-failed", "frozen-artifact", "evidence-failed"];
  const IDENTITY_FLAGS = ["--run-id", "--review-state", "--base-oid", "--subject-oid"];
  const VALUE_FLAGS = [
    "--store",
    "--verifier",
    "--verifier-sha256",
    "--chunker-sha256",
    "--input-ceiling-bytes",
    "--operator-ref",
  ].concat(IDENTITY_FLAGS);
  const HEX64 = /^[0-9a-f]{64}$/;
  const OID40 = /^[0-9a-f]{40}$/;
  const UINT = /^\d+$/;
  const MERGE_TAG = "P0_CLOSE_MERGE"; // heredoc delimiter; the collision loop keeps it safe
  const MERGE_TIMEOUT_S = 300; // SPEC bounds: merge <=300 s
  const ENVELOPE_TIMEOUT_S = 120; // SPEC bounds: envelope <=120 s

  const clip = (value, max) => {
    const text = String(value === null || value === undefined ? "" : value);
    return text.length <= max ? text : text.slice(0, max);
  };
  const quote = (value) => "'" + String(value).split("'").join("'\\''") + "'";
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
  const heredoc = (tag, payload, file) => {
    let delim = tag;
    while (payload.indexOf(delim) >= 0) delim = delim + "_";
    return "cat > " + quote(file) + " <<'" + delim + "'\n" + payload + "\n" + delim + "\n";
  };
  // The payload builder is pure: workflow.exit is called from the workflow arrow body
  // itself, because the canonical compiler rejects the workflow object in a nested scope.
  const refuse = (reason, metadata) => {
    const payload = { reason: REASONS.indexOf(reason) >= 0 ? reason : "needs-input" };
    if (metadata) Object.assign(payload, metadata);
    return payload;
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
      if (hasValue || (i + 1 < tokens.length && tokens.at(i + 1).indexOf("--") !== 0)) {
        return workflow.exit(refuse("needs-input", { detail: "--allow-overwrite accepts no value" }));
      }
      allowOverwrite = true;
      continue;
    }
    if (VALUE_FLAGS.indexOf(name) < 0) return workflow.exit(refuse("needs-input", { detail: "unknown flag: " + clip(name, 80) }));
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
  const verifier = values.get("--verifier");
  const verifierSha = values.get("--verifier-sha256");
  const chunkerSha = values.get("--chunker-sha256");
  const inputCeiling = values.get("--input-ceiling-bytes");
  const operatorRef = values.get("--operator-ref");
  const runId = values.get("--run-id");
  const reviewState = values.get("--review-state");
  const baseOid = values.get("--base-oid");
  const subjectOid = values.get("--subject-oid");
  if (!HEX64.test(verifierSha)) return workflow.exit(refuse("needs-input", { detail: "--verifier-sha256 must be 64 lowercase hex" }));
  if (!HEX64.test(chunkerSha)) return workflow.exit(refuse("needs-input", { detail: "--chunker-sha256 must be 64 lowercase hex" }));
  if (!UINT.test(inputCeiling)) return workflow.exit(refuse("needs-input", { detail: "--input-ceiling-bytes must be a nonnegative integer" }));
  if (!OID40.test(baseOid)) return workflow.exit(refuse("needs-input", { detail: "--base-oid must be 40 lowercase hex" }));
  if (!OID40.test(subjectOid)) return workflow.exit(refuse("needs-input", { detail: "--subject-oid must be 40 lowercase hex" }));
  if (runId === "" || reviewState === "" || operatorRef === "") {
    return workflow.exit(refuse("needs-input", { detail: "--run-id, --review-state and --operator-ref must be nonempty" }));
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
  const evidenceDir = cwd.replace(/\/+$/, "") + "/.tmp/p0-close/" + stamp + "-" + pid;
  const stageDir = evidenceDir + "/stage";
  const shadowDir = evidenceDir + "/shadow";

  const storeCheck = workflow.shell("test -d " + quote(store), { timeout: 30 });
  if (!storeCheck.ok) return workflow.exit(refuse("needs-input", { detail: "store is not a directory" }));
  const posture = workflow.state();
  if (posture && posture.readonly === true) {
    return workflow.exit(refuse("needs-input", { detail: "the session is readonly; p0-close writes evidence under .tmp" }));
  }
  const nodeProbe = workflow.shell("node --version", { timeout: 30 });
  if (!nodeProbe.ok) return workflow.exit(refuse("needs-input", { detail: "node is not available" }));
  workflow.checkpoint({ phase: "args", store: store, evidence: evidenceDir });

  // ------------------------------------------------------- verifier identity (SPEC step 1)
  const hashProbe = workflow.shell("sha256sum " + quote(verifier), { timeout: 60 });
  const observedVerifierSha = String(hashProbe.output || "").trim().split(/\s+/)[0] || "";
  if (!hashProbe.ok || observedVerifierSha !== verifierSha) {
    return workflow.exit(refuse("verifier-pin-mismatch", {
      detail: "recorded " + verifierSha.slice(0, 12) + " observed " + (clip(observedVerifierSha, 12) || "none"),
    }));
  }
  const mkdir = workflow.shell("mkdir -p " + quote(stageDir) + " " + quote(shadowDir), { timeout: 30 });
  if (!mkdir.ok) return workflow.exit(refuse("needs-input", { detail: "cannot create the evidence directory" }));

  // --------------------------------------------------------------- merge helper (embed)
  // MERGE_MAIN is materialized as the evidence-dir program. It is self-contained: no
  // imports beyond node builtins, no backticks (heredoc extraction), and the only writer of
  // the store is its `--promote` mode.
  const MERGE_MAIN = function () {
    "use strict";
    const fs = require("node:fs");
    const path = require("node:path");
    const crypto = require("node:crypto");

    const DRAFT_REL = "join/join-draft.v1.json";
    const ENVELOPE_REL = "run-manifest.json";
    const ENVELOPE_SHA_REL = "run-manifest.json.sha256";
    const MAX_ERRORS = 50;
    const CLOSENESS = new Set(["high", "medium", "low"]);
    const ROLES = new Set(["implements", "tests", "necessary-support", "removes", "changes"]);
    const METADATA_PREFIXES = [
      "diff --git ", "index ", "--- ", "+++ ", "new file mode ", "deleted file mode ",
      "old mode ", "new mode ", "rename from ", "rename to ", "similarity index ",
      "copy from ", "copy to ", "Binary files ",
    ];

    const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
    const isObject = (value) => value !== null && typeof value === "object" && Array.isArray(value) === false;
    const isText = (value) => typeof value === "string" && value.length > 0;
    const isCount = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const posixDirname = (ref) => {
      const idx = ref.lastIndexOf("/");
      return idx < 0 ? "." : idx === 0 ? "/" : ref.slice(0, idx);
    };
    const posixBasename = (ref) => {
      const idx = ref.lastIndexOf("/");
      return idx < 0 ? ref : ref.slice(idx + 1);
    };

    // Python `json.dumps(..., indent=2, ensure_ascii=True)` compatible writer. The baseline
    // acceptance pins byte equality, so escaping must match exactly: all non-ASCII as
    // \uXXXX (astral as a surrogate pair), control chars as \b \f \n \r \t or \u00xx.
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
      return "{\n" + entries.map(([key, item]) => indent(depth + 1) + pyString(key) + ": " + pyValue(item, depth + 1)).join(",\n") + "\n" + indent(depth) + "}";
    };

    // Witness marker rule mirroring `verify.mjs` (J6): the witness must start a payload line
    // whose first character is +, -, a space context, or "@@ "; `file` metadata units also
    // accept the frozen metadata prefixes.
    const witnessMarkerAllowed = (unit, text) => {
      const head = text.charAt(0);
      if (head === "+" || head === "-" || head === " ") return true;
      if (text.indexOf("@@ ") === 0) return true;
      if (unit && unit.boundary_kind === "file") {
        for (const prefix of METADATA_PREFIXES) if (text.indexOf(prefix) === 0) return true;
      }
      return false;
    };
    const findAtLineBoundary = (payload, needle) => {
      for (let i = payload.indexOf(needle); i !== -1; i = payload.indexOf(needle, i + 1)) {
        if (i === 0 || payload.at(i - 1) === 0x0a) return i;
      }
      return -1;
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
    const ceilingArg = flagValue("--input-ceiling-bytes");
    const runId = flagValue("--run-id");
    const reviewState = flagValue("--review-state");
    const baseOid = flagValue("--base-oid");
    const subjectOid = flagValue("--subject-oid");
    const allowOverwrite = argv.indexOf("--allow-overwrite") >= 0;
    const promoteMode = argv.indexOf("--promote") >= 0;
    const store = storeArg ? path.resolve(storeArg) : "";
    const staging = stagingArg ? path.resolve(stagingArg) : "";
    const out = (value) => process.stdout.write(JSON.stringify(value) + "\n");
    const refuse = (reason, error, errors) => {
      out({
        ok: false,
        reason: reason,
        error: String(error),
        error_count: errors ? errors.length : 0,
        errors: (errors || []).slice(0, 10),
      });
      return 0;
    };
    const listBoxIds = () => {
      const names = fs.readdirSync(path.join(store, "join"));
      return names
        .filter((name) => name.indexOf("box-") === 0 && name.slice(-".assignment.json".length) === ".assignment.json")
        .map((name) => name.slice(0, -".assignment.json".length))
        .sort();
    };

    function stage() {
      if (!/^\d+$/.test(ceilingArg)) return refuse("needs-input", "--input-ceiling-bytes must be a nonnegative integer");
      const ceiling = Number(ceilingArg);

      // Draft identity is the store's captured run identity: the envelope generator derives
      // its identity tuple from the capture manifest and refuses a join draft that disagrees
      // (`identity mismatch: <field>`), so the draft must echo the same bytes' facts. The
      // frame's identity flags are recorded as a warning when they disagree.
      const captureRef = "claims/sources/capture-manifest.json";
      let capture;
      try {
        capture = JSON.parse(fs.readFileSync(path.join(store, captureRef), "utf8"));
      } catch (problem) {
        return refuse("needs-input", "capture manifest unreadable or malformed: " + captureRef);
      }
      if (!isObject(capture)) return refuse("needs-input", "capture manifest is not an object: " + captureRef);
      const identity = {
        run: capture.run,
        review_state: capture.review_state,
        base_oid: capture.base_oid,
        subject_oid: capture.subject_oid,
      };
      if (!isText(identity.run) || !isText(identity.review_state) || !isText(identity.base_oid) || !isText(identity.subject_oid)) {
        return refuse("needs-input", "capture manifest is missing an identity field");
      }
      const warnings = [];
      if (isText(runId) && runId !== identity.run) warnings.push("frame run disagrees with the capture manifest");
      if (isText(reviewState) && reviewState !== identity.review_state) warnings.push("frame review_state disagrees with the capture manifest");
      if (isText(baseOid) && baseOid !== identity.base_oid) warnings.push("frame base_oid disagrees with the capture manifest");
      if (isText(subjectOid) && subjectOid !== identity.subject_oid) warnings.push("frame subject_oid disagrees with the capture manifest");

      let joinNames;
      try {
        joinNames = fs.readdirSync(path.join(store, "join"));
      } catch (problem) {
        return refuse("needs-input", "join/ is not readable in the store");
      }
      const boxIds = listBoxIds();
      if (boxIds.length === 0) return refuse("needs-input", "no join/box-*.assignment.json in the store");

      const assignments = [];
      for (const boxId of boxIds) {
        const rel = "join/" + boxId + ".assignment.json";
        let value;
        try {
          value = JSON.parse(fs.readFileSync(path.join(store, rel), "utf8"));
        } catch (problem) {
          return refuse("needs-input", "assignment unreadable or malformed: " + rel);
        }
        if (!isObject(value)) return refuse("needs-input", "assignment is not an object: " + rel);
        if (value.box_id !== boxId) return refuse("needs-input", "assignment box_id mismatch: " + rel);
        if (!isText(value.output_path)) return refuse("needs-input", "assignment output_path missing: " + rel);
        if (!Array.isArray(value.units) || value.units.some((id) => !isText(id))) return refuse("needs-input", "assignment units invalid: " + rel);
        if (value.unit_count !== value.units.length) return refuse("needs-input", "assignment unit_count mismatch: " + rel);
        if (!isCount(value.input_ceiling_bytes)) return refuse("needs-input", "assignment input_ceiling_bytes invalid: " + rel);
        if (value.input_ceiling_bytes !== ceiling) return refuse("needs-input", "assignment input ceiling differs from --input-ceiling-bytes: " + boxId);
        if (!isText(value.units_dir) || !isText(value.manifest_ref)) return refuse("needs-input", "assignment units_dir/manifest_ref missing: " + rel);
        if (!isText(value.claims_list_path)) return refuse("needs-input", "assignment claims_list_path missing: " + rel);
        assignments.push({ boxId: boxId, value: value });
      }
      const manifestRef = assignments.at(0).value.manifest_ref;
      const unitsDir = assignments.at(0).value.units_dir;
      const claimsListPath = assignments.at(0).value.claims_list_path;
      if (assignments.some((entry) => entry.value.manifest_ref !== manifestRef)) return refuse("needs-input", "assignments disagree on manifest_ref");
      if (assignments.some((entry) => entry.value.units_dir !== unitsDir)) return refuse("needs-input", "assignments disagree on units_dir");
      if (assignments.some((entry) => entry.value.claims_list_path !== claimsListPath)) return refuse("needs-input", "assignments disagree on claims_list_path");
      if (posixDirname(manifestRef) !== unitsDir) return refuse("needs-input", "assignment units_dir does not match manifest_ref");

      let manifestBuf;
      let manifest;
      try {
        manifestBuf = fs.readFileSync(path.join(store, manifestRef));
        manifest = JSON.parse(manifestBuf.toString("utf8"));
      } catch (problem) {
        return refuse("needs-input", "units manifest unreadable or malformed: " + manifestRef);
      }
      if (!isObject(manifest) || !Array.isArray(manifest.units)) return refuse("needs-input", "units manifest shape invalid: " + manifestRef);

      let claimsBuf;
      let claims;
      try {
        claimsBuf = fs.readFileSync(path.join(store, claimsListPath));
        claims = JSON.parse(claimsBuf.toString("utf8"));
      } catch (problem) {
        return refuse("needs-input", "claims list unreadable or malformed: " + claimsListPath);
      }
      if (!Array.isArray(claims)) return refuse("needs-input", "claims list is not an array: " + claimsListPath);
      const claimIds = [];
      for (const claim of claims) {
        if (!isObject(claim) || !isText(claim.id)) return refuse("needs-input", "claims list entry invalid: " + claimsListPath);
        claimIds.push(claim.id);
      }
      const claimSet = new Set(claimIds);

      // Payloads: `units_dir` + basename(unit.file) — the D1 path class cannot recur.
      const unitById = new Map();
      const payloadByUnit = new Map();
      for (const unit of manifest.units) {
        if (!isObject(unit) || !isText(unit.unit_id) || !isText(unit.file)) return refuse("needs-input", "units manifest entry invalid: " + manifestRef);
        const rel = unitsDir + "/" + posixBasename(unit.file);
        let buf;
        try {
          buf = fs.readFileSync(path.join(store, rel));
        } catch (problem) {
          return refuse("needs-input", "unit payload missing: " + unit.unit_id);
        }
        unitById.set(unit.unit_id, unit);
        payloadByUnit.set(unit.unit_id, buf);
      }

      const instructionNames = joinNames.filter((name) => name.slice(-".instructions.md".length) === ".instructions.md");
      const boxes = [];
      for (const entry of assignments) {
        let instrRel = "join/" + entry.boxId + ".instructions.md";
        if (!fs.existsSync(path.join(store, instrRel))) {
          if (instructionNames.length === 1) instrRel = "join/" + instructionNames.at(0);
          else return refuse("needs-input", "instructions file missing: " + entry.boxId);
        }
        let instrBuf;
        let outputBuf;
        try {
          instrBuf = fs.readFileSync(path.join(store, instrRel));
          outputBuf = fs.readFileSync(path.join(store, entry.value.output_path));
        } catch (problem) {
          return refuse("needs-input", "box input unreadable: " + entry.boxId);
        }
        boxes.push({ boxId: entry.boxId, assignment: entry.value, instrRel: instrRel, instrBuf: instrBuf, outputBuf: outputBuf, rows: [], links: 0, duplicates: 0 });
      }

      // Merge validation (SPEC step 2): row presence/order/known units, known claims,
      // enums, witness containment, duplicate pairs. Any error refuses before staging.
      const errors = [];
      const merged = [];
      const pairSeen = new Set();
      let duplicatePairs = 0;
      for (const box of boxes) {
        const text = box.outputBuf.toString("utf8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines.at(i).trim() === "") continue;
          try {
            box.rows.push(JSON.parse(lines.at(i)));
          } catch (problem) {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": row " + (box.rows.length + 1) + " is not JSON");
          }
        }
        if (box.rows.length !== box.assignment.units.length) {
          if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": rows " + box.rows.length + " != assigned " + box.assignment.units.length);
        }
        for (let i = 0; i < box.rows.length; i++) {
          const row = box.rows.at(i);
          if (!isObject(row) || !isText(row.unit_id)) {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": row " + (i + 1) + " is not a unit row");
            continue;
          }
          const expected = box.assignment.units.at(i);
          if (expected !== undefined && row.unit_id !== expected) {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": row " + (i + 1) + " is " + row.unit_id + ", expected " + expected);
          }
          const unit = unitById.get(row.unit_id);
          if (!unit) {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unknown unit " + row.unit_id);
          } else if (unit.boundary_kind === "opaque") {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": opaque unit assigned to a box: " + row.unit_id);
          }
          if (row.unresolved !== null && !isText(row.unresolved)) {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has an invalid unresolved value");
          }
          if (!Array.isArray(row.links)) {
            if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has no links array");
            continue;
          }
          for (const link of row.links) {
            if (!isObject(link)) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has a malformed link");
              continue;
            }
            if (!claimSet.has(link.claim_id)) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " references unknown claim " + String(link.claim_id));
            }
            if (!CLOSENESS.has(link.closeness)) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has invalid closeness " + String(link.closeness));
            }
            if (!ROLES.has(link.role_hint)) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has invalid role_hint " + String(link.role_hint));
            }
            const witness = link.witness;
            if (typeof witness !== "string" || witness.length === 0) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has an empty witness");
            } else if (witness.indexOf("\n") >= 0 || witness.indexOf("\r") >= 0) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has a multiline witness");
            } else if (Array.from(witness).length > 160) {
              if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has a witness over 160 characters");
            } else {
              const payload = payloadByUnit.get(row.unit_id);
              const needle = Buffer.from(witness, "utf8");
              const contained = payload ? payload.indexOf(needle) >= 0 : false;
              const at = payload ? findAtLineBoundary(payload, needle) : -1;
              if (!contained) {
                if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has a witness not in the payload");
              } else if (at < 0) {
                if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has a witness not at a line boundary");
              } else if (!witnessMarkerAllowed(unit, witness)) {
                if (errors.length < MAX_ERRORS) errors.push(box.boxId + ": unit " + row.unit_id + " has a witness without a diff marker");
              }
            }
          }
          merged.push(row);
        }
        for (const row of box.rows) {
          if (!isObject(row) || !Array.isArray(row.links)) continue;
          for (const link of row.links) {
            if (!isObject(link)) continue;
            const key = row.unit_id + "\u0000" + link.claim_id;
            if (pairSeen.has(key)) duplicatePairs += 1;
            else pairSeen.add(key);
          }
        }
        box.duplicates = box.duplicates + 0;
      }
      if (duplicatePairs > 0 && errors.length < MAX_ERRORS) errors.push("duplicate (unit_id, claim_id) pairs: " + duplicatePairs);

      const opaqueUnits = manifest.units.filter((unit) => unit.boundary_kind === "opaque");
      const machineRows = opaqueUnits.map((unit) => ({ unit_id: unit.unit_id, links: [], unresolved: null }));
      const boxSweep = [];
      for (const box of boxes) {
        for (const row of box.rows) if (isObject(row) && isText(row.unit_id)) boxSweep.push(row.unit_id);
      }
      const unionIds = boxSweep.concat(machineRows.map((row) => row.unit_id));
      const manifestIds = manifest.units.map((unit) => unit.unit_id);
      if (unionIds.length !== manifestIds.length || unionIds.some((id, index) => id !== manifestIds.at(index))) {
        if (errors.length < MAX_ERRORS) errors.push("merged unit sweep does not match the units manifest");
      }
      if (errors.length > 0) return refuse("validation-failed", errors.at(0), errors);

      // Derived p05 records and draft; written into the staging dir only.
      const assignedIds = new Set();
      for (const entry of assignments) for (const id of entry.value.units) assignedIds.add(id);
      let machineBytes = 0;
      for (const unit of opaqueUnits) {
        if (assignedIds.has(unit.unit_id)) continue;
        const buf = payloadByUnit.get(unit.unit_id);
        if (buf) machineBytes += buf.length;
      }

      const p05Entries = [];
      let totalLinks = 0;
      let nonAscii = false;
      const scanNonAscii = (value) => {
        if (typeof value === "string") {
          if (/[^\x00-\x7f]/.test(value)) nonAscii = true;
        } else if (Array.isArray(value)) {
          for (const item of value) scanNonAscii(item);
        } else if (isObject(value)) {
          for (const item of Object.values(value)) scanNonAscii(item);
        }
      };
      const boxRefs = [];
      for (const box of boxes) {
        const a = box.assignment;
        const counts = new Map(claimIds.map((id) => [id, 0]));
        const zeroUnits = [];
        const unresolved = [];
        const boxPairs = new Set();
        let links = 0;
        let boxDuplicates = 0;
        for (const row of box.rows) {
          if (!Array.isArray(row.links)) continue;
          if (row.links.length === 0) zeroUnits.push(row.unit_id);
          if (row.unresolved !== null) unresolved.push(row.unit_id);
          for (const link of row.links) {
            counts.set(link.claim_id, (counts.get(link.claim_id) || 0) + 1);
            links += 1;
            const key = row.unit_id + "\u0000" + link.claim_id;
            if (boxPairs.has(key)) boxDuplicates += 1;
            else boxPairs.add(key);
          }
        }
        const zeroClaims = claimIds.filter((id) => (counts.get(id) || 0) === 0);
        const claimLinkCounts = Object.fromEntries(claimIds.map((id) => [id, counts.get(id) || 0]));
        let unitBytes = 0;
        for (const id of a.units) {
          const buf = payloadByUnit.get(id);
          if (buf) unitBytes += buf.length;
        }
        const accountedUnitBytes = unitBytes + machineBytes;
        const boxInputBytes = accountedUnitBytes + claimsBuf.length + box.instrBuf.length;
        const check = {
          file_rows: box.rows.length,
          expected_rows: box.rows.length,
          total_links: links,
          zero_units: zeroUnits,
          zero_claims: zeroClaims,
          unresolved: unresolved,
          error_count: 0,
          errors: [],
          claim_link_counts: claimLinkCounts,
        };
        const evidence = {
          expected_rows: box.rows.length,
          received_rows: box.rows.length,
          total_links: links,
          zero_units: zeroUnits,
          zero_claims: zeroClaims,
          unresolved: unresolved,
          duplicate_pairs: boxDuplicates,
          error_count: 0,
          errors: [],
          budget: {
            input_ceiling_bytes: ceiling,
            unit_bytes: accountedUnitBytes,
            claims_list_bytes: claimsBuf.length,
            instructions_bytes: box.instrBuf.length,
            box_input_bytes: boxInputBytes,
            headroom_bytes: ceiling - boxInputBytes,
            output_bytes: box.outputBuf.length,
            output_links: links,
          },
        };
        const checkRel = "join/" + a.box_id + ".p05-check.json";
        const evidenceRel = "join/" + a.box_id + ".p05-evidence.json";
        const checkText = pyValue(check, 0) + "\n";
        const evidenceText = pyValue(evidence, 0) + "\n";
        fs.mkdirSync(path.join(staging, "join"), { recursive: true });
        fs.writeFileSync(path.join(staging, checkRel), Buffer.from(checkText, "utf8"));
        fs.writeFileSync(path.join(staging, evidenceRel), Buffer.from(evidenceText, "utf8"));
        scanNonAscii(check);
        scanNonAscii(evidence);
        boxRefs.push({
          box_id: a.box_id,
          path: a.output_path,
          sha256: sha256(box.outputBuf),
          rows: box.rows.length,
          links: links,
        });
        p05Entries.push({
          box_id: a.box_id,
          unit_count: a.unit_count,
          rows: box.rows.length,
          links: links,
          check: { path: checkRel, bytes: Buffer.byteLength(checkText, "utf8"), sha256: sha256(Buffer.from(checkText, "utf8")) },
          evidence: { path: evidenceRel, bytes: Buffer.byteLength(evidenceText, "utf8"), sha256: sha256(Buffer.from(evidenceText, "utf8")) },
        });
        totalLinks += links;
      }

      const candidateUnclaimed = [];
      for (const row of merged) {
        if (Array.isArray(row.links) && row.links.length === 0 && row.unresolved === null) candidateUnclaimed.push(row.unit_id);
      }
      const draft = {
        schema_version: "join-draft/1",
        run: identity.run,
        review_state: identity.review_state,
        base_oid: identity.base_oid,
        subject_oid: identity.subject_oid,
        units_manifest: {
          ref: manifestRef,
          sha256: sha256(manifestBuf),
          schema_version: manifest.schema_version,
          unit_count: manifest.units.length,
        },
        boxes: boxRefs,
        units: merged,
        machine: machineRows,
        candidate_unclaimed: candidateUnclaimed,
      };
      const draftText = pyValue(draft, 0);
      fs.mkdirSync(path.join(staging, "join"), { recursive: true });
      fs.writeFileSync(path.join(staging, DRAFT_REL), Buffer.from(draftText, "utf8"));
      scanNonAscii(draft);

      out({
        ok: true,
        units: merged.length,
        links: totalLinks,
        machine_count: machineRows.length,
        manifest_unit_count: manifest.units.length,
        error_count: 0,
        errors: [],
        warnings: warnings,
        non_ascii: nonAscii,
        draft: { path: DRAFT_REL, bytes: Buffer.byteLength(draftText, "utf8"), sha256: sha256(Buffer.from(draftText, "utf8")) },
        p05: p05Entries,
      });
      return 0;
    }

    function promote() {
      const draftPath = path.join(staging, DRAFT_REL);
      const envelopePath = path.join(staging, ENVELOPE_REL);
      if (!fs.existsSync(draftPath)) return refuse("needs-input", "staged draft missing: " + DRAFT_REL);
      if (!fs.existsSync(envelopePath)) return refuse("needs-input", "staged envelope missing: " + ENVELOPE_REL);

      let boxIds;
      try {
        boxIds = listBoxIds();
      } catch (problem) {
        return refuse("needs-input", "join/ is not readable in the store");
      }
      if (boxIds.length === 0) return refuse("needs-input", "no join/box-*.assignment.json in the store");

      const envelopeBuf = fs.readFileSync(envelopePath);
      const envelopeSha = sha256(envelopeBuf);
      const targets = [
        { rel: DRAFT_REL, kind: "frozen" },
        { rel: ENVELOPE_REL, kind: "frozen" },
      ];
      for (const boxId of boxIds) {
        targets.push({ rel: "join/" + boxId + ".p05-check.json", kind: "derived" });
        targets.push({ rel: "join/" + boxId + ".p05-evidence.json", kind: "derived" });
      }
      targets.push({ rel: ENVELOPE_SHA_REL, kind: "derived", content: Buffer.from(envelopeSha + "\n", "utf8") });

      for (const target of targets) {
        if (target.content !== undefined) continue;
        if (!fs.existsSync(path.join(staging, target.rel))) return refuse("needs-input", "staged artifact missing: " + target.rel);
      }
      // Freeze check first, over every frozen target, before anything is promoted.
      for (const target of targets) {
        if (target.kind !== "frozen") continue;
        const buf = fs.readFileSync(path.join(staging, target.rel));
        const targetAbs = path.join(store, target.rel);
        if (fs.existsSync(targetAbs) && !fs.readFileSync(targetAbs).equals(buf) && !allowOverwrite) {
          return refuse("frozen-artifact", target.rel + " exists with different bytes; pass --allow-overwrite to rewrite it");
        }
      }
      const promoted = [];
      const skipped = [];
      for (const target of targets) {
        const buf = target.content !== undefined ? target.content : fs.readFileSync(path.join(staging, target.rel));
        const targetAbs = path.join(store, target.rel);
        if (fs.existsSync(targetAbs) && fs.readFileSync(targetAbs).equals(buf)) {
          skipped.push(target.rel);
          continue;
        }
        const tmpAbs = targetAbs + ".p0-close-tmp";
        try {
          fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
          fs.writeFileSync(tmpAbs, buf);
          fs.renameSync(tmpAbs, targetAbs);
        } catch (problem) {
          try {
            fs.rmSync(tmpAbs, { force: true });
          } catch (ignored) {
            // The tmp file is best-effort cleanup; the refusal below is the result.
          }
          return refuse("evidence-failed", "promotion failed: " + target.rel);
        }
        promoted.push(target.rel);
      }
      out({ ok: true, reason: "ok", promoted: promoted, skipped: skipped, draft_sha: sha256(fs.readFileSync(draftPath)), envelope_sha: envelopeSha });
      return 0;
    }

    if (!store || !staging) return refuse("needs-input", "--store and --staging are required");
    return promoteMode ? promote() : stage();
  };

  // ------------------------------------------------------------- merge/validate (step 2)
  const mergePath = evidenceDir + "/merge.cjs";
  const writeMerge = workflow.shell(heredoc(MERGE_TAG, "(" + MERGE_MAIN.toString() + ")();\n", mergePath), { timeout: 30 });
  if (!writeMerge.ok) return workflow.exit(refuse("needs-input", { detail: "cannot write the merge helper" }));
  const stageCall =
    "node " + quote(mergePath)
    + " --store " + quote(store)
    + " --staging " + quote(stageDir)
    + " --input-ceiling-bytes " + inputCeiling
    + " --run-id " + quote(runId)
    + " --review-state " + quote(reviewState)
    + " --base-oid " + quote(baseOid)
    + " --subject-oid " + quote(subjectOid)
    + (allowOverwrite ? " --allow-overwrite" : "");
  const stageRun = workflow.shell(stageCall, { timeout: MERGE_TIMEOUT_S });
  const digest = parseTail(stageRun.output);
  if (stageRun.truncated === true || !digest || typeof digest !== "object") {
    return workflow.exit(refuse("validation-failed", { detail: "merge helper produced no digest: " + clip(String(stageRun.output || ""), 200) }));
  }
  if (digest.ok !== true) {
    const reason = REASONS.indexOf(digest.reason) >= 0 ? digest.reason : "validation-failed";
    return workflow.exit(refuse(reason, { detail: clip(digest.error || "merge refused", 300), samples: Array.isArray(digest.errors) ? digest.errors.slice(0, 3) : [] }));
  }

  // ------------------------------------------------------------ digest cross-check (step 3)
  const draftSha = digest.draft && typeof digest.draft.sha256 === "string" ? digest.draft.sha256 : "";
  if (!HEX64.test(draftSha)) return workflow.exit(refuse("validation-failed", { detail: "draft sha256 is not 64 lowercase hex" }));
  const p05 = Array.isArray(digest.p05) ? digest.p05 : [];
  const boxUnitSum = p05.reduce((sum, entry) => sum + (entry.unit_count || 0), 0);
  const boxLinkSum = p05.reduce((sum, entry) => sum + (entry.links || 0), 0);
  const machineCount = digest.machine_count || 0;
  if (boxUnitSum + machineCount !== digest.manifest_unit_count) {
    return workflow.exit(refuse("validation-failed", { detail: "unit count cross-check failed: boxes " + boxUnitSum + " + machine " + machineCount + " != manifest " + digest.manifest_unit_count }));
  }
  if (boxLinkSum !== digest.links) {
    return workflow.exit(refuse("validation-failed", { detail: "link cross-check failed: boxes " + boxLinkSum + " != digest " + digest.links }));
  }

  // ------------------------------------------- envelope on a shadow copy (SPEC step 5)
  // The shadow keeps the real store untouched until every check, including the envelope
  // freeze check, has passed. The generated bytes are path-independent (run-relative refs,
  // content pins), so the promoted envelope is identical to a direct-store generation.
  let shadowCmd = "cp -a " + quote(store + "/.") + " " + quote(shadowDir + "/");
  const stageRel = stageDir + "/";
  shadowCmd += " && cp " + quote(stageRel + digest.draft.path) + " " + quote(shadowDir + "/" + digest.draft.path);
  for (const entry of p05) {
    shadowCmd += " && cp " + quote(stageRel + entry.check.path) + " " + quote(shadowDir + "/" + entry.check.path);
    shadowCmd += " && cp " + quote(stageRel + entry.evidence.path) + " " + quote(shadowDir + "/" + entry.evidence.path);
  }
  const shadowRun = workflow.shell(shadowCmd, { timeout: ENVELOPE_TIMEOUT_S });
  if (!shadowRun.ok) return workflow.exit(refuse("evidence-failed", { detail: "cannot stage the shadow store: " + clip(String(shadowRun.output || ""), 200) }));

  const envelopePath = stageDir + "/run-manifest.json";
  const envelopeCall =
    "node " + quote(verifier)
    + " envelope --run " + quote(shadowDir)
    + " --operator-ref " + quote(operatorRef)
    + " --chunker-sha256 " + quote(chunkerSha)
    + " --input-ceiling-bytes " + inputCeiling
    + " > " + quote(envelopePath)
    + " 2> " + quote(evidenceDir + "/envelope.stderr");
  workflow.shell(envelopeCall, { timeout: ENVELOPE_TIMEOUT_S });
  const envelopeRead = workflow.shell("cat " + quote(envelopePath), { timeout: 60 });
  if (!envelopeRead.ok || envelopeRead.truncated === true) {
    return workflow.exit(refuse("evidence-failed", { detail: "the envelope artifact is unreadable (clipped or missing)" }));
  }
  const envelope = parseAll(envelopeRead.output);
  if (!envelope || typeof envelope !== "object") return workflow.exit(refuse("evidence-failed", { detail: "the envelope is not valid JSON" }));
  if (envelope.ok === false) return workflow.exit(refuse("evidence-failed", { detail: clip(envelope.summary || envelope.reason || "envelope refused", 300) }));
  if (envelope.schema_version !== "run-verification/1") return workflow.exit(refuse("evidence-failed", { detail: "envelope schema_version mismatch" }));
  if (!envelope.verifier || envelope.verifier.sha256 !== verifierSha) return workflow.exit(refuse("evidence-failed", { detail: "envelope verifier pin mismatch" }));

  // --------------------------------------------------- staging-compare promotion (step 4)
  const promoteCall =
    "node " + quote(mergePath)
    + " --store " + quote(store)
    + " --staging " + quote(stageDir)
    + " --promote"
    + (allowOverwrite ? " --allow-overwrite" : "");
  const promoteRun = workflow.shell(promoteCall, { timeout: MERGE_TIMEOUT_S });
  const promotion = parseTail(promoteRun.output);
  if (promoteRun.truncated === true || !promotion || typeof promotion !== "object") {
    return workflow.exit(refuse("evidence-failed", { detail: "promotion produced no digest: " + clip(String(promoteRun.output || ""), 200) }));
  }
  if (promotion.ok !== true) {
    const reason = REASONS.indexOf(promotion.reason) >= 0 ? promotion.reason : "evidence-failed";
    return workflow.exit(refuse(reason, { detail: clip(promotion.error || "promotion refused", 300) }));
  }

  const envelopeSha = promotion.envelope_sha && HEX64.test(promotion.envelope_sha) ? promotion.envelope_sha : "";
  if (envelopeSha === "" || promotion.draft_sha !== draftSha) {
    return workflow.exit(refuse("evidence-failed", { detail: "promotion digest disagrees with the staged digest" }));
  }

  // ------------------------------------------------------------- checkpoint, card, exit
  const units = typeof digest.units === "number" ? digest.units : 0;
  const links = typeof digest.links === "number" ? digest.links : 0;
  workflow.checkpoint({ phase: "p0-close", units: units, links: links, draft_sha: draftSha, envelope_sha: envelopeSha });
  const lines = [
    "p0-close — artifacts promoted (production only; verify join decides)",
    "reason ok · units " + units + " · links " + links + " · boxes " + p05.length + " · machine " + machineCount,
    "draft " + draftSha.slice(0, 12) + " · envelope " + envelopeSha.slice(0, 12),
    "store " + store,
    "evidence " + evidenceDir,
  ];
  if (Array.isArray(digest.warnings)) {
    for (const warning of digest.warnings.slice(0, 3)) lines.push("warning " + clip(warning, 120));
  }
  lines.push("next: delegate verify join (sole mechanical boundary)");
  console.log(lines.join("\n"));
  return workflow.exit({
    reason: "ok",
    draft_sha: draftSha,
    envelope_sha: envelopeSha,
    units: units,
    links: links,
    paths: { store: store, evidence: evidenceDir, draft: digest.draft.path, envelope: "run-manifest.json" },
  });
});
