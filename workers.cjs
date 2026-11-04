const fs = require('node:fs');
const path = require('node:path');
const { roleKey, DEFAULT_MODELS, DEFAULT_MODES, FALLBACK_MODEL, DEV_TYPES, isDevType, ART_DIRECTOR } = require('./roles.cjs');
const { scopesOverlap } = require('./permissions.cjs');
const FILES_PER_TASK = 8;
// Tệp Lead/Art Director giao: đường dẫn tương đối theo thư mục chính, hoặc tuyệt đối nằm trong một thư mục của session
// (chính hoặc liên quan, ví dụ project game khi thư mục chính là kho tài nguyên). Không có "..". Thư mục kết thúc bằng /.
const sessionFolders = thread => [...new Set([thread.folder, ...(thread.relatedFolders || [])].filter(Boolean))];
const insideFolder = (file, folder) => { const relative = path.relative(folder, path.resolve(file)); return !relative.startsWith('..') && !path.isAbsolute(relative); };
const validFile = (file, folders = []) => typeof file === 'string' && Boolean(file.trim()) && file.length <= 500 && !file.split(/[\\/]/).includes('..') && (!path.isAbsolute(file.trim()) || folders.some(folder => insideFolder(file.trim(), folder)));
// Đường dẫn tương đối nằm dưới một thư mục con (src/Game.ts, src/ui/) mà thư mục con đó không có trong thư mục chính nhưng có
// ở thư mục liên quan: người giao đang nghĩ theo project ở thư mục liên quan, app sẽ ghi nhầm vào thư mục chính và khối nhận việc
// bị chặn. Mục ở ngay gốc (CLAUDE.md, input/) không xét: thường là tệp tạo mới trong thư mục chính, dù template cũng có tệp cùng tên.
// Đường dẫn tuyệt đối không xét, nên người giao luôn ghi rõ được ý mình bằng đường dẫn tuyệt đối.
function misplacedIn(file, folders) {
  const trimmed = file.trim(); if (folders.length < 2 || path.isAbsolute(trimmed)) return [];
  const parts = trimmed.split(/[\\/]/).filter(part => part && part !== '.'); if (parts.length < 2) return [];
  const top = parts[0], exists = folder => { try { return fs.statSync(path.join(folder, top)).isDirectory(); } catch { return false; } };
  return exists(folders[0]) ? [] : folders.slice(1).filter(exists);
}
const resolvedFiles = (folder, files) => files.map(file => path.resolve(folder || '.', file) + (/[\\/]$/.test(file) ? path.sep : ''));
// Thứ tự pipeline chuẩn (PLAN L-4). Role tùy chỉnh luôn đứng sau QA.
const PIPELINE = Object.freeze(['PO', 'GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'Sound', 'QA', 'Release']);
const LEAD = 'Lead Dev';
// Khối chỉ có một mỗi session: Lead/Art Director có pha là nút riêng trên sơ đồ (flowgraph.cjs); Release là bước cuối duy nhất.
const SINGLE_TYPES = Object.freeze(['PO', LEAD, 'Art Director', 'Release']);
const QA_ROUND_LIMIT = 3;
// 'paused': task bị /role <tên> pause; vẫn tính là việc dở (không cho xóa role, không thay phân công mới).
// 'pending': Lead đã giao nhưng nút Dev trên sơ đồ chưa tới lượt chạy (bộ chạy chuyển sang 'queued' khi tới lượt).
const ACTIVE_TASK = ['pending', 'queued', 'starting', 'running', 'paused'];
// Task đang chạy hoặc tạm dừng giữ kế hoạch Lead lại; task chưa bắt đầu (pending/queued) được kế hoạch mới thay thế.
const BUSY_TASK = Object.freeze(['starting', 'running', 'paused']);
const busyWorkers = thread => (thread.dispatch || []).filter(task => BUSY_TASK.includes(task.status)).map(task => task.worker);
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
  if (thread.shellApproved) delete thread.shellApproved[label]; // lần duyệt shell nhớ trong session đi theo khối
  if (thread.roleConfigByBlock && thread.roleConfig) delete thread.roleConfig[label]; // cấu hình riêng của khối đi theo khối
  for (const key of Object.keys(thread.cliSessions || {})) if (ownsSession(key, label)) delete thread.cliSessions[key];
  if (Array.isArray(thread.taskDrafts)) thread.taskDrafts = thread.taskDrafts.filter(task => task.worker !== label);
}
function addWorker(thread, type) {
  for (const single of SINGLE_TYPES) if (typeOf(type) === single && thread.flow.some(label => typeOf(label) === single)) throw Error('Session đã có ' + single);
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
// force: không xóa thường được nhưng khối không chạy → người dùng xác nhận thì vẫn xóa (bỏ task/hàng chờ của khối).
// Chỉ khối đang chạy thật (busy) là chặn hẳn.
function removable(thread, label, { busy = false } = {}) {
  if (!thread.flow.includes(label)) return { ok: false, reason: 'Role không tồn tại' };
  if (busy) return { ok: false, force: false, reason: label + ' đang chạy; dừng khối trước rồi xóa' };
  const working = workingReason(thread, label, false); if (working) return { ok: false, force: true, reason: working };
  if (idle(thread, label)) return { ok: true, reason: 'không có việc' };
  const dependent = (thread.dispatch || []).find(task => task.status !== 'finished' && (task.dependsOn || []).includes(label));
  if (dependent) return { ok: false, force: true, reason: dependent.worker + ' còn phụ thuộc ' + label };
  return passed(thread, label) ? { ok: true, reason: 'đã pass' } : { ok: false, force: true, reason: label + ' có việc nhưng chưa pass' };
}
// Có Art Director thì Art và Anim nhận task từ Art Director (task.by), Lead chỉ giao Dev/VFX; không có thì Lead giao cả Art/Anim.
const hasArtDirector = thread => (thread.flow || []).some(label => typeOf(label) === ART_DIRECTOR);
const VISUAL_TYPES = Object.freeze(['Art', 'Anim']);
const LEAD_TYPES_WITH_AD = Object.freeze(DEV_TYPES.filter(type => !VISUAL_TYPES.includes(type)));
// Có Art Director: ở pha lập kế hoạch Art Director giao Art/Anim theo đặc tả ART.md; ở pha triage (sửa Issue, ví dụ nén ảnh cho đủ
// dung lượng) Lead giao được cả Art/Anim cho kịp vòng sửa, Art Director vẫn review ảnh sau đó.
const leadTypes = thread => hasArtDirector(thread) && (thread.leadPhase || 'planning') === 'planning' ? LEAD_TYPES_WITH_AD : DEV_TYPES;
const AD_TYPES = VISUAL_TYPES;
const ownedByAd = (thread, task) => task.by === ART_DIRECTOR && hasArtDirector(thread);
// problems nhận lý do khi kế hoạch bị từ chối, để báo cho người dùng/Lead thay vì chỉ "không hợp lệ".
// types: loại khối được nhận task; reserved: task của người giao khác đang giữ tệp (không được chồng).
function taskPlan(text, thread, problems = [], { types = DEV_TYPES, reserved = [] } = {}) {
  const fail = reason => { problems.push(reason); return null; };
  const match = /```tasks\s*([\s\S]*?)```/.exec(text); if (!match) return fail('không có khối tasks');
  try {
    const plan = JSON.parse(match[1]); if (!Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > 30) return fail('tasks phải là mảng 1–30 mục');
    const owners = new Set(); for (const task of plan.tasks) {
      // Lead lập kế hoạch giao Art/Anim khi có Art Director: nói rõ luật thay vì lỗi chung "không phải Dev/VFX/Sound".
      if (thread.flow.includes(task.worker) && VISUAL_TYPES.includes(worker(thread, task.worker).type) && !types.includes(worker(thread, task.worker).type) && types.includes('Dev')) return fail(`${task.worker}: ở pha lập kế hoạch, Art/Anim do Art Director giao theo ART.md; bỏ task này khỏi khối tasks (pha triage thì Lead giao được Art/Anim)`);
      // Khối đang giữ task chưa xong của người giao kia (Art Director/Lead): không giao chồng thêm task thứ hai.
      const held = reserved.find(item => item.worker === task.worker);
      if (held) return fail(`${task.worker} đang có task ${held.by === ART_DIRECTOR ? 'Art Director' : 'Lead'} giao chưa xong (${held.status}); đợi xong hoặc giao khối khác`);
      if (!thread.flow.includes(task.worker) || !types.includes(worker(thread, task.worker).type) || owners.has(task.worker) || typeof task.task !== 'string' || !task.task.trim() || task.task.length > 11800) return fail(`worker "${task.worker}" không phải ${types.join('/')} trong đội, bị trùng, hoặc task trống/quá dài`); owners.add(task.worker); }
    // files bắt buộc và không chồng nhau giữa các Dev: điều kiện để Dev sửa song song không ghi đè nhau.
    // Tối đa FILES_PER_TASK mục: task lớn làm lượt Dev dài, ngữ cảnh phình và chi phí tăng nhanh hơn số lượt.
    const folders = sessionFolders(thread);
    for (const task of plan.tasks) {
      if (!Array.isArray(task.files) || !task.files.length) return fail(`${task.worker}: files bắt buộc`);
      const bad = task.files.find(file => !validFile(file, folders));
      if (bad !== undefined) return fail(`${task.worker}: tệp "${String(bad).slice(0, 200)}" không hợp lệ; dùng đường dẫn tương đối theo thư mục chính (${thread.folder || 'chưa có'}) hoặc tuyệt đối nằm trong thư mục của session${folders.length > 1 ? ' (' + folders.slice(1).join(', ') + ')' : ''}, không dùng ".."`);
      for (const file of task.files) {
        const owners = misplacedIn(file, folders), absolute = owner => path.join(owner, file.trim()).replaceAll('\\', '/');
        if (owners.length) return fail(`${task.worker}: "${file.trim()}" không có trong thư mục chính (${thread.folder}) mà có trong ${owners.join(', ')}; ghi đường dẫn tuyệt đối ${owners.length === 1 ? absolute(owners[0]) : 'vào đúng project (' + owners.map(absolute).join(' hoặc ') + ')'}; nếu đúng là tạo mới trong thư mục chính thì ghi ${absolute(thread.folder)}`);
      }
      if (task.files.length > FILES_PER_TASK) return fail(`${task.worker}: ${task.files.length} tệp, tối đa ${FILES_PER_TASK} mỗi task; chia cho thêm Dev hoặc làm nhiều vòng`);
    }
    const scopes = plan.tasks.map(task => resolvedFiles(thread.folder, task.files));
    for (const [index, scope] of scopes.entries()) { const other = scopes.findIndex((item, at) => at > index && scopesOverlap(scope, item)); if (other >= 0) return fail(`${plan.tasks[index].worker} và ${plan.tasks[other].worker} có tệp chồng nhau`); }
    for (const [index, scope] of scopes.entries()) { const held = reserved.find(task => scopesOverlap(scope, resolvedFiles(thread.folder, task.files || []))); if (held) return fail(`${plan.tasks[index].worker} chồng tệp với task đang giao cho ${held.worker}`); }
    for (const task of plan.tasks) if (task.dependsOn !== undefined && (!Array.isArray(task.dependsOn) || task.dependsOn.some(owner => !owners.has(owner) || owner === task.worker))) return fail(`${task.worker}: dependsOn chỉ gồm Dev khác trong kế hoạch`);
    const visited = new Set(); for (let count = 0; count < plan.tasks.length; count++) for (const task of plan.tasks) if ((task.dependsOn || []).every(owner => visited.has(owner))) visited.add(task.worker); if (visited.size !== owners.size) return fail('dependsOn tạo vòng phụ thuộc');
    return plan.tasks.map(task => ({ worker: task.worker, task: task.task, files: [...new Set(task.files.map(file => file.trim().replaceAll('\\', '/')))], ...(task.dependsOn?.length ? { dependsOn: [...new Set(task.dependsOn)] } : {}) }));
  } catch { return fail('JSON trong khối tasks không đọc được'); }
}
// Kế hoạch của Lead (Dev/VFX; cả Art/Anim khi session không có Art Director) hoặc Art Director (Art/Anim). Thay task chưa bắt đầu của chính người
// giao; task của người giao kia được giữ và không được chồng tệp; khối của người giao đang chạy/tạm dừng thì chưa áp. Thuần, main.cjs ghi.
function mergePlan(thread, planner, text) {
  const byAd = planner === ART_DIRECTOR, mine = task => byAd === ownedByAd(thread, task);
  // Task người dùng dừng giữa chừng (Stop → cancelled, không có lý do) vẫn là việc chưa xong của người giao kia: giữ để /role <khối> start
  // chạy tiếp; chỉ bỏ task đã xong hoặc bị huỷ có lý do (ví dụ Lead lập lại kế hoạch).
  const others = (thread.dispatch || []).filter(task => !mine(task) && task.status !== 'finished' && !(task.status === 'cancelled' && task.error));
  const problems = [], proposal = taskPlan(text, thread, problems, { types: byAd ? AD_TYPES : leadTypes(thread), reserved: others });
  if (!proposal) return { problems: problems.join('; ') };
  const busy = (thread.dispatch || []).filter(task => mine(task) && BUSY_TASK.includes(task.status)).map(task => task.worker);
  if (busy.length) return { blocked: `${planner} đã xuất kế hoạch tasks hợp lệ nhưng ${busy.join(', ')} đang chạy hoặc tạm dừng nên chưa áp dụng. Chờ khối đó xong (hoặc dừng nó) rồi dùng /role ${planner} start.` };
  return { proposal, dispatch: [...others, ...proposal.map(task => ({ ...task, status: 'pending', ...(byAd ? { by: ART_DIRECTOR } : {}) }))] };
}
module.exports = { mergePlan, PIPELINE, SINGLE_TYPES, LEAD, QA_ROUND_LIMIT, ACTIVE_TASK, BUSY_TASK, busyWorkers, hasArtDirector, leadTypes, AD_TYPES, ownedByAd, ownsSession, authoredBy, typeOf, labelType, sortFlow, started, openIssues, worker, forgetWorker, addWorker, runKey, resumeKey, removable, taskPlan, FILES_PER_TASK };
