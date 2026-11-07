const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { createAutoRun } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const graph = require('../flowgraph.cjs');
const { taskPlan } = require('../workers.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const reply = status => ({ text: fence('handoff', { status, summary: status }) });
function setup(roles) {
  const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type });
  const thread = team.threads[0], sent = [];
  const auto = createAutoRun({ update: (item, action, payload) => update(team, action, { ...payload, id: item.id }), send: async (item, label) => { sent.push(label + (item.leadPhase && label === 'Lead Dev' ? '@' + item.leadPhase : '')); return true; }, pump: item => pump(item, async task => { sent.push(task.worker); return true; }, () => {}), log: (item, role, text) => item.messages.push({ role, text }), changed: () => {}, approve: async () => true, isRunning: () => false });
  return { team, id, thread, sent, auto };
}
const plan = (thread, owners) => { thread.dispatch = taskPlan(fence('tasks', { tasks: owners.map(worker => ({ worker, task: 'Làm ' + worker, files: ['src/' + worker.replace(/\W/g, '') + '/'] })) }), thread).map(task => ({ ...task, status: 'pending' })); };
const finishDev = (thread, label) => { const task = thread.dispatch.find(item => item.worker === label); task.status = 'finished'; task.finishedAt = new Date().toISOString(); };
const status = (thread, id) => graph.stateOf(thread, id).status;

test('default graph: GD → UI/UX → Lead planning → Devs in parallel → QA; issue loop through triage; review → done', () => {
  const { thread } = setup(['GD', 'UI/UX', 'Lead Dev', 'Dev', 'Dev', 'VFX', 'QA']);
  const g = thread.graph, edge = (from, to, when) => g.edges.some(item => item.from === from && item.to === to && item.when === when);
  assert.deepEqual(g.nodes.map(node => node.id), ['GD', 'UI/UX', 'Lead Dev@planning', 'Dev', 'Dev #2', 'VFX', 'QA', 'Lead Dev@triage', 'Lead Dev@review', '@end']);
  assert.ok(edge('GD', 'UI/UX', 'done') && edge('UI/UX', 'Lead Dev@planning', 'done'));
  for (const dev of ['Dev', 'Dev #2', 'VFX']) assert.ok(edge('Lead Dev@planning', dev, 'done') && edge(dev, 'QA', 'done') && edge('Lead Dev@triage', dev, 'done') && edge('Lead Dev@review', dev, 'reject'), dev);
  assert.ok(edge('QA', 'Lead Dev@triage', 'issue') && edge('QA', 'Lead Dev@review', 'pass') && edge('Lead Dev@review', '@end', 'pass'));
  assert.equal(g.edges.some(item => item.from === 'Dev' && item.to === 'Dev #2'), false, 'Devs are not chained');
  assert.ok(new Set(g.nodes.filter(node => ['Dev', 'Dev #2', 'VFX'].includes(node.id)).map(node => node.x)).size === 1, 'Devs share one column');
});

