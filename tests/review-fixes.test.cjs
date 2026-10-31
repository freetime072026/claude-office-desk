const { test } = require('node:test'); const assert = require('node:assert/strict');
const { pump, retryable } = require('../dispatch.cjs');
const { needsConfirm } = require('../modes.cjs');
const { systemFolder, pathsFromInput } = require('../path-input.cjs');
const { initial, update } = require('../team.cjs');
const { approvalScope, createAutoRun } = require('../pipeline.cjs');
const { worker } = require('../workers.cjs');
const { rolePrompt } = require('../prompt.cjs');

test('a pump call arriving while another pump waits on send is not dropped: the dependent task starts', async () => {
  const thread = { dispatch: [{ worker: 'Dev', task: 'A', status: 'running' }, { worker: 'Dev #2', task: 'B', status: 'queued' }, { worker: 'Dev #3', task: 'C', status: 'queued', dependsOn: ['Dev'] }] };
  const started = []; let release;
  const send = task => { started.push(task.worker); if (task.worker === 'Dev #2') return new Promise(resolve => { release = () => resolve(true); }); return Promise.resolve(true); };
  const first = pump(thread, send, () => {});
  await new Promise(setImmediate);
  thread.dispatch[0].status = 'finished'; await pump(thread, send, () => {});
  release(); await first;
  assert.deepEqual(started, ['Dev #2', 'Dev #3']); assert.equal(thread.dispatchPumping, undefined); assert.equal(thread.dispatchAgain, undefined);
});

test('only errors marked retryable return a task to the queue; other errors block it', async () => {
  const thread = { dispatch: [{ worker: 'Dev', task: 'A', status: 'queued' }, { worker: 'Dev #2', task: 'B', status: 'queued' }] };
  await pump(thread, async task => { throw task.worker === 'Dev' ? retryable('Khối đang trả lời') : Error('Khối đang trả lời'); }, () => {});
  assert.equal(thread.dispatch[0].status, 'queued'); assert.equal(thread.dispatch[1].status, 'blocked');
});

test('a dependent task listed before its blocked dependency is blocked in the same pump', async () => {
  const thread = { dispatch: [{ worker: 'Dev #2', task: 'B', status: 'queued', dependsOn: ['Dev'] }, { worker: 'Dev', task: 'A', status: 'queued' }] };
  await pump(thread, async () => { throw Error('CLI lỗi'); }, () => {});
  assert.equal(thread.dispatch[1].status, 'blocked'); assert.equal(thread.dispatch[0].status, 'blocked');
});

test('Bypass asks for the Windows drive, the user-profile drive and network folders, not for other local drives', () => {
  const env = { SystemDrive: 'D:', USERPROFILE: 'F:\\Users\\me' };
  assert.equal(needsConfirm('bypass', ['E:\\game'], env), false);
  assert.equal(needsConfirm('bypass', ['D:\\game'], env), true);
  assert.equal(needsConfirm('bypass', ['F:\\work'], env), true);
  assert.equal(needsConfirm('bypass', ['c:\\work'], env), true);
  assert.equal(needsConfirm('bypass', ['\\\\server\\share\\game'], env), true);
});

