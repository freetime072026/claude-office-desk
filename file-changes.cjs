// Tệp Dev/VFX tạo hoặc sửa trong một lượt, do app tự ghi (không dựa vào lời model): gộp tệp từ Write/Edit (chat.cjs
// ghi vào message.fileOps) với thay đổi git trong phạm vi tệp của khối (bắt cả tệp tạo bằng script Python/Bash).
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const GIT_TIMEOUT_MS = 8000;
const LIST_LIMIT = 40;
const rel = (folder, file) => path.relative(folder, path.resolve(folder, file)).split(path.sep).join('/');
// git status trong các đường dẫn phạm vi → Map(đường dẫn tương đối → mã 2 ký tự). null khi không phải repo git hoặc lỗi.
function gitStatus(folder, paths = []) {
  if (!folder || !paths.length) return null;
  try {
    const specs = paths.map(item => rel(folder, item.replace(/[\\/]+$/, '')) || '.');
    const out = execFileSync('git', ['-C', folder, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...specs], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const entries = new Map(), parts = out.split('\0');
    for (let index = 0; index < parts.length; index++) {
      const entry = parts[index]; if (entry.length < 4) continue;
      const code = entry.slice(0, 2); entries.set(entry.slice(3), code);
      if (code[0] === 'R' || code[0] === 'C') index++; // đổi tên: phần tử kế tiếp là tên cũ
    }
    return entries;
  } catch { return null; }
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
