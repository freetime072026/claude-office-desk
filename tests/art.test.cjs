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
test('Codex mode: Art checks Codex login, runs codex exec per image, reviews the image inside the Codex folder, copies only passing images into inbox, then post-processes', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['Lead Dev', 'Art'], workers: { Art: { type: 'Art', task: 'ART-3 nút', files: ['ArtGen/ui/'] } }, messages: [], attachments: [] };
  const brief = rolePrompt({ artGenerator: 'codex' }, thread, 'Art', { content: 'x', files }).brief;
  assert.match(brief, /Codex CLI đăng nhập tài khoản ChatGPT/); assert.match(brief, /codex --version && codex login status/); assert.match(brief, /npm i -g @openai\/codex/);
  assert.match(brief, /Style prompt chung lấy từ STYLE\.md/); assert.match(brief, /ART_LESSONS\.md/); assert.match(brief, /Prompt viết bằng tiếng Anh/);
  assert.match(brief, /dòng đầu `\$imagegen`/); assert.match(brief, /codex exec -m gpt-5\.6-luna -c model_reasoning_effort=low --sandbox workspace-write --skip-git-repo-check "\$\(cat \.office-desk\/tmp\/ART-….txt\)"/, 'no model chosen yet: the default luna, low effort');
  assert.match(brief, /timeout 600000/); assert.match(brief, /-i <đường dẫn tương đối>/); assert.match(brief, /Do not copy, move or edit the generated image/);
  assert.match(brief, /ART-….txt\)" < \/dev\/null`/); assert.match(brief, /ls ".*generated_images\/<session id>"/); assert.match(brief, /không dùng ảnh mới nhất của cả thư mục/);
  assert.match(brief, /Codex không sinh được ảnh/); assert.match(brief, /không sinh lại vì nền/); assert.match(brief, /inbox chỉ chứa ảnh đã duyệt/);
  // Duyệt tại thư mục Codex: trượt thì không chép, ghi đường dẫn từng lần; đạt mới cp vào inbox; lỗi nền không tính là trượt.
  assert.match(brief, /ngay trong thư mục ảnh của Codex, chưa chép gì: lần lượt Read từng ảnh chờ duyệt tại đường dẫn đó/); assert.match(brief, /Nền \/ alpha \/ viền, cỡ canvas và thiếu frame giữa KHÔNG tính là trượt/);
  assert.match(brief, /Trượt: không chép vào inbox; ghi trong mục "Lần N: <đường dẫn ảnh trong thư mục Codex>/); assert.match(brief, /liệt kê đường dẫn và số đo từng lần để người dùng chọn ảnh giữ/);
  assert.match(brief, /Đạt: `cp` đúng tệp đó \(giữ nguyên pixel\) vào .*[\\/]s[\\/]inbox[\\/]ART-….png/); assert.match(brief, /xoá ảnh đó khỏi inbox và quay lại bước 2/);
  assert.doesNotMatch(brief, /Ảnh được tạo bằng ChatGPT do người dùng thao tác/); assert.doesNotMatch(brief, /tool MCP sinh ảnh nếu role được bật/);
  const team = initial(); const id = update(team, 'create', { request: 'x' });
  update(team, 'art-generator', { id, mode: 'codex' }); assert.equal(team.artGenerator, 'codex');
  assert.equal(team.threads[0].messages.at(-1).text, 'Art sinh ảnh bằng: Codex CLI (tự động, dùng gói ChatGPT)');
});
test('ComfyUI mode: Art checks the local server with comfy.py status, picks an installed model, generates into .office-desk/tmp/comfy, copies only passing images into inbox', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['Lead Dev', 'Art'], workers: { Art: { type: 'Art', task: 'ART-3 nút', files: ['ArtGen/ui/'] } }, messages: [], attachments: [] };
  const brief = rolePrompt({ artGenerator: 'comfyui' }, thread, 'Art', { content: 'x', files }).brief;
  assert.match(brief, /ComfyUI chạy trên máy người dùng/); assert.match(brief, /python \.office-desk\/art\/comfy\.py status/);
  assert.match(brief, /Thoát mã 2 \(ComfyUI chưa chạy\)/); assert.match(brief, /"ComfyUI chưa chạy: mở ComfyUI/); assert.match(brief, /thoát mã 3 \(chưa cài model\)/);
  assert.match(brief, /comfy\.py gen --model <id> --prompt-file \.office-desk\/tmp\/ART-….txt/); assert.match(brief, /--out \.office-desk\/tmp\/comfy\/ART-….png/); assert.match(brief, /timeout 600000/);
  assert.match(brief, /prompt kiểu tag/); assert.match(brief, /prompt câu tự nhiên/); assert.match(brief, /plain flat solid #FF00FF background/);
  assert.match(brief, /sinh từng KEY POSE thành một ảnh riêng/); assert.match(brief, /--keys-dir/); assert.match(brief, /ghi seed vào mục/);
  assert.match(brief, /Đạt: `cp` đúng tệp đó \(giữ nguyên pixel\) vào .*[\\/]s[\\/]inbox[\\/]ART-….png/); assert.match(brief, /ART_LESSONS\.md/);
  assert.doesNotMatch(brief, /codex exec/); assert.doesNotMatch(brief, /Ảnh được tạo bằng ChatGPT do người dùng thao tác/);
  const team = initial(); const id = update(team, 'create', { request: 'x' });
  update(team, 'art-generator', { id, mode: 'comfyui' }); assert.equal(team.artGenerator, 'comfyui');
  assert.equal(team.threads[0].messages.at(-1).text, 'Art sinh ảnh bằng: ComfyUI trên máy (tự động, miễn phí)');
});
test('frame-by-frame animation, both modes: key count chosen per motion in batches, two pass levels, default frame pipeline, processing faults never regenerate', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['Lead Dev', 'Art'], workers: { Art: { type: 'Art', task: 'ANIM hero attack', files: ['ArtGen/hero/'] } }, messages: [], attachments: [] };
  for (const artGenerator of ['chatgpt', 'codex']) {
    const brief = rolePrompt({ artGenerator }, thread, 'Art', { content: 'x', files }).brief;
    assert.doesNotMatch(brief, /8–12/, artGenerator); assert.match(brief, /Số key không cố định/); assert.match(brief, /chia đợt: đợt sau đính kèm các key đã duyệt/); assert.match(brief, /Codex: `-i`/);
    assert.match(brief, /KEY POSE ĐẠT \(lượt sinh ảnh đạt\)/); assert.match(brief, /nền sai \(không trong suốt, ô caro vẽ giả, nền màu\) và thiếu frame giữa KHÔNG tính là trượt/); assert.match(brief, /ANIMATION ĐẠT = đo trên bản phát cuối/);
    for (const item of [/cùng một cách và cùng tham số/, /canvas cố định theo đường chân và tâm thân/, /script nội suy của project/, /tự chọn RIFE nếu Office Desk đã cài/, /RIFE chưa cài thì không tự tải, ghi đề xuất người dùng bấm Cài RIFE/, /optical flow OpenCV/, /chỉ chỉnh nhịp/, /không dùng hoà trộn alpha/]) assert.match(brief, item, artGenerator);
    assert.match(brief, /do khâu xử lý .* KHÔNG sinh lại ảnh/); assert.match(brief, /sinh thêm key nằm giữa hai key đó/);
    assert.match(brief, /Redo có giới hạn \(chỉ tính lần sinh lại vì key pose sai NỘI DUNG/);
  }
  const codex = rolePrompt({ artGenerator: 'codex' }, thread, 'Art', { content: 'x', files }).brief;
  assert.match(codex, /sprite sheet animation chỉ xét mức KEY POSE ĐẠT/); assert.match(codex, /chạy quy trình frame và xét mức ANIMATION ĐẠT/);
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

test('Codex mode: quota exhaustion returns a quota handoff for the app to schedule, and the next turn reviews images already generated', () => {
  const files = filesOf({ id: 's', folder: 'E:\game' });
  const thread = { flow: ['Lead Dev', 'Art'], workers: { Art: { type: 'Art', task: 'ART-3 nút', files: ['ArtGen/ui/'] } }, messages: [], attachments: [] };
  const brief = rolePrompt({ artGenerator: 'codex' }, thread, 'Art', { content: 'x', files }).brief;
  assert.match(brief, /"quota":"codex","retryAt"/); assert.match(brief, /không chạy lại, trả ngay/);
  assert.match(brief, /— chờ duyệt" mà tệp đó vẫn còn/); assert.match(brief, /ghi ngay vào mục của ảnh/);
});

test('Codex mode: Art generates the whole batch first, then reviews it, then redoes the failed items as one batch', () => {
  const files = filesOf({ id: 's', folder: 'E:\game' });
  const thread = { flow: ['Lead Dev', 'Art'], workers: { Art: { type: 'Art', task: 'ART-3 nút', files: ['ArtGen/ui/'] } }, messages: [], attachments: [] };
  const brief = rolePrompt({ artGenerator: 'codex' }, thread, 'Art', { content: 'x', files }).brief;
  assert.match(brief, /SINH CẢ ĐỢT TRƯỚC, CHƯA DUYỆT/); assert.match(brief, /KHÔNG Read \/ duyệt ảnh trong lúc sinh/);
  assert.match(brief, /DUYỆT CẢ ĐỢT/); assert.match(brief, /Duyệt hết cả đợt rồi mới REDO: sinh lại mọi mục trượt thành một đợt/);
  assert.doesNotMatch(brief, /duyệt ngay ảnh đó/);
});

test('Art in Codex mode gets 150 tool turns', () => {
  const { MAX_TURNS, CODEX_ART_MAX_TURNS } = require('../roles.cjs');
  assert.equal(CODEX_ART_MAX_TURNS, 150); assert.equal(MAX_TURNS.Art, 40);
});
