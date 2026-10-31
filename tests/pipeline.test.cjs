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
const tasksText = workers => 'Plan\n' + fence('tasks', { tasks: workers.map(worker => ({ worker, files: ['src/' + worker.replace(/\W/g, '') + '/'], task: 'Làm phần của ' + worker })) });

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
  assert.equal(thread.issues[0].closed, true); assert.equal(thread.flow[thread.stage], 'QA'); assert.equal(thread.qaPhase, 'performance'); assert.equal(sent.at(-1), 'QA');
  await auto.after(thread, 'QA', reply('pass'));
  assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'review'); assert.equal(sent.at(-1), 'Lead Dev');

  await auto.after(thread, 'Lead Dev', reply('pass'));
  assert.equal(thread.status, 'done');
  assert.deepEqual(sent, ['Lead Dev', 'Dev', 'QA', 'Lead Dev', 'Dev', 'QA', 'QA', 'Lead Dev']);
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
  await auto.after(thread, 'QA', reply('pass')); assert.equal(thread.qaPhase, 'performance');
  await auto.after(thread, 'QA', reply('pass'));
  await auto.after(thread, 'Lead Dev', reply('reject', { summary: 'Duplicate: main.cjs:10' }));
  assert.equal(thread.qaPhase, 'functional', 'code changed by review → QA restarts at functional');
  assert.equal(thread.leadPhase, 'planning'); assert.equal(thread.qaFailRounds, 0);
  assert.deepEqual(thread.dispatch.map(task => task.worker), ['Dev', 'Dev #2']); assert.match(thread.dispatch[0].task, /Duplicate: main.cjs:10/);
});
test('QA checks performance only after functional pass, and Lead review may send work back to Dev only once', async () => {
  const { thread, sent, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  await auto.after(thread, 'QA', reply('pass')); assert.equal(thread.qaPhase, 'performance'); assert.equal(sent.at(-1), 'QA');
  await auto.after(thread, 'QA', reply('issue', { summary: 'GC Alloc 2 KB/frame' }));
  assert.equal(thread.leadPhase, 'triage'); assert.equal(thread.qaPhase, 'performance', 'a performance issue is retested in the performance phase');
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  await auto.after(thread, 'QA', reply('pass', { retested: [{ id: thread.issues[0].id, evidence: '0 B/frame' }] }));
  assert.equal(thread.leadPhase, 'review');
  await auto.after(thread, 'Lead Dev', reply('reject', { summary: 'Duplicate A' })); assert.equal(thread.reviewRejects, 1);
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass'));
  const before = sent.length;
  await auto.after(thread, 'Lead Dev', reply('reject', { summary: 'Duplicate B' }));
  assert.equal(sent.length, before, 'second reject does not start another Dev round'); assert.equal(thread.reviewRejects, 1);
  assert.match(thread.messages.at(-1).text, /Review vẫn không đạt sau 1 lần sửa[\s\S]*Duplicate B/);
});

test('GD confirming a new problem after the flow moved on opens a new round from the step after GD', async () => {
  const { thread, sent, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  await auto.after(thread, 'QA', reply('pass')); assert.equal(thread.qaPhase, 'performance');
  const before = sent.length;
  await auto.after(thread, 'GD', reply('done'));
  assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'planning'); assert.equal(thread.qaPhase, undefined);
  assert.deepEqual(thread.dispatch, []); assert.equal(sent.at(-1), 'Lead Dev'); assert.equal(sent.length, before + 1);
  assert.match(thread.messages.find(message => /mở vòng mới/.test(message.text)).text, /mở vòng mới: Lead Dev · lập kế hoạch/);
});

test('a new GD round waits while Dev tasks are still running, and a GD question (blocked) never restarts the flow', async () => {
  const { thread, sent, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  const before = sent.length;
  await auto.after(thread, 'GD', reply('done'));
  assert.equal(thread.flow[thread.stage], 'Dev'); assert.equal(sent.length, before); assert.match(thread.messages.at(-1).text, /Dev còn đang làm/);
  await auto.after(thread, 'GD', reply('blocked')); assert.equal(thread.flow[thread.stage], 'Dev');
});

test('a session that was done restarts when GD confirms a new change', async () => {
  const { thread, sent, auto } = harness(['GD', 'Dev', 'QA']);
  thread.status = 'done'; thread.stage = 2; thread.auto = { enabled: false };
  await auto.after(thread, 'GD', reply('done'));
  assert.equal(thread.auto.enabled, true); assert.equal(thread.status, 'working'); assert.equal(thread.flow[thread.stage], 'Dev'); assert.equal(sent.at(-1), 'Dev');
});

// Mô phỏng main.cjs khi Dev trả handoff blocked: task chuyển blocked kèm lý do.
function devBlocks(thread, label, summary) { const task = thread.dispatch.find(item => item.worker === label && item.status === 'running'); task.status = 'blocked'; task.error = summary; }
test('parseHandoff keeps reassign only on a blocked handoff', () => {
  assert.equal(parseHandoff(fence('handoff', { status: 'blocked', summary: 'x', reassign: true })).reassign, true);
  assert.equal('reassign' in parseHandoff(fence('handoff', { status: 'done', reassign: true })), false);
  assert.equal('reassign' in parseHandoff(fence('handoff', { status: 'blocked', reassign: 'yes' })), false);
});
test('a Dev blocked with reassign waits for the other Devs, then goes to Lead triage instead of QA', async () => {
  const { team, thread, sent, auto } = harness(); update(team, 'add-worker', { id: thread.id, type: 'Dev' });
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev', 'Dev #2'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev', 'Dev #2']) }, { proposalApplied: true });
  assert.deepEqual(sent.slice(-2).sort(), ['Dev', 'Dev #2']);
  devBlocks(thread, 'Dev #2', 'AC lệch 124 ms; nghi UnitAnimator.cs');
  await auto.after(thread, 'Dev #2', reply('blocked', { reassign: true, summary: 'AC lệch 124 ms; nghi UnitAnimator.cs' }));
  assert.deepEqual(thread.reassign, [{ worker: 'Dev #2', summary: 'AC lệch 124 ms; nghi UnitAnimator.cs' }]);
  assert.equal(sent.at(-1) === 'Lead Dev', false, 'Lead waits while Dev is still running');
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(sent.at(-1), 'Lead Dev'); assert(!sent.includes('QA'), 'QA does not test the unfinished work');
  assert.equal(thread.leadPhase, 'triage'); assert.equal(thread.reassignRounds, 1);
  const { rolePrompt } = require('../prompt.cjs');
  assert.match(rolePrompt({}, thread, 'Lead Dev', { content: 'x' }).body, /Khối bị chặn cần giao lại[^\n]*\n- Dev #2: AC lệch 124 ms; nghi UnitAnimator\.cs/);
});
test('reassign stops for the user after the limit, and a plain blocked Dev still stops', async () => {
  const { thread, auto } = harness(['GD', 'Lead Dev', 'Dev', 'QA']);
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  thread.reassignRounds = 2; devBlocks(thread, 'Dev', 'cần giao lại');
  await auto.after(thread, 'Dev', reply('blocked', { reassign: true }));
  assert.match(thread.messages.at(-1).text, /đã tự chuyển Lead 2 lần/);
  const plain = harness(['GD', 'Lead Dev', 'Dev', 'QA']);
  await plain.auto.after(plain.thread, 'GD', reply('done'));
  leadPlans(plain.thread, tasksText(['Dev'])); await plain.auto.after(plain.thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  devBlocks(plain.thread, 'Dev', 'thiếu quyền'); await plain.auto.after(plain.thread, 'Dev', reply('blocked'));
  assert.match(plain.thread.messages.at(-1).text, /Dev bị chặn: thiếu quyền/); assert.equal(plain.thread.reassign, undefined);
});
test('a Lead plan typed by hand after the Lead step is done still starts the Devs (tasks never stay pending)', async () => {
  const { thread, sent, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  await auto.after(thread, 'QA', reply('issue'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  const qaRuns = sent.filter(label => label === 'QA').length;
  // Bạn gõ tay cho Lead khi nút triage đã xong; main.cjs áp kế hoạch với task ở trạng thái pending (chờ tới lượt theo sơ đồ).
  await auto.after(thread, 'QA', reply('blocked'));
  thread.dispatch = taskPlan(tasksText(['Dev']), thread).map(task => ({ ...task, status: 'pending' }));
  const before = sent.length;
  await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  assert.deepEqual(sent.slice(before), ['Dev']); assert.equal(thread.dispatch[0].status, 'running');
  assert.equal(sent.filter(label => label === 'QA').length, qaRuns);
});
test('a valid Lead plan held back by a running Dev stops with that reason, not "no valid tasks"', async () => {
  const { thread, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  const reason = 'Lead đã xuất kế hoạch tasks hợp lệ nhưng Dev đang chạy hoặc tạm dừng nên chưa áp dụng.';
  await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { planBlocked: reason });
  assert.equal(thread.messages.at(-1).text, reason);
});
test('QA blocked with reassign (missing tool) goes to Lead triage, then Devs, then QA again in the same phase', async () => {
  const { thread, sent, auto } = harness();
  await auto.after(thread, 'GD', reply('done'));
  leadPlans(thread, tasksText(['Dev'])); await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  thread.qaPhase = 'performance';
  await auto.after(thread, 'QA', reply('blocked', { reassign: true, summary: 'Thiếu lệnh đo ProfilerRecorder' }));
  assert.equal(sent.at(-1), 'Lead Dev'); assert.equal(thread.leadPhase, 'triage');
  assert.deepEqual(thread.reassign, [{ worker: 'QA', summary: 'Thiếu lệnh đo ProfilerRecorder' }]);
  thread.dispatch = taskPlan(tasksText(['Dev']), thread).map(task => ({ ...task, status: 'pending' })); delete thread.reassign;
  await auto.after(thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  assert.equal(sent.at(-1), 'Dev');
  devFinishes(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(sent.at(-1), 'QA'); assert.equal(thread.qaPhase, 'performance');
  const plain = harness(); await plain.auto.after(plain.thread, 'GD', reply('done'));
  leadPlans(plain.thread, tasksText(['Dev'])); await plain.auto.after(plain.thread, 'Lead Dev', { text: tasksText(['Dev']) }, { proposalApplied: true });
  devFinishes(plain.thread, 'Dev'); await plain.auto.after(plain.thread, 'Dev', reply('done'));
  await plain.auto.after(plain.thread, 'QA', reply('blocked', { summary: 'cần máy tầm trung' }));
  assert.match(plain.thread.messages.at(-1).text, /QA cần người dùng: cần máy tầm trung/);
});
