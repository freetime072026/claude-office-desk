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
  return clean.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '');
}
function readProjectFile(reference, roots) {
  if (typeof reference !== 'string' || reference.length > 2000) throw Error('Đường dẫn không hợp lệ');
  const clean = cleanReference(reference), extension = path.extname(clean).toLowerCase(), mime = images[extension];
  if (!mime && !extensions.has(extension)) throw Error('Chỉ xem tệp văn bản hoặc ảnh được hỗ trợ');
  for (const root of roots.map(root => fs.realpathSync(root))) {
    try {
      const candidate = fs.realpathSync(path.resolve(root, clean)); const relative = path.relative(root, candidate);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) continue;
      if (relative.split(path.sep).some(part => /^(\.git|\.claude|\.ssh|\.env(?:\..*)?|\.credentials\.json)$/i.test(part))) throw Error('Không mở tệp cấu hình/bí mật');
      const stat = fs.statSync(candidate); if (!stat.isFile()) throw Error('Không phải tệp');
      if (mime) { if (stat.size > MAX_IMAGE) throw Error('Chỉ xem ảnh tối đa 20 MB'); return { path: candidate, kind: 'image', url: `data:${mime};base64,` + fs.readFileSync(candidate).toString('base64') }; }
      if (stat.size > MAX_TEXT) throw Error('Chỉ xem tệp tối đa 2 MB');
      const content = fs.readFileSync(candidate, 'utf8'); if (content.includes('\0')) throw Error('Không hiển thị tệp nhị phân'); return { path: candidate, kind: 'text', content };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EINVAL') continue; throw error; }
  }
  throw Error('Tệp không tồn tại hoặc nằm ngoài thư mục đã cấp quyền');
}
module.exports = { readProjectFile, cleanReference, images };
