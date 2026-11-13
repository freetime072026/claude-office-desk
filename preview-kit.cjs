// Kit asset-preview (kits/asset-preview/): trang xem trước ảnh, anim Spine, frame anim và VFX của project game (KIT.md).
// Cùng quy tắc với kit QA PLA (qa-kit.cjs): Office Desk giữ bản gốc, project nhận bản chép ở <project>/.office-desk/preview/
// (chỉ chép tệp còn thiếu, không ghi đè) và sửa ở đó. Nút Build preview ở Settings > Preview asset chạy build_preview.py
// của bản project; tiến độ đọc qua status (giao diện hỏi lại mỗi giây khi đang build).
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { APP_DIR } = require('./qa-kit.cjs');

const KIT_DIR = path.join(APP_DIR, 'kits', 'asset-preview');
const KIT_FILES = ['build_preview.py', 'build_vfx.mjs', 'template.html', 'KIT.md', 'vfx_entry.example.ts', 'vfx_effects.example.js'];
const LOG_LINES = 200;
const BUILD_TIMEOUT_MS = 30 * 60 * 1000; // lần đầu tạo vài nghìn thumbnail + PSD lớn
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const kitInfo = () => readJson(path.join(KIT_DIR, 'kit.json')) || { name: 'asset-preview', version: 0 };
const dirOf = project => path.join(project, '.office-desk', 'preview');

// Chép phần còn thiếu của kit vào <project>/.office-desk/preview/, ghi kit.json (version đã chép). Trả { copied, version, projectVersion }.
function ensure(project) {
  const kit = kitInfo(), dir = dirOf(project), copied = [];
  if (!fs.existsSync(KIT_DIR)) return { copied, version: kit.version, projectVersion: null, missing: true };
  for (const file of KIT_FILES) {
    const target = path.join(dir, file);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, file), target);
    copied.push(file);
  }
  const infoFile = path.join(dir, 'kit.json'), current = readJson(infoFile);
  if (!current) { fs.writeFileSync(infoFile, JSON.stringify({ name: kit.name, version: kit.version, copiedAt: new Date().toISOString() }, null, 2) + '\n'); copied.push('kit.json'); }
  return { copied, version: kit.version, projectVersion: current ? current.version : kit.version };
}

// index.html của project: out trong preview.config.json (mặc định input/_preview).
function indexOf(project) {
  const config = readJson(path.join(dirOf(project), 'preview.config.json')) || {};
  return path.join(project, config.out || path.join('input', '_preview'), 'index.html');
}

// Python có Pillow (build_preview.py cần). Trả lệnh, hoặc null kèm lý do.
function findPython() {
  let plain = '';
  for (const cmd of ['python', 'py', 'python3']) {
    const probe = spawnSync(cmd, ['-c', 'import PIL'], { encoding: 'utf8', windowsHide: true });
    if (probe.error) continue;
    if (probe.status === 0) return { cmd };
    plain ||= cmd;
  }
  return { cmd: null, reason: plain ? `Python (${plain}) chưa có Pillow: chạy \`${plain} -m pip install pillow\` (PSB cần thêm psd-tools).` : 'Không tìm thấy Python trên máy (cần Python 3 + Pillow).' };
}

const builds = new Map(); // folder → { running, startedAt, endedAt, code, log: [], error }

function status(project) {
  const kit = kitInfo(), dir = dirOf(project), info = readJson(path.join(dir, 'kit.json')), index = indexOf(project);
  let builtAt = null; try { builtAt = fs.statSync(index).mtimeMs; } catch { /* chưa build */ }
  const run = builds.get(project);
  return {
    folder: project, dir, index, builtAt, version: kit.version, kitMissing: !fs.existsSync(KIT_DIR),
    copied: fs.existsSync(path.join(dir, 'build_preview.py')), projectVersion: info ? info.version : null,
    vfx: fs.existsSync(path.join(dir, 'vfx_entry.ts')) && fs.existsSync(path.join(dir, 'vfx_effects.js')),
    build: run ? { running: run.running, startedAt: run.startedAt, endedAt: run.endedAt, code: run.code, error: run.error, log: run.log.slice(-LOG_LINES) } : null,
  };
}

// Chép kit (nếu thiếu) rồi chạy build_preview.py --root <project> ở nền. onChange: gọi khi xong (publish).
function build(project, { onChange = () => {} } = {}) {
  if (builds.get(project)?.running) return status(project);
  const run = { running: true, startedAt: Date.now(), endedAt: null, code: null, error: '', log: [] };
  builds.set(project, run);
  const finish = (code, error = '') => { if (!run.running) return; run.running = false; run.code = code; run.error = error; run.endedAt = Date.now(); clearTimeout(timer); onChange(); };
  let timer = null;
  try {
    const kit = ensure(project);
    if (kit.missing) { finish(1, 'Không thấy kit asset-preview trong Office Desk (' + KIT_DIR + ').'); return status(project); }
    if (kit.copied.length) run.log.push(`Đã chép kit v${kit.version} vào ${dirOf(project)}: ${kit.copied.join(', ')}`);
    const python = findPython();
    if (!python.cmd) { finish(1, python.reason); return status(project); }
    const child = spawn(python.cmd, ['-B', path.join(dirOf(project), 'build_preview.py'), '--root', project], {
      cwd: project, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const take = chunk => { for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) run.log.push(line); if (run.log.length > LOG_LINES * 2) run.log.splice(0, run.log.length - LOG_LINES); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('error', error => finish(1, error.message));
    child.on('close', code => finish(code, code === 0 ? '' : 'build_preview.py dừng với mã ' + code + ' (xem log).'));
    timer = setTimeout(() => { try { child.kill(); } catch { /* đã dừng */ } finish(1, 'Quá 30 phút, đã dừng build.'); }, BUILD_TIMEOUT_MS);
  } catch (error) { finish(1, error.message); }
  return status(project);
}

module.exports = { KIT_DIR, KIT_FILES, kitInfo, dirOf, ensure, indexOf, findPython, status, build };
