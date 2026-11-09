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

test('lane graph: each lane is a chain with its own QA and triage; Lead review waits for every lane', () => {
  const { thread } = setup(), g = thread.graph, edge = (from, to, when = 'done') => g.edges.some(item => item.from === from && item.to === to && item.when === when);
  assert.ok(edge('Lead Dev@planning', 'Art') && edge('Art', 'Dev') && edge('Dev', 'QA~Hero') && edge('QA~Hero', 'Lead Dev@triage~Hero', 'issue') && edge('Lead Dev@triage~Hero', 'Art'));
  assert.ok(edge('Lead Dev@planning', 'Art #2') && edge('Art #2', 'Dev #2') && edge('Dev #2', 'QA~Enemy'));
  assert.ok(edge('QA~Hero', 'Lead Dev@review', 'pass') && edge('QA~Enemy', 'Lead Dev@review', 'pass') && edge('Lead Dev@review', 'Art', 'reject') && edge('Lead Dev@review', 'Art #2', 'reject'));
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

test('both lanes pass their own QA before Lead review runs once', async () => {
  const ctx = setup(), { thread, sent, auto } = ctx; await start(ctx);
  for (const label of ['Art', 'Dev']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  await auto.after(thread, 'QA', reply('pass')); assert.equal(sent.at(-1), 'QA~Hero', 'functional pass → performance check of the lane');
  await auto.after(thread, 'QA', reply('pass'));
  assert.equal(thread.laneState.Hero.qaPhase, 'performance'); assert.equal(status(thread, 'QA~Hero'), 'done');
  assert.equal(sent.includes('Lead Dev@review'), false, 'review waits for Enemy');
  for (const label of ['Art #2', 'Dev #2']) { finish(thread, label); await auto.after(thread, label, reply('done')); }
  assert.equal(sent.at(-1), 'QA~Enemy');
  await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass'));
  assert.equal(sent.at(-1), 'Lead Dev@review');
});

test('Lead review sending only Hero back: Enemy blocks are skipped and its checks pass without running', async () => {
  const ctx = setup(), { thread, sent, auto } = ctx; await start(ctx);
  for (const label of ['Art', 'Dev', 'Art #2', 'Dev #2']) { finish(thread, label); await auto.after(thread, label, reply('done')); if (label.startsWith('Dev')) { await auto.after(thread, 'QA', reply('pass')); await auto.after(thread, 'QA', reply('pass')); } }
  assert.equal(sent.at(-1), 'Lead Dev@review');
  const count = sent.filter(item => item === 'QA~Enemy').length;
  await auto.after(thread, 'Lead Dev', { text: reply('reject').text + '\n' + tasks([['Dev', 'hero/code/']]) });
  assert.equal(status(thread, 'Art #2'), 'skipped'); assert.equal(status(thread, 'Dev #2'), 'skipped');
  assert.equal(status(thread, 'QA~Enemy'), 'skipped'); assert.equal(sent.filter(item => item === 'QA~Enemy').length, count, 'Enemy not re-checked');
  assert.equal(sent.at(-1), 'Dev');
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

test('tasks for a lane block must stay inside the lane folders', () => {
  const { thread } = setup(), problems = [];
  assert.equal(taskPlan(tasks([['Dev', 'enemy/code/']]), thread, problems), null);
  assert.match(problems[0], /Dev thuộc nhánh Hero: tệp "enemy\/code\/" nằm ngoài thư mục của nhánh \(hero\/\)/);
  assert.ok(taskPlan(tasks([['Dev', 'hero']]), thread), 'the lane root itself is inside the lane');
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
