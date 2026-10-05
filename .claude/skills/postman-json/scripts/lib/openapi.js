/**
 * OpenAPI / Swagger helpers for generate-postman.js: load a spec (file or URL, JSON or YAML),
 * find the operation a test-case row calls, and turn its declared response schemas into plain
 * JSON Schema (draft-07) that Postman's pm.response.to.have.jsonSchema() (Ajv) accepts.
 *
 * Dependency-free on purpose: the skill must run with a bare Node install.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---- Loading ----

function readSource(src, baseDir) {
  if (/^https?:\/\//i.test(src)) {
    // Synchronous fetch in a child process keeps the generator a simple top-to-bottom script.
    const code = 'fetch(process.argv[1]).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })'
      + '.then(t => process.stdout.write(t)).catch(e => { console.error(e.message); process.exit(1); });';
    return execFileSync(process.execPath, ['-e', code, src], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const candidates = path.isAbsolute(src) ? [src] : [path.resolve(baseDir || '.', src), path.resolve(src)];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error(`spec file not found: ${src}`);
  return fs.readFileSync(found, 'utf8');
}

function loadSpec(src, baseDir) {
  const text = readSource(src, baseDir).replace(/^\uFEFF/, '');
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  return parseYaml(text);
}

// ---- Minimal YAML parser ----
// Covers the YAML subset OpenAPI documents use: block mappings and sequences, plain / quoted
// scalars, flow collections ([a, b], {a: 1}), block scalars (| and >), comments, and
// "- key: value" sequence items. Anchors/aliases, tags and multi-document streams are not supported.

function parseYaml(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    if (/^\s*(#.*)?$/.test(rawLine) || /^(---|\.\.\.)\s*$/.test(rawLine)) {
      lines.push({ blank: true, raw: rawLine, n: i + 1 });
      return;
    }
    const indent = rawLine.match(/^ */)[0].length;
    lines.push({ indent, text: rawLine.slice(indent), raw: rawLine, n: i + 1 });
  });
  let pos = 0;

  function skipBlank() { while (pos < lines.length && lines[pos].blank) pos++; }
  function fail(msg, line) { throw new Error(`YAML parse error at line ${line ? line.n : '?'}: ${msg}`); }

  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === q && !(q === '"' && s[i - 1] === '\\')) q = null;
        else if (q === "'" && c === "'" && s[i + 1] === "'") i++;
      } else if (c === '"' || c === "'") {
        if (i === 0 || /[\s:\[{,]/.test(s[i - 1])) q = c;
      } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
        return s.slice(0, i).trimEnd();
      }
    }
    return s.trimEnd();
  }

  // Position of the "key: value" separator outside quotes/brackets, or -1.
  function findColon(s) {
    let q = null; let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === q) q = null; continue; }
      if ((c === '"' || c === "'") && (i === 0 || /[\s:\[{,]/.test(s[i - 1]))) { q = c; continue; }
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ':' && depth === 0 && (i === s.length - 1 || s[i + 1] === ' ')) return i;
    }
    return -1;
  }

  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
    if (s.startsWith('"')) return JSON.parse(s.replace(/\\\//g, '/').replace(/\\'/g, "'"));
    if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (s.startsWith('[') || s.startsWith('{')) return flow(s);
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?(\d+|\d*\.\d+|\d+\.\d*)([eE][-+]?\d+)?$/.test(s)) return Number(s);
    if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
    return s;
  }

  function flow(s) {
    let i = 0;
    function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
    function value() {
      ws();
      if (s[i] === '[') {
        i++; const arr = [];
        ws(); if (s[i] === ']') { i++; return arr; }
        for (;;) { arr.push(value()); ws(); if (s[i] === ',') { i++; ws(); if (s[i] === ']') { i++; return arr; } continue; } if (s[i] === ']') { i++; return arr; } fail(`bad flow sequence: ${s}`); }
      }
      if (s[i] === '{') {
        i++; const obj = {};
        ws(); if (s[i] === '}') { i++; return obj; }
        for (;;) {
          ws(); const k = token(true); ws();
          if (s[i] !== ':') fail(`bad flow mapping: ${s}`);
          i++; obj[k] = value(); ws();
          if (s[i] === ',') { i++; ws(); if (s[i] === '}') { i++; return obj; } continue; }
          if (s[i] === '}') { i++; return obj; }
          fail(`bad flow mapping: ${s}`);
        }
      }
      return scalar(token(false));
    }
    function token(isKey) {
      ws();
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i]; let j = i + 1;
        while (j < s.length && !(s[j] === q && (q === "'" ? s[j + 1] !== "'" : s[j - 1] !== '\\'))) j += (q === "'" && s[j] === "'" ? 2 : 1);
        const t = s.slice(i, j + 1); i = j + 1;
        return isKey ? scalar(t) : t;
      }
      const start = i;
      while (i < s.length && !(isKey ? /[:,}\]]/ : /[,}\]]/).test(s[i])) i++;
      const t = s.slice(start, i).trim();
      return isKey ? String(scalar(t)) : t;
    }
    const v = value();
    return v;
  }

  function blockScalar(header, parentIndent) {
    const folded = header[0] === '>';
    const keep = header.includes('+'); const strip = header.includes('-');
    const out = []; let blockIndent = null;
    while (pos < lines.length) {
      const l = lines[pos];
      if (l.blank) { out.push(''); pos++; continue; }
      if (l.indent <= parentIndent) break;
      if (blockIndent === null) blockIndent = l.indent;
      out.push(l.raw.slice(blockIndent)); pos++;
    }
    while (!keep && out.length && out[out.length - 1] === '') out.pop();
    let s = folded ? out.join('\n').replace(/([^\n])\n(?=[^\n ])/g, '$1 ') : out.join('\n');
    if (!strip) s += '\n';
    return s;
  }

  // Value written after "key:" or "- " on the same line, or the nested block below it.
  function inlineOrNested(rest, ownIndent, line) {
    rest = stripComment(rest).trim();
    if (rest === '' ) {
      skipBlank();
      if (pos < lines.length && (lines[pos].indent > ownIndent || (lines[pos].indent === ownIndent && lines[pos].text.startsWith('- ')))) {
        return block(lines[pos].indent);
      }
      return null;
    }
    if (/^[|>][+-]?\d*$/.test(rest)) return blockScalar(rest, ownIndent);
    if (rest.startsWith('&') || rest.startsWith('*') || rest.startsWith('!')) fail('anchors, aliases and tags are not supported', line);
    return scalar(rest);
  }

  function block(indent) {
    skipBlank();
    const first = lines[pos];
    if (first.text === '-' || first.text.startsWith('- ')) {
      const arr = [];
      while (pos < lines.length) {
        skipBlank();
        const l = lines[pos];
        if (!l || l.indent !== indent || !(l.text === '-' || l.text.startsWith('- '))) break;
        const rest = l.text === '-' ? '' : l.text.slice(2);
        const itemIndent = indent + 2;
        if (rest && findColon(stripComment(rest)) !== -1 && !/^["'[{]/.test(rest.trim())) {
          // "- key: value" starts a mapping whose keys are aligned with "key"
          lines[pos] = { indent: itemIndent + (rest.length - rest.trimStart().length), text: rest.trimStart(), raw: l.raw, n: l.n };
          arr.push(block(lines[pos].indent));
        } else {
          pos++;
          arr.push(inlineOrNested(rest, indent, l));
        }
      }
      return arr;
    }
    const obj = {};
    while (pos < lines.length) {
      skipBlank();
      const l = lines[pos];
      if (!l || l.indent !== indent) { if (l && l.indent > indent) fail('unexpected indentation', l); break; }
      if (l.text.startsWith('- ')) break;
      const t = stripComment(l.text);
      const c = findColon(t);
      if (c === -1) fail(`expected "key: value", got "${l.text}"`, l);
      const key = String(scalar(t.slice(0, c)));
      pos++;
      obj[key] = inlineOrNested(t.slice(c + 1), indent, l);
    }
    return obj;
  }

  skipBlank();
  if (pos >= lines.length) return null;
  return block(lines[pos].indent);
}

