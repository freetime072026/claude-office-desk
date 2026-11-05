const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update, migrateRoleConfig } = require('../team.cjs');
const { createAutoRun, parseHandoff } = require('../pipeline.cjs');
const { pump } = require('../dispatch.cjs');
const { mergePlan, PIPELINE } = require('../workers.cjs');
const { roleContext, rolePrompt } = require('../prompt.cjs');
const { roleScope } = require('../permissions.cjs');
const { filesOf } = require('../session-files.cjs');
const { PRESETS } = require('../presets.cjs');
const { defaults } = require('../roles.cjs');
const graph = require('../flowgraph.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const handoff = (status, summary = status, extra = {}) => fence('handoff', { status, summary, ...extra });
const tasks = list => fence('tasks', { tasks: list.map(([worker, files]) => ({ worker, task: 'Việc của ' + worker, files })) });
const session = roles => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type }); return { team, id, thread: team.threads[0] }; };
const ROLES = ['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'Art', 'QA', 'Release'];

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
  const plan = (planner, text) => { const result = mergePlan(thread, planner, text); assert(result.dispatch, JSON.stringify(result)); thread.dispatch = result.dispatch; };
  const finish = label => { const task = thread.dispatch.find(item => item.worker === label && item.status === 'running'); task.status = 'finished'; task.finishedAt = new Date().toISOString(); };
  // Mô phỏng main.cjs: handoff reject kèm reason của Dev → task giữ ở pending chờ art.
  const artReject = (label, reason, art, summary) => { const task = thread.dispatch.find(item => item.worker === label && item.status === 'running'); task.status = 'pending'; task.artReject = { reason, art, summary }; };
  // GD → UI/UX → Art Director giao Art → Lead giao Dev; Dev và Art cùng chạy.
  async function toDevRound() {
    await auto.after(thread, 'GD', { text: handoff('done') }); await auto.after(thread, 'UI/UX', { text: handoff('done') });
    const adPlan = handoff('done') + tasks([['Art', ['ArtGen/popup/']]]); plan('Art Director', adPlan);
    await auto.after(thread, 'Art Director', { text: adPlan }, { proposalApplied: true });
    const leadPlan = tasks([['Dev', ['src/']]]); plan('Lead Dev', leadPlan);
    await auto.after(thread, 'Lead Dev', { text: leadPlan }, { proposalApplied: true });
    assert.deepEqual(sent.slice(-2).sort(), ['Art', 'Dev']);
  }
  return { team, id, thread, sent, auto, plan, finish, artReject, toDevRound };
}

test('block config: Dev and Dev #2 keep separate instructions/responsibility; inherited text is not stored', () => {
  const { team, id, thread } = session(['Lead Dev', 'Dev', 'Dev']);
  assert.deepEqual(thread.flow, ['Lead Dev', 'Dev', 'Dev #2']);
  update(team, 'role-config', { id, role: 'Dev #2', responsibility: defaults.Dev.responsibility, output: 'Chỉ build bản gửi', instructions: 'Chạy npm run release' });
  assert.deepEqual(thread.roleConfig['Dev #2'], { output: 'Chỉ build bản gửi', instructions: 'Chạy npm run release' });
  assert.equal(roleContext(team, thread, 'Dev').instructions, ''); assert.equal(roleContext(team, thread, 'Dev').output, defaults.Dev.output);
  assert.equal(roleContext(team, thread, 'Dev #2').instructions, 'Chạy npm run release'); assert.equal(roleContext(team, thread, 'Dev #2').responsibility, defaults.Dev.responsibility);
  assert.throws(() => update(team, 'role-config', { id, role: 'Dev #3', responsibility: 'x', output: 'y' }), /Role không hợp lệ/);
  update(team, 'remove-role', { id, role: 'Dev #2' }); assert.equal(thread.roleConfig['Dev #2'], undefined);
  assert.equal(team.roleTemplates, undefined, 'editing a block does not change the team template');
});

test('block config: migration copies the old per-type config to every block of that type and drops copied template text', () => {
  const team = { ...initial(), roleTemplates: { Dev: { responsibility: 'Template Dev', output: 'Template out' } } };
  const thread = { flow: ['Dev', 'Dev #2', 'QA'], workers: { Dev: { type: 'Dev' }, 'Dev #2': { type: 'Dev' }, QA: { type: 'QA' } }, roleConfig: { Dev: { responsibility: 'Template Dev', output: 'Riêng', instructions: 'Release' }, QA: { responsibility: defaults.QA.responsibility, output: defaults.QA.output, instructions: '' } } };
  assert.equal(migrateRoleConfig(team, thread), true);
  assert.deepEqual(thread.roleConfig, { Dev: { output: 'Riêng', instructions: 'Release' }, 'Dev #2': { output: 'Riêng', instructions: 'Release' }, QA: { instructions: '' } });
  assert.equal(migrateRoleConfig(team, thread), false, 'runs once');
  thread.roleConfig['Dev #2'].instructions = ''; assert.equal(thread.roleConfig.Dev.instructions, 'Release', 'blocks no longer share an object');
});

