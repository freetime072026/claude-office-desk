const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { usageEvent } = require('./usage.cjs');
const { cleanEnv, sessionArgs, psLiteral } = require('./core.cjs');
// Script QA (kit QA PLA trong project) tìm playwright-core của Office Desk qua biến này khi project không cài.
const { APP_DIR: QA_KIT_APP_DIR } = require('./qa-kit.cjs');
// Giới hạn thời gian lệnh Bash của CLI (mặc định chỉ 2 phút): script kiểm Playwright/đo FPS của QA, build, Unity compile chạy 2–5 phút
// bị CLI chuyển sang chạy nền, khối phải dò lại kết quả và hay treo. Nâng mặc định 10 phút, tối đa 30 phút (bộ canh treo dừng lệnh
// quá 40 phút).
const BASH_TIMEOUTS = { BASH_DEFAULT_TIMEOUT_MS: String(10 * 60 * 1000), BASH_MAX_TIMEOUT_MS: String(30 * 60 * 1000) };
// Python trên Windows in qua pipe bằng cp1252: lệnh `python -c "print(...)"` gặp chữ Việt trong dữ liệu (state.json, brief) chết
// UnicodeEncodeError, khối ghi lỗi exit 1 dù script đúng. Ép UTF-8 cho mọi tiến trình Python con.
const PYTHON_UTF8 = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const { foldersOf, extraFolderArgs } = require('./usage.cjs');
const { cliMode, cliTools, allowedFor } = require('./modes.cjs');
const { agentsArg } = require('./subagent.cjs');
const { AUTOCOMPACT_WINDOW } = require('./roles.cjs');
const { killLeftovers } = require('./proc-tree.cjs');
const { resumeKey } = require('./workers.cjs');
// Mô tả ngắn mục tiêu của một lượt gọi công cụ để hiển thị tiến độ (không lưu toàn bộ input).
function targetOf(input = {}) {
  const value = input.file_path || input.path || input.pattern || input.command || input.description || input.url || '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  const short = /[\\/]/.test(text) && !input.command ? text.split(/[\\/]/).filter(Boolean).at(-1) : text;
  return short.length > 80 ? short.slice(0, 80) + '…' : short;
}
function progressOf(message) { return message.progress ||= { startedAt: message.time || new Date().toISOString(), steps: 0, lastTool: '', target: '' }; }
// Nhật ký bước của lượt (message.steps): mỗi tool một mục, kết quả rút gọn; giữ STEP_LIMIT mục cuối để workspace không phình.
const STEP_LIMIT = 40, RESULT_CLIP = 200, DETAIL_CLIP = 200;
const oneLine = (value, limit) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > limit ? text.slice(0, limit) + '…' : text; };
function detailOf(name, input = {}) {
  if (input.command) return oneLine(input.command, DETAIL_CLIP);
  const file = input.file_path || input.notebook_path;
  if (file) return oneLine(file + (input.offset || input.limit ? ` (dòng ${input.offset || 1}${input.limit ? '+' + input.limit : ''})` : ''), DETAIL_CLIP);
  if (input.pattern) return oneLine(input.pattern + (input.path ? ' · ' + input.path : '') + (input.glob ? ' · ' + input.glob : ''), DETAIL_CLIP);
  return oneLine(input.description || input.url || input.query || input.prompt || (name ? '' : JSON.stringify(input)), DETAIL_CLIP);
}
const resultText = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.type === 'text' ? part.text : part.type === 'image' ? '[ảnh]' : '').join(' ') : '';
function addStep(message, block, sub) {
  const steps = message.steps ||= []; steps.push({ id: block.id || '', tool: block.name, detail: detailOf(block.name, block.input), at: new Date().toISOString(), ...(sub ? { sub: true } : {}) });
  if (steps.length > STEP_LIMIT) steps.splice(0, steps.length - STEP_LIMIT);
}
function finishStep(message, result) {
  settleFile(message, result);
  const step = (message.steps || []).findLast(item => item.id && item.id === result.tool_use_id); if (!step || step.end) return;
  step.end = new Date().toISOString(); step.ok = !result.is_error; step.result = oneLine(resultText(result.content), RESULT_CLIP);
  const progress = progressOf(message); progress.updatedAt = step.end;
  if (progress.runningId === result.tool_use_id) { delete progress.runningId; delete progress.runningSince; }
}
function trackTool(message, block, seen, sub = false) {
  if (block.id && seen.has(block.id)) return; if (block.id) seen.add(block.id);
  const progress = progressOf(message); progress.steps++; progress.lastTool = block.name; progress.target = targetOf(block.input); progress.updatedAt = new Date().toISOString();
  // Tool đang chạy (chưa có tool_result): UI không coi lệnh dài (build, test trình duyệt) là treo khi lệnh còn trong thời gian cho phép.
  if (block.id) { progress.runningId = block.id; progress.runningSince = progress.updatedAt; }
  addStep(message, block, sub); trackFile(message, block);
}
// Tệp tạo/sửa qua tool (file-changes.cjs gộp với git status). Event assistant tới trước khi tool chạy nên Write vào
// tệp chưa có là tạo mới.
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
function trackFile(message, block) {
  const file = block.input?.file_path || block.input?.notebook_path; if (!WRITE_TOOLS.includes(block.name) || typeof file !== 'string' || !file) return;
  const ops = message.fileOps ||= {}; if (ops[file] === 'created') return;
  if (block.id) (message.pendingFileOps ||= {})[block.id] = { file, previous: ops[file] || '' };
  ops[file] = block.name === 'Write' && !fs.existsSync(file) ? 'created' : 'edited';
}
// Tool bị app từ chối (ngoài phạm vi ghi) hoặc lỗi (old_string không khớp) không đổi tệp: bỏ tệp khỏi fileOps để dòng
// "Sửa:" của báo cáo không ghi tệp chưa hề được sửa (Art bị chặn sửa to_game.py mà báo cáo vẫn ghi đã sửa).
function settleFile(message, result) {
  const pending = message.pendingFileOps?.[result.tool_use_id]; if (!pending) return;
  delete message.pendingFileOps[result.tool_use_id]; if (!Object.keys(message.pendingFileOps).length) delete message.pendingFileOps;
  if (!result.is_error || !message.fileOps) return;
  if (pending.previous) message.fileOps[pending.file] = pending.previous; else delete message.fileOps[pending.file];
}
// Thông báo lỗi chuẩn khi CLI không để lại stderr/text dùng được (US-07).
const CLI_FAILED_TEXT = 'CLI dừng hoặc gặp lỗi. Kiểm tra đăng nhập và phiên bản Claude Code.';
const CLI_EMPTY_TEXT = 'CLI không trả về nội dung text.';
// Token/chi phí của một lượt từ event result (US-01). Thiếu trường hoặc sai kiểu thì tính 0, không throw.
const count = value => Number.isFinite(value) ? value : 0;
// modelUsage tách theo model (gồm subagent Haiku và lần gọi compact): total_cost_usd tính cả các lần gọi này còn usage thì không.
function modelsOf(modelUsage) {
  if (!modelUsage || typeof modelUsage !== 'object' || Array.isArray(modelUsage)) return null;
  const entries = Object.entries(modelUsage).map(([model, usage]) => [model, { input: count(usage?.inputTokens), output: count(usage?.outputTokens), cacheRead: count(usage?.cacheReadInputTokens), cacheWrite: count(usage?.cacheCreationInputTokens), costUsd: count(usage?.costUSD) }]);
  return entries.length ? Object.fromEntries(entries) : null;
}
function usageOf(event) {
  const usage = event?.usage || {}, models = modelsOf(event?.modelUsage);
  return { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens), costUsd: count(event?.total_cost_usd), turns: count(event?.num_turns), ...(models ? { models } : {}) };
}
// total_cost_usd và modelUsage của CLI cộng dồn cả phiên (gồm các lượt trước khi --resume), còn usage token chỉ của lượt này.
// Trừ tổng phiên ghi ở lượt trước (thread.sessionTotals) để chi phí trên tin là của riêng lượt. Phiên resume mà chưa có tổng
// ghi trước (phiên tạo trước bản này) thì không trừ được: đánh dấu sessionTotal để UI ghi rõ là số cộng dồn.
const MODEL_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'costUsd'];
const SESSION_TOTALS_LIMIT = 200;
const minus = (value, before) => Math.max(0, value - (before || 0));
function turnUsage(usage, previous, resumed) {
  const total = { costUsd: usage.costUsd, ...(usage.models ? { models: usage.models } : {}) };
  if (!previous) return { usage: resumed ? { ...usage, sessionTotal: true } : usage, total };
  const models = usage.models && Object.fromEntries(Object.entries(usage.models).map(([model, part]) => [model, Object.fromEntries(MODEL_FIELDS.map(field => [field, minus(part[field], previous.models?.[model]?.[field])]))]).filter(([, part]) => MODEL_FIELDS.some(field => part[field])));
  return { usage: { ...usage, costUsd: minus(usage.costUsd, previous.costUsd), ...(models ? { models } : {}) }, total };
}
function recordTotal(totals, id, total) {
  delete totals[id]; totals[id] = total;
  const ids = Object.keys(totals); for (const old of ids.slice(0, Math.max(0, ids.length - SESSION_TOTALS_LIMIT))) delete totals[old];
}
// PowerShell ghi progress/record dạng CLIXML ra stderr: bỏ marker '#< CLIXML' và khối <Objs ...>...</Objs> (kể cả khối bị cắt ở cuối).
function cleanStderr(text) {
  return String(text || '').replace(/<Objs\b[\s\S]*?(<\/Objs>|$)/g, '').replace(/^[ \t]*#< CLIXML[ \t]*$/gm, '').trim();
}
function consume(message, event, seen = new Set()) {
  if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') { message.text += event.event.delta.text; message.deltaSeen = true; progressOf(message).updatedAt = new Date().toISOString(); }
  if (event.type === 'stream_event' && event.event?.type === 'content_block_start' && event.event.content_block?.type === 'tool_use') { const progress = progressOf(message); progress.lastTool = event.event.content_block.name; progress.target = ''; progress.updatedAt = new Date().toISOString(); }
  if (event.type === 'assistant') {
    const content = event.message?.content || [];
    if (!message.deltaSeen) message.text += content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    const toolBlocks = content.filter(block => block.type === 'tool_use'); for (const block of toolBlocks) trackTool(message, block, seen, Boolean(event.parent_tool_use_id));
    const tools = toolBlocks.map(block => block.name);
    if (tools.length) message.tools = [...new Set([...(message.tools || []), ...tools])];
    message.deltaSeen = false;
  }
  if (event.type === 'user' && Array.isArray(event.message?.content)) for (const block of event.message.content) if (block.type === 'tool_result') finishStep(message, block);
  // Compact (tự động khi chạm ngưỡng hoặc lệnh /compact): hiện trạng thái và ghi số token trước/sau trên tin.
  if (event.type === 'system' && event.subtype === 'status' && event.status === 'compacting') { const progress = progressOf(message); progress.lastTool = 'Compact'; progress.target = 'đang compact ngữ cảnh'; progress.updatedAt = new Date().toISOString(); }
  if (event.type === 'system' && event.subtype === 'compact_boundary') { const meta = event.compact_metadata || {}; message.compactions = [...(message.compactions || []), { trigger: meta.trigger || '', before: count(meta.pre_tokens), after: count(meta.post_tokens) }]; progressOf(message).updatedAt = new Date().toISOString(); }
  if (event.type === 'result') {
    message.usage = usageOf(event);
    if (!message.text && event.result) message.text = event.result;
    if (event.is_error) { message.error = true; message.text += '\n' + (event.errors || []).join('\n'); }
    // US-06: chạm --max-turns → lượt dừng, bộ tự động coi là bị chặn và không tự chạy lại.
    if (event.subtype === 'error_max_turns') { message.error = true; message.maxTurns = true; message.text += '\nChạm giới hạn số lượt tool của khối; dừng để bạn kiểm tra trước khi chạy tiếp.'; }
    // Chỉ nhắc đổi mode khi có thao tác bị chặn bởi mode/quy tắc; thao tác người dùng tự từ chối đã ghi ở message.denied.
    if (event.permission_denials?.some(denial => !(message.denied || []).includes(denial.tool_name))) message.text += '\nMột số thao tác bị từ chối quyền. Chọn mode phù hợp rồi gửi lại nếu bạn muốn cho phép sửa tệp.';
    return event.session_id;
  }
}
// Giao thức điều khiển stream-json của CLI (giống Agent SDK): CLI gửi control_request, app trả control_response cùng request_id.
const controlReply = (requestId, response) => JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }) + '\n';
const controlError = (requestId, error) => JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } }) + '\n';
const userLine = prompt => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] }, parent_tool_use_id: null, session_id: '' }) + '\n';
// Câu trả lời cho can_use_tool: cho phép giữ nguyên input; từ chối kèm lý do để model biết và đổi hướng.
function permissionResult(decision, input) { return decision?.allow ? { behavior: 'allow', updatedInput: decision.updatedInput || input || {} } : { behavior: 'deny', message: decision?.message || 'Người dùng từ chối thao tác này.' }; }
// askPermission({ tool, input, toolUseId }) → Promise<{ allow, message? }>. Không truyền thì mọi yêu cầu bị từ chối (an toàn mặc định).
// brief: hướng dẫn vai trò gửi qua system prompt (prompt.cjs). CLI ghi lại system prompt ở lần gọi đầu của phiên và dùng lại
// nguyên văn khi resume, nên brief được cache và không cộng dồn vào lịch sử như khi nằm trong tin người dùng.
// Lệnh nền model chạy bằng Bash (ví dụ `(node serve.js &)` để xem ảnh) kế thừa pipe stdout/stderr của CLI và sống tiếp sau khi CLI thoát.
// Khi đó 'close' của tiến trình không bao giờ đến: tin kẹt "đang chạy", task và nút sơ đồ đứng mãi. Tiến trình đã thoát thì chờ một
// chút cho dữ liệu còn lại đọc xong, rồi đóng pipe phía app để 'close' (và mọi xử lý kết thúc lượt) chạy.
const EXIT_GRACE_MS = 3000;
// Giữ khoá tool (Penpot) qua cả chuỗi gọi liền nhau của một lượt: import_image và shape mới nằm ở page đang mở, nên khối khác
// không được chen vào đổi page giữa hai lần gọi. Chuỗi hết khi lượt gọi tool khác, trả kết quả, hoặc quá thời gian này không gọi tiếp.
const LOCK_LEASE_MS = 30000;
const RESULT_EXIT_MS = 30000;
function closeAfterExit(child, grace = EXIT_GRACE_MS) {
  child.once('exit', () => { const timer = setTimeout(() => { for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy(); }, grace); timer.unref?.(); child.once('close', () => clearTimeout(timer)); });
}
function launch({ brief = '', mcpConfig = null, executable, directory, settings, mcp, mcpServers = [], thread, profileId, prompt, role, save, publish, askPermission, scope = null, resume = true, maxTurns = 0, extraDirs = [], resultExitMs = RESULT_EXIT_MS, toolLock = null, lockedServers = [], lockLeaseMs = LOCK_LEASE_MS, sessionRole = '' }) {
  const message = { id: randomUUID(), role: role || 'Claude', text: '', time: new Date().toISOString(), streaming: true };
  message.progress = { startedAt: message.time, steps: 0, lastTool: '', target: '' };
  thread.messages.push(message);
  const seen = new Set();
  // mcpConfig: chỉ các MCP server bật cho role (US-08), ghi ra tệp riêng của lượt; không có thì dùng cấu hình chung.
  const mcpFile = mcpConfig ? path.join(directory, 'mcp', message.id + '.json') : '';
  if (mcpFile) { fs.mkdirSync(path.dirname(mcpFile), { recursive: true }); fs.writeFileSync(mcpFile, JSON.stringify(mcpConfig)); }
  const args = sessionArgs(settings, mcpFile || mcp);
  args[args.indexOf('--permission-mode') + 1] = cliMode(thread.mode, scope);
  args[args.indexOf('--tools') + 1] = cliTools(thread.mode, scope);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  // Không mở phiên mới: phiên được tiếp tục mãi và CLI tự compact khi ngữ cảnh chạm ngưỡng (như Claude Code trong Claude Desktop).
  args.push('--autocompact', AUTOCOMPACT_WINDOW);
  // Truyền đường dẫn tệp: PowerShell 5.1 làm hỏng dấu " khi truyền JSON làm tham số cho chương trình ngoài.
  if (scope?.bash) { const agents = path.join(directory, 'agents.json'); fs.writeFileSync(agents, agentsArg()); args.push('--agents', agents); }
  const briefFile = brief ? path.join(directory, 'briefs', message.id + '.md') : '';
  if (briefFile) { fs.mkdirSync(path.dirname(briefFile), { recursive: true }); fs.writeFileSync(briefFile, brief); args.push('--append-system-prompt-file', briefFile); }
  args.push('--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-prompt-tool', 'stdio', '--verbose', '--include-partial-messages', '--model', thread.model || 'claude-opus-5-5', ...extraFolderArgs(foldersOf(thread)), ...extraDirs.flatMap(dir => ['--add-dir', dir]), '--allowedTools', allowedFor(thread.mode, toolLock ? mcpServers.filter(name => !lockedServers.includes(name)) : mcpServers));
  // toolLock (penpot.createLock): tool của lockedServers bị bỏ khỏi --allowedTools để CLI hỏi app trước mỗi lần gọi; app giữ khoá
  // từ lúc cho phép tới khi có tool_result (hoặc hết lượt). Tool vốn được cho phép sẵn thì không hiện hộp duyệt.
  const preAllowed = new Set(String(allowedFor(thread.mode, mcpServers)).split(',')), held = new Set();
  const LEASE = '~chuoi'; let leaseTimer = null;
  const lockedTool = tool => lockedServers.some(name => String(tool || '').startsWith('mcp__' + name + '__'));
  const endLease = () => { clearTimeout(leaseTimer); leaseTimer = null; if (held.delete(LEASE)) toolLock.release(message.id, LEASE); };
  const releaseAll = () => { clearTimeout(leaseTimer); leaseTimer = null; held.clear(); toolLock.releaseRun(message.id); };
  const releaseHeld = id => {
    if (!held.delete(id)) return; toolLock.release(message.id, id);
    if (held.has(LEASE) && held.size === 1) { clearTimeout(leaseTimer); leaseTimer = setTimeout(endLease, lockLeaseMs); leaseTimer.unref?.(); }
  };
  // Lượt bắt đầu gọi tool không có khoá (Bash, Read…): chuỗi gọi Penpot đã xong.
  const watchTools = event => {
    if (!held.has(LEASE)) return;
    const names = event.type === 'stream_event' && event.event?.type === 'content_block_start' && event.event.content_block?.type === 'tool_use' ? [event.event.content_block.name]
      : event.type === 'assistant' && Array.isArray(event.message?.content) ? event.message.content.filter(block => block.type === 'tool_use').map(block => block.name) : [];
    if (names.some(name => !lockedTool(name))) endLease();
  };
  thread.cliSessions ||= {};
  // sessionRole: tên phiên CLI (mặc định = khối). Bước của một nhánh chạy song song (Art Director/Lead Dev) có phiên riêng "<khối>~<nhánh>".
  const key = resumeKey(profileId, thread.folder, sessionRole || role);
  // resume=false: role làm việc theo tệp .md mở phiên mới mỗi lượt thay vì kéo dài một phiên phình mãi.
  const resumedId = resume && thread.cliSessions[key] ? thread.cliSessions[key] : '';
  if (resumedId) args.push('--resume', resumedId);
  const totals = thread.sessionTotals ||= {};
  // Không pipe qua biến PowerShell: CLI nhận thẳng stdin của tiến trình để app trả lời yêu cầu duyệt trong lúc chạy.
  const script = '$ProgressPreference = \'SilentlyContinue\'; [Console]::InputEncoding = New-Object Text.UTF8Encoding($false); [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $OutputEncoding = [Console]::OutputEncoding; & ' + [executable, ...args].map(psLiteral).join(' ') + '; exit $LASTEXITCODE';
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: thread.folder, env: { ...cleanEnv(process.env, directory), ...BASH_TIMEOUTS, ...PYTHON_UTF8, OFFICE_USAGE_FILE: path.join(directory, 'usage.json'), OFFICE_DESK_DIR: QA_KIT_APP_DIR }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = '', errors = '', ended = false;
  // Đã có kết quả mà CLI không thoát (còn chờ tác vụ nền, vd dev server bỏ lại): tin kẹt "đang chạy", task và nút sơ đồ đứng mãi.
  // Quá resultExitMs thì tắt cả cây tiến trình; lượt vẫn tính là xong vì kết quả đã về.
  const afterResult = () => { const timer = setTimeout(() => { if (ended || !child.pid) return; message.killedAfterResult = true; execFile(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); }, resultExitMs); timer.unref?.(); child.once('close', () => clearTimeout(timer)); };
  const send = line => { if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(line); };
  async function control(event) {
    const requestId = event.request_id, request = event.request || {};
    if (request.subtype !== 'can_use_tool') { send(controlError(requestId, 'Office Desk không hỗ trợ yêu cầu ' + request.subtype)); return; }
    const tool = request.tool_name || '', server = toolLock ? lockedServers.find(name => tool.startsWith('mcp__' + name + '__')) : '';
    const progress = progressOf(message); progress.waiting = tool; publish();
    let decision; try {
      decision = server && preAllowed.has('mcp__' + server) ? { allow: true } : askPermission ? await askPermission({ tool, input: request.input || {}, toolUseId: request.tool_use_id }) : null;
      if (server && decision?.allow) {
        const holder = toolLock.holder(), lockKey = request.tool_use_id || requestId;
        if (holder && holder.run !== message.id) { delete progress.waiting; progress.lockWait = holder.label || 'khối khác'; publish(); }
        await toolLock.acquire(message.id, lockKey, message.role);
        if (ended) { toolLock.release(message.id, lockKey); throw Error('Lượt đã kết thúc.'); }
        held.add(lockKey); clearTimeout(leaseTimer); leaseTimer = null;
        if (!held.has(LEASE)) { await toolLock.acquire(message.id, LEASE, message.role); held.add(LEASE); }
      }
    } catch (error) { decision = { allow: false, message: error.message }; }
    delete progress.waiting; delete progress.lockWait; if (!decision?.allow) message.denied = [...(message.denied || []), request.tool_name];
    send(controlReply(requestId, permissionResult(decision, request.input))); publish();
  }
  const parse = line => { try { const event = JSON.parse(line); if (event.type === 'control_request') { control(event); return; } const id = consume(message, event, seen); if (id) thread.cliSessions[key] = id; if (held.size) watchTools(event); if (held.size && event.type === 'user' && Array.isArray(event.message?.content)) for (const block of event.message.content) if (block.type === 'tool_result') releaseHeld(block.tool_use_id); if (event.type === 'result') { if (toolLock) releaseAll(); const turn = turnUsage(message.usage, totals[resumedId], Boolean(resumedId)); message.usage = turn.usage; if (id) recordTotal(totals, id, turn.total); child.stdin.end(); afterResult(); } if (event.type === 'rate_limit_event') { const usagePath = path.join(directory, 'usage.json'); let previous = {}; try { previous = JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch {} const usage = usageEvent(event, previous); if (usage) fs.writeFileSync(usagePath, JSON.stringify(usage)); } } catch {} };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { pending += chunk; if (pending.length > 5 * 1024 * 1024) { pending = ''; errors = 'CLI xuất dữ liệu vượt giới hạn'; child.kill(); return; } const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) parse(line); publish(); });
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
  // stdin giữ mở tới khi CLI trả event result (để trả lời yêu cầu duyệt), rồi đóng để CLI thoát.
  child.stdin.on('error', () => {}); send(userLine(prompt));
  const finish = code => { if (ended) return; ended = true; if (toolLock) releaseAll(); for (const file of [briefFile, mcpFile]) if (file) fs.rm(file, { force: true }, () => {}); if (pending.trim()) parse(pending); message.streaming = false; delete message.deltaSeen; message.progress.finishedAt = new Date().toISOString(); const stderr = cleanStderr(errors); if (code !== 0 && !message.killedAfterResult) { message.error = true; message.text += '\n' + (stderr || CLI_FAILED_TEXT); } if (!message.text) message.text = stderr || CLI_EMPTY_TEXT; save(); publish(); };
  child.on('error', error => { errors = error.message; finish(1); }); child.on('close', finish); closeAfterExit(child);
  // CLI thoát: dọn dev server / trình duyệt mà lệnh Bash của lượt bỏ lại (proc-tree.cjs), để lượt sau không bị chiếm cổng.
  const launchedAt = Date.now(); child.once('exit', () => { killLeftovers(child.pid, launchedAt).catch(() => {}); });
  return { child, cancel: () => { if (child.pid && !ended) execFile(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); }, message };
}
module.exports = { LOCK_LEASE_MS, BASH_TIMEOUTS, consume, launch, closeAfterExit, targetOf, usageOf, turnUsage, cleanStderr, permissionResult, userLine, CLI_FAILED_TEXT, CLI_EMPTY_TEXT };
