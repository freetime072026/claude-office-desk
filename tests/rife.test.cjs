const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { createRife, tarExtract, tarPath, urlOf, KEEP_MODELS, SIZE_MB } = require('../rife.cjs');
const artKit = require('../art-kit.cjs');
const { filesOf } = require('../session-files.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rife-'));
const PYTHON = ['python', 'python3', 'py'].find(cmd => spawnSync(cmd, ['-c', 'import numpy, PIL'], { encoding: 'utf8' }).status === 0);
const exeName = process.platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan';
// Gói zip giả giống gói phát hành: <tên>/exe + nhiều thư mục model.
function fakeRelease(dir) {
  const stage = path.join(dir, 'stage'), top = path.join(stage, 'rife-ncnn-vulkan-20221029-windows');
  for (const model of ['rife', 'rife-anime', 'rife-v2.3', 'rife-v4', 'rife-v4.6']) { fs.mkdirSync(path.join(top, model), { recursive: true }); fs.writeFileSync(path.join(top, model, 'flownet.bin'), 'x'); }
  fs.writeFileSync(path.join(top, exeName), 'exe'); fs.writeFileSync(path.join(top, 'vcomp140.dll'), 'dll');
  const zip = path.join(dir, 'release.zip');
  execFileSync(tarPath(), ['-a', '-cf', zip, '-C', stage, 'rife-ncnn-vulkan-20221029-windows'], { windowsHide: true });
  return zip;
}

