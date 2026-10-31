const { randomUUID } = require('node:crypto');
const { defaults, roleKey, LEGACY_LEAD, isDevType } = require('./roles.cjs');
const { PIPELINE, LEAD, QA_ROUND_LIMIT, ownsSession, typeOf, sortFlow, started, openIssues, worker, forgetWorker, addWorker, removable } = require('./workers.cjs');
const flowgraph = require('./flowgraph.cjs');
const HALTED = ['awaiting-decision', 'cancelled'];
const initial = () => ({ projects: [], roles: [], threads: [] });
const isHalted = thread => HALTED.includes(thread.status);
const indexOfType = (item, type) => item.flow.findIndex(label => typeOf(label) === type);
function text(value, limit = 12000) { if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error('Nội dung trống hoặc quá dài'); return value.trim(); }
function restartLoop(item) { item.stage = 0; item.status = 'waiting'; item.leadPhase = 'planning'; item.qaFailRounds = 0; delete item.qaPassedAt; delete item.qaPhase; delete item.reviewRejects; }
function advance(item) { if (item.stage >= item.flow.length - 1) item.status = 'done'; else { item.stage++; item.status = 'waiting'; } }
function toLead(item, phase) { const lead = indexOfType(item, LEAD); if (lead < 0) return false; item.stage = lead; item.leadPhase = phase; item.status = 'waiting'; return true; }
function toDev(item, log) { const dev = item.flow.findIndex(label => isDevType(typeOf(label))); item.status = 'waiting'; if (dev < 0) log('Hệ thống', 'Không có Dev để sửa'); else item.stage = dev; }
function toTriage(item, log) { if (toLead(item, 'triage')) return; log('Hệ thống', 'Không có Lead Dev'); toDev(item, log); }
function reviewOrDone(item) { if (!toLead(item, 'review')) item.status = 'done'; }
function markQaPass(item) { item.qaPassedAt = new Date().toISOString(); item.qaFailRounds = 0; }
// R5: QA cuối pass → chạy tiếp các role sau QA (nếu có); role cuối flow bàn giao sau QA pass → Lead review.
function handoff(item, content, log, auto = false) {
  if (item.status !== 'working') throw Error('Bắt đầu bước trước khi bàn giao');
  const label = item.flow[item.stage], type = typeOf(label);
  if (type === 'QA' && openIssues(item).length) throw Error('QA cần xác nhận retest các Issue trước khi pass');
  log(label + (auto ? ' · bàn giao tự động' : ' · bàn giao thủ công'), content);
  if (type === LEAD && item.leadPhase === 'review') { item.status = 'done'; return; }
  if (type === 'QA' && typeOf(item.flow[item.stage + 1]) !== 'QA') markQaPass(item);
  if (item.stage >= item.flow.length - 1 && item.qaPassedAt) return reviewOrDone(item);
  advance(item);
}
function reportIssue(item, content, log) {
  if (isHalted(item)) throw Error('Session đang chờ quyết định hoặc đã dừng');
  item.issues.push({ id: randomUUID(), text: content, closed: false }); log('Issue', content);
  item.qaFailRounds = (item.qaFailRounds || 0) + 1; delete item.qaPassedAt;
  if (item.qaFailRounds < QA_ROUND_LIMIT) return toTriage(item, log);
  item.status = 'awaiting-decision'; log('Hệ thống', `QA fail vòng ${item.qaFailRounds}/${QA_ROUND_LIMIT}; chờ người dùng quyết định`);
}
function reviewReject(item, content, log) {
  const label = item.flow[item.stage];
  if (typeOf(label) !== LEAD || item.leadPhase !== 'review' || item.status !== 'working') throw Error('Chỉ trả về Dev khi Lead Dev đang review');
  log(label + ' · review không đạt', content); delete item.qaPassedAt; item.leadPhase = 'planning'; toDev(item, log);
}
const DECISIONS = {
  continue: (item, log) => { item.qaFailRounds = QA_ROUND_LIMIT - 1; log('Hệ thống', 'Người dùng chọn: tiếp tục thêm 1 vòng'); toTriage(item, log); },
  accept: (item, log) => { for (const issue of openIssues(item)) issue.accepted = true; log('Hệ thống', 'Người dùng chọn: chấp nhận với lỗi đã biết'); reviewOrDone(item); },
  stop: (item, log) => { item.status = 'cancelled'; log('Hệ thống', 'Người dùng chọn: dừng session'); }
};
function decide(item, choice, log) {
  if (item.status !== 'awaiting-decision') throw Error('Session không chờ quyết định');
  if (!Object.hasOwn(DECISIONS, choice)) throw Error('Quyết định không hợp lệ');
  DECISIONS[choice](item, log);
}
function addRole(item, type, log) {
  if (!Object.hasOwn(defaults, type)) throw Error('Loại role không hợp lệ');
  const label = addWorker(item, type);
  flowgraph.addNode(item, label); // sơ đồ mặc định dựng lại; sơ đồ đã sửa: Dev/VFX mới nối song song như các Dev khác
  log('Hệ thống', 'Đã thêm ' + label + (item.flow.indexOf(label) < item.stage ? '; bỏ qua ở vòng này' : '')); return label;
}
// payload.busy: mảng nhãn đang chạy do main.cjs (busyLabels) gán; dữ liệu ngoài app không tin được nên chuẩn hóa.
const busyOf = payload => Array.isArray(payload.busy) ? payload.busy : [];
// Bỏ một role theo DESIGN §8.1; ném lỗi (không đổi dữ liệu) nếu removable() từ chối. Trả về lý do cho log.
function dropRole(item, label, busy, force = false) {
  const check = removable(item, label, { busy: busy.includes(label) }); if (!check.ok && !(force && check.force)) throw Error(check.reason);
  const index = item.flow.indexOf(label), current = index === item.stage; item.flow.splice(index, 1); forgetWorker(item, label);
  if (!check.ok) forceCleanup(item, label, current);
  if (index < item.stage) item.stage--;
  item.stage = Math.min(item.stage, Math.max(0, item.flow.length - 1));
  return check.ok ? check.reason : 'xóa bắt buộc: ' + check.reason;
}
// Xóa bắt buộc: bỏ task của khối, gỡ phụ thuộc vào nó, chuyển Issue của nó cho Lead (nếu có) để không còn việc mồ côi.
function forceCleanup(item, label, current) {
  item.dispatch = (item.dispatch || []).filter(task => task.worker !== label).map(task => task.dependsOn?.includes(label) ? { ...task, dependsOn: task.dependsOn.filter(owner => owner !== label) } : task);
  const lead = item.flow.find(name => typeOf(name) === LEAD);
  for (const issue of item.issues || []) if (issue.owner === label && !issue.closed) { if (lead) issue.owner = lead; else delete issue.owner; }
  if (current && item.status === 'working') item.status = 'idle';
}
function removeRole(item, payload, log) {
  const label = payload.role; log('Hệ thống', `Đã xóa ${label} (${dropRole(item, label, busyOf(payload), payload.force === true)})`); flowgraph.syncGraph(item);
  const ids = new Set(item.graph.nodes.map(node => node.id)); for (const id of Object.keys(item.graphRun?.nodes || {})) if (!ids.has(id)) delete item.graphRun.nodes[id];
}
// R1: role bị bỏ qua select-roles phải qua removable(). Bỏ theo thứ tự ngược pipeline (Lead sau Dev/QA),
// chạy thử trên bản sao trước để một role bị từ chối thì không role nào bị đổi.
function dropRoles(item, labels, busy) {
  const order = sortFlow(labels).reverse(), dropAll = target => { for (const label of order) dropRole(target, label, busy); };
  dropAll(structuredClone(item)); dropAll(item);
}
function selectRoles(team, item, payload, log) {
  if (started(item) && !payload.restart) throw Error('Cần xác nhận bắt đầu lại để thay đổi/xóa role');
  const allowed = new Set([...PIPELINE, ...item.flow]);
  if (!Array.isArray(payload.roles) || payload.roles.some(role => !allowed.has(role))) throw Error('Role không hợp lệ');
  const next = sortFlow([...new Set(payload.roles)]);
  dropRoles(item, item.flow.filter(label => !next.includes(label)), busyOf(payload));
  item.flow = next; restartLoop(item); item.roleConfig ||= {}; item.graph = flowgraph.defaultGraph(item); delete item.graphRun;
  for (const key of new Set(item.flow.map(typeOf))) item.roleConfig[key] ||= { ...(team.roleTemplates?.[key] || defaults[key] || { responsibility: '', output: '' }), instructions: '' };
  if (payload.restart) { for (const issue of item.issues) issue.closed = false; log('Hệ thống', 'Cấu hình role thay đổi; quy trình bắt đầu lại.'); }
}
function moveSessions(thread, from, to) {
  for (const key of Object.keys(thread.cliSessions || {})) if (ownsSession(key, from)) thread.cliSessions[key.slice(0, -from.length) + to] ||= thread.cliSessions[key];
}
// AC-ROLE-04.3: gộp Lead Planning/Lead Review (≤ 0.8) thành một khối Lead Dev, giữ cấu hình và phiên CLI của Lead Planning.
// Lúc mở app không còn tiến trình CLI nào của lần trước: task và tin đang chạy dở bị đóng lại, nếu không UI vẫn coi khối
// đang chạy (tin "đang nghĩ" treo mãi cạnh lượt chạy mới).
const INTERRUPTED = 'Ứng dụng đã đóng trong lúc chạy; kiểm tra kết quả trước khi thử lại';
function recoverInterrupted(thread) {
  for (const task of thread.dispatch || []) if (['starting', 'running'].includes(task.status)) { task.status = 'blocked'; task.error = INTERRUPTED; }
  for (const message of thread.messages || []) if (message.streaming) { message.streaming = false; message.error = true; message.text = (message.text ? message.text + '\n\n' : '') + '[Bị ngắt: ' + INTERRUPTED + ']'; delete message.deltaSeen; }
}
function migrateThread(thread) {
  if (!Array.isArray(thread.flow) || !thread.flow.some(label => LEGACY_LEAD.includes(label))) return false;
  const [planning, review] = LEGACY_LEAD, active = thread.flow[thread.stage], workers = thread.workers ||= {};
  const kept = workers[LEAD] || workers[planning] || workers[review]; if (kept) workers[LEAD] = { ...kept, type: LEAD };
  moveSessions(thread, planning, LEAD);
  for (const label of LEGACY_LEAD) forgetWorker(thread, label);
  thread.flow = sortFlow([...new Set(thread.flow.map(roleKey))]);
  thread.stage = Math.max(0, thread.flow.indexOf(roleKey(active)));
  // R6: đang ở Lead Review nghĩa là QA đã pass ở bản cũ.
  if (active === review) { thread.leadPhase = 'review'; thread.qaPassedAt ||= new Date().toISOString(); } else thread.leadPhase ||= 'planning';
  return true;
}
function update(team, action, payload) {
  if (action === 'project') { const item = { id: randomUUID(), name: text(payload.name, 80) }; team.projects.push(item); return item.id; }
  if (action === 'role') { const name = text(payload.name, 40); if (team.roles.includes(name)) throw Error('Role đã tồn tại'); team.roles.push(name); return true; }
  if (payload.project && !team.projects.some(item => item.id === payload.project)) throw Error('Dự án không tồn tại');
  if (action === 'create') { const request = payload.request ? text(payload.request) : ''; const item = { id: randomUUID(), model: 'claude-opus-5-5', title: request ? request.replace(/\s+/g, ' ').slice(0, 70) : 'Session mới', project: payload.project || '', pinned: false, stage: 0, status: 'waiting', flow: [], messages: request ? [{ role: 'Bạn', text: request, time: new Date().toISOString() }] : [], issues: [], folder: '', attachments: [] }; team.threads.push(item); return item.id; }
  const item = team.threads.find(thread => thread.id === payload.id); if (!item) throw Error('Session không tồn tại');
  const log = (role, content) => item.messages.push({ role, text: content, time: new Date().toISOString() });
  if (action === 'add-worker') return addRole(item, payload.type, log);
  // Sơ đồ luồng: lưu bản người dùng sửa (đã kiểm tra) hoặc dựng lại mặc định từ danh sách khối.
  if (action === 'graph-save') { item.graph = flowgraph.validate(item, payload.graph); return true; }
  if (action === 'graph-reset') { item.graph = flowgraph.defaultGraph(item); log('Hệ thống', 'Sơ đồ luồng đặt lại theo mặc định.'); return true; }
  // Lưu trữ trước, xoá hẳn sau. `busy` (khối/terminal đang chạy) do main.cjs truyền vào.
  if (action === 'archive' || action === 'delete') { if (payload.busy?.length) throw Error('Session đang chạy (' + payload.busy.join(', ') + '); dừng trước khi ' + (action === 'delete' ? 'xoá' : 'lưu trữ')); }
  if (action === 'archive') { item.archived = payload.archived !== false; if (item.archived) { item.pinned = false; if (item.auto) item.auto.enabled = false; } return true; }
  if (action === 'delete') { if (!item.archived) throw Error('Chỉ xoá hẳn session đã lưu trữ'); team.threads.splice(team.threads.indexOf(item), 1); return true; }
  if (action === 'apply-task-plan') { if (!Array.isArray(item.taskDrafts) || !item.taskDrafts.length) throw Error('Chưa có phân công hợp lệ từ Lead'); for (const task of item.taskDrafts) if (!item.flow.includes(task.worker)) throw Error('Khối Dev đã thay đổi'); for (const task of item.taskDrafts) { const config = worker(item, task.worker); config.task = task.task; config.files = task.files || []; } log('Phân công đã duyệt', item.taskDrafts.map(task => task.worker + (task.dependsOn?.length ? ' (sau ' + task.dependsOn.join(', ') + ')' : '')).join(', ') + '. Nội dung task nằm trong khối tasks của Lead và ô task của từng Dev.'); item.taskDrafts = []; return true; }
  if (action === 'worker-config') { if (!item.flow.includes(payload.role)) throw Error('Role không tồn tại'); if (!require('./modes.cjs').validMode(payload.mode) || !['claude-opus-5-5', 'sonnet', 'opus', 'haiku'].includes(payload.model)) throw Error('Mode/model không hợp lệ'); const config = worker(item, payload.role); config.mode = payload.mode; config.model = payload.model; config.profileId = typeof payload.profileId === 'string' ? payload.profileId : ''; config.task = typeof payload.task === 'string' ? payload.task.slice(0, 12000) : ''; return true; }
  if (action === 'chat-options') { if (!require('./modes.cjs').validMode(payload.mode) || !['claude-opus-5-5', 'sonnet', 'opus', 'haiku'].includes(payload.model)) throw Error('Mode/model không hợp lệ'); item.mode = payload.mode; item.model = payload.model; return true; }
  if (action === 'template') { const key = roleKey(text(payload.role, 40)); team.roleTemplates ||= {}; team.roleTemplates[key] = { responsibility: text(payload.responsibility, 6000), output: text(payload.output, 6000) }; return true; }
  if (action === 'remove-role') { removeRole(item, payload, log); return true; }
  if (action === 'role-config') {
    const key = roleKey(text(payload.role, 40)); if (![...PIPELINE, ...item.flow].includes(key)) throw Error('Role không hợp lệ');
    const config = { responsibility: text(payload.responsibility, 6000), output: text(payload.output, 6000), instructions: typeof payload.instructions === 'string' ? payload.instructions.slice(0, 12000) : '' };
    item.roleConfig ||= {}; item.roleConfig[key] = config;
    if (payload.saveDefault) { team.roleTemplates ||= {}; team.roleTemplates[key] = { responsibility: config.responsibility, output: config.output }; }
    log('Cấu hình', 'Cập nhật trách nhiệm/đầu ra/yêu cầu riêng: ' + key); return true;
  }
  if (action === 'edit-request') {
    const content = text(payload.text); const first = item.messages.find(message => message.role === 'Bạn');
    if (started(item) && !payload.restart) throw Error('Cần xác nhận bắt đầu lại quy trình sau khi sửa yêu cầu');
    if (first) { log('Lịch sử yêu cầu', first.text); first.text = content; } else log('Bạn', content);
    item.title = content.replace(/\s+/g, ' ').slice(0, 70); restartLoop(item); for (const issue of item.issues) issue.closed = false;
    log('Hệ thống', 'Yêu cầu đã sửa; cần kiểm tra lại kết quả cũ.'); return true;
  }
  if (action === 'select-roles') selectRoles(team, item, payload, log);
  else if (action === 'assign-role') { const name = roleKey(text(payload.name, 40)); if (!item.flow.includes(name)) flowgraph.addNode(item, addWorker(item, name)); }
  else if (action === 'pin') item.pinned = !item.pinned;
  else if (action === 'move') item.project = payload.project || '';
  else if (action === 'message') { const content = text(payload.text); if (!item.messages.some(message => message.role === 'Bạn')) item.title = content.replace(/\s+/g, ' ').slice(0, 70); log('Bạn', content); }
  else if (action === 'start') { if (item.status !== 'waiting') throw Error('Bước không ở trạng thái chờ'); item.status = 'working'; log('Hệ thống', 'Bắt đầu thủ công: ' + item.flow[item.stage]); }
  else if (action === 'handoff') handoff(item, text(payload.text), log, payload.auto === true);
  else if (action === 'issue') reportIssue(item, text(payload.text), log);
  else if (action === 'review-reject') reviewReject(item, text(payload.text), log);
  else if (action === 'decision') decide(item, payload.choice, log);
  else if (action === 'retest') { if (typeOf(item.flow[item.stage]) !== 'QA' || item.status !== 'working') throw Error('Chỉ retest khi QA đang kiểm thử'); const issue = item.issues.find(issue => issue.id === payload.issue); if (!issue) throw Error('Không tìm thấy Issue'); const evidence = text(payload.text); issue.closed = true; log('QA · retest thủ công', evidence); }
  else throw Error('Thao tác không hợp lệ');
  return true;
}
module.exports = { initial, update, migrateThread, recoverInterrupted, isHalted };
