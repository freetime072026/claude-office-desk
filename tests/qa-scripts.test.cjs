const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { roleScope, decide } = require('../permissions.cjs');
const { filesOf, qaDir } = require('../session-files.cjs');
const { buildPrompt } = require('../prompt.cjs');

const files = filesOf({ id: 's1', folder: 'E:\\game' });

test('QA may keep test scripts in .office-desk/qa/ (shared by the project) but still not edit code', () => {
  const scope = roleScope('QA', files);
  const dir = qaDir(files);
  assert.equal(dir, path.join('E:\\game', '.office-desk', 'qa') + path.sep);
  assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: path.join(dir, 'probe.cjs') }, cwd: 'E:\\game' }).action, 'allow');
  assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: path.join(dir, 'sub', 'shots.cjs') }, cwd: 'E:\\game' }).action, 'allow');
  assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: files.issues }, cwd: 'E:\\game' }).action, 'allow');
  for (const bad of ['E:\\game\\src\\Game.ts', 'C:\\Temp\\qa.cjs', 'E:\\game\\.office-desk\\qa-other\\x.cjs']) {
    assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: bad }, cwd: 'E:\\game' }).action, 'deny', bad);
  }
});

test('QA cannot start background shell commands; foreground commands still run', () => {
  const scope = roleScope('QA', files);
  const bg = decide({ scope, mode: 'bypass', tool: 'Bash', input: { command: 'node scripts/build.cjs dev --port 3311', run_in_background: true } });
  assert.equal(bg.action, 'deny'); assert.match(bg.message, /cùng một lệnh Bash/);
  assert.equal(decide({ scope, mode: 'bypass', tool: 'Bash', input: { command: 'npx tsc --noEmit' } }).action, 'allow');
  const dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game');
  // Every shell block: a background dev server left running kept the CLI from exiting (Dev #2 hang).
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: { command: 'npm run dev', run_in_background: true } }).action, 'deny');
  assert.equal(decide({ scope: roleScope('Lead Dev', files), mode: 'bypass', tool: 'Bash', input: { command: 'npm run build', run_in_background: true } }).action, 'deny');
  assert.equal(decide({ scope: null, mode: 'bypass', tool: 'Bash', input: { command: 'npm run dev', run_in_background: true } }).action, 'allow');
});

test('shell blocks write helper scripts in .office-desk/tmp/ of the project, not the system temp folder', () => {
  const { exclusivePaths, scopesOverlap } = require('../permissions.cjs');
  const { tmpDir } = require('../session-files.cjs');
  const helper = path.join(tmpDir(files), 'gen', 'make.py'), system = path.join(require('node:os').tmpdir(), 'make.py');
  const dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game'), art = roleScope('Art', files, ['assets/ui/'], 'E:\\game');
  for (const scope of [dev, art, roleScope('QA', files)]) {
    assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: helper }, cwd: 'E:\\game' }).action, 'allow');
    assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: system }, cwd: 'E:\\game' }).action, 'deny');
  }
  assert.equal(decide({ scope: dev, mode: 'edit', tool: 'Write', input: { file_path: 'E:\\game\\src\\b.ts' }, cwd: 'E:\\game' }).action, 'deny');
  assert.equal(scopesOverlap(exclusivePaths(dev), exclusivePaths(art)), false);
  assert.equal(decide({ scope: roleScope('GD', files), mode: 'edit', tool: 'Write', input: { file_path: helper }, cwd: 'E:\\game' }).action, 'deny');
});

test('/tmp: QA always refused; other shell blocks refused when node/python reads it', () => {
  const qa = roleScope('QA', files), dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game');
  for (const command of ['node a.cjs > /tmp/acA.json', 'cat /tmp/x.log', 'node -e "require(\'/tmp/acA.json\')"', 'OUT=/tmp node a.cjs']) {
    const verdict = decide({ scope: qa, mode: 'bypass', tool: 'Bash', input: { command } });
    assert.equal(verdict.action, 'deny', command); assert.match(verdict.message, /\.office-desk\/qa\/out\//);
  }
  for (const command of ['node .office-desk/qa/m1_ac.cjs > .office-desk/qa/out/ac.json', 'ls src/tmpl/x', 'echo /tmpfile']) {
    assert.equal(decide({ scope: qa, mode: 'bypass', tool: 'Bash', input: { command } }).action, 'allow', command);
  }
  for (const command of ["python - <<'E'\np='/tmp/gen/g.py'\nE", 'node /tmp/run.cjs', 'cd x; python3 /tmp/a.py']) {
    const verdict = decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: { command } });
    assert.equal(verdict.action, 'deny', command); assert.match(verdict.message, /\.office-desk\/tmp\//);
  }
});

