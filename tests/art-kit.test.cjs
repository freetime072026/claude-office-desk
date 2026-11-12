const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test'); const assert = require('node:assert/strict');
const artKit = require('../art-kit.cjs');
const { rolePrompt } = require('../prompt.cjs');
const { filesOf } = require('../session-files.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'art-kit-'));
// Python của máy có numpy + Pillow thì chạy thật frames.py; không có thì bỏ qua các test chạy script.
const PYTHON = ['python', 'python3', 'py'].find(cmd => spawnSync(cmd, ['-c', 'import numpy, PIL'], { encoding: 'utf8' }).status === 0);
const py = (args, options = {}) => spawnSync(PYTHON, ['-B', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, ...options });
// Sheet giả: nhân vật que trên nền ô caro vẽ giả (#FFFFFF/#CCCCCC), lưới 3x2, 5 pose lệch vị trí trong ô, kiếm xoay theo `angles`.
const SHEET = `
import math, sys
from PIL import Image, ImageDraw
out, angles = sys.argv[1], [float(a) for a in sys.argv[2].split(',')]
cols, rows, cell = 3, 2, 256
sheet = Image.new('RGB', (cols * cell, rows * cell)); d = ImageDraw.Draw(sheet)
for y in range(0, rows * cell, 16):
    for x in range(0, cols * cell, 16):
        d.rectangle([x, y, x + 15, y + 15], fill=(255, 255, 255) if (x // 16 + y // 16) % 2 == 0 else (204, 204, 204))
for i, angle in enumerate(angles):
    ox, oy = (i % cols) * cell + 100 + (i * 7) % 20, (i // cols) * cell + 40 + (i * 5) % 15
    foot = oy + 190
    d.rectangle([ox - 22, oy + 70, ox + 22, foot - 50], fill=(40, 90, 200), outline=(20, 20, 30), width=4)
    d.ellipse([ox - 28, oy + 10, ox + 28, oy + 66], fill=(250, 210, 170), outline=(20, 20, 30), width=4)
    d.rectangle([ox - 20, foot - 50, ox - 6, foot], fill=(60, 60, 70), outline=(20, 20, 30), width=3)
    d.rectangle([ox + 6, foot - 50, ox + 20, foot], fill=(60, 60, 70), outline=(20, 20, 30), width=3)
    sx, sy = ox + 18, oy + 90
    d.line([sx, sy, sx + 70 * math.cos(math.radians(angle)), sy + 70 * math.sin(math.radians(angle))], fill=(20, 20, 30), width=12)
sheet.save(out)
`;

test('kit is copied into <project>/.office-desk/art/ once, never overwriting the project copy; guide points Art at one run command', () => {
  const files = filesOf({ id: 's', folder: temp() }), dir = artKit.dirOf(files);
  assert.match(dir, /[\\/]\.office-desk[\\/]art[\\/]$/);
  const first = artKit.ensure(dir);
  assert.deepEqual(first.copied.sort(), [...artKit.KIT_FILES, 'kit.json'].sort()); assert(artKit.KIT_FILES.includes('frames.py')); assert.equal(first.projectVersion, first.version);
  fs.writeFileSync(path.join(dir, 'frames.py'), '# project edit\n');
  assert.deepEqual(artKit.ensure(dir).copied, []); assert.equal(fs.readFileSync(path.join(dir, 'frames.py'), 'utf8'), '# project edit\n');
  const guide = artKit.guide(first, dir);
  assert.match(guide, /frames\.py" run --sheet/); assert.match(guide, /kể cả ảnh trong thư mục ảnh của Codex/); assert.match(guide, /nên sinh thêm key giữa X và Y/); assert.match(guide, /không tính lần trượt/);
  assert.match(artKit.guide({ copied: [], version: 3, projectVersion: 1 }, dir), /kit v3 mới hơn bản project \(v1\)/);
  assert.equal(artKit.guide({ missing: true }, dir), '');
});
test('Art prompt carries the kit guide (ChatGPT and Codex modes) and the frame rule prefers project script, then the kit', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['Art'], workers: { Art: { type: 'Art', task: 'ANIM idle', files: ['ArtGen/'] } }, messages: [], attachments: [] };
  const brief = rolePrompt({ artGenerator: 'codex' }, thread, 'Art', { content: 'x', files, artKit: 'KIT-GUIDE-LINE' }).brief;
  assert.match(brief, /KIT-GUIDE-LINE/); assert.match(brief, /dùng kit art-frames của Office Desk ở \.office-desk\/art\/frames\.py, làm trọn a–e bằng một lệnh/);
  assert.match(brief, /script nội suy của project \(vd interpolate_\*\.py\) → kit art-frames/);
  assert.doesNotMatch(rolePrompt({}, { ...thread, flow: ['Dev'], workers: { Dev: { type: 'Dev', task: 't', files: ['src/'] } } }, 'Dev', { content: 'x', files, artKit: 'KIT-GUIDE-LINE' }).brief, /KIT-GUIDE-LINE/);
});
test('frames.py: fake checkerboard removed, keys found by grid and auto, feet aligned on one canvas, far sword swings held with an extra-key hint', { skip: !PYTHON && 'python with numpy + Pillow not found' }, () => {
  const dir = temp(), sheet = path.join(dir, 'sheet.png'), script = path.join(artKit.KIT_DIR, 'frames.py');
  assert.equal(py(['-c', SHEET, sheet, '-60,-20,20,60,100']).status, 0);
  for (const split of [['--grid', '3x2', '--count', '5'], []]) {
    const out = path.join(dir, 'out' + split.length), run = py([script, 'run', '--sheet', sheet, ...split, '--between', '2', '--out', out]);
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
    assert.equal(report.keys, 5); assert.equal(report.frames, 13); assert.equal(report.background.mode, 'màu-nền');
    assert.deepEqual([...report.background.colors].sort(), ['#CCCCCC', '#FFFFFF']);
    assert(report.pairs.every(pair => pair.method === 'hold'), 'sword swings 40° per key: never interpolated');
    assert(report.flags.some(flag => /nên sinh thêm key giữa|không có cv2/.test(flag)));
    assert(!report.flags.some(flag => /lệch chân/.test(flag)), report.flags.join('\n'));
    for (const file of ['sheet.png', 'contact.png', 'preview.gif', 'report.md', 'frames/frame_013.png']) assert(fs.existsSync(path.join(out, file)), file);
  }
});
test('frames.py motion(): a 2 px shift is near, a 40° sword swing is far (relative to figure height)', { skip: !PYTHON && 'python with numpy + Pillow not found' }, () => {
  const probe = `
import sys
sys.path.insert(0, sys.argv[1])
import numpy as np, frames as F
from PIL import Image, ImageDraw
def figure(angle, dy=0):
    img = Image.new('RGBA', (200, 260), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([80, 80 + dy, 120, 200 + dy], fill=(40, 90, 200, 255)); d.ellipse([72, 20 + dy, 128, 76 + dy], fill=(250, 210, 170, 255))
    import math; d.line([118, 100 + dy, 118 + 70 * math.cos(math.radians(angle)), 100 + dy + 70 * math.sin(math.radians(angle))], fill=(20, 20, 30, 255), width=10)
    return np.asarray(img).copy()
print(round(F.motion(figure(0), figure(0, 2))[0], 4), round(F.motion(figure(-20), figure(20))[0], 4))
`;
  const result = py(['-c', probe, artKit.KIT_DIR]); assert.equal(result.status, 0, result.stderr);
  const [shift, swing] = result.stdout.trim().split(/\s+/).map(Number);
  assert(shift <= 0.03, `shift ${shift}`); assert(swing > 0.03, `swing ${swing}`);
});

