const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { taskPlan, worker, PIPELINE } = require('../workers.cjs');
const { rolePrompt, FILE_ROLES } = require('../prompt.cjs');
const { roleScope } = require('../permissions.cjs');
const { filesOf } = require('../session-files.cjs');
const { SHELL_TYPES, DEV_TYPES, MAX_TURNS } = require('../roles.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const session = roles => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type }); return { team, id, thread: team.threads[0] }; };

test('Art is a Dev-type role after VFX and before QA: Sonnet, edit mode, shell, 40 tool turns, works from .md files', () => {
  assert.deepEqual(PIPELINE, ['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'QA']);
  const { team, id, thread } = session(['QA', 'Art', 'Dev', 'Lead Dev']);
  assert.deepEqual(thread.flow, ['Lead Dev', 'Dev', 'Art', 'QA']);
  assert.equal(worker(thread, 'Art').model, 'sonnet'); assert.equal(worker(thread, 'Art').mode, 'edit');
  assert(DEV_TYPES.includes('Art') && SHELL_TYPES.includes('Art') && FILE_ROLES.includes('Art')); assert.equal(MAX_TURNS.Art, 40);
  assert.equal(update(team, 'add-worker', { id, type: 'Art' }), 'Art #2');
});
test('Lead assigns sprite work to Art with its own files, not overlapping a Dev', () => {
  const { thread } = session(['Lead Dev', 'Dev', 'Art']);
  const plan = tasks => taskPlan(fence('tasks', { tasks }), thread);
  assert.deepEqual(plan([{ worker: 'Dev', task: 'Logic', files: ['Assets/Scripts/'] }, { worker: 'Art', task: 'Icon', files: ['ArtGen/icons/', 'Assets/_Art/Icons/'] }]).map(task => task.worker), ['Dev', 'Art']);
  assert.equal(plan([{ worker: 'Dev', task: 'x', files: ['Assets/'] }, { worker: 'Art', task: 'y', files: ['Assets/_Art/'] }]), null);
  assert.match(rolePrompt({}, thread, 'Lead Dev', { content: 'x' }).brief, /sprite, icon, ảnh UI giao cho Art/);
});
test('Art prompt: Art section of GDD and UI/UX screens, its files, project pipeline or MCP, self-check with Read, regenerate steps in handoff', () => {
  const files = filesOf({ id: 's', folder: 'E:\game' });
  const thread = { flow: ['GD', 'Lead Dev', 'Art', 'QA'], workers: { Art: { type: 'Art', task: 'Icon vàng', files: ['ArtGen/icons/'] } }, messages: [{ role: 'Bạn', text: 'Yêu cầu' }], attachments: [] };
  const { brief, body } = rolePrompt({}, thread, 'Art', { content: 'NOW', files });
  assert.match(brief, /mục Art trong .*GDD\.md và màn hình liên quan trong .*UIUX\.md/); assert.match(brief, /Chỉ được sửa: ArtGen\/icons\//);
  assert.match(brief, /pipeline art có sẵn của project/); assert.match(brief, /tool MCP sinh ảnh/); assert.match(brief, /Read ảnh để tự kiểm/);
  assert.match(brief, /cách sinh lại/); assert.match(brief, /"reassign":true/); assert.equal(body, 'NOW');
  assert.equal(roleScope('Art', files, ['ArtGen/icons/'], 'E:\game').bash, true);
});
test('GDD template has an Art section', () => {
  const { TEMPLATES } = require('../session-files.cjs');
  assert.match(TEMPLATES.gdd, /## VFX\n[^\n]*\n\n## Art\n<!-- Sprite\/icon\/ảnh UI cần làm[^\n]*\n\n## Ngân sách performance/);
});
