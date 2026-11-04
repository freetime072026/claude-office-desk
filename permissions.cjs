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
// UI/UX chỉ ghi UIUX.md, không chạy shell.
// null = không giới hạn (role tùy chỉnh, chat thường, Dev chưa có danh sách tệp).
const path = require('node:path');
const { isDevType } = require('./roles.cjs');
const { readerCall } = require('./subagent.cjs');
const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit'];
// Lưới an toàn: curl tới cổng Unity-Skills (8090–8100) mà không có timeout có thể chờ mãi khi Unity nạp lại domain
// (lượt QA BaseTD treo đúng như vậy). App tự thêm --max-time cho mọi lệnh curl trong câu lệnh đó.
const UNITY_PORTS = /\b(?:127\.0\.0\.1|localhost):(?:809\d|8100)\b/;
const CURL_TIMEOUT_SECONDS = 120;
function withCurlTimeout(command) {
  if (typeof command !== 'string' || !UNITY_PORTS.test(command) || !/\bcurl\b/.test(command) || /--max-time|--connect-timeout|(^|\s)-m\s*\d/.test(command)) return command;
  return command.replace(/\bcurl(\.exe)?(?=\s)/g, `curl$1 --max-time ${CURL_TIMEOUT_SECONDS}`);
}
const WEB = ['WebFetch', 'WebSearch'];
function roleScope(type, files, devFiles = [], folder = '') {
  if (!files) return null;
  if (type === 'GD') return { paths: [files.gdd], bash: false, label: 'GD chỉ ghi GDD.md' };
  if (type === 'Lead Dev') return { paths: [files.project], bash: true, label: 'Lead Dev chỉ ghi PROJECT.md' };
  if (type === 'QA') return { paths: [files.issues, files.perf], bash: true, label: 'QA chỉ ghi ISSUES.md và PERF.md' };
  if (type === 'UI/UX') return { paths: [files.uiux], bash: false, label: 'UI/UX chỉ ghi UIUX.md' };
  // Release: chạy lệnh build/đóng gói của project (shell), không sửa code; chỉ ghi kết quả và Issue.
  if (type === 'Release') return { paths: [files.release, files.issues], bash: true, label: 'Release chỉ ghi RELEASE.md và ISSUES.md' };
  // Art Director: shell để chụp màn hình/kiểm import qua Unity; không sửa ảnh, chỉ ghi tài liệu art và Issue.
  if (type === 'Art Director') return { paths: [files.style, files.assets, files.art, files.issues], bash: true, label: 'Art Director chỉ ghi STYLE.md, ASSETS.md, ART.md và ISSUES.md' };
  // Giữ dấu / cuối để mục thư mục vẫn là thư mục sau khi resolve.
  // MISSING_SOUNDS.md luôn ghi được: code cần âm thanh chưa có thì dùng sound tạm và ghi yêu cầu vào đây (prompt.cjs SOUND_GUIDE).
  // shared: tệp ghi chú chung mọi khối được thêm mục (MISSING_SOUNDS.md, ART_PROMPTS.md); không tính khi xét hai lượt có chồng
  // phạm vi (exclusivePaths), nếu không mọi Dev/Art/Anim đều "chồng" nhau qua tệp này và chạy lần lượt thay vì song song.
  if (isDevType(type) && devFiles.length) return { paths: [...devFiles.map(file => path.resolve(folder, file) + (/[\\/]$/.test(file) ? path.sep : '')), files.missingSounds, ...(type === 'Art' ? [files.artPrompts] : [])], shared: [files.missingSounds, ...(type === 'Art' ? [files.artPrompts] : [])], bash: true, label: type + ' chỉ sửa các tệp Lead giao (và MISSING_SOUNDS.md' + (type === 'Art' ? ', ART_PROMPTS.md' : '') + ')' };
  return null;
}
const norm = value => path.resolve(value).toLowerCase();
// Một mục phạm vi là tệp, hoặc thư mục nếu kết thúc bằng / hoặc \ (Lead ghi "src/ui/").
function inScope(target, entries) { const file = norm(target); return entries.some(entry => { const base = norm(entry); return file === base || file.startsWith(base.replace(/[\\/]+$/, '') + path.sep) && /[\\/]$/.test(entry); }); }
// Phạm vi riêng của lượt (bỏ tệp ghi chú chung) để xét chồng phạm vi giữa các lượt chạy song song.
function exclusivePaths(scope) { if (!scope) return null; const shared = (scope.shared || []).map(norm); return scope.paths.filter(entry => !shared.includes(norm(entry))); }
// Hai tập phạm vi có chạm nhau không (để cho Dev sửa song song khi tệp không trùng).
function scopesOverlap(first, second) { return first.some(entry => inScope(entry, second)) || second.some(entry => inScope(entry, first)); }
// Quyết định cho một yêu cầu duyệt: allow (không hỏi), deny (từ chối kèm lý do) hoặc ask (hiện hộp duyệt).
function decide({ scope, mode, tool, input = {}, cwd = '' }) {
  if (WEB.includes(tool)) return { action: 'ask' };
  // Subagent chỉ dùng để dò/đọc code bằng model rẻ (subagent.cjs). App ép đúng loại agent, model và chạy chờ kết quả,
  // vì tham số model của Agent ghi đè được định nghĩa và mặc định Agent chạy nền.
  if (tool === 'Agent') return scope?.bash ? { action: 'allow', updatedInput: readerCall(input) } : { action: 'deny', message: 'Khối này không dùng subagent.' };
  if (WRITE_TOOLS.includes(tool)) {
    if (!scope) return { action: mode === 'bypass' ? 'allow' : 'ask' };
    const target = path.resolve(cwd, input.file_path || input.notebook_path || '');
    if (inScope(target, scope.paths)) return { action: 'allow' };
    return { action: 'deny', message: `Ngoài phạm vi ghi (${scope.label}): ${target}. Không ghi tệp khác; nếu cần sửa thêm, ghi rõ trong handoff để Lead giao lại.` };
  }
  if (tool === 'Bash') {
    const verdict = bashVerdict(scope, mode), command = withCurlTimeout(input.command);
    return command === input.command || verdict.action === 'deny' ? verdict : { ...verdict, updatedInput: { ...input, command } };
  }
  return { action: 'ask' };
}
// Tuỳ chọn shell của khối (worker.shell): 'allow' mở shell cả cho khối vốn không có (GD, UI/UX) và không hỏi, 'deny' tắt shell
// (kèm subagent đọc code), 'once' (mặc định) theo role và chỉ hỏi một lần mỗi session (main.cjs nhớ lần duyệt).
const SHELL_OPTIONS = Object.freeze(['once', 'allow', 'deny']);
function withShell(scope, shell) {
  if (!scope || !['allow', 'deny'].includes(shell)) return scope;
  return { ...scope, bash: shell === 'allow', web: scope.web ?? !scope.bash, shell };
}
function bashVerdict(scope, mode) {
  if (scope?.shell === 'allow') return { action: 'allow' };
  if (scope && !scope.bash) return { action: 'deny', message: `${scope.label}; không chạy lệnh shell.` };
  // Role có quyền shell theo phạm vi (Lead, Dev, VFX, QA) luôn chạy được lệnh: Plan và Đọc & sửa hỏi từng lần, Bypass không hỏi.
  if (scope?.bash) return { action: mode === 'bypass' ? 'allow' : 'ask' };
  return { action: mode === 'bypass' ? 'allow' : mode === 'read' ? 'deny' : 'ask', ...(mode === 'read' ? { message: 'Mode Plan không chạy lệnh shell.' } : {}) };
}
module.exports = { SHELL_OPTIONS, withShell, describeTool, roleScope, decide, inScope, scopesOverlap, exclusivePaths, withCurlTimeout };
