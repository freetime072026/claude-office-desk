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
test('Penpot lock: one run at a time in arrival order, the same run re-enters, a whole-turn holder does not cut the queue', async () => {
  const lock = penpot.createLock(), order = [];
  await lock.acquire('art1', 'call-a', 'Art'); await lock.acquire('art1', 'call-b', 'Art'); // cùng lượt gọi song song: không tự khoá chết
  const second = lock.acquire('art2', 'call-c', 'Art #2').then(() => order.push('art2'));
  const third = lock.acquire('art3', 'call-d', 'Art #3').then(() => order.push('art3'));
  assert.deepEqual(lock.holder(), { run: 'art1', label: 'Art' }); assert.equal(lock.waiting(), 2);
  assert.equal(lock.tryAcquire('chat', 'Claude'), false);
  lock.release('art1', 'call-a'); await Promise.resolve(); assert.deepEqual(order, [], 'still held by the other call of the same run');
  lock.release('art1', 'call-b'); await second; assert.deepEqual(order, ['art2']); assert.equal(lock.holder().label, 'Art #2');
  lock.release('art2', 'call-c'); await third; lock.release('art3', 'call-d');
  assert.equal(lock.holder(), null); assert.equal(lock.tryAcquire('chat', 'Claude'), true); lock.releaseRun('chat'); assert.equal(lock.holder(), null);
});
test('Penpot lock: a run that ends gives the lock back and drops its waiting calls', async () => {
  const lock = penpot.createLock();
  await lock.acquire('art1', 'a', 'Art');
  const dropped = lock.acquire('art2', 'b', 'Art #2'), next = lock.acquire('art3', 'c', 'Art #3');
  lock.releaseRun('art2', 'gone'); await assert.rejects(dropped, /gone/);
  lock.releaseRun('art1'); await next; assert.equal(lock.holder().run, 'art3');
});
test('only CLI modes that ask the host get per-call locking; Auto and Bypass hold Penpot for the whole turn', () => {
  assert.equal(penpot.perCall('default'), true); assert.equal(penpot.perCall('plan'), true);
  assert.equal(penpot.perCall('auto'), false); assert.equal(penpot.perCall('bypassPermissions'), false);
});
