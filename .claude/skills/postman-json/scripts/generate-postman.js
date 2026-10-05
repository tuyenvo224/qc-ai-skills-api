#!/usr/bin/env node
/**
 * Convert a reviewed API test-case Markdown file (api-test-design skill output format)
 * into a Postman Collection v2.1 JSON + matching environment JSON.
 *
 * Usage:
 *   node generate-postman.js <input.md> [--out-dir <dir>] [--name "<Collection Name>"] [--base-url <url>] [--file-base <base-name>] [--flat] [--max-time <ms>] [--spec <file|url>] [--no-schema] [--strict-formats] [--dry-run]
 *
 * Notes:
 *   - Collection name and base URL are auto-detected from the input file's
 *     title line and "**Base URL**:" metadata line when not passed explicitly.
 *   - Output dir defaults to the input file's own directory.
 *   - Output filenames are "<base>-collection.json" / "<base>-environment.json", where <base> is
 *     "<yyyy-mm-dd_hh-mm-ss>-<slug-of-collection-name>", stamped with the local time of the run
 *     (e.g. "2026-10-04_17-05-12-user-management-api-collection.json").
 *   - Pass --file-base to override <base> entirely (used verbatim, not slugified) — for
 *     callers (e.g. a workflow) that need an exact filename.
 *   - Pass --dry-run to parse, validate and print the summary + warnings without
 *     writing any file (used for the pre-generation summary step).
 *   - A literal pipe inside a cell must be escaped as "\|"; an unescaped "|" splits
 *     the cell and the row is reported as having the wrong column count.
 *   - Pass --flat to keep the exact row order of the input file (Module > requests) instead of
 *     the default Module > Endpoint > Test Type folders, which regroup rows. Use it when rows
 *     depend on rows of another endpoint (e.g. GET after DELETE, [ORDER: ...] notes).
 *   - {{runId}} in any cell is a value unique per run (set by the first request), so data such as
 *     emails can be made unique and the collection can be re-run without "already exists" errors.
 *   - Response bodies are validated against the response schemas of the OpenAPI/Swagger spec
 *     (JSON or YAML, file or URL) named by --spec or the input's "**Source spec**:" line, for the
 *     status code actually returned. --no-schema turns this off; --strict-formats also checks
 *     "format" (date-time, email, uri, uuid...), which is skipped by default.
 *   - --max-time sets the response-time limit (default 2000 ms; 0 = no time assertion). A row can
 *     override it with "[MAX-TIME: <ms>]" in Notes; rows sending >= 100 000 generated characters
 *     get at least 10 000 ms.
 *   - Body encoding follows the row's Content-Type header: multipart/form-data -> form-data (a value
 *     "@file:<path>" uploads that file), application/x-www-form-urlencoded -> urlencoded, XML / text
 *     -> raw, anything else -> raw JSON.
 *   - "Authorization: Basic <user>:<password>" becomes Postman basic auth; any other non-Bearer
 *     credential (API key header or query param, cookie, base64 Basic) is sent exactly as written.
 */

const fs = require('fs');
const path = require('path');
const openapi = require('./lib/openapi');

// ---- CLI args ----

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir') { args.outDir = argv[++i]; }
    else if (a === '--name') { args.name = argv[++i]; }
    else if (a === '--base-url') { args.baseUrl = argv[++i]; }
    else if (a === '--file-base') { args.fileBase = argv[++i]; }
    else if (a === '--dry-run') { args.dryRun = true; }
    else if (a === '--flat') { args.flat = true; }
    else if (a === '--max-time') { args.maxTime = Number(argv[++i]); }
    else if (a === '--spec') { args.spec = argv[++i]; }
    else if (a === '--no-schema') { args.noSchema = true; }
    else if (a === '--strict-formats') { args.strictFormats = true; }
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const SRC = args._[0];
if (!SRC) {
  console.error('Usage: node generate-postman.js <input.md> [--out-dir <dir>] [--name "<Collection Name>"] [--base-url <url>] [--file-base <base-name>] [--flat] [--max-time <ms>] [--spec <file|url>] [--no-schema] [--strict-formats] [--dry-run]');
  process.exit(1);
}

const warnings = [];
function warn(msg) { warnings.push(msg); }
if (!fs.existsSync(SRC)) {
  console.error(`Input file not found: ${SRC}`);
  process.exit(1);
}

const raw = fs.readFileSync(SRC, 'utf8');
const lines = raw.split(/\r?\n/);

// ---- Metadata auto-detection ----