test('Windows uses System32 tar.exe (Git Bash GNU tar cannot read zip and treats C: as a host)', () => {
  if (process.platform === 'win32') assert.equal(path.basename(tarPath('win32')).toLowerCase(), 'tar.exe'), assert.equal(path.basename(path.dirname(tarPath('win32'))).toLowerCase(), 'system32');
  assert.equal(tarPath('linux'), 'tar');
});
test('release URL per platform, ~430 MB, keeps only models that take any time step', () => {
  assert.equal(urlOf('win32'), 'https://github.com/nihui/rife-ncnn-vulkan/releases/download/20221029/rife-ncnn-vulkan-20221029-windows.zip');
  assert.match(urlOf('darwin'), /macos\.zip$/); assert.match(urlOf('linux'), /ubuntu\.zip$/); assert.equal(urlOf('aix'), '');
  assert.equal(SIZE_MB, 430); assert.deepEqual(KEEP_MODELS, ['rife-v4.6', 'rife-v4']);
});
test('install: download with progress, extract, prune old models, locate exe; asks only once per app run', async () => {
  const root = temp(), zip = fakeRelease(temp()), progress = [], changes = [];
  const download = async (url, target, report) => { assert.equal(url, urlOf('win32')); for (const ratio of [0.1, 0.5, 1]) report(ratio); fs.copyFileSync(zip, target); progress.push('done'); };
  const rife = createRife({ root, platform: 'win32', download, extract: tarExtract, changed: () => changes.push(rife?.state().progress) });
  assert.equal(rife.state().installed, false);
  assert.equal(rife.shouldAsk(), true); assert.equal(rife.shouldAsk(), false, 'not again in this app run');
  const state = await rife.install();
  assert.equal(state.installed, true); assert.equal(state.installing, false); assert.equal(state.error, '');
  assert.equal(path.basename(state.exe), exeName); assert.equal(path.basename(state.model), 'rife-v4.6');
  const top = path.dirname(state.exe);
  assert.deepEqual(fs.readdirSync(top).filter(name => name.startsWith('rife-') && fs.statSync(path.join(top, name)).isDirectory()).sort(), ['rife-v4', 'rife-v4.6']);
  assert(fs.existsSync(path.join(top, 'vcomp140.dll')));
  assert(!fs.readdirSync(path.join(root, 'tools', 'rife')).some(name => name.endsWith('.zip') || name.endsWith('.part')), 'zip removed after install');
  assert(changes.length >= 2); assert.deepEqual(progress, ['done']);
  // App mở lại: tự nhận bản đã cài, không hỏi nữa.
  const again = createRife({ root, platform: 'win32' }); assert.equal(again.state().installed, true); assert.equal(again.shouldAsk(), false);
});
test('failed download: error kept, nothing half-installed, the button can retry', async () => {
  const root = temp();
  const rife = createRife({ root, platform: 'win32', download: async () => { throw Error('Tải RIFE lỗi HTTP 503'); } });
  await assert.rejects(rife.install(), /HTTP 503/);
  assert.equal(rife.state().installed, false); assert.equal(rife.state().installing, false); assert.match(rife.state().error, /503/);
  assert.equal(createRife({ root, platform: 'aix' }).state().supported, false);
  await assert.rejects(createRife({ root: temp(), platform: 'aix' }).install(), /Chưa có bản RIFE/);
});
test('project kit.json carries the RIFE path once installed (and drops it when gone); guide says whether the kit uses RIFE', () => {
  const dir = artKit.dirOf(filesOf({ id: 's', folder: temp() }));
  const off = artKit.ensure(dir, { rife: { installed: false } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8')).rife, '');
  assert.match(artKit.guide(off, dir), /Máy chưa cài RIFE .*không tự tải RIFE/);
  const on = artKit.ensure(dir, { rife: { installed: true, exe: 'C:\\tools\\rife\\rife-ncnn-vulkan.exe', model: 'C:\\tools\\rife\\rife-v4.6' } });
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'kit.json'), 'utf8'));
  assert.equal(info.rife, 'C:\\tools\\rife\\rife-ncnn-vulkan.exe'); assert.equal(info.rifeModel, 'C:\\tools\\rife\\rife-v4.6'); assert.equal(info.name, 'art-frames');
  assert.match(artKit.guide(on, dir), /RIFE đã cài trên máy/);
  assert.match(artKit.guide(artKit.ensure(dir, { rife: { installed: false, installing: true } }), dir), /RIFE đang được Office Desk tải/);
});
test('frames.py drives RIFE: -0/-1/-o/-s/-m per in-between, colour and alpha passes, CPU retry when the GPU fails', { skip: !PYTHON && 'python with numpy + Pillow not found' }, () => {
  const dir = temp(), fake = path.join(__dirname, 'fixtures', 'fake-rife.py');
  const exe = path.join(dir, process.platform === 'win32' ? 'rife.cmd' : 'rife.sh');
  fs.writeFileSync(exe, process.platform === 'win32' ? `@"${PYTHON}" -B "${fake}" %*\r\n` : `#!/bin/sh\nexec "${PYTHON}" -B "${fake}" "$@"\n`, { mode: 0o755 });
  const model = path.join(dir, 'rife-v4.6'); fs.mkdirSync(model);
  // Hai key: khối vuông dịch 6 px (quãng dịch nhỏ, trong ngưỡng RIFE), nền trong suốt thật.
  const make = `
import sys
from PIL import Image, ImageDraw
for i, dx in enumerate((0, 6)):
    img = Image.new('RGBA', (120, 160), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    d.rectangle([30 + dx, 20, 90 + dx, 150], fill=(200, 40, 40, 255), outline=(10, 10, 10, 255), width=3)
    img.save(sys.argv[1] + f'/key_{i + 1:02d}.png')
`;
  const keys = path.join(dir, 'keys'); fs.mkdirSync(keys);
  assert.equal(spawnSync(PYTHON, ['-B', '-c', make, keys]).status, 0);
  const log = path.join(dir, 'calls.jsonl'), out = path.join(dir, 'out');
  const run = spawnSync(PYTHON, ['-B', path.join(artKit.KIT_DIR, 'frames.py'), 'run', '--keys-dir', keys, '--between', '2', '--rife', exe, '--rife-model', model, '--out', out],
    { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', FAKE_RIFE_LOG: log, FAKE_RIFE_FAIL_GPU: '1' } });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.pairs[0].method, 'rife', JSON.stringify(report.pairs)); assert.equal(report.frames, 4); assert.equal(report.rife, exe);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  // 2 frame giữa × (màu + alpha) × (GPU lỗi + thử lại CPU) = 8 lần gọi; mỗi lần đủ -0 -1 -o -s -m.
  assert.equal(calls.length, 8);
  for (const call of calls) for (const flag of ['-0', '-1', '-o', '-s', '-m']) assert(call.includes(flag), flag);
  assert.deepEqual([...new Set(calls.map(call => call[call.indexOf('-s') + 1]))].sort(), ['0.2500', '0.7500'], 'ease in-out times for 2 in-betweens');
  assert.equal(calls.filter(call => call.includes('-g')).length, 4, 'CPU retry after each GPU failure');
  // Frame giữa: alpha ghép lại đúng (vùng giữa khối đặc, góc ngoài khối trong suốt), màu tách khỏi nền xám đúng.
  const probe = spawnSync(PYTHON, ['-B', '-c', `
import sys, numpy as np
from PIL import Image
f = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
print(int(f[80, 60, 3]), int(f[2, 2, 3]), int(f[80, 60, 0]), int(f[80, 60, 1]))`, path.join(out, 'frames', 'frame_002.png')], { encoding: 'utf8' });
  const [inside, corner, red, green] = probe.stdout.trim().split(/\s+/).map(Number);
  assert.equal(inside, 255); assert.equal(corner, 0); assert(red > 180 && green < 70, `colour ${red},${green}`);
});
