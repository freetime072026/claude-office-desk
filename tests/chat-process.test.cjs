const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, CLI_FAILED_TEXT } = require('../chat.cjs');
const skip = process.platform !== 'win32';
async function run(prompt, askPermission, mode = 'read') {
  const thread = { folder: __dirname, messages: [], mode, model: 'sonnet' };
  const started = launch({ executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', thread, profileId: 'test-profile', prompt, save: () => {}, publish: () => {}, askPermission });
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  return thread;
}
test('PowerShell bridge streams Unicode prompt and saves resume id without terminal UI', { skip, timeout: 20000 }, async () => {
  const thread = await run('Xin chào "Unity" & $example');
  assert.equal(thread.messages[0].text, 'Echo: Xin chào "Unity" & $example');
  assert.equal(thread.messages[0].streaming, false);
  assert.equal(Object.values(thread.cliSessions)[0], 'mock-native-session');
  assert.deepEqual(thread.messages[0].usage, { input: 1200, output: 345, cacheRead: 5000, cacheWrite: 800, costUsd: 0.0421, turns: 3 });
});
test('CLIXML-only stderr is dropped and the standard error text is shown', { skip, timeout: 20000 }, async () => {
  const message = (await run('[clixml]')).messages[0];
  assert.equal(message.error, true);
  assert.equal(message.text.trim(), CLI_FAILED_TEXT);
  assert.doesNotMatch(message.text, /CLIXML|<Objs/);
});
test('real stderr lines survive CLIXML filtering', { skip, timeout: 20000 }, async () => {
  const message = (await run('[clixml+error]')).messages[0];
  assert.equal(message.error, true);
  assert.equal(message.text.trim(), 'Login required');
});
test('a tool permission request reaches the host and an allow keeps the original input', { skip, timeout: 20000 }, async () => {
  const asked = [];
  const message = (await run('[ask:Bash]', async request => { asked.push(request); return { allow: true }; }, 'edit')).messages[0];
  assert.deepEqual(asked, [{ tool: 'Bash', input: { command: 'echo hi' }, toolUseId: 'tool-1' }]);
  assert.equal(message.text, 'Bash allow {"command":"echo hi"}'); assert.equal(message.denied, undefined); assert.equal(message.progress.waiting, undefined);
});
test('a denied tool is reported to the CLI with a reason and recorded on the message', { skip, timeout: 20000 }, async () => {
  const message = (await run('[ask:WebFetch]', async () => ({ allow: false, message: 'no web' }))).messages[0];
  assert.equal(message.text, 'WebFetch deny: no web'); assert.deepEqual(message.denied, ['WebFetch']);
});
test('without a permission handler every request is denied', { skip, timeout: 20000 }, async () => {
  const message = (await run('[ask:Edit]')).messages[0];
  assert.match(message.text, /^Edit deny: /); assert.deepEqual(message.denied, ['Edit']);
});
test('the CLI is started in two-way stream-json mode with host permission prompts', { skip, timeout: 20000 }, async () => {
  const args = JSON.parse((await run('[args]', undefined, 'edit')).messages[0].text);
  for (const [flag, value] of [['--input-format', 'stream-json'], ['--output-format', 'stream-json'], ['--permission-prompt-tool', 'stdio'], ['--permission-mode', 'default']]) assert.equal(args[args.indexOf(flag) + 1], value, flag);
  assert.match(args[args.indexOf('--tools') + 1], /WebFetch/);
});
test('the "choose another mode" hint appears only for denials the user did not make', () => {
  const { consume } = require('../chat.cjs');
  const own = { text: 'ok', denied: ['Write'] }; consume(own, { type: 'result', permission_denials: [{ tool_name: 'Write' }] });
  assert.equal(own.text, 'ok');
  const blocked = { text: 'ok', denied: ['Write'] }; consume(blocked, { type: 'result', permission_denials: [{ tool_name: 'Write' }, { tool_name: 'Bash' }] });
  assert.match(blocked.text, /Chọn mode phù hợp/);
});
test('sessions are never dropped: the CLI runs with --autocompact, and compaction is shown on the message', { skip, timeout: 20000 }, async () => {
  const args = JSON.parse((await run('[args]', undefined, 'edit')).messages[0].text);
  assert.equal(args[args.indexOf('--autocompact') + 1], '200k');
  const { consume } = require('../chat.cjs');
  const message = { text: '' };
  consume(message, { type: 'system', subtype: 'status', status: 'compacting' }); assert.equal(message.progress.target, 'đang compact ngữ cảnh');
  consume(message, { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 120000, post_tokens: 18000 } });
  assert.deepEqual(message.compactions, [{ trigger: 'auto', before: 120000, after: 18000 }]);
});
test('role brief goes to the CLI as --append-system-prompt-file and the temp file is removed after the run', { skip, timeout: 20000 }, async () => {
  const fs = require('node:fs');
  const thread = { folder: __dirname, messages: [], mode: 'read', model: 'sonnet' };
  const started = launch({ brief: 'Vai trò Dev.\nTask "A" & $x', executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', thread, profileId: 'test-profile', prompt: '[args]', save: () => {}, publish: () => {} });
  const file = path.join(__dirname, 'briefs', started.message.id + '.md');
  assert.equal(fs.readFileSync(file, 'utf8'), 'Vai trò Dev.\nTask "A" & $x');
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  const args = JSON.parse(thread.messages[0].text);
  assert.equal(args[args.indexOf('--append-system-prompt-file') + 1], file);
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(fs.existsSync(file), false);
  fs.rmSync(path.join(__dirname, 'briefs'), { recursive: true, force: true });
});
test('US-08: a role run gets its own --mcp-config with only its servers, removed after the run', { skip, timeout: 20000 }, async () => {
  const fs = require('node:fs');
  const thread = { folder: __dirname, messages: [], mode: 'read', model: 'sonnet' };
  const mcpConfig = { mcpServers: { 'image-gen': { command: 'gen', args: [] } } };
  const started = launch({ mcpConfig, executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'all.json', thread, profileId: 'test-profile', prompt: '[args]', save: () => {}, publish: () => {} });
  const file = path.join(__dirname, 'mcp', started.message.id + '.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), mcpConfig);
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  const args = JSON.parse(thread.messages[0].text);
  assert.equal(args[args.indexOf('--mcp-config') + 1], file); assert(!args.includes('all.json'));
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(fs.existsSync(file), false);
  fs.rmSync(path.join(__dirname, 'mcp'), { recursive: true, force: true });
});

test('progress keeps the running tool until its result arrives, so a long Bash is not reported as stalled', () => {
  const { consume } = require('../chat.cjs');
  const message = { text: '', time: new Date().toISOString() };
  consume(message, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm run qa -- --runs 10' } }] } });
  assert.equal(message.progress.runningId, 't1'); assert(message.progress.runningSince);
  consume(message, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'other', content: 'x' }] } });
  assert.equal(message.progress.runningId, 't1');
  consume(message, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'PASS' }] } });
  assert.equal(message.progress.runningId, undefined); assert.equal(message.progress.runningSince, undefined);
});
test('a background process that inherits the CLI pipes (e.g. `node serve.js &`) no longer keeps the turn "running" after the CLI exits', { timeout: 20000 }, async () => {
  const { spawn } = require('node:child_process'), { closeAfterExit } = require('../chat.cjs');
  // Tiến trình con in pid của tiến trình nền rồi thoát; tiến trình nền giữ stdout/stderr kế thừa trong 60 s.
  const script = "const c = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'inherit', detached: true }); console.log(c.pid); c.unref();";
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; child.stdout.setEncoding('utf8').on('data', chunk => { out += chunk; });
  closeAfterExit(child, 300);
  const started = Date.now();
  await new Promise(resolve => child.once('close', resolve));
  try { assert(Date.now() - started < 10000, 'close fired soon after exit'); assert.match(out, /^\d+/); }
  finally { const pid = Number.parseInt(out, 10); if (pid) try { process.kill(pid); } catch {} }
});
test('a CLI that does not exit after its result (leftover background task) is killed and the turn still counts as done', { skip, timeout: 20000 }, async () => {
  const thread = { folder: __dirname, messages: [], mode: 'read', model: 'sonnet' };
  const started = launch({ executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', thread, profileId: 'test-profile', prompt: 'xong [linger]', save: () => {}, publish: () => {}, resultExitMs: 500 });
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  const message = thread.messages[0];
  assert.equal(message.text, 'Echo: xong [linger]');
  assert.equal(message.killedAfterResult, true);
  assert.notEqual(message.error, true);
  assert.equal(message.streaming, false);
});
test('the CLI gets long Bash timeouts so 2–5 minute checks are not moved to the background', { skip, timeout: 20000 }, async () => {
  const thread = { folder: __dirname, messages: [], mode: 'read', model: 'sonnet' };
  const started = launch({ executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', thread, profileId: 'test-profile', prompt: '[env]', save: () => {}, publish: () => {} });
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  assert.deepEqual(JSON.parse(thread.messages[0].text), { BASH_DEFAULT_TIMEOUT_MS: '600000', BASH_MAX_TIMEOUT_MS: '1800000' });
});
test('Penpot tools leave --allowedTools, wait for the shared lock without a dialog, and free it at their tool_result', { skip, timeout: 20000 }, async () => {
  const { createLock } = require('../penpot.cjs');
  const lock = createLock(), seen = [], asked = [];
  const spy = { ...lock, release: (run, key) => { seen.push(['release', key, thread.messages[0].text]); lock.release(run, key); } };
  await lock.acquire('other-run', 'x', 'Art #2');
  const thread = { folder: __dirname, messages: [], mode: 'edit', model: 'sonnet' };
  const started = launch({ executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', mcpServers: ['penpot', 'image-gen'], thread, profileId: 'test-profile', prompt: '[ask:mcp__penpot__export_shape]', save: () => {}, publish: () => {}, askPermission: async request => { asked.push(request.tool); return { allow: true }; }, toolLock: spy, lockedServers: ['penpot'] });
  const message = started.message;
  for (let tries = 0; !message.progress.lockWait && tries < 200; tries++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(message.progress.lockWait, 'Art #2', 'shows who holds Penpot while waiting'); assert.equal(message.progress.waiting, undefined);
  lock.release('other-run', 'x');
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  assert.deepEqual(asked, [], 'a pre-allowed Penpot tool needs no dialog');
  assert.match(message.text, /^mcp__penpot__export_shape allow/); assert.equal(message.progress.lockWait, undefined);
  assert.deepEqual(seen, [['release', 'tool-1', '']], 'the call key goes at tool_result, before the answer streamed');
  assert.equal(lock.holder(), null, 'the chain lease ends with the result');
  const args = JSON.parse((await run('[args]', undefined, 'edit')).messages[0].text);
  assert.doesNotMatch(args[args.indexOf('--allowedTools') + 1], /penpot/);
});

// Chuỗi gọi Penpot: khoá giữ sau tool_result để khối khác không đổi page giữa hai lần gọi; hết khi gọi tool khác hoặc quá hạn.
async function leaseRun(prompt, lockLeaseMs) {
  const { createLock } = require('../penpot.cjs');
  const lock = createLock(), log = [], thread = { folder: __dirname, messages: [], mode: 'edit', model: 'sonnet' };
  const spy = { ...lock, release: (run, key) => { lock.release(run, key); log.push([key, thread.messages[0].text, lock.holder()?.run === run]); } };
  const started = launch({ executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', mcpServers: ['penpot'], thread, profileId: 'test-profile', prompt, save: () => {}, publish: () => {}, askPermission: async () => ({ allow: true }), toolLock: spy, lockedServers: ['penpot'], lockLeaseMs });
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  return { log, lock };
}
test('a Penpot chain keeps the lock after tool_result and ends when the run starts another tool', { skip, timeout: 20000 }, async () => {
  const { log, lock } = await leaseRun('[ask:mcp__penpot__import_image] [then:Bash] [pause]', 60000);
  assert.deepEqual(log, [['tool-1', '', true], ['~chuoi', '', false]], 'still held after the call, freed when Bash starts, before the answer');
  assert.equal(lock.holder(), null);
});
test('a Penpot chain lease runs out when the run stops calling Penpot for a while', { skip, timeout: 20000 }, async () => {
  const { log } = await leaseRun('[ask:mcp__penpot__export_shape] [pause]', 50);
  assert.deepEqual(log, [['tool-1', '', true], ['~chuoi', '', false]]);
});
test('the Penpot guide tells blocks not to trust the open page of the shared tab', () => {
  const { guide } = require('../penpot.cjs');
  assert.match(guide('Art'), /penpot\.currentPage/); assert.match(guide('Art'), /openPage/); assert.match(guide('Art'), /không dùng "page"\/"selection"/);
});