test('Release: one per session after QA, writes only RELEASE.md/ISSUES.md, runs shell; default graph Lead review → Release → end, issue → Lead triage', () => {
  assert.equal(PIPELINE.filter(type => type !== 'Fixer').at(-1), 'Release'); // Fixer không phải bước của luồng
  const { team, id, thread } = session(ROLES);
  assert.equal(thread.flow.at(-1), 'Release'); assert.throws(() => update(team, 'add-worker', { id, type: 'Release' }), /Session đã có Release/);
  const files = filesOf({ id: 's', folder: 'E:\\game' }), scope = roleScope('Release', files);
  assert.deepEqual(scope.paths, [files.release, files.issues]); assert.equal(scope.bash, true); assert.match(files.release, /[\\/]s[\\/]RELEASE\.md$/);
  const edges = graph.defaultGraph(thread).edges.map(edge => `${edge.from}>${edge.to}:${edge.when}`);
  for (const edge of ['Lead Dev@review>Release:pass', 'Release>@end:pass', 'Release>Lead Dev@triage:issue']) assert(edges.includes(edge), edge);
  assert(!edges.includes('Lead Dev@review>@end:pass'));
  const solo = session(['Dev', 'Release']).thread, soloEdges = graph.defaultGraph(solo).edges.map(edge => `${edge.from}>${edge.to}:${edge.when}`);
  for (const edge of ['Dev>Release:done', 'Release>@end:pass', 'Release>Dev:issue']) assert(soloEdges.includes(edge), edge);
  const brief = rolePrompt(team, { ...thread, folder: 'E:\\game' }, 'Release', { files }).brief;
  assert.match(brief, /RELEASE\.md/); assert.match(brief, /không sửa code/); assert.match(brief, /"status":"issue"/);
  assert.match(brief, /1\) Commit:.*không push/); assert.match(brief, /không add thư mục \.office-desk\//); assert.match(brief, /không build\/QA kiểm lại/);
});

test('art rework: Dev rejects approved art (ui-mismatch) → Art Director review again while QA waits; AD pass resumes Dev with the guidance', async () => {
  const { thread, sent, auto, finish, artReject, toDevRound } = harness();
  const edges = graph.ensureGraph(thread).edges.map(edge => `${edge.from}>${edge.to}:${edge.when}`); assert(edges.includes('Dev>Art Director@review:reject'));
  await toDevRound();
  finish('Art'); await auto.after(thread, 'Art', { text: handoff('done') });
  artReject('Dev', 'ui-mismatch', ['ART-2'], 'Khung 9-slice lệch SCR-1 12px');
  await auto.after(thread, 'Dev', { text: handoff('reject', 'Khung 9-slice lệch SCR-1 12px', { reason: 'ui-mismatch', art: ['ART-2'] }) });
  assert.equal(sent.at(-1), 'Art Director@review'); assert(!sent.includes('QA'), 'QA does not test half-assembled work');
  assert.match(rolePrompt({}, thread, 'Art Director', { content: 'x' }).body, /Dev \(không ghép được đúng UI\/UX\) ART-2: Khung 9-slice lệch SCR-1 12px/);
  await auto.after(thread, 'Art Director', { text: handoff('pass', 'Dùng border 24 khi ghép') });
  assert.equal(sent.at(-1), 'Dev'); assert(!sent.includes('Lead Dev@review'));
  const task = thread.dispatch.find(item => item.worker === 'Dev'); assert.match(task.task, /hướng dẫn ghép: Dùng border 24 khi ghép/); assert.equal(task.artReject, undefined);
  finish('Dev'); await auto.after(thread, 'Dev', { text: handoff('done') });
  assert.deepEqual(sent.slice(-2).sort(), ['Art Director@review', 'QA']); assert.equal(thread.artRework, undefined);
});

