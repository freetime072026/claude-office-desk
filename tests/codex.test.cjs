const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test'); const assert = require('node:assert/strict');
const codex = require('../codex.cjs');
const { roleScope, decide, outsidePaths } = require('../permissions.cjs');
const { filesOf } = require('../session-files.cjs');

test('Codex images live in CODEX_HOME/generated_images, default ~/.codex', () => {
  assert.equal(codex.imagesDir({}), path.join(os.homedir(), '.codex', 'generated_images'));
  assert.equal(codex.imagesDir({ CODEX_HOME: 'E:\\cx' }), path.join('E:\\cx', 'generated_images'));
});
test('status: not installed, installed but logged out, logged in with ChatGPT', async () => {
  const fake = replies => ({ exec: (command, options, done) => { const reply = replies[command]; done(reply.ok ? null : Object.assign(Error('fail'), { code: 1 }), reply.out || '', reply.err || ''); } });
  assert.deepEqual(await codex.status(fake({ 'codex --version': { ok: false, err: "'codex' is not recognized" } })), { installed: false, loggedIn: false, version: '', text: 'Chưa cài Codex CLI' });
  assert.deepEqual(await codex.status(fake({ 'codex --version': { ok: true, out: 'codex-cli 0.167.2\n' }, 'codex login status': { ok: false, err: 'Not logged in\n' } })), { installed: true, loggedIn: false, version: 'codex-cli 0.167.2', text: 'Not logged in' });
  assert.deepEqual(await codex.status(fake({ 'codex --version': { ok: true, out: 'codex-cli 0.167.2' }, 'codex login status': { ok: true, err: 'Logged in using ChatGPT\n' } })), { installed: true, loggedIn: true, version: 'codex-cli 0.167.2', text: 'Logged in using ChatGPT' });
});
test('login button opens a visible console: install first when Codex is missing, then codex login', () => {
  const calls = []; const spawn = (...args) => { calls.push(args); return { on() {}, unref() {} }; };
  assert.equal(codex.openLogin({ installed: true, spawn, platform: 'win32' }), 'codex login');
  assert.equal(calls[0][0], 'start "Codex login" cmd /k "codex login"'); assert.equal(calls[0][1].shell, true); assert.equal(calls[0][1].detached, true);
  assert.equal(codex.openLogin({ installed: false, spawn, platform: 'win32' }), 'npm i -g @openai/codex && codex login');
  assert.match(calls[1][0], /cmd \/k "npm i -g @openai\/codex && codex login"/);
});
test('Art always reads Codex generated_images (Read/Glob without asking, shell not blocked); other roles and other home folders stay blocked', () => {
  const folder = path.resolve('E:/game'), files = filesOf({ id: 's', folder }), images = codex.imagesDir(), folders = [folder];
  const art = roleScope('Art', files, ['ArtGen/'], folder), dev = roleScope('Dev', files, ['src/'], folder);
  assert(art.readable.includes(images)); assert.equal(dev.readable, undefined);
  const image = path.join(images, 'sess', 'exec-1.png');
  for (const mode of ['edit', 'bypass']) {
    assert.equal(decide({ scope: art, mode, tool: 'Read', input: { file_path: image }, cwd: folder, folders }).action, 'allow', mode);
    assert.equal(decide({ scope: art, mode, tool: 'Glob', input: { pattern: '**/*.png', path: images }, cwd: folder, folders }).action, 'allow', mode);
  }
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Read', input: { file_path: image }, cwd: folder, folders }).action, 'deny');
  assert.equal(decide({ scope: art, mode: 'bypass', tool: 'Read', input: { file_path: path.join(os.homedir(), '.codex', 'auth.json') }, cwd: folder, folders }).action, 'deny');
  assert.equal(decide({ scope: art, mode: 'bypass', tool: 'Write', input: { file_path: image }, cwd: folder, folders }).action, 'deny');
  const bash = command => decide({ scope: art, mode: 'bypass', tool: 'Bash', input: { command }, cwd: folder, folders }).action;
  assert.equal(bash("find ~/.codex/generated_images -name '*.png' -newer .office-desk/tmp/ART-1.txt"), 'allow');
  assert.equal(bash('cp "$HOME/.codex/generated_images/sess/exec-1.png" .office-desk/s/inbox/ART-1.png'), 'allow');
  assert.equal(bash(`ls -l "${images.split(path.sep).join('/')}/sess"`), 'allow');
  assert.equal(bash(`cp "${image}" .office-desk/s/inbox/ART-1.png`), 'allow'); // đường dẫn Windows Codex in ra (C:\…)
  assert.equal(bash('cat ~/.codex/auth.json'), 'deny'); assert.equal(bash('cat ~/.ssh/id_rsa'), 'deny'); assert.equal(bash('cat $HOME/.ssh/config'), 'deny');
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: { command: 'ls ~/.codex/generated_images' }, cwd: folder, folders }).action, 'deny');
  // Đường dẫn nhà ngoài phạm vi vẫn bị báo, kèm đường dẫn thật thay vì "~/".
  assert.deepEqual(outsidePaths('cat ~/.ssh/id_rsa', folders), [os.homedir().split(path.sep).join('/') + '/.ssh/id_rsa']);
});

