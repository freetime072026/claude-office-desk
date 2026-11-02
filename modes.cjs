const fs = require('node:fs'); const path = require('node:path');
// Đọc & sửa dùng 'default' để mọi Write/Edit/Bash đi qua hộp duyệt từng thao tác của app (chat.cjs → main.cjs).
const permissionMode = mode => ({ read: 'plan', edit: 'default', auto: 'auto', bypass: 'bypassPermissions' })[mode] || 'plan';
const validMode = mode => ['read', 'edit', 'auto', 'bypass'].includes(mode);
const READ_TOOLS = 'Read,Glob,Grep,TodoWrite';
const WRITE_TOOLS = 'Read,Glob,Grep,TodoWrite,Write,Edit,NotebookEdit,Bash';
const WEB_TOOLS = ['WebFetch', 'WebSearch'];
// Web luôn phải duyệt từng lần. Bypass không có bước duyệt nào nên không có web.
const ALWAYS_ASK = Object.freeze([...WEB_TOOLS]);
// Công cụ có mặt trong phiên: Plan chỉ đọc (+ web); các mode còn lại có sửa tệp và shell.
function toolsFor(mode) {
  if (mode === 'read' || !validMode(mode)) return [READ_TOOLS, ...WEB_TOOLS].join(',');
  return mode === 'bypass' ? WRITE_TOOLS : [WRITE_TOOLS, ...WEB_TOOLS].join(',');
}
// Công cụ tự cho phép, không hỏi. Ghi/sửa/shell/web đi qua hộp duyệt; Auto để classifier của CLI xét trước; Bypass bỏ qua duyệt.
function allowedFor(mode, mcpServers = []) {
  if (mode === 'read' || !validMode(mode)) return READ_TOOLS;
  return [READ_TOOLS, ...mcpServers.map(name => 'mcp__' + name)].join(',');
}
// realpath.native giải cả junction, ổ subst và ổ mạng đã map (trả về \\server\share) về đường dẫn thật.
function realFolder(folder) { try { return fs.realpathSync.native(folder); } catch { return path.resolve(folder); } }
const driveOf = value => /^[a-z]:/i.exec(value || '')?.[0].toLowerCase() || '';
// Ổ cần bảo vệ: C, ổ cài Windows (SystemDrive) và ổ chứa hồ sơ người dùng (USERPROFILE).
const protectedDrives = env => new Set(['c:', driveOf(env.SystemDrive), driveOf(env.USERPROFILE)].filter(Boolean));
function onSystemDrive(folder, env = process.env) { const real = realFolder(folder); return real.startsWith('\\\\') || protectedDrives(env).has(driveOf(real)); }
// Bật chạy tự động cần duyệt một lần khi có khối ghi/sửa (lượt tự động tự cho phép từng thao tác, trừ web).
// Bypass chỉ hỏi khi có thư mục ở ổ được bảo vệ hoặc thư mục mạng; Đọc & sửa/Auto luôn hỏi; Plan không hỏi.
function needsConfirm(mode, folders, env = process.env) {
  if (mode === 'read' || !validMode(mode)) return false;
  if (mode === 'bypass') return folders.some(folder => onSystemDrive(folder, env));
  return true;
}
// Hỏi trước cả lượt: chỉ còn Bypass trên ổ được bảo vệ, vì Bypass không có hộp duyệt từng thao tác.
const needsTurnConfirm = (mode, folders, env = process.env) => mode === 'bypass' && needsConfirm(mode, folders, env);
// Role có phạm vi ghi (permissions.roleScope) luôn chạy CLI ở mode 'default' để mọi lần ghi/shell đi qua app:
// app tự cho phép ghi trong phạm vi, từ chối ngoài phạm vi và mô phỏng mode đã chọn cho shell (decide()).
// Mode plan/auto/bypass của CLI sẽ tự quyết thay app nên không dùng cho role có phạm vi.
function cliMode(mode, scope) { return scope ? 'default' : permissionMode(mode); }
// Schema của mỗi tool nằm trong ngữ cảnh của mọi lần gọi model: role có phạm vi chỉ nhận tool cần cho việc của mình
// (không TodoWrite, NotebookEdit). Role có shell (Lead/Dev/VFX/QA) làm theo tệp và code của project nên không có web.
const SCOPED_TOOLS = 'Read,Glob,Grep,Write,Edit';
function cliTools(mode, scope) {
  if (!scope) return toolsFor(mode);
  const tools = [SCOPED_TOOLS];
  // Role có shell có thêm Agent để gọi subagent đọc code (subagent.cjs).
  if (scope.bash) tools.push('Bash', 'Agent');
  // Khối vốn không có shell giữ web khi được bật shell (permissions.withShell ghi scope.web).
  if ((scope.web ?? !scope.bash) && mode !== 'bypass') tools.push(...WEB_TOOLS);
  return tools.join(',');
}
// Tên MCP server trong mcp-servers.json và trong cấu hình MCP theo role (team.roleMcp).
const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
module.exports = { MCP_NAME, permissionMode, validMode, toolsFor, allowedFor, cliMode, cliTools, needsConfirm, needsTurnConfirm, onSystemDrive, READ_TOOLS, WRITE_TOOLS, ALWAYS_ASK };
