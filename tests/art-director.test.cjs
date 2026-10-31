const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { createAutoRun } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const { worker, mergePlan, PIPELINE } = require('../workers.cjs');
const { rolePrompt } = require('../prompt.cjs');
const { roleScope } = require('../permissions.cjs');
const { filesOf } = require('../session-files.cjs');
const graph = require('../flowgraph.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const handoff = (status, summary = status) => fence('handoff', { status, summary });
const tasks = list => fence('tasks', { tasks: list.map(([worker, files]) => ({ worker, task: 'Việc của ' + worker, files })) });
const session = roles => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type }); return { team, id, thread: team.threads[0] }; };
const ROLES = ['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'Art', 'QA'];

function harness() {
  const { team, id, thread } = session(ROLES); const sent = [];
  const phaseOf = (item, label) => label === 'Art Director' ? '@' + (item.adPhase || 'planning') : label === 'Lead Dev' ? '@' + item.leadPhase : '';
  const auto = createAutoRun({
    update: (item, action, payload) => update(team, action, { ...payload, id: item.id }),
    send: async (item, label) => { sent.push(label + phaseOf(item, label)); return true; },
    pump: item => pump(item, async task => { sent.push(task.worker); return true; }, () => {}),
    log: (item, role, text) => item.messages.push({ role, text, time: new Date().toISOString() }),
    changed: () => {}, approve: async () => true, isRunning: () => false
  });
  // Mô phỏng main.cjs: Lead/Art Director xuất khối tasks → mergePlan → dispatch.
  const plan = (planner, text) => { const result = mergePlan(thread, planner, text); assert(result.dispatch, JSON.stringify(result)); thread.dispatch = result.dispatch; };
  const finish = label => { const task = thread.dispatch.find(item => item.worker === label && item.status === 'running'); task.status = 'finished'; task.finishedAt = new Date().toISOString(); };
  return { team, id, thread, sent, auto, plan, finish };
}

test('Art Director: one per session, after UI/UX and before Lead, writes only STYLE/ASSETS/ART/ISSUES and may run shell', () => {
  assert.deepEqual(PIPELINE.slice(0, 4), ['GD', 'UI/UX', 'Art Director', 'Lead Dev']);
  const { team, id, thread } = session(['Lead Dev', 'Art Director', 'UI/UX']);
  assert.deepEqual(thread.flow, ['UI/UX', 'Art Director', 'Lead Dev']); assert.equal(worker(thread, 'Art Director').mode, 'edit');
  assert.throws(() => update(team, 'add-worker', { id, type: 'Art Director' }), /Session đã có Art Director/);
  const files = filesOf({ id: 's', folder: 'E:\\game' }), scope = roleScope('Art Director', files);
  assert.deepEqual(scope.paths, [files.style, files.assets, files.art, files.issues]); assert.equal(scope.bash, true);
  assert.match(files.style, /\.office-desk[\\/]STYLE\.md$/); assert.match(files.art, /[\\/]s[\\/]ART\.md$/);
});

test('default graph: AD approves UI/UX before Lead; AD review runs beside QA; reject goes to Art, issue to Lead triage; Lead review waits for both', () => {
  const { thread } = session(ROLES), edges = graph.defaultGraph(thread).edges.map(edge => `${edge.from}>${edge.to}:${edge.when}`);
  for (const edge of ['UI/UX>Art Director@planning:done', 'Art Director@planning>UI/UX:reject', 'Art Director@planning>Lead Dev@planning:done', 'Dev>Art Director@review:done', 'Art>Art Director@review:done', 'Art Director@review>Art:reject', 'Art Director@review>Lead Dev@triage:issue', 'Art Director@review>Lead Dev@review:pass', 'QA>Lead Dev@review:pass']) assert(edges.includes(edge), edge);
  assert(!edges.includes('Art Director@review>Dev:reject'));
  assert.doesNotThrow(() => graph.validate(thread, graph.defaultGraph(thread)));
});

test('Lead cannot assign Art when an Art Director exists, keeps AD tasks and may not overlap their files', () => {
  const { thread } = session(ROLES);
  thread.dispatch = mergePlan(thread, 'Art Director', tasks([['Art', ['ArtGen/popup/']]])).dispatch;
  assert.deepEqual(thread.dispatch, [{ worker: 'Art', task: 'Việc của Art', files: ['ArtGen/popup/'], status: 'pending', by: 'Art Director' }]);
  assert.match(mergePlan(thread, 'Lead Dev', tasks([['Art', ['x/']]])).problems, /không phải Dev\/VFX/);
  assert.match(mergePlan(thread, 'Lead Dev', tasks([['Dev', ['ArtGen/']]])).problems, /chồng tệp với task đang giao cho Art/);
  const merged = mergePlan(thread, 'Lead Dev', tasks([['Dev', ['src/']]])).dispatch;
  assert.deepEqual(merged.map(task => task.worker + ':' + (task.by || 'lead')), ['Art:Art Director', 'Dev:lead']);
  assert.match(mergePlan(thread, 'Art Director', tasks([['Dev', ['y/']]])).problems, /không phải Art/);
  const solo = session(['Lead Dev', 'Dev', 'Art']).thread; assert(mergePlan(solo, 'Lead Dev', tasks([['Art', ['a/']]])).dispatch, 'without AD the Lead assigns Art');
});

test('auto run: AD rejects the mockup once, approves and assigns Art; Dev and Art run; AD review rejects then passes; Lead review waits for QA and AD', async () => {
  const { thread, sent, auto, plan, finish } = harness();
  await auto.after(thread, 'GD', { text: handoff('done') }); assert.equal(sent.at(-1), 'UI/UX');
  await auto.after(thread, 'UI/UX', { text: handoff('done') }); assert.equal(sent.at(-1), 'Art Director@planning');
  await auto.after(thread, 'Art Director', { text: handoff('reject', 'SCR-2 nút quá nhỏ') });
  assert.equal(sent.at(-1), 'UI/UX'); assert.equal(thread.uiuxReview, 'SCR-2 nút quá nhỏ');
  assert.match(rolePrompt({}, thread, 'UI/UX', { content: 'x' }).body, /Art Director chưa duyệt mockup: SCR-2 nút quá nhỏ/);
  await auto.after(thread, 'UI/UX', { text: handoff('done') }); assert.equal(thread.uiuxReview, undefined); assert.equal(sent.at(-1), 'Art Director@planning');
  const adPlan = handoff('done') + tasks([['Art', ['ArtGen/popup/']]]); plan('Art Director', adPlan);
  await auto.after(thread, 'Art Director', { text: adPlan }, { proposalApplied: true }); assert.equal(sent.at(-1), 'Lead Dev@planning');
  const leadPlan = tasks([['Dev', ['src/']]]); plan('Lead Dev', leadPlan);
  await auto.after(thread, 'Lead Dev', { text: leadPlan }, { proposalApplied: true });
  assert.deepEqual(sent.slice(-2).sort(), ['Art', 'Dev']);
  finish('Dev'); await auto.after(thread, 'Dev', { text: handoff('done') });
  finish('Art'); await auto.after(thread, 'Art', { text: handoff('done') });
  assert.deepEqual(sent.slice(-2).sort(), ['Art Director@review', 'QA']);
  await auto.after(thread, 'QA', { text: handoff('pass') }); await auto.after(thread, 'QA', { text: handoff('pass') });
  assert(!sent.includes('Lead Dev@review'), 'Lead review waits for the Art Director review');
  const redo = handoff('reject', 'ART-1 viền trắng') + tasks([['Art', ['ArtGen/popup/']]]); plan('Art Director', redo);
  await auto.after(thread, 'Art Director', { text: redo }, { proposalApplied: true });
  assert.equal(sent.at(-1), 'Art'); assert(!sent.includes('Lead Dev@review')); assert.equal(thread.adRejects, 1);
  finish('Art'); await auto.after(thread, 'Art', { text: handoff('done') });
  assert(sent.slice(-2).includes('Art Director@review'), sent.join(', '));
  await auto.after(thread, 'QA', { text: handoff('pass') });
  await auto.after(thread, 'Art Director', { text: handoff('pass') });
  assert.equal(sent.at(-1), 'Lead Dev@review');
});

test('AD review issue (visual bug in code) opens an Issue and goes to Lead triage', async () => {
  const { thread, sent, auto, plan, finish } = harness();
  await auto.after(thread, 'GD', { text: handoff('done') }); await auto.after(thread, 'UI/UX', { text: handoff('done') });
  await auto.after(thread, 'Art Director', { text: handoff('done') });
  const leadPlan = tasks([['Dev', ['src/']]]); plan('Lead Dev', leadPlan); await auto.after(thread, 'Lead Dev', { text: leadPlan }, { proposalApplied: true });
  finish('Dev'); await auto.after(thread, 'Dev', { text: handoff('done') });
  await auto.after(thread, 'QA', { text: handoff('pass') }); await auto.after(thread, 'QA', { text: handoff('pass') });
  await auto.after(thread, 'Art Director', { text: handoff('issue', 'Popup lệch 12 px so với UIUX.md') });
  assert.match(thread.issues.at(-1).text, /^\[Visual · Art Director\] Popup lệch 12 px/); assert.equal(sent.at(-1), 'Lead Dev@triage');
});

test('prompts: AD planning approves mockups and writes ART.md specs; review checks style, visual bugs and texture optimisation; Lead and Art see the split', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' }), { thread } = session(ROLES);
  thread.workers.Art.task = 'ART-1'; thread.workers.Art.files = ['ArtGen/'];
  const planning = rolePrompt({}, thread, 'Art Director', { content: 'x', files }).brief;
  assert.match(planning, /^Vai trò Art Director — pha planning\./); assert.match(planning, /Duyệt mockup UI\/UX: vị trí, kích thước item/); assert.match(planning, /mục ART-… gắn SCR-…/);
  assert.match(planning, /decor, hoạ tiết/); assert.match(planning, /quy ước thư mục theo feature/); assert.match(planning, /"status":"reject"/);
  thread.adPhase = 'review'; const review = rolePrompt({}, thread, 'Art Director', { content: 'x', files }).brief;
  assert.match(review, /lệch style/); assert.match(review, /nén texture theo ngân sách STYLE\.md/); assert.match(review, /ảnh trùng nên dùng tài nguyên common/); assert.match(review, /"status":"issue"/);
  assert.match(rolePrompt({}, thread, 'Lead Dev', { content: 'x', files }).brief, /không đưa khối Art vào tasks của bạn/);
  const art = rolePrompt({}, thread, 'Art', { content: 'x', files }).brief; assert.match(art, /STYLE\.md/); assert.match(art, /mục ART-… của task trong .*ART\.md/);
  assert.match(rolePrompt({}, thread, 'UI/UX', { content: 'x', files }).brief, /kích thước từng item \(px, anchor\) để Art Director duyệt/);
});