test('Lead assigns only 2 of 3 Devs: they run in parallel, Dev #3 is skipped, QA starts only after both finish', async () => {
  const { thread, sent, auto } = setup(['GD', 'Lead Dev', 'Dev', 'Dev', 'Dev', 'QA']);
  await auto.after(thread, 'GD', reply('done')); assert.deepEqual(sent, ['Lead Dev@planning']);
  plan(thread, ['Dev', 'Dev #2']); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  assert.deepEqual(sent.slice(1), ['Dev', 'Dev #2']); assert.equal(status(thread, 'Dev #3'), 'skipped');
  finishDev(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  assert.equal(status(thread, 'QA'), 'queued'); assert.equal(sent.includes('QA'), false, 'QA waits for Dev #2');
  finishDev(thread, 'Dev #2'); await auto.after(thread, 'Dev #2', reply('done'));
  assert.equal(sent.at(-1), 'QA'); assert.equal(status(thread, 'QA'), 'running');
});

test('custom edges with conditions: QA issue goes straight back to Dev, QA pass ends the session', async () => {
  const { team, id, thread, sent, auto } = setup(['GD', 'Dev', 'QA']);
  update(team, 'graph-save', { id, graph: { nodes: thread.graph.nodes.filter(node => ['GD', 'Dev', 'QA', '@end'].includes(node.id)), edges: [{ from: 'GD', to: 'Dev', when: 'done' }, { from: 'Dev', to: 'QA', when: 'done' }, { from: 'QA', to: 'Dev', when: 'issue' }, { from: 'QA', to: '@end', when: 'pass' }] } });
  assert.equal(thread.graph.custom, true);
  await auto.after(thread, 'GD', reply('done')); assert.deepEqual(sent, ['Dev']);
  finishDev(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done')); assert.equal(sent.at(-1), 'QA');
  await auto.after(thread, 'QA', reply('issue')); assert.equal(sent.at(-1), 'Dev', 'issue edge back to Dev (fresh task, no Lead)');
  finishDev(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done'));
  const issue = thread.issues[0].id; await auto.after(thread, 'QA', { text: fence('handoff', { status: 'pass', retested: [{ id: issue, evidence: 'ok' }] }) });
  await auto.after(thread, 'QA', reply('pass')); assert.equal(thread.status, 'done');
});

test('loop graph (Lead review pass → GD): GD after the review opens a new round and drops leftover blocked tasks', async () => {
  const { team, id, thread, sent, auto } = setup(['GD', 'Lead Dev', 'Dev']);
  const nodes = thread.graph.nodes.filter(node => ['GD', 'Lead Dev@planning', 'Dev', 'Lead Dev@review', '@end'].includes(node.id));
  update(team, 'graph-save', { id, graph: { nodes, edges: [{ from: 'GD', to: 'Lead Dev@planning', when: 'done' }, { from: 'Lead Dev@planning', to: 'Dev', when: 'done' }, { from: 'Dev', to: 'Lead Dev@review', when: 'always' }, { from: 'Lead Dev@review', to: 'GD', when: 'pass' }] } });
  await auto.after(thread, 'GD', reply('done'));
  plan(thread, ['Dev']); await auto.after(thread, 'Lead Dev', { text: '' }, { proposalApplied: true });
  const task = thread.dispatch[0]; task.status = 'blocked'; task.error = 'Chạm giới hạn số lượt tool';
  await auto.after(thread, 'Dev', { text: 'hết lượt', error: true });
  graph.stateOf(thread, 'Lead Dev@review').status = 'running'; thread.leadPhase = 'review';
  await auto.after(thread, 'Lead Dev', reply('pass')); assert.equal(sent.at(-1), 'GD');
  const round = thread.round || 1;
  await auto.after(thread, 'GD', reply('done'));
  assert.deepEqual(thread.dispatch, [], 'blocked Dev task of the finished round is gone');
  assert.equal(thread.round, round + 1); assert.equal(sent.at(-1), 'Lead Dev@planning');
});

test('a node waits for every connected node that is still pending, but not for sources that never ran', async () => {
  const { team, id, thread, sent, auto } = setup(['GD', 'UI/UX', 'Dev', 'QA']);
  update(team, 'graph-save', { id, graph: { nodes: thread.graph.nodes, edges: [{ from: 'GD', to: 'UI/UX' }, { from: 'GD', to: 'Dev' }, { from: 'UI/UX', to: 'QA' }, { from: 'Dev', to: 'QA' }, { from: 'QA', to: '@end', when: 'always' }] } });
  await auto.after(thread, 'GD', reply('done')); assert.deepEqual(sent.sort(), ['Dev', 'UI/UX']);
  await auto.after(thread, 'UI/UX', reply('done')); assert.equal(status(thread, 'QA'), 'queued');
  finishDev(thread, 'Dev'); await auto.after(thread, 'Dev', reply('done')); assert.equal(status(thread, 'QA'), 'running');
});

test('graph validation rejects unknown blocks, bad Lead phases, unknown conditions and edges out of Hoàn tất', () => {
  const { team, id, thread } = setup(['GD', 'Lead Dev', 'Dev']);
  const save = g => update(team, 'graph-save', { id, graph: g }), nodes = thread.graph.nodes;
  assert.throws(() => save({ nodes: [...nodes, { id: 'Art', label: 'Art' }], edges: [] }), /không có trong session/);
  assert.throws(() => save({ nodes: [...nodes.filter(node => node.id !== 'Lead Dev@review'), { id: 'Lead Dev@x', label: 'Lead Dev', phase: 'x' }], edges: [] }), /Nút không hợp lệ/);
  assert.throws(() => save({ nodes, edges: [{ from: 'GD', to: 'Dev', when: 'maybe' }] }), /Điều kiện không hợp lệ/);
  assert.throws(() => save({ nodes, edges: [{ from: '@end', to: 'GD' }] }), /Cạnh không hợp lệ/);
  save({ nodes: nodes.map(node => ({ ...node, x: node.x + 10 })), edges: thread.graph.edges }); assert.equal(thread.graph.nodes[0].x, nodes[0].x + 10);
});

test('until the graph is customised it follows the roles; after that a new Dev is wired like the other Devs', () => {
  const { team, id, thread } = setup(['GD', 'Lead Dev', 'Dev', 'QA']);
  update(team, 'add-worker', { id, type: 'Dev' }); assert.ok(thread.graph.edges.some(edge => edge.from === 'Dev #2' && edge.to === 'QA'), 'default graph rebuilt');
  update(team, 'graph-save', { id, graph: thread.graph });
  update(team, 'add-worker', { id, type: 'Dev' });
  const wired = (from, to, when) => thread.graph.edges.some(edge => edge.from === from && edge.to === to && edge.when === when);
  assert.ok(wired('Lead Dev@planning', 'Dev #3', 'done') && wired('Dev #3', 'QA', 'done') && wired('Lead Dev@review', 'Dev #3', 'reject'));
  update(team, 'remove-role', { id, role: 'Dev #3' }); assert.equal(thread.graph.nodes.some(node => node.label === 'Dev #3'), false); assert.equal(thread.graph.edges.some(edge => edge.to === 'Dev #3'), false);
});
test('saved graph keeps negative positions, wire points and per-wire ports; invalid values are dropped', () => {
  const team = initial(), id = update(team, 'create', { request: 'x' });
  for (const type of ['Dev', 'QA']) update(team, 'add-worker', { id, type });
  const thread = team.threads.find(item => item.id === id), graph = structuredClone(thread.graph);
  graph.nodes[0].x = -340.4; graph.nodes[0].y = -120; graph.nodes[0].in = 'top';
  graph.edges[0].points = [{ x: 400.4, y: -60.6 }, { x: 520, y: 30 }]; graph.edges[0].fromPort = { side: 'bottom', at: 0.333 }; graph.edges[0].toPort = { side: 'diagonal', at: 0.5 };
  graph.edges[0].bends = [1]; graph.edges[0].route = 'free';
  if (graph.edges[1]) { graph.edges[1].points = [{ x: 'a', y: 1 }]; graph.edges[1].toPort = { side: 'top', at: 2 }; }
  if (graph.edges[2]) graph.edges[2].points = [];
  update(team, 'graph-save', { id, graph });
  const saved = thread.graph;
  assert.deepEqual({ x: saved.nodes[0].x, y: saved.nodes[0].y, in: saved.nodes[0].in }, { x: -340, y: -120, in: undefined });
  assert.deepEqual(saved.edges[0], { id: saved.edges[0].id, from: saved.edges[0].from, to: saved.edges[0].to, when: saved.edges[0].when, points: [{ x: 400, y: -61 }, { x: 520, y: 30 }], fromPort: { side: 'bottom', at: 0.333 } });
  if (saved.edges[1]) assert.deepEqual([saved.edges[1].points, saved.edges[1].toPort], [undefined, undefined]);
  if (saved.edges[2]) assert.deepEqual(saved.edges[2].points, []);
  graph.nodes[0].x = 1e9; update(team, 'graph-save', { id, graph }); assert.equal(thread.graph.nodes[0].x, 100000);
});
