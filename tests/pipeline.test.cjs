const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { parseHandoff, parseCommand, createAutoRun } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const { taskPlan, ACTIVE_TASK, worker } = require('../workers.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const reply = (status, extra = {}) => ({ text: 'Kết quả\n' + fence('handoff', { status, summary: status + ' summary', ...extra }) });

function harness(roles = ['GD', 'Lead Dev', 'Dev', 'QA'], { approve = true } = {}) {
  const team = initial(); const id = update(team, 'create', { request: 'Feature' }); update(team, 'select-roles', { id, roles });
  const thread = team.threads[0], sent = [];
  const auto = createAutoRun({
    update: (item, action, payload) => update(team, action, { ...payload, id: item.id }),
    send: async (item, label) => { sent.push(label); return true; },
    pump: item => pump(item, async task => { sent.push(task.worker); return true; }, () => {}),
    log: (item, role, text) => item.messages.push({ role, text, time: new Date().toISOString() }),
    changed: () => {}, approve: async () => approve, isRunning: () => false
  });
  return { team, thread, sent, auto };
}
// Mô phỏng phần main.cjs làm khi Lead trả tasks hợp lệ và khi Dev kết thúc lượt.
function leadPlans(thread, text) { const proposal = taskPlan(text, thread); assert(proposal, 'tasks block must parse'); assert(!thread.dispatch?.some(task => ACTIVE_TASK.includes(task.status))); thread.dispatch = proposal.map(task => ({ ...task, status: 'queued' })); }
function devFinishes(thread, label) { const task = thread.dispatch.find(item => item.worker === label && item.status === 'running'); task.status = 'finished'; task.finishedAt = new Date().toISOString(); }
const tasksText = workers => 'Plan\n' + fence('tasks', { tasks: workers.map(worker => ({ worker, task: 'Làm phần của ' + worker })) });

test('parseHandoff takes the last valid block and rejects unknown statuses or bad JSON', () => {
  assert.equal(parseHandoff('no block'), null);
  assert.equal(parseHandoff('```handoff\n{bad json}\n```'), null);
  assert.equal(parseHandoff(fence('handoff', { status: 'maybe' })), null);
  const value = parseHandoff(fence('handoff', { status: 'blocked' }) + '\n' + fence('handoff', { status: 'pass', summary: ' ok ', retested: [{ id: 'a', evidence: 'log' }, { nope: 1 }] }));
  assert.deepEqual(value, { status: 'pass', summary: 'ok', retested: [{ id: 'a', evidence: 'log' }] });
});

test('parseCommand understands /role with multi-word labels, /auto and /chot', () => {
  const flow = ['GD', 'Lead Dev', 'Dev', 'Dev #2', 'QA'];
  assert.deepEqual(parseCommand('/role Lead Dev pause', flow), { kind: 'role', label: 'Lead Dev', verb: 'pause' });
  assert.deepEqual(parseCommand('/role dev #2 START', flow), { kind: 'role', label: 'Dev #2', verb: 'start' });
  assert.equal(parseCommand('/role QA stop', flow).kind, 'error');
  assert.match(parseCommand('/role Art start', flow).message, /Không có khối "Art"/);
  assert.equal(parseCommand('/role', flow).kind, 'error');
  assert.deepEqual(parseCommand('/auto on', flow), { kind: 'auto', on: true });
  assert.deepEqual(parseCommand('/AUTO off', flow), { kind: 'auto', on: false });
  assert.equal(parseCommand('/auto', flow).kind, 'error');
  assert.deepEqual(parseCommand('/chot', flow), { kind: 'chot' }); assert.deepEqual(parseCommand('/chốt', flow), { kind: 'chot' });
  assert.equal(parseCommand('/usage', flow), null); assert.equal(parseCommand('xin chào', flow), null);
});

test('GD done starts the auto run: Lead → Dev → QA issue → triage → Dev → QA pass → review → done, no manual clicks', async () => {
  const { thread, sent, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  assert.equal(thread.auto.enabled, true); assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.status, 'working'); assert.deepEqual(sent, ['Lead Dev']);
  assert(thread.messages.some(message => message.role === 'GD · bàn giao tự động'));

  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  assert.equal(thread.flow[thread.stage], 'Dev'); assert.deepEqual(sent, ['Lead Dev', 'Dev']);

  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(thread.flow[thread.stage], 'QA'); assert.equal(sent.at(-1), 'QA');

  await auto.after(thread, 'QA', reply('issue'));
  assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'triage'); assert.equal(thread.qaFailRounds, 1); assert.equal(sent.at(-1), 'Lead Dev');

  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(thread.flow[thread.stage], 'QA');

  const issue = thread.issues[0].id;
  await auto.after(thread, 'QA', reply('pass', { retested: [{ id: issue, evidence: 'retest log' }] }));
  assert.equal(thread.issues[0].closed, true); assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'review'); assert.equal(sent.at(-1), 'Lead Dev');

  await auto.after(thread, 'Lead Dev', reply('pass'));
  assert.equal(thread.status, 'done');
  assert.deepEqual(sent, ['Lead Dev', 'Dev', 'QA', 'Lead Dev', 'Dev', 'QA', 'Lead Dev']);
});

