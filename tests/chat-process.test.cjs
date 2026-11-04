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