test('quotaRetryAt reads when Codex has quota again: "in" spans, "at" clock and date, a hinted ISO, else one hour', () => {
  const now = new Date(2026, 10, 13, 10, 0, 0), margin = 2 * 60 * 1000, hour = 3600000;
  const at = (text, hinted = '') => codex.quotaRetryAt(text, { now, hinted });
  assert.equal(at('■ You\'ve hit your usage limit. Upgrade to Pro or try again in 2 days 3 hours 4 minutes.').getTime(), now.getTime() + (2 * 24 * 60 + 3 * 60 + 4) * 60000 + margin);
  assert.equal(at('You\'ve hit your usage limit. Try again in 45 minutes.').getTime(), now.getTime() + 45 * 60000 + margin);
  assert.equal(at('You\'ve hit your usage limit. Try again at 3:42 PM.').getTime(), new Date(2026, 10, 13, 15, 42).getTime() + margin);
  assert.equal(at('You\'ve hit your usage limit. Try again at 9:15 AM.').getTime(), new Date(2026, 10, 14, 9, 15).getTime() + margin, 'a clock time already past means tomorrow');
  assert.equal(at('You\'ve hit your usage limit. Upgrade to Plus or try again at Nov 14th, 2026 2:30 PM.').getTime(), new Date(2026, 10, 14, 14, 30).getTime() + margin);
  assert.equal(at('Codex hết hạn mức', new Date(2026, 10, 13, 12, 0).toISOString()).getTime(), new Date(2026, 10, 13, 12, 0).getTime() + margin, 'retryAt from the handoff');
  assert.equal(at('You\'ve hit your usage limit.').getTime(), now.getTime() + hour, 'no time given: one hour');
  assert.equal(at('Codex hết hạn mức', '2020-01-01T00:00:00Z').getTime(), now.getTime() + hour, 'a time in the past is ignored');
  assert.equal(at('image tool not available'), null, 'not a quota error');
});

test('a blocked Codex quota handoff keeps quota and retryAt; other handoffs do not', () => {
  const { parseHandoff } = require('../pipeline.cjs');
  const fence = value => '```handoff\n' + JSON.stringify(value) + '\n```';
  assert.deepEqual(parseHandoff(fence({ status: 'blocked', quota: 'codex', retryAt: '2026-11-13T15:42:00+07:00', summary: 'Codex hết hạn mức: try again at 3:42 PM' })), { status: 'blocked', summary: 'Codex hết hạn mức: try again at 3:42 PM', retested: [], quota: 'codex', retryAt: '2026-11-13T15:42:00+07:00' });
  assert.equal(parseHandoff(fence({ status: 'done', quota: 'codex', summary: 'x' })).quota, undefined);
});
