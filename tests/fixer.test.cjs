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
  await auto.after(thread, 'GD', { text: '```handoff\n{"status":"blocked","summary":"thiếu tài liệu"}\n```' });
  assert.equal(incidents.length, 1); assert.equal(incidents[0].label, 'GD'); assert.match(incidents[0].reason, /thiếu tài liệu/);
  assert.equal(graph.stateOf(thread, 'GD').status, 'blocked');
  await auto.after(thread, 'Fixer', { text: 'xong' }); assert.equal(incidents.length, 1);
});
