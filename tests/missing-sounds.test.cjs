const { test } = require('node:test'); const assert = require('node:assert/strict');
const { rolePrompt } = require('../prompt.cjs');
const { roleScope, decide } = require('../permissions.cjs');
const { filesOf, ensureFiles, TEMPLATES } = require('../session-files.cjs');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

const files = filesOf({ id: 's', folder: 'E:\\game' });
const thread = type => ({ flow: ['GD', 'Lead Dev', type, 'QA'], workers: { [type]: { type, task: 'Bắn trụ', files: ['Assets/Scripts/'] } }, messages: [], attachments: [] });

test('MISSING_SOUNDS.md is a project file created with a template', () => {
  assert.match(files.missingSounds, /\.office-desk[\\/]MISSING_SOUNDS\.md$/);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-')); const created = ensureFiles({ id: 'x', folder });
  assert.equal(fs.readFileSync(created.missingSounds, 'utf8'), TEMPLATES.missingSounds);
  assert.match(TEMPLATES.missingSounds, /## SND-1 · thiếu/); assert.match(TEMPLATES.missingSounds, /Đang dùng tạm:/);
  fs.rmSync(folder, { recursive: true, force: true });
});

test('Dev, VFX and Anim keep coding with a default sound and record the missing sound; the file is always writable for them', () => {
  for (const type of ['Dev', 'VFX', 'Anim']) {
    const brief = rolePrompt({}, thread(type), type, { content: 'x', files }).brief;
    assert.match(brief, /vẫn viết code, đặt key\/đường dẫn âm thanh đích/, type); assert.match(brief, /trỏ tạm về một sound default/, type);
    assert.match(brief, /không chặn task vì thiếu âm thanh/, type); assert.match(brief, /mục SND-… vào .*MISSING_SOUNDS\.md/, type);
    const scope = roleScope(type, files, ['Assets/Scripts/'], 'E:\\game');
    assert.equal(decide({ scope, mode: 'edit', tool: 'Edit', input: { file_path: files.missingSounds }, cwd: 'E:\\game' }).action, 'allow', type);
    assert.equal(decide({ scope, mode: 'edit', tool: 'Edit', input: { file_path: 'E:\\game\\.office-desk\\PROJECT.md' }, cwd: 'E:\\game' }).action, 'deny', type);
  }
});

test('Sound works the missing list, Lead plans around it and QA does not report placeholder sounds', () => {
  const sound = rolePrompt({}, thread('Sound'), 'Sound', { content: 'x', files }).brief;
  assert.match(sound, /MISSING_SOUNDS\.md \(âm thanh code đang dùng tạm sound default\)/); assert.match(sound, /tạo tệp đúng key\/đường dẫn đích/); assert.match(sound, /"đã có"/);
  const lead = rolePrompt({}, thread('Dev'), 'Lead Dev', { content: 'x', files }).brief;
  assert.match(lead, /không chờ âm thanh, giao Dev làm code với sound tạm/); assert.match(lead, /giao Sound làm các mục SND-…/);
  const qa = rolePrompt({}, thread('Dev'), 'QA', { content: 'x', files }).brief;
  assert.match(qa, /đang dùng sound tạm và đã có mục trong .*MISSING_SOUNDS\.md thì không phải lỗi/);
});
