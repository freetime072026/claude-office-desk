const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixer = require('../fixer.cjs');
const { initial, update } = require('../team.cjs');
const { roleScope, decide } = require('../permissions.cjs');
const { buildPrompt } = require('../prompt.cjs');
const { filesOf } = require('../session-files.cjs');
const graph = require('../flowgraph.cjs');
const fence = value => '```fix\n' + JSON.stringify(value) + '\n```';

test('parseFix accepts the four actions on a real block and rejects bad output with a reason', () => {
  const flow = ['GD', 'Lead Dev', 'Dev', 'QA', 'Fixer'];
  assert.deepEqual(fixer.parseFix(fence({ cause: 'hết lượt', fix: 'dùng Edit', action: 'continue', target: 'Dev', message: 'sửa dòng 87' }), flow), { cause: 'hết lượt', fix: 'dùng Edit', action: 'continue', target: 'Dev', message: 'sửa dòng 87' });
  assert.equal(fixer.parseFix(fence({ cause: 'cần đăng nhập', action: 'user', message: 'đăng nhập hồ sơ' }), flow).action, 'user');
  for (const [bad, reason] of [[{ action: 'retry', target: 'Dev' }, /action/], [{ action: 'continue', target: 'Wizard' }, /target/], [{ action: 'restart', target: 'Fixer' }, /target/]]) {
    const problems = []; assert.equal(fixer.parseFix(fence(bad), flow, problems), null); assert.match(problems.join(), reason);
  }
  const problems = []; assert.equal(fixer.parseFix('không có', flow, problems), null); assert.match(problems[0], /khối fix/);
});
test('at most two Fixer attempts per block per round; a new round resets the count', () => {
  const thread = { round: 1 };
  assert.equal(fixer.canFix(thread, 'Dev'), true); fixer.count(thread, 'Dev'); fixer.count(thread, 'Dev');
  assert.equal(fixer.canFix(thread, 'Dev'), false); assert.equal(fixer.canFix(thread, 'QA'), true); assert.equal(fixer.canFix(thread, 'Fixer'), false);
  thread.round = 2; assert.equal(fixer.canFix(thread, 'Dev'), true);
});
test('brief carries the reason, task, files, last answer and the step log of the stopped block', () => {
  const thread = { round: 1, dispatch: [{ worker: 'Dev', task: 'Đo GC', files: ['src/a.cs'], status: 'blocked', error: 'Chạm giới hạn số lượt tool' }],
    messages: [{ role: 'Dev', text: 'Sửa xong một nửa', maxTurns: true, steps: [{ tool: 'Bash', detail: 'unity.sh wait-compile', end: 'x', ok: false, result: 'error CS1010' }, { tool: 'Edit', detail: 'src/a.cs' }] }] };
  const text = fixer.brief(thread, { label: 'Dev', kind: 'bị chặn', reason: 'Dev bị chặn: Chạm giới hạn số lượt tool' });
  for (const part of [/lần 1\/2/, /Đo GC/, /src\/a\.cs/, /chạm giới hạn lượt tool/, /✗ error CS1010/, /không kết thúc/]) assert.match(text, part);
});
test('Fixer: one per session, runs checks in shell, writes only FIXES.md, has no node on the flow graph', () => {
  const team = initial(), id = update(team, 'create', { request: 'x' }); for (const type of ['GD', 'Dev', 'QA', 'Fixer']) update(team, 'add-worker', { id, type });
  const thread = team.threads.find(item => item.id === id);
  assert.throws(() => update(team, 'add-worker', { id, type: 'Fixer' }), /đã có Fixer/);
  assert.equal(thread.graph.nodes.some(node => node.label === 'Fixer'), false);
  const files = filesOf({ id: 's', folder: 'E:\\game' }), scope = roleScope('Fixer', files);
  assert.equal(scope.bash, true); assert.deepEqual(scope.paths, [files.fixes]);
  assert.equal(decide({ scope, mode: 'edit', tool: 'Edit', input: { file_path: 'E:\\game\\src\\a.cs' }, cwd: 'E:\\game' }).action, 'deny');
  assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: files.fixes }, cwd: 'E:\\game' }).action, 'allow');
  const prompt = buildPrompt({ label: 'Fixer', type: 'Fixer', files, content: 'Sự cố ở Dev' }).text;
  assert.match(prompt, /nhãn fix/); assert.match(prompt, /Không sửa code/);
  assert.match(buildPrompt({ label: 'Dev', type: 'Dev', files, content: 'x', fixNote: 'dùng Edit thay Python' }).text, /Fixer đã chẩn đoán lần dừng trước: dùng Edit thay Python/);
});
test('auto run reports a stopped block as an incident; a graphless Fixer turn is ignored by the pipeline', async () => {
  const { createAutoRun } = require('../pipeline.cjs');
  const team = initial(), id = update(team, 'create', { request: 'x' }); for (const type of ['GD', 'QA', 'Fixer']) update(team, 'add-worker', { id, type });
  const thread = team.threads.find(item => item.id === id), incidents = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async () => true, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false, incident: (item, value) => incidents.push(value) });
  await auto.enable(thread, 'test'); await auto.runStage(thread, 'GD');
  // A turn that ends without a valid handoff is an error: Fixer is called.
  await auto.after(thread, 'GD', { text: 'Đã chốt GDD nhưng quên khối handoff' });
  assert.equal(incidents.length, 1); assert.equal(incidents[0].label, 'GD'); assert.match(incidents[0].reason, /chưa xuất khối handoff/);
  assert.equal(graph.stateOf(thread, 'GD').status, 'blocked');
  await auto.after(thread, 'Fixer', { text: 'xong' }); assert.equal(incidents.length, 1);
});
test('a non-Dev block left "running" without a chat session is blocked and reported after the grace period', async () => {
  const { createAutoRun } = require('../pipeline.cjs');
  const setup = () => {
    const team = initial(), id = update(team, 'create', { request: 'x' }); for (const type of ['GD', 'QA', 'Fixer']) update(team, 'add-worker', { id, type });
    const thread = team.threads.find(item => item.id === id), incidents = [];
    const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async () => true, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false, incident: (item, value) => incidents.push(value) });
    return { thread, incidents, auto };
  };
  const stale = setup(); await stale.auto.enable(stale.thread, 'test');
  Object.assign(graph.stateOf(stale.thread, 'QA'), { status: 'running', startedAt: 0 });
  await stale.auto.runStage(stale.thread);
  assert.equal(graph.stateOf(stale.thread, 'QA').status, 'blocked');
  assert.equal(stale.incidents.filter(item => item.label === 'QA').length, 1);
  const fresh = setup(); await fresh.auto.enable(fresh.thread, 'test');
  Object.assign(graph.stateOf(fresh.thread, 'QA'), { status: 'running', startedAt: Date.now() });
  await fresh.auto.runStage(fresh.thread);
  assert.equal(graph.stateOf(fresh.thread, 'QA').status, 'running');
  assert.equal(fresh.incidents.filter(item => item.label === 'QA').length, 0);
});
test('Fixer can mark a block that finished its work but never handed off as done (complete + status)', () => {
  const flow = ['GD', 'Art Director', 'QA', 'Fixer'];
  const ok = fixer.parseFix(fence({ cause: 'CLI dừng trước handoff', action: 'complete', target: 'Art Director', status: 'pass', message: 'ART-06, ART-07 đạt' }), flow);
  assert.equal(ok.action, 'complete'); assert.equal(ok.status, 'pass'); assert.equal(ok.target, 'Art Director');
  const problems = []; assert.equal(fixer.parseFix(fence({ action: 'complete', target: 'QA' }), flow, problems), null); assert.match(problems[0], /status/);
  assert.match(fixer.GUIDE, /KHÔNG cần tự chạy khối/); assert.match(fixer.GUIDE, /complete = /);
});
test('the run is not finished while a parallel branch is still blocked, and a finished run reopens when that branch hands off', async () => {
  const { createAutoRun } = require('../pipeline.cjs');
  const team = initial(), id = update(team, 'create', { request: 'x' }); update(team, 'select-roles', { id, roles: ['GD', 'Art Director', 'Lead Dev', 'Dev', 'Art'] });
  const thread = team.threads.find(item => item.id === id), sent = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label); return true; }, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false });
  await auto.enable(thread, 'test');
  const nodes = graph.ensureGraph(thread).nodes, art = nodes.find(node => node.label === 'Art');
  for (const node of nodes) graph.stateOf(thread, node.id).status = 'done';
  Object.assign(graph.stateOf(thread, art.id), { status: 'blocked', outcome: 'blocked' });
  Object.assign(graph.stateOf(thread, graph.END), { status: 'queued' });
  await auto.runStage(thread);
  assert.notEqual(thread.status, 'done'); assert.match(thread.messages.at(-1).text, /Chưa Hoàn tất: còn Art/);
  thread.status = 'done'; // an older run that finished while Art was blocked
  thread.dispatch = [{ worker: 'Art', status: 'finished', by: 'Art Director', task: 'x', files: ['a/'] }];
  await auto.after(thread, 'Art', { text: '```handoff\n{"status":"done","summary":"25/25 ảnh"}\n```' });
  assert.equal(thread.status, 'working');
  assert.equal(graph.stateOf(thread, art.id).status, 'done');
  assert.ok(sent.includes('Art Director'), 'Art Director review runs after Art');
});

