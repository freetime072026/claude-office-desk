const { test } = require('node:test');
const assert = require('node:assert/strict');
const po = require('../po.cjs');
const { initial, update } = require('../team.cjs');
const { buildPrompt } = require('../prompt.cjs');
const { filesOf } = require('../session-files.cjs');
const { teamFence: fence } = require('./plan-helper.cjs');
const PLAN = {
  summary: 'Game TD hai mốc',
  milestones: [
    { title: 'Core', goal: 'Chơi được 1 màn', gd: 'Thiết kế vòng chơi cơ bản', blocks: ['GD', 'UI/UX', 'Lead Dev', 'Dev', 'Dev', 'QA'], reasons: 'cần UI và 2 Dev' },
    { title: 'Art', goal: 'Đủ hình', gd: 'Thiết kế art và hiệu ứng', blocks: ['GD', 'Lead Dev', 'Dev', 'Art', 'QA', 'Release'] }
  ],
  responsibilities: { Dev: 'Chỉ làm gameplay', 'Dev #2': 'Chỉ làm UI', Art: 'Sprite 64px' }
};

test('parsePlan labels repeated types, sorts blocks and rejects invalid plans with a reason', () => {
  const plan = po.parsePlan(fence(PLAN));
  assert.deepEqual(plan.milestones[0].blocks, ['GD', 'UI/UX', 'Lead Dev', 'Dev', 'Dev #2', 'QA']);
  assert.deepEqual(plan.milestones[1].blocks, ['GD', 'Lead Dev', 'Dev', 'Art', 'QA', 'Release']);
  for (const [bad, reason] of [
    [{ milestones: [] }, /1–8 mốc/],
    [{ milestones: [{ gd: 'x', blocks: ['Dev'] }] }, /cần GD/],
    [{ milestones: [{ gd: 'x', blocks: ['GD', 'Wizard'] }] }, /không phải loại khối/],
    [{ milestones: [{ gd: 'x', blocks: ['GD', 'Lead Dev', 'Lead Dev'] }] }, /chỉ có một khối/],
    [{ milestones: [{ gd: '', blocks: ['GD'] }] }, /gd/],
    [{ milestones: [{ gd: 'x', blocks: ['GD'] }], responsibilities: { QA: 'x' } }, /không có trong kế hoạch/]
  ]) { const problems = []; assert.equal(po.parsePlan(fence(bad), problems), null); assert.match(problems.join(), reason); }
  const problems = []; assert.equal(po.parsePlan('không có', problems), null); assert.match(problems[0], /không có khối team/);
});
test('timeline: later blocks are added at their milestone, unused blocks idle or removed', () => {
  const steps = po.timeline(po.parsePlan(fence(PLAN)), ['PO']);
  assert.deepEqual(steps[0].add, ['GD', 'UI/UX', 'Lead Dev', 'Dev', 'Dev #2', 'QA']);
  assert.deepEqual({ add: steps[1].add, remove: steps[1].remove, idle: steps[1].idle }, { add: ['Art', 'Release'], remove: ['UI/UX', 'Dev #2'], idle: [] });
  assert.deepEqual(steps[1].flow, ['PO', 'GD', 'Lead Dev', 'Dev', 'Art', 'QA', 'Release']);
  const idlePlan = po.parsePlan(fence({ milestones: [{ gd: 'a', blocks: ['GD', 'Dev'] }, { gd: 'b', blocks: ['GD'] }, { gd: 'c', blocks: ['GD', 'Dev'] }] }));
  assert.deepEqual(po.timeline(idlePlan, ['PO'])[1].idle, ['Dev']);
});
test('approve applies milestone 1 (blocks, responsibilities, GD task); next milestone adds/removes without asking again', () => {
  const team = initial(), id = update(team, 'create', { request: 'Làm game TD' }); update(team, 'add-worker', { id, type: 'PO' });
  const thread = team.threads.find(item => item.id === id), plan = po.parsePlan(fence(PLAN));
  update(team, 'po-propose', { id, plan, steps: po.timeline(plan, thread.flow), previews: [] });
  assert.equal(thread.poPlan.status, 'proposed'); assert.deepEqual(thread.flow, ['PO']); // chưa đổi đội trước khi duyệt
  assert.throws(() => update(team, 'po-approve', { id, busy: ['GD'] }), /đang chạy/);
  update(team, 'po-approve', { id, busy: [] });
  assert.deepEqual(thread.flow, ['PO', 'GD', 'UI/UX', 'Lead Dev', 'Dev', 'Dev #2', 'QA']);
  assert.match(thread.workers.GD.task, /^Thiết kế vòng chơi cơ bản\n\nHạng mục của mốc[\s\S]*- T1-Dev \(code, M; Dev\)/, 'GD gets the milestone items with the brief');
  assert.equal(thread.roleConfig['Dev #2'].instructions, 'Chỉ làm UI'); assert.equal(thread.roleConfig.Dev.instructions, 'Chỉ làm gameplay');
  assert.equal(update(team, 'po-next', { id, busy: [] }), true);
  assert.deepEqual(thread.flow, ['PO', 'GD', 'Lead Dev', 'Dev', 'Art', 'QA', 'Release']);
  assert.match(thread.workers.GD.task, /^Thiết kế art và hiệu ứng\n/); assert.equal(thread.roleConfig.Art.instructions, 'Sprite 64px');
  assert.equal(thread.poPlan.current, 1); assert.equal(update(team, 'po-next', { id, busy: [] }), false);
  assert.match(po.planMarkdown(thread.poPlan.plan, 1), /## Mốc 2: Art \(đang chạy\)[\s\S]*### Giao GD/);
});
test('reject keeps the team, stores the reason for the next PO turn and restores an earlier approved plan', () => {
  const team = initial(), id = update(team, 'create', { request: 'x' }); update(team, 'add-worker', { id, type: 'PO' });
  const thread = team.threads.find(item => item.id === id), plan = po.parsePlan(fence(PLAN));
  update(team, 'po-propose', { id, plan, steps: [], previews: [] }); update(team, 'po-reject', { id, reason: 'bỏ Release' });
  assert.equal(thread.poPlan, undefined); assert.equal(thread.poProblems, 'bỏ Release'); assert.deepEqual(thread.flow, ['PO']);
  update(team, 'po-propose', { id, plan, steps: [], previews: [] }); update(team, 'po-approve', { id, busy: [] });
  update(team, 'po-propose', { id, plan, steps: [], previews: [] }); update(team, 'po-reject', { id });
  assert.equal(thread.poPlan.status, 'approved'); assert.equal(thread.poPlan.current, 0);
});
test('PO prompt lists block types and the team format; GD with a plan reads PO.md', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const text = buildPrompt({ label: 'PO', type: 'PO', files, content: 'x', poProblems: 'thiếu GD' }).text;
  assert.match(text, /nhãn team/); assert.match(text, /Art Director:/); assert.match(text, /thiếu GD/);
  assert.match(buildPrompt({ label: 'GD', type: 'GD', files, content: 'x', poPlan: true }).text, /PO\.md/);
  assert.doesNotMatch(buildPrompt({ label: 'GD', type: 'GD', files, content: 'x' }).text, /PO\.md/);
});
test('auto run: idle blocks are skipped and reaching Hoàn tất starts the next milestone from GD', async () => {
  const { createAutoRun } = require('../pipeline.cjs'), graph = require('../flowgraph.cjs');
  const team = initial(), id = update(team, 'create', { request: 'x' }); update(team, 'add-worker', { id, type: 'PO' });
  const thread = team.threads.find(item => item.id === id), sent = [];
  const plan = po.parsePlan(fence({ milestones: [{ title: 'A', gd: 'mốc A', blocks: ['GD', 'QA'] }, { title: 'B', gd: 'mốc B', blocks: ['GD', 'QA'] }] }));
  update(team, 'po-propose', { id, plan, steps: po.timeline(plan, thread.flow), previews: [] }); update(team, 'po-approve', { id, busy: [] });
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label); return true; }, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false, nextMilestone: item => update(team, 'po-next', { id: item.id, busy: [] }) });
  thread.workers.QA.idle = true; // QA tạm nghỉ ở mốc này
  await auto.enable(thread, 'test'); graph.resetRun(thread); graph.stateOf(thread, 'PO').status = 'done';
  await auto.runStage(thread, 'GD'); assert.deepEqual(sent, ['GD']);
  await auto.after(thread, 'GD', { text: '```handoff\n{"status":"done","summary":"ok"}\n```' });
  assert.ok(thread.messages.some(message => /QA tạm nghỉ ở mốc này/.test(message.text))); assert.equal(thread.workers.QA.idle, undefined); // mốc B dùng lại QA
  assert.equal(thread.poPlan.current, 1); assert.match(thread.workers.GD.task, /^mốc B/); assert.deepEqual(sent, ['GD', 'GD']);
  assert.equal(thread.status, 'working'); assert.ok(thread.messages.some(message => /Sang mốc 2\/2/.test(message.text)));
});
test('parsePlan reads product (game or a preset key) and rejects unknown products', () => {
  assert.equal(po.parsePlan(fence({ ...PLAN, product: 'PLA' })).product, 'pla');
  assert.equal(po.parsePlan(fence({ ...PLAN, product: 'game' })).product, 'game');
  assert.equal(po.parsePlan(fence(PLAN)).product, undefined);
  const problems = []; assert.equal(po.parsePlan(fence({ ...PLAN, product: 'web' }), problems), null); assert.match(problems[0], /product phải là "game" hoặc "pla"/);
  assert.match(po.planMarkdown(po.parsePlan(fence({ ...PLAN, product: 'pla' }))), /Loại sản phẩm: Playable Ads \(PLA\)/);
});
test('approving a PLA plan sets the PLA preset: blocks of every milestone get the PLA purpose, guard and PO responsibility', () => {
  const { roleContext } = require('../prompt.cjs');
  const team = initial(), id = update(team, 'create', { request: 'Làm playable' }); update(team, 'add-worker', { id, type: 'PO' });
  const thread = team.threads.find(item => item.id === id), plan = po.parsePlan(fence({ ...PLAN, product: 'pla' }));
  update(team, 'po-propose', { id, plan, steps: [], previews: [] }); update(team, 'po-approve', { id, busy: [] });
  assert.equal(thread.preset, 'PLA'); assert.equal(thread.workers.PO.purpose, undefined);
  for (const label of thread.flow.filter(label => label !== 'PO')) assert.equal(thread.workers[label].purpose, 'pla', label);
  const gd = roleContext(team, thread, 'GD'); assert.match(gd.responsibility, /PLA Producer/); assert.match(gd.instructions, /playable ad/);
  const dev2 = roleContext(team, thread, 'Dev #2'); assert.match(dev2.instructions, /playable ad[\s\S]*Chỉ làm UI/);
  update(team, 'po-next', { id, busy: [] }); // mốc 2 thêm Art, Release
  assert.equal(thread.workers.Art.purpose, 'pla'); assert.equal(thread.workers.Release.purpose, 'pla');
  assert.match(roleContext(team, thread, 'Release').responsibility, /network/);
  update(team, 'add-worker', { id, type: 'QA' }); assert.equal(thread.workers['QA #2'].purpose, 'pla');
});
test('a plan without product keeps the session preset; a game plan clears the preset and block purposes', () => {
  const team = initial(), id = update(team, 'create', { request: 'x' }), thread = team.threads.find(item => item.id === id);
  update(team, 'apply-preset', { id, preset: 'PLA', engine: 'phaser' }); update(team, 'add-worker', { id, type: 'PO' });
  update(team, 'po-propose', { id, plan: po.parsePlan(fence(PLAN)), steps: [], previews: [] }); update(team, 'po-approve', { id, busy: [] });
  assert.equal(thread.preset, 'PLA'); assert.equal(thread.engine, 'phaser'); assert.equal(thread.workers['Dev #2'].purpose, 'pla');
  update(team, 'po-propose', { id, plan: po.parsePlan(fence({ ...PLAN, product: 'game' })), steps: [], previews: [] }); update(team, 'po-approve', { id, busy: [] });
  assert.equal(thread.preset, undefined); assert.equal(thread.engine, undefined);
  for (const label of thread.flow) assert.equal(thread.workers[label]?.purpose, undefined, label);
});
test('PO prompt explains the product field with PLA responsibilities and the current session product', () => {
  const files = filesOf({ id: 's', folder: 'E:\game' });
  const game = buildPrompt({ label: 'PO', type: 'PO', files, content: 'x' }).text;
  assert.match(game, /"product":"game" hoặc "pla"/); assert.match(game, /ghi "product":"pla"/); assert.match(game, /GD: Đóng vai PLA Producer/);
  assert.match(game, /Loại sản phẩm hiện tại của session: Game/); assert.match(game, /Lead Dev: Project đã có pipeline \(template-pla: CLAUDE\.md, scripts\//);
  assert.match(buildPrompt({ label: 'PO', type: 'PO', files, content: 'x', preset: 'PLA' }).text, /Loại sản phẩm hiện tại của session: Playable Ads \(PLA\) \("pla"\)/);
});
test('choosing the product in the PO panel applies it now, fixes the PO guide and wins over the plan', () => {
  const team = initial(), id = update(team, 'create', { request: 'x' }), thread = team.threads.find(item => item.id === id);
  assert.throws(() => update(team, 'po-product', { id, product: 'pla' }), /chưa có khối PO/);
  update(team, 'add-worker', { id, type: 'PO' }); update(team, 'add-worker', { id, type: 'GD' });
  assert.throws(() => update(team, 'po-product', { id, product: 'web' }), /Loại sản phẩm không hợp lệ/);
  update(team, 'po-product', { id, product: 'pla' });
  assert.equal(thread.poProduct, 'pla'); assert.equal(thread.preset, 'PLA'); assert.equal(thread.workers.GD.purpose, 'pla');
  const files = filesOf({ id: 's', folder: 'E:\game' });
  const text = buildPrompt({ label: 'PO', type: 'PO', files, content: 'x', preset: 'PLA', poProduct: 'pla' }).text;
  assert.match(text, /Người dùng đã chọn loại sản phẩm: Playable Ads \(PLA\)/); assert.doesNotMatch(text, /Nếu project là/);
  assert.match(text, /\nCác khối GD, UI\/UX/); assert.match(text, /\{"product":"pla","summary"/);
  update(team, 'po-propose', { id, plan: po.parsePlan(fence({ ...PLAN, product: 'game' })), steps: [], previews: [] }); update(team, 'po-approve', { id, busy: [] });
  assert.equal(thread.preset, 'PLA'); assert.equal(thread.workers['Dev #2'].purpose, 'pla'); // lựa chọn của bạn thắng product của PO
  update(team, 'po-product', { id, product: '' }); assert.equal(thread.poProduct, undefined); assert.equal(thread.preset, 'PLA');
  update(team, 'po-product', { id, product: 'game' }); assert.equal(thread.preset, undefined); assert.equal(thread.workers.GD.purpose, undefined);
  assert.doesNotMatch(buildPrompt({ label: 'PO', type: 'PO', files, content: 'x', poProduct: 'game' }).text, /PLA Producer/);
});
