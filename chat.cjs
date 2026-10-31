const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { usageEvent } = require('./usage.cjs');
const { cleanEnv, sessionArgs, psLiteral } = require('./core.cjs');
const { foldersOf, extraFolderArgs } = require('./usage.cjs');
const { cliMode, cliTools, allowedFor } = require('./modes.cjs');
const { agentsArg } = require('./subagent.cjs');
const { resumeKey } = require('./workers.cjs');
// Mô tả ngắn mục tiêu của một lượt gọi công cụ để hiển thị tiến độ (không lưu toàn bộ input).
function targetOf(input = {}) {
  const value = input.file_path || input.path || input.pattern || input.command || input.description || input.url || '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  const short = /[\\/]/.test(text) && !input.command ? text.split(/[\\/]/).filter(Boolean).at(-1) : text;
  return short.length > 80 ? short.slice(0, 80) + '…' : short;
}
function progressOf(message) { return message.progress ||= { startedAt: message.time || new Date().toISOString(), steps: 0, lastTool: '', target: '' }; }
function trackTool(message, block, seen) {
  if (block.id && seen.has(block.id)) return; if (block.id) seen.add(block.id);
  const progress = progressOf(message); progress.steps++; progress.lastTool = block.name; progress.target = targetOf(block.input); progress.updatedAt = new Date().toISOString();
}
// Thông báo lỗi chuẩn khi CLI không để lại stderr/text dùng được (US-07).
const CLI_FAILED_TEXT = 'CLI dừng hoặc gặp lỗi. Kiểm tra đăng nhập và phiên bản Claude Code.';
const CLI_EMPTY_TEXT = 'CLI không trả về nội dung text.';
// Token/chi phí của một lượt từ event result (US-01). Thiếu trường hoặc sai kiểu thì tính 0, không throw.
const count = value => Number.isFinite(value) ? value : 0;
function usageOf(event) {
  const usage = event?.usage || {};
  return { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens), costUsd: count(event?.total_cost_usd), turns: count(event?.num_turns) };
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
    const toolBlocks = content.filter(block => block.type === 'tool_use'); for (const block of toolBlocks) trackTool(message, block, seen);
    const tools = toolBlocks.map(block => block.name);
    if (tools.length) message.tools = [...new Set([...(message.tools || []), ...tools])];
    message.deltaSeen = false;
  }
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
function launch({ executable, directory, settings, mcp, mcpServers = [], thread, profileId, prompt, role, save, publish, askPermission, scope = null, resume = true, maxTurns = 0, extraDirs = [] }) {
  const message = { id: randomUUID(), role: role || 'Claude', text: '', time: new Date().toISOString(), streaming: true };
  message.progress = { startedAt: message.time, steps: 0, lastTool: '', target: '' };
  thread.messages.push(message);
  const seen = new Set();
  const args = sessionArgs(settings, mcp);
  args[args.indexOf('--permission-mode') + 1] = cliMode(thread.mode, scope);
  args[args.indexOf('--tools') + 1] = cliTools(thread.mode, scope);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  // Truyền đường dẫn tệp: PowerShell 5.1 làm hỏng dấu " khi truyền JSON làm tham số cho chương trình ngoài.
  if (scope?.bash) { const agents = path.join(directory, 'agents.json'); fs.writeFileSync(agents, agentsArg()); args.push('--agents', agents); }
  args.push('--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-prompt-tool', 'stdio', '--verbose', '--include-partial-messages', '--model', thread.model || 'claude-opus-5-5', ...extraFolderArgs(foldersOf(thread)), ...extraDirs.flatMap(dir => ['--add-dir', dir]), '--allowedTools', allowedFor(thread.mode, mcpServers));
  thread.cliSessions ||= {};
  const key = resumeKey(profileId, thread.folder, role);
  // resume=false: role làm việc theo tệp .md mở phiên mới mỗi lượt thay vì kéo dài một phiên phình mãi.
  if (resume && thread.cliSessions[key]) args.push('--resume', thread.cliSessions[key]);
  // Không pipe qua biến PowerShell: CLI nhận thẳng stdin của tiến trình để app trả lời yêu cầu duyệt trong lúc chạy.
  const script = '$ProgressPreference = \'SilentlyContinue\'; [Console]::InputEncoding = New-Object Text.UTF8Encoding($false); [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $OutputEncoding = [Console]::OutputEncoding; & ' + [executable, ...args].map(psLiteral).join(' ') + '; exit $LASTEXITCODE';
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: thread.folder, env: { ...cleanEnv(process.env, directory), OFFICE_USAGE_FILE: path.join(directory, 'usage.json') }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = '', errors = '', ended = false;
  const send = line => { if (!child.stdin.destroyed && child.stdin.writable) child.stdin.write(line); };
  async function control(event) {
    const requestId = event.request_id, request = event.request || {};
    if (request.subtype !== 'can_use_tool') { send(controlError(requestId, 'Office Desk không hỗ trợ yêu cầu ' + request.subtype)); return; }
    const progress = progressOf(message); progress.waiting = request.tool_name; publish();
    let decision; try { decision = askPermission ? await askPermission({ tool: request.tool_name, input: request.input || {}, toolUseId: request.tool_use_id }) : null; } catch (error) { decision = { allow: false, message: error.message }; }
    delete progress.waiting; if (!decision?.allow) message.denied = [...(message.denied || []), request.tool_name];
    send(controlReply(requestId, permissionResult(decision, request.input))); publish();
  }
  const parse = line => { try { const event = JSON.parse(line); if (event.type === 'control_request') { control(event); return; } const id = consume(message, event, seen); if (id) thread.cliSessions[key] = id; if (event.type === 'result') child.stdin.end(); if (event.type === 'rate_limit_event') { const usagePath = path.join(directory, 'usage.json'); let previous = {}; try { previous = JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch {} const usage = usageEvent(event, previous); if (usage) fs.writeFileSync(usagePath, JSON.stringify(usage)); } } catch {} };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { pending += chunk; if (pending.length > 5 * 1024 * 1024) { pending = ''; errors = 'CLI xuất dữ liệu vượt giới hạn'; child.kill(); return; } const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) parse(line); publish(); });
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
  // stdin giữ mở tới khi CLI trả event result (để trả lời yêu cầu duyệt), rồi đóng để CLI thoát.
  child.stdin.on('error', () => {}); send(userLine(prompt));
  const finish = code => { if (ended) return; ended = true; if (pending.trim()) parse(pending); message.streaming = false; delete message.deltaSeen; message.progress.finishedAt = new Date().toISOString(); const stderr = cleanStderr(errors); if (code !== 0) { message.error = true; message.text += '\n' + (stderr || CLI_FAILED_TEXT); } if (!message.text) message.text = stderr || CLI_EMPTY_TEXT; save(); publish(); };
  child.on('error', error => { errors = error.message; finish(1); }); child.on('close', finish);
  return { child, cancel: () => { if (child.pid && !ended) execFile(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); }, message };
}
module.exports = { consume, launch, targetOf, usageOf, cleanStderr, permissionResult, userLine, CLI_FAILED_TEXT, CLI_EMPTY_TEXT };
