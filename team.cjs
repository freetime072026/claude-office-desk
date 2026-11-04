const { randomUUID } = require('node:crypto');
const { defaults, roleKey, LEGACY_LEAD, isDevType } = require('./roles.cjs');
const { MCP_NAME } = require('./modes.cjs');
const { CHAT_KEY } = require('./skills.cjs');
const { PIPELINE, LEAD, QA_ROUND_LIMIT, ownsSession, typeOf, labelType, sortFlow, started, openIssues, worker, forgetWorker, addWorker, removable } = require('./workers.cjs');
const { inheritedRole } = require('./prompt.cjs');
const flowgraph = require('./flowgraph.cjs');
const po = require('./po.cjs');
const { PRESETS, PURPOSES, purposeConfig, validEngine, validSpine } = require('./presets.cjs');
const releaseConfig = require('./release-config.cjs');
const HALTED = ['awaiting-decision', 'cancelled'];
const ART_GENERATORS = Object.freeze(['chatgpt', 'tool']);
const initial = () => ({ projects: [], roles: [], threads: [] });
const isHalted = thread => HALTED.includes(thread.status);
const indexOfType = (item, type) => item.flow.findIndex(label => typeOf(label) === type);
function text(value, limit = 12000) { if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error('Nội dung trống hoặc quá dài'); return value.trim(); }
function restartLoop(item) { delete item.tweak; item.stage = 0; item.status = 'waiting'; item.leadPhase = 'planning'; item.qaFailRounds = 0; delete item.qaPassedAt; delete item.qaPhase; delete item.reviewRejects; }
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
// sameRound: vòng sửa của lần kiểm này đã được tính (QA và Art Director · review chạy song song, hoặc Lead triage đang chạy): chỉ ghi
// Issue để Lead triage nhận, không tính thêm một vòng QA fail (trước đây một vòng sửa bị đếm hai lần và session dừng ở 3/3 dù Lead đang giao việc).
function reportIssue(item, content, log, sameRound = false) {
  if (isHalted(item)) throw Error('Session đang chờ quyết định hoặc đã dừng');
  item.issues.push({ id: randomUUID(), text: content, closed: false }); log('Issue', content);
  if (sameRound) { delete item.qaPassedAt; return; }
  item.qaFailRounds = (item.qaFailRounds || 0) + 1; delete item.qaPassedAt;
  if (item.qaFailRounds < QA_ROUND_LIMIT) return toTriage(item, log);
  item.status = 'awaiting-decision'; log('Hệ thống', `QA fail vòng ${item.qaFailRounds}/${QA_ROUND_LIMIT}; chờ người dùng quyết định`);
}
// Chỉnh sửa sau khi đã có bản hoàn thiện (đổi art, size, anim…): ghi như Issue loại tweak để Lead triage giao đúng khối và QA
// retest, nhưng không tính là QA fail. thread.tweak đánh dấu vòng chỉnh sửa (pipeline.cjs bỏ pha performance và Release).
function requestTweak(item, content, log) {
  if (isHalted(item)) throw Error('Session đang chờ quyết định hoặc đã dừng');
  item.issues.push({ id: randomUUID(), text: '[Chỉnh sửa] ' + content, closed: false, kind: 'tweak' }); log('Chỉnh sửa', content);
  item.tweak = true; delete item.qaPassedAt;
  toTriage(item, log);
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
// Session theo preset: khối mới cùng loại cũng chỉ phục vụ preset đó (đổi lại ở panel khối nếu cần).
function inheritPurpose(item, label) { const purpose = item.preset?.toLowerCase(); if (purposeConfig(typeOf(label), purpose)) worker(item, label).purpose = purpose; }
function addRole(item, type, log) {
  if (!Object.hasOwn(defaults, type)) throw Error('Loại role không hợp lệ');
  const label = addWorker(item, type);
  inheritPurpose(item, label);
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
  item.flow = next; restartLoop(item); item.roleConfig ||= {}; item.roleConfigByBlock = true; item.graph = flowgraph.defaultGraph(item); delete item.graphRun;
  if (payload.restart) { for (const issue of item.issues) issue.closed = false; log('Hệ thống', 'Cấu hình role thay đổi; quy trình bắt đầu lại.'); }
}
// Preset đội: chọn lại role theo preset (qua selectRoles nên giữ các gate xóa role) rồi gán mục đích cho mọi khối.
function setPurpose(config, purpose) {
  if (!PURPOSES.includes(purpose) || (purpose !== 'game' && !purposeConfig(config.type, purpose))) throw Error('Mục đích không hợp lệ');
  if (purpose === 'game') delete config.purpose; else config.purpose = purpose;
}
function applyPreset(team, item, payload, log) {
  if (!Object.hasOwn(PRESETS, payload.preset)) throw Error('Preset không hợp lệ');
  const preset = PRESETS[payload.preset], purpose = payload.preset.toLowerCase(), engine = payload.engine || '', spine = payload.spine || '';
  if (!validEngine(payload.preset, engine)) throw Error('Engine không hợp lệ');
  if (!validSpine(payload.preset, spine)) throw Error('Cách dùng Spine không hợp lệ');
  selectRoles(team, item, { ...payload, roles: preset.roles }, log);
  for (const label of item.flow) if (purposeConfig(typeOf(label), purpose)) worker(item, label).purpose = purpose;
  item.preset = payload.preset; setEngine(item, engine); setSpine(item, spine);
  log('Hệ thống', `Áp dụng preset ${preset.name}: ${item.flow.join(', ')}. Các khối chỉ nhận việc của ${payload.preset}. ${engineText(item)}. ${spineText(item)}.`);
}
// Engine của session theo preset ('' = Lead chọn theo project); đổi engine không bắt đầu lại quy trình.
function setEngine(item, engine) { if (engine) item.engine = engine; else delete item.engine; }
const engineText = item => 'Engine: ' + (item.engine ? PRESETS[item.preset || 'PLA'].engines[item.engine].name : 'Lead chọn theo project');
function changeEngine(item, engine, log) {
  if (typeof engine !== 'string' || !validEngine(item.preset || 'PLA', engine)) throw Error('Engine không hợp lệ');
  setEngine(item, engine); log('Cấu hình', engineText(item));
}
// Cách dùng Spine đầu vào của session theo preset ('' = Lead chọn theo project), cùng kiểu engine.
function setSpine(item, spine) { if (spine) item.spine = spine; else delete item.spine; }
const spineText = item => 'Spine: ' + (item.spine ? PRESETS[item.preset || 'PLA'].spine[item.spine].name : 'Lead chọn theo project');
function changeSpine(item, spine, log) {
  if (typeof spine !== 'string' || !validSpine(item.preset || 'PLA', spine)) throw Error('Cách dùng Spine không hợp lệ');
  setSpine(item, spine); log('Cấu hình', spineText(item));
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
// Quyền shell của khối (permissions.SHELL_OPTIONS); đổi lựa chọn thì bỏ lần duyệt shell đã nhớ trong session.
function setShell(item, role, config, shell) {
  if (!require('./permissions.cjs').SHELL_OPTIONS.includes(shell)) throw Error('Quyền shell không hợp lệ');
  if ((config.shell || 'once') !== shell && item.shellApproved) delete item.shellApproved[role];
  if (shell === 'once') delete config.shell; else config.shell = shell;
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
// ≤ 0.21 lưu cấu hình theo loại role (roleConfig.Dev dùng chung cho Dev, Dev #2…). Chuyển sang theo nhãn khối: mỗi khối nhận bản
// sao của loại mình; trách nhiệm/đầu ra trùng template/mặc định (app tự chép khi chọn role) bỏ đi để preset/template áp lại.
// ---- Kế hoạch đội của PO (po.cjs). Đề xuất → người dùng duyệt một lần cả kế hoạch → app áp từng mốc.
// Áp mốc k: xoá khối không còn cần (khối đang có việc vẫn xoá vì đã được duyệt trước; khối đang chạy thì tạm nghỉ và báo),
// thêm khối mới cần, tạm nghỉ khối không dùng ở mốc này, ghi trách nhiệm riêng của từng khối và phần việc giao GD.
function applyMilestone(team, item, k, log, busy = []) {
  const plan = item.poPlan.plan, milestone = plan.milestones[k], change = po.changesAt(plan, k, item.flow), notes = [];
  for (const label of change.remove) {
    try { notes.push(`xoá ${label} (${dropRole(item, label, busy, true)})`); } catch (error) { worker(item, label).idle = true; notes.push(`chưa xoá được ${label}: ${error.message}; tạm nghỉ`); }
  }
  for (const label of change.add) { const added = addWorker(item, typeOf(label)); inheritPurpose(item, added); notes.push('thêm ' + added); }
  for (const label of item.flow) { if ([po.PO, 'Fixer'].includes(typeOf(label))) continue; const config = worker(item, label); if (milestone.blocks.includes(label)) delete config.idle; else config.idle = true; }
  migrateRoleConfig(team, item); item.roleConfig ||= {};
  for (const label of item.flow) { const body = po.responsibilityFor(plan, label); if (body) item.roleConfig[label] = { ...item.roleConfig[label], instructions: body }; }
  const gd = item.flow.find(label => typeOf(label) === 'GD'); if (gd) worker(item, gd).task = milestone.gd;
  item.poPlan.current = k; flowgraph.syncGraph(item);
  const idle = item.flow.filter(label => worker(item, label).idle);
  log('Hệ thống', `Kế hoạch PO · mốc ${k + 1}/${plan.milestones.length}: ${milestone.title}. ${notes.length ? notes.join(', ') + '. ' : ''}${idle.length ? 'Tạm nghỉ: ' + idle.join(', ') + '. ' : ''}GD nhận phần việc của mốc.`);
}
// Đề xuất mới (main.cjs gọi sau lượt PO có khối team hợp lệ). Chưa đổi đội cho tới khi duyệt.
function proposePlan(item, payload, log) {
  if (!payload.plan?.milestones?.length) throw Error('Kế hoạch PO không hợp lệ');
  item.poPlan = { ...(item.poPlan?.status === 'approved' ? { previous: { plan: item.poPlan.plan, current: item.poPlan.current } } : {}), status: 'proposed', plan: payload.plan, steps: payload.steps || [], previews: payload.previews || [], proposedAt: new Date().toISOString() };
  delete item.poProblems; log('Hệ thống', `PO đề xuất kế hoạch đội ${payload.plan.milestones.length} mốc; chờ bạn duyệt.`);
}
// Loại sản phẩm PO chọn: preset (pla → PLA) thì mọi khối có cấu hình preset nhận mục đích đó; game thì bỏ preset, engine, Spine.
// Kế hoạch không ghi product hoặc trùng preset hiện có thì giữ nguyên (kể cả mục đích người dùng đã đổi tay ở panel khối).
function setProduct(item, product, log, source = 'kế hoạch PO') {
  if (!product) return;
  const key = po.presetKey(product); if (key === item.preset || (!key && !item.preset)) return;
  if (key) item.preset = key; else { delete item.preset; delete item.engine; delete item.spine; }
  for (const label of item.flow) { const config = worker(item, label); if (key && purposeConfig(typeOf(label), product)) config.purpose = product; else delete config.purpose; }
  log('Hệ thống', `Loại sản phẩm theo ${source}: ${po.productName(product)}.` + (key ? ` Các khối chỉ nhận việc của ${key}. ${engineText(item)}. ${spineText(item)}.` : ''));
}
// Người dùng chọn loại sản phẩm ở panel khối PO (thread.poProduct): áp ngay cho session, PO lên kế hoạch theo loại này và khi duyệt
// lựa chọn này thắng product trong kế hoạch. '' = để PO tự chọn (giữ preset hiện có tới khi duyệt kế hoạch).
function chooseProduct(item, product, log) {
  if (product !== '' && !po.PRODUCTS.includes(product)) throw Error('Loại sản phẩm không hợp lệ');
  if (!item.flow.some(label => typeOf(label) === po.PO)) throw Error('Session chưa có khối PO');
  if (!product) { delete item.poProduct; log('Cấu hình', 'Loại sản phẩm: để PO chọn'); return; }
  item.poProduct = product; log('Cấu hình', `Loại sản phẩm do bạn chọn: ${po.productName(product)}; PO lên kế hoạch theo loại này`);
  setProduct(item, product, log, 'lựa chọn của bạn');
}
function approvePlan(team, item, payload, log) {
  if (item.poPlan?.status !== 'proposed') throw Error('Không có kế hoạch PO chờ duyệt');
  if (busyOf(payload).some(label => typeOf(label) !== po.PO)) throw Error('Còn khối đang chạy; đợi xong rồi duyệt kế hoạch');
  item.poPlan.status = 'approved'; item.poPlan.approvedAt = new Date().toISOString(); delete item.poPlan.previous;
  log('Hệ thống', 'Đã duyệt kế hoạch đội của PO (gồm thay đổi khối ở các mốc sau; app tự áp khi tới mốc, không hỏi lại).');
  setProduct(item, item.poProduct || item.poPlan.plan.product, log, item.poProduct ? 'lựa chọn của bạn' : 'kế hoạch PO');
  applyMilestone(team, item, 0, log, busyOf(payload)); return true;
}
function rejectPlan(item, payload, log) {
  if (item.poPlan?.status !== 'proposed') throw Error('Không có kế hoạch PO chờ duyệt');
  const reason = typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 2000) : ''; item.poProblems = reason || 'người dùng từ chối kế hoạch';
  if (item.poPlan.previous) item.poPlan = { status: 'approved', plan: item.poPlan.previous.plan, current: item.poPlan.previous.current }; else delete item.poPlan;
  log('Hệ thống', 'Từ chối kế hoạch đội của PO' + (reason ? ': ' + reason : '') + '. Lượt PO sau sẽ nhận lý do này.'); return true;
}
// Mốc kế tiếp (pipeline gọi khi luồng tới Hoàn tất): áp và báo true; hết mốc thì false.
function nextMilestone(team, item, payload, log) {
  const plan = item.poPlan; if (plan?.status !== 'approved' || (plan.current ?? 0) + 1 >= plan.plan.milestones.length) return false;
  applyMilestone(team, item, plan.current + 1, log, busyOf(payload)); return true;
}
function migrateRoleConfig(team, thread) {
  if (thread.roleConfigByBlock || !Array.isArray(thread.flow)) return false;
  const old = thread.roleConfig || {}, next = {};
  for (const label of thread.flow) {
    const type = labelType(thread, label), source = old[label] || old[type]; if (!source) continue;
    const copied = field => [team.roleTemplates?.[type]?.[field], defaults[type]?.[field]].includes(source[field]);
    next[label] = { ...(source.responsibility && !copied('responsibility') ? { responsibility: source.responsibility } : {}), ...(source.output && !copied('output') ? { output: source.output } : {}), instructions: source.instructions || '' };
  }
  thread.roleConfig = next; thread.roleConfigByBlock = true; return true;
}
function update(team, action, payload) {
  if (action === 'project') { const item = { id: randomUUID(), name: text(payload.name, 80) }; team.projects.push(item); return item.id; }
  if (action === 'role') { const name = text(payload.name, 40); if (team.roles.includes(name)) throw Error('Role đã tồn tại'); team.roles.push(name); return true; }
  if (payload.project && !team.projects.some(item => item.id === payload.project)) throw Error('Dự án không tồn tại');
  if (action === 'create') { const request = payload.request ? text(payload.request) : ''; const item = { id: randomUUID(), model: 'claude-opus-5-5', title: request ? request.replace(/\s+/g, ' ').slice(0, 70) : 'Session mới', project: payload.project || '', pinned: false, stage: 0, status: 'waiting', flow: [], messages: request ? [{ role: 'Bạn', text: request, time: new Date().toISOString() }] : [], issues: [], folder: '', attachments: [], roleConfigByBlock: true }; team.threads.push(item); return item.id; }
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
  if (action === 'worker-config') { if (!item.flow.includes(payload.role)) throw Error('Role không tồn tại'); if (!require('./modes.cjs').validMode(payload.mode) || !['claude-opus-5-5', 'sonnet', 'opus', 'haiku'].includes(payload.model)) throw Error('Mode/model không hợp lệ'); const config = worker(item, payload.role); config.mode = payload.mode; config.model = payload.model; config.profileId = typeof payload.profileId === 'string' ? payload.profileId : ''; config.task = typeof payload.task === 'string' ? payload.task.slice(0, 12000) : ''; if (payload.shell !== undefined) setShell(item, payload.role, config, payload.shell); if (payload.purpose !== undefined) setPurpose(config, payload.purpose); return true; }
  // Cấu hình build của một khối Release (release-config.cjs): null = theo build.json của project; app ghi vào build.json trước lượt.
  // Panel lưu ở mỗi ô nên không ghi tin vào hội thoại; brief của lượt Release ghi cấu hình đang dùng.
  if (action === 'release-config') {
    if (!item.flow.includes(payload.role) || labelType(item, payload.role) !== 'Release') throw Error('Chỉ khối Release có cấu hình build');
    const config = worker(item, payload.role);
    if (payload.config === null) delete config.release; else config.release = releaseConfig.validate(payload.config);
    return true;
  }
  if (action === 'chat-options') { if (!require('./modes.cjs').validMode(payload.mode) || !['claude-opus-5-5', 'sonnet', 'opus', 'haiku'].includes(payload.model)) throw Error('Mode/model không hợp lệ'); item.mode = payload.mode; item.model = payload.model; return true; }
  if (action === 'template') { const key = roleKey(text(payload.role, 40)); team.roleTemplates ||= {}; team.roleTemplates[key] = { responsibility: text(payload.responsibility, 6000), output: text(payload.output, 6000) }; return true; }
  if (action === 'remove-role') { removeRole(item, payload, log); return true; }
  if (action === 'po-propose') { proposePlan(item, payload, log); return true; }
  if (action === 'po-approve') return approvePlan(team, item, payload, log);
  if (action === 'po-reject') return rejectPlan(item, payload, log);
  if (action === 'po-next') return nextMilestone(team, item, payload, log);
  if (action === 'po-product') { chooseProduct(item, payload.product, log); return true; }
  // Công cụ sinh ảnh của Art (dùng chung mọi session): 'chatgpt' = Art viết prompt chi tiết, người dùng tạo ảnh bằng ChatGPT;
  // 'tool' = Art tự gọi script/pipeline của project hoặc MCP sinh ảnh.
  if (action === 'art-generator') { if (!ART_GENERATORS.includes(payload.mode)) throw Error('Công cụ sinh ảnh không hợp lệ'); team.artGenerator = payload.mode; log('Cấu hình', 'Art sinh ảnh bằng: ' + (payload.mode === 'chatgpt' ? 'ChatGPT (thủ công)' : 'script/MCP của project')); return true; }
  // US-08: MCP server bật cho từng loại role, dùng chung mọi session; role không có trong danh sách không nạp MCP nào.
  if (action === 'role-mcp') {
    const key = roleKey(text(payload.role, 40)); if (![...PIPELINE, ...item.flow.map(typeOf)].includes(key)) throw Error('Role không hợp lệ');
    if (!Array.isArray(payload.servers) || payload.servers.length > 32 || !payload.servers.every(name => typeof name === 'string' && MCP_NAME.test(name))) throw Error('Danh sách MCP server không hợp lệ');
    team.roleMcp ||= {}; team.roleMcp[key] = [...new Set(payload.servers)];
    log('Cấu hình', `MCP server của ${key}: ${team.roleMcp[key].join(', ') || 'không có'}`); return true;
  }
  // Skill bật cho từng loại role hoặc chat thường (CHAT_KEY, skills.cjs), dùng chung mọi session; tên skill không có trong thư mục
  // của session thì bỏ qua.
  if (action === 'role-skills') {
    const key = payload.role === CHAT_KEY ? CHAT_KEY : roleKey(text(payload.role, 40)); if (key !== CHAT_KEY && ![...PIPELINE, ...item.flow.map(typeOf)].includes(key)) throw Error('Role không hợp lệ');
    if (!Array.isArray(payload.skills) || payload.skills.length > 64 || !payload.skills.every(name => typeof name === 'string' && MCP_NAME.test(name))) throw Error('Danh sách skill không hợp lệ');
    team.roleSkills ||= {}; team.roleSkills[key] = [...new Set(payload.skills)];
    log('Cấu hình', `Skill của ${key === CHAT_KEY ? 'chat thường' : key}: ${team.roleSkills[key].join(', ') || 'không có'}`); return true;
  }
  // Cấu hình riêng của một khối (nhãn khối, không theo loại): Dev và Dev #2 sửa độc lập. Chỉ lưu trách nhiệm/đầu ra khác phần
  // thừa hưởng (preset/template/mặc định) để khối chưa sửa vẫn theo preset khi preset đổi.
  if (action === 'role-config') {
    const label = text(payload.role, 60); if (!item.flow.includes(label)) throw Error('Role không hợp lệ');
    const responsibility = text(payload.responsibility, 6000), output = text(payload.output, 6000), inherited = inheritedRole(team, item, label);
    const config = { ...(responsibility !== inherited.responsibility ? { responsibility } : {}), ...(output !== inherited.output ? { output } : {}), instructions: typeof payload.instructions === 'string' ? payload.instructions.slice(0, 12000) : '' };
    item.roleConfig ||= {}; item.roleConfig[label] = config;
    if (payload.saveDefault) { const key = labelType(item, label); team.roleTemplates ||= {}; team.roleTemplates[key] = { responsibility, output }; }
    log('Cấu hình', 'Cập nhật trách nhiệm/đầu ra/yêu cầu riêng của khối ' + label); return true;
  }
  if (action === 'edit-request') {
    const content = text(payload.text); const first = item.messages.find(message => message.role === 'Bạn');
    if (started(item) && !payload.restart) throw Error('Cần xác nhận bắt đầu lại quy trình sau khi sửa yêu cầu');
    if (first) { log('Lịch sử yêu cầu', first.text); first.text = content; } else log('Bạn', content);
    item.title = content.replace(/\s+/g, ' ').slice(0, 70); restartLoop(item); for (const issue of item.issues) issue.closed = false;
    log('Hệ thống', 'Yêu cầu đã sửa; cần kiểm tra lại kết quả cũ.'); return true;
  }
  if (action === 'select-roles') selectRoles(team, item, payload, log);
  else if (action === 'apply-preset') applyPreset(team, item, payload, log);
  else if (action === 'preset-engine') changeEngine(item, payload.engine, log);
  else if (action === 'preset-spine') changeSpine(item, payload.spine, log);
  else if (action === 'assign-role') { const name = roleKey(text(payload.name, 40)); if (!item.flow.includes(name)) flowgraph.addNode(item, addWorker(item, name)); }
  else if (action === 'pin') item.pinned = !item.pinned;
  else if (action === 'move') item.project = payload.project || '';
  else if (action === 'message') { const content = text(payload.text); if (!item.messages.some(message => message.role === 'Bạn')) item.title = content.replace(/\s+/g, ' ').slice(0, 70); log('Bạn', content); }
  else if (action === 'start') { if (item.status !== 'waiting') throw Error('Bước không ở trạng thái chờ'); item.status = 'working'; log('Hệ thống', 'Bắt đầu thủ công: ' + item.flow[item.stage]); }
  else if (action === 'handoff') handoff(item, text(payload.text), log, payload.auto === true);
  else if (action === 'issue') reportIssue(item, text(payload.text), log, payload.sameRound === true);
  else if (action === 'tweak') requestTweak(item, text(payload.text), log);
  else if (action === 'review-reject') reviewReject(item, text(payload.text), log);
  else if (action === 'decision') decide(item, payload.choice, log);
  else if (action === 'retest') { if (typeOf(item.flow[item.stage]) !== 'QA' || item.status !== 'working') throw Error('Chỉ retest khi QA đang kiểm thử'); const issue = item.issues.find(issue => issue.id === payload.issue); if (!issue) throw Error('Không tìm thấy Issue'); const evidence = typeof payload.text === 'string' && payload.text.trim() ? text(payload.text) : 'Người dùng xác nhận đã retest'; issue.closed = true; log('QA · retest thủ công', evidence); }
  // Bỏ qua một Issue (chấp nhận lỗi đã biết): không còn tính là Issue mở cho QA/Lead và gate QA, giữ lại trong lịch sử.
  else if (action === 'dismiss-issue') { const issue = openIssues(item).find(issue => issue.id === payload.issue); if (!issue) throw Error('Không tìm thấy Issue đang mở'); issue.accepted = true; const reason = typeof payload.text === 'string' && payload.text.trim() ? ': ' + text(payload.text) : ''; log('Hệ thống', `Người dùng bỏ qua Issue ${issue.id}${reason}`); }
  else throw Error('Thao tác không hợp lệ');
  return true;
}
module.exports = { initial, update, migrateThread, migrateRoleConfig, recoverInterrupted, isHalted };
