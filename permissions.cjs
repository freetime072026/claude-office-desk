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
// GD chỉ ghi GDD và không chạy shell; Lead chỉ ghi PROJECT.md và ISSUES.md (warning review); QA chỉ ghi ISSUES/PERF; Dev chỉ ghi các tệp Lead giao.
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
// Lượt Sound treo hơn 10 phút vì `find / -iname ffmpeg.exe` quét mọi ổ qua Git Bash. Chặn find/ls -R/dir /s/Get-ChildItem -Recurse
// bắt đầu từ gốc ổ (/, /c, /d/, C:\, D:/); tìm trong thư mục con cụ thể vẫn được.
const ROOT = String.raw`(?:\/(?:[a-zA-Z]\/?)?|[a-zA-Z]:[\\\/]?)(?=["'\s;|&)]|$)`;
const DISK_SCANS = [
  new RegExp(String.raw`(?:^|[\s;|&(])find(?:\.exe)?\s+(?:-[HLP]\s+)*["']?${ROOT}`),
  new RegExp(String.raw`(?:^|[\s;|&(])ls\s+(?:-\w*R\w*\s+)+["']?${ROOT}`),
  new RegExp(String.raw`(?:^|[\s;|&(])dir\s+(?:\/\w+\s+)*["']?[a-zA-Z]:\\?["']?\s+[^\n]*\/s\b|(?:^|[\s;|&(])dir\s+\/s\s+(?:\/\w+\s+)*["']?[a-zA-Z]:\\?(?=["'\s]|$)`, 'i'),
  new RegExp(String.raw`Get-ChildItem\b[^|;\n]*(?:-Path\s+)?["']?[a-zA-Z]:\\?["']?(?=\s)[^|;\n]*-Recurse`, 'i')
];
function wholeDiskScan(command) {
  if (typeof command !== 'string') return '';
  for (const pattern of DISK_SCANS) { const match = pattern.exec(command); if (match) return match[0].trim().slice(0, 60); }
  return '';
}
const WEB = ['WebFetch', 'WebSearch'];
// Thư mục tạm của khối có shell: .office-desk/tmp/ trong project (không dùng thư mục tạm của hệ thống: mọi khối chỉ làm việc trong
// thư mục của session). Script phụ (python/node sinh ảnh, sửa tệp, chụp màn hình) ghi ở đây; tính là tệp chung (không tính chồng phạm vi).
const tmpOf = files => require('./session-files.cjs').tmpDir(files);
// ---- Chỉ làm việc trong thư mục của session (thư mục chính + thư mục liên quan). Đọc/tìm/ghi ngoài đó bị từ chối; README/tài liệu nhắc
// tệp ở thư mục khác thì khối báo người dùng thêm thư mục đó (prompt.cjs folderRule). Ngoại lệ chỉ đọc: thư mục chương trình
// (Program Files, Windows, nvm, Git) để chạy công cụ như trình duyệt, node, python.
const READ_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'];
const SYSTEM_DIRS = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.SystemRoot, process.env.ProgramData && path.join(process.env.ProgramData, 'chocolatey'),
  process.env.NVM_HOME, process.env.NVM_SYMLINK, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
  path.dirname(process.execPath)].filter(Boolean);
