const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test'); const assert = require('node:assert/strict');
const previewKit = require('../preview-kit.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'preview-kit-'));
// Python có Pillow thì build thật; không có thì bỏ qua test build (kit vẫn được kiểm phần chép).
const PYTHON = ['python', 'python3', 'py'].find(cmd => spawnSync(cmd, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0);
// Project giả: ảnh thường, một chuỗi frame số đệm (fx), một chuỗi ảnh đánh số khác cỡ, một tệp không phải ảnh.
const PROJECT = `
import sys, os
from PIL import Image, ImageDraw
root = sys.argv[1]
def save(rel, size, color):
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    im = Image.new('RGBA', size, (0, 0, 0, 0)); ImageDraw.Draw(im).ellipse([4, 4, size[0] - 4, size[1] - 4], fill=color); im.save(p)
save('assets/images/ui/button.png', (64, 32), (200, 80, 40, 255))
for i in range(1, 6): save(f'input/vfx/fx_hit/hit_{i:04d}.png', (48, 48), (255, 200 - i * 30, 0, 255))
for i in range(1, 4): save(f'input/art/items/gun_{i}.png', (40 + i * 10, 40), (90, 90, 90, 255))
open(os.path.join(root, 'input', 'art', 'items', 'notes.txt'), 'w').write('x')
`;

test('kit has its files and conventions; it is copied into <project>/.office-desk/preview/ once, never overwriting', () => {
  for (const file of [...previewKit.KIT_FILES, 'kit.json']) assert(fs.existsSync(path.join(previewKit.KIT_DIR, file)), file);
  const doc = fs.readFileSync(path.join(previewKit.KIT_DIR, 'KIT.md'), 'utf8');
  for (const rule of ['Quy ước', 'runtime của chính project', 'Không request ra ngoài', 'Spine 4.3', 'Frame anim', 'vfx_effects.js', 'Kiểm trước khi báo xong']) assert(doc.includes(rule), rule);
  const project = temp(), dir = previewKit.dirOf(project);
  assert.equal(dir, path.join(project, '.office-desk', 'preview'));
  const first = previewKit.ensure(project);
  assert.deepEqual(first.copied.sort(), [...previewKit.KIT_FILES, 'kit.json'].sort());
  fs.writeFileSync(path.join(dir, 'template.html'), 'PROJECT COPY');
  const second = previewKit.ensure(project);
  assert.deepEqual(second.copied, []);
  assert.equal(fs.readFileSync(path.join(dir, 'template.html'), 'utf8'), 'PROJECT COPY');
  assert.equal(second.projectVersion, previewKit.kitInfo().version);
  const state = previewKit.status(project);
  assert.equal(state.copied, true); assert.equal(state.vfx, false); assert.equal(state.builtAt, null);
  assert.equal(state.index, path.join(project, 'input', '_preview', 'index.html'));
  fs.writeFileSync(path.join(dir, 'preview.config.json'), JSON.stringify({ out: 'preview-out' }));
  assert.equal(previewKit.indexOf(project), path.join(project, 'preview-out', 'index.html'));
});

test('build writes index.html with the gallery, the frame sequences and links relative to the page', { skip: !PYTHON && 'không có Python + Pillow' }, async () => {
  const project = temp();
  assert.equal(spawnSync(PYTHON, ['-c', PROJECT, project], { encoding: 'utf8' }).status, 0);
  let done;
  const finished = new Promise(resolve => { done = resolve; });
  const started = previewKit.build(project, { onChange: done });
  assert.equal(started.build.running, true);
  await finished;
  const state = previewKit.status(project);
  assert.equal(state.build.code, 0, state.build.log.join('\n') + state.build.error);
  assert(state.builtAt);
  const log = state.build.log.join('\n');
  assert.match(log, /index\.html: 9 images, 0 spine rigs, 2 frame sequences \(1 likely anim\), 0 unreadable/);
  assert.match(log, /no VFX view/); // project chưa có vfx_entry.ts / vfx_effects.js
  const html = fs.readFileSync(state.index, 'utf8');
  assert(!/__ROOT__|__TITLE__|__VFX_EFFECTS__|\/\*__DATA__\*\//.test(html), 'còn token chưa thay');
  assert.match(html, new RegExp(`<title>${path.basename(project)} Asset Preview</title>`));
  const data = JSON.parse(html.slice(html.indexOf('const DATA = ') + 13, html.indexOf('const VFXDATA')).trim().replace(/;$/, ''));
  const seq = data.seqs.find(item => item.anim);
  assert.equal(seq.frames.length, 5); assert.equal(seq.dir, 'input/vfx/fx_hit');
  assert(data.seqs.some(item => !item.anim && item.dir === 'input/art/items' && !item.sameSize));
  assert.equal(data.items.find(item => item.p === 'assets/images/ui/button.png').src, '../../assets/images/ui/button.png');
  assert(fs.existsSync(path.join(path.dirname(state.index), data.items[0].t)), 'thumbnail');
  assert.deepEqual(data.others['input/art/items'].map(item => item.n), ['notes.txt']);
});
