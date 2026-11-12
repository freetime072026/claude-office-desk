const { test } = require('node:test'); const assert = require('node:assert/strict');
const settings = require('../settings.cjs');

test('Connectors list MCP servers from mcp-servers.json: type, short detail, enabled roles; env and headers never leave main', () => {
  const data = { mcpServers: {
    zeta: { command: 'npx', args: ['-y', '@acme/mcp'], env: { TOKEN: 'secret' } },
    penpot: { type: 'http', url: 'http://localhost:4401/mcp', headers: { Authorization: 'Bearer x' } },
    alpha: { type: 'sse', url: 'https://mcp.example.com/sse' },
  } };
  const list = settings.mcpEntries(data, { 'UI/UX': ['penpot'], Art: ['penpot', 'zeta'], Dev: [] });
  assert.deepEqual(list.map(item => item.name), ['alpha', 'penpot', 'zeta']);
  assert.deepEqual(list[0], { name: 'alpha', type: 'sse', detail: 'mcp.example.com', roles: [], penpot: false });
  assert.deepEqual(list[1], { name: 'penpot', type: 'http', detail: 'localhost:4401', roles: ['UI/UX', 'Art'], penpot: true });
  assert.deepEqual(list[2], { name: 'zeta', type: 'stdio', detail: 'npx -y @acme/mcp', roles: ['Art'], penpot: false });
  assert.doesNotMatch(JSON.stringify(list), /secret|Bearer/);
  assert.deepEqual(settings.mcpEntries(null), []); assert.deepEqual(settings.mcpEntries({ mcpServers: [] }), []);
});

test('Discover offers the Penpot connector and the official Anthropic skills repo', () => {
  assert.deepEqual(settings.DISCOVER_CONNECTORS.map(item => item.id), ['penpot']);
  assert.equal(settings.DISCOVER_SKILLS[0].url, 'https://github.com/anthropics/skills');
});
