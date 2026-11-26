import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkManifests, ROOT, ENDPOINT, TOOLS } from '../scripts/check-manifests.mjs';
import { readResult, SmokeClient, smoke } from '../scripts/smoke.mjs';

const descriptors = () => TOOLS.map(name => ({ name, inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true, destructiveHint: false } }));

async function fixture(t, { session = true, format = 'json', toolError = false,
  tools = descriptors(), cursor, hang = false, badMath = false, cleanupStatus = 204 } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, headers: req.headers, body });
    if (hang) return;
    if (req.method === 'DELETE') {
      res.writeHead(cleanupStatus).end();
      return;
    }
    if (body.method === 'notifications/initialized') {
      res.writeHead(202).end();
      return;
    }
    let result;
    if (body.method === 'initialize') {
      if (session) res.setHeader('Mcp-Session-Id', 'test-session');
      result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } };
    } else if (body.method === 'tools/list') {
      result = { tools, ...(cursor === undefined ? {} : { nextCursor: cursor }) };
    } else {
      result = { content: [{ type: 'text', text: 'Synthetic fixture response' }], isError: toolError };
      if (body.params.name === 'estimate_combined_rating') {
        result.structuredContent = { rawCombinedRating: 65, payableCombinedRating: badMath ? 60 : 70, bilateralFactorApplied: false };
      }
    }
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
    res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/event-stream');
    res.end(format === 'json' ? message : `: heartbeat\r\nevent: message\r\ndata: ${message}\r\n\r\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  return { client: new SmokeClient(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 2000 }), requests };
}

test('all published manifests, logo and README agree', () => {
  assert.deepEqual(checkManifests(), { endpoint: ENDPOINT, version: '1.0.0', tools: TOOLS });
});

test('manifest drift and accidental credentials fail validation', t => {
  const root = mkdtempSync(join(tmpdir(), 'valor-manifests-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['mcp.json', 'server.json', 'README.md', '.cursor-plugin', 'assets']) {
    cpSync(join(ROOT, path), join(root, path), { recursive: true });
  }
  const original = readFileSync(join(root, 'mcp.json'), 'utf8');
  writeFileSync(join(root, 'mcp.json'), original.replace('/mcp/public', '/wrong'));
  assert.throws(() => checkManifests(root), /must match/);
  const credentials = { mcpServers: { 'valor-ai': { url: ENDPOINT, headers: { Authorization: 'fixture-only' } } } };
  for (const path of ['mcp.json', '.cursor-plugin/mcp.json']) writeFileSync(join(root, path), JSON.stringify(credentials));
  assert.throws(() => checkManifests(root), /without credentials/);
});

test('version drift and missing logo fail validation', t => {
  const root = mkdtempSync(join(tmpdir(), 'valor-manifests-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['mcp.json', 'server.json', 'README.md', '.cursor-plugin', 'assets']) {
    cpSync(join(ROOT, path), join(root, path), { recursive: true });
  }
  const path = join(root, '.cursor-plugin/plugin.json');
  const plugin = JSON.parse(readFileSync(path, 'utf8'));
  plugin.version = '9.0.0';
  writeFileSync(path, JSON.stringify(plugin));
  assert.throws(() => checkManifests(root), /versions must agree/);
  plugin.version = '1.0.0';
  plugin.logo = 'assets/missing.png';
  writeFileSync(path, JSON.stringify(plugin));
  assert.throws(() => checkManifests(root), /ENOENT/);
});

for (const format of ['json', 'sse']) {
  test(`full ${format} lifecycle forwards negotiated version/session and uses synthetic calls`, async t => {
    const { client, requests } = await fixture(t, { format });
    const result = await smoke(client);
    assert.deepEqual(result.successfulCalls, TOOLS);
    assert.equal(requests.length, 7);
    assert.equal(requests[0].body.method, 'initialize');
    assert.equal(requests[1].body.method, 'notifications/initialized');
    assert.equal(requests[1].body.id, undefined);
    for (const req of requests.slice(1)) {
      assert.equal(req.headers['mcp-protocol-version'], '2025-11-25');
      assert.equal(req.headers['mcp-session-id'], 'test-session');
      assert.equal(req.headers.authorization, undefined);
      assert.equal(req.headers.cookie, undefined);
    }
    assert.equal(requests.at(-1).method, 'DELETE');
    assert.deepEqual(requests[5].body.params.arguments, { ratings: [{ rating: 50 }, { rating: 30 }] });
  });
}

test('stateless endpoint needs no session cleanup', async t => {
  const { client, requests } = await fixture(t, { session: false });
  await smoke(client);
  assert.equal(requests.length, 6);
  assert(requests.every(req => req.headers['mcp-session-id'] === undefined));
});

test('a tool error fails the smoke check and still closes its session', async t => {
  const { client, requests } = await fixture(t, { toolError: true });
  await assert.rejects(smoke(client), /returned a tool error/);
  assert.equal(requests.at(-1).method, 'DELETE');
});

test('a wrong numeric rating fixture fails validation', async t => {
  const { client } = await fixture(t, { badMath: true });
  await assert.rejects(smoke(client), /must round to 70/);
});

test('missing or non-read-only tools fail before any tool call', async t => {
  const tools = descriptors();
  tools[0].annotations.readOnlyHint = false;
  const { client, requests } = await fixture(t, { tools });
  await assert.rejects(smoke(client), /must advertise read-only/);
  assert(!requests.some(req => req.body?.method === 'tools/call'));
});

test('repeated pagination cursor fails without an unbounded loop', async t => {
  const { client, requests } = await fixture(t, { cursor: 'same-page' });
  await assert.rejects(smoke(client), /repeated tools cursor/);
  assert.equal(requests.filter(req => req.body?.method === 'tools/list').length, 2);
});

test('a server that never responds reaches the total request deadline', async t => {
  const { client } = await fixture(t, { hang: true });
  client.timeoutMs = 30;
  await assert.rejects(client.initialize(), /timed out/);
});

test('a server may refuse explicit session termination with 405', async t => {
  const { client } = await fixture(t, { cleanupStatus: 405 });
  await smoke(client);
});

test('cleanup failure preserves the original tool error', async t => {
  const { client } = await fixture(t, { toolError: true, cleanupStatus: 500 });
  await assert.rejects(smoke(client), /returned a tool error.*cleanup also failed/);
});

test('JSON-RPC error, wrong id, invalid envelope and empty result fail', async () => {
  for (const body of [
    { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } },
    { jsonrpc: '2.0', id: 99, result: {} },
    { jsonrpc: '1.0', id: 1, result: {} },
    { jsonrpc: '2.0', id: 1 },
  ]) {
    await assert.rejects(readResult(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }), 1));
  }
});

test('SSE handles chunk boundaries, multiline JSON, comments and other response ids', async () => {
  const text = ': ping\r\ndata: {"jsonrpc":"2.0","id":9,"result":{}}\r\n\r\n'
    + 'event: message\r\ndata: {"jsonrpc":"2.0","id":1,\r\ndata: "result":{"ok":"café"}}\r\n\r\n';
  const encoded = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3));
    controller.close();
  } });
  assert.deepEqual(await readResult(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), 1), { ok: 'café' });
});

test('SSE accepts CR-only line endings and case-insensitive media types', async () => {
  const response = new Response('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\r\r', {
    headers: { 'Content-Type': 'Text/Event-Stream; charset=utf-8' },
  });
  assert.deepEqual(await readResult(response, 1), { ok: true });
});

test('unexpected content types, truncated SSE and oversized bodies fail', async () => {
  await assert.rejects(readResult(new Response('<html>gateway error</html>', { headers: { 'Content-Type': 'text/html' } }), 1), /content type/);
  await assert.rejects(readResult(new Response('data: {"jsonrpc":"2.0","id":1,"result":{}}', { headers: { 'Content-Type': 'text/event-stream' } }), 1), /without a matching/);
  await assert.rejects(readResult(new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }), 1), /1 MiB limit/);
});

test('HTTP failures are reported without treating their body as successful MCP', async () => {
  const client = new SmokeClient(ENDPOINT, { fetchImpl: async () => new Response('rate limited', { status: 429 }) });
  await assert.rejects(client.initialize(), /HTTP 429/);
});

test('CLI requires the explicit live flag', () => {
  const result = spawnSync(process.execPath, ['scripts/smoke.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--live/);
});
