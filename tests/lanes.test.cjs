// Nhánh song song do PO chia (docs/superpowers/specs/2026-11-09-po-lanes-design.md).
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { createAutoRun } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const graph = require('../flowgraph.cjs');
const po = require('../po.cjs');
const { taskPlan, mergePlan, QA_ROUND_LIMIT } = require('../workers.cjs');
const { rolePrompt } = require('../prompt.cjs');
const { withRequirements } = require('./plan-helper.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(name === 'team' ? withRequirements(value) : value) + '\n```';
const reply = (status, extra = {}) => ({ text: fence('handoff', { status, summary: status, ...extra }) });
const LANES = [{ name: 'Hero', blocks: ['Art', 'Dev'], files: ['hero/'] }, { name: 'Enemy', blocks: ['Art #2', 'Dev #2'], files: ['enemy/'], penpot: 'Enemy' }];

function setup(roles = ['GD', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']) {
  const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type });
  const thread = team.threads[0], sent = [];
  thread.lanes = structuredClone(LANES); graph.syncGraph(thread);
  // Nhãn gửi: khối, pha Lead và nhánh của lượt (pipeline ghi thread.runLane trước khi gửi).
  const name = (item, label) => label + (label === 'Lead Dev' ? '@' + item.leadPhase : '') + (item.runLane?.[label] ? '~' + item.runLane[label] : '');
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(name(item, label)); return true; }, pump: item => pump(item, async task => { sent.push(task.worker); return true; }, () => {}), log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false });
  return { team, id, thread, sent, auto };
}
const tasks = owners => fence('tasks', { tasks: owners.map(([worker, file]) => ({ worker, task: 'Làm ' + worker, files: [file] })) });
const plan = (thread, owners) => { thread.dispatch = taskPlan(tasks(owners), thread).map(task => ({ ...task, status: 'pending' })); };
const finish = (thread, label) => { const task = thread.dispatch.find(item => item.worker === label && item.status !== 'finished'); task.status = 'finished'; task.finishedAt = new Date().toISOString(); };
const status = (thread, id) => graph.stateOf(thread, id).status;
const ALL = [['Art', 'hero/art/'], ['Dev', 'hero/code/'], ['Art #2', 'enemy/art/'], ['Dev #2', 'enemy/code/']];
async function start(ctx) {
  await ctx.auto.after(ctx.thread, 'GD', reply('done'));
  plan(ctx.thread, ALL); await ctx.auto.after(ctx.thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
}

test('PO lanes: a valid plan keeps lanes per milestone and PO.md lists them', () => {
  const plan = po.parsePlan(fence('team', { milestones: [{ title: 'M1', gd: 'làm', blocks: ['GD', 'Lead Dev', 'Art', 'Dev', 'Art', 'Dev', 'QA'], lanes: [
    { name: 'Hero', blocks: ['Art', 'Dev'], files: ['Assets\\hero\\'], penpot: 'Hero' }, { name: 'Enemy', blocks: ['Art #2', 'Dev #2'], files: ['Assets/enemy/'] }] }] }));
  assert.deepEqual(plan.milestones[0].lanes, [{ name: 'Hero', blocks: ['Art', 'Dev'], files: ['Assets/hero/'], penpot: 'Hero' }, { name: 'Enemy', blocks: ['Art #2', 'Dev #2'], files: ['Assets/enemy/'] }]);
  assert.match(po.planMarkdown(plan), /\*\*Hero\*\*: Art → Dev · thư mục: Assets\/hero\/ · Penpot: page "Hero"/);
  assert.match(po.guide(), /"lanes"/);
});

test('PO lanes: each broken rule is rejected with a reason PO can act on', () => {
  const blocks = ['GD', 'Art', 'Dev', 'Art', 'Dev'];
  const reject = (lanes, folder = '') => { const problems = []; assert.equal(po.parsePlan(fence('team', { milestones: [{ gd: 'x', blocks, lanes }] }), problems, { folder }), null); return problems.join(); };
  const ok = (name, more = {}) => ({ name, blocks: name === 'A' ? ['Art', 'Dev'] : ['Art #2', 'Dev #2'], files: [name.toLowerCase() + '/'], ...more });
  assert.match(reject([ok('A')]), /2–4 nhánh/);
  assert.match(reject([ok('A'), { ...ok('B'), name: 'a' }]), /trùng tên/);
  assert.match(reject([ok('A'), { ...ok('B'), blocks: ['Art #2', 'Dev #3'] }]), /"Dev #3" không nằm trong blocks/);
  assert.match(reject([ok('A'), { ...ok('B'), blocks: ['Art #2', 'Dev #2', 'GD'] }]), /"GD" không phải khối làm việc/);
  assert.match(reject([ok('A'), { ...ok('B'), blocks: ['Art #2', 'Dev'] }]), /"Dev" nằm ở cả nhánh/);
  assert.match(reject([ok('A'), { ...ok('B'), blocks: ['Art #2'] }]), /Dev #2 chưa thuộc nhánh nào/);
  assert.match(reject([ok('A'), { ...ok('B'), files: ['a/sub/'] }]), /chồng với nhánh/);
  assert.match(reject([ok('A', { files: ['src'] }), ok('B', { files: ['C:/game/src/x/'] })], 'C:/game'), /chồng với nhánh/);
  assert.match(reject([ok('A', { penpot: 'P' }), ok('B', { penpot: 'p' })]), /cùng page Penpot/);
});

test('approving a plan puts the milestone lanes on the session and builds lane nodes', () => {
  const team = initial(); const id = update(team, 'create', { request: 'Game' }); update(team, 'add-worker', { id, type: 'PO' });
  const thread = team.threads[0], plan = po.parsePlan(fence('team', { milestones: [
    { gd: 'm1', blocks: ['GD', 'Lead Dev', 'Art', 'Dev', 'Art', 'Dev', 'QA'], lanes: LANES.map(({ name, blocks, files }) => ({ name, blocks, files })) },
    { gd: 'm2', blocks: ['GD', 'Lead Dev', 'Dev', 'QA'] }] }));
  update(team, 'po-propose', { id, plan, steps: po.timeline(plan, thread.flow), previews: [] }); update(team, 'po-approve', { id, busy: [] });
  assert.deepEqual(thread.lanes.map(lane => lane.name), ['Hero', 'Enemy']);
  assert.ok(thread.graph.nodes.some(node => node.id === 'QA~Enemy' && node.lane === 'Enemy'));
  update(team, 'po-next', { id, busy: [] });
  assert.equal(thread.lanes, undefined); assert.equal(thread.graph.nodes.some(node => node.lane), false, 'a milestone without lanes runs as before');
});

test('lane graph: each lane is a chain with its own QA, triage and Lead review; the end waits for every lane', () => {
  const { thread } = setup(), g = thread.graph, edge = (from, to, when = 'done') => g.edges.some(item => item.from === from && item.to === to && item.when === when);
  assert.ok(edge('Lead Dev@planning', 'Art') && edge('Art', 'Dev') && edge('Dev', 'QA~Hero') && edge('QA~Hero', 'Lead Dev@triage~Hero', 'issue') && edge('Lead Dev@triage~Hero', 'Art'));
  assert.ok(edge('Lead Dev@planning', 'Art #2') && edge('Art #2', 'Dev #2') && edge('Dev #2', 'QA~Enemy'));
  assert.ok(edge('QA~Hero', 'Lead Dev@review~Hero', 'pass') && edge('QA~Enemy', 'Lead Dev@review~Enemy', 'pass') && edge('Lead Dev@review~Hero', 'Art', 'reject') && edge('Lead Dev@review~Enemy', 'Art #2', 'reject'));
  assert.ok(edge('Lead Dev@review~Hero', '@end', 'pass') && edge('Lead Dev@review~Enemy', '@end', 'pass'));
  assert.equal(g.nodes.some(node => node.id === 'Lead Dev@review'), false, 'no shared Lead review');
  assert.equal(g.edges.some(item => item.from === 'Lead Dev@review~Hero' && item.to === 'Art #2'), false);
  assert.equal(g.edges.some(item => item.from === 'Lead Dev@planning' && ['Dev', 'Dev #2'].includes(item.to)), false, 'Dev waits for the Art of its lane');
  assert.equal(g.edges.some(item => item.from === 'QA~Hero' && /Enemy|#2/.test(item.to)), false, 'Hero checks never reach Enemy');
  assert.doesNotThrow(() => graph.validate(thread, g));
  assert.throws(() => graph.validate(thread, { nodes: [{ id: 'QA~Boss', label: 'QA', lane: 'Boss', x: 0, y: 0 }], edges: [] }), /nhánh "Boss"/);
  assert.throws(() => graph.validate(thread, { nodes: [{ id: 'Dev~Hero', label: 'Dev', lane: 'Hero', x: 0, y: 0 }], edges: [] }), /không chia theo nhánh/);
  assert.equal(graph.nodeLabel(g.nodes.find(node => node.id === 'Lead Dev@triage~Hero')), 'Lead Dev · triage · Hero');
});

test('a finished lane is checked at once, and its issue goes back only to that lane', async () => {
  const ctx = setup(), { thread, sent, auto } = ctx; await start(ctx);
  assert.deepEqual(sent.slice(-2), ['Art', 'Art #2'], 'lane heads start in parallel; Devs wait for their Art');
  finish(thread, 'Art'); await auto.after(thread, 'Art', reply('done')); assert.equal(sent.at(-1), 'Dev');
  finish(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(sent.at(-1), 'QA~Hero', 'Hero is checked while Enemy still works'); assert.equal(status(thread, 'Art #2'), 'running');
  await auto.after(thread, 'QA', reply('issue'));
  assert.equal(thread.issues[0].lane, 'Hero'); assert.match(thread.issues[0].text, /^\[Nhánh Hero\]/);
  assert.equal(thread.laneState.Hero.qaFailRounds, 1); assert.equal(thread.qaFailRounds || 0, 0); assert.equal(thread.status, 'working');
  assert.equal(sent.at(-1), 'Lead Dev@triage~Hero');
  // Triage của Hero chỉ thay task của nhánh Hero; task đang chạy của Enemy giữ nguyên.
  const merged = mergePlan(thread, 'Lead Dev', tasks([['Dev', 'hero/code/']]));
  assert.ok(merged.dispatch, merged.problems || merged.blocked);
  assert.ok(merged.dispatch.some(task => task.worker === 'Art #2' && task.status !== 'finished') && merged.dispatch.some(task => task.worker === 'Dev #2'), 'Enemy tasks kept');
  assert.match(mergePlan(thread, 'Lead Dev', tasks([['Dev #2', 'enemy/code/']])).problems, /nhánh Hero: chỉ giao cho Art, Dev/);
  thread.dispatch = merged.dispatch; await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  assert.equal(status(thread, 'Art'), 'skipped'); assert.equal(sent.at(-1), 'Dev');
  assert.equal(status(thread, 'QA~Enemy'), 'idle');
});

test('each lane gets its own Lead review as soon as its checks pass; the end waits for every lane review', async () => {
  const ctx = setup(), { thread, sent, auto } = ctx; await start(ctx);
  for (const label of ['Art', 'Dev']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  await auto.after(thread, 'QA', reply('pass')); assert.equal(sent.at(-1), 'QA~Hero', 'functional pass → performance check of the lane');
  await auto.after(thread, 'QA', reply('pass'));
  assert.equal(thread.laneState.Hero.qaPhase, 'performance'); assert.equal(status(thread, 'QA~Hero'), 'done');
  assert.equal(sent.at(-1), 'Lead Dev@review~Hero', 'Hero is reviewed while Enemy still works'); assert.equal(status(thread, 'Art #2'), 'running');
  await auto.after(thread, 'Lead Dev', reply('pass'), { lane: 'Hero' });
  assert.equal(status(thread, 'Lead Dev@review~Hero'), 'done'); assert.notEqual(thread.status, 'done', 'Enemy still open');
  for (const label of ['Art #2', 'Dev #2']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass'));
  assert.equal(sent.at(-1), 'Lead Dev@review~Enemy');
  await auto.after(thread, 'Lead Dev', reply('pass'), { lane: 'Enemy' });
  assert.equal(thread.status, 'done', 'both lane reviews passed');
});

test('a lane Lead review sending Hero back reruns only Hero; Enemy tasks and review stay as they are', async () => {
  const ctx = setup(), { thread, sent, auto } = ctx; await start(ctx);
  for (const label of ['Art', 'Dev']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass'));
  assert.equal(sent.at(-1), 'Lead Dev@review~Hero');
  await auto.after(thread, 'Lead Dev', { text: reply('reject').text + '\n' + tasks([['Dev', 'hero/code/']]) }, { lane: 'Hero' });
  assert.equal(status(thread, 'Lead Dev@review~Hero'), 'done'); assert.equal(graph.stateOf(thread, 'Lead Dev@review~Hero').outcome, 'reject');
  assert.equal(sent.at(-1), 'Dev', 'Hero head (Art) has no task → skipped → Dev reworks');
  assert.ok(thread.dispatch.some(task => task.worker === 'Art #2' && task.status === 'running'), 'Enemy task kept');
  assert.ok(thread.dispatch.some(task => task.worker === 'Dev #2' && task.status === 'pending'));
  assert.equal(status(thread, 'Lead Dev@review~Enemy'), 'idle');
});

test('a lane out of fix rounds stops only itself; /role start gives it one more round', async () => {
  const ctx = setup(), { thread, sent, auto } = ctx; await start(ctx);
  for (const label of ['Art', 'Dev']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  (thread.laneState ||= {}).Hero = { qaFailRounds: QA_ROUND_LIMIT - 1 };
  await auto.after(thread, 'QA', reply('issue'));
  assert.equal(status(thread, 'Lead Dev@triage~Hero'), 'blocked'); assert.equal(thread.status === 'awaiting-decision', false, 'session is not halted');
  assert.match(thread.messages.at(-1).text, /Nhánh Hero: QA báo lỗi 3\/3/);
  finish(thread, 'Art #2'); await auto.after(thread, 'Art #2', reply('done')); assert.equal(sent.at(-1), 'Dev #2', 'Enemy keeps going');
  await auto.runStage(thread, 'Lead Dev');
  assert.equal(thread.laneState.Hero.qaFailRounds, QA_ROUND_LIMIT - 1); assert.equal(sent.at(-1), 'Lead Dev@triage~Hero');
});

test('tasks for a lane block may not touch the folders of a busy lane; idle lanes and shared places are fine', () => {
  const { thread } = setup(), problems = [];
  assert.ok(taskPlan(tasks([['Dev', 'enemy/code/']]), thread), 'Enemy is idle: allowed (the app still stops two runs writing one folder)');
  graph.stateOf(thread, 'Art #2').status = 'running';
  assert.equal(taskPlan(tasks([['Dev', 'enemy/code/']]), thread, problems), null);
  assert.match(problems[0], /Dev thuộc nhánh Hero: tệp "enemy\/code\/" nằm trong thư mục của nhánh Enemy \(enemy\/\) đang có bước chạy hoặc chờ/);
  assert.ok(taskPlan(tasks([['Dev', 'hero']]), thread), 'the lane root itself is inside the lane');
  assert.ok(taskPlan(tasks([['Art', 'art/inbox/C42/']]), thread), 'an inbox folder no lane owns is shared');
});

test('prompts: lane blocks know their lane, lane checks see only their issues, planners see every lane', () => {
  const { team, thread } = setup();
  thread.issues = [{ id: 'a', text: '[Nhánh Hero] lỗi A', lane: 'Hero', closed: false }, { id: 'b', text: '[Nhánh Enemy] lỗi B', lane: 'Enemy', closed: false }];
  const art2 = rolePrompt(team, thread, 'Art #2', { content: 'x' });
  assert.match(art2.brief, /Bạn thuộc nhánh Enemy \(Art #2 → Dev #2\).*enemy\/.*page "Enemy"/);
  thread.runLane = { QA: 'Hero' }; thread.laneState = { Hero: { qaFailRounds: 2, qaPhase: 'performance' } };
  const qa = rolePrompt(team, thread, 'QA', { content: 'x' });
  assert.match(qa.body, /Lượt này chỉ cho nhánh Hero: Art → Dev/); assert.match(qa.body, /lỗi A/); assert.doesNotMatch(qa.body, /lỗi B/);
  thread.leadPhase = 'planning'; delete thread.runLane;
  const lead = rolePrompt(team, thread, 'Lead Dev', { content: 'x' });
  assert.match(lead.body, /Nhánh song song[\s\S]*- Hero: Art → Dev · thư mục hero\/[\s\S]*- Enemy: Art #2 → Dev #2/);
});

test('Art Director review per lane: reject goes to that lane art, counted per lane; issue lands in that lane triage', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { thread, sent, auto } = ctx, g = thread.graph;
  const edge = (from, to, when) => g.edges.some(item => item.from === from && item.to === to && item.when === when);
  assert.ok(edge('Art Director@review~Hero', 'Art', 'reject') && edge('Dev', 'Art Director@review~Hero', 'reject') && edge('Art Director@review~Hero', 'Lead Dev@triage~Hero', 'issue'));
  assert.equal(edge('Art Director@review~Hero', 'Art #2', 'reject'), false);
  await auto.after(thread, 'GD', reply('done')); await auto.after(thread, 'Art Director', reply('done'));
  plan(thread, ALL); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  for (const label of ['Art', 'Dev']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  assert.ok(sent.includes('QA~Hero')); assert.equal(sent.at(-1), 'Art Director~Hero');
  thread.dispatch.push({ worker: 'Art', task: 'vẽ lại', files: ['hero/art/'], status: 'pending', by: 'Art Director' });
  await auto.after(thread, 'Art Director', { text: reply('reject').text + '\n```tasks\n{}\n```' }, { proposalApplied: true });
  assert.equal(thread.laneState.Hero.adRejects, 1); assert.equal(thread.adRejects, undefined);
  await auto.after(thread, 'QA', reply('pass'));
  thread.runLane = { 'Art Director': 'Hero' }; graph.stateOf(thread, 'Art Director@review~Hero').status = 'running';
  await auto.after(thread, 'Art Director', reply('issue'));
  assert.equal(thread.issues.at(-1).lane, 'Hero'); assert.match(thread.issues.at(-1).text, /\[Nhánh Hero\] \[Visual · Art Director\]/);
});

test('blocks chained in one lane may share the lane folders; reserved tasks of the same lane do not block either', () => {
  const { thread } = setup(), problems = [];
  const both = taskPlan(tasks([['Art', 'hero/'], ['Dev', 'hero/']]), thread, problems);
  assert.ok(both, problems.join()); assert.equal(both.length, 2);
  const merged = mergePlan({ ...thread, dispatch: [{ worker: 'Art', task: 'x', files: ['hero/'], status: 'pending', by: 'Art Director' }] }, 'Lead Dev', tasks([['Dev', 'hero/']]));
  assert.ok(merged.dispatch, merged.problems);
});

// ---- Art Director dùng chung cho các nhánh: sự cố, Fixer và chạy lại theo từng nhánh.
const fixer = require('../fixer.cjs');
test('Fixer attempts are counted per lane: one lane using them up leaves the others their own', () => {
  const thread = { round: 2 };
  fixer.count(thread, 'Art Director'); fixer.count(thread, 'Art Director');
  assert.equal(fixer.canFix(thread, 'Art Director'), false, 'planning step used both');
  assert.equal(fixer.canFix(thread, 'Art Director', 'Hero'), true);
  fixer.count(thread, 'Art Director', 'Hero'); fixer.count(thread, 'Art Director', 'Hero');
  assert.equal(fixer.canFix(thread, 'Art Director', 'Hero'), false); assert.equal(fixer.canFix(thread, 'Art Director', 'Pet'), true);
  assert.match(fixer.brief({ ...thread, messages: [], flow: [] }, { label: 'Art Director', lane: 'Pet', kind: 'bị chặn', reason: 'x' }), /^Sự cố ở khối Art Director \(lần 1\/2 trong vòng này\): bị chặn\. Bước của nhánh Pet/);
});

test('a blocked lane step reports its lane; /role start reruns every blocked lane step, a lane fix only that lane', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { thread, sent } = ctx, incidents = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(ctx.team, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label + (item.runLane?.[label] ? '~' + item.runLane[label] : '')); return true; }, pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false, incident: (item, value) => incidents.push(value) });
  await auto.enable(thread, 'test');
  graph.stateOf(thread, 'Art Director@review~Hero').status = 'running';
  await auto.after(thread, 'Art Director', { text: 'không có handoff' });
  assert.equal(status(thread, 'Art Director@review~Hero'), 'blocked'); assert.deepEqual(incidents.map(item => [item.label, item.lane]), [['Art Director', 'Hero']]);
  graph.finish(thread, 'Art Director@review~Enemy', 'blocked');
  sent.length = 0; await auto.runStage(thread, 'Art Director', 'Enemy');
  assert.deepEqual(sent, ['Art Director~Enemy'], 'Fixer verdict for Enemy reruns only Enemy');
  graph.finish(thread, 'Art Director@review~Enemy', 'blocked');
  sent.length = 0; await auto.runStage(thread, 'Art Director');
  assert.deepEqual(sent.sort(), ['Art Director~Enemy', 'Art Director~Hero'], '/role start reruns both blocked lanes');
});

test('session note files (.office-desk/<session>/ART_PROMPTS_<lane>.md) may be given to a lane block', () => {
  const { thread } = setup(); thread.folder = __dirname; const problems = [];
  const plan = taskPlan(tasks([['Art', 'hero/']]).replace('"files":["hero/"]', `"files":["hero/",".office-desk/${thread.id}/ART_PROMPTS_Hero.md"]`), thread, problems);
  assert.ok(plan, problems.join());
  assert.ok(taskPlan(tasks([['Art', '.office-desk/ART_LESSONS.md']]), thread, []), 'shared note files outside every lane are fine');
});

test('a lane step may hand work to another lane only while that lane is idle', () => {
  const { thread } = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']); graph.resetRun(thread);
  const enemyWork = tasks([['Art #2', 'enemy/art/next/']]);
  thread.dispatch = [{ worker: 'Art', task: 'Hero đang chờ ảnh', files: ['hero/'], status: 'blocked', by: 'Art Director' }];
  const idle = mergePlan(thread, 'Art Director', enemyWork, 'Hero');
  assert.ok(idle.dispatch, idle.problems); assert.ok(idle.dispatch.some(task => task.worker === 'Art' && task.status === 'blocked'), 'own lane task kept');
  graph.stateOf(thread, 'Art #2').status = 'running';
  assert.match(mergePlan(thread, 'Art Director', enemyWork, 'Hero').problems, /nhánh Enemy đang có bước chạy hoặc chờ/);
});

test('plan rejection reasons and art sent back stay in their own lane prompts', () => {
  const { team, thread } = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']);
  thread.laneState = { Hero: { adPlanProblems: 'Art #2 ngoài nhánh Hero' } };
  thread.artRework = [{ worker: 'Dev', reason: 'ui-mismatch', art: ['ART-1'], summary: 'nút lệch', lane: 'Hero' }];
  thread.adPhase = 'review';
  thread.runLane = { 'Art Director': 'Hero' };
  const hero = rolePrompt(team, thread, 'Art Director', { content: 'x' }).body;
  assert.match(hero, /Task Art trước bị app từ chối: Art #2 ngoài nhánh Hero/); assert.match(hero, /nút lệch/);
  thread.runLane = { 'Art Director': 'Enemy' };
  const enemy = rolePrompt(team, thread, 'Art Director', { content: 'x' }).body;
  assert.doesNotMatch(enemy, /bị app từ chối/); assert.doesNotMatch(enemy, /nút lệch/);
});

test('art sent back in one lane: another lane review passing does not wake the waiting block; its own review does', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { thread, auto } = ctx; await start(ctx);
  finish(thread, 'Art'); await auto.after(thread, 'Art', reply('done'));
  const devTask = thread.dispatch.find(item => item.worker === 'Dev');
  devTask.status = 'pending'; devTask.artReject = { reason: 'ui-mismatch', art: ['ART-1'], summary: 'nút lệch' };
  await auto.after(thread, 'Dev', reply('reject'));
  assert.equal(thread.artRework[0].lane, 'Hero'); assert.equal(thread.laneState.Hero.artReworks, 1); assert.equal(devTask.artRouted, true);
  graph.stateOf(thread, 'Art Director@review~Enemy').status = 'running';
  await auto.after(thread, 'Art Director', reply('pass'));
  assert.equal(devTask.artRouted, true, 'Enemy review leaves the Hero Dev waiting'); assert.equal(thread.artRework.length, 1);
  graph.stateOf(thread, 'Art Director@review~Hero').status = 'running';
  await auto.after(thread, 'Art Director', reply('pass'));
  assert.equal(devTask.artRouted, undefined, 'Hero review wakes it'); assert.equal(thread.artRework, undefined);
});

test('a lane Lead review sending work back restarts that lane QA at the functional pass only', async () => {
  const ctx = setup(), { thread, auto } = ctx; await start(ctx);
  for (const label of ['Art', 'Dev', 'Art #2', 'Dev #2']) { finish(thread, label); await auto.after(thread, label, reply('done')); if (label.startsWith('Dev')) { await auto.after(thread, 'QA', reply('pass'), { lane: label === 'Dev' ? 'Hero' : 'Enemy' }); await auto.after(thread, 'QA', reply('pass'), { lane: label === 'Dev' ? 'Hero' : 'Enemy' }); } }
  assert.equal(thread.laneState.Hero.qaPhase, 'performance');
  await auto.after(thread, 'Lead Dev', { text: reply('reject').text + '\n' + tasks([['Dev', 'hero/code/']]) }, { lane: 'Hero' });
  assert.equal(thread.laneState.Hero.qaPhase, undefined); assert.equal(thread.laneState.Hero.reviewRejects, 1);
  assert.equal(thread.laneState.Enemy.qaPhase, 'performance', 'Enemy keeps its passed QA'); assert.equal(thread.reviewRejects, undefined);
});

test('a lane review that passes and hands the next chat to its Art sends the lane back to work, not to Lead review', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { thread, sent, auto } = ctx;
  await auto.after(thread, 'GD', reply('done')); await auto.after(thread, 'Art Director', reply('done'));
  plan(thread, ALL); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  finish(thread, 'Art #2'); await auto.after(thread, 'Art #2', reply('done'));
  finish(thread, 'Dev #2'); await auto.after(thread, 'Dev #2', reply('done'));
  graph.stateOf(thread, 'Art Director@review~Enemy').status = 'running';
  thread.dispatch.push({ worker: 'Art #2', task: 'chat kế tiếp', files: ['enemy/art/'], status: 'pending', by: 'Art Director' });
  await auto.after(thread, 'Art Director', { text: reply('pass').text + '\n```tasks\n{}\n```' }, { proposalApplied: true });
  assert.equal(status(thread, 'Art Director@review~Enemy'), 'done'); assert.equal(graph.stateOf(thread, 'Art Director@review~Enemy').outcome, 'reject');
  assert.equal(sent.at(-1), 'Art #2', 'Art #2 starts the next chat'); assert.equal(thread.laneState?.Enemy?.adRejects, undefined, 'not counted as a rejection');
});

test('Art Director and Lead Dev run the steps of different lanes at the same time; QA still takes lanes one by one', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { team, thread } = ctx, sent = [], running = new Set();
  const key = (label, lane) => label + (lane ? '~' + lane : '');
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), pump: async () => {}, log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true,
    send: async (item, label, text, extra = {}) => { sent.push([label, extra.lane, extra.phase, extra.parallel]); running.add(key(label, extra.parallel ? extra.lane : '')); return true; },
    isRunning: (item, label, lane = '') => lane ? running.has(key(label, lane)) || running.has(label) : [...running].some(item2 => item2 === label || item2.startsWith(label + '~')) });
  await auto.enable(thread, 'test');
  for (const lane of ['Hero', 'Enemy']) graph.queue(thread, `Art Director@review~${lane}`);
  graph.queue(thread, 'QA~Hero'); graph.queue(thread, 'QA~Enemy');
  await auto.runStage(thread);
  assert.deepEqual(sent.filter(item => item[0] === 'Art Director'), [['Art Director', 'Hero', 'review', true], ['Art Director', 'Enemy', 'review', true]], 'both lane reviews start together, each told its lane and phase');
  assert.deepEqual(sent.filter(item => item[0] === 'QA').map(item => item[1]), ['Hero'], 'QA runs one lane at a time');
  assert.equal(status(thread, 'QA~Enemy'), 'queued');
  running.delete('Art Director~Hero');
  await auto.after(thread, 'Art Director', reply('pass'), { lane: 'Hero' });
  assert.equal(status(thread, 'Art Director@review~Hero'), 'done'); assert.equal(status(thread, 'Art Director@review~Enemy'), 'running', 'the Enemy run is untouched');
});

test('a step waiting for the user is not rerun by the app on its own; /role start reruns it', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { thread, sent, auto } = ctx;
  await auto.enable(thread, 'test');
  graph.stateOf(thread, 'Art Director@review~Hero').status = 'running';
  await auto.after(thread, 'Art Director', reply('blocked'), { lane: 'Hero' });
  assert.equal(status(thread, 'Art Director@review~Hero'), 'blocked'); assert.equal(graph.stateOf(thread, 'Art Director@review~Hero').waitUser, true);
  assert.equal(thread.flow[thread.stage], 'Art Director', 'it is the current step');
  sent.length = 0; await auto.runStage(thread);
  assert.deepEqual(sent, [], 'the stuck-flow watcher (runStage without a block) leaves it waiting');
  await auto.runStage(thread, 'Art Director');
  assert.deepEqual(sent, ['Art Director~Hero']); assert.equal(graph.stateOf(thread, 'Art Director@review~Hero').waitUser, undefined);
});

test('a lane Lead review may send work back twice; the third rejection stops only that lane for the user', async () => {
  const ctx = setup(), { thread, auto } = ctx; await start(ctx);
  const passHero = async () => { finish(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done')); await auto.after(thread, 'QA', reply('pass'), { lane: 'Hero' }); await auto.after(thread, 'QA', reply('pass'), { lane: 'Hero' }); };
  finish(thread, 'Art'); await auto.after(thread, 'Art', reply('done')); await passHero();
  for (const round of [1, 2]) {
    await auto.after(thread, 'Lead Dev', { text: reply('reject').text + '\n' + tasks([['Dev', 'hero/code/']]) }, { lane: 'Hero' });
    assert.equal(thread.laneState.Hero.reviewRejects, round); assert.equal(graph.stateOf(thread, 'Lead Dev@review~Hero').outcome, 'reject');
    await passHero();
  }
  await auto.after(thread, 'Lead Dev', { text: reply('reject').text + '\n' + tasks([['Dev', 'hero/code/']]) }, { lane: 'Hero' });
  assert.equal(status(thread, 'Lead Dev@review~Hero'), 'blocked'); assert.equal(graph.stateOf(thread, 'Lead Dev@review~Hero').waitUser, true);
  assert.match(thread.messages.at(-1).text, /Review nhánh Hero vẫn không đạt sau 2 lần sửa/);
  assert.equal(status(thread, 'Art #2'), 'running', 'Enemy keeps working');
});

test('telling Art Director by hand to give a finished lane its next chats keeps other lanes tasks and starts that lane at once', async () => {
  const ctx = setup(['GD', 'Art Director', 'Lead Dev', 'Art', 'Art', 'Dev', 'Dev', 'QA']), { thread, sent, auto } = ctx;
  await auto.after(thread, 'GD', reply('done')); await auto.after(thread, 'Art Director', reply('done'));
  plan(thread, ALL); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  // Hero xong phần của mốc; Enemy đang chờ ảnh (task Art Director giao, bị chặn).
  for (const label of ['Art', 'Dev']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  const enemy = thread.dispatch.find(task => task.worker === 'Art #2'); Object.assign(enemy, { by: 'Art Director', status: 'blocked', error: 'Chờ ảnh' });
  delete thread.runLane;
  const merged = mergePlan(thread, 'Art Director', tasks([['Art', 'hero/art/next/']]));
  assert.ok(merged.dispatch, merged.problems || merged.blocked);
  assert.ok(merged.dispatch.some(task => task.worker === 'Art #2' && task.status === 'blocked'), 'the Enemy task waiting for images is kept');
  thread.dispatch = merged.dispatch;
  await auto.after(thread, 'Art Director', { text: reply('done').text }, { proposalApplied: true });
  assert.equal(sent.at(-1), 'Art', 'Hero Art starts its next chat right away');
  assert.match(thread.messages.findLast(message => message.role === 'Tự động').text, /Art Director giao thêm cho Art · chạy luôn|Bắt đầu|Art/);
});

test('Fixer: a target copied with the lane or phase still names the block; the brief keeps the block name apart and counts right', () => {
  const flow = ['Art', 'Art Director', 'Lead Dev', 'Fixer'];
  const verdict = target => fixer.parseFix('```fix\n' + JSON.stringify({ cause: 'c', fix: 'f', action: 'continue', target }) + '\n```', flow, []);
  assert.equal(verdict('Art Director · nhánh Hero').target, 'Art Director');
  assert.equal(verdict('Art Director~Pet').target, 'Art Director');
  assert.equal(verdict('Lead Dev · review · Lính').target, 'Lead Dev');
  assert.equal(verdict('Art').target, 'Art', '"Art" is not read as "Art Director"');
  assert.equal(verdict('Wizard'), null);
  const thread = { round: 1, messages: [], flow }; fixer.count(thread, 'Art Director', 'Hero');
  const brief = fixer.brief(thread, { label: 'Art Director', lane: 'Hero', kind: 'bị chặn', reason: 'x' });
  assert.match(brief, /^Sự cố ở khối Art Director \(lần 1\/2 trong vòng này\): bị chặn\. Bước của nhánh Hero \(target vẫn ghi đúng tên khối "Art Director"/);
});

test('restarting a block with no step on the graph (Fixer) does nothing instead of failing', async () => {
  const ctx = setup(['GD', 'Lead Dev', 'Art', 'Dev', 'QA', 'Fixer']), { thread, auto } = ctx;
  await auto.enable(thread, 'test');
  await assert.doesNotReject(auto.runStage(thread, 'Fixer'));
});
