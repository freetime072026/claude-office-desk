// Hướng dẫn riêng của dự án (CLAUDE.md / AGENTS.md, README.md). CLI chạy với --setting-sources user để quyền của app
// không bị .claude/settings.json của dự án ghi đè, nên CLI không tự nạp CLAUDE.md: app đọc và chèn vào prompt.
const fs = require('node:fs');
const path = require('node:path');
const { isDevType } = require('./roles.cjs');
const GUIDE_FILES = ['CLAUDE.md', 'AGENTS.md'];
const GUIDE_LIMIT = 4000;
const READS_CODE = type => type === 'Lead Dev' || type === 'QA' || isDevType(type);
function read(folder) {
  if (!folder) return null;
  const readme = fs.existsSync(path.join(folder, 'README.md'));
  for (const name of GUIDE_FILES) {
    try { const text = fs.readFileSync(path.join(folder, name), 'utf8').trim(); if (text) return { name, text: text.length > GUIDE_LIMIT ? text.slice(0, GUIDE_LIMIT) + '…' : text, readme }; } catch {}
  }
  return readme ? { name: '', text: '', readme } : null;
}
// README là mục lục doc: đọc doc feature/guide trước code. docs/rules chỉ đọc phần liên quan để không tốn hàng chục nghìn token mỗi khối.
function readmeLine(type) {
  if (READS_CODE(type)) return 'Dự án có README.md là mục lục doc (architecture, feature, guide, rules). Trước khi mở code, tra README để tìm doc của phần đang làm và đọc doc đó; chỉ mở code theo đoạn (Grep, Read với offset/limit) khi doc chưa đủ. Rules: chỉ đọc rule liên quan tới phần đang sửa (thường coding, dots, performance), không đọc hết.';
  return 'Dự án có README.md là mục lục doc; chỉ tra khi cần bối cảnh game hoặc feature. Bỏ qua docs/rules (luật code), không đọc code.';
}
// full: lượt đầu của phiên CLI (hoặc phiên chưa từng nhận) thì gửi cả nội dung CLAUDE.md; các lượt sau chỉ gửi dòng README ngắn.
function guide(info, type, full) {
  if (!info) return '';
  const lines = [];
  if (full && info.text) lines.push(`Hướng dẫn của dự án (${info.name}; app chèn vì CLI không tự nạp). Làm theo phần không trái vai trò, quyền và tệp được ghi của bạn:\n${info.text}`);
  if (info.readme) lines.push(readmeLine(type));
  return lines.join('\n');
}
// thread.docsSent[sessionKey]: id phiên CLI đã nhận CLAUDE.md; 'new' khi gửi ở lượt mở phiên (id chưa biết).
function needsFull(thread, sessionKey, resumed) {
  if (!resumed) return true;
  const sent = thread.docsSent?.[sessionKey];
  return !(sent === 'new' || sent === thread.cliSessions?.[sessionKey]);
}
function markSent(thread, sessionKey, resumed) { (thread.docsSent ||= {})[sessionKey] = resumed ? thread.cliSessions?.[sessionKey] : 'new'; }
module.exports = { read, guide, needsFull, markSent, GUIDE_LIMIT };