test('art rework: Dev reports over-detail while Art still runs → AD review after Art → AD rejects with Art tasks → Art redoes → Dev runs again', async () => {
  const { thread, sent, auto, plan, finish, artReject, toDevRound } = harness();
  assert.deepEqual(parseHandoff(handoff('reject', 'x', { reason: 'missing-layers', art: ['ART-3', 5] })), { status: 'reject', summary: 'x', retested: [], reason: 'missing-layers', art: ['ART-3'] });
  assert.equal(parseHandoff(handoff('reject', 'x', { reason: 'khác' })).reason, undefined);
  await toDevRound();
  artReject('Dev', 'over-detail', ['ART-1'], 'Nền thừa hoạ tiết'); await auto.after(thread, 'Dev', { text: handoff('reject') });
  assert(!sent.includes('Art Director@review'), 'AD review waits for Art still running');
  finish('Art'); await auto.after(thread, 'Art', { text: handoff('done') }); assert.equal(sent.at(-1), 'Art Director@review');
  const redo = handoff('reject', 'ART-1 bỏ hoạ tiết nền') + tasks([['Art', ['ArtGen/popup/']]]); plan('Art Director', redo);
  await auto.after(thread, 'Art Director', { text: redo }, { proposalApplied: true });
  assert.equal(sent.at(-1), 'Art'); assert.equal(thread.dispatch.find(item => item.worker === 'Dev').status, 'pending');
  finish('Art'); await auto.after(thread, 'Art', { text: handoff('done') });
  assert.equal(sent.at(-1), 'Dev'); assert.match(thread.dispatch.find(item => item.worker === 'Dev').task, /Art đã làm lại theo Art Director/);
  assert.equal(thread.artReworks, 1);
});

test('art rework: without an Art Director the reject stops for the user', async () => {
  const { thread } = session(['Lead Dev', 'Dev', 'QA']); const notes = [];
  const auto = createAutoRun({ update: () => {}, send: async () => true, pump: async () => {}, log: (item, role, text) => notes.push(text), changed: () => {}, approve: async () => true, isRunning: () => false });
  thread.auto = { enabled: true }; thread.dispatch = [{ worker: 'Dev', task: 't', files: ['src/'], status: 'pending', artReject: { reason: 'missing-layers', art: [], summary: 'thiếu layer tay' } }];
  graph.stateOf(thread, 'Dev').status = 'running';
  await auto.after(thread, 'Dev', { text: handoff('reject') });
  assert.equal(graph.stateOf(thread, 'Dev').status, 'blocked'); assert.match(notes.join('\n'), /không có Art Director/);
});

test('Release in the run: Lead review pass → Release; issue → Lead triage with an Issue; pass → done', async () => {
  const { thread, sent, auto, finish, toDevRound } = harness();
  await toDevRound();
  finish('Dev'); await auto.after(thread, 'Dev', { text: handoff('done') });
  finish('Art'); await auto.after(thread, 'Art', { text: handoff('done') });
  await auto.after(thread, 'QA', { text: handoff('pass') }); await auto.after(thread, 'QA', { text: handoff('pass') });
  await auto.after(thread, 'Art Director', { text: handoff('pass') });
  assert.equal(sent.at(-1), 'Lead Dev@review');
  await auto.after(thread, 'Lead Dev', { text: handoff('pass') }); assert.equal(sent.at(-1), 'Release');
  await auto.after(thread, 'Release', { text: handoff('issue', 'meta 2,3 MB > 2 MB') });
  assert.equal(sent.at(-1), 'Lead Dev@triage'); assert(thread.issues.some(issue => issue.text === '[Release] meta 2,3 MB > 2 MB'));
  // The fix round ran; the run only finishes once no branch is left running, queued or blocked.
  for (const node of graph.ensureGraph(thread).nodes) if (['running', 'queued'].includes(graph.stateOf(thread, node.id).status)) Object.assign(graph.stateOf(thread, node.id), { status: 'done', outcome: 'done' });
  graph.stateOf(thread, 'Release').status = 'running';
  await auto.after(thread, 'Release', { text: handoff('pass', 'PLA-01 6 network') }); assert.equal(thread.status, 'done');
});

test('PLA preset has Art Director and Release with PLA texts', () => {
  assert.deepEqual(PRESETS.PLA.roles, ['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'Sound', 'QA', 'Release']);
  for (const type of PRESETS.PLA.roles) assert(PRESETS.PLA.config[type]?.responsibility, type);
  const { team, id, thread } = session([]); update(team, 'apply-preset', { id, preset: 'PLA', engine: 'phaser' });
  assert.equal(thread.workers.Release.purpose, 'pla'); assert.match(roleContext(team, thread, 'Release').responsibility, /network/);
  assert.match(roleContext(team, thread, 'Art Director').responsibility, /tách layer/);
});
