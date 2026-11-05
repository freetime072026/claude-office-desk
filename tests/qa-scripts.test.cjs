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
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: { command: 'npm run dev', run_in_background: true } }).action, 'allow');
});

test('shell blocks may write helper scripts in the system temp folder; it does not make parallel blocks overlap', () => {
  const { exclusivePaths, scopesOverlap } = require('../permissions.cjs');
  const tmp = path.join(require('node:os').tmpdir(), 'gen', 'make.py');
  const dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game'), art = roleScope('Art', files, ['assets/ui/'], 'E:\\game');
  for (const scope of [dev, art, roleScope('QA', files)]) assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: tmp }, cwd: 'E:\\game' }).action, 'allow');
  assert.equal(decide({ scope: dev, mode: 'edit', tool: 'Write', input: { file_path: 'E:\\game\\src\\b.ts' }, cwd: 'E:\\game' }).action, 'deny');
  assert.equal(scopesOverlap(exclusivePaths(dev), exclusivePaths(art)), false);
  assert.equal(decide({ scope: roleScope('GD', files), mode: 'edit', tool: 'Write', input: { file_path: tmp }, cwd: 'E:\\game' }).action, 'deny');
});

test('QA Bash commands using /tmp are refused with a hint; other paths and other blocks are not affected', () => {
  const qa = roleScope('QA', files), dev = roleScope('Dev', files, ['src/a.ts'], 'E:\\game');
  for (const command of ['node a.cjs > /tmp/acA.json', 'cat /tmp/x.log', 'node -e "require(\'/tmp/acA.json\')"', 'OUT=/tmp node a.cjs']) {
    const verdict = decide({ scope: qa, mode: 'bypass', tool: 'Bash', input: { command } });
    assert.equal(verdict.action, 'deny', command); assert.match(verdict.message, /\.office-desk\/qa\/out\//);
  }
  for (const command of ['node .office-desk/qa/m1_ac.cjs > .office-desk/qa/out/ac.json', 'ls src/tmpl/x', 'cat "$TEMP/pa0034_qa/a.json"', 'echo /tmpfile']) {
    assert.equal(decide({ scope: qa, mode: 'bypass', tool: 'Bash', input: { command } }).action, 'allow', command);
  }
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: { command: 'cat /tmp/x' } }).action, 'allow');
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
