const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { createAutoRun } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const { taskPlan, worker, PIPELINE } = require('../workers.cjs');
const { rolePrompt } = require('../prompt.cjs');
const { roleScope } = require('../permissions.cjs');
const { filesOf } = require('../session-files.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const reply = status => ({ text: fence('handoff', { status, summary: status }) });
const session = roles => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type }); return { team, id, thread: team.threads[0] }; };

test('VFX is a selectable role placed after Dev and before QA, with Sonnet by default', () => {
  assert.deepEqual(PIPELINE, ['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'Sound', 'QA']);
  const { team, id, thread } = session(['QA', 'VFX', 'Dev', 'Lead Dev', 'GD']);
  assert.deepEqual(thread.flow, ['GD', 'Lead Dev', 'Dev', 'VFX', 'QA']);
  assert.equal(worker(thread, 'VFX').model, 'sonnet'); assert.equal(update(team, 'add-worker', { id, type: 'VFX' }), 'VFX #2');
});

test('Lead can assign tasks to VFX with its own files; VFX files may not overlap a Dev', () => {
  const { thread } = session(['Lead Dev', 'Dev', 'VFX']);
  const plan = tasks => taskPlan(fence('tasks', { tasks }), thread);
  assert.deepEqual(plan([{ worker: 'Dev', task: 'Gameplay', files: ['Assets/Scripts/'] }, { worker: 'VFX', task: 'Hit spark', files: ['Assets/VFX/', 'Assets/Shaders/Spark.shader'] }]).map(task => task.worker), ['Dev', 'VFX']);
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: ['Assets/'] }, { worker: 'VFX', task: 'y', files: ['Assets/VFX/'] }]), null);
});

test('QA waits for both Dev and VFX of the round, then a Lead review reject can send work back to VFX', async () => {
  const { team, thread } = session(['GD', 'Lead Dev', 'Dev', 'VFX', 'QA']); const sent = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label); return true; }, pump: item => pump(item, async task => { sent.push(task.worker); return true; }, () => {}), log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false });
  const finish = label => { const task = thread.dispatch.find(item => item.worker === label && item.status === 'running'); task.status = 'finished'; task.finishedAt = new Date().toISOString(); };
  await auto.after(thread, 'GD', reply('done'));
  thread.dispatch = taskPlan(fence('tasks', { tasks: [{ worker: 'Dev', task: 'a', files: ['src/'] }, { worker: 'VFX', task: 'b', files: ['vfx/'] }] }), thread).map(task => ({ ...task, status: 'queued' }));
  await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  assert.deepEqual(sent.slice(-2), ['Dev', 'VFX'], 'Dev and VFX start in parallel');
  finish('Dev'); await auto.after(thread, 'Dev', reply('done')); assert.notEqual(thread.flow[thread.stage], 'QA', 'QA waits for VFX');
  finish('VFX'); await auto.after(thread, 'VFX', reply('done')); assert.equal(thread.flow[thread.stage], 'QA');
  await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass'));
  await auto.after(thread, 'Lead Dev', { text: fence('handoff', { status: 'reject', summary: 'Spark overdraw' }) + fence('tasks', { tasks: [{ worker: 'VFX', task: 'Giảm overdraw', files: ['vfx/'] }] }) });
  assert.deepEqual(thread.dispatch.map(task => task.worker), ['VFX']); assert.equal(sent.at(-1), 'VFX');
});

test('VFX prompt: only the VFX part of GDD, its files, Editor scripts over hand-edited YAML, and a visual check request', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['GD', 'Lead Dev', 'Dev', 'VFX', 'QA'], workers: { VFX: { type: 'VFX', task: 'Hit spark', files: ['Assets/VFX/'] } }, messages: [{ role: 'Bạn', text: 'Yêu cầu' }, { role: 'GD', text: 'Thiết kế dài' }], attachments: [] };
  const text = rolePrompt({}, thread, 'VFX', { content: 'NOW', resumed: false, files }).text;
  assert.match(text, /chỉ mục VFX trong .*GDD\.md\. Chỉ được sửa: Assets\/VFX\//); assert.match(text, /script Editor thay vì sửa YAML/); assert.match(text, /cần kiểm tra trực quan gì/);
  assert.doesNotMatch(text, /Bối cảnh session|Thiết kế dài|Đội hiện có/);
  const scope = roleScope('VFX', files, ['Assets/VFX/'], 'E:\\game'); assert.equal(scope.label, 'VFX chỉ sửa các tệp Lead giao (và MISSING_SOUNDS.md)'); assert(scope.paths.includes(files.missingSounds));
});
