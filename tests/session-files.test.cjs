const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { ensureFiles, appendChange, writeTasks, filesOf } = require('../session-files.cjs');
const { rolePrompt } = require('../prompt.cjs');
const { roleScope, decide } = require('../permissions.cjs');
const { cliMode, cliTools } = require('../modes.cjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'office-files-'));

test('session files are created once under .office-desk and never overwritten', () => {
  const thread = { id: 'thread-1', folder: temp() }; const files = ensureFiles(thread);
  assert.equal(files.project, path.join(thread.folder, '.office-desk', 'PROJECT.md'));
  assert.equal(files.gdd, path.join(thread.folder, '.office-desk', 'thread-1', 'GDD.md'));
  fs.writeFileSync(files.gdd, 'mine'); ensureFiles(thread); assert.equal(fs.readFileSync(files.gdd, 'utf8'), 'mine');
  assert.equal(filesOf({ id: 'x', folder: '' }), null);
});

test('CHANGES.md is appended from Dev handoffs and TASKS.md shows the newest plan first', () => {
  const thread = { id: 'thread-2', folder: temp() }; const files = ensureFiles(thread);
  appendChange(thread, 'Dev', 'done', 'Sửa Assets/UI.cs: thêm nút'); appendChange(thread, 'Dev #2', 'blocked', 'x'.repeat(5000));
  const changes = fs.readFileSync(files.changes, 'utf8'); assert.match(changes, /· Dev · done\nSửa Assets\/UI\.cs/); assert.match(changes, /x{1500}…/); assert.doesNotMatch(changes, /x{1501}/);
  writeTasks(thread, [{ worker: 'Dev', task: 'Cũ', files: ['a.cs'] }], 'Lead phân công');
  writeTasks(thread, [{ worker: 'Dev', task: 'Mới', files: ['b.cs'], dependsOn: ['Dev #2'] }], 'Review không đạt');
  const tasks = fs.readFileSync(files.tasks, 'utf8');
  assert(tasks.indexOf('Mới') < tasks.indexOf('Cũ')); assert.match(tasks, /Tệp được sửa: b\.cs\nSau: Dev #2/);
});

const prompts = (extra = {}) => { const files = filesOf({ id: 's', folder: 'E:\\game' }); const thread = { flow: ['GD', 'Lead Dev', 'Dev', 'QA'], workers: { Dev: { type: 'Dev', task: 'Sửa UI', files: ['Assets/UI/'] } }, messages: [{ role: 'Bạn', text: 'Yêu cầu gốc' }, { role: 'GD', text: 'Thiết kế dài' }], attachments: [], ...extra }; return label => rolePrompt({}, thread, label, { content: 'NOW', resumed: false, files }).text; };

test('Lead, Dev and QA get file pointers instead of chat history; GD keeps the conversation', () => {
  const text = prompts();
  for (const label of ['Lead Dev', 'Dev', 'QA']) assert.doesNotMatch(text(label), /Bối cảnh session|Thiết kế dài/, label);
  assert.match(text('GD'), /Bối cảnh session/); assert.match(text('GD'), /GDD\.md; đây là tệp duy nhất/);
  assert.match(text('Dev'), /PROJECT\.md trước khi tìm trong code; không cần đọc GDD\. Chỉ được sửa: Assets\/UI\//);
  assert.doesNotMatch(text('Dev'), /Đội hiện có/); assert.match(text('Lead Dev'), /Đội hiện có/);
  assert.match(text('QA'), /Pha chức năng/); assert.match(prompts({ qaPhase: 'performance' })('QA'), /Pha performance[\s\S]*GC Alloc, CPU, GPU/);
});

test('role scopes: GD writes only GDD and never runs shell, Dev only its files, QA only ISSUES/PERF', () => {
  const folder = 'E:\\game', files = filesOf({ id: 's', folder });
  const gd = roleScope('GD', files), dev = roleScope('Dev', files, ['Assets/UI/', 'Assets/Game.cs'], folder), qa = roleScope('QA', files);
  assert.equal(decide({ scope: gd, mode: 'read', tool: 'Write', input: { file_path: files.gdd } }).action, 'allow');
  assert.equal(decide({ scope: gd, mode: 'bypass', tool: 'Edit', input: { file_path: 'E:\\game\\Assets\\A.cs' } }).action, 'deny');
  assert.equal(decide({ scope: gd, mode: 'bypass', tool: 'Bash', input: { command: 'dir' } }).action, 'deny');
  assert.equal(decide({ scope: dev, mode: 'edit', tool: 'Edit', input: { file_path: 'E:\\game\\assets\\ui\\Menu.cs' } }).action, 'allow');
  assert.equal(decide({ scope: dev, mode: 'edit', tool: 'Write', input: { file_path: 'Assets/Game.cs' }, cwd: folder }).action, 'allow');
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Write', input: { file_path: 'E:\\game\\Assets\\GameManager.cs' } }).action, 'deny', 'file sharing a prefix is not in scope');
  assert.equal(decide({ scope: dev, mode: 'edit', tool: 'Bash', input: {} }).action, 'ask');
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: {} }).action, 'allow');
  assert.equal(decide({ scope: qa, mode: 'auto', tool: 'Write', input: { file_path: files.issues } }).action, 'allow');
  assert.equal(decide({ scope: qa, mode: 'auto', tool: 'WebFetch', input: {} }).action, 'ask');
  assert.equal(roleScope('Dev', files, [], folder), null); assert.equal(roleScope('UI/UX', files), null); assert.equal(roleScope('GD', null), null);
});

test('scoped roles run the CLI in default mode so every write reaches the app', () => {
  const scope = { paths: ['x'], bash: false };
  for (const mode of ['read', 'edit', 'auto', 'bypass']) assert.equal(cliMode(mode, scope), 'default');
  assert.equal(cliTools('read', scope), 'Read,Glob,Grep,TodoWrite,Write,Edit,NotebookEdit,WebFetch,WebSearch');
  assert.doesNotMatch(cliTools('bypass', scope), /Bash|Web/);
  assert.match(cliTools('edit', { ...scope, bash: true }), /Bash/);
  assert.equal(cliMode('auto', null), 'auto');
});
