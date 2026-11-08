const path = require('node:path');
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
  assert.deepEqual(PIPELINE, ['PO', 'GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'Sound', 'QA', 'Release', 'Fixer']);
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
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['GD', 'Lead Dev', 'Art', 'QA'], workers: { Art: { type: 'Art', task: 'Icon vàng', files: ['ArtGen/icons/'] } }, messages: [{ role: 'Bạn', text: 'Yêu cầu' }], attachments: [] };
  const { brief, body } = rolePrompt({ artGenerator: 'tool' }, thread, 'Art', { content: 'NOW', files });
  assert.match(brief, /mục Art trong .*GDD\.md và màn hình liên quan trong .*UIUX\.md/); assert.match(brief, /Chỉ được sửa: ArtGen\/icons\//);
  assert.match(brief, /pipeline art có sẵn của project/); assert.match(brief, /tool MCP sinh ảnh/); assert.match(brief, /Read ảnh để tự kiểm/);
  assert.match(brief, /cách sinh lại/); assert.match(brief, /"reassign":true/); assert.equal(body, 'NOW');
  assert.doesNotMatch(brief, /ChatGPT/);
  const scope = roleScope('Art', files, ['ArtGen/icons/'], 'E:\\game'); assert.equal(scope.bash, true); assert(scope.paths.includes(files.artPrompts));
});
test('ChatGPT mode (default): Art writes detailed English prompts from STYLE.md into ART_PROMPTS.md, waits for images in inbox, then post-processes', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['Lead Dev', 'Art'], workers: { Art: { type: 'Art', task: 'ART-3 nút', files: ['ArtGen/ui/'] } }, messages: [], attachments: [] };
  const brief = rolePrompt({}, thread, 'Art', { content: 'x', files }).brief;
  assert.match(brief, /Ảnh được tạo bằng ChatGPT do người dùng thao tác/); assert.match(brief, /Style prompt chung lấy từ STYLE\.md/);
  for (const item of [/bảng màu hex chủ đạo/, /góc nhìn và bố cục/, /kích thước tạo \(ví dụ 1024x1024\) và kích thước cuối/, /nền trong suốt PNG/, /không chữ, không watermark/, /biến thể\/trạng thái/, /ảnh tham chiếu trong project để người dùng upload kèm/, /Prompt viết bằng tiếng Anh/]) assert.match(brief, item);
  assert.match(brief, /[\\/]s[\\/]inbox[\\/]ART-….png/); assert.match(brief, /"status":"blocked","summary":"Chờ ảnh từ ChatGPT/);
  assert.match(brief, /tách nền hoặc chroma key, cắt viền thừa/); assert.match(brief, /không bắt ChatGPT vẽ lại vì nền/); assert.match(brief, /duyệt trên ảnh ĐÃ làm sạch/); assert.match(brief, /viết lại prompt cụ thể hơn/);
  // Lệnh dán nguyên khối: dòng Skip ghi đủ, bước SAVE copy + kiểm tệp, ghi đường dẫn thật vào IMAGE INFO.
  for (const item of [/Skip these items \(already done\)/, /Only make these items/, /output\/imagegen\/<mã nhóm>\/<tên tệp>\.png/, /Get-Item/, /không ghi đường dẫn chưa kiểm/]) assert.match(brief, item);
  // Lệnh chi tiết theo loại ảnh (sprite sheet từng frame) + ghi lỗi đã gặp vào ART_LESSONS.md (dùng chung project).
  for (const item of [/ART_LESSONS\.md/, /số pose chính xác, lưới cột × hàng/, /tay cầm vẽ ĐÈ lên cán vũ khí/, /cùng một nhân vật mọi frame/, /không lệch hình, không nhảy hình/, /cùng vị trí chân ở mọi ô/, /chỉ đòi KEY POSE/, /áp cho playback, không áp thẳng lên key pose/, /không tự gửi redo lần 4/, /ghi một mục vào ART_LESSONS\.md/]) assert.match(brief, item);
  assert.equal(path.basename(path.dirname(files.artLessons)), '.office-desk');
  const artScope = roleScope('Art', files, ['ArtGen/ui/'], 'E:\\game'), adScope = roleScope('Art Director', files);
  assert(artScope.paths.includes(files.artLessons) && artScope.shared.includes(files.artLessons) && adScope.paths.includes(files.artLessons));
  assert.match(rolePrompt({}, { flow: ['Art Director', 'Art'], workers: { 'Art Director': { type: 'Art Director' } }, messages: [], attachments: [], adPhase: 'review' }, 'Art Director', { content: 'x', files }).brief, /ART_LESSONS\.md/);
  assert.doesNotMatch(brief, /tool MCP sinh ảnh nếu role được bật/);
  const { initial, update } = require('../team.cjs'); const team = initial(); const id = update(team, 'create', { request: 'x' });
  update(team, 'art-generator', { id, mode: 'tool' }); assert.equal(team.artGenerator, 'tool');
  assert.throws(() => update(team, 'art-generator', { id, mode: 'midjourney' }), /không hợp lệ/);
});
test('GDD template has an Art section', () => {
  const { TEMPLATES } = require('../session-files.cjs');
  assert.match(TEMPLATES.gdd, /## VFX\n[^\n]*\n\n## Art\n<!-- Sprite\/icon\/ảnh UI cần làm[^\n]*\n\n## Anim\n/);
});
test('user decisions said in chat (skip / keep / do not check) persist in DECISIONS.md: every block reads it, the receiver writes it', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' }); assert.match(files.decisions, /[\\/]s[\\/]DECISIONS\.md$/);
  for (const type of ['Art', 'Art Director', 'Lead Dev', 'Dev', 'QA', 'GD']) {
    const thread = { flow: ['GD', 'Art Director', 'Lead Dev', 'Dev', 'Art', 'QA'], workers: { [type]: { type, task: 't', files: ['src/'] } }, messages: [], attachments: [] };
    assert.match(rolePrompt({}, thread, type, { content: 'x', files }).brief, /DECISIONS\.md[^]*thắng brief, script của project, tiêu chí kiểm và task cũ/, type);
    const scope = roleScope(type, files, ['src/'], 'E:\\game'); assert(scope.paths.includes(files.decisions) && scope.shared.includes(files.decisions), type);
  }
  assert.match(rolePrompt({}, { flow: ['Art'], workers: { Art: { type: 'Art', task: 't', files: ['a/'] } }, messages: [], attachments: [] }, 'Art', { content: 'x', files }).brief, /penpot_sync\.py skip <tên>/);
});
test('blocks are told to make Edit old_string unique in briefs that repeat text per item (no "Found N matches" retries)', () => {
  const files = filesOf({ id: 's', folder: 'E:/game' });
  const brief = rolePrompt({}, { flow: ['Art'], workers: { Art: { type: 'Art', task: 't', files: ['a/'] } }, messages: [], attachments: [] }, 'Art', { content: 'x', files }).brief;
  assert.match(brief, /old_string của Edit phải kèm dòng nhận diện duy nhất của mục đó/); assert.match(brief, /Found N matches/);
});