test('auto run stops visibly on a missing handoff block, a blocked GD, a failed turn or when not approved', async () => {
  let value = harness(); await value.auto.after(value.thread, 'GD', reply('blocked'));
  assert.equal(value.thread.auto, undefined); assert.equal(value.thread.stage, 0); assert.deepEqual(value.sent, []);

  value = harness(['GD', 'Lead Dev', 'Dev', 'QA'], { approve: false });
  await value.auto.after(value.thread, 'GD', reply('done'));
  assert.notEqual(value.thread.auto?.enabled, true); assert.equal(value.thread.stage, 0); assert(value.thread.messages.some(message => /không xác nhận/.test(message.text)));

  value = harness(); await value.auto.after(value.thread, 'GD', reply('done'));
  await value.auto.after(value.thread, 'Lead Dev', { text: 'Kế hoạch bằng văn bản tự do' });
  assert.equal(value.thread.flow[value.thread.stage], 'Lead Dev'); assert.deepEqual(value.sent, ['Lead Dev']);
  assert(value.thread.messages.some(message => message.role === 'Tự động' && /chưa xuất khối tasks/.test(message.text)));

  await value.auto.after(value.thread, 'Lead Dev', { text: 'CLI lỗi', error: true });
  assert(value.thread.messages.some(message => /lỗi hoặc bị dừng/.test(message.text))); assert.deepEqual(value.sent, ['Lead Dev']);
});

test('/chot finalises GD and runs the next stage; paused role holds the run until /role start', async () => {
  const { thread, sent, auto } = harness();
  worker(thread, 'Lead Dev').paused = true;
  assert.equal(await auto.chot(thread), true);
  assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.deepEqual(sent, []);
  assert(thread.messages.some(message => /Lead Dev đang tạm dừng/.test(message.text)));
  delete thread.workers['Lead Dev'].paused; await auto.runStage(thread);
  assert.deepEqual(sent, ['Lead Dev']);
});

test('Lead review reject without tasks reassigns the previous Dev and keeps QA rounds', async () => {
  const { team, thread, sent, auto } = harness();
  assert.equal(update(team, 'add-worker', { id: thread.id, type: 'Dev' }), 'Dev #2'); assert.deepEqual(thread.flow, ['GD', 'Lead Dev', 'Dev', 'Dev #2', 'QA']);
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev', 'Dev #2'])); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  assert.deepEqual(sent.slice(-2), ['Dev', 'Dev #2']);
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(thread.flow[thread.stage], 'Dev', 'waits for every Dev of the round');
  devFinishes(thread, 'Dev #2'); await auto.after(thread, 'Dev #2', reply('done'));
  assert.equal(thread.flow[thread.stage], 'QA');
  await auto.after(thread, 'QA', reply('pass'));
  await auto.after(thread, 'Lead Dev', reply('reject', { summary: 'Duplicate: main.cjs:10' }));
  assert.equal(thread.leadPhase, 'planning'); assert.equal(thread.qaFailRounds, 0);
  assert.deepEqual(thread.dispatch.map(task => task.worker), ['Dev', 'Dev #2']); assert.match(thread.dispatch[0].task, /Duplicate: main.cjs:10/);
});
