const path = require('node:path');
const { roleKey, DEFAULT_MODELS, DEFAULT_MODES, FALLBACK_MODEL, DEV_TYPES, isDevType } = require('./roles.cjs');
const { scopesOverlap } = require('./permissions.cjs');
const FILES_PER_TASK = 8;
// Tệp Lead giao cho Dev: đường dẫn tương đối, không thoát khỏi thư mục chính. Thư mục kết thúc bằng /.
const validFile = file => typeof file === 'string' && file.trim() && file.length <= 500 && !path.isAbsolute(file) && !file.split(/[\\/]/).includes('..');
const resolvedFiles = (folder, files) => files.map(file => path.resolve(folder || '.', file) + (/[\\/]$/.test(file) ? path.sep : ''));
// Thứ tự pipeline chuẩn (PLAN L-4). Role tùy chỉnh luôn đứng sau QA.
const PIPELINE = Object.freeze(['GD', 'UI/UX', 'Lead Dev', 'Dev', 'VFX', 'QA']);
const LEAD = 'Lead Dev';
const QA_ROUND_LIMIT = 3;
// 'paused': task bị /role <tên> pause; vẫn tính là việc dở (không cho xóa role, không thay phân công mới).
// 'pending': Lead đã giao nhưng nút Dev trên sơ đồ chưa tới lượt chạy (bộ chạy chuyển sang 'queued' khi tới lượt).
const ACTIVE_TASK = ['pending', 'queued', 'starting', 'running', 'paused'];
const typeOf = label => roleKey(String(label || '').replace(/ #\d+$/, ''));
const labelType = (thread, label) => thread.workers?.[label]?.type || typeOf(label);
const orderOf = label => { const index = PIPELINE.indexOf(typeOf(label)); return index < 0 ? PIPELINE.length : index; };
const sortFlow = flow => [...flow].sort((first, second) => orderOf(first) - orderOf(second));
const started = thread => thread.stage > 0 || thread.status !== 'waiting';
const openIssues = thread => (thread.issues || []).filter(issue => !issue.closed && !issue.accepted);
const tasksOf = (thread, label) => (thread.dispatch || []).filter(task => task.worker === label);
// Nguồn duy nhất cho "khóa phiên CLI thuộc nhãn" và "tin nhắn do nhãn viết" (gồm 'X · bàn giao thủ công').
const ownsSession = (key, label) => key.endsWith(':' + label);
const authoredBy = (message, label) => message.role === label || String(message.role).startsWith(label + ' · ');
// US-02: khối mới lấy model theo role (roles.cjs); khối đã có giữ model đã lưu.
function worker(thread, label) { thread.workers ||= {}; const type = typeOf(label); return thread.workers[label] ||= { type, mode: DEFAULT_MODES[type] || thread.mode || 'read', model: DEFAULT_MODELS[type] || FALLBACK_MODEL, profileId: '', task: '' }; }
function forgetWorker(thread, label) {
  if (thread.workers) delete thread.workers[label];
  for (const key of Object.keys(thread.cliSessions || {})) if (ownsSession(key, label)) delete thread.cliSessions[key];
  if (Array.isArray(thread.taskDrafts)) thread.taskDrafts = thread.taskDrafts.filter(task => task.worker !== label);
}
function addWorker(thread, type) {
  if (typeOf(type) === LEAD && thread.flow.some(label => typeOf(label) === LEAD)) throw Error('Session đã có Lead Dev');
  let label = type, count = 2; while (thread.flow.includes(label)) label = type + ' #' + count++;
  const after = thread.flow.findIndex(name => orderOf(name) > orderOf(label)); const index = after < 0 ? thread.flow.length : after;
  if (started(thread) && index <= thread.stage) thread.stage++;
  thread.flow.splice(index, 0, label); forgetWorker(thread, label); worker(thread, label); return label;
}
function runKey(threadId, label) { return threadId + ':' + (label || 'chat'); }
function resumeKey(profileId, folder, label) { return profileId + ':' + folder + ':' + (label || 'chat'); }
function workingReason(thread, label, busy) {
  if (busy) return label + ' đang chạy; chỉ xóa được khi đã pass';
  if (tasksOf(thread, label).some(task => ACTIVE_TASK.includes(task.status))) return label + ' còn task trong hàng chờ hoặc đang chạy; chỉ xóa được khi đã pass';
  if (thread.flow[thread.stage] === label && thread.status === 'working') return label + ' đang làm bước hiện tại; chỉ xóa được khi đã pass';
  if ((thread.issues || []).some(issue => issue.owner === label && !issue.closed)) return label + ' còn Issue chưa đóng';
  return '';
}
function hasRun(thread, label) { return (thread.messages || []).some(message => authoredBy(message, label)) || Object.keys(thread.cliSessions || {}).some(key => ownsSession(key, label)); }
function idle(thread, label) {
  if (labelType(thread, label) === LEAD && thread.flow.some(name => [...DEV_TYPES, 'QA'].includes(typeOf(name)))) return false;
  return !thread.workers?.[label]?.task && !tasksOf(thread, label).length && !(thread.taskDrafts || []).some(task => task.worker === label) && !(thread.issues || []).some(issue => issue.owner === label) && !hasRun(thread, label);
}
function devPassed(thread, label) {
  const finished = tasksOf(thread, label).findLast(task => task.status === 'finished');
  const qaAfter = Boolean(finished?.finishedAt && thread.qaPassedAt) && Date.parse(thread.qaPassedAt) > Date.parse(finished.finishedAt);
  return (qaAfter || thread.status === 'done') && !openIssues(thread).length;
}
function passed(thread, label) {
  const type = labelType(thread, label), done = thread.status === 'done';
  if (type === LEAD) return done;
  if (isDevType(type)) return devPassed(thread, label);
  const inReview = Boolean(thread.qaPassedAt) && thread.leadPhase === 'review';
  if (type === 'QA') return done || inReview;
  return done || thread.flow.indexOf(label) < thread.stage || inReview;
}
// DESIGN §8.1: thuần, không đổi dữ liệu. `busy` do main.cjs truyền vào.
function removable(thread, label, { busy = false } = {}) {
  if (!thread.flow.includes(label)) return { ok: false, reason: 'Role không tồn tại' };
  const working = workingReason(thread, label, busy); if (working) return { ok: false, reason: working };
  if (idle(thread, label)) return { ok: true, reason: 'không có việc' };
  const dependent = (thread.dispatch || []).find(task => task.status !== 'finished' && (task.dependsOn || []).includes(label));
  if (dependent) return { ok: false, reason: dependent.worker + ' còn phụ thuộc ' + label };
  return passed(thread, label) ? { ok: true, reason: 'đã pass' } : { ok: false, reason: label + ' có việc nhưng chưa pass' };
}
// problems nhận lý do khi kế hoạch bị từ chối, để báo cho người dùng/Lead thay vì chỉ "không hợp lệ".
function taskPlan(text, thread, problems = []) {
  const fail = reason => { problems.push(reason); return null; };
  const match = /```tasks\s*([\s\S]*?)```/.exec(text); if (!match) return fail('không có khối tasks');
  try {
    const plan = JSON.parse(match[1]); if (!Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > 30) return fail('tasks phải là mảng 1–30 mục');
    const owners = new Set(); for (const task of plan.tasks) { if (!thread.flow.includes(task.worker) || !isDevType(worker(thread, task.worker).type) || owners.has(task.worker) || typeof task.task !== 'string' || !task.task.trim() || task.task.length > 11800) return fail(`worker "${task.worker}" không phải Dev/VFX trong đội, bị trùng, hoặc task trống/quá dài`); owners.add(task.worker); }
    // files bắt buộc và không chồng nhau giữa các Dev: điều kiện để Dev sửa song song không ghi đè nhau.
    // Tối đa FILES_PER_TASK mục: task lớn làm lượt Dev dài, ngữ cảnh phình và chi phí tăng nhanh hơn số lượt.
    for (const task of plan.tasks) {
      if (!Array.isArray(task.files) || !task.files.length || !task.files.every(validFile)) return fail(`${task.worker}: files bắt buộc, đường dẫn tương đối nằm trong thư mục chính`);
      if (task.files.length > FILES_PER_TASK) return fail(`${task.worker}: ${task.files.length} tệp, tối đa ${FILES_PER_TASK} mỗi task; chia cho thêm Dev hoặc làm nhiều vòng`);
    }
    const scopes = plan.tasks.map(task => resolvedFiles(thread.folder, task.files));
    for (const [index, scope] of scopes.entries()) { const other = scopes.findIndex((item, at) => at > index && scopesOverlap(scope, item)); if (other >= 0) return fail(`${plan.tasks[index].worker} và ${plan.tasks[other].worker} có tệp chồng nhau`); }
    for (const task of plan.tasks) if (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.some(owner => !owners.has(owner) || owner === task.worker))) return fail(`${task.worker}: dependsOn chỉ gồm Dev khác trong kế hoạch`);
    const visited = new Set(); for (let count = 0; count < plan.tasks.length; count++) for (const task of plan.tasks) if ((task.dependsOn || []).every(owner => visited.has(owner))) visited.add(task.worker); if (visited.size !== owners.size) return fail('dependsOn tạo vòng phụ thuộc');
    return plan.tasks.map(task => ({ worker: task.worker, task: task.task, files: [...new Set(task.files.map(file => file.trim().replaceAll('\\', '/')))], ...(task.dependsOn?.length ? { dependsOn: [...new Set(task.dependsOn)] } : {}) }));
  } catch { return fail('JSON trong khối tasks không đọc được'); }
}
module.exports = { PIPELINE, LEAD, QA_ROUND_LIMIT, ACTIVE_TASK, ownsSession, authoredBy, typeOf, labelType, sortFlow, started, openIssues, worker, forgetWorker, addWorker, runKey, resumeKey, removable, taskPlan, FILES_PER_TASK };