test('blocks only read, search and write inside the session folders; program folders still run tools', () => {
  const folders = ['E:\\game', 'E:\\art-source'], cwd = 'E:\\game';
  const dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game'), qa = roleScope('QA', files);
  const run = (scope, tool, input) => decide({ scope, mode: 'bypass', tool, input, cwd, folders });
  // Read / Grep / Glob outside -> refused with a request to add the folder.
  const read = run(dev, 'Read', { file_path: 'D:\\Other\\README.md' });
  assert.equal(read.action, 'deny'); assert.match(read.message, /thêm thư mục đó vào session/);
  assert.equal(run(dev, 'Grep', { pattern: 'x', path: 'C:\\Users\\me' }).action, 'deny');
  assert.equal(run(dev, 'Glob', { pattern: '**/*.ts', path: 'E:\\art-source\\x' }).action !== 'deny', true);
  // Writes outside are refused even for a block without its own write scope (custom role, scope null).
  assert.equal(run(null, 'Write', { file_path: 'D:\\x\\a.md' }).action, 'deny');
  assert.equal(run(null, 'Write', { file_path: 'E:\\game\\a.md' }).action, 'allow');
  // Shell: absolute paths, home and temp outside the folders are refused; program folders and session folders pass.
  for (const command of ['cat C:/Users/me/notes.md', 'ls /d/Other', 'grep -rn x E:/FreeTimes/BaseTD', 'cat ~/x', 'echo $TEMP', 'cp a %TEMP%\\b']) {
    assert.equal(run(qa, 'Bash', { command }).action, 'deny', command);
  }
  for (const command of ['cat E:/game/src/a.ts', 'cd /e/game && npm run dev', '"C:/Program Files/CocCoc/Browser/Application/browser.exe" --headless', 'ls E:/art-source/sprites', 'curl http://localhost:3311/', 'ls > /dev/null']) {
    assert.notEqual(run(qa, 'Bash', { command }).action, 'deny', command);
  }
});

