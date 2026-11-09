// PO lập kế hoạch sát yêu cầu: năng lực khối trong hướng dẫn, bảng phủ yêu cầu app kiểm, xem lại kế hoạch khi mỗi mốc xong.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const po = require('../po.cjs');
const { initial, update } = require('../team.cjs');
const { createAutoRun } = require('../pipeline.cjs');
const graph = require('../flowgraph.cjs');
const team = value => '```team\n' + JSON.stringify(value) + '\n```';
const R = (id, kind, size, owners, text = 'hạng mục ' + id) => ({ id, text, kind, size, owners });
const plan = (requirements, blocks = ['GD', 'Lead Dev', 'Dev', 'Art', 'QA'], extra = {}) => team({ milestones: [{ title: 'M1', gd: 'làm', blocks, requirements, ...extra }] });
const reject = (...args) => { const problems = []; assert.equal(po.parsePlan(plan(...args), problems), null); return problems.join(); };

test('guide gives PO real capacity numbers, fuller role duties, the estimate steps and the requirements format', () => {
  const text = po.guide();
  assert.match(text, /mỗi khối làm việc .* nhận tối đa một task/); assert.match(text, /task tối đa 8 tệp/); assert.match(text, /tối đa 4 điểm mỗi mốc/);
  assert.match(text, /S = 1 điểm .* M = 2 điểm .* L = 4 điểm/); assert.match(text, /số khối loại đó = tổng điểm \/ 4 làm tròn lên/);
  assert.match(text, /- Art Director: Giữ style và chất lượng hình ảnh của game\. Duyệt mockup UI\/UX/, 'more than the first sentence of each duty');
  assert.match(text, /"requirements":\[\{"id":"R1"/); assert.match(text, /sound \(cần khối Sound\)/);
});

test('a covered plan keeps its requirements, PO.md lists them and GD gets them with its brief', () => {
  const parsed = po.parsePlan(plan([R('R1', 'code', 'L', ['Dev']), R('R2', 'art', 'M', ['Art'], 'icon shop'), R('R3', 'design', 's', ['GD'])]));
  assert.deepEqual(parsed.milestones[0].requirements.map(item => [item.id, item.kind, item.size]), [['R1', 'code', 'L'], ['R2', 'art', 'M'], ['R3', 'design', 'S']]);
  assert.match(po.planMarkdown(parsed), /- R2 \(art, M; Art\): icon shop/);
  assert.match(po.gdTask(parsed.milestones[0]), /^làm\n\nHạng mục của mốc[\s\S]*- R1 \(code, L; Dev\)/);
});

test('requirements: missing type, unknown owner, overload, idle block, duplicate id and bad fields are rejected with a fix', () => {
  const base = [R('R1', 'code', 'M', ['Dev']), R('R2', 'art', 'M', ['Art'])];
  assert.match(reject(undefined), /requirements phải là mảng/);
  assert.match(reject([...base, R('R3', 'sound', 'S', ['Dev'])]), /R3 \(sound\) cần khối Sound trong owners; mốc chưa có Sound, thêm "Sound" vào blocks/);
  assert.match(reject([...base, R('R3', 'code', 'S', ['Dev #2'])]), /R3 giao cho "Dev #2" nhưng khối này không có trong blocks/);
  assert.match(reject([R('R1', 'code', 'L', ['Dev']), R('R2', 'art', 'M', ['Art']), R('R3', 'code', 'M', ['Dev'])]), /Dev nhận 6 điểm việc \(R1 L, R3 M\) > 4.*thêm khối cùng loại/);
  assert.match(reject([R('R1', 'code', 'M', ['Dev'])]), /Art không có hạng mục nào; bỏ khối khỏi blocks/);
  assert.match(reject([...base, R('r1', 'code', 'S', ['Dev'])]), /cần id riêng/);
  assert.match(reject([...base, R('R3', 'music', 'S', ['Dev'])]), /kind phải là code, art/);
  assert.match(reject([...base, R('R3', 'code', 'XL', ['Dev'])]), /size phải là S, M hoặc L/);
  assert.ok(po.parsePlan(plan([R('R1', 'code', 'L', ['Dev', 'Dev #2']), R('R2', 'code', 'L', ['Dev', 'Dev #2']), R('R3', 'art', 'S', ['Art'])], ['GD', 'Dev', 'Dev', 'Art'])), 'points split across owners: 4 each');
});

test('requirements in lanes stay inside one lane', () => {
  const lanes = [{ name: 'Hero', blocks: ['Art', 'Dev'], files: ['hero/'] }, { name: 'Enemy', blocks: ['Art #2', 'Dev #2'], files: ['enemy/'] }];
  const blocks = ['GD', 'Art', 'Art', 'Dev', 'Dev'], ok = [R('R1', 'art', 'M', ['Art']), R('R2', 'code', 'M', ['Dev']), R('R3', 'art', 'M', ['Art #2']), R('R4', 'code', 'M', ['Dev #2'])];
  assert.ok(po.parsePlan(plan(ok, blocks, { lanes })));
  assert.match(reject([...ok.slice(0, 3), R('R4', 'code', 'M', ['Dev', 'Dev #2'])], blocks, { lanes }), /R4 giao cho khối của nhiều nhánh \(Hero, Enemy\)/);
});

// ---- Xem lại kế hoạch khi một mốc xong.
const TWO = team({ milestones: [
  { title: 'A', gd: 'mốc A', blocks: ['GD', 'Dev', 'QA'], requirements: [R('A1', 'code', 'L', ['Dev'])] },
  { title: 'B', gd: 'mốc B', blocks: ['GD', 'Dev', 'QA'], requirements: [R('B1', 'code', 'M', ['Dev'])] }] });
function approved() {
  const store = initial(), id = update(store, 'create', { request: 'x' }); update(store, 'add-worker', { id, type: 'PO' });
  const thread = store.threads.find(item => item.id === id), parsed = po.parsePlan(TWO);
  update(store, 'po-propose', { id, plan: parsed, steps: po.timeline(parsed, thread.flow), previews: [] }); update(store, 'po-approve', { id, busy: [] });
  return { store, id, thread };
}

test('milestone report counts turns, tool limits, stops and new issues since the milestone started', () => {
  const { thread } = approved();
  assert.deepEqual(Object.keys(thread.poPlan.mark).sort(), ['at', 'issues', 'messages', 'round']);
  thread.messages.push({ role: 'Dev', text: 'a' }, { role: 'Dev', text: 'b', maxTurns: true }, { role: 'Tự động', text: 'Dev bị chặn: thiếu tệp' }, { role: 'QA', text: 'c' });
  thread.issues.push({ id: 'i', text: 'nút lệch', closed: false, accepted: true });
  const report = po.milestoneReport(thread, Date.parse(thread.poPlan.mark.at) + 5 * 60000);
  assert.match(report, /Thời gian: 5 phút/); assert.match(report, /Issue mới: 1; còn 1 lỗi được chấp nhận chưa sửa: nút lệch/);
  assert.match(report, /- Dev: 2 lượt, 1 lần chạm giới hạn lượt tool, 1 lần bị chặn\/dừng · hạng mục: A1 L/); assert.match(report, /- QA: 1 lượt/);
  const prompt = po.reviewPrompt(thread.poPlan.plan, 0, report);
  assert.match(prompt, /Mốc 1\/2 vừa xong/); assert.match(prompt, /- Mốc 2: B · khối: GD, Dev, QA · hạng mục: B1 code M → Dev/); assert.match(prompt, /phần tử đầu của milestones là mốc 2/);
});

test('a reviewed plan replaces only later milestones; approve keeps the finished one current and asks to resume', () => {
  const { store, id, thread } = approved();
  const next = po.parsePlan(team({ milestones: [{ title: 'B mới', gd: 'mốc B', blocks: ['GD', 'Dev', 'Dev', 'QA'], requirements: [R('B1', 'code', 'L', ['Dev']), R('B2', 'code', 'M', ['Dev #2'])] }] }));
  const merged = po.mergeRemaining(thread.poPlan.plan, 0, next);
  assert.deepEqual(merged.milestones.map(item => item.title), ['A', 'B mới']);
  update(store, 'po-propose', { id, plan: merged, steps: [], previews: [], startAt: 1 });
  assert.equal(thread.poPlan.status, 'proposed'); assert.equal(thread.poPlan.startAt, 1);
  update(store, 'po-approve', { id, busy: [] });
  assert.equal(thread.poPlan.status, 'approved'); assert.equal(thread.poPlan.current, 0); assert.equal(thread.poPlan.resume, true);
  assert.equal(thread.poPlan.plan.milestones[1].title, 'B mới'); assert.ok(thread.poPlan.mark, 'milestone start mark kept');
});

test('keeping the old plan or rejecting a reviewed plan restores the approved plan', () => {
  const { store, id, thread } = approved(), old = thread.poPlan.plan;
  update(store, 'po-propose', { id, plan: { ...old, summary: 'đổi' }, steps: [], previews: [], startAt: 1 });
  update(store, 'po-keep', { id }); assert.equal(thread.poPlan.plan, old); assert.equal(thread.poPlan.resume, true);
  delete thread.poPlan.resume;
  update(store, 'po-propose', { id, plan: { ...old, summary: 'đổi' }, steps: [], previews: [], startAt: 1 });
  update(store, 'po-reject', { id, reason: 'cần thêm Sound' });
  assert.equal(thread.poPlan.status, 'approved'); assert.equal(thread.poPlan.reviewing, true, 'PO reviews again'); assert.equal(thread.poProblems, 'cần thêm Sound');
  assert.throws(() => update(store, 'po-keep', { id }), /Không có đề xuất chỉnh/);
});

test('auto run: reaching Hoàn tất with a later milestone waits for the PO review, then resumes from GD', async () => {
  const { store, thread } = approved(), sent = [], reviews = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(store, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label); return true; }, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false,
    reviewMilestone: item => { if (item.poPlan.reviewed === item.poPlan.current) return false; item.poPlan.reviewed = item.poPlan.current; reviews.push(item.poPlan.current); return true; },
    nextMilestone: item => update(store, 'po-next', { id: item.id, busy: [] }) });
  thread.workers.Dev.idle = true; thread.workers.QA.idle = true;
  await auto.enable(thread, 'test'); graph.resetRun(thread); graph.stateOf(thread, 'PO').status = 'done';
  await auto.runStage(thread, 'GD'); await auto.after(thread, 'GD', { text: '```handoff\n{"status":"done","summary":"ok"}\n```' });
  assert.deepEqual(reviews, [0]); assert.equal(thread.poPlan.current, 0, 'next milestone waits'); assert.deepEqual(sent, ['GD']);
  assert.ok(thread.messages.some(message => /PO xem lại kế hoạch các mốc sau/.test(message.text)));
  await auto.resumeMilestone(thread);
  assert.equal(thread.poPlan.current, 1); assert.deepEqual(sent, ['GD', 'GD']);
});