function detectTitle(lines) {
  for (const line of lines) {
    const m = line.match(/^#\s*API Test Cases\s*[—-]\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return path.basename(SRC, path.extname(SRC));
}

function detectBaseUrl(lines) {
  for (const line of lines) {
    const m = line.match(/^\*\*Base URL\*\*:\s*(.+)$/);
    if (!m) continue;
    const rest = m[1];
    const urls = [...rest.matchAll(/`([^`]+)`\s*(\([^)]*\))?/g)].map(x => ({ url: x[1], label: (x[2] || '').toLowerCase() }));
    if (!urls.length) continue;
    const prod = urls.find(u => u.label.includes('prod'));
    return (prod || urls[0]).url;
  }
  return null;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/\bv\d+(\.\d+)*\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

const detectedTitle = detectTitle(lines);
const detectedBaseUrl = detectBaseUrl(lines);

const COLLECTION_NAME = args.name || `${detectedTitle} Test Suite`;
const BASE_URL = args.baseUrl || detectedBaseUrl || 'https://api.example.com';
const OUT_DIR = args.outDir || path.dirname(SRC);
const FILE_SLUG = slugify(args.name || detectedTitle) || 'api';

// Default output base name: "<yyyy-mm-dd_hh-mm-ss>-<slug>", stamped with the local time of this
// run, so every conversion writes a new pair of files and never overwrites an earlier one.
function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
const FILE_BASE = args.fileBase || `${nowStamp()}-${FILE_SLUG}`;

const BASE_URL_IS_PLACEHOLDER = !args.baseUrl && !detectedBaseUrl;
if (BASE_URL_IS_PLACEHOLDER) {
  warn('No "**Base URL**:" line found in input file and --base-url not given. Using placeholder https://api.example.com — set the real baseUrl in the environment before running.');
}

const HEADER_ORDER = ['tc_id', 'module', 'endpoint', 'method', 'test_type', 'priority', 'pre_condition', 'description', 'headers', 'params', 'body', 'expected_status', 'expected_response', 'notes'];

// Split a table row on unescaped pipes; "\|" inside a cell is kept as a literal "|".
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

function stripBackticks(s) {
  s = s.trim();
  if (s.startsWith('`') && s.endsWith('`') && s.length >= 2) {
    return s.slice(1, -1);
  }
  return s;
}

let currentEndpointDesc = null;
let currentAuthRequired = null;
const rows = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const descMatch = line.match(/^\*\*Description\*\*:\s*(.+)$/);
  if (descMatch) { currentEndpointDesc = descMatch[1].trim(); continue; }

  const authMatch = line.match(/^\*\*Auth required\*\*:\s*(.+)$/);
  if (authMatch) { currentAuthRequired = authMatch[1].trim(); continue; }

  if (/^\s*\|\s*TC_/.test(line)) {
    const cells = splitRow(line);
    if (cells[0] === 'TC_ID') continue; // header row, not data
    if (cells.length !== HEADER_ORDER.length) {
      warn(`${cells[0]}: row has ${cells.length} cells, expected ${HEADER_ORDER.length} (line ${i + 1}). Usually an unescaped "|" inside a cell — escape it as "\\|". The generated request for this row is likely wrong.`);
    }
    const row = {};
    HEADER_ORDER.forEach((key, idx) => { row[key] = cells[idx] !== undefined ? cells[idx].trim() : ''; });
    row._endpointDesc = currentEndpointDesc;
    row._authRequired = currentAuthRequired;
    rows.push(row);
  }
}

console.log(`Parsed ${rows.length} test case rows from ${path.basename(SRC)}.`);
if (!rows.length) {
  console.error('No test case rows found. Is this the expected Markdown table format?');
  process.exit(1);
}

const tcIdCount = new Map();
for (const r of rows) tcIdCount.set(r.tc_id, (tcIdCount.get(r.tc_id) || 0) + 1);
for (const [id, n] of tcIdCount) {
  if (n > 1) warn(`Duplicate TC_ID ${id} appears ${n} times — rename so requests can be traced.`);
}

// ---- Spec (for response schema checks) ----

function detectSpecSource(lines) {
  for (const line of lines) {
    const m = line.match(/^\*\*Source spec\*\*:\s*`([^`]+)`/);
    if (m) return m[1].trim();
  }
  return null;
}

const SPEC_SRC = args.noSchema ? null : (args.spec || detectSpecSource(lines));
let spec = null;
if (SPEC_SRC) {
  try {
    spec = openapi.loadSpec(SPEC_SRC, path.dirname(SRC));
    if (!spec || !spec.paths) throw new Error('no "paths" in document');
  } catch (e) {
    spec = null;
    warn(`Could not load spec "${SPEC_SRC}" (${e.message}) — response schema checks are skipped. Pass --spec <file|url> to point at the spec, or --no-schema to silence this.`);
  }
} else if (!args.noSchema) {
  warn('No "**Source spec**:" line and no --spec given — response schema checks are skipped.');
}

const DEFAULT_MAX_TIME = Number.isFinite(args.maxTime) ? args.maxTime : 2000;

// Save directives anywhere in the file switch the token/id heuristics off (see parseSaveDirectives).
const fileHasExplicitSaves = rows.some(r => parseSaveDirectives(r).length > 0);
// Variables the requests actually reference — a heuristic id save is only emitted when it is used.
const referencedVars = new Set();
for (const r of rows) {
  for (const cell of [r.headers, r.params, r.body]) {
    for (const vm of (cell || '').matchAll(/\{\{(\w+)\}\}/g)) referencedVars.add(vm[1]);
  }
}

// {{runId}} anywhere in the file turns on the per-run unique value (see header comment).
const usesRunId = rows.some(r => HEADER_ORDER.some(k => (r[k] || '').includes('{{runId}}')));

// Body placeholders like <256 x 'a'> become a runtime-generated string of that length,
// built by a pre-request script so the collection file stays small.
const REPEAT_RE = /<(\d+) x '(.)'>/g;
function repeatVarName(n, ch) { return `_repeat_${n}_${ch.charCodeAt(0)}`; }

// ---- Parsing helpers ----

function parseHeaders(cell) {
  if (!cell || cell === 'N/A' || cell === '—' || cell === '-') return [];
  const parts = cell.split('<br>').map(p => stripBackticks(p.trim())).filter(Boolean);
  return parts.map(p => {
    const idx = p.indexOf(':');
    if (idx === -1) return { key: p, value: '', type: 'text' };
    return { key: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim(), type: 'text' };
  });
}

function parseBody(cell) {
  if (!cell || cell === 'N/A' || cell === '—' || cell === '-') return null;
  let inner = cell;
  if (inner.startsWith('`')) {
    const lastTick = inner.lastIndexOf('`');
    if (lastTick > 0) inner = inner.slice(1, lastTick);
  }
  return inner;
}

function parseStatuses(cell) {
  const nums = (cell || '').match(/\b[1-5]\d\d\b/g);
  return nums ? [...new Set(nums.map(Number))] : [];
}

// Response-time limit for a row: "[MAX-TIME: <ms>]" in Notes wins; rows that send >= 100 000
// generated characters (<N x 'c'>) get at least 10 s; otherwise --max-time (default 2000).
function maxTimeFor(row) {
  const m = `${row.notes} ${row.pre_condition}`.match(/\[MAX-TIME:\s*(\d+)\s*(?:ms)?\]/i);
  if (m) return Number(m[1]);
  let generated = 0;
  for (const cell of [row.body, row.params, row.headers]) {
    for (const r of (cell || '').matchAll(/<(\d+) x '.'>/g)) generated += Number(r[1]);
  }
  return generated >= 100000 && DEFAULT_MAX_TIME > 0 ? Math.max(DEFAULT_MAX_TIME, 10000) : DEFAULT_MAX_TIME;
}

// Percent-encode characters that would break a URL, keeping {{variables}} and existing %XX
// escapes untouched (a payload written already-encoded, e.g. %2e%2e%2f, is sent as written).
// Path values keep "/" so path-traversal payloads stay multi-segment.
function encodeUrlPart(s, kind) {
  const keep = kind === 'path' ? /[A-Za-z0-9\-._~!$&'()*+,;=:@\/]/ : /[A-Za-z0-9\-._~!$'()*,;:@\/?]/;
  return String(s).split(/(\{\{[^}]+\}\})/).map((part, i) => {
    if (i % 2 === 1) return part;
    let out = '';
    for (let j = 0; j < part.length; j++) {
      const c = part[j];
      if (c === '%' && /^[0-9A-Fa-f]{2}$/.test(part.slice(j + 1, j + 3))) { out += c; continue; }
      out += keep.test(c) ? c : encodeURIComponent(c === '%' ? '%' : c).replace(/^%$/, '%25');
    }
    return out;
  }).join('');
}

function hasNeedsReview(...cells) {
  return cells.some(c => c && c.includes('[NEEDS REVIEW'));
}

function extractNeedsReviewNote(cell) {
  const m = cell && cell.match(/\[NEEDS REVIEW[^\]]*\]/);
  return m ? m[0] : null;
}

// Parse path/query params cell into path substitutions + query array, based on {name} placeholders in the endpoint path
function parseParams(cell, endpointPath) {
  const result = { path: {}, query: [] };
  if (!cell || cell === 'N/A' || cell === '—' || cell === '-') return result;
  const parts = cell.split('<br>').map(p => stripBackticks(p.trim())).filter(Boolean);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) { result.query.push({ key: p.trim(), value: null }); continue; } // valueless flag: ?debug
    const key = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (endpointPath.includes(`{${key}}`)) {
      result.path[key] = value;
    } else {
      result.query.push({ key, value });
    }
  }
  return result;
}

