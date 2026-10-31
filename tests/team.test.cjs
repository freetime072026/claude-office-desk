const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initial, update, migrateThread, isHalted } = require('../team.cjs');
const { roleKey } = require('../roles.cjs');
const { resumeKey, removable, worker } = require('../workers.cjs');
test('role config persists session instructions and reusable defaults separately', () => { const team = initial(); const id = update(team, 'create', { request: 'Original' }); update(team, 'select-roles', { id, roles: ['GD'] }); update(team, 'role-config', { id, role: 'GD', responsibility: 'Design carefully', output: 'AC', instructions: 'Only this session', saveDefault: true }); const second = update(team, 'create', {}); update(team, 'select-roles', { id: second, roles: ['GD'] }); assert.equal(team.threads[1].roleConfig.GD.responsibility, 'Design carefully'); assert.equal(team.threads[1].roleConfig.GD.instructions, ''); update(team, 'select-roles', { id, roles: [] }); assert.deepEqual(team.threads[0].flow, []); assert.equal(team.threads[0].roleConfig.GD.instructions, 'Only this session'); update(team, 'edit-request', { id, text: 'Changed' }); assert.equal(team.threads[0].messages[0].text, 'Changed'); assert(team.threads[0].messages.some(message => message.role === 'Lịch sử yêu cầu' && message.text === 'Original')); });
test('AC-ROLE-04.1: role picker uses pipeline order and a single Lead Dev; in-progress guard', () => { const team = initial(); const id = update(team, 'create', {}); update(team, 'select-roles', { id, roles: ['QA', 'Lead Dev', 'Dev', 'GD'] }); assert.deepEqual(team.threads[0].flow, ['GD', 'Lead Dev', 'Dev', 'QA']); update(team, 'select-roles', { id, roles: [] }); assert.deepEqual(team.threads[0].flow, []); assert.throws(() => update(team, 'select-roles', { id, roles: ['unknown'] })); update(team, 'select-roles', { id, roles: ['GD'] }); update(team, 'start', { id }); assert.throws(() => update(team, 'select-roles', { id, roles: [] })); });
test('AC-ROLE-04.1: assign-role maps legacy Lead names to one Lead Dev', () => { const team = initial(); const id = update(team, 'create', {}); for (const name of ['QA', 'Lead Planning', 'Lead Review', 'Dev', 'GD']) update(team, 'assign-role', { id, name }); assert.deepEqual(team.threads[0].flow, ['GD', 'Lead Dev', 'Dev', 'QA']); });
test('AC-ROLE-04.4: roleKey reads legacy labels but leaves others unchanged', () => { assert.equal(roleKey('Lead Planning'), 'Lead Dev'); assert.equal(roleKey('Lead Review'), 'Lead Dev'); assert.equal(roleKey('QA'), 'QA'); assert.equal(roleKey('Lead Dev'), 'Lead Dev'); });

const loopSession = () => { const team = initial(); const id = update(team, 'create', { request: 'Feature' }); update(team, 'select-roles', { id, roles: ['GD', 'Lead Dev', 'Dev', 'QA'] }); return { team, id, thread: team.threads[0] }; };
const step = (team, id, text = 'Evidence') => { update(team, 'start', { id }); update(team, 'handoff', { id, text }); };
const toQA = (team, id) => { for (let count = 0; count < 3; count++) step(team, id); };

