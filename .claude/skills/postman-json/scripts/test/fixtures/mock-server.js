/**
 * Local mock of fixtures/spec.yaml for the end-to-end test (Newman runs cases.md against it).
 * Some responses are wrong on purpose (see "EXPECTED-FAIL" rows in cases.md) to prove the
 * generated assertions catch them.
 */
const http = require('http');

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Minimal multipart/form-data parser: fields -> string, files -> {filename, size}
function parseMultipart(buf, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) return null;
  const boundary = '--' + (m[1] || m[2]);
  const fields = {}; const files = {};
  const parts = buf.toString('latin1').split(boundary).slice(1, -1);
  for (const part of parts) {
    const [head, ...rest] = part.replace(/^\r\n/, '').split('\r\n\r\n');
    const content = rest.join('\r\n\r\n').replace(/\r\n$/, '');
    const name = (head.match(/name="([^"]*)"/) || [])[1];
    const filename = (head.match(/filename="([^"]*)"/) || [])[1];
    if (filename !== undefined) files[name] = { filename, size: Buffer.byteLength(content, 'latin1') };
    else if (name in fields) fields[name] = [].concat(fields[name], Buffer.from(content, 'latin1').toString('utf8'));
    else fields[name] = Buffer.from(content, 'latin1').toString('utf8');
  }
  return { fields, files };
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, Object.assign(body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }, headers));
  res.end(payload);
}

function start(port = 4010) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname.replace(/^\/api\/v1/, '');
    const body = await readBody(req);
    const ct = req.headers['content-type'] || '';

    if (route === '/products' && req.method === 'GET') {
      const echo = {};
      for (const [k, v] of url.searchParams) echo[k] = v;
      return send(res, 200, { items: [{ id: 1, name: 'Pen', price: 2.5, tag: null }], echo });
    }
    if (route === '/products' && req.method === 'POST') {
      if (!ct.startsWith('multipart/form-data')) return send(res, 400, { error: 'multipart required' });
      const form = parseMultipart(body, ct);
      if (!form) return send(res, 400, { error: 'bad multipart' });
      if (req.headers['x-api-key'] !== 'k-123') return send(res, 401, { error: 'missing api key' });
      const bad = form.fields.name === 'bad-schema';
      return send(res, 201, { id: bad ? 'not-a-number' : 101, name: form.fields.name, fields: form.fields, file: form.files.image || null },
        bad ? {} : { Location: '/api/v1/products/101' });
    }
    if (route === '/products' && req.method === 'PATCH') {
      return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET, POST' });
    }
    if (/^\/products\/[^/]+$/.test(route) && req.method === 'DELETE') return send(res, 204);
    if (route === '/login' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(body.toString('utf8')));
      if (form.pass === 'right') return send(res, 200, { form, contentType: ct });
      return send(res, 401, { error: 'Invalid user or password' });
    }
    if (route === '/secure' && req.method === 'GET') {
      const auth = req.headers.authorization || '';
      if (auth === 'Basic ' + Buffer.from('alice:s3cret').toString('base64')) return send(res, 200, { user: 'alice' });
      if (req.headers['x-api-key'] === 'k-123') return send(res, 200, { user: 'key-client' });
      return send(res, 401, url.searchParams.has('leak') ? { error: 'Invalid user or password', password: 'hunter2' } : { error: 'Invalid user or password' });
    }
    if (route === '/xml' && req.method === 'POST') {
      return send(res, 200, { echo: { contentType: ct, body: body.toString('utf8') } });
    }
    const echoPath = route.match(/^\/echo-path\/(.*)$/);
    if (echoPath && req.method === 'GET') {
      return send(res, 200, { path: echoPath[1], decoded: { value: decodeURIComponent(echoPath[1]) } });
    }
    send(res, 404, { error: 'not found' });
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

module.exports = { start };
if (require.main === module) start().then(() => console.log('mock listening on http://localhost:4010/api/v1'));
