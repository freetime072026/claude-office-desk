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
  assert.equal(roleScope('Dev', files, [], folder), null); assert.equal(roleScope('Art', files), null); assert.equal(roleScope('GD', null), null);
});

test('scoped roles run the CLI in default mode so every write reaches the app', () => {
  const scope = { paths: ['x'], bash: false };
  for (const mode of ['read', 'edit', 'auto', 'bypass']) assert.equal(cliMode(mode, scope), 'default');
  assert.equal(cliTools('read', scope), 'Read,Glob,Grep,Write,Edit,WebFetch,WebSearch');
  assert.equal(cliTools('edit', { ...scope, bash: true }), 'Read,Glob,Grep,Write,Edit,Bash,Agent');
  assert.doesNotMatch(cliTools('bypass', scope), /Bash|Web/);
  assert.match(cliTools('edit', { ...scope, bash: true }), /Bash/);
  assert.equal(cliMode('auto', null), 'auto');
});

test('UI/UX writes only UIUX.md without shell, works from files, and Lead/QA are pointed at it while Dev is not', () => {
  const folder = 'E:\game', files = filesOf({ id: 's', folder });
  assert.equal(files.uiux, path.join(folder, '.office-desk', 's', 'UIUX.md'));
  const scope = roleScope('UI/UX', files);
  assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: files.uiux } }).action, 'allow');
  assert.equal(decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: files.gdd } }).action, 'deny');
  assert.equal(decide({ scope, mode: 'bypass', tool: 'Bash', input: {} }).action, 'deny');
  const text = prompts({ workers: { 'UI/UX': { type: 'UI/UX' }, Dev: { type: 'Dev', task: 'Màn hình SCR-1', files: ['Assets/UI/'] } }, flow: ['GD', 'UI/UX', 'Lead Dev', 'Dev', 'QA'] });
  assert.match(text('UI/UX'), /UIUX\.md; đây là tệp duy nhất bạn được ghi/); assert.doesNotMatch(text('UI/UX'), /Bối cảnh session|Thiết kế dài/);
  assert.match(text('Lead Dev'), /UIUX\.md \(nếu có\)[\s\S]*Dev không đọc UIUX\.md/); assert.match(text('QA'), /màn hình trong .*UIUX\.md/);
  assert.doesNotMatch(text('Dev'), /UIUX\.md/);
});

test('Lead, Dev, VFX and QA can run shell in every mode (asked unless Bypass); GD and UI/UX never', () => {
  const folder = 'E:\game', files = filesOf({ id: 's', folder });
  for (const type of ['Lead Dev', 'QA']) assert.equal(decide({ scope: roleScope(type, files), mode: 'read', tool: 'Bash', input: {} }).action, 'ask', type);
  const dev = roleScope('Dev', files, ['Assets/'], folder);
  assert.equal(decide({ scope: dev, mode: 'read', tool: 'Bash', input: {} }).action, 'ask');
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: {} }).action, 'allow');
  assert.match(cliTools('read', dev), /Bash/);
  for (const type of ['GD', 'UI/UX']) assert.equal(decide({ scope: roleScope(type, files), mode: 'bypass', tool: 'Bash', input: {} }).action, 'deny', type);
  assert.equal(decide({ scope: null, mode: 'read', tool: 'Bash', input: {} }).action, 'deny', 'unscoped Plan still has no shell');
});

test('file roles get the context-saving guide; Lead sees why its last plan was rejected; GDD has a size target', () => {
  const text = prompts({ planProblems: 'Dev: 9 tệp, tối đa 8 mỗi task' });
  for (const label of ['GD', 'Lead Dev', 'Dev', 'QA']) assert.match(text(label), /Read với offset\/limit[\s\S]*chỉ dùng Write để tạo tệp mới/, label);
  assert.match(text('Lead Dev'), /Kế hoạch tasks trước bị app từ chối: Dev: 9 tệp, tối đa 8 mỗi task\. Sửa đúng lỗi này\./);
  assert.doesNotMatch(text('Dev'), /bị app từ chối/);
  assert.match(text('GD'), /tối đa khoảng 8\.000 ký tự/); assert.match(text('Lead Dev'), /tối đa 8 mục mỗi task/);
  assert.equal(require('../roles.cjs').MAX_TURNS.Dev, 40);
});