// A JSON path in an assertion clause: name, then .name / [index] segments.
const PATH_RE = '[a-zA-Z_][a-zA-Z0-9_]*(?:\\[\\d+\\])*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*(?:\\[\\d+\\])*)*';

// {"<status>": <JSON Schema>} for the statuses a row allows, from the spec; null when nothing applies.
const schemaStats = { requests: 0, missingOps: new Set() };
function schemasFor(row, statuses) {
  if (!spec || /\[NO-SCHEMA\]/i.test(`${row.notes} ${row.pre_condition}`)) return null;
  const found = openapi.findOperation(spec, row.endpoint, row.method);
  if (!found) {
    // A known path called with a method it does not declare is an intentional undeclared-method
    // row (405 / HEAD / OPTIONS checks); only an unknown path is worth a warning.
    if (!openapi.declaredMethods(spec, row.endpoint)) schemaStats.missingOps.add(`${row.method} ${row.endpoint}`);
    return null;
  }
  const out = {};
  for (const s of statuses) {
    try {
      const sch = openapi.responseSchema(spec, found.op, s);
      if (sch) out[String(s)] = openapi.toJsonSchema(spec, sch, { strictFormats: args.strictFormats });
    } catch (e) {
      warn(`${row.tc_id}: could not convert the spec schema for ${s} (${e.message}) — schema check skipped for this status.`);
    }
  }
  if (!Object.keys(out).length) return null;
  schemaStats.requests++;
  return out;
}

