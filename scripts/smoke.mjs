// An opt-in compatibility check for the endpoint's 2025 Streamable HTTP protocol.
// This is a small smoke client, not a general-purpose MCP SDK.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkManifests, ENDPOINT, TOOLS } from './check-manifests.mjs';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MAX_BYTES = 1024 * 1024;

function resultFor(message, id) {
  if (!message || message.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC envelope');
  if (message.id !== id) return undefined;
  if (message.error) throw new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`);
  if (!message.result || typeof message.result !== 'object' || Array.isArray(message.result)) {
    throw new Error('Missing JSON-RPC result object');
  }
  return message.result;
}

export async function readResult(response, id) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!['application/json', 'text/event-stream'].includes(type)) {
    throw new Error(`Unexpected response content type: ${type}`);
  }
  if (!response.body) throw new Error('Empty response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0, eventData = [];
  const event = () => {
    if (!eventData.length) return undefined;
    const data = eventData.join('\n');
    eventData = [];
    return resultFor(JSON.parse(data), id);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > MAX_BYTES) throw new Error('Response exceeds 1 MiB limit');
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (type === 'application/json') {
        if (done) break;
        continue;
      }
      let newline;
      while ((newline = buffer.search(/[\r\n]/)) !== -1) {
        // A CR at a chunk boundary may be the first half of CRLF.
        if (buffer[newline] === '\r' && newline === buffer.length - 1 && !done) break;
        const line = buffer.slice(0, newline);
        const delimiter = buffer.slice(newline, newline + 2) === '\r\n' ? 2 : 1;
        buffer = buffer.slice(newline + delimiter);
        if (line === '') {
          const result = event();
          if (result !== undefined) return result;
        } else if (line === 'data' || line.startsWith('data:')) {
          eventData.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''));
        }
      }
      if (done) break;
    }
    if (type === 'application/json') {
      const result = resultFor(JSON.parse(buffer), id);
      if (result !== undefined) return result;
    }
    throw new Error('Stream ended without a matching JSON-RPC response');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class SmokeClient {
  constructor(endpoint = ENDPOINT, { timeoutMs = 15000, fetchImpl = fetch } = {}) {
    assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'timeoutMs must be positive and finite');
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.nextId = 1;
    this.protocol = null;
    this.session = null;
  }

  async send(method, params, notification = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`MCP request timed out: ${method}`)), this.timeoutMs);
    const id = notification ? undefined : this.nextId++;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (this.protocol) headers['MCP-Protocol-Version'] = this.protocol;
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    try {
      const response = await this.fetch(this.endpoint, {
        method: 'POST', redirect: 'error', headers, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} for ${method}`);
      }
      if (notification) {
        await response.body?.cancel();
        if (response.status !== 202) throw new Error(`Notification expected HTTP 202, got ${response.status}`);
        return;
      }
      const result = await readResult(response, id);
      if (method === 'initialize') this.session = response.headers.get('mcp-session-id');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const result = await this.send('initialize', {
      protocolVersion: VERSIONS[0], capabilities: {},
      clientInfo: { name: 'valor-mcp-smoke', version: '1.0.0' },
    });
    if (!VERSIONS.includes(result.protocolVersion)) throw new Error(`Unsupported negotiated protocol: ${result.protocolVersion}`);
    this.protocol = result.protocolVersion;
    assert(result.capabilities && typeof result.capabilities.tools === 'object', 'Server must advertise tools');
    assert(typeof result.serverInfo?.name === 'string', 'Server must identify itself');
    await this.send('notifications/initialized', undefined, true);
    return result;
  }

  async listTools() {
    const tools = [], cursors = new Set();
    let cursor;
    for (let page = 0; page < 10; page++) {
      const result = await this.send('tools/list', cursor ? { cursor } : {});
      assert(Array.isArray(result.tools), 'tools/list must return an array');
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (cursor === undefined) return tools;
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new Error('Invalid or repeated tools cursor');
      cursors.add(cursor);
    }
    throw new Error('tools/list exceeded 10 pages');
  }

  async close() {
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    const response = await this.fetch(this.endpoint, {
      method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': this.protocol ?? VERSIONS[0] },
    });
    await response.body?.cancel();
    if (!response.ok && ![404, 405].includes(response.status)) throw new Error(`Session cleanup returned HTTP ${response.status}`);
  }
}

export async function smoke(client = new SmokeClient()) {
  let failure;
  try {
    const info = await client.initialize();
    const listed = await client.listTools();
    const names = listed.map(tool => tool.name);
    assert.equal(new Set(names).size, names.length, 'Tool names must be unique');
    for (const name of TOOLS) {
      const tool = listed.find(item => item.name === name);
      assert(tool, `Missing tool: ${name}`);
      assert.equal(tool.inputSchema?.type, 'object', `${name} needs an object input schema`);
      assert.equal(tool.annotations?.readOnlyHint, true, `${name} must advertise read-only operation`);
      assert.equal(tool.annotations?.destructiveHint, false, `${name} must not advertise destructive operation`);
    }
    const calls = [
      ['ask_va_benefits_question', { question: 'What is the Benefits Delivery at Discharge program?' }],
      ['bdd_separation_checklist', { daysUntilSeparation: 120 }],
      ['estimate_combined_rating', { ratings: [{ rating: 50 }, { rating: 30 }] }],
    ];
    for (const [name, args] of calls) {
      const result = await client.send('tools/call', { name, arguments: args });
      assert(result.isError !== true, `${name} returned a tool error`);
      assert(Array.isArray(result.content) && result.content.length > 0, `${name} returned no content`);
      assert(result.content.some(item => item.type === 'text' && typeof item.text === 'string' && item.text.trim()),
        `${name} returned no usable text`);
      if (name === 'estimate_combined_rating') {
        assert.equal(result.structuredContent?.rawCombinedRating, 65, 'Synthetic 50/30 fixture must combine to 65');
        assert.equal(result.structuredContent?.payableCombinedRating, 70, 'Synthetic 50/30 fixture must round to 70');
        assert.equal(result.structuredContent?.bilateralFactorApplied, false);
      }
    }
    return { endpoint: client.endpoint, protocol: info.protocolVersion, server: info.serverInfo,
      advertisedTools: names, successfulCalls: calls.map(([name]) => name) };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      await client.close();
    } catch (error) {
      if (!failure) throw error;
      failure.message += ` (session cleanup also failed: ${error.message})`;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--live') {
    console.error('Usage: node scripts/smoke.mjs --live (sends three synthetic read-only tool calls)');
    process.exitCode = 2;
  } else {
    try {
      checkManifests();
      console.log(JSON.stringify(await smoke(), null, 2));
    } catch (error) {
      console.error(`MCP smoke check failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
