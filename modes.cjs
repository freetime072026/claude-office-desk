const path = require('node:path');
const permissionMode = mode => ({ read: 'plan', edit: 'acceptEdits', auto: 'auto', bypass: 'bypassPermissions' })[mode] || 'plan';
const validMode = mode => ['read', 'edit', 'auto', 'bypass'].includes(mode);
const READ_TOOLS = 'Read,Glob,Grep';
const WRITE_TOOLS = 'Read,Glob,Grep,Write,Edit,Bash';
// Công cụ có mặt trong phiên: Plan chỉ đọc; các mode còn lại có sửa tệp và shell.
const toolsFor = mode => mode === 'read' || !validMode(mode) ? READ_TOOLS : WRITE_TOOLS;
// Công cụ được tự cho phép trong print mode (không có prompt quyền). Auto để classifier của CLI xét; Bypass bỏ qua duyệt.
function allowedFor(mode, mcpServers = []) {
  if (mode === 'read' || !validMode(mode)) return READ_TOOLS;
  const base = mode === 'edit' ? WRITE_TOOLS : READ_TOOLS;
  return [base, ...mcpServers.map(name => 'mcp__' + name)].join(',');
}
const onSystemDrive = folder => /^c:/i.test(path.resolve(folder));
// Bypass chỉ hỏi khi có thư mục ở ổ C; Đọc & sửa/Auto luôn hỏi; Plan không hỏi.
function needsConfirm(mode, folders) {
  if (mode === 'read' || !validMode(mode)) return false;
  if (mode === 'bypass') return folders.some(onSystemDrive);
  return true;
}
module.exports = { permissionMode, validMode, toolsFor, allowedFor, needsConfirm, onSystemDrive, READ_TOOLS, WRITE_TOOLS };