test('Fixer is not called for intended stops: a block waiting for the user, a run you stopped, a paused block', async () => {
  const { createAutoRun } = require('../pipeline.cjs');
  const setup = () => {
    const team = initial(), id = update(team, 'create', { request: 'x' }); for (const type of ['GD', 'QA', 'Fixer']) update(team, 'add-worker', { id, type });
    const thread = team.threads.find(item => item.id === id), incidents = [];
    const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async () => true, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false, incident: (item, value) => incidents.push(value) });
    return { team, thread, incidents, auto };
  };
  const blocked = '```handoff\n{"status":"blocked","summary":"Chờ ảnh C08: dán ảnh ChatGPT vào art/inbox"}\n```';
  // 1) the block asks the user (Art waiting for images, GD needs a decision): stop and wait, no Fixer
  { const { thread, incidents, auto } = setup(); await auto.enable(thread, 'test'); await auto.runStage(thread, 'GD');
    await auto.after(thread, 'GD', { text: blocked });
    assert.equal(graph.stateOf(thread, 'GD').status, 'blocked'); assert.equal(incidents.length, 0); assert.match(thread.messages.at(-1).text, /cần người dùng: Chờ ảnh C08/); }
  // 2) you pressed stop: the run ends with an error marked stopped -> no Fixer; a real CLI error -> Fixer
  { const { thread, incidents, auto } = setup(); await auto.enable(thread, 'test'); await auto.runStage(thread, 'GD');
    await auto.after(thread, 'GD', { text: '', error: true, stopped: true });
    assert.equal(incidents.length, 0); assert.match(thread.messages.at(-1).text, /đã bị bạn dừng/); }
  { const { thread, incidents, auto } = setup(); await auto.enable(thread, 'test'); await auto.runStage(thread, 'GD');
    await auto.after(thread, 'GD', { text: '', error: true });
    assert.equal(incidents.length, 1); }
  // 3) a paused block is never reported
  { const { thread, incidents, auto } = setup(); await auto.enable(thread, 'test'); await auto.runStage(thread, 'GD');
    thread.workers.GD.paused = true; graph.stateOf(thread, 'GD').status = 'running';
    await auto.runStage(thread, 'QA');
    assert.equal(incidents.length, 0); }
});
test('a Dev/Art task the block itself blocked to wait for the user is not sent to Fixer; one that hit the tool limit is', async () => {
  const { createAutoRun } = require('../pipeline.cjs');
  const run = async (message, task) => {
    const team = initial(), id = update(team, 'create', { request: 'x' }); for (const type of ['GD', 'Art', 'QA', 'Fixer']) update(team, 'add-worker', { id, type });
    const thread = team.threads.find(item => item.id === id), incidents = [];
    const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async () => true, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false, incident: (item, value) => incidents.push(value) });
    await auto.enable(thread, 'test');
    for (const node of graph.ensureGraph(thread).nodes) graph.stateOf(thread, node.id).status = 'done';
    graph.stateOf(thread, 'Art').status = 'running';
    thread.dispatch = [{ worker: 'Art', task: 'C08', files: ['art/'], ...task }];
    await auto.after(thread, 'Art', message);
    return { incidents, state: graph.stateOf(thread, 'Art').status };
  };
  const waiting = await run({ text: '```handoff\n{"status":"blocked","summary":"Chờ ảnh C08"}\n```' }, { status: 'blocked', error: 'Chờ ảnh C08' });
  assert.equal(waiting.state, 'blocked'); assert.equal(waiting.incidents.length, 0);
  const limit = await run({ text: 'đang làm dở', maxTurns: true }, { status: 'blocked', error: 'Chạm giới hạn số lượt tool' });
  assert.equal(limit.incidents.length, 1);
  const stopped = await run({ text: '', error: true, stopped: true }, { status: 'cancelled' });
  assert.equal(stopped.incidents.length, 0);
});