test('AC-LOOP-01.1/01.2/01.3 (TC-LOOP-01/02): QA → Lead triage → Dev → QA → Lead review → done', () => {
  const { team, id, thread } = loopSession();
  update(team, 'pin', { id }); assert.equal(thread.pinned, true);
  toQA(team, id); assert.equal(thread.flow[thread.stage], 'QA');
  update(team, 'issue', { id, text: 'Bug' });
  assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'triage'); assert.equal(thread.qaFailRounds, 1);
  step(team, id, 'Fix plan'); assert.equal(thread.flow[thread.stage], 'Dev');
  step(team, id, 'Fixed'); assert.equal(thread.flow[thread.stage], 'QA');
  update(team, 'start', { id }); assert.throws(() => update(team, 'handoff', { id, text: 'Pass' }));
  update(team, 'retest', { id, issue: thread.issues[0].id, text: 'Evidence' }); update(team, 'handoff', { id, text: 'QA pass' });
  assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'review'); assert.equal(thread.qaFailRounds, 0); assert(thread.qaPassedAt);
  step(team, id, 'Review pass'); assert.equal(thread.status, 'done'); assert.deepEqual(JSON.parse(JSON.stringify(team)), team);
});
test('AC-LOOP-01.4 (TC-LOOP-04): third QA fail waits for the user and halts dispatch', () => {
  const { team, id, thread } = loopSession(); toQA(team, id);
  for (let round = 1; round <= 2; round++) { update(team, 'issue', { id, text: 'Bug ' + round }); assert.equal(thread.leadPhase, 'triage'); step(team, id); step(team, id); }
  const stage = thread.stage; update(team, 'issue', { id, text: 'Bug 3' });
  assert.equal(thread.status, 'awaiting-decision'); assert.equal(thread.stage, stage); assert.equal(thread.qaFailRounds, 3); assert.equal(isHalted(thread), true);
  assert.throws(() => update(team, 'start', { id })); assert.throws(() => update(team, 'issue', { id, text: 'Bug 4' }));
});
test('AC-LOOP-01.6: decisions continue / accept / stop, each logged', () => {
  const halted = () => { const value = loopSession(); toQA(value.team, value.id); for (let round = 0; round < 3; round++) update(value.team, 'issue', { id: value.id, text: 'Bug' }); return value; };
  let { team, id, thread } = halted(); assert.throws(() => update(team, 'decision', { id, choice: 'nope' }));
  update(team, 'decision', { id, choice: 'continue' }); assert.equal(thread.qaFailRounds, 2); assert.equal(thread.leadPhase, 'triage'); assert.equal(thread.status, 'waiting'); assert.throws(() => update(team, 'decision', { id, choice: 'stop' }));
  ({ team, id, thread } = halted()); update(team, 'decision', { id, choice: 'accept' });
  assert(thread.issues.every(issue => issue.accepted && !issue.closed)); assert.equal(thread.leadPhase, 'review'); assert.equal(thread.flow[thread.stage], 'Lead Dev');
  ({ team, id, thread } = halted()); update(team, 'decision', { id, choice: 'stop' }); assert.equal(thread.status, 'cancelled'); assert.equal(isHalted(thread), true);
  assert(thread.messages.some(message => /dừng session/.test(message.text)));
});
test('review-reject sends Lead review back to Dev without counting a QA round', () => {
  const { team, id, thread } = loopSession(); toQA(team, id); step(team, id, 'QA pass');
  assert.throws(() => update(team, 'review-reject', { id, text: 'dup' }));
  update(team, 'start', { id }); update(team, 'review-reject', { id, text: 'Duplicate logic: main.cjs:116' });
  assert.equal(thread.flow[thread.stage], 'Dev'); assert.equal(thread.leadPhase, 'planning'); assert.equal(thread.qaFailRounds, 0); assert.equal(thread.qaPassedAt, undefined);
});

