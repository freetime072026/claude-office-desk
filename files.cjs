const fs = require('node:fs'); const path = require('node:path');
const extensions = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.xml', '.cs', '.js', '.cjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.shader', '.hlsl', '.py', '.log', '.toml', '.ini', '.uxml', '.uss']);
function readProjectFile(reference, roots) {
  if (typeof reference !== 'string' || reference.length > 2000) throw Error('Đường dẫn không hợp lệ');
  const clean = reference.replace(/:\d+(?::\d+)?$/, '');
  if (!extensions.has(path.extname(clean).toLowerCase())) throw Error('Chỉ xem tệp văn bản được hỗ trợ');
  for (const root of roots.map(root => fs.realpathSync(root))) {
    try {
      const candidate = fs.realpathSync(path.resolve(root, clean)); const relative = path.relative(root, candidate);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) continue;
      if (relative.split(path.sep).some(part => /^(\.git|\.claude|\.ssh|\.env(?:\..*)?|\.credentials\.json)$/i.test(part))) throw Error('Không mở tệp cấu hình/bí mật');
      const stat = fs.statSync(candidate); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('Chỉ xem tệp tối đa 2 MB');
      const content = fs.readFileSync(candidate, 'utf8'); if (content.includes('\0')) throw Error('Không hiển thị tệp nhị phân'); return { path: candidate, content };
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
  }
  throw Error('Tệp không tồn tại hoặc nằm ngoài thư mục đã cấp quyền');
}
module.exports = { readProjectFile };
