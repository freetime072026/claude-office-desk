// Nội dung hộp duyệt từng thao tác (main.cjs). Thuần: không Electron. Chỉ hiển thị, không sửa input gửi lại CLI.
const LINE_LIMIT = 30, TEXT_LIMIT = 3000;
const clip = (value, limit) => value.length > limit ? value.slice(0, limit) + '\n…(đã cắt)' : value;
function prefixed(text, mark) {
  const lines = String(text ?? '').split(/\r?\n/), shown = lines.slice(0, LINE_LIMIT).map(line => mark + line);
  if (lines.length > LINE_LIMIT) shown.push(`${mark}… (+${lines.length - LINE_LIMIT} dòng)`);
  return shown.join('\n');
}
function describeTool(tool, input = {}) {
  let text;
  if (tool === 'Bash') text = 'Lệnh shell:\n' + input.command + (input.description ? '\n\nMô tả: ' + input.description : '') + (input.run_in_background ? '\n(chạy nền)' : '');
  else if (tool === 'Edit') text = `Sửa tệp: ${input.file_path}${input.replace_all ? ' (thay mọi chỗ khớp)' : ''}\n\n` + prefixed(input.old_string, '- ') + '\n' + prefixed(input.new_string, '+ ');
  else if (tool === 'Write') text = `Ghi tệp (tạo mới hoặc ghi đè): ${input.file_path}\n\n` + prefixed(input.content, '+ ');
  else if (tool === 'NotebookEdit') text = `Sửa notebook: ${input.notebook_path}\nÔ: ${input.cell_id ?? input.cell_number ?? 'mới'} · ${input.edit_mode || 'replace'}\n\n` + prefixed(input.new_source, '+ ');
  else if (tool === 'WebFetch') text = `Đọc trang web: ${input.url}\n\nYêu cầu: ${input.prompt || ''}\n\nNội dung trang được gửi cho model; trang có thể chứa chỉ thị độc hại.`;
  else if (tool === 'WebSearch') text = `Tìm kiếm web: ${input.query}` + (input.allowed_domains?.length ? '\nChỉ trong: ' + input.allowed_domains.join(', ') : '') + (input.blocked_domains?.length ? '\nTrừ: ' + input.blocked_domains.join(', ') : '');
  else text = 'Tham số:\n' + JSON.stringify(input, null, 2);
  return clip(text, TEXT_LIMIT);
}
// ---- Phạm vi ghi theo role (app thực thi, không chỉ dặn trong prompt).
// GD chỉ ghi GDD và không chạy shell; Lead chỉ ghi PROJECT.md; QA chỉ ghi ISSUES/PERF; Dev chỉ ghi các tệp Lead giao.
// null = không giới hạn (role tùy chỉnh, UI/UX, chat thường, Dev chưa có danh sách tệp).
const path = require('node:path');
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
const WEB = ['WebFetch', 'WebSearch'];
function roleScope(type, files, devFiles = [], folder = '') {
  if (!files) return null;
  if (type === 'GD') return { paths: [files.gdd], bash: false, label: 'GD chỉ ghi GDD.md' };
  if (type === 'Lead Dev') return { paths: [files.project], bash: true, label: 'Lead Dev chỉ ghi PROJECT.md' };
  if (type === 'QA') return { paths: [files.issues, files.perf], bash: true, label: 'QA chỉ ghi ISSUES.md và PERF.md' };
  // Giữ dấu / cuối để mục thư mục vẫn là thư mục sau khi resolve.
  if (type === 'Dev' && devFiles.length) return { paths: devFiles.map(file => path.resolve(folder, file) + (/[\\/]$/.test(file) ? path.sep : '')), bash: true, label: 'Dev chỉ sửa các tệp Lead giao' };
  return null;
}
const norm = value => path.resolve(value).toLowerCase();
// Một mục phạm vi là tệp, hoặc thư mục nếu kết thúc bằng / hoặc \ (Lead ghi "src/ui/").
function inScope(target, entries) { const file = norm(target); return entries.some(entry => { const base = norm(entry); return file === base || file.startsWith(base.replace(/[\\/]+$/, '') + path.sep) && /[\\/]$/.test(entry); }); }
// Hai tập phạm vi có chạm nhau không (để cho Dev sửa song song khi tệp không trùng).
function scopesOverlap(first, second) { return first.some(entry => inScope(entry, second)) || second.some(entry => inScope(entry, first)); }
// Quyết định cho một yêu cầu duyệt: allow (không hỏi), deny (từ chối kèm lý do) hoặc ask (hiện hộp duyệt).
function decide({ scope, mode, tool, input = {}, cwd = '' }) {
  if (WEB.includes(tool)) return { action: 'ask' };
  if (WRITE_TOOLS.includes(tool)) {
    if (!scope) return { action: mode === 'bypass' ? 'allow' : 'ask' };
    const target = path.resolve(cwd, input.file_path || input.notebook_path || '');
    if (inScope(target, scope.paths)) return { action: 'allow' };
    return { action: 'deny', message: `Ngoài phạm vi ghi (${scope.label}): ${target}. Không ghi tệp khác; nếu cần sửa thêm, ghi rõ trong handoff để Lead giao lại.` };
  }
  if (tool === 'Bash') {
    if (scope && !scope.bash) return { action: 'deny', message: `${scope.label}; không chạy lệnh shell.` };
    return { action: mode === 'bypass' ? 'allow' : mode === 'read' ? 'deny' : 'ask', ...(mode === 'read' ? { message: 'Mode Plan không chạy lệnh shell.' } : {}) };
  }
  return { action: 'ask' };
}
module.exports = { describeTool, roleScope, decide, inScope, scopesOverlap };