test('helper scripts may go in .office-desk/tmp/ of any session folder, also a related folder that is not the main one', () => {
  const folders = ['E:\\game\\assets\\stage', 'E:\\game'], cwd = 'E:\\game\\assets\\stage';
  const dev = roleScope('Dev', filesOf({ id: 's1', folder: folders[0] }), ['src/a.ts'], folders[0]);
  const run = file => decide({ scope: dev, mode: 'bypass', tool: 'Write', input: { file_path: file }, cwd, folders });
  assert.equal(run('E:\\game\\.office-desk\\tmp\\splice.py').action, 'allow');
  assert.equal(run('E:\\game\\assets\\stage\\.office-desk\\tmp\\tail.ts').action, 'allow');
  const denied = run('E:\\game\\src\\other.ts');
  assert.equal(denied.action, 'deny'); assert.match(denied.message, /\.office-desk\/tmp\//);
  assert.equal(decide({ scope: roleScope('GD', filesOf({ id: 's1', folder: folders[0] })), mode: 'bypass', tool: 'Write', input: { file_path: 'E:\\game\\.office-desk\\tmp\\x.py' }, cwd, folders }).action, 'deny', 'no shell, no scratch');
});

test('Dev-like blocks are told not to wait for other blocks with sleep', () => {
  assert.match(buildPrompt({ label: 'Dev', type: 'Dev', files, content: 'x' }).text, /Không chờ khối khác bằng sleep/);
});

test('pasted images in the app attachments folder of the session stay readable (read only)', () => {
  const folders = ['E:\\game'], cwd = 'E:\\game', readable = ['C:\\Users\\me\\AppData\\Roaming\\office-desk\\attachments\\s1'];
  const image = readable[0] + '\\3431c104.png', dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game');
  const run = (tool, input) => decide({ scope: dev, mode: 'bypass', tool, input, cwd, folders, readable });
  assert.notEqual(run('Read', { file_path: image }).action, 'deny'); // falls through to the normal approval (auto in Bypass)
  assert.notEqual(run('Bash', { command: 'ls C:/Users/me/AppData/Roaming/office-desk/attachments/s1/' }).action, 'deny');
  assert.equal(run('Write', { file_path: image }).action, 'deny');
  assert.equal(run('Read', { file_path: 'C:\\Users\\me\\AppData\\Roaming\\office-desk\\attachments\\s2\\x.png' }).action, 'deny', 'another session');
});

test('large outputs the CLI saved under the profile tool-results folder stay readable; transcripts do not', () => {
  const folders = ['E:\\game'], cwd = 'E:\\game', cliData = 'C:\\Users\\me\\AppData\\Roaming\\office-desk\\profiles\\p1\\projects';
  const saved = cliData + '\\E--game\\1fe6d3e5\\tool-results\\bfno7.txt', dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game');
  const run = (tool, input) => decide({ scope: dev, mode: 'bypass', tool, input, cwd, folders, cliData });
  assert.notEqual(run('Read', { file_path: saved }).action, 'deny');
  assert.notEqual(run('Bash', { command: `python -P -c "import json; json.load(open(r'${saved}'))"` }).action, 'deny');
  assert.equal(run('Read', { file_path: cliData + '\\E--game\\1fe6d3e5.jsonl' }).action, 'deny', 'transcript');
  assert.equal(run('Write', { file_path: saved }).action, 'deny');
});

test('every block is told to stay inside the session folders and to ask for missing folders', () => {
  const text = buildPrompt({ label: 'Dev', type: 'Dev', files, folders: ['E:\\game', 'E:\\art'], content: 'x' }).text;
  assert.match(text, /Chỉ đọc, tìm và ghi trong thư mục của session: E:\\game, E:\\art/);
  assert.match(text, /báo người dùng thêm thư mục đó vào session/);
});

test('QA prompt points at the reusable script folder and asks for a short reading list', () => {
  const text = buildPrompt({ label: 'QA', type: 'QA', files, content: 'kiểm' }).text;
  assert.ok(text.includes(qaDir(files)));
  assert.match(text, /dùng lại\/sửa script có sẵn/);
  assert.match(text, /không nhét script dài vào heredoc/);
  assert.match(text, /không dùng \/tmp/); assert.match(text, /mỗi lệnh chạy một khung hình/);
});

test('QA, Art Director, Lead and Release share ISSUES.md: parallel reviews no longer wait for each other', () => {
  const { exclusivePaths, scopesOverlap } = require('../permissions.cjs');
  const qa = exclusivePaths(roleScope('QA', files)), ad = exclusivePaths(roleScope('Art Director', files));
  assert.equal(scopesOverlap(qa, ad), false);
  assert.equal(scopesOverlap(exclusivePaths(roleScope('Release', files)), qa), false);
  assert.equal(decide({ scope: roleScope('Art Director', files), mode: 'edit', tool: 'Write', input: { file_path: files.issues }, cwd: 'E:\\game' }).action, 'allow');
});

test('a step queued by a temporary conflict retries by itself, without waiting for another event', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { initial, update } = require('../team.cjs');
  const { createAutoRun } = require('../pipeline.cjs');
  const { retryable, pump } = require('../dispatch.cjs');
  const graph = require('../flowgraph.cjs');
  const team = initial(); const id = update(team, 'create', { request: 'x' }); update(team, 'select-roles', { id, roles: ['GD', 'QA'] });
  const thread = team.threads[0], sent = []; let busy = true;
  const auto = createAutoRun({
    update: (item, action, payload) => update(team, action, { ...payload, id: item.id }),
    send: async (item, label) => { if (label === 'QA' && busy) throw retryable('Khối khác đang sửa cùng tệp.'); sent.push(label); return true; },
    pump: item => pump(item, async () => true, () => {}),
    log: (item, role, text) => item.messages.push({ role, text, time: new Date().toISOString() }),
    changed: () => {}, approve: async () => true, isRunning: () => false
  });
  await auto.enable(thread, 'test');
  await auto.after(thread, 'GD', { text: '```handoff\n{"status":"done","summary":"ok"}\n```' });
  assert.equal(graph.stateOf(thread, 'QA').status, 'queued'); assert.ok(!sent.includes('QA'));
  busy = false; t.mock.timers.tick(30 * 1000); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, ['QA']); assert.equal(graph.stateOf(thread, 'QA').status, 'running');
});

test('Dev-like blocks only run quick checks and leave the full multi-frame flow to QA', () => {
  const dev = buildPrompt({ label: 'Dev', type: 'Dev', files, content: 'x', devFiles: ['src/a.ts'] }).text;
  assert.match(dev, /Tự kiểm nhanh/); assert.match(dev, /QA chạy ngay sau bạn/);
  assert.doesNotMatch(buildPrompt({ label: 'QA', type: 'QA', files, content: 'x' }).text, /Tự kiểm nhanh/);
});
