const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { scripts, urlOf, commandOf, validPort, createDevServers } = require('../devserver.cjs');

const project = pkgScripts => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devserver-')); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', scripts: pkgScripts })); return dir; };

test('lists only dev-like package.json scripts, dev first', () => {
  const dir = project({ build: 'webpack', start: 'serve', dev: 'playable-scripts dev', verify: 'node v.js', preview: 'vite preview' });
  assert.deepEqual(scripts(dir).map(item => item.name), ['dev', 'start', 'preview']);
  assert.deepEqual(scripts(path.join(dir, 'missing')), []);
});

test('finds the localhost address the server prints (colours stripped, 0.0.0.0 -> localhost), else the chosen port', () => {
  assert.equal(urlOf('\x1b[32m<i> Loopback: \x1b[1mhttp://localhost:3000/\x1b[0m, http://[::1]:3000/', 0), 'http://localhost:3000/');
  assert.equal(urlOf('Listening on http://0.0.0.0:5173.', 0), 'http://localhost:5173');
  assert.equal(urlOf('compiled successfully', 3311), 'http://localhost:3311/');
  assert.equal(urlOf('compiled successfully', 0), '');
  assert.deepEqual(commandOf('dev', 3311).args, ['run', 'dev', '--', '--port', '3311']);
  assert.deepEqual(commandOf('dev', 0).args, ['run', 'dev']);
  assert.equal(validPort('3000'), true); assert.equal(validPort(''), true); assert.equal(validPort(80), false); assert.equal(validPort('abc'), false);
});

test('starts the chosen script, picks up its address, serves it, and stops the whole process tree', async () => {
  const server = 'const h=require("http");const p=Number(process.env.PORT)||0;const s=h.createServer((q,r)=>r.end("ok")).listen(p,()=>console.log("ready at http://localhost:"+s.address().port+"/"))';
  const dir = project({ dev: 'node server.js' }); fs.writeFileSync(path.join(dir, 'server.js'), server);
  let changes = 0; const servers = createDevServers({ changed: () => changes++ });
  assert.throws(() => servers.start('t1', dir, 'build', ''), /không có script/);
  assert.throws(() => servers.start('t1', dir, 'dev', '80'), /Cổng/);
  servers.start('t1', dir, 'dev', '');
  assert.throws(() => servers.start('t1', dir, 'dev', ''), /đang chạy/);
  for (let i = 0; i < 100 && !servers.state('t1').url; i++) await new Promise(resolve => setTimeout(resolve, 100));
  const { url, running, script } = servers.state('t1');
  assert.equal(running, true); assert.equal(script, 'dev'); assert.match(url, /^http:\/\/localhost:\d+\/$/);
  const body = await new Promise((resolve, reject) => http.get(url, res => { let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve(text)); }).on('error', reject));
  assert.equal(body, 'ok');
  assert.equal(servers.stop('t1'), true);
  for (let i = 0; i < 100 && servers.state('t1').running; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(servers.state('t1').running, false);
  await new Promise(resolve => setTimeout(resolve, 500));
  const stillUp = await new Promise(resolve => http.get(url, () => resolve(true)).on('error', () => resolve(false)));
  assert.equal(stillUp, false, 'server child is gone with the npm process');
  assert.ok(changes > 0);
});

test('finds the project in any session folder (main folder may be an asset folder without package.json)', () => {
  const { projects } = require('../devserver.cjs');
  const game = project({ dev: 'playable-scripts dev', build: 'x' }), input = fs.mkdtempSync(path.join(os.tmpdir(), 'devserver-input-'));
  const found = projects([input, game, game, '']);
  assert.equal(found.length, 1); assert.equal(found[0].folder, game); assert.deepEqual(found[0].scripts.map(item => item.name), ['dev']);
  assert.deepEqual(scripts(''), [], 'no folder: never falls back to the app folder');
});
