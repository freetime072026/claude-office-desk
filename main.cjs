const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const pty = require('node-pty');
const { profileDir, cleanEnv, sessionArgs, commandFor } = require('./core.cjs');
const teamStore = require('./team.cjs');
const { normalizeUsage, foldersOf, extraFolderArgs } = require('./usage.cjs');
const { defaults: roleDefaults } = require('./roles.cjs');
const chatEngine = require('./chat.cjs');
const chats = new Map();
const { worker: getWorker, runKey, resumeKey, removable, QA_ROUND_LIMIT, PIPELINE, LEAD, ACTIVE_TASK } = require('./workers.cjs');
const { rolePrompt } = require('./prompt.cjs');
const { needsConfirm } = require('./modes.cjs');
const pipeline = require('./pipeline.cjs');
const { retryable } = require('./dispatch.cjs');
// Thư mục đã chọn có thể bị xóa/đổi tên; trả false thay vì để ENOENT thô lọt ra giao diện.
function isFolder(folder) { try { return fs.statSync(folder).isDirectory(); } catch { return false; } }
const MCP_NAME = /^[A-Za-z0-9_-]{1,64}$/;
// Danh sách MCP server do người dùng khai báo trong mcp-servers.json (userData). Lỗi cú pháp được báo, không bỏ qua ngầm.
function mcpServerNames() {
  let data; try { data = JSON.parse(fs.readFileSync(mcp, 'utf8')); } catch (error) { throw Error('mcp-servers.json không hợp lệ (' + error.message + '). Sửa bằng /mcp open.'); }
  if (!data || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) throw Error('mcp-servers.json cần dạng {"mcpServers":{...}}. Sửa bằng /mcp open.');
  const names = Object.keys(data.mcpServers); const bad = names.find(name => !MCP_NAME.test(name));
  if (bad) throw Error('Tên MCP server "' + bad + '" chỉ được gồm chữ, số, _ và -'); return names;
}
function sameOrNested(first, second) { const a = path.resolve(first).toLowerCase(), b = path.resolve(second).toLowerCase(); return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep); }
function editOverlap(thread) { const folders = foldersOf(thread); return [...chats.values()].some(run => run.mode !== 'read' && run.folders.some(folder => folders.some(other => sameOrNested(folder, other)))); }
// Nguồn duy nhất cho "khối đang chạy" khi xét xóa role (snapshot và action team dùng chung).
function busyLabels(thread) { return thread.flow.filter(label => chats.has(runKey(thread.id, label))); }
function removalOf(thread) { const busy = busyLabels(thread); return Object.fromEntries(thread.flow.map(label => [label, removable(thread, label, { busy: busy.includes(label) })])); }
const { checkAuth } = require('./auth.cjs');
async function ensureAuth(id) {
  const item = profile(id); if (!executable || !fs.existsSync(executable)) return { unavailable: true };
  const directory = profileDir(root, id); fs.mkdirSync(directory, { recursive: true });
  try { item.auth = await checkAuth(executable, directory); } catch (error) { item.auth = { loggedIn: null, error: error.message, checkedAt: Date.now() }; persist(); publish(); throw Error('Không kiểm tra được đăng nhập: ' + error.message); }
  if (item.auth.loggedIn) { persist(); publish(); return { loggedIn: true }; }
  const existing = [...sessions.values()].find(session => session.profileId === id && session.kind === 'login' && session.running);
  if (!existing) start(id, 'login');
  persist(); publish(); return { loginStarted: true };
}
// snapshot() chạy rất thường xuyên: chỉ đọc lại usage.json khi tệp đổi (mtime); normalize lại mỗi lần vì cờ cũ/hết hạn phụ thuộc thời gian.
const usageCache = new Map();
function readUsage(id) {
  try {
    const file = path.join(profileDir(root, id), 'usage.json'), { mtimeMs } = fs.statSync(file);
    let cached = usageCache.get(id); if (cached?.mtimeMs !== mtimeMs) usageCache.set(id, cached = { mtimeMs, value: JSON.parse(fs.readFileSync(file, 'utf8')) });
    return normalizeUsage(cached.value);
  } catch { usageCache.delete(id); return null; }
}
let window, root, metadata, executable = '', settings, mcp;
const sessions = new Map();
const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
// Gom các lần lưu liên tiếp (mỗi lượt chat, mỗi thao tác) thành một lần ghi; flushPersist() ghi ngay khi thoát app.
let persistTimer = null;
function flushPersist() { if (!persistTimer) return; clearTimeout(persistTimer); persistTimer = null; const target = path.join(root, 'workspace.json'); fs.writeFileSync(target + '.tmp', JSON.stringify(metadata)); fs.renameSync(target + '.tmp', target); }
function persist() { persistTimer ||= setTimeout(flushPersist, 300); }
function profile(id) { const found = metadata.profiles.find(item => item.id === id); if (!found) throw Error('Không tìm thấy hồ sơ'); return found; }
function publish() { clearTimeout(publishTimer); publishTimer = null; if (window && !window.isDestroyed()) window.webContents.send('state', snapshot()); }
// Luồng stream gọi mỗi chunk; gửi trạng thái tối đa ~10 lần/giây thay vì mỗi chunk.
let publishTimer = null;
function publishSoon() { publishTimer ||= setTimeout(publish, 100); }
function snapshot() { return { activeProfileId: metadata.activeProfileId || metadata.profiles[0]?.id || '', team: metadata.team, removal: Object.fromEntries((metadata.team?.threads || []).map(thread => [thread.id, removalOf(thread)])), qaRoundLimit: QA_ROUND_LIMIT, pipeline: PIPELINE, profiles: metadata.profiles.map(item => ({ ...item, usage: readUsage(item.id) })), executable, sessions: [...sessions.values()].map(({ id, profileId, folder, kind, running, code }) => ({ id, profileId, folder, kind, running, code })) }; }
function requireTrusted(event) { const allowed = [entry, pathToFileURL(path.join(__dirname, 'dashboard.html')).href]; if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !allowed.includes(event.senderFrame.url)) throw Error('Unauthorized'); }
function start(profileId, kind, task) {
  const item = profile(profileId);
  if (!executable || !fs.existsSync(executable)) throw Error('Chọn tệp Claude Code trước');
  if (kind !== 'work' && kind !== 'login' && kind !== 'logout') throw Error('Thao tác không hợp lệ');
  if ([...sessions.values()].some(session => session.profileId === profileId && session.running && (kind !== 'work' || session.kind !== 'work'))) throw Error('Đóng phiên đang chạy của hồ sơ trước khi đăng nhập/đăng xuất');
  const directory = profileDir(root, profileId);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== path.resolve(directory)) throw Error('Thư mục hồ sơ không được là liên kết');
  const folder = kind === 'work' ? (task?.folder || item.folder) : directory;
  if (!folder || !isFolder(folder)) throw Error(folder ? 'Thư mục không tồn tại: ' + folder : 'Chọn thư mục làm việc trước');
  const usageFile = path.join(directory, 'usage.json');
  const localSettings = path.join(directory, 'office-settings.json');
  const policy = JSON.parse(fs.readFileSync(settings, 'utf8'));
  const statusScript = fs.readFileSync(path.join(__dirname, 'usage-status.ps1'), 'utf8');
  const statusCommand = 'powershell.exe -NoLogo -NoProfile -EncodedCommand ' + Buffer.from(statusScript, 'utf16le').toString('base64');
  policy.statusLine = { type: 'command', command: statusCommand };
  fs.writeFileSync(localSettings, JSON.stringify(policy));
  if (kind !== 'work') { try { fs.unlinkSync(usageFile); } catch {} }
  const args = kind === 'work' ? sessionArgs(localSettings, mcp) : ['auth', kind];
  if (task) { const folders = foldersOf(task); for (const extra of folders) if (!isFolder(extra)) throw Error('Thư mục không tồn tại: ' + extra); args.push(...extraFolderArgs(folders)); }
  if (task) { args.push('--session-id', task.runId, '--', task.prompt); }
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(commandFor(executable, args), 'utf16le').toString('base64');
  const terminal = pty.spawn(powershell, ['-NoLogo', '-NoProfile', '-EncodedCommand', encoded], { name: 'xterm-256color', cols: 100, rows: 30, cwd: folder, env: { ...cleanEnv(process.env, directory), OFFICE_USAGE_FILE: usageFile }, useConpty: true });
  const id = randomUUID();
  const session = { id, profileId, folder, kind, terminal, threadId: task?.threadId, running: true, buffer: '', sequence: 0 };
  sessions.set(id, session);
  terminal.onData(data => { session.sequence += 1; session.buffer = (session.buffer + data).slice(-500000); if (!window.isDestroyed()) window.webContents.send('terminal', { id, data, sequence: session.sequence }); });
  terminal.onExit(({ exitCode }) => { session.running = false; session.code = exitCode; publish(); if (kind === 'login' || kind === 'logout') checkAuth(executable, directory).then(auth => { item.auth = auth; persist(); publish(); }).catch(() => {}); });
  publish(); return id;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.whenReady().then(() => {
  root = app.getPath('userData'); fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  metadata = { profiles: [], executable: '' };
  const target = path.join(root, 'workspace.json');
  if (fs.existsSync(target)) {
    try { metadata = JSON.parse(fs.readFileSync(target, 'utf8')); if (!Array.isArray(metadata.profiles)) throw Error(); for (const item of metadata.profiles) { profileDir(root, item.id); if (typeof item.name !== 'string' || (item.folder && typeof item.folder !== 'string')) throw Error(); } executable = metadata.executable || ''; }
    catch { dialog.showErrorBox('Không đọc được cấu hình', 'Hãy sao lưu và kiểm tra workspace.json trong ' + root); app.quit(); return; }
  }
  metadata.team ||= teamStore.initial();
  for (const thread of metadata.team.threads) { teamStore.migrateThread(thread); delete thread.dispatchPumping; delete thread.dispatchAgain; for (const task of thread.dispatch || []) if (['starting', 'running'].includes(task.status)) { task.status = 'blocked'; task.error = 'Ứng dụng đã đóng trong lúc chạy; kiểm tra kết quả trước khi thử lại'; } }
  settings = path.join(root, 'restricted-settings.json'); mcp = path.join(root, 'mcp-servers.json');
  // 0.10: bật Shell (Bash) cho mode có sửa tệp. Deny Read(...) chỉ chặn tool Read/Grep/Glob; lệnh shell (vd. type .env) vẫn đọc được,
  // nên chỉ mode Plan thực sự không đọc được các tệp này.
  fs.writeFileSync(settings, JSON.stringify({ disableAllHooks: true, enabledPlugins: {}, permissions: { defaultMode: 'default', deny: ['NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task', 'Read(**/.env)', 'Read(**/.env.*)', 'Read(**/.credentials.json)', 'Read(**/*.pem)', 'Read(**/id_rsa)', 'Read(**/id_ed25519)'] } }));
  if (!fs.existsSync(mcp)) fs.writeFileSync(mcp, JSON.stringify({ mcpServers: {} }, null, 2));
  const pumpThread = thread => teamStore.isHalted(thread) ? Promise.resolve() : require('./dispatch.cjs').pump(thread, task => handleDesk(null, 'chat-send', { id: thread.id, role: task.worker, text: getWorker(thread, task.worker).task === task.task ? 'Thực hiện task Lead giao ở mục "Task của khối".' : 'Thực hiện task Lead giao:\n' + task.task, auto: true }), () => { persist(); publish(); });
  const isRunning = (thread, label) => chats.has(runKey(thread.id, label));
  async function approveAuto(thread) {
    const folders = foldersOf(thread);
    if (!thread.flow.some(label => needsConfirm(getWorker(thread, label).mode, folders))) return true;
    const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Chạy tự động các bước còn lại: ' + thread.flow.slice(thread.stage).join(' → ') + '?', detail: 'Các khối đọc/sửa tệp và chạy lệnh shell theo mode của từng khối, không hỏi lại từng lượt cho tới khi tắt (/auto off):\n' + folders.join('\n'), buttons: ['Hủy', 'Chạy tự động'], defaultId: 0, cancelId: 0 });
    return answer.response === 1;
  }
  const autoRun = pipeline.createAutoRun({
    update: (thread, action, payload) => teamStore.update(metadata.team, action, { ...payload, id: thread.id }),
    send: (thread, label, text) => handleDesk(null, 'chat-send', { id: thread.id, role: label, text, auto: true }),
    pump: pumpThread, isRunning, approve: approveAuto,
    log: (thread, role, text) => thread.messages.push({ role, text, time: new Date().toISOString() }),
    changed: () => { persist(); publish(); }
  });
  // /role <khối> start|pause. Trả về câu trả lời hiển thị trong chat; việc chạy được khởi động sau khi trả lời.
  function roleCommand(thread, label, verb) {
    const config = getWorker(thread, label), tasks = (thread.dispatch || []).filter(task => task.worker === label);
    if (verb === 'pause') {
      config.paused = true; for (const task of tasks) if (ACTIVE_TASK.includes(task.status)) task.status = 'paused';
      chats.get(runKey(thread.id, label))?.cancel();
      return { text: label + ' đã tạm dừng. Bước tự động sẽ chờ tại khối này; dùng /role ' + label + ' start để tiếp tục.' };
    }
    delete config.paused;
    if (isRunning(thread, label)) return { text: label + ' đang chạy.' };
    const resumable = tasks.filter(task => ['paused', 'blocked', 'failed', 'cancelled'].includes(task.status));
    if (resumable.length) { for (const task of resumable) { task.status = 'queued'; delete task.error; } return { text: 'Tiếp tục task của ' + label + '.', run: () => pumpThread(thread) }; }
    if (thread.auto?.enabled && thread.flow[thread.stage] === label && !teamStore.isHalted(thread)) return { text: 'Tiếp tục bước tự động ' + label + '.', run: () => autoRun.runStage(thread) };
    return { text: 'Chạy ' + label + '.', run: () => handleDesk(null, 'chat-send', { id: thread.id, role: label, text: config.task ? 'Thực hiện task:\n' + config.task : 'Thực hiện nhiệm vụ theo yêu cầu session.' }) };
  }
  // Chạy việc nền sau lệnh chat; lỗi hiện trong hội thoại thay vì mất.
  const background = (thread, job) => setImmediate(() => Promise.resolve().then(job).catch(error => { thread.messages.push({ role: 'Tự động', text: error.message, time: new Date().toISOString() }); persist(); publish(); }));
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 920, minHeight: 620, backgroundColor: '#151820', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle('desk', handleDesk);
  async function handleDesk(event, action, payload = {}) {
    if (event) { requireTrusted(event); delete payload.auto; }
    if (action === 'state') return snapshot();
    if (action === 'role-defaults') return roleDefaults;
    if (action === 'copy-text') { if (typeof payload.text !== 'string' || payload.text.length > 2 * 1024 * 1024) throw Error('Nội dung copy quá dài'); clipboard.writeText(payload.text); return true; }
    if (action === 'file-read') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại'); return require('./files.cjs').readProjectFile(payload.path, foldersOf(thread)); }
    if (action === 'chat-stop') { const thread = metadata.team.threads.find(item => item.id === payload.id); for (const task of thread?.dispatch || []) if (task.worker === payload.role && ACTIVE_TASK.includes(task.status)) task.status = 'cancelled'; chats.get(runKey(payload.id, payload.role))?.cancel(); persist(); publish(); return true; }
    if (action === 'dispatch-retry') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại'); for (const task of thread.dispatch || []) if (['blocked', 'failed', 'cancelled'].includes(task.status)) { task.status = 'queued'; delete task.error; } await pumpThread(thread); return true; }
    if (action === 'chat-send') {
      const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại');
      if (payload.role && !thread.flow.includes(payload.role)) throw Error('Role không thuộc session (có thể đã bị xóa)');
      const worker = payload.role ? getWorker(thread, payload.role) : { mode: thread.mode || 'read', model: thread.model || 'claude-opus-5-5', profileId: '' };
      const activeKey = runKey(thread.id, payload.role);
      const content = payload.text?.trim(); if (!content || content.length > 12000) throw Error('Nhập yêu cầu tối đa 12000 ký tự');
      // Lệnh slash xử lý cục bộ nên vẫn dùng được khi khối đang trả lời (ví dụ /role Dev pause).
      if (!content.startsWith('/')) { if (chats.has(activeKey)) throw retryable('Khối này đang trả lời. Khối khác vẫn có thể chạy.'); if (chats.size >= 8) throw retryable('Tối đa 8 phiên chat'); }
      const localReply = text => { teamStore.update(metadata.team, 'message', { id: thread.id, text: content }); thread.messages.push({ role: 'Hệ thống', text, time: new Date().toISOString() }); persist(); publish(); return true; };
      if (content === '/help') return localReply('/role <khối> start|pause: chạy/tạm dừng một khối (vd. /role Lead Dev pause). /chot: chốt GD và chạy tự động các bước sau. /auto on|off: bật/tắt chạy tự động. /model: chọn model bên dưới. /status: cấu hình session. /mcp, /mcp open: xem/sửa MCP server. /usage: quota đã nhận từ CLI. Lệnh tương tác khác dùng trong Terminal.');
      if (content.startsWith('/model')) return localReply('Model của khối hiện tại: ' + (worker.model || 'claude-opus-5-5') + '. Đổi bằng danh sách Model dưới ô chat.');
      if (content === '/mcp') { let names; try { names = mcpServerNames(); } catch (error) { return localReply(error.message); } return localReply((names.length ? 'MCP server được nạp: ' + names.join(', ') : 'Chưa khai báo MCP server.') + '\nCấu hình: ' + mcp + '\nDùng /mcp open để mở và sửa (dạng {"mcpServers":{"ten":{"command":"...","args":[]}}}). Áp dụng từ lượt sau; Plan chỉ đọc không gọi tool MCP.'); }
      if (content === '/mcp open') { const failure = await shell.openPath(mcp); return localReply(failure ? 'Không mở được: ' + failure : 'Đã mở ' + mcp + '. Lưu tệp rồi gửi lượt mới.'); }
      const command = pipeline.parseCommand(content, thread.flow);
      if (command?.kind === 'error') return localReply(command.message);
      if (command?.kind === 'role') { const result = roleCommand(thread, command.label, command.verb); localReply(result.text); if (result.run) background(thread, result.run); return true; }
      if (command?.kind === 'auto') { localReply(command.on ? 'Bật chạy tự động.' : 'Tắt chạy tự động.'); background(thread, () => autoRun.setAuto(thread, command.on)); return true; }
      if (command?.kind === 'chot') { localReply('Chốt bước hiện tại và chạy tự động các bước sau.'); background(thread, () => autoRun.chot(thread)); return true; }
      if (content === '/status') return localReply(`Hồ sơ: ${profile(metadata.activeProfileId || metadata.profiles[0]?.id).name}\nModel: ${thread.model || 'claude-opus-5-5'}\nMode: ${thread.mode || 'read'}\nTự động: ${thread.auto?.enabled ? 'bật' : 'tắt'}\nThư mục: ${foldersOf(thread).join(', ') || 'chưa chọn'}\nĐây là cấu hình app, không phải xác nhận đăng nhập của CLI.`);
      if (content === '/usage') { const usage = readUsage(metadata.activeProfileId || metadata.profiles[0]?.id); return localReply(usage ? JSON.stringify(usage, null, 2) : 'CLI chưa gửi snapshot quota. Đăng nhập không tạo usage. Dùng Xem usage chính thức trong menu tài khoản để xem trực tiếp tại CLI.'); }
      if (content.startsWith('/')) return localReply('Lệnh này chưa hỗ trợ trong chat. Dùng terminal Claude Code để chạy lệnh tương tác.');
      // Đường dẫn trong tin nhắn đổi phạm vi thư mục: ghi rõ vào hội thoại để không đổi ngầm.
      let folderNote = '';
      if (event) {
        const before = foldersOf(thread), refused = []; require('./path-input.cjs').adoptPaths(thread, content, refused);
        const after = foldersOf(thread), added = after.filter(folder => !before.some(item => item.toLowerCase() === folder.toLowerCase()));
        const lines = [added.length ? 'Đã cấp thêm thư mục từ tin nhắn: ' + added.join(', ') : '', after[0] && after[0] !== before[0] ? 'Thư mục chính: ' + after[0] : '', refused.length ? 'Không tự cấp thư mục hệ thống/gốc ổ đĩa: ' + refused.join(', ') + '. Dùng Thêm thư mục nếu thật sự cần.' : ''];
        folderNote = lines.filter(Boolean).join('\n');
      }
      if (!thread.folder) throw Error('Chưa tìm thấy thư mục hợp lệ. Gửi đường dẫn tuyệt đối hiện có hoặc chọn thư mục.');
      persist(); publish();
      for (const folder of foldersOf(thread)) if (!isFolder(folder)) throw Error('Thư mục không tồn tại: ' + folder + '. Bỏ thư mục này hoặc chọn lại.');
      const profileId = worker.profileId || metadata.activeProfileId || metadata.profiles[0]?.id; profile(profileId);
      if (!executable || !fs.existsSync(executable)) throw Error('Chọn Claude Code và đăng nhập tại quản lý tài khoản');
      const auth = await ensureAuth(profileId); if (auth.loginStarted) return auth;
      // Bypass chỉ hỏi khi có thư mục ở ổ hệ thống/ổ hồ sơ người dùng hoặc thư mục mạng (modes.cjs); lượt do bộ tự động/điều phối gửi đã được duyệt một lần khi bật tự động.
      // Duyệt một lần chỉ còn hiệu lực khi mode các khối và thư mục giữ nguyên như lúc bật tự động.
      const autoApproved = Boolean(payload.auto && thread.auto?.enabled && thread.auto.approvedAt && thread.auto.scope === pipeline.approvalScope(thread));
      if (worker.mode !== 'read') { if (editOverlap(thread)) throw retryable('Có Dev đang sửa cùng thư mục. Đợi lượt đó xong để tránh ghi đè; các lượt chỉ đọc vẫn chạy song song.'); if (needsConfirm(worker.mode, foldersOf(thread)) && !autoApproved) { const answer = await dialog.showMessageBox(window, { type: 'warning', message: worker.mode === 'bypass' ? 'Bypass trên ổ hệ thống hoặc thư mục mạng: bỏ duyệt thao tác tệp và lệnh shell trong lượt này?' : 'Cho phép ' + (payload.role || 'Claude') + ' đọc/sửa tệp và chạy lệnh shell cho yêu cầu này?', detail: foldersOf(thread).join('\n'), buttons: ['Hủy', 'Cho phép lần này'], defaultId: 0, cancelId: 0 }); if (answer.response !== 1) return false; } }
      if (chats.has(activeKey)) throw retryable('Khối đang trả lời');
      if (worker.mode !== 'read' && editOverlap(thread)) throw retryable('Một lượt sửa đã bắt đầu trong lúc xác nhận; hãy đợi để tránh ghi đè.');
      const directory = profileDir(root, profileId); fs.mkdirSync(directory, { recursive: true });
      const policy = JSON.parse(fs.readFileSync(settings, 'utf8')); policy.disableAllHooks = true;
      const chatSettings = path.join(directory, 'chat-settings.json'); fs.writeFileSync(chatSettings, JSON.stringify(policy));
      const resumed = Boolean(thread.cliSessions?.[resumeKey(profileId, thread.folder, payload.role)]);
      const { text: prompt } = rolePrompt(metadata.team, thread, payload.role, { content, resumed });
      const mcpServers = mcpServerNames();
      if (payload.auto) thread.messages.push({ role: 'Điều phối', text: content, time: new Date().toISOString() }); else teamStore.update(metadata.team, 'message', { id: thread.id, text: content });
      if (folderNote) thread.messages.push({ role: 'Hệ thống', text: folderNote, time: new Date().toISOString() });
      const runThread = { ...thread, mode: worker.mode, model: worker.model, cliSessions: thread.cliSessions ||= {} };
      const run = chatEngine.launch({ executable, directory, settings: chatSettings, mcp, mcpServers, thread: runThread, profileId, prompt, role: payload.role, save: persist, publish: publishSoon }); run.mode = worker.mode; run.folders = foldersOf(thread); run.profileId = profileId; chats.set(activeKey, run);
      run.message.profileId = profileId; run.message.model = worker.model;
      run.child.once('close', () => {
        chats.delete(activeKey);
        const handoff = pipeline.parseHandoff(run.message.text);
        const assigned = (thread.dispatch || []).find(task => task.worker === payload.role && ['running', 'starting'].includes(task.status));
        if (assigned) { assigned.status = run.message.error ? 'failed' : 'finished'; if (!run.message.error) assigned.finishedAt = new Date().toISOString(); if (!run.message.error && handoff?.status === 'blocked') { assigned.status = 'blocked'; assigned.error = handoff.summary || payload.role + ' báo bị chặn'; } }
        let proposalApplied = false;
        if (worker.type === LEAD && thread.leadPhase !== 'review' && !run.message.error) {
          const proposal = require('./workers.cjs').taskPlan(run.message.text, thread);
          if (proposal && !(thread.dispatch || []).some(task => ACTIVE_TASK.includes(task.status))) { thread.taskDrafts = proposal; teamStore.update(metadata.team, 'apply-task-plan', { id: thread.id }); thread.dispatch = proposal.map(task => ({ ...task, status: 'queued' })); proposalApplied = true; thread.messages.push({ role: 'Điều phối', text: 'Lead đã phân công. Bắt đầu các Dev không bị chặn bởi phụ thuộc hoặc xung đột ghi tệp.', time: new Date().toISOString() }); }
          else if (!proposal) thread.messages.push({ role: 'Điều phối', text: 'Lead chưa xuất phân công tasks hợp lệ; không tự đoán hoặc chạy Dev.', time: new Date().toISOString() });
        }
        persist(); publish();
        autoRun.after(thread, payload.role, run.message, { proposalApplied }).catch(error => thread.messages.push({ role: 'Tự động', text: 'Dừng tự động: ' + error.message, time: new Date().toISOString() })).finally(() => { persist(); publish(); pumpThread(thread).catch(() => {}); });
      }); run.child.once('error', () => chats.delete(activeKey)); persist(); publish(); return true;
    }
    if (action === 'usage-open') { const thread = metadata.team.threads.find(item => item.id === payload.id); const id = thread && payload.role ? getWorker(thread, payload.role).profileId || metadata.activeProfileId || metadata.profiles[0]?.id : metadata.activeProfileId || metadata.profiles[0]?.id; const directory = profileDir(root, id); fs.mkdirSync(directory, { recursive: true }); return start(id, 'work', { folder: directory, prompt: '/usage', runId: randomUUID() }); }
    if (['thread-folder', 'remove-folder', 'attach-image', 'run-thread'].includes(action)) {
      const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại');
      if (action === 'thread-folder') { const result = await dialog.showOpenDialog(window, { title: 'Thêm thư mục làm việc / liên quan', properties: ['openDirectory', 'multiSelections'] }); if (!result.canceled) { const folders = foldersOf(thread); for (const chosen of result.filePaths) { const resolved = fs.realpathSync(chosen); if (!folders.some(folder => folder.toLowerCase() === resolved.toLowerCase())) folders.push(resolved); } if (folders.length > 16) throw Error('Tối đa 16 thư mục'); thread.folder = folders[0] || ''; thread.relatedFolders = folders.slice(1); } }
      if (action === 'remove-folder') { const folders = foldersOf(thread).filter(folder => folder !== payload.folder); thread.folder = folders[0] || ''; thread.relatedFolders = folders.slice(1); }
      if (action === 'attach-image') {
        const source = fs.realpathSync(payload.path); const stat = fs.statSync(source); const extension = path.extname(source).toLowerCase();
        if (!stat.isFile() || stat.size > 20 * 1024 * 1024 || !['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw Error('Chỉ nhận PNG/JPEG/WebP tối đa 20 MB');
        const handle = fs.openSync(source, 'r'); const header = Buffer.alloc(12); try { fs.readSync(handle, header, 0, 12, 0); } finally { fs.closeSync(handle); }
        const valid = extension === '.png' ? header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : extension === '.webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' : header[0] === 255 && header[1] === 216 && header[2] === 255;
        if (!valid) throw Error('Nội dung tệp không đúng định dạng ảnh');
        thread.attachments ||= []; if (thread.attachments.length >= 8) throw Error('Tối đa 8 ảnh mỗi session');
        const destination = path.join(root, 'attachments', thread.id); fs.mkdirSync(destination, { recursive: true });
        const target = path.join(destination, randomUUID() + extension); fs.copyFileSync(source, target); thread.attachments.push({ name: path.basename(source), path: target });
      }
      if (action === 'run-thread') {
        if (!thread.folder) throw Error('Chọn thư mục làm việc trước');
        if (thread.flow.length && !thread.flow.includes(payload.role) && !payload.text?.trim().startsWith('/')) throw Error('Chọn Chạy role để thực thi vai trò hiện tại');
        if ([...sessions.values()].some(item => item.threadId === thread.id && item.running)) throw Error('Phiên này đang chạy trong Terminal; tiếp tục tại Tài khoản & terminal');
        if ([...sessions.values()].filter(item => item.running).length >= 8) throw Error('Tối đa 8 phiên');
        if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 12000) throw Error('Nhập yêu cầu tối đa 12000 ký tự');
        // Terminal luôn mở phiên mới (--session-id) nên resumed = false (PLAN L-8). Lệnh slash gửi nguyên văn.
        const prompt = payload.text.trim().startsWith('/') ? payload.text : rolePrompt(metadata.team, thread, payload.role, { content: payload.text, resumed: false, history: Boolean(payload.role) }).text;
        start(metadata.activeProfileId || metadata.profiles[0]?.id, 'work', { folder: thread.folder, relatedFolders: thread.relatedFolders, prompt, runId: randomUUID(), threadId: thread.id });
        if (!payload.role) teamStore.update(metadata.team, 'message', { id: thread.id, text: payload.text });
      }
      persist(); publish(); return true;
    }
    if (action === 'select-profile') { profile(payload.id); metadata.activeProfileId = payload.id; persist(); publish(); return await ensureAuth(payload.id); }
    if (action === 'navigate') { if (!['index.html', 'dashboard.html'].includes(payload.page)) throw Error('Trang không hợp lệ'); await window.loadFile(path.join(__dirname, payload.page)); return; }
if (action === 'team') { if (['remove-role', 'select-roles'].includes(payload.action)) { const thread = metadata.team.threads.find(item => item.id === payload.id); payload.busy = thread ? busyLabels(thread) : []; } if (payload.action === 'worker-config' && payload.profileId) profile(payload.profileId); teamStore.update(structuredClone(metadata.team), payload.action, payload); const previousProfile = payload.action === 'worker-config' ? metadata.team.threads.find(thread => thread.id === payload.id)?.workers?.[payload.role]?.profileId : ''; const result = teamStore.update(metadata.team, payload.action, payload); persist(); publish(); if (payload.action === 'decision') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (thread?.auto?.enabled) background(thread, () => autoRun.runStage(thread)); } if (payload.action === 'worker-config' && payload.profileId && payload.profileId !== previousProfile) return await ensureAuth(payload.profileId); return result; }
    if (action === 'add') {
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 60) throw Error('Tên cần 1–60 ký tự');
      if (metadata.profiles.length >= 20) throw Error('Tối đa 20 hồ sơ');
      const added = { id: randomUUID(), name: payload.name.trim(), folder: '' }; metadata.profiles.push(added); metadata.activeProfileId ||= added.id; persist(); publish(); return;
    }
    if (action === 'executable') {
      const result = await dialog.showOpenDialog(window, { title: 'Chọn Claude Code chính thức đã cài (.exe hoặc claude.cmd)', properties: ['openFile'], filters: [{ name: 'Claude Code', extensions: ['exe', 'cmd'] }] });
      if (!result.canceled) { const candidate = fs.realpathSync(result.filePaths[0]); if (!['claude.exe', 'claude.cmd'].includes(path.basename(candidate).toLowerCase())) throw Error('Chọn claude.exe hoặc claude.cmd chính thức'); executable = candidate; metadata.executable = candidate; persist(); publish(); } return;
    }
    if (action === 'folder') {
      const item = profile(payload.id);
      const result = await dialog.showOpenDialog(window, { title: 'Chọn thư mục bạn cho phép Claude làm việc', properties: ['openDirectory'] });
      if (!result.canceled) { item.folder = fs.realpathSync(result.filePaths[0]); persist(); publish(); } return;
    }
    if (action === 'rename') { const item = profile(payload.id); if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 60) throw Error('Tên cần 1–60 ký tự'); item.name = payload.name.trim(); persist(); publish(); return; }
    if (action === 'start') { if ([...sessions.values()].filter(item => item.running).length >= 8) throw Error('Tối đa 8 phiên chạy cùng lúc'); return start(payload.id, payload.kind); }
    if (action === 'buffer') { const current = sessions.get(payload.id); return { data: current?.buffer || '', sequence: current?.sequence || 0 }; }
    const session = sessions.get(payload.id);
    if (!session) throw Error('Phiên không tồn tại');
    if (action === 'input') { if (session.running && typeof payload.data === 'string' && payload.data.length <= 65536) session.terminal.write(payload.data); return; }
    if (action === 'resize') { if (session.running && Number.isInteger(payload.cols) && Number.isInteger(payload.rows)) session.terminal.resize(Math.max(20, Math.min(300, payload.cols)), Math.max(5, Math.min(120, payload.rows))); return; }
    if (action === 'close') { session.terminal.kill(); sessions.delete(payload.id); publish(); return; }
    throw Error('Thao tác không hợp lệ');
  }
  window.on('close', event => {
    if (chats.size || [...sessions.values()].some(item => item.running)) { const response = dialog.showMessageBoxSync(window, { type: 'question', message: 'Đóng ứng dụng và dừng các phiên đang chạy?', buttons: ['Hủy', 'Dừng và đóng'], defaultId: 0, cancelId: 0 }); if (response !== 1) { event.preventDefault(); return; } }
    for (const run of chats.values()) run.cancel();
    for (const item of sessions.values()) item.terminal.kill();
    flushPersist();
  });
  window.loadFile(path.join(__dirname, 'dashboard.html'));
  const usageTimer = setInterval(() => publish(), 10000); usageTimer.unref(); window.on('closed', () => clearInterval(usageTimer));
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (root) flushPersist(); });
}
