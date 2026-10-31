// Ảnh tham chiếu đính kèm vào tin nhắn: từ tệp trên đĩa (kéo thả) hoặc từ clipboard (dán, không có đường dẫn).
// Định dạng xác định bằng magic bytes, không tin đuôi tệp hay MIME do renderer gửi.
const fs = require('node:fs'); const path = require('node:path'); const { randomUUID } = require('node:crypto');
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PENDING = 8;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function imageType(bytes) {
  const head = Buffer.from(bytes.subarray(0, 12));
  if (head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return '.jpg';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (/^GIF8[79]a$/.test(head.toString('ascii', 0, 6))) return '.gif';
  return null;
}
const folderOf = (root, threadId) => path.join(root, 'attachments', threadId);
// Tên hiển thị: chỉ phần tên tệp, bỏ ký tự điều khiển, tối đa 100 ký tự.
const displayName = (name, extension) => (path.basename(String(name || '')).replace(/[\u0000-\u001f]/g, '').slice(0, 100) || 'ảnh dán' + extension);
function save(root, thread, bytes, name) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw Error('Không đọc được dữ liệu ảnh');
  if (bytes.length > MAX_BYTES) throw Error('Ảnh tối đa 20 MB');
  const extension = imageType(bytes); if (!extension) throw Error('Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF');
  thread.attachments ||= []; if (thread.attachments.length >= MAX_PENDING) throw Error(`Tối đa ${MAX_PENDING} ảnh cho một tin`);
  const folder = folderOf(root, thread.id); fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, randomUUID() + extension); fs.writeFileSync(target, bytes);
  const item = { name: displayName(name, extension), path: target }; thread.attachments.push(item); return item;
}
function saveFile(root, thread, source) {
  const real = fs.realpathSync(source), stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Chỉ nhận tệp ảnh tối đa 20 MB');
  return save(root, thread, fs.readFileSync(real), path.basename(real));
}
// Chỉ đọc/xoá ảnh nằm trong thư mục attachments của app (đường dẫn đến từ renderer).
function owned(root, file) {
  const base = fs.realpathSync(path.join(root, 'attachments')), real = fs.realpathSync(file), relative = path.relative(base, real);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Ảnh không thuộc app');
  return real;
}
function preview(root, file) { const real = owned(root, file), mime = MIME[path.extname(real).toLowerCase()]; if (!mime) throw Error('Không phải ảnh'); return `data:${mime};base64,` + fs.readFileSync(real).toString('base64'); }
function remove(root, thread, file) {
  const index = (thread.attachments || []).findIndex(item => item.path === file); if (index < 0) throw Error('Ảnh không còn trong tin đang soạn');
  thread.attachments.splice(index, 1); try { fs.unlinkSync(owned(root, file)); } catch {}
}
// Gửi tin: ảnh đang soạn chuyển sang tin vừa gửi và không gửi lại ở các lượt sau.
function take(thread) { const items = thread.attachments || []; thread.attachments = []; return items; }
module.exports = { imageType, save, saveFile, preview, remove, take, folderOf, MAX_BYTES, MAX_PENDING };