const under = (target, roots) => { const file = norm(target); return roots.some(root => { const base = norm(root).replace(/[\\/]+$/, ''); return file === base || file.startsWith(base + path.sep); }); };
// Đường dẫn tuyệt đối trong một lệnh shell: C:\x, C:/x, Git Bash /c/x, ~/x, $HOME, $TEMP/$TMP/%TEMP%, /tmp.
function outsidePaths(command, folders) {
  let text = String(command || ''); const found = [];
  // Đường dẫn trong nháy có thể chứa dấu cách ("C:/Program Files/…"): lấy nguyên chuỗi rồi bỏ khỏi lệnh trước khi quét phần còn lại.
  text = text.replace(/(["'])([A-Za-z]:[\\/][^"'\n]*)\1/g, (all, quote, inner) => { found.push(inner); return ' '; });
  for (const match of text.matchAll(/(?<![\w])([A-Za-z]):[\\/][^\s'"`|;&<>()]*/g)) found.push(match[0]);
  for (const match of text.matchAll(/(?<![\w:.\/~-])\/([a-zA-Z])\/[^\s'"`|;&<>()]*/g)) found.push(match[1].toUpperCase() + ':' + match[0].slice(2));
  const outside = found.map(item => item.replace(/[.,]+$/, '')).filter(item => !under(path.resolve(item), folders) && !under(path.resolve(item), SYSTEM_DIRS));
  const special = /(^|[\s'"=(<>|;&:])(~\/|\$HOME\b|\$\{HOME\}|\$TEMP\b|\$\{TEMP\}|\$TMP\b|\$TMPDIR\b|%TEMP%|%TMP%|%USERPROFILE%|\/tmp(\/|\b))/i.exec(text);
  if (special) outside.push(special[2]);
  return outside;
}
const outsideMessage = (what, folders, extra = '') => `Ngoài thư mục của session: ${what}. Chỉ đọc, tìm và ghi trong: ${folders.join(', ')}${extra}. Tệp tạm/script phụ để trong .office-desk/tmp/ của project. Nếu README hoặc tài liệu nhắc tệp ở thư mục khác: không tự tìm, dừng và báo người dùng thêm thư mục đó vào session (ghi rõ đường dẫn).`;
// assigner: người giao task của khối (Lead hoặc Art Director), để lời từ chối ghi chỉ đúng người cần bổ sung files.
// Mọi khối có phạm vi ghi đều ghi thêm được DECISIONS.md (quyết định người dùng nói trong chat) — tệp chung, không tính chồng phạm vi.
function roleScope(type, files, devFiles = [], folder = '', assigner = 'Lead') {
  const scope = baseScope(type, files, devFiles, folder, assigner);
  return scope && files.decisions ? { ...scope, paths: [...scope.paths, files.decisions], shared: [...(scope.shared || []), files.decisions] } : scope;
}
function baseScope(type, files, devFiles, folder, assigner) {
  if (!files) return null;
  if (type === 'GD') return { paths: [files.gdd], bash: false, label: 'GD chỉ ghi GDD.md' };
  // Fixer: chạy lệnh kiểm tra để chẩn đoán, không sửa code; chỉ ghi FIXES.md.
  if (type === 'Fixer') return { paths: [files.fixes], bash: true, label: 'Fixer chỉ ghi FIXES.md' };
  // ISSUES.md: Lead review ghi warning code clean (prompt.cjs REVIEW_CHECKLIST) thay vì reject.
  // ISSUES.md là tệp chung (shared): QA, Art Director · review, Lead review, Release mỗi khối chỉ thêm/sửa mục của mình. Tính là phạm vi
  // riêng thì QA và Art Director · review (chạy song song) luôn bắt nhau chờ; QA chạy liền nhiều lượt nên Art Director chờ mãi rồi bị bỏ qua.
  if (type === 'Lead Dev') return { paths: [files.project, files.issues], shared: [files.issues], bash: true, label: 'Lead Dev chỉ ghi PROJECT.md và ISSUES.md' };
  // QA: ghi Issue/PERF và script kiểm trong .office-desk/qa/ (dùng lại qua các lượt); không chạy lệnh nền (server bỏ lại giữ cổng, CLI không thoát).
  if (type === 'QA') return { paths: [files.issues, files.perf, require('./session-files.cjs').qaDir(files), tmpOf(files)], shared: [files.issues, require('./session-files.cjs').qaDir(files), tmpOf(files)], bash: true, noBackground: true, label: 'QA chỉ ghi ISSUES.md, PERF.md, script kiểm trong .office-desk/qa/ và tệp tạm' };
  if (type === 'UI/UX') return { paths: [files.uiux], bash: false, label: 'UI/UX chỉ ghi UIUX.md' };
  // Release: chạy lệnh build/đóng gói của project (shell), không sửa code; chỉ ghi kết quả và Issue.
  if (type === 'Release') return { paths: [files.release, files.issues], shared: [files.issues], bash: true, label: 'Release chỉ ghi RELEASE.md và ISSUES.md' };
  // Art Director: shell để chụp màn hình/kiểm import qua Unity; không sửa ảnh, chỉ ghi tài liệu art và Issue.
  if (type === 'Art Director') return { paths: [files.style, files.assets, files.art, files.issues, files.artLessons], shared: [files.issues, files.artLessons], bash: true, label: 'Art Director chỉ ghi STYLE.md, ASSETS.md, ART.md, ISSUES.md và ART_LESSONS.md' };
  // Giữ dấu / cuối để mục thư mục vẫn là thư mục sau khi resolve.
  // MISSING_SOUNDS.md luôn ghi được: code cần âm thanh chưa có thì dùng sound tạm và ghi yêu cầu vào đây (prompt.cjs SOUND_GUIDE).
  // shared: tệp ghi chú chung mọi khối được thêm mục (MISSING_SOUNDS.md, ART_PROMPTS.md); không tính khi xét hai lượt có chồng
  // phạm vi (exclusivePaths), nếu không mọi Dev/Art/Anim đều "chồng" nhau qua tệp này và chạy lần lượt thay vì song song.
  if (isDevType(type) && devFiles.length) return { paths: [...devFiles.map(file => path.resolve(folder, file) + (/[\\/]$/.test(file) ? path.sep : '')), files.missingSounds, ...(type === 'Art' ? [files.artPrompts, files.artLessons] : []), tmpOf(files)], shared: [files.missingSounds, ...(type === 'Art' ? [files.artPrompts, files.artLessons] : []), tmpOf(files)], bash: true, assigner, label: `${type} chỉ ghi các tệp trong files của task ${assigner} giao; ngoài ra mọi khối ghi thêm được MISSING_SOUNDS.md (báo âm thanh còn thiếu)${type === 'Art' ? ', ART_PROMPTS.md và ART_LESSONS.md' : ''}` };
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
// readable: thư mục chỉ đọc ngoài thư mục session mà khối vẫn cần (ảnh bạn dán/kéo vào tin: attachments/<session> của app).
// cliData: thư mục projects/ trong hồ sơ CLI (CLAUDE_CONFIG_DIR). Kết quả lệnh quá dài, CLI lưu vào …/<session>/tool-results/
// và bảo model đọc lại tệp đó ("Output too large… Full output saved to"); chặn thì khối mất kết quả. Chỉ mở tool-results, không mở transcript.
const isToolResult = (target, cliData) => Boolean(cliData) && under(target, [cliData]) && /[\\/]tool-results[\\/]/i.test(target);
function decide({ scope, mode, tool, input = {}, cwd = '', folders = [], readable = [], cliData = '' }) {
  if (WEB.includes(tool)) return { action: 'ask' };
  // Đọc/tìm ngoài thư mục của session (CLI chỉ hỏi khi đường dẫn nằm ngoài thư mục làm việc).
  if (folders.length && READ_TOOLS.includes(tool)) {
    const target = input.file_path || input.notebook_path || input.path || '';
    if (target && !under(path.resolve(cwd, target), [...folders, ...readable, ...SYSTEM_DIRS]) && !isToolResult(path.resolve(cwd, target), cliData)) return { action: 'deny', message: outsideMessage(path.resolve(cwd, target), folders) };
  }
  if (folders.length && WRITE_TOOLS.includes(tool)) {
    const target = path.resolve(cwd, input.file_path || input.notebook_path || '');
    if (!under(target, folders)) return { action: 'deny', message: outsideMessage(target, folders) };
  }
  // Subagent chỉ dùng để dò/đọc code bằng model rẻ (subagent.cjs). App ép đúng loại agent, model và chạy chờ kết quả,
  // vì tham số model của Agent ghi đè được định nghĩa và mặc định Agent chạy nền.
  if (tool === 'Agent') return scope?.bash ? { action: 'allow', updatedInput: readerCall(input) } : { action: 'deny', message: 'Khối này không dùng subagent.' };
  if (WRITE_TOOLS.includes(tool)) {
    if (!scope) return { action: mode === 'bypass' ? 'allow' : 'ask' };
    const target = path.resolve(cwd, input.file_path || input.notebook_path || '');
    if (inScope(target, scope.paths)) return { action: 'allow' };
    // Script phụ của khối có shell: .office-desk/tmp/ của bất kỳ thư mục nào của session (thư mục chính có thể là thư mục con như
    // assets/stage, còn khối làm việc ở thư mục project liên quan).
    if (scope.bash && folders.some(folder => under(target, [path.join(folder, '.office-desk', 'tmp')]))) return { action: 'allow' };
    const allowed = exclusivePaths(scope);
    return { action: 'deny', message: `Ngoài phạm vi ghi (${scope.label}): ${target}.${scope.assigner && allowed.length ? ' Được ghi: ' + allowed.join(', ') + '.' : ''} Không ghi tệp khác; nếu cần ghi thêm, ghi rõ tệp đó trong handoff để ${scope.assigner || 'Lead'} giao lại.${scope.bash ? ' Script phụ/tệp tạm ghi được trong .office-desk/tmp/ của thư mục session.' : ''}` };
  }
  if (tool === 'Bash') {
    const away = folders.length ? outsidePaths(input.command, [...folders, ...readable]).filter(item => !isToolResult(path.resolve(item), cliData)) : [];
    if (away.length) return { action: 'deny', message: outsideMessage(away.slice(0, 3).join(', '), folders, ' (công cụ trong Program Files/Windows/nvm vẫn chạy được)') };
    const scan = wholeDiskScan(input.command);
    if (scan) return { action: 'deny', message: `Không quét cả ổ đĩa (${scan}): lệnh chạy hàng chục phút và treo lượt. Tìm công cụ bằng \`command -v ffmpeg\` / \`where ffmpeg\`; tìm tệp trong thư mục của session (đường dẫn cụ thể, có -maxdepth).` };
    // /tmp: Git Bash hiểu là thư mục tạm của Windows, node/python hiểu là \tmp ở gốc ổ, nên script ghi được mà đọc lại lỗi
    // ("Cannot find module '/tmp/…'", FileNotFoundError). QA: chặn mọi /tmp (kết quả kiểm để trong .office-desk/qa/out/); khối có shell
    // khác: chặn khi lệnh vừa có /tmp vừa gọi node/python (lệnh bash thuần với /tmp vẫn chạy đúng).
    const command0 = String(input.command || ''), usesTmp = /(^|[\s'"=(<>|;&:])\/tmp(\/|\b)/.test(command0);
    if (scope?.bash && usesTmp && (scope.noBackground || /(^|[\s;&|(])(node|python3?|py)(\.exe)?(\s|$)/.test(command0))) {
      return { action: 'deny', message: 'Không dùng /tmp: Git Bash và node/python hiểu khác nhau (bash là thư mục tạm của Windows, node/python là \\tmp ở gốc ổ). '
        + (scope.noBackground ? 'Ghi kết quả/ảnh vào .office-desk/qa/out/ bằng đường dẫn tương đối rồi chạy lại lệnh.' : 'Dùng đường dẫn tương đối trong project, ví dụ .office-desk/tmp/, để bash, node và python cùng hiểu, rồi chạy lại lệnh.') };
    }
    // Lệnh chạy nền (run_in_background) bị bỏ lại (dev server giữ cổng) làm CLI không thoát và lượt bị coi là treo: mọi khối có shell.
    if (scope?.bash && input.run_in_background) return { action: 'deny', message: 'Không chạy lệnh nền (run_in_background). Bật dev server và chạy kiểm trong cùng một lệnh Bash rồi tắt server ở cuối lệnh (vd. `node scripts/build.cjs dev --port 3311 > log 2>&1 & PID=$!; …; kill $PID`), bọc lệnh dài bằng timeout (mỗi lệnh chạy được tối đa 10 phút).' };
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
module.exports = { outsidePaths, SHELL_OPTIONS, withShell, describeTool, roleScope, decide, inScope, scopesOverlap, exclusivePaths, withCurlTimeout, wholeDiskScan };
