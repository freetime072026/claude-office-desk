const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const attachments = require('../attachments.cjs');
const { buildPrompt } = require('../prompt.cjs');
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'office-attach-'));

test('image type comes from magic bytes, not the name', () => {
  assert.equal(attachments.imageType(PNG), '.png');
  assert.equal(attachments.imageType(Uint8Array.from([255, 216, 255, 224])), '.jpg');
  assert.equal(attachments.imageType(Buffer.from('RIFF0000WEBPVP8 ')), '.webp');
  assert.equal(attachments.imageType(Buffer.from('GIF89a......')), '.gif');
  assert.equal(attachments.imageType(Buffer.from('<svg xmlns=')), null);
});

test('pasted bytes are saved under the app folder with a safe display name; non-images and oversize are refused', () => {
  const base = root(), thread = { id: 't1' };
  const item = attachments.save(base, thread, PNG, '..\\..\\evil\u0007.png');
  assert.equal(path.dirname(item.path), path.join(base, 'attachments', 't1')); assert.equal(path.extname(item.path), '.png');
  assert.equal(item.name, 'evil.png'); assert.equal(attachments.save(base, thread, PNG, '').name, 'ảnh dán.png');
  assert.throws(() => attachments.save(base, thread, Buffer.from('not an image'), 'x.png'), /PNG, JPEG, WebP hoặc GIF/);
  assert.throws(() => attachments.save(base, thread, 'string', 'x.png'), /dữ liệu ảnh/);
  assert.throws(() => attachments.save(base, thread, new Uint8Array(attachments.MAX_BYTES + 1), 'x.png'), /20 MB/);
});

test('at most 8 pending images; taking them empties the composer list', () => {
  const base = root(), thread = { id: 't2' };
  for (let index = 0; index < attachments.MAX_PENDING; index++) attachments.save(base, thread, PNG, index + '.png');
  assert.throws(() => attachments.save(base, thread, PNG, 'x.png'), /Tối đa 8 ảnh/);
  const taken = attachments.take(thread); assert.equal(taken.length, 8); assert.deepEqual(thread.attachments, []);
});

test('preview and remove only touch images inside the app attachments folder', () => {
  const base = root(), thread = { id: 't3' }, item = attachments.save(base, thread, PNG, 'a.png');
  assert.match(attachments.preview(base, item.path), /^data:image\/png;base64,iVBORw0KGgo/);
  const outside = path.join(base, 'outside.png'); fs.writeFileSync(outside, PNG);
  assert.throws(() => attachments.preview(base, outside), /không thuộc app/);
  assert.throws(() => attachments.remove(base, thread, outside), /không còn trong tin/);
  attachments.remove(base, thread, item.path); assert.equal(fs.existsSync(item.path), false); assert.deepEqual(thread.attachments, []);
});

test('a file dropped from disk is copied after the same checks', () => {
  const base = root(), source = path.join(base, 'shot.png'); fs.writeFileSync(source, PNG);
  const thread = { id: 't4' }, item = attachments.saveFile(base, thread, source);
  assert.equal(item.name, 'shot.png'); assert.notEqual(item.path, source);
  const fake = path.join(base, 'fake.png'); fs.writeFileSync(fake, 'text'); assert.throws(() => attachments.saveFile(base, thread, fake), /PNG/);
});

test('the prompt lists only the images sent with this message', () => {
  assert.match(buildPrompt({ content: 'Xem ảnh', attachments: [{ path: 'C:\\a\\1.png', name: 'màn hình.png' }] }).text, /Ảnh tham chiếu đính kèm tin này, dùng Read để xem:\nC:\\a\\1\.png \(màn hình\.png\)/);
  assert.doesNotMatch(buildPrompt({ content: 'Tiếp' }).text, /Ảnh tham chiếu/);
});
