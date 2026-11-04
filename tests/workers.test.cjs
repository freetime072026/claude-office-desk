const { test } = require('node:test'); const assert = require('node:assert/strict');
const path = require('node:path'); const os = require('node:os');
const { initial, update } = require('../team.cjs'); const { worker, runKey, resumeKey, forgetWorker, removable, taskPlan, authoredBy, ownsSession } = require('../workers.cjs');
test('R3: authoredBy and ownsSession match exact labels only', () => {
  assert.equal(authoredBy({ role: 'Dev' }, 'Dev'), true); assert.equal(authoredBy({ role: 'Dev · bàn giao thủ công' }, 'Dev'), true);
  assert.equal(authoredBy({ role: 'Dev #2 · bàn giao thủ công' }, 'Dev'), false); assert.equal(authoredBy({ role: 'Lead Dev' }, 'Dev'), false);
  assert.equal(ownsSession(resumeKey('p', 'C:\\g', 'Dev'), 'Dev'), true); assert.equal(ownsSession(resumeKey('p', 'C:\\g', 'Lead Dev'), 'Dev'), false); assert.equal(ownsSession(resumeKey('p', 'C:\\g', 'Dev #2'), 'Dev'), false);
});
test('multiple workers have independent account, model and task; transcript survives switching', () => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); update(team, 'add-worker', { id, type: 'Dev' }); update(team, 'add-worker', { id, type: 'Dev' }); update(team, 'add-worker', { id, type: 'UI/UX' }); const thread = team.threads[0]; assert.deepEqual(thread.flow, ['UI/UX', 'Dev', 'Dev #2']); update(team, 'worker-config', { id, role: 'Dev', profileId: 'account-a', mode: 'edit', model: 'opus', task: 'UI scripts' }); update(team, 'worker-config', { id, role: 'Dev #2', profileId: 'account-b', mode: 'read', model: 'sonnet', task: 'Tests' }); assert.equal(worker(thread, 'Dev').model, 'opus'); assert.equal(worker(thread, 'Dev #2').profileId, 'account-b'); assert.notEqual(runKey(id, 'Dev'), runKey(id, 'Dev #2')); const before = JSON.stringify(thread.messages); update(team, 'worker-config', { id, role: 'Dev', profileId: 'account-b', mode: 'read', model: 'haiku', task: 'UI scripts' }); assert.equal(JSON.stringify(thread.messages), before); });
test('Lead task drafts reject unknown/duplicate owners and apply only on explicit action', () => { const team = initial(); const id = update(team, 'create', {}); update(team, 'add-worker', { id, type: 'Dev' }); const thread = team.threads[0]; assert.equal(taskPlan('```tasks\n{"tasks":[{"worker":"missing","task":"x"}]}\n```', thread), null); thread.taskDrafts = taskPlan('```tasks\n{"tasks":[{"worker":"Dev","task":"Implement AC1, file UI.cs","files":["Assets/UI.cs"]}]}\n```', thread); assert.equal(worker(thread, 'Dev').task, ''); update(team, 'apply-task-plan', { id }); assert.match(worker(thread, 'Dev').task, /AC1/); assert.deepEqual(worker(thread, 'Dev').files, ['Assets/UI.cs']); assert.deepEqual(thread.taskDrafts, []); });
test('Lead tasks need files per Dev, inside the project and not shared between Devs', () => {
  const team = initial(); const id = update(team, 'create', {}); update(team, 'add-worker', { id, type: 'Dev' }); update(team, 'add-worker', { id, type: 'Dev' }); const thread = team.threads[0];
  const plan = tasks => taskPlan('```tasks\n' + JSON.stringify({ tasks }) + '\n```', thread);
  assert.equal(plan([{ worker: 'Dev', task: 'x' }]), null, 'files missing');
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: ['../outside.cs'] }]), null, 'escapes the project');
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: ['C:\\abs.cs'] }]), null, 'absolute path');
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: ['Assets/UI/'] }, { worker: 'Dev #2', task: 'y', files: ['Assets/UI/Menu.cs'] }]), null, 'Dev #2 file inside Dev folder');
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: ['Assets/A.cs'] }, { worker: 'Dev #2', task: 'y', files: ['assets/a.cs'] }]), null, 'same file, different case');
  assert.deepEqual(plan([{ worker: 'Dev', task: 'x', files: ['Assets\\UI\\'] }, { worker: 'Dev #2', task: 'y', files: ['Assets/Game/Player.cs'] }]).map(task => task.files), [['Assets/UI/'], ['Assets/Game/Player.cs']]);
});
test('new blocks get the model of their role; existing blocks keep theirs', () => {
  const team = initial(); const id = update(team, 'create', {}); const thread = team.threads[0];
  for (const type of ['GD', 'Lead Dev', 'Dev', 'QA', 'UI/UX']) update(team, 'add-worker', { id, type });
  assert.deepEqual(['GD', 'Lead Dev', 'Dev', 'QA', 'UI/UX'].map(label => worker(thread, label).model), ['sonnet', 'claude-opus-5-5', 'sonnet', 'sonnet', 'sonnet']);
  thread.workers.QA.model = 'haiku'; assert.equal(worker(thread, 'QA').model, 'haiku');
});

