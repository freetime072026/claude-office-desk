const fs = require('node:fs'); const path = require('node:path');
const extensions = new Set(['.md', '.txt', '.json', '.csv', '.tsv', '.yaml', '.yml', '.xml', '.cs', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.htm', '.css', '.scss', '.shader', '.hlsl', '.cginc', '.compute', '.glsl', '.py', '.lua', '.gd', '.sh', '.bat', '.cmd', '.ps1', '.log', '.toml', '.ini', '.cfg', '.uxml', '.uss', '.prefab', '.unity', '.asset', '.mat', '.meta', '.asmdef', '.anim', '.controller', '.shadergraph', '.inputactions', '.gradle', '.plist', '.java', '.kt', '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.sql', '.svg']);
// Ảnh trong dự án: trả data URL để renderer hiển thị trực tiếp (CSP chỉ cho img-src 'self' data:).
const images = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const MAX_TEXT = 2 * 1024 * 1024, MAX_IMAGE = 20 * 1024 * 1024;
// Chuẩn hoá tham chiếu lấy từ chat: file:/// URL, %20, <path>, hậu tố :dòng[:cột] hoặc #L12.
function cleanReference(reference) {
  let clean = reference.trim().replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/^<(.+)>$/, '$1');
  if (/^file:\/\//i.test(clean)) { clean = clean.replace(/^file:\/\/(localhost)?/i, ''); if (/^\/[A-Za-z]:/.test(clean)) clean = clean.slice(1); }
  if (/%[0-9a-f]{2}/i.test(clean)) { try { clean = decodeURIComponent(clean); } catch {} }
  clean = clean.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '');
  // Đường dẫn kiểu Git Bash (/e/FreeTimes/x, /c/Users/...) → E:/FreeTimes/x.
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(clean)) clean = clean[1].toUpperCase() + ':' + clean.slice(2);
  return clean;
}
// Thư mục bỏ qua khi tìm tệp theo tên (nặng, sinh ra, hoặc bí mật).
const SKIP_DIRS = /^(node_modules|\.git|\.claude|Library|Temp|Logs|obj|dist|build|release|verify|\.cache|\.next|\.vs|\.idea|drive-download-.*)$/i;
const WALK_LIMIT = 30000, WALK_DEPTH = 10, CACHE_MS = 30 * 1000;
const found = new Map(); // root + '\n' + tên → { path, at }
// Tên tệp trần (ISSUES.md, Stage.ts) hoặc đường dẫn thiếu phần đầu (ui/EndCard.ts) mà model nhắc trong chat: tìm trong cây thư mục.
// Ưu tiên tài liệu của session (.office-desk/<session>/), rồi .office-desk/, rồi đường dẫn nông nhất.
function findByName(root, clean, sessionId) {
  const key = root + '\n' + clean + '\n' + (sessionId || ''), hit = found.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.path;
  const tail = path.sep + path.normalize(clean).replace(/^[\\/]+/, '').toLowerCase();
  const matches = []; let seen = 0;
  const walk = (dir, depth) => {
    if (depth > WALK_DEPTH || seen > WALK_LIMIT) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++seen > WALK_LIMIT) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.test(entry.name)) walk(full, depth + 1); }
      else if (entry.isFile() && full.toLowerCase().endsWith(tail)) matches.push(full);
    }
  };
  walk(root, 0);
  const rank = file => { const rel = path.relative(root, file).toLowerCase(); return (sessionId && rel.startsWith(path.join('.office-desk', sessionId.toLowerCase()) + path.sep) ? 0 : rel.startsWith('.office-desk' + path.sep) ? 1 : 2) * 1000 + rel.split(path.sep).length; };
  const best = matches.sort((a, b) => rank(a) - rank(b))[0] || '';
  found.set(key, { path: best, at: Date.now() }); if (found.size > 500) found.delete(found.keys().next().value);
  return best;
}
// roots: thư mục của session (tệp được tìm cả theo tên trong đó); readOnlyRoots: chỉ mở theo đường dẫn đầy đủ (thư mục tạm: ảnh QA chụp).
function readProjectFile(reference, roots, { sessionId = '', readOnlyRoots = [] } = {}) {
  if (typeof reference !== 'string' || reference.length > 2000) throw Error('Đường dẫn không hợp lệ');
  const clean = cleanReference(reference), extension = path.extname(clean).toLowerCase(), mime = images[extension];
  if (!mime && !extensions.has(extension)) throw Error('Chỉ xem tệp văn bản hoặc ảnh được hỗ trợ');
  // Thư mục của session đã bị xoá/đổi tên thì bỏ qua thay vì lỗi ENOENT cho mọi link.
  const real = folder => { try { return fs.realpathSync(folder); } catch { return ''; } };
  const searchRoots = roots.map(real).filter(Boolean), plainRoots = readOnlyRoots.map(real).filter(Boolean);
  const attempts = [...searchRoots.map(root => [root, path.resolve(root, clean)]), ...plainRoots.filter(root => path.isAbsolute(clean)).map(root => [root, clean])];
  // Không thấy theo đường dẫn: tìm theo tên trong thư mục session (tên trần hoặc đường dẫn tương đối thiếu phần đầu).
  if (!path.isAbsolute(clean)) for (const root of searchRoots) attempts.push([root, () => findByName(root, clean, sessionId)]);
  for (const [root, target] of attempts) {
    try {
      const resolved = typeof target === 'function' ? target() : target; if (!resolved) continue;
      const candidate = fs.realpathSync(resolved); const relative = path.relative(root, candidate);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) continue;
      if (relative.split(path.sep).some(part => /^(\.git|\.claude|\.ssh|\.env(?:\..*)?|\.credentials\.json)$/i.test(part))) throw Error('Không mở tệp cấu hình/bí mật');
      const stat = fs.statSync(candidate); if (!stat.isFile()) throw Error('Không phải tệp');
      if (mime) { if (stat.size > MAX_IMAGE) throw Error('Chỉ xem ảnh tối đa 20 MB'); return { path: candidate, kind: 'image', url: `data:${mime};base64,` + fs.readFileSync(candidate).toString('base64') }; }
      if (stat.size > MAX_TEXT) throw Error('Chỉ xem tệp tối đa 2 MB');
      const content = fs.readFileSync(candidate, 'utf8'); if (content.includes('\0')) throw Error('Không hiển thị tệp nhị phân'); return { path: candidate, kind: 'text', content };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EINVAL') continue; throw error; }
  }
  if (path.isAbsolute(clean) && ![...searchRoots, ...plainRoots].some(root => { const rel = path.relative(root, path.resolve(clean)); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); })) throw Error('Tệp nằm ngoài thư mục của session: ' + clean);
  throw Error('Không tìm thấy tệp "' + clean + '" trong thư mục của session (có thể đã bị xoá hoặc đổi tên)');
}
module.exports = { readProjectFile, cleanReference, images };