// scene.py: lỗi PA0008 (Game-13) — nền vẽ lại mất object vẽ sẵn, ảnh rào thay thế lệch chỗ ảnh cũ, rào đặt gãy khúc.
const SCENE = `
import sys
from PIL import Image, ImageDraw
d = sys.argv[1]
bg = Image.new('RGB', (600, 400), (240, 200, 150)); g = ImageDraw.Draw(bg)
g.rectangle([60, 60, 200, 120], fill=(150, 90, 50), outline=(30, 20, 10), width=5)   # rào vẽ sẵn
g.ellipse([380, 220, 460, 300], fill=(160, 60, 60), outline=(30, 20, 10), width=5)  # thùng phuy vẽ sẵn
bg.save(d + '/bg_old.png')
Image.new('RGB', (600, 400), (240, 200, 150)).save(d + '/bg_new.png')               # nền vẽ lại: mất cả hai
old = Image.new('RGBA', (300, 160)); ImageDraw.Draw(old).polygon([(0, 150), (300, 0), (300, 20), (0, 160)], fill=(120, 80, 40, 255))
old.save(d + '/fence_old.png')
same = Image.new('RGBA', (300, 160)); ImageDraw.Draw(same).polygon([(0, 150), (300, 0), (300, 20), (0, 160)], fill=(60, 160, 60, 255))
same.save(d + '/fence_same.png')
moved = Image.new('RGBA', (300, 160)); ImageDraw.Draw(moved).polygon([(60, 150), (300, 30), (300, 50), (60, 160)], fill=(60, 160, 60, 255))
moved.save(d + '/fence_moved.png')
`;
test('scene.py: baked lists objects drawn into a background, swap fails a replacement that moved, line fails a bent fence', { skip: !PYTHON && 'python with numpy + Pillow not found' }, () => {
  const dir = temp(), script = path.join(artKit.KIT_DIR, 'scene.py');
  assert.equal(py(['-c', SCENE, dir]).status, 0);
  const baked = py([script, 'baked', '--img', path.join(dir, 'bg_old.png'), '--out', path.join(dir, 'baked.png')]);
  assert.equal(baked.status, 0, baked.stderr); assert.match(baked.stdout, /2 object/); assert(fs.existsSync(path.join(dir, 'baked.png')));
  assert.match(py([script, 'baked', '--img', path.join(dir, 'bg_new.png')]).stdout, /0 object/);
  const same = py([script, 'swap', '--old', path.join(dir, 'fence_old.png'), '--new', path.join(dir, 'fence_same.png')]);
  assert.equal(same.status, 0, same.stdout); assert.match(same.stdout, /=> ĐẠT/);
  const moved = py([script, 'swap', '--old', path.join(dir, 'fence_old.png'), '--new', path.join(dir, 'fence_moved.png')]);
  assert.equal(moved.status, 1); assert.match(moved.stdout, /khung alpha .*LỆCH/); assert.match(moved.stdout, /=> TRƯỢT/);
  assert.equal(py([script, 'line', '--points', '100,500', '300,400', '500,300', '700,200', '--slope', '0.5']).status, 0);
  const bent = py([script, 'line', '--points', '100,500', '300,400', '500,290', '700,170', '--slope', '0.5']);
  assert.equal(bent.status, 1); assert.match(bent.stdout, /TRƯỢT/);
  const cmp = py([script, 'compare', '--ref', path.join(dir, 'bg_old.png'), '--shot', path.join(dir, 'bg_new.png'), '--out', path.join(dir, 'cmp.png')]);
  assert.equal(cmp.status, 0, cmp.stderr); assert(fs.existsSync(path.join(dir, 'cmp.png')));
});
test('Art Director and Art prompts carry the ref inventory, drop-in and whole-scene review rules plus the scene kit; an AD turn keeps the RIFE state in kit.json', () => {
  const files = filesOf({ id: 's', folder: 'E:\game' });
  const thread = { flow: ['Art Director', 'Art'], workers: { 'Art Director': { type: 'Art Director' }, Art: { type: 'Art', task: 'ART-1', files: ['assets/'] } }, messages: [], attachments: [] };
  const planning = rolePrompt({}, thread, 'Art Director', { content: 'x', files, artKit: 'SCENE-KIT' }).brief;
  assert.match(planning, /bảng kiểm kê ref/); assert.match(planning, /scene\.py baked/); assert.match(planning, /thả vào là khớp/); assert.match(planning, /SCENE-KIT/);
  thread.adPhase = 'review'; const review = rolePrompt({}, thread, 'Art Director', { content: 'x', files, artKit: 'SCENE-KIT' }).brief;
  assert.match(review, /kiểm cả cảnh, không chỉ Read từng ảnh/); assert.match(review, /scene\.py compare/); assert.match(review, /Không pass khi còn dòng kiểm kê chưa kiểm/);
  const art = rolePrompt({ artGenerator: 'tool' }, thread, 'Art', { content: 'x', files, artKit: 'SCENE-KIT' }).brief;
  assert.match(art, /scene\.py swap phải ĐẠT/); assert.match(art, /không tự bỏ object/); assert.match(art, /SCENE-KIT/);
  const dir = path.join(temp(), 'art') + path.sep;
  artKit.ensure(dir, { rife: { installed: true, exe: 'C:/rife.exe', model: 'm' } });
  const info = artKit.ensure(dir); // lượt Art Director: không truyền trạng thái RIFE
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8')).rife, 'C:/rife.exe');
  assert(artKit.KIT_FILES.includes('scene.py')); assert.match(artKit.sceneGuide(info, dir), /scene\.py" baked --img/); assert.equal(artKit.sceneGuide({ missing: true }, dir), '');
});