// ---- Operation lookup ----

function resolveRef(spec, ref) {
  if (!ref.startsWith('#/')) throw new Error(`external $ref not supported: ${ref}`);
  return ref.slice(2).split('/').reduce((o, seg) => (o == null ? undefined : o[seg.replace(/~1/g, '/').replace(/~0/g, '~')]), spec);
}

function deref(spec, obj) {
  let guard = 0;
  while (obj && obj.$ref && guard++ < 20) obj = resolveRef(spec, obj.$ref);
  return obj;
}

// Server path prefixes (OpenAPI 3 servers[].url path, Swagger 2 basePath) a row's endpoint may include.
function basePaths(spec) {
  const out = new Set(['']);
  if (spec.basePath) out.add(spec.basePath.replace(/\/$/, ''));
  for (const s of spec.servers || []) {
    const m = String(s.url || '').match(/^(?:[a-z]+:\/\/[^/]+)?(\/[^?#]*)?/i);
    if (m && m[1]) out.add(m[1].replace(/\/$/, ''));
  }
  return [...out];
}

function findOperation(spec, endpoint, method) {
  const norm = p => p.replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/';
  const want = norm(endpoint.split('?')[0]);
  for (const [p, item] of Object.entries(spec.paths || {})) {
    for (const base of basePaths(spec)) {
      if (norm(base + p) === want) {
        const pathItem = deref(spec, item);
        const op = pathItem && pathItem[method.toLowerCase()];
        if (op) return { path: p, op };
      }
    }
  }
  return null;
}

function declaredMethods(spec, endpoint) {
  const norm = p => p.replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/';
  const want = norm(endpoint.split('?')[0]);
  for (const [p, item] of Object.entries(spec.paths || {})) {
    for (const base of basePaths(spec)) {
      if (norm(base + p) === want) {
        return Object.keys(deref(spec, item) || {}).filter(k => /^(get|put|post|delete|options|head|patch|trace)$/.test(k)).map(k => k.toUpperCase());
      }
    }
  }
  return null;
}

// JSON schema of the response declared for one status code, or null.
function responseSchema(spec, op, status) {
  const responses = op.responses || {};
  const code = String(status);
  const resp = deref(spec, responses[code] || responses[`${code[0]}XX`] || responses[`${code[0]}xx`]);
  if (!resp) return null;
  if (resp.content) {
    const types = Object.keys(resp.content);
    const jsonType = types.find(t => /^application\/json\b/i.test(t)) || types.find(t => /json/i.test(t));
    if (!jsonType) return null;
    return resp.content[jsonType].schema || null;
  }
  return resp.schema || null; // Swagger 2.0
}

// ---- OpenAPI schema -> JSON Schema ----

const SAFE_FORMATS = new Set(['date', 'date-time', 'time', 'email', 'hostname', 'ipv4', 'ipv6', 'uri', 'uri-reference', 'uuid', 'regex']);
const DROP = new Set(['example', 'examples', 'xml', 'externalDocs', 'deprecated', 'discriminator', 'readOnly', 'writeOnly', 'nullable', 'x-nullable', 'description', 'title', 'default', '$schema', 'contentMediaType', 'contentEncoding']);

function toJsonSchema(spec, schema, opts = {}, depth = 0, seen = []) {
  if (schema === true || schema === false) return schema;
  if (!schema || typeof schema !== 'object') return {};
  if (depth > 25) return {};
  if (schema.$ref) {
    if (seen.includes(schema.$ref)) return {}; // recursive schema: stop instead of looping
    const target = resolveRef(spec, schema.$ref);
    const merged = Object.assign({}, target, Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$ref')));
    return toJsonSchema(spec, merged, opts, depth + 1, seen.concat(schema.$ref));
  }
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DROP.has(k) || k.startsWith('x-')) continue;
    if (k === 'format') { if (opts.strictFormats && SAFE_FORMATS.has(v)) out.format = v; continue; }
    if (k === 'properties') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(v || {})) {
        const resolved = deref(spec, pv) || {};
        if (resolved.writeOnly) continue; // writeOnly fields never appear in responses
        out.properties[pk] = toJsonSchema(spec, pv, opts, depth + 1, seen);
      }
      continue;
    }
    if (k === 'required' && Array.isArray(v)) {
      out.required = v.filter(name => {
        const p = schema.properties && deref(spec, schema.properties[name]);
        return !(p && p.writeOnly);
      });
      if (!out.required.length) delete out.required;
      continue;
    }
    if (k === 'items' || k === 'additionalProperties' || k === 'not') {
      out[k] = typeof v === 'object' ? toJsonSchema(spec, v, opts, depth + 1, seen) : v;
      continue;
    }
    if (k === 'allOf' || k === 'anyOf' || k === 'oneOf') {
      out[k] = v.map(s => toJsonSchema(spec, s, opts, depth + 1, seen));
      continue;
    }
    if (k === 'exclusiveMinimum' || k === 'exclusiveMaximum') {
      // OpenAPI 3.0 boolean form -> draft-07 numeric form
      if (v === true) { const base = k === 'exclusiveMinimum' ? 'minimum' : 'maximum'; if (schema[base] !== undefined) out[k] = schema[base]; }
      else if (typeof v === 'number') out[k] = v;
      continue;
    }
    if ((k === 'minimum' || k === 'maximum') && schema[k === 'minimum' ? 'exclusiveMinimum' : 'exclusiveMaximum'] === true) continue;
    out[k] = v;
  }
  // Swagger 2 has no "type: object" requirement; keep as written. Add null when the field is nullable.
  if (schema.nullable === true || schema['x-nullable'] === true) {
    if (out.type) out.type = Array.isArray(out.type) ? [...new Set(out.type.concat('null'))] : [out.type, 'null'];
    if (out.enum && !out.enum.includes(null)) out.enum = out.enum.concat(null);
    for (const comb of ['oneOf', 'anyOf']) if (out[comb]) out[comb] = out[comb].concat({ type: 'null' });
    if (out.allOf && !out.type) { out.anyOf = [{ allOf: out.allOf }, { type: 'null' }]; delete out.allOf; }
  }
  return out;
}

module.exports = { loadSpec, parseYaml, findOperation, declaredMethods, responseSchema, toJsonSchema };
