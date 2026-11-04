const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fenceBody, fenceBodies } = require('../fence.cjs');
const fixer = require('../fixer.cjs');
const { taskPlan } = require('../workers.cjs');
const { initial, update } = require('../team.cjs');
const T = '```';

test('fence closes only at a line start, so ``` mentioned inside a JSON string does not cut the block', () => {
  const value = { action: 'restart', target: 'Lead Dev', message: 'Chỉ xuất lại khối ' + T + 'tasks' + T + ' hợp lệ' };
  const text = 'Chẩn đoán.\n\n' + T + 'fix\n' + JSON.stringify(value) + '\n' + T + '\n\n' + T + 'handoff\n{"status":"done"}\n' + T;
  assert.deepEqual(JSON.parse(fenceBody(text, 'fix')), value);
  assert.equal(fixer.parseFix(text, ['Lead Dev', 'Dev', 'Fixer']).message, value.message);
  assert.deepEqual(fenceBodies(text, 'handoff'), ['{"status":"done"}']);
  assert.equal(fenceBody(T + 'tasks {"tasks":[]}' + T, 'tasks'), '{"tasks":[]}', 'one-line block still read');
  assert.equal(fenceBody('không có', 'fix'), null);
});
test('a task for a block not in the team says so instead of the generic reason', () => {
  const team = initial(), id = update(team, 'create', { request: 'x', folder: 'E:\\game' }); for (const type of ['Lead Dev', 'Dev', 'QA']) update(team, 'add-worker', { id, type });
  const thread = team.threads.find(item => item.id === id), problems = [];
  const text = T + 'tasks\n' + JSON.stringify({ tasks: [{ worker: 'Art', task: 'nén ảnh', files: ['a.png'] }] }) + '\n' + T;
  assert.equal(taskPlan(text, thread, problems), null);
  assert.match(problems[0], /không có khối "Art" trong đội/); assert.match(problems[0], /Dev/);
});
test('running Fixer by hand finds the open incident: the last one the app recorded, else a blocked node or task', () => {
  const nodes = [{ id: 'Lead Dev@triage', label: 'Lead Dev' }, { id: 'QA', label: 'QA' }];
  const thread = { flow: ['Lead Dev', 'QA', 'Fixer'], workers: { 'Lead Dev': { type: 'Lead Dev' } }, planProblems: 'không có khối "Art" trong đội',
    graphRun: { nodes: { 'Lead Dev@triage': { status: 'blocked' }, QA: { status: 'idle' } } },
    messages: [{ role: 'Tự động', text: 'Lead Dev chưa xuất khối tasks hợp lệ; dừng tự động ở bước này.' }] };
  const found = fixer.currentIncident(thread, nodes);
  assert.equal(found.label, 'Lead Dev'); assert.match(found.reason, /chưa xuất khối tasks/); assert.match(found.reason, /"Art"/);
  thread.lastIncident = { label: 'Lead Dev', kind: 'bị chặn', reason: 'ghi lúc chặn' }; assert.equal(fixer.currentIncident(thread, nodes).reason, 'ghi lúc chặn');
  thread.graphRun.nodes['Lead Dev@triage'].status = 'done'; assert.equal(fixer.currentIncident(thread, nodes), null, 'nothing stopped → plain Fixer chat');
  thread.dispatch = [{ worker: 'QA', status: 'failed' }]; assert.equal(fixer.currentIncident(thread, nodes).label, 'QA');
});
test('Fixer brief stays under the chat limit', () => {
  const huge = 'x'.repeat(20000), thread = { round: 1, dispatch: [{ worker: 'Dev', task: huge, status: 'blocked', error: huge }],
    messages: [{ role: 'Dev', text: huge, steps: Array.from({ length: 40 }, () => ({ tool: 'Bash', detail: huge, end: 'x', ok: false, result: huge })) }] };
  assert.ok(fixer.brief(thread, { label: 'Dev', kind: 'bị chặn', reason: huge }).length <= 12000);
  assert.match(fixer.brief(thread, { label: 'Dev', kind: 'bị chặn', reason: 'x', manual: true }), /bạn gọi Fixer/);
});
test('Fixer brief keeps the tail of a long answer, where the tasks block is', () => {
  const tail = T + 'tasks\n{"tasks":[{"worker":"Art"}]}\n' + T;
  const thread = { round: 1, messages: [{ role: 'Lead Dev', text: 'phân tích '.repeat(1500) + tail }] };
  const text = fixer.brief(thread, { label: 'Lead Dev', kind: 'bị chặn', reason: 'x' });
  assert.ok(text.includes(tail)); assert.match(text, /app lược \d+ ký tự ở giữa/);
});
