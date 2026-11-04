// Tệp Dev/VFX tạo hoặc sửa trong một lượt, do app tự ghi (không dựa vào lời model): gộp tệp từ Write/Edit (chat.cjs
// ghi vào message.fileOps) với thay đổi git trong phạm vi tệp của khối (bắt cả tệp tạo bằng script Python/Bash).
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const GIT_TIMEOUT_MS = 8000;
const LIST_LIMIT = 40;
// Tệp trong thư mục chính: đường dẫn tương đối; tệp ở thư mục liên quan của session (task giao đường dẫn tuyệt đối): đường dẫn tuyệt đối.
const slash = file => file.split(path.sep).join('/');
const inside = (folder, file) => { const relative = path.relative(folder, file); return !relative.startsWith('..') && !path.isAbsolute(relative); };
const rel = (folder, file) => { const full = path.resolve(folder, file); return inside(folder, full) ? slash(path.relative(folder, full)) : slash(full); };
const git = (folder, args) => execFileSync('git', ['-C', folder, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
function porcelain(out, key) {
  const entries = new Map(), parts = out.split('\0');
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index]; if (entry.length < 4) continue;
    const code = entry.slice(0, 2); entries.set(key(entry.slice(3)), code);
    if (code[0] === 'R' || code[0] === 'C') index++; // đổi tên: phần tử kế tiếp là tên cũ
  }
  return entries;
}
// git status trong các đường dẫn phạm vi → Map(đường dẫn → mã 2 ký tự). null khi không phải repo git hoặc lỗi.
// folders: các thư mục của session (chính đứng đầu); đường dẫn phạm vi nằm ở thư mục liên quan được hỏi git của thư mục đó.
function gitStatus(folder, paths = [], folders = [folder]) {
  if (!folder || !paths.length) return null;
  const others = folders.filter(item => item && path.resolve(item) !== path.resolve(folder));
  const groups = new Map([[folder, []], ...others.map(item => [item, []])]);
  for (const item of paths) { const bare = path.resolve(folder, item.replace(/[\\/]+$/, '')); const owner = [folder, ...others].find(candidate => inside(candidate, bare)) || folder; groups.get(owner).push(bare); }
  let result = null;
  for (const [owner, items] of groups) {
    if (!items.length) continue;
    try {
      const specs = items.map(item => slash(path.relative(owner, item)) || '.');
      const out = git(owner, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...specs]);
      // Thư mục chính giữ khoá như cũ (theo gốc repo); thư mục khác đổi sang đường dẫn tuyệt đối để khớp rel().
      const top = owner === folder ? '' : git(owner, ['rev-parse', '--show-toplevel']).trim();
      for (const [file, code] of porcelain(out, file => top ? slash(path.resolve(top, file)) : file)) (result ||= new Map()).set(file, code);
    } catch {}
  }
  return result;
}
const kindOf = code => code === '??' || code.includes('A') ? 'created' : code.includes('D') ? 'deleted' : 'edited';
// before/after: Map từ gitStatus (có thể null); fileOps: { đường dẫn: 'created' | 'edited' } từ tool.
function changedFiles({ folder, before, after, fileOps = {} }) {
  const result = new Map();
  for (const [file, kind] of Object.entries(fileOps)) result.set(rel(folder, file), kind);
  for (const [file, code] of after || []) if (!before || before.get(file) !== code) { const kind = kindOf(code); if (!result.has(file) || kind !== 'edited') result.set(file, kind); }
  const list = kind => [...result].filter(([, value]) => value === kind).map(([file]) => file).sort();
  return { created: list('created'), edited: list('edited'), deleted: list('deleted') };
}
const clipList = files => files.length > LIST_LIMIT ? [...files.slice(0, LIST_LIMIT), `… và ${files.length - LIST_LIMIT} tệp khác`] : files;
function changesText({ created, edited, deleted }) {
  return [created.length ? 'Tạo mới: ' + clipList(created).join(', ') : '', edited.length ? 'Sửa: ' + clipList(edited).join(', ') : '', deleted.length ? 'Xoá: ' + clipList(deleted).join(', ') : ''].filter(Boolean).join('\n');
}
module.exports = { gitStatus, changedFiles, changesText, kindOf };
