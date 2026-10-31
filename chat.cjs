const { spawn, execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { usageEvent } = require('./usage.cjs');
const { cleanEnv, sessionArgs, psLiteral } = require('./core.cjs');
const { foldersOf, extraFolderArgs } = require('./usage.cjs');
const { permissionMode, toolsFor, allowedFor } = require('./modes.cjs');
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
    if (event.permission_denials?.length) message.text += '\nMột số thao tác bị từ chối quyền. Chọn mode phù hợp rồi gửi lại nếu bạn muốn cho phép sửa tệp.';
    return event.session_id;
  }
}
function launch({ executable, directory, settings, mcp, mcpServers = [], thread, profileId, prompt, role, save, publish }) {
  const message = { id: randomUUID(), role: role || 'Claude', text: '', time: new Date().toISOString(), streaming: true };
  message.progress = { startedAt: message.time, steps: 0, lastTool: '', target: '' };
  thread.messages.push(message);
  const seen = new Set();
  const args = sessionArgs(settings, mcp);
  args[args.indexOf('--permission-mode') + 1] = permissionMode(thread.mode);
  args[args.indexOf('--tools') + 1] = toolsFor(thread.mode);
  args.push('--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', thread.model || 'claude-opus-5-5', ...extraFolderArgs(foldersOf(thread)), '--allowedTools', allowedFor(thread.mode, mcpServers));
  thread.cliSessions ||= {};
  const key = resumeKey(profileId, thread.folder, role);
  if (thread.cliSessions[key]) args.push('--resume', thread.cliSessions[key]);
  const script = '$ProgressPreference = \'SilentlyContinue\'; [Console]::InputEncoding = New-Object Text.UTF8Encoding($false); [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); $OutputEncoding = [Console]::OutputEncoding; $chatPrompt = [Console]::In.ReadToEnd(); $chatPrompt | & ' + [executable, ...args].map(psLiteral).join(' ') + '; exit $LASTEXITCODE';
  const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: thread.folder, env: { ...cleanEnv(process.env, directory), OFFICE_USAGE_FILE: path.join(directory, 'usage.json') }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = '', errors = '', ended = false;
  const parse = line => { try { const event = JSON.parse(line); const id = consume(message, event, seen); if (id) thread.cliSessions[key] = id; if (event.type === 'rate_limit_event') { const usagePath = path.join(directory, 'usage.json'); let previous = {}; try { previous = JSON.parse(fs.readFileSync(usagePath, 'utf8')); } catch {} const usage = usageEvent(event, previous); if (usage) fs.writeFileSync(usagePath, JSON.stringify(usage)); } } catch {} };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { pending += chunk; if (pending.length > 5 * 1024 * 1024) { pending = ''; errors = 'CLI xuất dữ liệu vượt giới hạn'; child.kill(); return; } const lines = pending.split(/\r?\n/); pending = lines.pop(); for (const line of lines) parse(line); publish(); });
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
  child.stdin.on('error', () => {}); child.stdin.end(prompt);
  const finish = code => { if (ended) return; ended = true; if (pending.trim()) parse(pending); message.streaming = false; delete message.deltaSeen; message.progress.finishedAt = new Date().toISOString(); const stderr = cleanStderr(errors); if (code !== 0) { message.error = true; message.text += '\n' + (stderr || CLI_FAILED_TEXT); } if (!message.text) message.text = stderr || CLI_EMPTY_TEXT; save(); publish(); };
  child.on('error', error => { errors = error.message; finish(1); }); child.on('close', finish);
  return { child, cancel: () => { if (child.pid && !ended) execFile(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); }, message };
}
module.exports = { consume, launch, targetOf, usageOf, cleanStderr, CLI_FAILED_TEXT, CLI_EMPTY_TEXT };
