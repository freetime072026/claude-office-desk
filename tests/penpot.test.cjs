const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const penpot = require('../penpot.cjs');
const { buildPrompt } = require('../prompt.cjs');
const { filesOf } = require('../session-files.cjs');
const configFile = content => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')), 'mcp-servers.json'); fs.writeFileSync(file, JSON.stringify(content)); return file; };

test('install adds the local Penpot server once and enables it for the design roles only', () => {
  const file = configFile({ mcpServers: { other: { command: 'x' } } }), team = { roleMcp: { Art: ['other'] } };
  assert.match(penpot.install(file, team), /Đã thêm "penpot"[\s\S]*npx -y @penpot\/mcp@stable[\s\S]*manifest\.json/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers, { other: { command: 'x' }, penpot: { type: 'http', url: 'http://localhost:4401/mcp' } });
  assert.deepEqual(team.roleMcp, { Art: ['other', 'penpot'], 'UI/UX': ['penpot'], 'Art Director': ['penpot'] });
  assert.match(penpot.install(file, team), /đã có "penpot"/); assert.deepEqual(team.roleMcp.Art, ['other', 'penpot']);
});
test('an existing server whose name mentions Penpot is reused, not duplicated', () => {
  const file = configFile({ mcpServers: { 'my-penpot': { type: 'http', url: 'https://example/mcp/stream' } } }), team = {};
  penpot.install(file, team);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers), ['my-penpot']); assert.deepEqual(team.roleMcp['UI/UX'], ['my-penpot']);
  assert.equal(penpot.usesPenpot(['figma', 'my-penpot']), true); assert.equal(penpot.usesPenpot(['figma']), false);
});
test('the Penpot guide reaches only blocks that have Penpot, with role-specific work', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const uiux = buildPrompt({ label: 'UI/UX', type: 'UI/UX', files, penpot: true, content: 'x' }).text;
  assert.match(uiux, /penpot_api_info trước khi viết execute_code/); assert.match(uiux, /board cùng tên trong Penpot/);
  assert.match(buildPrompt({ label: 'Art', type: 'Art', files, penpot: true, content: 'x' }).text, /import_image đặt vào board ART-/);
  assert.doesNotMatch(buildPrompt({ label: 'UI/UX', type: 'UI/UX', files, content: 'x' }).text, /Penpot/);
});
