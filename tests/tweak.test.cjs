const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { createAutoRun } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const { taskPlan, ACTIVE_TASK } = require('../workers.cjs');
const { rolePrompt } = require('../prompt.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const reply = (status, extra = {}) => ({ text: 'Kết quả\n' + fence('handoff', { status, summary: status + ' summary', ...extra }) });
const tasksText = workers => 'Plan\n' + fence('tasks', { tasks: workers.map(worker => ({ worker, files: ['src/' + worker.replace(/\W/g, '') + '/'], task: 'Làm phần của ' + worker })) });

function harness(roles) {
  const team = initial(); const id = update(team, 'create', { request: 'Playable' }); update(team, 'select-roles', { id, roles });
  const thread = team.threads[0], sent = [], rounds = [];
  const auto = createAutoRun({
    update: (item, action, payload) => update(team, action, { ...payload, id: item.id }),
    send: async (item, label) => { sent.push(label); return true; },
    pump: item => pump(item, async task => { sent.push(task.worker); return true; }, () => {}),
    log: (item, role, text) => item.messages.push({ role, text, time: new Date().toISOString() }),
    changed: () => {}, approve: async () => true, isRunning: () => false, newRound: (item, round, summary) => rounds.push(summary)
  });
  return { team, thread, sent, rounds, auto, tweak: text => update(team, 'tweak', { id, text }) };
}
// Phần main.cjs làm khi Lead trả tasks hợp lệ và khi một khối Dev kết thúc lượt.
async function leadPlans(auto, thread, workers) {
  const text = tasksText(workers), proposal = taskPlan(text, thread); assert(proposal);
  assert(!thread.dispatch?.some(task => ACTIVE_TASK.includes(task.status)));
  thread.dispatch = proposal.map(task => ({ ...task, status: 'queued' }));
  await auto.after(thread, 'Lead Dev', { text }, { proposalApplied: true });
}
async function finishes(auto, thread, label) {
  const task = thread.dispatch.find(item => item.worker === label && item.status === 'running');
  Object.assign(task, { status: 'finished', finishedAt: new Date().toISOString() });
  await auto.after(thread, label, reply('done'));
}
async function toDone({ thread, auto }) {
  await auto.after(thread, 'GD', reply('done'));
  await leadPlans(auto, thread, ['Dev']); await finishes(auto, thread, 'Dev');
  await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass'));
  await auto.after(thread, 'Lead Dev', reply('pass')); await auto.after(thread, 'Release', reply('pass'));
  assert.equal(thread.status, 'done');
}

test('a tweak after the playable is done runs Lead triage → the assigned block → QA → Lead review, without Release or QA rounds', async () => {
  const value = harness(['GD', 'Lead Dev', 'Dev', 'Art', 'QA', 'Release']), { thread, sent, auto } = value;
  await toDone(value); const before = sent.length;

  value.tweak('Đổi nút CTA sang màu đỏ');
  assert.equal(thread.qaFailRounds || 0, 0); assert.equal(thread.tweak, true); assert.equal(thread.leadPhase, 'triage');
  assert.match(thread.issues.at(-1).text, /^\[Chỉnh sửa\] Đổi nút CTA/); assert.equal(thread.issues.at(-1).kind, 'tweak');

  await auto.tweak(thread, 'Đổi nút CTA sang màu đỏ');
  assert.deepEqual(sent.slice(before), ['Lead Dev']); assert.deepEqual(value.rounds.at(-1), 'Chỉnh sửa: Đổi nút CTA sang màu đỏ');
  await leadPlans(auto, thread, ['Art']); assert.equal(sent.at(-1), 'Art');
  await finishes(auto, thread, 'Art'); assert.equal(sent.at(-1), 'QA');

  // QA retest xong là sang Lead review luôn: vòng chỉnh sửa không có pha performance.
  await auto.after(thread, 'QA', reply('pass', { retested: [{ id: thread.issues.at(-1).id, evidence: 'verify dev' }] }));
  assert.equal(thread.issues.at(-1).closed, true); assert.equal(thread.leadPhase, 'review'); assert.equal(sent.at(-1), 'Lead Dev');

  await auto.after(thread, 'Lead Dev', reply('pass'));
  assert.equal(thread.status, 'done'); assert.equal(thread.tweak, undefined);
  assert.deepEqual(sent.slice(before), ['Lead Dev', 'Art', 'QA', 'Lead Dev']);
  assert(thread.messages.some(message => /Release không tự chạy/.test(message.text)));
});

test('Art Director reviews a tweak round only when Art, Anim or VFX had a task', async () => {
  let value = harness(['GD', 'Art Director', 'Lead Dev', 'Dev', 'Art', 'QA']);
  value.tweak('Dời nút CTA lên 20px'); await value.auto.tweak(value.thread, 'Dời nút CTA lên 20px');
  await leadPlans(value.auto, value.thread, ['Dev']); await finishes(value.auto, value.thread, 'Dev');
  assert(!value.sent.includes('Art Director')); assert(value.thread.messages.some(message => /không đổi art · bỏ qua/.test(message.text)));

  value = harness(['GD', 'Art Director', 'Lead Dev', 'Dev', 'Art', 'QA']);
  value.tweak('Thay ảnh nền'); await value.auto.tweak(value.thread, 'Thay ảnh nền');
  await leadPlans(value.auto, value.thread, ['Art']); await finishes(value.auto, value.thread, 'Art');
  assert(value.sent.includes('Art Director'));
});

test('a tweak needs text, is refused while the session waits for a decision, and is spelled out in the role prompts', () => {
  const { team, thread, tweak } = harness(['GD', 'Lead Dev', 'Dev', 'QA']);
  assert.throws(() => tweak('  '), /trống/);
  tweak('Đổi chữ CTA'); assert.match(rolePrompt(team, thread, 'Lead Dev', { content: 'x' }).text, /Vòng chỉnh sửa sau bản hoàn thiện[\s\S]*Lead: chỉ giao task nhỏ/);
  assert.match(rolePrompt(team, thread, 'QA', { content: 'x' }).text, /không kiểm performance/);
  thread.status = 'awaiting-decision'; assert.throws(() => tweak('Thêm nữa'), /chờ quyết định/);
});
