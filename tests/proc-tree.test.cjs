const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { descendants, killLeftovers } = require('../proc-tree.cjs');

test('finds only descendants started during the run (PID reuse guard)', () => {
  const list = [{ pid: 10, ppid: 1, created: 1000 }, { pid: 11, ppid: 10, created: 2000 }, { pid: 12, ppid: 11, created: 2100 }, { pid: 13, ppid: 10, created: 10 }, { pid: 14, ppid: 99, created: 2000 }];
  assert.deepEqual(descendants(list, 10, 1500), [11, 12]);
});

test('a dev server left behind after the CLI exits is killed and frees its port', { skip: process.platform !== 'win32' }, async () => {
  // Giống lệnh Bash `server & PID=$!; …; kill $PID`: tiến trình cha thoát, server cháu sống tiếp giữ cổng.
  const server = 'require("http").createServer((q,r)=>r.end("ok")).listen(0,function(){process.stdout.write(String(this.address().port))})';
  const parent = `const c=require("child_process").spawn(process.execPath,["-e",${JSON.stringify(server)}],{stdio:["ignore","pipe","ignore"],detached:true});c.unref();c.stdout.once("data",d=>{console.log(String(d));process.exit(0)})`;
  const since = Date.now(); const cli = spawn(process.execPath, ['-e', parent], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let out = ''; cli.stdout.on('data', chunk => { out += chunk; });
  await new Promise(resolve => cli.once('exit', resolve));
  const port = Number(out.trim()); assert.ok(port > 0);
  const up = () => new Promise(resolve => http.get('http://127.0.0.1:' + port, res => { res.resume(); resolve(true); }).on('error', () => resolve(false)));
  assert.equal(await up(), true, 'orphan still serving after the parent exited');
  const killed = await killLeftovers(cli.pid, since);
  assert.equal(killed.length, 1);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(await up(), false, 'port is free');
});
