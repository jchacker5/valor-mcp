import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENDPOINT = 'https://www.tryvalor.ai/mcp/public';
export const TOOLS = ['ask_va_benefits_question', 'bdd_separation_checklist', 'estimate_combined_rating'];

export function checkManifests(root = ROOT) {
  const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const config = read('mcp.json');
  const duplicate = read('.cursor-plugin/mcp.json');
  const plugin = read('.cursor-plugin/plugin.json');
  const server = read('server.json');
  assert.deepEqual(config, duplicate, 'The two MCP client configurations must match');
  assert.deepEqual(config, { mcpServers: { 'valor-ai': { url: ENDPOINT } } },
    'The public connector must use the documented HTTPS endpoint without credentials');
  assert.deepEqual(server.remotes, [{ type: 'streamable-http', url: ENDPOINT }]);
  assert.equal(server.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.equal(server.name, 'ai.tryvalor/valorai-mcp');
  assert.equal(plugin.name, 'valor-ai');
  assert.match(server.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  assert.equal(plugin.version, server.version, 'Published versions must agree');
  assert.deepEqual(server.repository, { url: 'https://github.com/jchacker5/valor-mcp', source: 'github' });
  assert.equal(plugin.repository, server.repository.url);
  assert.equal(plugin.homepage, server.websiteUrl);
  assert.equal(plugin.mcpServers, 'mcp.json');
  assert.equal(typeof plugin.logo, 'string');
  const logo = resolve(root, plugin.logo);
  const logoRelative = relative(root, logo);
  assert(!isAbsolute(logoRelative) && logoRelative !== '..' && !logoRelative.startsWith('../'), 'Logo must be inside this repository');
  assert(statSync(logo).isFile(), 'The plugin logo must exist');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert(readme.includes(ENDPOINT), 'README must document the configured endpoint');
  for (const name of TOOLS) assert(readme.includes(name), `README must document ${name}`);
  return { endpoint: ENDPOINT, version: server.version, tools: TOOLS };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(checkManifests(), null, 2));
  } catch (error) {
    console.error(`Manifest validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