// ---- Mốc có việc Art mà người giao không giao task: không cho mốc trôi qua (session BaseTD 021b1d4b mốc 1 trôi qua không có ảnh nào).
function artSession() {
  const store = initial(), id = update(store, 'create', { request: 'x' }); update(store, 'add-worker', { id, type: 'PO' });
  const thread = store.threads.find(item => item.id === id);
  const parsed = po.parsePlan(team({ milestones: [{ title: 'Nhân vật', gd: 'vẽ', blocks: ['GD', 'Art Director', 'Art', 'Art', 'QA'], requirements: [R('H1', 'art', 'L', ['Art']), R('L1', 'art', 'L', ['Art #2'])] }] }));
  update(store, 'po-propose', { id, plan: parsed, steps: po.timeline(parsed, thread.flow), previews: [] }); update(store, 'po-approve', { id, busy: [] });
  const sent = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(store, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label); return true; }, pump: async item => { for (const task of item.dispatch || []) if (task.status === 'queued') sent.push(task.worker); }, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false });
  return { thread, sent, auto };
}
const handoff = (status, summary = status) => ({ text: '```handoff\n' + JSON.stringify({ status, summary }) + '\n```' });

test('Art Director giving Art nothing in a milestone with art items stops once with the reason; running it again lets it pass', async () => {
  const { thread, sent, auto } = artSession();
  await auto.enable(thread, 'test'); graph.resetRun(thread); graph.stateOf(thread, 'PO').status = 'done';
  await auto.runStage(thread, 'GD'); await auto.after(thread, 'GD', handoff('done'));
  assert.equal(sent.at(-1), 'Art Director');
  await auto.after(thread, 'Art Director', handoff('done', 'chờ ảnh C34 từ ChatGPT, inbox trống'));
  assert.equal(graph.stateOf(thread, 'Art Director@planning').status, 'blocked');
  assert.match(thread.messages.at(-1).text, /không giao task cho Art, Art #2, dù mốc 1 có việc Art\/Anim \(chờ ảnh C34 từ ChatGPT, inbox trống\)/);
  assert.equal(sent.includes('Art'), false, 'Art is not skipped silently');
  await auto.runStage(thread, 'Art Director'); assert.equal(sent.at(-1), 'Art Director', 'rerun the same planning step');
  await auto.after(thread, 'Art Director', handoff('done', 'mọi ảnh đã có'));
  assert.equal(graph.stateOf(thread, 'Art Director@planning').status, 'done', 'second time the user confirmed, app lets it pass');
});

test('the guard names only art owners left without a task', async () => {
  const { thread, auto } = artSession();
  await auto.enable(thread, 'test'); graph.resetRun(thread); graph.stateOf(thread, 'PO').status = 'done';
  await auto.runStage(thread, 'GD'); await auto.after(thread, 'GD', handoff('done'));
  thread.dispatch = [{ worker: 'Art', task: 'C34', files: ['hero/'], status: 'pending', by: 'Art Director' }];
  await auto.after(thread, 'Art Director', { text: handoff('done').text + '\n```tasks\n{}\n```' }, { proposalApplied: true });
  assert.match(thread.messages.at(-1).text, /không giao task cho Art #2,/);
  assert.doesNotMatch(thread.messages.at(-1).text, /cho Art, /);
});

test('in lanes, one task for any block of the lane satisfies the art guard', async () => {
  const store = initial(), id = update(store, 'create', { request: 'x' }); update(store, 'add-worker', { id, type: 'PO' });
  const thread = store.threads.find(item => item.id === id);
  const parsed = po.parsePlan(team({ milestones: [{ title: 'M1', gd: 'vẽ', blocks: ['GD', 'Art Director', 'Art', 'Art', 'Art', 'QA'],
    lanes: [{ name: 'Hero', blocks: ['Art', 'Art #2'], files: ['hero/'] }, { name: 'Pet', blocks: ['Art #3'], files: ['pet/'] }],
    requirements: [R('H1', 'art', 'L', ['Art']), R('H2', 'art', 'L', ['Art #2']), R('P1', 'art', 'L', ['Art #3'])] }] }));
  update(store, 'po-propose', { id, plan: parsed, steps: po.timeline(parsed, thread.flow), previews: [] }); update(store, 'po-approve', { id, busy: [] });
  const auto = createAutoRun({ update: (item, action, payload) => update(store, action, { ...payload, id: item.id }), send: async () => true, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false });
  await auto.enable(thread, 'test'); graph.resetRun(thread); graph.stateOf(thread, 'PO').status = 'done';
  await auto.runStage(thread, 'GD'); await auto.after(thread, 'GD', handoff('done'));
  thread.dispatch = [{ worker: 'Art', task: 'C34 rồi C35', files: ['hero/'], status: 'pending', by: 'Art Director' }];
  await auto.after(thread, 'Art Director', { text: handoff('done').text + '\n```tasks\n{}\n```' }, { proposalApplied: true });
  assert.match(thread.messages.at(-1).text, /không giao task cho Art #3,/, 'only the Pet lane has nobody');
  thread.dispatch.push({ worker: 'Art #3', task: 'C61', files: ['pet/'], status: 'pending', by: 'Art Director' }); delete thread.artGuard;
  graph.stateOf(thread, 'Art Director@planning').status = 'running';
  await auto.after(thread, 'Art Director', { text: handoff('done').text + '\n```tasks\n{}\n```' }, { proposalApplied: true });
  assert.equal(graph.stateOf(thread, 'Art Director@planning').status, 'done', 'Art #2 without its own task is fine: Art carries the Hero lane');
});