test('AC-ROLE-01.1–01.4, 02.6: remove then re-add gives a clean worker without old resume session; stage/status/Issues untouched', () => {
  const { team, id, thread } = loopSession(); toQA(team, id); step(team, id, 'QA pass'); update(team, 'start', { id });
  update(team, 'add-worker', { id, type: 'UI/UX' }); assert(thread.messages.some(message => message.role === 'Hệ thống' && /^Đã thêm UI\/UX/.test(message.text)));
  thread.workers.Dev = { ...thread.workers.Dev, mode: 'bypass', profileId: 'account-b', task: 'X' };
  thread.dispatch = [{ worker: 'Dev', task: 'X', status: 'finished', finishedAt: '2000-01-01T00:00:00Z' }];
  thread.cliSessions = { [resumeKey('account-b', 'C:\\game', 'Dev')]: 'old', [resumeKey('account-b', 'C:\\game', 'QA')]: 'keep' };
  thread.issues.push({ id: 'i', text: 'closed bug', closed: true });
  const before = { stage: thread.flow[thread.stage], status: thread.status };
  update(team, 'remove-role', { id, role: 'Dev' });
  assert.equal(thread.workers.Dev, undefined); assert.deepEqual(Object.values(thread.cliSessions), ['keep']);
  assert.deepEqual({ stage: thread.flow[thread.stage], status: thread.status }, before); assert.equal(thread.issues[0].closed, true);
  assert.equal(thread.messages.at(-1).text, 'Đã xóa Dev (đã pass)');
  update(team, 'add-worker', { id, type: 'Dev' });
  assert.deepEqual({ mode: thread.workers.Dev.mode, profileId: thread.workers.Dev.profileId, task: thread.workers.Dev.task }, { mode: 'edit', profileId: '', task: '' });
});
test('AC-ROLE-02.5/02.9: refused removal leaves data unchanged; busy flag comes from payload', () => {
  const { team, id, thread } = loopSession(); toQA(team, id);
  const snapshot = JSON.stringify(team);
  assert.throws(() => update(team, 'remove-role', { id, role: 'Lead Dev' }), /chưa pass/);
  assert.throws(() => update(team, 'remove-role', { id, role: 'GD', busy: ['GD'] }), /đang chạy/);  assert.equal(JSON.stringify(team), snapshot);
  update(team, 'remove-role', { id, role: 'GD' }); assert.equal(thread.flow[thread.stage], 'QA');
});
test('R1 / TC-ROLE-06a: select-roles cannot drop a working role; data unchanged', () => {
  const { team, id, thread } = loopSession();
  thread.dispatch = [{ worker: 'Dev', task: 'A', status: 'queued' }];
  const snapshot = JSON.stringify(team);
  assert.throws(() => update(team, 'select-roles', { id, roles: ['GD', 'Lead Dev', 'QA'] }), /hàng chờ/);
  assert.throws(() => update(team, 'select-roles', { id, roles: ['GD', 'Lead Dev', 'Dev'], busy: ['QA'] }), /QA đang chạy/);
  assert.equal(JSON.stringify(team), snapshot);
});
test('R1 / TC-ROLE-06b: dropping a passed Dev via select-roles forgets it; selecting Dev again starts clean', () => {
  const { team, id, thread } = loopSession(); toQA(team, id); step(team, id, 'QA pass'); step(team, id, 'Review pass'); assert.equal(thread.status, 'done');
  thread.workers = { Dev: { type: 'Dev', mode: 'bypass', model: 'opus', profileId: 'account-b', task: 'X' } };
  thread.cliSessions = { [resumeKey('account-b', 'C:\\game', 'Dev')]: 'old', [resumeKey('account-b', 'C:\\game', 'QA')]: 'keep' };
  update(team, 'select-roles', { id, roles: ['GD', 'Lead Dev', 'QA'], restart: true });
  assert.deepEqual(thread.flow, ['GD', 'Lead Dev', 'QA']); assert.equal(thread.workers.Dev, undefined); assert.deepEqual(Object.values(thread.cliSessions), ['keep']);
  update(team, 'select-roles', { id, roles: ['GD', 'Lead Dev', 'Dev', 'QA'] });
  assert.deepEqual({ mode: worker(thread, 'Dev').mode, profileId: worker(thread, 'Dev').profileId, task: worker(thread, 'Dev').task }, { mode: 'edit', profileId: '', task: '' });
});
test('R1: select-roles may drop Lead Dev together with Dev/QA in an unstarted session', () => {
  const { team, id, thread } = loopSession(); update(team, 'select-roles', { id, roles: ['GD'] }); assert.deepEqual(thread.flow, ['GD']);
});
test('R5: roles after QA run before Lead review; flow [GD, Lead Dev, Dev, QA, Art]', () => {
  const { team, id, thread } = loopSession(); update(team, 'assign-role', { id, name: 'Art' }); assert.deepEqual(thread.flow, ['GD', 'Lead Dev', 'Dev', 'QA', 'Art']);
  toQA(team, id); step(team, id, 'QA pass');
  assert.equal(thread.flow[thread.stage], 'Art'); assert(thread.qaPassedAt); assert.equal(thread.qaFailRounds, 0); assert.equal(thread.status, 'waiting');
  step(team, id, 'Art done'); assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'review');
  assert.deepEqual(removable(thread, 'Art'), { ok: true, reason: 'đã pass' });
  step(team, id, 'Review pass'); assert.equal(thread.status, 'done');
});
test('AC-ROLE-04.3 (TC-MIG-01): legacy Lead Planning/Lead Review migrate to one Lead Dev', () => {
  const thread = { flow: ['GD', 'Lead Planning', 'Dev', 'QA', 'Lead Review'], stage: 4, status: 'waiting', messages: [{ role: 'QA · bàn giao thủ công', text: 'QA pass' }], issues: [{ id: '1', text: 'old', closed: true }], workers: { 'Lead Planning': { type: 'Lead Dev', mode: 'edit', profileId: 'acc', task: 'plan' }, 'Lead Review': { type: 'Lead Dev', mode: 'read' } }, cliSessions: { [resumeKey('acc', 'C:\\g', 'Lead Planning')]: 'plan-session', [resumeKey('acc', 'C:\\g', 'Lead Review')]: 'review-session' } };
  assert.equal(migrateThread(thread), true);
  assert.deepEqual(thread.flow, ['GD', 'Lead Dev', 'Dev', 'QA']); assert.equal(thread.flow[thread.stage], 'Lead Dev'); assert.equal(thread.leadPhase, 'review');
  assert(thread.qaPassedAt, 'R6: Lead Review stage implies QA passed'); assert.deepEqual(removable(thread, 'QA'), { ok: true, reason: 'đã pass' });
  assert.deepEqual(thread.workers['Lead Dev'], { type: 'Lead Dev', mode: 'edit', profileId: 'acc', task: 'plan' }); assert.deepEqual(Object.keys(thread.workers), ['Lead Dev']);
  assert.deepEqual(thread.cliSessions, { [resumeKey('acc', 'C:\\g', 'Lead Dev')]: 'plan-session' }); assert.equal(thread.issues.length, 1);
  const planning = { flow: ['GD', 'Lead Planning', 'Dev', 'QA', 'Lead Review'], stage: 3, status: 'working' };
  migrateThread(planning); assert.equal(planning.flow[planning.stage], 'QA'); assert.equal(planning.leadPhase, 'planning'); assert.equal(planning.qaPassedAt, undefined);
  assert.equal(migrateThread(planning), false);
});
test('empty session defaults to ordinary Claude Code and names from first message', () => { const team = initial(); const id = update(team, 'create', {}); assert.equal(team.threads[0].title, 'Session mới'); assert.deepEqual(team.threads[0].flow, []); update(team, 'message', { id, text: 'Tạo màn hình đăng nhập' }); assert.equal(team.threads[0].title, 'Tạo màn hình đăng nhập'); update(team, 'message', { id, text: 'Second' }); assert.equal(team.threads[0].title, 'Tạo màn hình đăng nhập'); update(team, 'assign-role', { id, name: 'GD' }); assert.deepEqual(team.threads[0].flow, ['GD']); assert.throws(() => update(team, 'move', { id, project: 'unknown' })); });