const session = (flow, extra = {}) => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); const thread = team.threads[0]; for (const type of flow) update(team, 'add-worker', { id, type }); Object.assign(thread, extra); return { team, id, thread }; };

test('AC-ROLE-03.1/03.2/03.3: insert by pipeline, keep active role, log skipped role', () => {
  const { team, id, thread } = session(['Dev', 'QA']);
  thread.stage = 1; thread.status = 'working';
  update(team, 'add-worker', { id, type: 'Dev' }); update(team, 'add-worker', { id, type: 'GD' }); update(team, 'add-worker', { id, type: 'Lead Dev' });
  assert.deepEqual(thread.flow, ['GD', 'Lead Dev', 'Dev', 'Dev #2', 'QA']);
  assert.equal(thread.flow[thread.stage], 'QA'); assert.equal(thread.status, 'working');
  assert(thread.messages.some(message => message.text === 'Đã thêm GD; bỏ qua ở vòng này'));
});
test('AC-ROLE-03.1: custom roles stay after QA; unstarted session starts from first role', () => {
  const { team, id, thread } = session(['QA']); update(team, 'assign-role', { id, name: 'Narrative' }); update(team, 'add-worker', { id, type: 'GD' });
  assert.deepEqual(thread.flow, ['GD', 'QA', 'Narrative']); assert.equal(thread.stage, 0);
});
test('AC-ROLE-04.2: a second Lead Dev is rejected', () => {
  const { team, id } = session(['Lead Dev']);
  assert.throws(() => update(team, 'add-worker', { id, type: 'Lead Dev' }), /đã có Lead Dev/);
  update(team, 'assign-role', { id, name: 'Lead Dev' }); assert.deepEqual(team.threads[0].flow, ['Lead Dev']);
});
test('AC-PROMPT-02.5: resumeKey is the single key format; forgetWorker clears worker, sessions and drafts of one label only', () => {
  assert.equal(resumeKey('p', 'C:\\game', 'Dev'), 'p:C:\\game:Dev'); assert.equal(resumeKey('p', 'C:\\game'), 'p:C:\\game:chat');
  const thread = { flow: ['Dev', 'Dev #2', 'Lead Dev'], workers: { Dev: { task: 'x' }, 'Dev #2': { task: 'y' } }, cliSessions: { [resumeKey('a', 'C:\\g', 'Dev')]: '1', [resumeKey('b', 'D:\\h', 'Dev')]: '2', [resumeKey('a', 'C:\\g', 'Dev #2')]: '3', [resumeKey('a', 'C:\\g', 'Lead Dev')]: '4' }, taskDrafts: [{ worker: 'Dev', task: 'x' }, { worker: 'Dev #2', task: 'y' }] };
  forgetWorker(thread, 'Dev');
  assert.deepEqual(Object.keys(thread.workers), ['Dev #2']); assert.deepEqual(Object.values(thread.cliSessions), ['3', '4']); assert.deepEqual(thread.taskDrafts.map(task => task.worker), ['Dev #2']);
});
test('AC-ROLE-02.1/02.7: removable refuses busy, queued, current-working and depended-on roles', () => {
  const { thread } = session(['GD', 'Dev', 'Dev', 'QA']);
  assert.match(removable(thread, 'Dev', { busy: true }).reason, /đang chạy/);
  thread.dispatch = [{ worker: 'Dev', task: 'A', status: 'finished', finishedAt: '2026-10-31T01:00:00Z' }, { worker: 'Dev #2', task: 'B', status: 'queued', dependsOn: ['Dev'] }];
  assert.match(removable(thread, 'Dev #2').reason, /hàng chờ/);
  assert.match(removable(thread, 'Dev').reason, /Dev #2 còn phụ thuộc Dev/);
  thread.status = 'working'; assert.match(removable(thread, 'GD').reason, /bước hiện tại/);
  assert.equal(removable(thread, 'missing').ok, false);
});
test('AC-ROLE-02.3 (TC-ROLE-04): Dev removable only after QA passes after its task and no open Issue remains', () => {
  const { thread } = session(['Lead Dev', 'Dev', 'QA']);
  thread.dispatch = [{ worker: 'Dev', task: 'A', status: 'finished', finishedAt: '2026-10-31T01:00:00Z' }];
  assert.match(removable(thread, 'Dev').reason, /chưa pass/);
  thread.qaPassedAt = '2026-10-31T02:00:00Z'; thread.issues = [{ id: '1', text: 'bug', closed: false }];
  assert.equal(removable(thread, 'Dev').ok, false);
  thread.issues[0].accepted = true; assert.deepEqual(removable(thread, 'Dev'), { ok: true, reason: 'đã pass' });
  thread.qaPassedAt = '2026-10-31T00:30:00Z'; assert.equal(removable(thread, 'Dev').ok, false);
});
test('AC-ROLE-02.2/02.4 (TC-ROLE-02b, TC-ROLE-05): idle role removable anytime, role with work but not passed refused', () => {
  const { thread } = session(['GD', 'UI/UX', 'Lead Dev', 'Dev', 'QA']);
  thread.stage = 4; thread.status = 'working';
  assert.deepEqual(removable(thread, 'UI/UX'), { ok: true, reason: 'không có việc' });
  assert.equal(removable(thread, 'Lead Dev').ok, false);
  assert.match(removable(thread, 'QA').reason, /bước hiện tại/);
  thread.status = 'waiting'; thread.messages.push({ role: 'QA', text: 'đang test' });
  assert.match(removable(thread, 'QA').reason, /có việc nhưng chưa pass/);
  thread.messages.push({ role: 'GD', text: 'GDD' }); assert.deepEqual(removable(thread, 'GD'), { ok: true, reason: 'đã pass' });
});
test('a task may list at most 8 files, and every rejected plan says why', () => {
  const team = initial(); const id = update(team, 'create', {}); update(team, 'add-worker', { id, type: 'Dev' }); const thread = team.threads[0];
  const plan = tasks => { const problems = []; return { result: taskPlan('```tasks\n' + JSON.stringify({ tasks }) + '\n```', thread, problems), problems }; };
  const nine = Array.from({ length: 9 }, (_, index) => `src/F${index}.cs`);
  const big = plan([{ worker: 'Dev', task: 'x', files: nine }]); assert.equal(big.result, null); assert.match(big.problems[0], /Dev: 9 tệp, tối đa 8 mỗi task/);
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: nine.slice(0, 8) }]).result.length, 1);
  assert.match(plan([{ worker: 'Ghost', task: 'x', files: ['a'] }]).problems[0], /"Ghost" không phải Dev\/VFX/);
  const none = []; assert.equal(taskPlan('no block', thread, none), null); assert.deepEqual(none, ['không có khối tasks']);
});
test('task files may be absolute inside a related session folder, never outside the session folders', () => {
  const team = initial(); const id = update(team, 'create', {}); update(team, 'add-worker', { id, type: 'Dev' }); const thread = team.threads[0];
  const main = path.join(os.tmpdir(), 'Resource'), game = path.join(os.tmpdir(), 'Game-12-pla');
  thread.folder = main; thread.relatedFolders = [game];
  const plan = files => { const problems = []; return { result: taskPlan('```tasks\n' + JSON.stringify({ tasks: [{ worker: 'Dev', task: 'x', files }] }) + '\n```', thread, problems), problems }; };
  assert.deepEqual(plan([game.replaceAll('\\', '/') + '/assets/stage/', 'docs/a.md']).result[0].files, [game.replaceAll('\\', '/') + '/assets/stage/', 'docs/a.md']);
  assert.equal(plan([path.join(main, 'src', 'a.cs')]).result.length, 1);
  const outside = plan([path.join(os.tmpdir(), 'Other', 'a.cs')]); assert.equal(outside.result, null); assert.match(outside.problems[0], /Dev: tệp ".*Other.*" không hợp lệ/);
  assert.match(plan(['../Game-12-pla/a.cs']).problems[0], /không dùng "\.\."/);
  assert.match(plan([path.join(game, '..', 'Other', 'a.cs')]).problems[0], /không hợp lệ/);
  assert.match(plan([]).problems[0], /Dev: files bắt buộc/);
});
test('Lead on the default model runs Sonnet in triage/review; an explicit Opus choice is kept', () => {
  const { modelFor } = require('../roles.cjs');
  assert.equal(modelFor('Lead Dev', 'claude-opus-5-5', 'planning'), 'claude-opus-5-5');
  assert.equal(modelFor('Lead Dev', 'claude-opus-5-5', 'triage'), 'sonnet');
  assert.equal(modelFor('Lead Dev', 'claude-opus-5-5', 'review'), 'sonnet');
  assert.equal(modelFor('Lead Dev', 'opus', 'review'), 'opus');
  assert.equal(modelFor('GD', 'claude-opus-5-5', 'review'), 'claude-opus-5-5');
});
test('only running or paused Dev tasks hold back a new Lead plan; unstarted tasks of the old plan are replaced', () => {
  const { busyWorkers } = require('../workers.cjs');
  assert.deepEqual(busyWorkers({ dispatch: [{ worker: 'Dev #3', status: 'pending' }, { worker: 'Dev #2', status: 'queued' }, { worker: 'Dev', status: 'blocked' }] }), []);
  assert.deepEqual(busyWorkers({ dispatch: [{ worker: 'Dev', status: 'running' }, { worker: 'Dev #2', status: 'paused' }, { worker: 'Dev #3', status: 'starting' }] }), ['Dev', 'Dev #2', 'Dev #3']);
  assert.deepEqual(busyWorkers({}), []);
});
