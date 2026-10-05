/**
 * Regression tests for generate-postman.js. Run from the repo root:
 *   node --test .claude/skills/postman-json/scripts/test/generate-postman.test.js
 *
 * - "structure" tests need only Node (>= 18).
 * - The end-to-end test runs the generated collection with Newman against fixtures/mock-server.js.
 *   It is skipped when Newman is not installed; install it with `npm i -g newman` or point
 *   NEWMAN_PATH at a node_modules/newman folder.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const openapi = require('../lib/openapi');

const HERE = __dirname;
const GENERATOR = path.join(HERE, '..', 'generate-postman.js');
const CASES = path.join(HERE, 'fixtures', 'cases.md');

function generate(extraArgs = []) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'postman-json-test-'));
  const run = spawnSync(process.execPath, [GENERATOR, CASES, '--out-dir', out, '--file-base', 'fx', ...extraArgs], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  const log = run.stdout + run.stderr; // [WARN] lines go to stderr
  const collection = JSON.parse(fs.readFileSync(path.join(out, 'fx-collection.json'), 'utf8'));
  const environment = JSON.parse(fs.readFileSync(path.join(out, 'fx-environment.json'), 'utf8'));
  return { out, log, collection, environment };
}

function requests(items, acc = []) {
  for (const it of items) (it.item ? requests(it.item, acc) : acc.push(it));
  return acc;
}
const byId = reqs => Object.fromEntries(reqs.map(r => [r.name.split(' ')[0], r]));
const script = (item, listen = 'test') => ((item.event.find(e => e.listen === listen) || {}).script || { exec: [] }).exec.join('\n');

// ---- openapi.js ----

test('YAML parser handles the OpenAPI subset (flow maps, quotes, block scalars, $ref)', () => {
  const spec = openapi.loadSpec(path.join(HERE, 'fixtures', 'spec.yaml'));
  assert.strictEqual(spec.info.title, 'Shop API');
  assert.strictEqual(spec.info.version, '1.2');
  assert.strictEqual(spec.info.description, 'Multi-line\ndescription: with colon\n');
  assert.strictEqual(spec.components.schemas.Product.properties.name.example, 'O\'Brien: "quoted"');
  assert.deepStrictEqual(spec.paths['/products'].get.tags, ['Products']);
  assert.strictEqual(spec.paths['/login'].post.responses['401'].$ref, '#/components/responses/Error');
});

test('response schemas: $ref, nullable, writeOnly, recursion, exclusiveMinimum, server base path', () => {
  const spec = openapi.loadSpec(path.join(HERE, 'fixtures', 'spec.yaml'));
  const found = openapi.findOperation(spec, '/api/v1/products', 'POST'); // base path from servers[0]
  assert.ok(found);
  const s = openapi.toJsonSchema(spec, openapi.responseSchema(spec, found.op, 201));
  assert.deepStrictEqual(s.required, ['id', 'name']);
  assert.deepStrictEqual(s.properties.tag.type, ['string', 'null']);
  assert.ok(s.properties.tag.enum.includes(null));
  assert.ok(!('secret' in s.properties), 'writeOnly property must be dropped');
  assert.deepStrictEqual(s.properties.parent, {}, 'recursive $ref must stop');
  assert.strictEqual(s.properties.price.exclusiveMinimum, 0);
  assert.ok(!('format' in s.properties.id), 'formats are dropped unless strictFormats');
  const err = openapi.toJsonSchema(spec, openapi.responseSchema(spec, found.op, 400));
  assert.deepStrictEqual(err.required, ['error']);
  assert.strictEqual(openapi.responseSchema(spec, openapi.findOperation(spec, '/products/{x}', 'DELETE').op, 204), null);
});

test('Swagger 2.0: basePath, definitions, x-nullable, response.schema', () => {
  const spec = {
    swagger: '2.0', basePath: '/v2',
    paths: { '/pets/{petId}': { get: { responses: { 200: { description: 'ok', schema: { $ref: '#/definitions/Pet' } } } } } },
    definitions: { Pet: { type: 'object', required: ['id'], properties: { id: { type: 'integer', format: 'int64' }, tag: { type: 'string', 'x-nullable': true } } } }
  };
  const found = openapi.findOperation(spec, '/v2/pets/{id}', 'GET');
  assert.ok(found);
  const s = openapi.toJsonSchema(spec, openapi.responseSchema(spec, found.op, 200));
  assert.deepStrictEqual(s, { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, tag: { type: ['string', 'null'] } } });
  assert.deepStrictEqual(openapi.declaredMethods(spec, '/v2/pets/{x}'), ['GET']);
});

// ---- generator output ----

test('every row becomes one request and every script compiles', () => {
  const { collection } = generate(['--flat']);
  const reqs = requests(collection.item);
  assert.strictEqual(reqs.length, 16);
  for (const r of reqs) for (const e of r.event) assert.doesNotThrow(() => new Function('pm', e.script.exec.join('\n')), r.name);
});

test('--flat keeps file order and moves [ORDER: run after X] rows after X', () => {
  const { collection } = generate(['--flat']);
  const order = requests(collection.item).map(r => r.name.split(' ')[0]);
  assert.ok(order.indexOf('TC_PRODUCTS_GET_002') === order.indexOf('TC_PRODUCTS_DELETE_001') + 1, order.join(' > '));
  assert.strictEqual(order[0], 'TC_PRODUCTS_GET_001');
});

test('folder mode warns about [ORDER] rows', () => {
  const { log, collection } = generate();
  assert.match(log, /\[ORDER: \.\.\.\] notes/);
  assert.strictEqual(collection.item[0].item[0].name, 'GET /products');
});

test('query and path values are percent-encoded, {{vars}} and %XX kept', () => {
  const r = byId(requests(generate(['--flat']).collection.item));
  const q = r.TC_PRODUCTS_GET_001.request.url;
  assert.deepStrictEqual(q.query, [{ key: 'q', value: 'a%26b%20%23c%2Bd%20e%2F' }, { key: 'debug', value: null }]);
  assert.ok(q.raw.endsWith('?q=a%26b%20%23c%2Bd%20e%2F&debug'));
  assert.deepStrictEqual(r.TC_MISC_GET_001.request.url.path, ['echo-path', 'a%20b%23c%3Fd']);
  assert.deepStrictEqual(r.TC_PRODUCTS_DELETE_001.request.url.path, ['products', '{{productId}}']);
});

test('body encodings follow Content-Type', () => {
  const r = byId(requests(generate(['--flat']).collection.item));
  const mp = r.TC_PRODUCTS_POST_001.request;
  assert.strictEqual(mp.body.mode, 'formdata');
  assert.deepStrictEqual(mp.body.formdata, [
    { key: 'name', value: 'Pen {{runId}}', type: 'text' },
    { key: 'image', type: 'file', src: 'fixtures/pixel.gif' },
    { key: 'tags', value: 'a', type: 'text' },
    { key: 'tags', value: 'b', type: 'text' }
  ]);
  assert.ok(!mp.header.some(h => /content-type/i.test(h.key)), 'Postman must set the multipart boundary itself');
  assert.strictEqual(r.TC_AUTH_POST_001.request.body.mode, 'urlencoded');
  assert.deepStrictEqual(r.TC_AUTH_POST_002.request.body, { mode: 'raw', raw: 'user=bob&pass=right', options: { raw: { language: 'text' } } });
  assert.strictEqual(r.TC_MISC_POST_001.request.body.options.raw.language, 'xml');
  assert.match(script(r.TC_PRODUCTS_POST_003, 'prerequest'), /"z"\.repeat\(2000\)/);
});

test('auth: Basic user:pass -> basic auth, other credentials verbatim, no unused collection bearer', () => {
  const { collection, environment } = generate(['--flat']);
  const r = byId(requests(collection.item));
  assert.deepStrictEqual(r.TC_AUTH_GET_001.request.auth.basic.map(x => x.value), ['alice', 's3cret']);
  assert.strictEqual(r.TC_AUTH_GET_001.request.header.length, 0);
  assert.strictEqual(r.TC_AUTH_GET_003.request.auth.type, 'noauth');
  assert.deepStrictEqual(r.TC_AUTH_GET_003.request.header, [{ key: 'Authorization', value: 'Basic Ym9iOndyb25n', type: 'text' }]);
  assert.deepStrictEqual(r.TC_AUTH_GET_002.request.header, [{ key: 'X-API-Key', value: '{{apiKey}}', type: 'text' }]);
  assert.strictEqual(collection.auth, undefined);
  assert.ok(!environment.values.some(v => v.key === 'token'));
});

test('assertions: schema, headers, indexed paths, absence, variables, time limit, runId', () => {
  const { collection, environment } = generate(['--flat']);
  const r = byId(requests(collection.item));
  const s1 = script(r.TC_PRODUCTS_GET_001);
  assert.match(s1, /pm\.response\.to\.have\.jsonSchema/);
  assert.match(s1, /headers\.get\("Content-Type"\)/);
  assert.match(s1, /json\.items\[0\]\.id/);
  assert.match(s1, /json\.items\[0\]\.tag\)\.to\.equal\(null\)/);
  assert.match(s1, /json\.echo\.q\)\.to\.eql\("a&b #c\+d e\/"\)/);
  const s2 = script(r.TC_PRODUCTS_POST_001);
  assert.match(s2, /replaceIn\("Pen \{\{runId\}\}"\)/);
  assert.match(s2, /json\.fields\.tags\[1\]\)\.to\.eql\("b"\)/);
  assert.match(s2, /"secret" is not present|secret is not present/);
  assert.match(s2, /headers\.has\("Location"\)/);
  assert.match(s2, /Number\.isInteger\(json\.id\)/);
  assert.match(script(r.TC_PRODUCTS_POST_003), /below\(5000\)/);
  assert.ok(!/jsonSchema/.test(script(r.TC_PRODUCTS_PATCH_001)), 'no schema for an undeclared method');
  assert.ok(!/jsonSchema/.test(script(r.TC_PRODUCTS_DELETE_001)), 'no schema for 204');
  assert.match(script(requests(collection.item)[0], 'prerequest'), /collectionVariables\.set\("runId"/);
  assert.deepStrictEqual(collection.variable, [{ key: 'runId', value: '', type: 'string' }]);
  assert.ok(!environment.values.some(v => v.key === 'runId'));
});

test('--max-time 0 drops time assertions; --no-schema drops schema checks', () => {
  const r = byId(requests(generate(['--flat', '--max-time', '0', '--no-schema']).collection.item));
  assert.ok(!/responseTime/.test(script(r.TC_PRODUCTS_GET_001)));
  assert.ok(!/jsonSchema/.test(script(r.TC_PRODUCTS_GET_001)));
  assert.match(script(r.TC_PRODUCTS_POST_003), /below\(5000\)/, 'a row [MAX-TIME] still applies');
});

// ---- end to end ----

function findNewman() {
  const candidates = [process.env.NEWMAN_PATH, 'newman'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try next */ }
  }
  try {
    const globalRoot = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
    return require(path.join(globalRoot, 'newman'));
  } catch (e) { return null; }
}