// Build pm.test lines for a row
function buildTestScript(row) {
  const lines = [];
  const statuses = parseStatuses(row.expected_status);
  const priority = row.priority;
  const needsReviewNote = extractNeedsReviewNote(row.expected_response) || extractNeedsReviewNote(row.notes);

  lines.push(`// TC_ID: ${row.tc_id} | Priority: ${priority} | Test Type: ${row.test_type}`);
  if (needsReviewNote) lines.push(`// TODO: ${needsReviewNote}`);
  lines.push('');

  if (statuses.length === 1) {
    lines.push(`pm.test("Status code is ${statuses[0]}", function () {`);
    lines.push(`    pm.response.to.have.status(${statuses[0]});`);
    lines.push(`});`);
  } else if (statuses.length > 1) {
    lines.push(`pm.test("Status code is one of [${statuses.join(', ')}]", function () {`);
    lines.push(`    pm.expect(${JSON.stringify(statuses)}).to.include(pm.response.code);`);
    lines.push(`});`);
  } else {
    lines.push(`pm.test("Response received", function () {`);
    lines.push(`    pm.expect(pm.response.code).to.be.a("number");`);
    lines.push(`});`);
  }
  const maxTime = maxTimeFor(row);
  if (maxTime > 0) {
    lines.push('');
    lines.push(`pm.test("Response time is under ${maxTime}ms", function () {`);
    lines.push(`    pm.expect(pm.response.responseTime).to.be.below(${maxTime});`);
    lines.push(`});`);
  }

  let responseText = row.expected_response || '';
  const isNeedsReviewOnly = responseText.trim().startsWith('[NEEDS REVIEW') || responseText.trim() === '—' || responseText.trim() === '-';

  // Non-JSON bodies (204, gateway HTML errors) must not abort the script: json stays null
  // and only the assertions that need it fail.
  lines.push('');
  lines.push('let json = null;');
  lines.push('try { json = pm.response.json(); } catch (e) { json = null; }');

  // Response schema from the spec, for each status the row allows; checked against the status
  // actually returned (a status the spec does not describe is left to the status-code test).
  const schemas = schemasFor(row, statuses);
  if (schemas) {
    lines.push('');
    lines.push(`const responseSchemas = ${JSON.stringify(schemas)};`);
    lines.push(`if (responseSchemas[String(pm.response.code)]) {`);
    lines.push(`    pm.test("Response body matches the spec schema for " + pm.response.code, function () {`);
    lines.push(`        pm.expect(json, "response body is not JSON").to.not.equal(null);`);
    lines.push(`        pm.response.to.have.jsonSchema(responseSchemas[String(pm.response.code)]);`);
    lines.push(`    });`);
    lines.push(`}`);
  }

  // Header clauses: header `Content-Type` contains "application/json" · header `Location` present ·
  // header `X-Powered-By` absent · header `Cache-Control` = "no-store". Removed from the text
  // afterwards so the body clauses below don't read them as body fields.
  const headerRegex = /header\s+[`'"]([^`'"]+)[`'"]\s+(contains|=|equals|present|is present|absent|not present|is not present)(?:\s+"([^"]*)")?/gi;
  let hm;
  while ((hm = headerRegex.exec(responseText)) !== null) {
    const [, name, op, val] = hm;
    const key = JSON.stringify(name);
    const expected = val === undefined ? null : (val.includes('{{') ? `pm.variables.replaceIn(${JSON.stringify(val)})` : JSON.stringify(val));
    lines.push('');
    if (/absent|not present/i.test(op)) {
      lines.push(`pm.test("Header ${name} is absent", function () {`);
      lines.push(`    pm.expect(pm.response.headers.has(${key}), ${key} + " header").to.equal(false);`);
    } else if (/present/i.test(op) || expected === null) {
      lines.push(`pm.test("Header ${name} is present", function () {`);
      lines.push(`    pm.expect(pm.response.headers.has(${key}), ${key} + " header").to.equal(true);`);
    } else if (/contains/i.test(op)) {
      lines.push(`pm.test("Header ${name} contains expected value", function () {`);
      lines.push(`    pm.expect(String(pm.response.headers.get(${key}) || "").toLowerCase()).to.include(String(${expected}).toLowerCase());`);
    } else {
      lines.push(`pm.test("Header ${name} equals expected value", function () {`);
      lines.push(`    pm.expect(pm.response.headers.get(${key})).to.eql(${expected});`);
    }
    lines.push(`});`);
  }
  responseText = responseText.replace(headerRegex, '');

  if (!isNeedsReviewOnly) {
    const successMatch = responseText.match(/`?success`?\s*=\s*(true|false)/);
    if (successMatch) {
      lines.push('');
      lines.push(`pm.test("success is ${successMatch[1]}", function () {`);
      lines.push(`    pm.expect(json.success).to.eql(${successMatch[1]});`);
      lines.push(`});`);
    }

    const msgMatch = responseText.match(/`?message`?\s*=\s*"([^"]+)"/);
    if (msgMatch) {
      const expected = msgMatch[1].includes('{{')
        ? `pm.variables.replaceIn(${JSON.stringify(msgMatch[1])})`
        : JSON.stringify(msgMatch[1]);
      lines.push('');
      lines.push(`pm.test("message matches expected text", function () {`);
      lines.push(`    pm.expect(json.message).to.eql(${expected});`);
      lines.push(`});`);
    }

    // `password` not present in response — a bare key is searched at any depth (it is usually
    // nested, e.g. user.password); a dotted path checks exactly that path.
    const absentRegex = new RegExp('[`\'"](' + PATH_RE + ')[`\'"]\\s+(?:is\\s+)?(?:not present|absent)', 'gi');
    let am;
    while ((am = absentRegex.exec(responseText)) !== null) {
      const propPath = am[1];
      lines.push('');
      lines.push(`pm.test("${propPath} is not present in response", function () {`);
      if (/[.[]/.test(propPath)) {
        lines.push(`    pm.expect(json).to.not.have.nested.property(${JSON.stringify(propPath)});`);
      } else {
        lines.push(`    const found = [];`);
        lines.push(`    (function walk(o, p) {`);
        lines.push(`        if (o === null || typeof o !== "object") return;`);
        lines.push(`        Object.keys(o).forEach(function (k) {`);
        lines.push(`            if (k === ${JSON.stringify(propPath)}) found.push(p + k);`);
        lines.push(`            walk(o[k], p + k + ".");`);
        lines.push(`        });`);
        lines.push(`    })(json, "");`);
        lines.push(`    pm.expect(found, "found at").to.be.empty;`);
      }
      lines.push(`});`);
    }

    // Paths: dotted and/or indexed (user.email, items[0].id, data.users[2].roles[0]). A bare
    // top-level name is not matched here — `success`/`message` have their own clauses above.
    const eqRegex = new RegExp('[`\'"]?(' + PATH_RE + ')`?\\s*=\\s*(?:"([^"]*)"|(-?\\d+(?:\\.\\d+)?)|(true|false)|(null))', 'g');
    let m;
    const seenPaths = new Set();
    while ((m = eqRegex.exec(responseText)) !== null) {
      const [, propPath, strVal, numVal, boolVal, nullVal] = m;
      if (!/[.[]/.test(propPath)) continue;
      if (seenPaths.has(propPath)) continue;
      seenPaths.add(propPath);
      const accessor = 'json.' + propPath;
      lines.push('');
      if (strVal !== undefined && strVal.includes('{{')) {
        // Variables (e.g. {{runId}}, {{createdUserId}}) are resolved at run time; compare as strings
        // so a numeric id still matches the variable's string value.
        lines.push(`pm.test("${propPath} equals expected value", function () {`);
        lines.push(`    pm.expect(String(${accessor})).to.eql(pm.variables.replaceIn(${JSON.stringify(strVal)}));`);
        lines.push(`});`);
      } else if (strVal !== undefined) {
        lines.push(`pm.test("${propPath} equals expected value", function () {`);
        lines.push(`    pm.expect(${accessor}).to.eql(${JSON.stringify(strVal)});`);
        lines.push(`});`);
      } else if (numVal !== undefined) {
        lines.push(`pm.test("${propPath} equals expected value", function () {`);
        lines.push(`    pm.expect(${accessor}).to.eql(${numVal});`);
        lines.push(`});`);
      } else if (boolVal !== undefined) {
        lines.push(`pm.test("${propPath} equals expected value", function () {`);
        lines.push(`    pm.expect(${accessor}).to.eql(${boolVal});`);
        lines.push(`});`);
      } else if (nullVal !== undefined) {
        lines.push(`pm.test("${propPath} is null", function () {`);
        lines.push(`    pm.expect(${accessor}).to.eql(null);`);
        lines.push(`});`);
      }
    }

    const arrayRegex = new RegExp('[`\'"]?(' + PATH_RE + ')[`\'"]?\\s+is an array', 'g');
    while ((m = arrayRegex.exec(responseText)) !== null) {
      const propPath = m[1];
      lines.push('');
      lines.push(`pm.test("${propPath} is an array", function () {`);
      lines.push(`    pm.expect(json.${propPath}).to.be.an("array");`);
      lines.push(`});`);
    }

    // Field name may be wrapped in backticks, single or double quotes: `id` (integer), 'id' (integer), "id" (integer)
    const propRegex = new RegExp('[`\'"](' + PATH_RE + ')[`\'"]\\s*\\((JWT string|User object|integer|string|number|boolean|object|array|null)\\)', 'g');
    while ((m = propRegex.exec(responseText)) !== null) {
      const propPath = m[1];
      const typeHint = m[2];
      lines.push('');
      lines.push(`pm.test("${propPath} is present", function () {`);
      lines.push(`    pm.expect(json).to.have.nested.property(${JSON.stringify(propPath)});`);
      lines.push(`});`);
      if (typeHint === 'JWT string' || typeHint === 'string') {
        lines.push(`pm.test("${propPath} is a non-empty string", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.be.a("string").and.to.have.length.above(0);`);
        lines.push(`});`);
      } else if (typeHint === 'integer') {
        lines.push(`pm.test("${propPath} is an integer", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.be.a("number");`);
        lines.push(`    pm.expect(Number.isInteger(json.${propPath}), "integer").to.equal(true);`);
        lines.push(`});`);
      } else if (typeHint === 'number') {
        lines.push(`pm.test("${propPath} is a number", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.be.a("number");`);
        lines.push(`});`);
      } else if (typeHint === 'null') {
        lines.push(`pm.test("${propPath} is null", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.equal(null);`);
        lines.push(`});`);
      } else if (typeHint === 'User object' || typeHint === 'object') {
        lines.push(`pm.test("${propPath} is an object", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.be.an("object");`);
        lines.push(`});`);
      } else if (typeHint === 'array') {
        lines.push(`pm.test("${propPath} is an array", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.be.an("array");`);
        lines.push(`});`);
      } else if (typeHint === 'boolean') {
        lines.push(`pm.test("${propPath} is a boolean", function () {`);
        lines.push(`    pm.expect(json.${propPath}).to.be.a("boolean");`);
        lines.push(`});`);
      }
    }

    const indicatesMatch = responseText.match(/message indicates ([^;.]+)/i);
    if (indicatesMatch) {
      const clue = indicatesMatch[1].trim();
      const keywords = [];
      const kwMatch = clue.match(/^(\w+)\s+(?:is required|is not allowed)/i);
      if (kwMatch) keywords.push(kwMatch[1].toLowerCase());
      if (/required/i.test(clue)) keywords.push('required');
      if (/invalid/i.test(clue)) keywords.push('invalid');
      if (/not found/i.test(clue)) keywords.push('not found');
      if (/already exists/i.test(clue)) keywords.push('exist');
      if (/not allowed|self-deletion/i.test(clue)) keywords.push('not allowed');
      if (/invalid id type/i.test(clue)) keywords.push('id');
      const uniqueKw = [...new Set(keywords)];
      if (uniqueKw.length) {
        lines.push('');
        lines.push(`pm.test("Error message indicates: ${clue.replace(/"/g, "'")}", function () {`);
        lines.push(`    const body = pm.response.text().toLowerCase();`);
        lines.push(`    pm.expect(body).to.satisfy(function (text) {`);
        lines.push(`        return ${uniqueKw.map(k => `text.includes(${JSON.stringify(k)})`).join(' || ')};`);
        lines.push(`    });`);
        lines.push(`});`);
      }
    }

    if (/JSON parse error/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("Error indicates malformed JSON", function () {`);
      lines.push(`    const body = pm.response.text().toLowerCase();`);
      lines.push(`    pm.expect(body).to.satisfy(function (text) {`);
      lines.push(`        return text.includes("json") || text.includes("parse") || text.includes("invalid");`);
      lines.push(`    });`);
      lines.push(`});`);
    }

    if (/unicode\/emoji intact/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("Response is valid JSON with unicode/emoji content preserved", function () {`);
      lines.push(`    pm.response.to.be.json;`);
      lines.push(`});`);
    }

    if (/HTML-escaped or sanitized/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("XSS payload is not reflected unescaped", function () {`);
      lines.push(`    const body = pm.response.text();`);
      lines.push(`    pm.expect(body).to.not.include("<script>alert(1)</script>");`);
      lines.push(`});`);
    }

    if (/unchanged/i.test(responseText) && !/unicode\/emoji intact/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("Response is valid JSON (manual check for unchanged fields per notes)", function () {`);
      lines.push(`    pm.response.to.be.json;`);
      lines.push(`});`);
    }

    if (/no SQL error leaked/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("No SQL error leaked", function () {`);
      lines.push(`    const body = pm.response.text().toLowerCase();`);
      lines.push(`    pm.expect(body).to.not.include("sql syntax");`);
      lines.push(`    pm.expect(body).to.not.include("mysql");`);
      lines.push(`    pm.expect(body).to.not.include("postgres");`);
      lines.push(`    pm.expect(body).to.not.include("sqlite");`);
      lines.push(`});`);
    }
    if (/no unauthorized login granted/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("No unauthorized login granted", function () {`);
      lines.push(`    pm.expect(json.success).to.not.eql(true);`);
      lines.push(`});`);
    }
    if (/no unintended rows deleted/i.test(responseText)) {
      lines.push('');
      lines.push(`pm.test("Deletion rejected (no unintended rows deleted)", function () {`);
      lines.push(`    pm.expect(json.success).to.eql(false);`);
      lines.push(`});`);
    }
  }

  if (row.test_type === 'Auth') {
    // Check JSON keys, not text: an error message such as "Invalid email or password" is fine,
    // a "password"/"password_hash" field in the body is a leak.
    lines.push('');
    lines.push(`pm.test("No sensitive data leaked in error response", function () {`);
    lines.push(`    const leaked = [];`);
    lines.push(`    (function walk(o) {`);
    lines.push(`        if (o === null || typeof o !== "object") return;`);
    lines.push(`        Object.keys(o).forEach(function (k) {`);
    lines.push(`            if (/^(password|password_hash|passwordhash|hash|salt|secret)$/i.test(k)) leaked.push(k);`);
    lines.push(`            walk(o[k]);`);
    lines.push(`        });`);
    lines.push(`    })(json);`);
    lines.push(`    pm.expect(leaked, "sensitive keys in response").to.be.empty;`);
    lines.push(`});`);
  }

  const saveDirectives = parseSaveDirectives(row);
  if (saveDirectives.length) {
    lines.push('');
    lines.push(`// Save values named by the test case's explicit "Save ..." instructions (only on a 2xx response)`);
    lines.push(`if (json && pm.response.code >= 200 && pm.response.code < 300) {`);
    lines.push(`    // Dot path; a segment like list[?key=value] picks the first array item whose key equals value`);
    lines.push(`    const pick = function (obj, p) {`);
    lines.push(`        return p.split(".").reduce(function (o, seg) {`);
    lines.push(`            if (o == null) return undefined;`);
    lines.push(`            const f = seg.match(/^(\\w+)\\[\\?(\\w+)=([^\\]]+)\\]$/);`);
    lines.push(`            if (f) return Array.isArray(o[f[1]]) ? o[f[1]].find(function (x) { return x && String(x[f[2]]) === f[3]; }) : undefined;`);
    lines.push(`            return o[seg];`);
    lines.push(`        }, obj);`);
    lines.push(`    };`);
    for (const { jsonPath, envVar } of saveDirectives) {
      lines.push(`    (function () {`);
      lines.push(`        const v = pick(json, ${JSON.stringify(jsonPath)});`);
      lines.push(`        if (v !== undefined && v !== null) { pm.environment.set("${envVar}", v); }`);
      lines.push(`    })();`);
    }
    lines.push(`}`);
  } else if (row.test_type === 'Happy' && !fileHasExplicitSaves) {
    // Heuristics only for files that declare no Save directives at all — otherwise they would
    // add variables nobody uses (e.g. "userId" next to an explicit {{createdUserId}}).
    if (/data\.token|`token`\s*\(JWT/i.test(responseText) || /login|auth/i.test(row.endpoint)) {
      const isRegularUserLogin = /role\s*=\s*"user"/.test(responseText) && !/admin/i.test(row.pre_condition || '');
      const envVar = isRegularUserLogin ? 'userToken' : 'token';
      if (/data\.token|\btoken\b/.test(responseText)) {
        lines.push('');
        lines.push(`// Save token for use as {{${envVar}}} in subsequent authenticated requests`);
        lines.push(`if (json && json.data && json.data.token) {`);
        lines.push(`    pm.environment.set("${envVar}", json.data.token);`);
        lines.push(`} else if (json && json.token) {`);
        lines.push(`    pm.environment.set("${envVar}", json.token);`);
        lines.push(`}`);
      }
    }
    if (savesCreatedId(row) && referencedVars.has(resourceIdVarName(row))) {
      const singular = resourceIdVarName(row).replace(/Id$/, '');
      lines.push('');
      lines.push(`// Save created resource id for downstream tests`);
      lines.push(`const createdId = json && (json.id || (json.data && json.data.id) || (json.${singular} && json.${singular}.id));`);
      lines.push(`if (createdId) {`);
      lines.push(`    pm.environment.set("${resourceIdVarName(row)}", createdId);`);
      lines.push(`}`);
    }
  }

  return lines;
}

// Explicit save instructions in Notes/Expected Response. Accepted separators: "as", "→", "->":
//   Save `data.token` as `{{adminToken}}` and `data.user.id` as `{{adminId}}`
//   Save `data.token` → `{{adminToken}}`, `reset.accounts[?role=user].email` → `{{userEmail}}`
// When the file has any directive, the token/id heuristics are switched off for the whole file.
function parseSaveDirectives(row) {
  const text = `${row.notes || ''} ${row.expected_response || ''}`;
  if (!/\bsave\b/i.test(text)) return [];
  const out = [];
  const seg = '[A-Za-z_$][\\w$]*(?:\\[\\?\\w+=[^\\]`]+\\])?';
  const re = new RegExp('`(' + seg + '(?:\\.' + seg + ')*)`\\s*(?:as|→|->)\\s*`?\\{\\{(\\w+)\\}\\}`?', 'g');
  let m;
  while ((m = re.exec(text)) !== null) out.push({ jsonPath: m[1], envVar: m[2] });
  return out;
}

// A happy-path POST returning 2xx whose expected response mentions an id creates a resource
// that later rows reference as {{<singular>Id}}.
function savesCreatedId(row) {
  const text = row.expected_response || '';
  if (/generated `?id`?/i.test(text) || /object with generated/i.test(text)) return true;
  const is2xx = parseStatuses(row.expected_status).some(s => s >= 200 && s < 300);
  return row.method === 'POST' && is2xx && /\bid\b/i.test(text);
}

function resourceIdVarName(row) {
  // e.g. "Users" module -> "userId"
  const mod = (row.module || 'resource').toLowerCase().replace(/[^a-z]/g, '');
  const singular = mod.endsWith('s') ? mod.slice(0, -1) : mod;
  return `${singular}Id`;
}

// ---- Build Postman items ----

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const moduleMap = new Map();
for (const row of rows) {
  const modKey = row.module;
  if (!moduleMap.has(modKey)) moduleMap.set(modKey, new Map());
  const epKey = `${row.method} ${row.endpoint}`;
  const epMap = moduleMap.get(modKey);
  if (!epMap.has(epKey)) epMap.set(epKey, new Map());
  const ttMap = epMap.get(epKey);
  if (!ttMap.has(row.test_type)) ttMap.set(row.test_type, []);
  ttMap.get(row.test_type).push(row);
}

const needsReviewRows = rows.filter(r => hasNeedsReview(r.expected_response, r.notes));

// Parse a body cell written as a JSON object for form encodings. Unquoted {{variables}}
// (e.g. {"id": {{createdUserId}}}) are allowed and kept as "{{name}}". Returns null if not an object.
function parseFormObject(text) {
  const marked = text.replace(/(^|[^"\w])\{\{(\w+)\}\}(?!")/g, (m, pre, name) => `${pre}"\u0000${name}\u0000"`);
  let obj;
  try { obj = JSON.parse(marked); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const restore = v => String(v).replace(/\u0000(\w+)\u0000/g, '{{$1}}');
  const entries = [];
  for (const [key, value] of Object.entries(obj)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === null || v === undefined) entries.push({ key, value: '' });
      else if (typeof v === 'object') entries.push({ key, value: restore(JSON.stringify(v)) });
      else entries.push({ key, value: restore(v) });
    }
  }
  return entries;
}

const fileUploads = new Set(); // "@file:" sources used by multipart rows, reported to the user

function buildRequestItem(row) {
  const preRequest = [];
  // <N x 'c'> placeholders (anywhere in a request) become a runtime-generated string of that
  // length, built by a pre-request script so the collection file stays small.
  const expandRepeats = s => (s == null ? s : String(s).replace(REPEAT_RE, (_, n, ch) => {
    const v = repeatVarName(n, ch);
    preRequest.push(`pm.variables.set(${JSON.stringify(v)}, ${JSON.stringify(ch)}.repeat(${n}));`);
    return `{{${v}}}`;
  }));

  const headers = parseHeaders(row.headers).map(h => ({ ...h, value: expandRepeats(h.value) }));
  let endpointPath = row.endpoint;
  const { path: pathSubs, query: rawQuery } = parseParams(row.params, endpointPath);
  for (const [key, value] of Object.entries(pathSubs)) {
    endpointPath = endpointPath.replace(`{${key}}`, encodeUrlPart(expandRepeats(value), 'path'));
  }
  // A path placeholder with no value in the params cell would be sent literally as "{id}";
  // turn it into an environment variable instead and flag it.
  endpointPath = endpointPath.replace(/(^|[^{])\{(\w+)\}(?!\})/g, (m, pre, name) => {
    warn(`${row.tc_id}: path param {${name}} has no value in Path/Query Params — using {{${name}}}, fill it in the environment.`);
    return `${pre}{{${name}}}`;
  });
  // Query keys/values are percent-encoded so payloads containing & # + = or spaces reach the
  // server as one value instead of breaking the URL.
  const query = rawQuery.map(q => ({
    key: encodeUrlPart(expandRepeats(q.key), 'query'),
    value: q.value === null ? null : encodeUrlPart(expandRepeats(q.value), 'query')
  }));
  const bodyRaw = parseBody(row.body);
  const pathParts = endpointPath.split('/').filter(Boolean);

  const rawUrl = '{{baseUrl}}' + endpointPath + (query.length ? '?' + query.map(q => (q.value === null ? q.key : `${q.key}=${q.value}`)).join('&') : '');

  // Authorization is expressed through request/collection auth, not a raw header, so it is
  // never sent twice:
  //   Bearer {{token}}        -> inherit collection auth
  //   Bearer <other>          -> request-level bearer
  //   Basic <user>:<password> -> request-level basic auth (Postman does the base64)
  //   anything else (no header, empty, "Bearer" alone, base64 Basic, other schemes) -> noauth,
  //   header sent exactly as written. API keys in other headers / query params and cookies are
  //   ordinary headers/params and are sent as written too.
  const authHeader = headers.find(h => h.key.toLowerCase() === 'authorization');
  const bearerMatch = authHeader && authHeader.value.match(/^Bearer\s+(\S.*)$/i);
  const basicMatch = authHeader && authHeader.value.match(/^Basic\s+([^:\s]*):(.*)$/i);
  let auth;
  let sentHeaders = headers;
  if (bearerMatch) {
    sentHeaders = headers.filter(h => h !== authHeader);
    if (bearerMatch[1].trim() !== '{{token}}') {
      auth = { type: 'bearer', bearer: [{ key: 'token', value: bearerMatch[1].trim(), type: 'string' }] };
    }
  } else if (basicMatch) {
    sentHeaders = headers.filter(h => h !== authHeader);
    auth = { type: 'basic', basic: [
      { key: 'username', value: basicMatch[1], type: 'string' },
      { key: 'password', value: basicMatch[2].trim(), type: 'string' }
    ] };
  } else {
    auth = { type: 'noauth' };
  }

  // Body encoding follows the row's Content-Type header.
  const ctHeader = sentHeaders.find(h => h.key.toLowerCase() === 'content-type');
  const ct = ctHeader ? ctHeader.value.toLowerCase() : '';
  let body;
  if (bodyRaw !== null) {
    const expanded = expandRepeats(bodyRaw);
    if (ct.startsWith('multipart/form-data')) {
      const entries = parseFormObject(expanded);
      if (entries) {
        body = { mode: 'formdata', formdata: entries.map(e => (e.value.startsWith('@file:')
          ? { key: e.key, type: 'file', src: e.value.slice(6) }
          : { key: e.key, value: e.value, type: 'text' })) };
        // Postman writes the header itself with the multipart boundary; a hand-written one without
        // a boundary would make the body unparseable.
        if (!/boundary=/i.test(ctHeader.value)) sentHeaders = sentHeaders.filter(h => h !== ctHeader);
      } else {
        warn(`${row.tc_id}: multipart body is not a JSON object ({"field":"value","file":"@file:path"}) — sent as raw text.`);
        body = { mode: 'raw', raw: expanded, options: { raw: { language: 'text' } } };
      }
    } else if (ct.startsWith('application/x-www-form-urlencoded') && expanded.trim().startsWith('{')) {
      const entries = parseFormObject(expanded);
      if (entries) body = { mode: 'urlencoded', urlencoded: entries.map(e => ({ key: e.key, value: e.value, type: 'text' })) };
      else body = { mode: 'raw', raw: expanded, options: { raw: { language: 'text' } } };
    } else if (/xml/.test(ct)) {
      body = { mode: 'raw', raw: expanded, options: { raw: { language: 'xml' } } };
    } else if (ct && !/json/.test(ct)) {
      // text/plain, form-urlencoded written as a=1&b=2, wrong-Content-Type tests...: send as written
      body = { mode: 'raw', raw: expanded, options: { raw: { language: 'text' } } };
    } else {
      body = { mode: 'raw', raw: expanded, options: { raw: { language: 'json' } } };
    }
    for (const f of (body.formdata || []).filter(e => e.type === 'file')) fileUploads.add(f.src);
  }

  const request = {
    method: row.method,
    header: sentHeaders.map(h => ({ key: h.key, value: h.value, type: 'text' })),
    url: {
      raw: rawUrl,
      host: ['{{baseUrl}}'],
      path: pathParts
    }
  };
  if (query.length) request.url.query = query;
  if (body) request.body = body;

  if (auth) request.auth = auth;

  const descParts = [];
  if (row.pre_condition && row.pre_condition !== 'None' && row.pre_condition !== 'N/A') {
    descParts.push(`Pre-condition: ${row.pre_condition}`);
  }
  if (row.notes && row.notes !== '—' && row.notes !== '-' && row.notes !== 'N/A') {
    descParts.push(`Notes: ${row.notes}`);
  }

  const item = {
    name: `${row.tc_id} — ${row.description}`,
    request,
    event: [
      { listen: 'test', script: { exec: buildTestScript(row), type: 'text/javascript' } }
    ]
  };
  if (descParts.length) item.request.description = descParts.join(' | ');
  if (preRequest.length) {
    item.event.unshift({ listen: 'prerequest', script: { exec: [...new Set(preRequest)], type: 'text/javascript' } });
  }
  return item;
}

const moduleItems = [];
if (args.flat) {
  // File order is run order, except that a row noted "[ORDER: run after TC_X]" is moved right
  // after TC_X (after other rows already moved there). Consecutive rows of one module share a folder.
  const ids = new Set(rows.map(r => r.tc_id));
  const targetOf = r => {
    const m = `${r.notes} ${r.pre_condition}`.match(/\[ORDER:[^\]]*?\b(TC_\w+)/i);
    return m && ids.has(m[1]) && m[1] !== r.tc_id ? m[1] : null;
  };
  const ordered = rows.filter(r => !targetOf(r));
  let pending = rows.filter(r => targetOf(r));
  const lastAfter = new Map(); // target TC_ID -> TC_ID of the last row placed after it
  while (pending.length) {
    const next = [];
    for (const r of pending) {
      const target = targetOf(r);
      const anchor = lastAfter.get(target) || target;
      const idx = ordered.findIndex(x => x.tc_id === anchor);
      if (idx === -1) { next.push(r); continue; } // target not placed yet (it is deferred too)
      ordered.splice(idx + 1, 0, r);
      lastAfter.set(target, r.tc_id);
    }
    if (next.length === pending.length) { // circular [ORDER] references
      warn(`Circular [ORDER: ...] references: ${next.map(r => r.tc_id).join(', ')} — appended at the end.`);
      ordered.push(...next);
      break;
    }
    pending = next;
  }
  for (const row of ordered) {
    const last = moduleItems[moduleItems.length - 1];
    if (last && last.name === row.module) last.item.push(buildRequestItem(row));
    else moduleItems.push({ name: row.module, item: [buildRequestItem(row)] });
  }
} else {
  for (const [modName, epMap] of moduleMap) {
    const endpointItems = [];
    for (const [epName, ttMap] of epMap) {
      const testTypeItems = [];
      for (const [ttName, ttRows] of ttMap) {
        testTypeItems.push({ name: ttName, item: ttRows.map(buildRequestItem) });
      }
      endpointItems.push({ name: epName, item: testTypeItems });
    }
    moduleItems.push({ name: modName, item: endpointItems });
  }
  const orderRows = rows.filter(r => /\[ORDER:/i.test(`${r.notes} ${r.pre_condition}`));
  if (orderRows.length) {
    warn(`${orderRows.length} row(s) have [ORDER: ...] notes (${orderRows.slice(0, 5).map(r => r.tc_id).join(', ')}${orderRows.length > 5 ? ', ...' : ''}) — the Module > Endpoint > Test Type folders regroup rows, so these may run before the rows they depend on. Re-run with --flat to keep the file's row order.`);
  }
}

const collection = {
  info: {
    _postman_id: uuid(),
    name: COLLECTION_NAME,
    description: '', // filled in after variables are extracted
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
  },
  item: moduleItems
};
// Collection-level Bearer {{token}} only when some request inherits it ("Authorization: Bearer
// {{token}}" rows); APIs using API keys, Basic or cookies don't get an unused {{token}} variable.
const inheritsCollectionAuth = (function anyInherits(items) {
  return items.some(it => (it.item ? anyInherits(it.item) : !it.request.auth));
})(moduleItems);
if (inheritsCollectionAuth) {
  collection.auth = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] };
}
if (usesRunId) {
  collection.variable = [{ key: 'runId', value: '', type: 'string' }];
  // A run always starts at the first request, so a new runId is generated there.
  let first = moduleItems[0];
  while (first.item) first = first.item[0];
  const setRunId = 'pm.collectionVariables.set("runId", Date.now().toString(36));';
  const pre = first.event.find(e => e.listen === 'prerequest');
  if (pre) pre.script.exec.unshift(setRunId);
  else first.event.unshift({ listen: 'prerequest', script: { exec: [setRunId], type: 'text/javascript' } });
}