test('drive roots and Windows/Program Files folders are never adopted from message text', () => {
  const env = { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' };
  for (const folder of ['C:\\', 'E:\\', 'C:\\Windows', 'C:\\Windows\\System32\\drivers', 'C:\\Program Files\\App', '\\\\server\\share']) assert.equal(systemFolder(folder, env), true, folder);
  for (const folder of ['E:\\FreeTimes\\game', 'C:\\Users\\me\\proj', 'C:\\WindowsApps2']) assert.equal(systemFolder(folder, env), false, folder);
});

test('a system path pasted in a message is reported as refused, not granted', { skip: process.platform !== 'win32' }, () => {
  const refused = []; const found = pathsFromInput(process.env.SystemRoot + '\\System32\n' + __dirname, refused);
  assert.equal(found.length, 1); assert.equal(found[0].toLowerCase(), __dirname.toLowerCase()); assert.equal(refused.length, 1);
});

test('auto-run approval records the role modes and folders, and changing a mode changes the scope', async () => {
  const team = initial(); const id = update(team, 'create', { request: 'Feature' }); update(team, 'select-roles', { id, roles: ['GD', 'Dev'] });
  const thread = team.threads[0]; thread.folder = 'E:\\game';
  const auto = createAutoRun({ update: () => {}, send: async () => true, pump: async () => {}, log: () => {}, changed: () => {}, approve: async () => true, isRunning: () => false });
  await auto.enable(thread, 'Thử.');
  assert.equal(thread.auto.scope, approvalScope(thread));
  worker(thread, 'Dev').mode = 'bypass'; assert.notEqual(thread.auto.scope, approvalScope(thread));
  worker(thread, 'Dev').mode = 'read'; thread.relatedFolders = ['C:\\other']; assert.notEqual(thread.auto.scope, approvalScope(thread));
});

test('the roster clips other blocks\' tasks; the full task appears once as "Task của khối"', () => {
  const team = initial(); const id = update(team, 'create', { request: 'Feature' }); update(team, 'select-roles', { id, roles: ['Lead Dev', 'Dev', 'Dev'] });
  const thread = team.threads[0], long = 'x'.repeat(3000);
  for (const label of thread.flow) if (label.startsWith('Dev')) worker(thread, label).task = label + ' ' + long;
  const { text } = rolePrompt(team, thread, 'Dev', { content: 'Thực hiện task Lead giao ở mục "Task của khối".', resumed: false });
  assert.equal(text.split(long).length - 1, 1);
});

test('rerunning a task continues its CLI session unless that session was already heavy', () => {
  const { taskSession, continuationOf, RESUME_CONTEXT_LIMIT } = require('../dispatch.cjs');
  const light = taskSession('s1', 'p:E:\game:Dev', { input: 10, cacheRead: 500000, cacheWrite: 90000, turns: 20 });
  assert.deepEqual(light, { id: 's1', key: 'p:E:\game:Dev', contextAverage: 29501 });
  assert.equal(continuationOf({ session: light }), light);
  const heavy = taskSession('s2', 'k', { input: 120, cacheRead: 9114876, cacheWrite: 263672, turns: 109 });
  assert.ok(heavy.contextAverage >= RESUME_CONTEXT_LIMIT); assert.equal(continuationOf({ session: heavy }), null);
  assert.equal(continuationOf({}), null); assert.equal(taskSession('s3', 'k', undefined).contextAverage, 0);
});

test('Agent calls are rewritten to the cheap read-only code-reader, run in the foreground; roles without shell cannot use it', () => {
  const { decide, roleScope } = require('../permissions.cjs');
  const { filesOf } = require('../session-files.cjs');
  const { cliTools } = require('../modes.cjs');
  const { agentsArg, READER } = require('../subagent.cjs');
  const files = filesOf({ id: 's', folder: 'E:\game' }), dev = roleScope('Dev', files, ['src/'], 'E:\game');
  const verdict = decide({ scope: dev, mode: 'edit', tool: 'Agent', input: { description: 'x', prompt: 'find', subagent_type: 'general-purpose', model: 'opus' } });
  assert.equal(verdict.action, 'allow'); assert.deepEqual([verdict.updatedInput.subagent_type, verdict.updatedInput.model, verdict.updatedInput.run_in_background, verdict.updatedInput.prompt], [READER, 'haiku', false, 'find']);
  assert.equal(decide({ scope: roleScope('GD', files), mode: 'edit', tool: 'Agent', input: {} }).action, 'deny');
  assert.equal(decide({ scope: null, mode: 'edit', tool: 'Agent', input: {} }).action, 'deny');
  assert.match(cliTools('read', dev), /Agent/); assert.doesNotMatch(cliTools('read', roleScope('GD', files)), /Agent/);
  const agent = JSON.parse(agentsArg())[READER]; assert.deepEqual([agent.tools, agent.model], [['Read', 'Grep', 'Glob'], 'haiku']);
});