test('end to end with Newman: only the EXPECTED-FAIL assertions fail', async t => {
  const newman = findNewman();
  if (!newman) { t.skip('newman not installed (npm i -g newman, or set NEWMAN_PATH)'); return; }
  const { collection, environment } = generate(['--flat']);
  const expected = {};
  for (const line of fs.readFileSync(CASES, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\| (TC_\w+) .*EXPECTED-FAIL: ([^|]+?) \|$/);
    if (m) expected[m[1]] = m[2].trim();
  }
  const { start } = require('./fixtures/mock-server');
  const server = await start(4010);
  try {
    const summary = await new Promise((resolve, reject) => newman.run({
      collection, environment, envVar: [{ key: 'apiKey', value: 'k-123' }], workingDir: HERE, reporters: []
    }, (err, s) => (err ? reject(err) : resolve(s))));
    const problems = [];
    for (const ex of summary.run.executions) {
      const id = ex.item.name.split(' ')[0];
      const failed = (ex.assertions || []).filter(a => a.error).map(a => a.assertion);
      const want = expected[id];
      if (want) {
        if (!failed.includes(want)) problems.push(`${id}: expected "${want}" to fail, failed: [${failed.join(', ')}]`);
        const other = failed.filter(f => f !== want);
        if (other.length) problems.push(`${id}: unexpected failures [${other.join(', ')}]`);
      } else if (failed.length) {
        problems.push(`${id}: ${failed.join(', ')}`);
      }
    }
    assert.strictEqual(summary.run.executions.length, 16);
    assert.deepStrictEqual(problems, []);
  } finally {
    server.close();
  }
});