// ---- Extract variables ----
const collectionStr = JSON.stringify(collection);
const varSet = new Set();
let vm;
const varRegex = /\{\{(\w+)\}\}/g;
while ((vm = varRegex.exec(collectionStr)) !== null) {
  // _repeat_* are set by pre-request scripts; runId is a collection variable set by the first request
  if (!vm[1].startsWith('_repeat_') && vm[1] !== 'runId') varSet.add(vm[1]);
}

const envValues = [];
const priorityOrder = ['baseUrl', 'token', 'userToken'];
const seen = new Set();
for (const key of priorityOrder) {
  if (varSet.has(key)) {
    seen.add(key);
    envValues.push(key === 'baseUrl'
      ? { key, value: BASE_URL, type: 'default', enabled: true }
      : { key, value: '', type: 'secret', enabled: true });
  }
}
for (const key of varSet) {
  if (seen.has(key)) continue;
  const isSecretish = /token|secret|password|key/i.test(key);
  envValues.push({ key, value: '', type: isSecretish ? 'secret' : 'default', enabled: true });
  seen.add(key);
}
if (!varSet.has('baseUrl')) {
  envValues.unshift({ key: 'baseUrl', value: BASE_URL, type: 'default', enabled: true });
}

// Variables nobody sets at runtime (no pm.environment.set in any script) must be filled by hand.
const savedVars = new Set();
const setRegex = /pm\.environment\.set\(\\"(\w+)\\"/g; // quotes are escaped inside the stringified collection
while ((vm = setRegex.exec(collectionStr)) !== null) savedVars.add(vm[1]);
const manualVars = [...varSet].filter(v => v !== 'baseUrl' && !savedVars.has(v));
if (BASE_URL_IS_PLACEHOLDER) manualVars.unshift('baseUrl');

const descLines = [`Converted from ${path.basename(SRC)}.`];
if (manualVars.length) {
  descLines.push(`[NEEDS REVIEW] Fill these environment variables before running: ${manualVars.join(', ')}.`);
}
if (savedVars.size) {
  descLines.push(`Set automatically by earlier requests: ${[...savedVars].join(', ')} — run the collection in order.`);
}
descLines.push(`${needsReviewRows.length} test case(s) contain [NEEDS REVIEW] markers — see inline // TODO comments in the corresponding requests' test scripts.`);
if (fileUploads.size) {
  descLines.push(`[NEEDS REVIEW] Multipart rows upload these files — place them relative to the Newman working directory (--working-dir) or re-select them in Postman: ${[...fileUploads].join(', ')}.`);
}
collection.info.description = descLines.join('\n');

const environment = {
  id: uuid(),
  name: `${args.name || detectedTitle} - Local`,
  values: envValues,
  _postman_variable_scope: 'environment',
  _postman_exported_at: new Date().toISOString(),
  _postman_exported_using: 'Postman/10.0.0'
};

// ---- Validate ----
JSON.parse(JSON.stringify(collection));
JSON.parse(JSON.stringify(environment));

let totalRequests = 0;
(function countRequests(items) {
  for (const it of items) {
    if (it.item) countRequests(it.item);
    else totalRequests++;
  }
})(collection.item);

console.log(`Collection: ${COLLECTION_NAME}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Modules: ${moduleItems.length}`);
console.log(`Total requests: ${totalRequests}`);
console.log(`Variables: ${[...varSet].join(', ')}`);
console.log(`Auto-set variables: ${[...savedVars].join(', ') || '(none)'}`);
console.log(`Manual-fill variables: ${manualVars.join(', ') || '(none)'}`);
console.log(`NEEDS REVIEW rows: ${needsReviewRows.length}`);
console.log(`Schema checks: ${spec ? `${schemaStats.requests} request(s) validated against ${SPEC_SRC}${args.strictFormats ? ' (formats checked)' : ''}` : 'off'}`);
console.log(`Response-time limit: ${DEFAULT_MAX_TIME > 0 ? `${DEFAULT_MAX_TIME} ms` : 'off'}`);
if (fileUploads.size) {
  console.log(`Files uploaded by multipart rows (paths relative to where Newman/Postman runs): ${[...fileUploads].join(', ')}`);
}
if (schemaStats.missingOps.size) {
  warn(`Not found in the spec, so no schema check: ${[...schemaStats.missingOps].join(', ')}. Check the Endpoint/Method cells against the spec paths.`);
}

const collectionPath = path.join(OUT_DIR, `${FILE_BASE}-collection.json`);
const environmentPath = path.join(OUT_DIR, `${FILE_BASE}-environment.json`);

for (const p of [collectionPath, environmentPath]) {
  if (fs.existsSync(p)) warn(`${p} already exists and ${args.dryRun ? 'would be' : 'was'} overwritten.`);
}
for (const w of warnings) console.warn(`[WARN] ${w}`);
console.log(`Warnings: ${warnings.length}`);

if (args.dryRun) {
  console.log('Dry run — no files written.');
  process.exit(0);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
fs.writeFileSync(environmentPath, JSON.stringify(environment, null, 2), 'utf8');
console.log('Written:', collectionPath);
console.log('Written:', environmentPath);
