const { app, BrowserWindow, ipcMain, dialog, clipboard, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const pty = require('node-pty');
const { profileDir, cleanEnv, sessionArgs, commandFor } = require('./core.cjs');
const teamStore = require('./team.cjs');
const { normalizeUsage, foldersOf, extraFolderArgs } = require('./usage.cjs');
const { defaults: roleDefaults } = require('./roles.cjs');
const { PRESETS } = require('./presets.cjs');
const chatEngine = require('./chat.cjs');
const chats = new Map();
const { worker: getWorker, runKey, resumeKey, removable, QA_ROUND_LIMIT, PIPELINE, LEAD, ACTIVE_TASK, mergePlan, labelType } = require('./workers.cjs');
const { rolePrompt, FILE_ROLES } = require('./prompt.cjs');
const { needsConfirm, needsTurnConfirm, ALWAYS_ASK } = require('./modes.cjs');
const { describeTool, decide, roleScope, scopesOverlap, exclusivePaths, withShell } = require('./permissions.cjs');
const sessionFiles = require('./session-files.cjs');
const attachments = require('./attachments.cjs');
const unity = require('./unity.cjs');
const projectDocs = require('./project-docs.cjs');
const fileChanges = require('./file-changes.cjs');
const po = require('./po.cjs');
const fixer = require('./fixer.cjs');
const flowgraphLib = require('./flowgraph.cjs');
const penpot = require('./penpot.cjs');
// Dev server PLA (nút ở khối PO): chạy script dev của project, mở localhost; tắt khi app thoát.
const devServer = require('./devserver.cjs');
const devServers = devServer.createDevServers({ changed: () => publishSoon() });
const skills = require('./skills.cjs');
const skillImport = require('./skill-import.cjs');
const releaseConfig = require('./release-config.cjs');
const { MAX_TURNS, DEFAULT_MAX_TURNS, SHELL_TYPES, isDevType, modelFor, ART_DIRECTOR, ART_CONSUMER_TYPES } = require('./roles.cjs');
// Hộp duyệt từng thao tác cho một lượt chat. Lượt tự động đã duyệt (autoApproved) tự cho phép mọi thao tác trừ web;
// "Luôn cho phép" chỉ có hiệu lực tới hết lượt này và không áp dụng cho web.
// policy = { scope, mode, cwd }: phạm vi ghi theo role được quyết định trước (decide), không hỏi người dùng.
// shellSession: nhớ lần duyệt shell của khối trong session (thread.shellApproved) để mỗi khối chỉ bị hỏi Bash một lần.
function permissionAsker(label, folders, autoApproved, policy, shellSession = null) {
  const always = new Set();
  return async ({ tool, input }) => {
    // Khối của luồng chỉ làm việc trong thư mục session; chat thường (Claude) không bị giới hạn này.
    const verdict = decide({ ...policy, folders: label === 'Claude' ? [] : folders, tool, input });
    // updatedInput: lệnh/tham số app đã chỉnh (Agent ép code-reader, curl tới Unity thêm --max-time) áp dụng cho mọi lần cho phép.
    const allowed = { allow: true, ...(verdict.updatedInput ? { updatedInput: verdict.updatedInput } : {}) };
    if (verdict.action === 'allow') return allowed;
    if (verdict.action === 'deny') return { allow: false, message: verdict.message };
    const askable = !ALWAYS_ASK.includes(tool);
    if (askable && (autoApproved || always.has(tool))) return allowed;
    const shell = tool === 'Bash' && shellSession;
    if (shell && shellSession.approved()) return allowed;
    if (!window || window.isDestroyed()) return { allow: false, message: 'Ứng dụng đã đóng.' };
    const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Duyệt thao tác', message: `${label} muốn dùng ${tool}`, detail: describeTool(tool, verdict.updatedInput || input) + '\n\nThư mục session:\n' + folders.join('\n') + (shell ? `\n\nCho phép cả session: ${label} chạy shell không hỏi lại trong session này (đổi ở mục Shell của khối).` : ''), buttons: ['Từ chối', shell ? 'Cho phép cả session' : 'Cho phép'], defaultId: 0, cancelId: 0, noLink: true, ...(askable && !shell ? { checkboxLabel: `Luôn cho phép ${tool} tới hết lượt này` } : {}) });
    if (answer.response !== 1) return { allow: false, message: `Người dùng từ chối ${tool}. Không thử lại cùng thao tác; hỏi người dùng hoặc đổi cách làm.` };
    if (askable && answer.checkboxChecked) always.add(tool);
    if (shell) shellSession.approve();
    return allowed;
  };
}
const pipeline = require('./pipeline.cjs');
const { retryable, taskSession, continuationOf } = require('./dispatch.cjs');
// Thư mục đã chọn có thể bị xóa/đổi tên; trả false thay vì để ENOENT thô lọt ra giao diện.
function isFolder(folder) { try { return fs.statSync(folder).isDirectory(); } catch { return false; } }
const { MCP_NAME } = require('./modes.cjs');
// Danh sách MCP server do người dùng khai báo trong mcp-servers.json (userData). Lỗi cú pháp được báo, không bỏ qua ngầm.
function mcpServerNames() {
  let data; try { data = JSON.parse(fs.readFileSync(mcp, 'utf8')); } catch (error) { throw Error('mcp-servers.json không hợp lệ (' + error.message + '). Sửa bằng /mcp open.'); }
  if (!data || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) throw Error('mcp-servers.json cần dạng {"mcpServers":{...}}. Sửa bằng /mcp open.');
  const names = Object.keys(data.mcpServers); const bad = names.find(name => !MCP_NAME.test(name));
  if (bad) throw Error('Tên MCP server "' + bad + '" chỉ được gồm chữ, số, _ và -'); return names;
}
// Cấu hình MCP chỉ gồm các server được chọn (US-08), dùng làm --mcp-config của một lượt.
function mcpSubset(names) { const data = JSON.parse(fs.readFileSync(mcp, 'utf8')); return { mcpServers: Object.fromEntries(names.map(name => [name, data.mcpServers[name]])) }; }
const safeMcpNames = () => { try { return mcpServerNames(); } catch { return []; } };
// Skill dùng chung của app (skills.cjs); skill riêng của dự án nằm ở <thư mục>/.claude/skills.
const skillsDir = () => path.join(root, 'skills');
// Skill cho giao diện theo thư mục chính của từng session chưa lưu trữ; khoá '' là skill của app khi session chưa có thư mục.
function skillCatalog() {
  const brief = list => list.map(({ name, description, source, origin }) => ({ name, description, source, origin }));
  const folders = [...new Set((metadata.team?.threads || []).filter(thread => !thread.archived && thread.folder).map(thread => thread.folder))];
  return Object.fromEntries(['', ...folders].map(folder => [folder, brief(skills.list(skillsDir(), folder))]));
}
// build.json (playable-scripts) của thư mục các session có khối Release: panel lấy làm mặc định cho khối chưa lưu cấu hình riêng.
function releaseFiles() {
  const folders = [...new Set((metadata.team?.threads || []).filter(thread => !thread.archived && thread.folder && thread.flow?.some(label => labelType(thread, label) === 'Release')).map(thread => thread.folder))];
  return Object.fromEntries(folders.map(folder => [folder, releaseConfig.read(folder)]).filter(([, config]) => config));
}
function sameOrNested(first, second) { const a = path.resolve(first).toLowerCase(), b = path.resolve(second).toLowerCase(); return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep); }
// Hai lượt cùng có phạm vi ghi (Dev theo danh sách tệp, GD/QA/Lead theo tệp .md) chỉ xung đột khi phạm vi chạm nhau:
// nhờ vậy các Dev được Lead chia tệp riêng sửa song song. Lượt ghi không giới hạn vẫn xét theo thư mục như cũ.
function editOverlap(thread, scope = null) {
  const folders = foldersOf(thread);
  return [...chats.values()].some(run => {
    if (!run.scope && run.mode === 'read') return false;
    if (run.scope && scope) return scopesOverlap(run.scope, scope);
    return run.folders.some(folder => folders.some(other => sameOrNested(folder, other)));
  });
}
// Nguồn duy nhất cho "khối đang chạy" khi xét xóa role (snapshot và action team dùng chung).
function busyLabels(thread) { return thread.flow.filter(label => chats.has(runKey(thread.id, label))); }
// Mọi thứ đang chạy của một session: khối/chat thường và terminal mở từ session đó (dùng khi lưu trữ/xoá).
function threadBusy(thread) { return [...[...chats.keys()].filter(key => key.startsWith(thread.id + ':')).map(key => key.slice(thread.id.length + 1)), ...[...sessions.values()].some(item => item.threadId === thread.id && item.running) ? ['Terminal'] : []]; }
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
function snapshot() { return { activeProfileId: metadata.activeProfileId || metadata.profiles[0]?.id || '', team: metadata.team, removal: Object.fromEntries((metadata.team?.threads || []).map(thread => [thread.id, removalOf(thread)])), qaRoundLimit: QA_ROUND_LIMIT, pipeline: PIPELINE, mcpServers: safeMcpNames(), skills: skillCatalog(), releaseFiles: releaseFiles(), releaseNetworks: releaseConfig.NETWORKS, devServers: devServers.all(), profiles: metadata.profiles.map(item => ({ ...item, usage: readUsage(item.id) })), executable, sessions: [...sessions.values()].map(({ id, profileId, folder, kind, running, code }) => ({ id, profileId, folder, kind, running, code })) }; }
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
  for (const thread of metadata.team.threads) { teamStore.migrateThread(thread); teamStore.migrateRoleConfig(metadata.team, thread); if (thread.flow?.length) { require('./flowgraph.cjs').ensureGraph(thread); require('./flowgraph.cjs').recoverRunning(thread); } delete thread.dispatchPumping; delete thread.dispatchAgain; teamStore.recoverInterrupted(thread); }
  settings = path.join(root, 'restricted-settings.json'); mcp = path.join(root, 'mcp-servers.json');
  // 0.10: bật Shell (Bash) cho mode có sửa tệp. Deny Read(...) chỉ chặn tool Read/Grep/Glob; lệnh shell (vd. type .env) vẫn đọc được,
  // nên chỉ mode Plan thực sự không đọc được các tệp này.
  // WebFetch/WebSearch/NotebookEdit không còn bị chặn ở đây: modes.cjs quyết định tool theo mode. Quy tắc ask buộc web luôn hỏi:
  // thử với CLI thật, mode plan tự cho phép WebSearch nếu thiếu quy tắc này.
  // Agent: không chặn "Task" vì đó là tên cũ của Agent (chặn cả subagent). Quy tắc ask buộc lời gọi Agent đi qua app để
  // permissions.decide ép đúng subagent code-reader, model Haiku, chạy chờ kết quả (thử với CLI thật: không có ask thì không qua app).
  fs.writeFileSync(settings, JSON.stringify({ disableAllHooks: true, enabledPlugins: {}, permissions: { defaultMode: 'default', deny: ['Read(**/.env)', 'Read(**/.env.*)', 'Read(**/.credentials.json)', 'Read(**/*.pem)', 'Read(**/id_rsa)', 'Read(**/id_ed25519)'], ask: [...ALWAYS_ASK, 'Agent'] } }));
  if (!fs.existsSync(mcp)) fs.writeFileSync(mcp, JSON.stringify({ mcpServers: {} }, null, 2));
  // Danh sách tệp của task trở thành phạm vi ghi của Dev ngay trước khi chạy (cả task từ review reject).
  // Task chạy lại (bị chặn, lỗi, chạm giới hạn lượt, tạm dừng) tiếp tục phiên cũ thay vì đọc lại từ đầu, trừ khi phiên đã quá nặng.
  const sendTask = (thread, task) => {
    const config = getWorker(thread, task.worker); if (task.files?.length) config.files = task.files;
    const continued = continuationOf(task);
    const text = continued ? 'Tiếp tục task đang làm dở trong phiên này: làm tiếp phần còn thiếu, không đọc lại tệp đã đọc, rồi xuất handoff.' : config.task === task.task ? 'Thực hiện task Lead giao ở mục "Task của khối".' : 'Thực hiện task Lead giao:\n' + task.task;
    return handleDesk(null, 'chat-send', { id: thread.id, role: task.worker, text, auto: true, ...(continued ? { resumeSession: { id: continued.id, key: continued.key } } : {}) });
  };
  const pumpThread = thread => teamStore.isHalted(thread) ? Promise.resolve() : require('./dispatch.cjs').pump(thread, task => sendTask(thread, task), () => { persist(); publish(); });
  // TASKS.md do app ghi từ khối tasks đã kiểm tra; lỗi ghi tệp chỉ báo, không chặn điều phối.
  // Áp kế hoạch tasks của Lead (Dev/VFX; cả Art khi session không có Art Director) hoặc Art Director (Art). Kế hoạch mới thay task
  // chưa bắt đầu của chính người giao; task của người giao kia được giữ và không được chồng tệp; khối đang chạy/tạm dừng giữ kế hoạch lại.
  function applyPlan(thread, planner, text) {
    const result = mergePlan(thread, planner, text); if (!result.dispatch) return result;
    thread.taskDrafts = result.proposal; teamStore.update(metadata.team, 'apply-task-plan', { id: thread.id }); thread.dispatch = result.dispatch;
    recordTasks(thread, result.proposal, planner === ART_DIRECTOR ? 'Art Director giao Art' : 'Lead phân công'); return { applied: true };
  }
  const recordTasks = (thread, tasks, reason) => { try { sessionFiles.writeTasks(thread, tasks, `Vòng ${thread.round || 1} · ${reason}`); } catch (error) { thread.messages.push({ role: 'Hệ thống', text: 'Không ghi được TASKS.md: ' + error.message, time: new Date().toISOString() }); } };
  const isRunning = (thread, label) => chats.has(runKey(thread.id, label));
  async function approveAuto(thread) {
    const folders = foldersOf(thread);
    // Cần duyệt khi có khối ghi/sửa theo mode, hoặc khối có quyền shell (Lead/Dev/VFX/QA chạy lệnh ở mọi mode).
    if (!thread.flow.some(label => { const config = getWorker(thread, label); return needsConfirm(config.mode, folders) || SHELL_TYPES.includes(config.type); })) return true;
    const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Chạy tự động các bước còn lại: ' + thread.flow.slice(thread.stage).join(' → ') + '?', detail: 'Các khối đọc/sửa tệp và chạy lệnh shell theo mode của từng khối, không hỏi lại từng thao tác cho tới khi tắt (/auto off). Đọc/tìm kiếm web vẫn hỏi từng lần. Thư mục:\n' + folders.join('\n'), buttons: ['Hủy', 'Chạy tự động'], defaultId: 0, cancelId: 0 });
    return answer.response === 1;
  }
  const autoRun = pipeline.createAutoRun({
    update: (thread, action, payload) => teamStore.update(metadata.team, action, { ...payload, id: thread.id }),
    send: (thread, label, text) => handleDesk(null, 'chat-send', { id: thread.id, role: label, text, auto: true }),
    pump: pumpThread, isRunning, approve: approveAuto, recordTasks,
    incident: (thread, incident) => scheduleFix(thread, incident),
    nextMilestone: thread => { const applied = teamStore.update(metadata.team, 'po-next', { id: thread.id, busy: busyLabels(thread) }); if (applied) writePoPlan(thread); return applied; },
    newRound: (thread, round, summary) => { try { sessionFiles.appendRound(thread, round, summary); } catch (error) { thread.messages.push({ role: 'Hệ thống', text: 'Không ghi được CHANGES.md: ' + error.message, time: new Date().toISOString() }); } },
    log: (thread, role, text) => thread.messages.push({ role, text, time: new Date().toISOString() }),
    changed: () => { persist(); publish(); }
  });
  // ---- Fixer (fixer.cjs): luồng tự động dừng ở một khối → Fixer chẩn đoán → app làm theo hành động Fixer chọn.
  const fixerOf = thread => thread.flow.find(label => getWorker(thread, label).type === fixer.FIXER);
  const say = (thread, role, textValue) => thread.messages.push({ role, text: textValue, time: new Date().toISOString() });
  function scheduleFix(thread, incident) {
    const label = fixerOf(thread); if (!label || incident.label === label) return false;
    if (getWorker(thread, incident.label)?.paused) return false; // bạn tạm dừng khối: không phải sự cố
    thread.lastIncident = incident; // bạn bấm chạy Fixer bằng tay sau đó vẫn có ngữ cảnh sự cố này
    // Fixer đang xử lý khối khác: xếp hàng, xử lý lần lượt sau khi Fixer xong.
    if (thread.fixing) { if (thread.fixing.label !== incident.label && !(thread.fixQueue ||= []).some(item => item.label === incident.label)) thread.fixQueue.push(incident); return false; }
    if (!fixer.canFix(thread, incident.label)) { say(thread, 'Tự động', `Fixer đã xử lý ${incident.label} ${fixer.ATTEMPTS} lần trong vòng này; dừng chờ bạn.`); return false; }
    fixer.count(thread, incident.label); thread.fixing = { ...incident, at: new Date().toISOString() };
    say(thread, 'Tự động', `${incident.label} dừng (${incident.kind}); gọi ${label} tìm nguyên nhân.`); persist(); publish();
    background(thread, () => handleDesk(null, 'chat-send', { id: thread.id, role: label, text: fixer.brief(thread, incident), auto: true }).catch(error => { delete thread.fixing; throw error; }));
    return true;
  }
  function takeFixNote(thread, label) { const note = thread.fixNotes?.[label] || ''; if (note) delete thread.fixNotes[label]; return note; }
  function applyFix(thread, message) {
    let incident = thread.fixing; delete thread.fixing;
    const next = thread.fixQueue?.shift(); if (next) setImmediate(() => scheduleFix(thread, next));
    const problems = [], result = message.error ? null : fixer.parseFix(message.text, thread.flow, problems);
    // Lượt Fixer bạn chat tay (không có sự cố mở) mà vẫn xuất khối fix hợp lệ: làm theo, không bỏ qua kết luận.
    if (!incident) { if (!result || result.action === 'user') return; incident = { label: result.target, kind: 'bạn gọi Fixer', manual: true }; }
    if (!result) { say(thread, 'Tự động', `Fixer chưa đưa ra kết luận dùng được (${message.error ? 'lượt lỗi' : problems.join('; ')}); ${incident.label} vẫn dừng, chờ bạn.`); return; }
    try { sessionFiles.appendFix(thread, fixer.entryMarkdown(incident, result)); } catch {}
    const target = result.target || incident.label;
    say(thread, 'Fixer · kết luận', `${incident.label}: ${result.cause}${result.fix ? ' · Khắc phục: ' + result.fix : ''} → ${fixer.ACTION_NAMES[result.action]}${result.action === 'user' ? '' : ' ' + target}${result.action === 'user' && result.message ? ': ' + result.message : ''}`);
    if (result.action === 'user') return;
    if (result.action === 'reassign') { background(thread, () => autoRun.reassignFor(thread, target, result.cause + (result.message ? ' · ' + result.message : ''))); return; }
    // complete: khối đã xong mà thiếu bàn giao → app bàn giao thay (task Dev đánh dấu xong) rồi luồng đi tiếp như thường.
    if (result.action === 'complete') {
      for (const item of thread.dispatch || []) if (item.worker === target && !['finished', 'cancelled'].includes(item.status)) { item.status = 'finished'; item.finishedAt = new Date().toISOString(); delete item.error; }
      const handoff = '```handoff\n' + JSON.stringify({ status: result.status, summary: `Fixer ghi nhận: ${result.message || result.cause}` }) + '\n```';
      persist(); publish(); background(thread, () => autoRun.after(thread, target, { text: handoff })); return;
    }
    (thread.fixNotes ||= {})[target] = `${result.cause}. ${result.message || result.fix}`;
    const task = (thread.dispatch || []).find(item => item.worker === target && ['blocked', 'failed', 'cancelled', 'queued'].includes(item.status));
    if (result.action === 'restart') { for (const key of Object.keys(thread.cliSessions || {})) if (key.endsWith(':' + target)) delete thread.cliSessions[key]; if (task) delete task.session; }
    if (task) { task.status = 'pending'; delete task.error; }
    // Nút của khối còn "đang chạy" mà khối không còn phiên (CLI chết trước bàn giao): đưa về bị chặn để runStage chạy lại ngay.
    for (const node of flowgraphLib.ensureGraph(thread).nodes) if (node.label === target && flowgraphLib.stateOf(thread, node.id).status === 'running' && !isRunning(thread, target) && !isDevType(getWorker(thread, target).type)) flowgraphLib.stateOf(thread, node.id).status = 'blocked';
    persist(); publish(); background(thread, () => autoRun.runStage(thread, target));
  }
  // ---- Bộ canh: lượt treo (không có tiến độ quá lâu) bị dừng để Fixer xử lý; luồng tự động đứng yên (task/nút chờ mãi vì
  // trùng tệp đang ghi rồi không ai gọi lại) được đẩy chạy lại, đứng tiếp thì gọi Fixer.
  const HANG_IDLE_MS = 15 * 60 * 1000, HANG_TOOL_MS = 40 * 60 * 1000, STUCK_TICKS = 3, stuck = new Map();
  function watch() {
    const now = Date.now();
    for (const [key, run] of chats) {
      const message = run.message; if (!message?.streaming || message.hang || message.stopped) continue;
      const open = (message.steps || []).findLast(step => !step.end), last = Date.parse(message.progress?.updatedAt || message.time) || now;
      const limit = open ? Date.parse(open.at) + HANG_TOOL_MS : last + HANG_IDLE_MS; if (now < limit) continue;
      message.hang = true; message.text += `\n\n[App dừng lượt này: ${open ? 'lệnh ' + open.tool + ' chạy quá ' + HANG_TOOL_MS / 60000 + ' phút' : 'không có tiến độ ' + HANG_IDLE_MS / 60000 + ' phút'}; coi là treo.]`;
      const thread = metadata.team.threads.find(item => key.startsWith(item.id + ':')); if (thread) say(thread, 'Tự động', `${message.role} bị treo; app dừng lượt để xử lý.`);
      run.cancel?.();
    }
    for (const thread of metadata.team.threads) {
      if (!thread.auto?.enabled || teamStore.isHalted(thread) || thread.status === 'done' || thread.fixing) { stuck.delete(thread.id); continue; }
      const running = [...chats.keys()].some(key => key.startsWith(thread.id + ':'));
      const waiting = (thread.dispatch || []).filter(task => ['queued', 'pending'].includes(task.status) && !getWorker(thread, task.worker)?.paused).map(task => task.worker);
      const pausedNode = id => getWorker(thread, flowgraphLib.ensureGraph(thread).nodes.find(node => node.id === id)?.label || '')?.paused;
      const queued = Object.entries(thread.graphRun?.nodes || {}).filter(([id, state]) => state.status === 'queued' && !pausedNode(id)).map(([id]) => id);
      const orphan = flowgraphLib.ensureGraph(thread).nodes.some(node => thread.graphRun?.nodes?.[node.id]?.status === 'running'
        && !isDevType(getWorker(thread, node.label).type) && !isRunning(thread, node.label));
      if (orphan) background(thread, () => autoRun.runStage(thread));
      if (running || (!waiting.length && !queued.length)) { stuck.delete(thread.id); continue; }
      const snapshot = waiting.join(',') + '|' + queued.join(','), seen = stuck.get(thread.id);
      const ticks = seen?.snapshot === snapshot ? seen.ticks + 1 : 1; stuck.set(thread.id, { snapshot, ticks });
      if (ticks === 2) { pumpThread(thread).catch(() => {}); background(thread, () => autoRun.runStage(thread)); }
      if (ticks === STUCK_TICKS) {
        const label = waiting[0] || flowgraphLib.ensureGraph(thread).nodes.find(node => node.id === queued[0])?.label;
        if (label) scheduleFix(thread, { label, kind: 'đứng trong hàng chờ', reason: `Không khối nào chạy nhưng hàng chờ đứng yên ${STUCK_TICKS} phút (thường do trùng tệp đang ghi rồi không được gọi lại).`, queue: snapshot.replace('|', ' · nút chờ: ') });
      }
    }
  }
  // ---- Kế hoạch đội của PO (po.cjs, team.cjs). Xem trước: sơ đồ mặc định của đội ở từng mốc (chỉ để hiện trong thẻ duyệt).
  function proposePoPlan(thread, textValue) {
    const problems = [], plan = po.parsePlan(textValue, problems);
    if (!plan) { if (/\`\`\`team/.test(textValue) || !thread.poPlan) { thread.poProblems = problems.join('; '); thread.messages.push({ role: 'Điều phối', text: `PO chưa xuất kế hoạch đội hợp lệ (${thread.poProblems}). Lượt PO sau sẽ nhận lý do này.`, time: new Date().toISOString() }); } return; }
    const steps = po.timeline(plan, thread.flow);
    const previews = steps.map(step => { const graph = flowgraphLib.defaultGraph({ ...thread, flow: step.flow, workers: {} }); return { nodes: graph.nodes.map(({ id, label, phase, x, y }) => ({ id, label, ...(phase ? { phase } : {}), x, y })), edges: graph.edges.map(({ from, to, when }) => ({ from, to, when })) }; });
    teamStore.update(metadata.team, 'po-propose', { id: thread.id, plan, steps, previews });
  }
  function writePoPlan(thread) { try { if (thread.poPlan?.status === 'approved') sessionFiles.writePlan(thread, po.planMarkdown(thread.poPlan.plan, thread.poPlan.current)); } catch (error) { thread.messages.push({ role: 'Hệ thống', text: 'Không ghi được PO.md: ' + error.message, time: new Date().toISOString() }); } }
  // Duyệt kế hoạch: áp mốc 1, ghi PO.md, đánh dấu PO xong rồi chạy tự động từ GD.
  async function startPoPlan(thread) {
    writePoPlan(thread);
    const nodes = flowgraphLib.ensureGraph(thread).nodes, owner = nodes.find(node => node.label === thread.flow.find(label => getWorker(thread, label).type === po.PO));
    flowgraphLib.resetRun(thread); if (owner) flowgraphLib.stateOf(thread, owner.id).status = 'done';
    const gd = thread.flow.find(label => getWorker(thread, label).type === 'GD'); persist(); publish();
    if (!thread.auto?.enabled && !(await autoRun.enable(thread, 'Duyệt kế hoạch đội của PO.'))) return;
    if (gd) await autoRun.runStage(thread, gd);
  }
  // /role <khối> start|pause. Trả về câu trả lời hiển thị trong chat; việc chạy được khởi động sau khi trả lời.
  function roleCommand(thread, label, verb) {
    const config = getWorker(thread, label), tasks = (thread.dispatch || []).filter(task => task.worker === label);
    if (verb === 'pause') {
      config.paused = true; for (const task of tasks) if (ACTIVE_TASK.includes(task.status)) task.status = 'paused';
      { const run = chats.get(runKey(thread.id, label)); if (run?.message) run.message.stopped = true; run?.cancel(); }
      return { text: label + ' đã tạm dừng. Bước tự động sẽ chờ tại khối này; dùng /role ' + label + ' start để tiếp tục.' };
    }
    delete config.paused;
    if (isRunning(thread, label)) return { text: label + ' đang chạy.' };
    const resumable = tasks.filter(task => ['paused', 'blocked', 'failed', 'cancelled'].includes(task.status));
    if (resumable.length) { for (const task of resumable) { task.status = 'queued'; delete task.error; } return { text: 'Tiếp tục task của ' + label + '.', run: () => pumpThread(thread) }; }
    // Chạy tự động: đưa nút của khối (đang bị chặn/chưa chạy) vào hàng chờ của sơ đồ rồi chạy tiếp theo sơ đồ.
    if (thread.auto?.enabled && !teamStore.isHalted(thread)) return { text: 'Tiếp tục bước tự động ' + label + ' theo sơ đồ.', run: () => autoRun.runStage(thread, label) };
    return { text: 'Chạy ' + label + '.', run: () => handleDesk(null, 'chat-send', { id: thread.id, role: label, text: config.task ? 'Thực hiện task:\n' + config.task : 'Thực hiện nhiệm vụ theo yêu cầu session.' }) };
  }
  // Chạy việc nền sau lệnh chat; lỗi hiện trong hội thoại thay vì mất.
  const background = (thread, job) => setImmediate(() => Promise.resolve().then(job).catch(error => { thread.messages.push({ role: 'Tự động', text: error.message, time: new Date().toISOString() }); persist(); publish(); }));
  // Chỉnh sửa (team.cjs requestTweak, pipeline.cjs tweak): ảnh đang soạn được chép vào thư mục session trong dự án để mọi khối
  // Read được (ảnh của app nằm ngoài thư mục dự án), đường dẫn ghi vào Issue [Chỉnh sửa], rồi chạy vòng chỉnh sửa.
  function requestTweak(payload) {
    const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại');
    if (!thread.folder) throw Error('Chọn thư mục dự án trước khi gửi chỉnh sửa');
    const busy = busyLabels(thread); if (busy.length) throw Error(`${busy.join(', ')} đang chạy; đợi xong rồi gửi chỉnh sửa.`);
    teamStore.update(structuredClone(metadata.team), 'tweak', payload);
    const files = sessionFiles.ensureFiles(thread), folder = path.join(path.dirname(files.tasks), 'tweaks');
    const saved = attachments.take(thread).map(item => {
      fs.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, Date.now() + '-' + path.basename(item.path)); fs.copyFileSync(item.path, target);
      return path.relative(thread.folder, target).replace(/\\/g, '/');
    });
    const text = payload.text.trim() + (saved.length ? '\nẢnh kèm (dùng Read để xem): ' + saved.join(', ') : '');
    teamStore.update(metadata.team, 'tweak', { id: thread.id, text }); persist(); publish();
    background(thread, () => autoRun.tweak(thread, payload.text.trim()));
    return true;
  }
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 920, minHeight: 620, backgroundColor: '#151820', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle('desk', handleDesk);
  async function handleDesk(event, action, payload = {}) {
    if (event) { requireTrusted(event); delete payload.auto; delete payload.resumeSession; }
    if (action === 'state') return snapshot();
    if (action === 'role-defaults') return roleDefaults;
    if (action === 'role-presets') return Object.fromEntries(Object.entries(PRESETS).map(([key, preset]) => [key, { name: preset.name, roles: preset.roles, config: Object.fromEntries(Object.entries(preset.config).map(([type, config]) => [type, { responsibility: config.responsibility, output: config.output }])), engines: Object.fromEntries(Object.entries(preset.engines || {}).map(([id, engine]) => [id, engine.name])), spine: Object.fromEntries(Object.entries(preset.spine || {}).map(([id, choice]) => [id, choice.name])) }]));
    if (action === 'copy-text') { if (typeof payload.text !== 'string' || payload.text.length > 2 * 1024 * 1024) throw Error('Nội dung copy quá dài'); clipboard.writeText(payload.text); return true; }
    // Dev server của session (khối PO, project PLA): scripts = script dev trong package.json; start/stop; open = mở localhost đang chạy.
    if (action === 'dev-server') {
      const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại');
      if (payload.op === 'scripts') return devServer.scripts(thread.folder || '');
      if (payload.op === 'start') return devServers.start(thread.id, thread.folder, String(payload.script || ''), payload.port === '' ? '' : payload.port);
      if (payload.op === 'stop') return devServers.stop(thread.id);
      if (payload.op === 'open') { const run = devServers.state(thread.id); if (!run?.running || !run.url) throw Error('Chưa có dev server đang chạy cho session này'); await shell.openExternal(run.url); return true; }
      throw Error('Thao tác dev server không hợp lệ');
    }
    if (action === 'open-url') { let url; try { url = new URL(String(payload.url || '')); } catch { throw Error('Link không hợp lệ'); } if (!['http:', 'https:'].includes(url.protocol)) throw Error('Chỉ mở link http/https'); await shell.openExternal(url.href); return true; }
    if (action === 'file-read') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại'); return require('./files.cjs').readProjectFile(payload.path, foldersOf(thread), { sessionId: thread.id, readOnlyRoots: [require('node:os').tmpdir()] }); }
    if (action === 'chat-stop') { const thread = metadata.team.threads.find(item => item.id === payload.id); for (const task of thread?.dispatch || []) if (task.worker === payload.role && ACTIVE_TASK.includes(task.status)) task.status = 'cancelled'; { const run = chats.get(runKey(payload.id, payload.role)); if (run?.message) run.message.stopped = true; run?.cancel(); } persist(); publish(); return true; }
    if (action === 'dispatch-retry') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại'); for (const task of thread.dispatch || []) if (['blocked', 'failed', 'cancelled'].includes(task.status)) { task.status = 'queued'; delete task.error; } await pumpThread(thread); return true; }
    if (action === 'chat-send') {
      const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại');
      if (thread.archived) throw Error('Session đã lưu trữ; khôi phục để chạy tiếp.');
      if (payload.role && !thread.flow.includes(payload.role)) throw Error('Role không thuộc session (có thể đã bị xóa)');
      const worker = payload.role ? getWorker(thread, payload.role) : { mode: thread.mode || 'read', model: thread.model || 'claude-opus-5-5', profileId: '' };
      const activeKey = runKey(thread.id, payload.role);
      const content = payload.text?.trim(); if (!content || content.length > 12000) throw Error('Nhập yêu cầu tối đa 12000 ký tự');
      // Lệnh slash xử lý cục bộ nên vẫn dùng được khi khối đang trả lời (ví dụ /role Dev pause).
      if (!content.startsWith('/')) { if (chats.has(activeKey)) throw retryable('Khối này đang trả lời. Khối khác vẫn có thể chạy.'); if (chats.size >= 8) throw retryable('Tối đa 8 phiên chat'); }
      // Bạn bấm chạy Fixer: gửi kèm ngữ cảnh sự cố đang mở và mở phiên Fixer mới (phiên cũ giữ chẩn đoán cũ), để kết luận được áp.
      if (!content.startsWith('/') && worker.type === fixer.FIXER && !payload.auto && !payload.fixBrief && !thread.fixing) {
        const incident = fixer.currentIncident(thread, flowgraphLib.ensureGraph(thread).nodes);
        if (incident) {
          thread.fixing = { ...incident, manual: true, at: new Date().toISOString() };
          for (const key of Object.keys(thread.cliSessions || {})) if (key.endsWith(':' + payload.role)) delete thread.cliSessions[key];
          const own = content === 'Thực hiện nhiệm vụ theo yêu cầu session.' ? '' : '\n\nGhi chú của bạn: ' + content.slice(0, 800);
          try { return await handleDesk(null, 'chat-send', { ...payload, text: fixer.brief(thread, thread.fixing) + own, fixBrief: true }); } catch (error) { delete thread.fixing; throw error; }
        }
      }
      const localReply = text => { teamStore.update(metadata.team, 'message', { id: thread.id, text: content }); thread.messages.push({ role: 'Hệ thống', text, time: new Date().toISOString() }); persist(); publish(); return true; };
      if (content === '/help') return localReply('/role <khối> start|pause: chạy/tạm dừng một khối (vd. /role Lead Dev pause). /chot: chốt GD và chạy tự động các bước sau. /compact [điều cần giữ]: compact phiên của khối đang chọn. /auto on|off: bật/tắt chạy tự động. /model: chọn model bên dưới. /status: cấu hình session. /mcp, /mcp open: xem/sửa MCP server. /mcp penpot: thêm Penpot MCP cho UI/UX, Art Director, Art. /skills, /skills open: xem/thêm skill. /skills add <link GitHub> [--force]: tải skill sau khi kiểm tra an toàn. /skills update [tên], /skills remove <tên>. /usage: quota đã nhận từ CLI. /<tên skill của dự án> [ghi chú]: khối đang chọn chạy skill trong .claude/skills của thư mục dự án (vd. /build_preview). Lệnh tương tác khác dùng trong Terminal.');
      if (content.startsWith('/model')) return localReply('Model của khối hiện tại: ' + (worker.model || 'claude-opus-5-5') + '. Đổi bằng danh sách Model dưới ô chat.');
      if (content === '/mcp') { let names; try { names = mcpServerNames(); } catch (error) { return localReply(error.message); } const own = payload.role ? names.filter(name => (metadata.team.roleMcp?.[worker.type] || []).includes(name)) : names; return localReply((names.length ? 'MCP server đã khai báo: ' + names.join(', ') + '\n' + (payload.role ? `${payload.role} nạp: ${own.join(', ') || 'không có'} (chọn trong mục Trách nhiệm & yêu cầu riêng; áp dụng cho mọi khối ${worker.type})` : 'Chat thường nạp tất cả.') : 'Chưa khai báo MCP server.') + '\nCấu hình: ' + mcp + '\nDùng /mcp open để mở và sửa (dạng {"mcpServers":{"ten":{"command":"...","args":[]}}}). Áp dụng từ lượt sau; Plan chỉ đọc không gọi tool MCP.'); }
      // Thêm Penpot MCP (penpot.cjs) vào mcp-servers.json, bật cho UI/UX, Art Director, Art và hướng dẫn chạy server + plugin.
      if (content === '/mcp penpot') { let text; try { mcpServerNames(); text = penpot.install(mcp, metadata.team); } catch (error) { return localReply(error.message); } persist(); publish(); return localReply(text); }
      if (content === '/mcp open') { const failure = await shell.openPath(mcp); return localReply(failure ? 'Không mở được: ' + failure : 'Đã mở ' + mcp + '. Lưu tệp rồi gửi lượt mới.'); }
      // Skill (skills.cjs): thư mục chung của app và .claude/skills của dự án; khối trong luồng và chat thường chỉ dùng skill đã bật.
      const skillKey = payload.role ? worker.type : skills.CHAT_KEY;
      if (content === '/skills') { const all = skills.list(skillsDir(), thread.folder), own = skills.pick(all, metadata.team.roleSkills?.[skillKey] || []); return localReply((all.length ? 'Skill tìm thấy: ' + all.map(skill => `${skill.name} (${skill.source === 'app' ? skill.origin || 'app' : 'dự án'})`).join(', ') + '\n' + `${payload.role || 'Chat thường'} dùng: ${own.map(skill => skill.name).join(', ') || 'không có'} (chọn ở mục ${payload.role ? `Skill của role; áp dụng cho mọi khối ${worker.type}` : 'Skill của chat thường'})` : 'Chưa có skill.') + `\nThư mục skill của app: ${skillsDir()}\nSkill của dự án: <thư mục>\\${skills.PROJECT_DIR}\nMỗi skill là một thư mục có SKILL.md (frontmatter name, description). /skills open để mở thư mục của app. /skills add <link GitHub> tải về sau khi kiểm tra; /skills update [tên], /skills remove <tên>. Áp dụng từ lượt sau.`); }
      // /skills add|update|remove: tải/gỡ skill GitHub, kiểm tra an toàn và độ tin cậy trước khi cài (skill-import.cjs).
      const skillCommand = /^\/skills\s+(add|update|remove)(?:\s+(.*))?$/.exec(content);
      if (skillCommand) {
        const words = (skillCommand[2] || '').trim().split(/\s+/).filter(Boolean), force = words.includes('--force'), target = words.find(word => word !== '--force') || '';
        const options = { appDir: skillsDir(), force, list: skills.list(skillsDir(), '') };
        try {
          if (skillCommand[1] === 'add') return localReply(target ? (await skillImport.add(target, options)).text : 'Dùng: /skills add <link GitHub> [--force]');
          if (skillCommand[1] === 'update') return localReply((await skillImport.update(target, options)).text);
          if (!target) return localReply('Dùng: /skills remove <tên>');
          const result = skillImport.remove(target, options);
          if (result.removed) for (const names of Object.values(metadata.team.roleSkills || {})) if (names.includes(target)) names.splice(names.indexOf(target), 1);
          return localReply(result.text);
        } catch (error) { return localReply('Lỗi: ' + error.message); }
      }
      if (content === '/skills open') { fs.mkdirSync(skillsDir(), { recursive: true }); const failure = await shell.openPath(skillsDir()); return localReply(failure ? 'Không mở được: ' + failure : 'Đã mở ' + skillsDir() + '. Chép thư mục skill (có SKILL.md) vào đây rồi gửi lượt mới.'); }
      const command = pipeline.parseCommand(content, thread.flow);
      if (command?.kind === 'error') return localReply(command.message);
      if (command?.kind === 'role') { const result = roleCommand(thread, command.label, command.verb); localReply(result.text); if (result.run) background(thread, result.run); return true; }
      if (command?.kind === 'auto') { localReply(command.on ? 'Bật chạy tự động.' : 'Tắt chạy tự động.'); background(thread, () => autoRun.setAuto(thread, command.on)); return true; }
      if (command?.kind === 'chot') { localReply('Chốt bước hiện tại và chạy tự động các bước sau.'); background(thread, () => autoRun.chot(thread)); return true; }
      if (content === '/status') return localReply(`Hồ sơ: ${profile(metadata.activeProfileId || metadata.profiles[0]?.id).name}\nModel: ${thread.model || 'claude-opus-5-5'}\nMode: ${thread.mode || 'read'}\nTự động: ${thread.auto?.enabled ? 'bật' : 'tắt'}\nThư mục: ${foldersOf(thread).join(', ') || 'chưa chọn'}\nĐây là cấu hình app, không phải xác nhận đăng nhập của CLI.`);
      if (content === '/usage') { const usage = readUsage(metadata.activeProfileId || metadata.profiles[0]?.id); return localReply(usage ? JSON.stringify(usage, null, 2) : 'CLI chưa gửi snapshot quota. Đăng nhập không tạo usage. Dùng Xem usage chính thức trong menu tài khoản để xem trực tiếp tại CLI.'); }
      // /compact [ghi chú]: compact phiên CLI của khối đang chọn (như Claude Desktop); gửi nguyên văn, không chạy bộ tự động.
      const compactOnly = /^\/compact(\s|$)/.test(content);
      // /<tên> trùng skill của dự án (skills.projectCommand): gửi khối đang chọn như một tin thường, nội dung là lời dặn chạy skill.
      const projectSkill = compactOnly ? null : skills.projectCommand(content, thread.folder);
      if (projectSkill && chats.size >= 8) throw retryable('Tối đa 8 phiên chat');
      if (content.startsWith('/') && !compactOnly && !projectSkill) return localReply('Lệnh này chưa hỗ trợ trong chat. Dùng terminal Claude Code để chạy lệnh tương tác.');
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
      // Role trong flow làm việc với tệp .md của session (session-files.cjs) và bị giới hạn phạm vi ghi (permissions.roleScope).
      const files = payload.role ? sessionFiles.ensureFiles(thread) : null;
      const assigner = (thread.dispatch || []).find(task => task.worker === payload.role && task.status !== 'finished')?.by === ART_DIRECTOR ? ART_DIRECTOR : 'Lead';
      const scope = payload.role ? withShell(roleScope(worker.type, files, worker.files || [], thread.folder, assigner), worker.shell) : null;
      const writes = worker.mode !== 'read' || Boolean(scope);
      // Đọc & sửa/Auto không hỏi trước cả lượt nữa: từng thao tác ghi/sửa/shell/web được duyệt riêng (askPermission bên dưới).
      if (writes) { if (editOverlap(thread, exclusivePaths(scope))) throw retryable('Khối khác đang sửa cùng tệp/thư mục. Đợi lượt đó xong để tránh ghi đè; các lượt chỉ đọc vẫn chạy song song.'); if (needsTurnConfirm(worker.mode, foldersOf(thread)) && !autoApproved) { const answer = await dialog.showMessageBox(window, { type: 'warning', message: 'Bypass trên ổ hệ thống hoặc thư mục mạng: bỏ duyệt thao tác tệp và lệnh shell trong lượt này?', detail: foldersOf(thread).join('\n'), buttons: ['Hủy', 'Cho phép lần này'], defaultId: 0, cancelId: 0 }); if (answer.response !== 1) return false; } }
      if (chats.has(activeKey)) throw retryable('Khối đang trả lời');
      if (writes && editOverlap(thread, exclusivePaths(scope))) throw retryable('Một lượt sửa đã bắt đầu trong lúc xác nhận; hãy đợi để tránh ghi đè.');
      // US-08: khối trong luồng chỉ nạp MCP server bật cho loại role của nó (team.roleMcp); chat thường nạp tất cả.
      const allMcp = mcpServerNames(), mcpServers = payload.role ? allMcp.filter(name => (metadata.team.roleMcp?.[worker.type] || []).includes(name)) : allMcp;
      // Penpot MCP chỉ thao tác trên page đang mở trong một tab: mỗi lúc một khối dùng Penpot (penpot.cjs).
      const penpotRun = !compactOnly && penpot.usesPenpot(mcpServers), penpotBusy = penpotRun && [...chats.values()].find(run => run.penpot);
      if (penpotBusy) throw retryable(`Penpot đang được ${penpotBusy.message?.role || 'khối khác'} dùng; đợi lượt đó xong.`);
      const directory = profileDir(root, profileId); fs.mkdirSync(directory, { recursive: true });
      const policy = JSON.parse(fs.readFileSync(settings, 'utf8')); policy.disableAllHooks = true;
      const chatSettings = path.join(directory, 'chat-settings.json'); fs.writeFileSync(chatSettings, JSON.stringify(policy));
      // Role làm việc theo tệp .md (UI/UX, Lead, Dev, VFX, QA) mở phiên CLI mới ở mỗi bước tự động/task mới: trạng thái chung nằm
      // trong tệp, còn phiên kéo qua nhiều task làm ngữ cảnh mỗi lần gọi model phình (Dev tới ~177k token). Ngoại lệ: chạy lại
      // đúng task đang dở (sendTask) thì tiếp tục phiên cũ nếu cùng hồ sơ/thư mục. Tin người dùng gõ tay, GD, chat thường và
      // role tùy chỉnh tiếp tục phiên của mình; CLI tự compact khi ngữ cảnh lớn (--autocompact).
      const sessionKey = resumeKey(profileId, thread.folder, payload.role), continued = payload.resumeSession?.key === sessionKey ? payload.resumeSession.id : '';
      if (continued) (thread.cliSessions ||= {})[sessionKey] = continued;
      const resume = !(payload.auto && !continued && payload.role && FILE_ROLES.includes(worker.type));
      const resumed = resume && Boolean(thread.cliSessions?.[sessionKey]);
      // Ảnh đang soạn đi kèm đúng tin này của người dùng (lượt tự động không lấy ảnh đang soạn) rồi gắn vào tin đã gửi.
      if (compactOnly && !thread.cliSessions?.[sessionKey]) return localReply((payload.role || 'Chat') + ' chưa có phiên để compact.');
      const images = payload.auto || compactOnly ? [] : attachments.take(thread);
      // Project Unity: khối chạy lệnh được biết Editor có đang mở project không và cách gọi Unity (unity.cjs; kiểm /health ~0,6 s).
      const unityInfo = payload.role && SHELL_TYPES.includes(worker.type) ? await unity.context(thread.folder) : null;
      unity.writeHelper(unityInfo); // .office-desk/unity.sh: dò cổng theo sổ đăng ký, chờ Unity nạp lại, luôn có timeout
      const unityGuide = unity.guide(unityInfo);
      // CLAUDE.md của dự án: cả nội dung ở lượt đầu mỗi phiên CLI, sau đó chỉ dòng tra README (project-docs.cjs).
      const fullDocs = !compactOnly && projectDocs.needsFull(thread, sessionKey, resumed);
      const docsGuide = projectDocs.guide(projectDocs.read(thread.folder), payload.role ? worker.type : '', fullDocs);
      // Skill: chỉ danh sách tên + mô tả + đường dẫn SKILL.md trong brief; model tự Read khi cần (skills.cjs).
      const runSkills = skills.pick(skills.list(skillsDir(), thread.folder), metadata.team.roleSkills?.[skillKey] || []);
      // Release của project playable-scripts: cấu hình build của khối được ghi vào build.json trước lượt (release-config.cjs).
      // Lượt Release thường (không phải lệnh /build_…) của dự án có skill build_production: đóng gói và kiểm theo skill đó.
      const releaseSkill = payload.role && worker.type === 'Release' && !compactOnly && !projectSkill ? skills.projectSkill(thread.folder, 'build_production') : null;
      const releaseGuide = payload.role && worker.type === 'Release' && !compactOnly ? [releaseConfig.prepare(thread.folder, worker.release), releaseSkill ? `Dự án có skill build_production (${releaseSkill.file}): sau khi commit code đã review cùng build.json lên nhánh hiện tại (không push), bước đóng gói và kiểm làm đúng theo skill này (Read SKILL.md: kiểm build.json, npm run verify -- production, xem ảnh chụp, đi hết CHECKLIST.md) thay cho chỉ chạy npm run build.` : ''].filter(Boolean).join('\n') : '';
      const built = compactOnly ? null : rolePrompt(metadata.team, thread, payload.role, { fixNote: payload.role ? takeFixNote(thread, payload.role) : '', content: projectSkill ? projectSkill.prompt : content, resumed, files, attachments: images, unity: unityGuide, projectDocs: docsGuide, penpot: penpotRun, skills: skills.guide(runSkills), release: releaseGuide });
      // Brief vai trò đi qua system prompt. CLI giữ system prompt của lần gọi đầu khi resume, nên brief đổi (task/pha mới) trong
      // phiên đang tiếp tục được gửi một lần trong tin; thread.briefSent nhớ bản phiên đã có.
      const briefHash = built?.brief ? createHash('sha1').update(built.brief).digest('hex') : '', briefKnown = !resumed || thread.briefSent?.[sessionKey] === briefHash;
      const prompt = compactOnly ? content : briefKnown ? built.body : [built.brief, built.body].filter(Boolean).join('\n');
      if (briefHash) (thread.briefSent ||= {})[sessionKey] = briefHash;
      if (fullDocs && docsGuide) projectDocs.markSent(thread, sessionKey, resumed);
      const mcpConfig = payload.role ? mcpSubset(mcpServers) : null;
      if (payload.auto) thread.messages.push({ role: 'Điều phối', text: content, time: new Date().toISOString() }); else { teamStore.update(metadata.team, 'message', { id: thread.id, text: content }); if (images.length) thread.messages.at(-1).attachments = images; }
      if (folderNote) thread.messages.push({ role: 'Hệ thống', text: folderNote, time: new Date().toISOString() });
      // Ảnh chụp git trong phạm vi tệp của Dev/VFX trước lượt: sau lượt so lại để biết tệp nào được tạo/sửa (file-changes.cjs).
      const devRun = Boolean(files && payload.role && isDevType(worker.type) && scope?.paths?.length), gitBefore = devRun ? fileChanges.gitStatus(thread.folder, scope.paths, foldersOf(thread)) : null;
      const model = payload.role ? modelFor(worker.type, worker.model, thread.leadPhase) : worker.model;
      const runThread = { ...thread, mode: worker.mode, model, cliSessions: thread.cliSessions ||= {}, sessionTotals: thread.sessionTotals ||= {} };
      const run = chatEngine.launch({ brief: built?.brief || '', executable, directory, settings: chatSettings, mcp, mcpConfig, mcpServers, thread: runThread, profileId, prompt, role: payload.role, save: persist, publish: publishSoon, scope, resume, extraDirs: [...(images.length ? [attachments.folderOf(root, thread.id)] : []), ...(compactOnly ? [] : skills.extraDirs(runSkills))], maxTurns: payload.role ? MAX_TURNS[worker.type] || DEFAULT_MAX_TURNS : 0, askPermission: permissionAsker(payload.role || 'Claude', foldersOf(thread), autoApproved, { scope, mode: worker.mode, cwd: thread.folder, readable: [attachments.folderOf(root, thread.id)], cliData: path.join(directory, 'projects') }, { approved: () => Boolean(thread.shellApproved?.[payload.role || 'Claude']), approve: () => { (thread.shellApproved ||= {})[payload.role || 'Claude'] = new Date().toISOString(); persist(); } }) }); run.mode = worker.mode; run.scope = exclusivePaths(scope); run.folders = foldersOf(thread); run.profileId = profileId; chats.set(activeKey, run);
      run.message.profileId = profileId; run.message.model = model; run.penpot = penpotRun;
      run.child.once('close', () => {
        chats.delete(activeKey);
        if (compactOnly) { persist(); publish(); return; }
        const handoff = pipeline.parseHandoff(run.message.text);
        // Bấm chạy tay khối Dev/VFX/Art/Anim đang có task chờ (prompt đã kèm đúng task đó ở "Task của khối") và lượt xuất handoff:
        // tính là lượt làm task, nếu không task nằm chờ mãi và sơ đồ không đi tiếp (pipeline.cjs chỉ chuyển bước theo task xong).
        const manualTask = !payload.auto && !run.message.error && handoff && isDevType(worker.type) ? (thread.dispatch || []).find(task => task.worker === payload.role && ['pending', 'queued'].includes(task.status) && !task.artReject && task.task === worker.task) : null;
        const assigned = (thread.dispatch || []).find(task => task.worker === payload.role && ['running', 'starting'].includes(task.status)) || manualTask;
        // Ghi phiên CLI của task (kể cả khi bị tạm dừng/huỷ giữa chừng) để lần chạy lại tiếp tục phiên này (sendTask).
        const ownTask = assigned || (thread.dispatch || []).find(task => task.worker === payload.role && ['paused', 'cancelled'].includes(task.status));
        if (ownTask && thread.cliSessions?.[sessionKey]) ownTask.session = taskSession(thread.cliSessions[sessionKey], sessionKey, run.message.usage);
        if (assigned) { assigned.status = run.message.error ? 'failed' : 'finished'; if (!run.message.error) assigned.finishedAt = new Date().toISOString(); if (!run.message.error && handoff?.status === 'blocked') { assigned.status = 'blocked'; assigned.error = handoff.summary || payload.role + ' báo bị chặn'; } if (run.message.maxTurns) { assigned.status = 'blocked'; assigned.error = 'Chạm giới hạn số lượt tool; kiểm tra rồi Thử lại task bị chặn'; } }
        // Dev/VFX/Anim trả ảnh đã duyệt về Art Director (handoff reject kèm reason): task giữ lại, chạy tiếp khi art được sửa (pipeline.cjs).
        if (assigned?.status === 'finished' && handoff?.reason && ART_CONSUMER_TYPES.includes(worker.type)) { assigned.status = 'pending'; delete assigned.finishedAt; assigned.artReject = { reason: handoff.reason, art: handoff.art, summary: handoff.summary || '' }; }
        // CHANGES.md do app ghi từ handoff của Dev (không tin model tự ghi), để QA và Lead review đọc.
        const changed = devRun ? fileChanges.changesText(fileChanges.changedFiles({ folder: thread.folder, before: gitBefore, after: fileChanges.gitStatus(thread.folder, scope.paths, foldersOf(thread)), fileOps: run.message.fileOps })) : '';
        if (changed) run.message.changedFiles = changed;
        if (files && isDevType(worker.type) && (handoff || changed)) { try { sessionFiles.appendChange(thread, payload.role, handoff?.status || (run.message.error ? 'lỗi' : 'không có handoff'), handoff?.summary || '', changed); } catch (error) { thread.messages.push({ role: 'Hệ thống', text: 'Không ghi được CHANGES.md: ' + error.message, time: new Date().toISOString() }); } }
        let proposalApplied = false, planBlocked = '';
        if (worker.type === po.PO && !run.message.error) proposePoPlan(thread, run.message.text);
        if (worker.type === fixer.FIXER) applyFix(thread, run.message);
        // Lead (pha planning/triage) và Art Director (khi có khối tasks) giao việc; lý do kế hoạch bị từ chối được lưu và chèn vào
        // prompt lượt kế tiếp của người giao (prompt.cjs), xoá khi kế hoạch hợp lệ.
        // Bạn gõ tay cho Lead khi Lead đang ở pha review (sau review không đạt, QA hết vòng…) và Lead xuất khối tasks: đó là giao lại việc
        // sửa, áp như pha triage. Trước đây khối tasks này bị bỏ qua nên QA chạy lại trên code không đổi và luồng lặp mãi.
        const handTriage = !run.message.error && !payload.auto && worker.type === LEAD && thread.leadPhase === 'review' && /```tasks/.test(run.message.text);
        // Bạn chủ động cho sửa thêm sau review không đạt: vòng review kế tiếp lại có một lần trả về sửa.
        if (handTriage) { thread.leadPhase = 'triage'; delete thread.reviewRejects; }
        const planner = run.message.error ? '' : worker.type === LEAD && thread.leadPhase !== 'review' ? LEAD : worker.type === ART_DIRECTOR && /```tasks/.test(run.message.text) ? ART_DIRECTOR : '';
        if (planner) {
          const result = applyPlan(thread, planner, run.message.text), problemKey = planner === LEAD ? 'planProblems' : 'adPlanProblems';
          const note = text => thread.messages.push({ role: 'Điều phối', text, time: new Date().toISOString() });
          if (result.applied) { proposalApplied = true; delete thread[problemKey]; if (planner === LEAD) delete thread.reassign; note(planner === LEAD ? 'Lead đã phân công. Bắt đầu các Dev không bị chặn bởi phụ thuộc hoặc xung đột ghi tệp.' : 'Art Director đã giao task cho Art.'); }
          else if (result.blocked) { planBlocked = result.blocked; note(planBlocked); }
          else { thread[problemKey] = result.problems; note(`${planner} chưa xuất phân công tasks hợp lệ (${result.problems}); không tự đoán hoặc chạy khối nhận việc. Lượt ${planner} tiếp theo sẽ nhận lý do này.`); }
        }
        persist(); publish();
        autoRun.after(thread, payload.role, run.message, { proposalApplied, planBlocked }).catch(error => thread.messages.push({ role: 'Tự động', text: 'Dừng tự động: ' + error.message, time: new Date().toISOString() })).finally(() => { persist(); publish(); pumpThread(thread).catch(() => {}); });
      }); run.child.once('error', () => chats.delete(activeKey)); persist(); publish(); return true;
    }
    if (action === 'usage-open') { const thread = metadata.team.threads.find(item => item.id === payload.id); const id = thread && payload.role ? getWorker(thread, payload.role).profileId || metadata.activeProfileId || metadata.profiles[0]?.id : metadata.activeProfileId || metadata.profiles[0]?.id; const directory = profileDir(root, id); fs.mkdirSync(directory, { recursive: true }); return start(id, 'work', { folder: directory, prompt: '/usage', runId: randomUUID() }); }
    if (action === 'attachment-preview') return attachments.preview(root, String(payload.path || ''));
    if (['thread-folder', 'remove-folder', 'attach-image', 'attach-image-data', 'remove-attachment', 'run-thread'].includes(action)) {
      const thread = metadata.team.threads.find(item => item.id === payload.id); if (!thread) throw Error('Session không tồn tại');
      if (action === 'thread-folder') { const result = await dialog.showOpenDialog(window, { title: 'Thêm thư mục làm việc / liên quan', properties: ['openDirectory', 'multiSelections'] }); if (!result.canceled) { const folders = foldersOf(thread); for (const chosen of result.filePaths) { const resolved = fs.realpathSync(chosen); if (!folders.some(folder => folder.toLowerCase() === resolved.toLowerCase())) folders.push(resolved); } if (folders.length > 16) throw Error('Tối đa 16 thư mục'); thread.folder = folders[0] || ''; thread.relatedFolders = folders.slice(1); } }
      if (action === 'remove-folder') { const folders = foldersOf(thread).filter(folder => folder !== payload.folder); thread.folder = folders[0] || ''; thread.relatedFolders = folders.slice(1); }
      // Ảnh tham chiếu cho tin đang soạn: kéo tệp từ đĩa (có đường dẫn) hoặc dán/kéo từ clipboard, trình duyệt (chỉ có dữ liệu).
      if (action === 'attach-image') attachments.saveFile(root, thread, String(payload.path || ''));
      if (action === 'attach-image-data') attachments.save(root, thread, payload.data, payload.name);
      if (action === 'remove-attachment') attachments.remove(root, thread, payload.path);
      if (action === 'run-thread') {
        if (thread.archived) throw Error('Session đã lưu trữ; khôi phục để chạy tiếp.');
        if (!thread.folder) throw Error('Chọn thư mục làm việc trước');
        if (thread.flow.length && !thread.flow.includes(payload.role) && !payload.text?.trim().startsWith('/')) throw Error('Chọn Chạy role để thực thi vai trò hiện tại');
        if ([...sessions.values()].some(item => item.threadId === thread.id && item.running)) throw Error('Phiên này đang chạy trong Terminal; tiếp tục tại Tài khoản & terminal');
        if ([...sessions.values()].filter(item => item.running).length >= 8) throw Error('Tối đa 8 phiên');
        if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 12000) throw Error('Nhập yêu cầu tối đa 12000 ký tự');
        // Terminal luôn mở phiên mới (--session-id) nên resumed = false (PLAN L-8). Lệnh slash gửi nguyên văn.
        const images = payload.text.trim().startsWith('/') ? [] : attachments.take(thread);
        const prompt = payload.text.trim().startsWith('/') ? payload.text : rolePrompt(metadata.team, thread, payload.role, { content: payload.text, resumed: false, history: Boolean(payload.role), attachments: images }).text;
        start(metadata.activeProfileId || metadata.profiles[0]?.id, 'work', { folder: thread.folder, relatedFolders: thread.relatedFolders, prompt, runId: randomUUID(), threadId: thread.id });
        if (!payload.role) { teamStore.update(metadata.team, 'message', { id: thread.id, text: payload.text }); if (images.length) thread.messages.at(-1).attachments = images; }
      }
      persist(); publish(); return true;
    }
    if (action === 'select-profile') { profile(payload.id); metadata.activeProfileId = payload.id; persist(); publish(); return await ensureAuth(payload.id); }
    if (action === 'navigate') { if (!['index.html', 'dashboard.html'].includes(payload.page)) throw Error('Trang không hợp lệ'); await window.loadFile(path.join(__dirname, payload.page)); return; }
    if (action === 'team' && payload.action === 'tweak') return requestTweak(payload);
    if (action === 'team') { if (['remove-role', 'select-roles', 'apply-preset', 'po-approve'].includes(payload.action)) { const thread = metadata.team.threads.find(item => item.id === payload.id); payload.busy = thread ? busyLabels(thread) : []; }
      if (['archive', 'delete'].includes(payload.action)) { const thread = metadata.team.threads.find(item => item.id === payload.id); payload.busy = thread ? threadBusy(thread) : []; }
      if (payload.action === 'delete') { const thread = metadata.team.threads.find(item => item.id === payload.id); const result = teamStore.update(metadata.team, 'delete', payload); if (thread) fs.rmSync(path.join(root, 'attachments', thread.id), { recursive: true, force: true }); persist(); publish(); return result; } if (payload.action === 'worker-config' && payload.profileId) profile(payload.profileId); teamStore.update(structuredClone(metadata.team), payload.action, payload); const previousProfile = payload.action === 'worker-config' ? metadata.team.threads.find(thread => thread.id === payload.id)?.workers?.[payload.role]?.profileId : ''; const result = teamStore.update(metadata.team, payload.action, payload); persist(); publish(); if (payload.action === 'po-approve') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (thread) background(thread, () => startPoPlan(thread)); } if (payload.action === 'decision') { const thread = metadata.team.threads.find(item => item.id === payload.id); if (thread?.auto?.enabled) background(thread, () => autoRun.decide(thread, payload.choice)); } if (payload.action === 'worker-config' && payload.profileId && payload.profileId !== previousProfile) return await ensureAuth(payload.profileId); return result; }
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
  const usageTimer = setInterval(() => publish(), 10000); usageTimer.unref();
  const watchTimer = setInterval(() => { try { watch(); } catch {} }, 60000); watchTimer.unref(); window.on('closed', () => clearInterval(watchTimer)); window.on('closed', () => clearInterval(usageTimer));
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { devServers.stopAll(); if (root) flushPersist(); });
}
