// Bộ chạy tự động theo sơ đồ luồng của session (flowgraph.cjs): mặc định GD → UI/UX → Lead → Dev/VFX song song → QA → review.
// Chỉ chuyển bước theo khối ```handoff``` / ```tasks``` hợp lệ; không đoán từ văn bản tự do.
// Mọi thay đổi trạng thái team đi qua team.cjs (update) để giữ gate QA, giới hạn vòng và log.
const { LEAD, ACTIVE_TASK, labelType, worker, taskPlan, openIssues, ownedByAd, hasArtDirector } = require('./workers.cjs');
const { isHalted } = require('./team.cjs');
const { isDevType, ART_DIRECTOR, RELEASE, ART_REJECT_REASONS } = require('./roles.cjs');
const { foldersOf } = require('./usage.cjs');
const graph = require('./flowgraph.cjs');
const { RETRY } = require('./dispatch.cjs');
const RETRY_WAIT_MS = 30 * 1000; // nút chờ vì lỗi tạm thời (trùng tệp đang ghi, đủ phiên chat) tự thử lại sau khoảng này
const PO_TYPE = 'PO';
const HANDOFF_STATUSES = Object.freeze(['done', 'blocked', 'issue', 'pass', 'reject']);
const ROLE_VERBS = Object.freeze(['start', 'pause']);
const SUMMARY_LIMIT = 4000;
// Lead review không đạt thì cho Dev sửa thêm đúng 1 lần; lần sau vẫn không đạt thì dừng chờ người dùng.
const REVIEW_RETRY_LIMIT = 1;
// Số lần mỗi vòng Dev bị chặn được tự chuyển sang Lead giao lại; quá số này thì dừng chờ người dùng để không lặp mãi.
const REASSIGN_LIMIT = 2;
// Art Director không duyệt mockup UI/UX hoặc trả ảnh về cho Art: tối đa số lần này mỗi vòng, quá thì dừng chờ người dùng.
const AD_REJECT_LIMIT = 2;
// Pha hiện tại của khối có pha: Lead lưu ở leadPhase, Art Director ở adPhase.
const phaseKey = (thread, label) => labelType(thread, label) === ART_DIRECTOR ? 'adPhase' : 'leadPhase';
// Task Dev còn đang chạy hoặc chờ chạy: Lead chỉ lập lại kế hoạch khi các task này xong (main.cjs không áp kế hoạch khi còn task dở).
const RUNNING_TASK = Object.freeze(['queued', 'starting', 'running']);
const TASK_LIMIT = 11000;
const clipText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const now = () => new Date().toISOString();
// Khối làm hình: vòng chỉnh sửa có task của các khối này thì Art Director review lại.
const ART_TYPES = Object.freeze(['Art', 'Anim', 'VFX']);
// Phạm vi đã được duyệt khi bật tự động: mode từng khối + thư mục. Đổi mode/thư mục thì lượt tự động phải hỏi lại (main.cjs).
function approvalScope(thread) {
  const folders = foldersOf(thread).map(folder => folder.toLowerCase()).sort();
  return JSON.stringify({ folders, modes: thread.flow.map(label => label + '=' + worker(thread, label).mode) });
}

function parseHandoff(text) {
  const blocks = require('./fence.cjs').fenceBodies(text, 'handoff'); if (!blocks.length) return null;
  let data; try { data = JSON.parse(blocks.at(-1)); } catch { return null; }
  if (!data || typeof data !== 'object' || !HANDOFF_STATUSES.includes(data.status)) return null;
  const retested = Array.isArray(data.retested) ? data.retested.filter(item => item && typeof item.id === 'string').slice(0, 50).map(item => ({ id: item.id, evidence: clipText(item.evidence, SUMMARY_LIMIT) })) : [];
  // reassign: Dev/VFX bị chặn vì AC cần sửa tệp ngoài phạm vi hoặc cần khối khác, QA bị chặn vì thiếu công cụ Dev làm được;
  // bộ chạy chuyển sang Lead triage thay vì dừng.
  // reject của Dev/VFX/Anim kèm reason: ảnh đã qua Art Director nhưng không ghép được (ART_REJECT_REASONS) → Art Director review lại.
  const artReject = data.status === 'reject' && Object.hasOwn(ART_REJECT_REASONS, data.reason) ? { reason: data.reason, art: Array.isArray(data.art) ? data.art.filter(id => typeof id === 'string' && id.trim()).slice(0, 20).map(id => id.trim().slice(0, 80)) : [] } : {};
  return { status: data.status, summary: clipText(data.summary, SUMMARY_LIMIT), retested, ...artReject, ...(data.status === 'blocked' && data.reassign === true ? { reassign: true } : {}) };
}

// Lệnh điều khiển trong chat: /role <khối> start|pause, /auto on|off, /chot.
function parseCommand(content, flow = []) {
  const text = String(content || '').trim();
  if (/^\/ch(o|ố)t$/i.test(text)) return { kind: 'chot' };
  if (/^\/auto\b/i.test(text)) { const match = /^\/auto\s+(on|off)$/i.exec(text); return match ? { kind: 'auto', on: match[1].toLowerCase() === 'on' } : { kind: 'error', message: 'Dùng /auto on hoặc /auto off' }; }
  if (!/^\/role\b/i.test(text)) return null;
  const match = /^\/role\s+(.+?)\s+(\S+)$/i.exec(text);
  if (!match || !ROLE_VERBS.includes(match[2].toLowerCase())) return { kind: 'error', message: 'Dùng /role <tên khối> start|pause, ví dụ /role Lead Dev pause' };
  const wanted = match[1].trim().toLowerCase(), label = flow.find(name => name.toLowerCase() === wanted);
  if (!label) return { kind: 'error', message: `Không có khối "${match[1].trim()}". Khối hiện có: ${flow.join(', ') || 'chưa có'}` };
  return { kind: 'role', label, verb: match[2].toLowerCase() };
}

const devLabels = thread => thread.flow.filter(label => isDevType(labelType(thread, label)));
const hasLead = thread => thread.flow.some(label => labelType(thread, label) === LEAD);
const issueText = thread => openIssues(thread).map(issue => '- ' + issue.text).join('\n');
// Task sửa khi không có khối tasks hợp lệ: giao lại cho các Dev của lượt trước (hoặc Dev đầu tiên).
function fallbackTasks(thread, reason) {
  const devs = devLabels(thread);
  const previous = (thread.dispatch || []).filter(task => devs.includes(task.worker));
  const owners = previous.length ? previous.map(task => task.worker) : devs.slice(0, 1);
  return owners.map(owner => { const before = previous.find(task => task.worker === owner)?.task || worker(thread, owner).task || ''; return { worker: owner, task: clipText(['Sửa theo yêu cầu:', reason, before ? 'Task trước:\n' + before : ''].filter(Boolean).join('\n'), TASK_LIMIT) }; });
}
// Task của một Dev khi session không có Lead để phân công: task riêng của khối + Issue đang mở.
function freshTask(thread, label) {
  const issues = issueText(thread);
  return { worker: label, task: clipText([worker(thread, label).task || 'Thực hiện yêu cầu session theo bàn giao trước.', issues ? 'Issue cần sửa:\n' + issues : ''].filter(Boolean).join('\n'), TASK_LIMIT), status: 'queued' };
}
const freshDevTasks = thread => devLabels(thread).map(label => freshTask(thread, label));
function stageText(thread, label) {
  const phase = [LEAD, ART_DIRECTOR].includes(labelType(thread, label)) ? ` (pha ${thread[phaseKey(thread, label)] || 'planning'})` : '';
  return `Tự động: thực hiện bước ${label}${phase} dựa trên bàn giao trước. Hoàn thành vai trò rồi xuất khối handoff ở cuối.`;
}
// Task Dev chưa chạy xong (kể cả đang chờ tới lượt theo sơ đồ hoặc bị dừng) của một khối.
const openTask = (thread, label) => (thread.dispatch || []).find(task => task.worker === label && task.status !== 'finished');

// Bộ chạy tự động theo sơ đồ (flowgraph.cjs). deps: update(thread, action, payload), send(thread, label, text) → kết quả
// chat-send, pump(thread), log(thread, role, text), changed(), approve(thread) → Promise<boolean>, isRunning(thread, label),
// recordTasks(thread, tasks, reason), newRound(thread, round, summary).
function createAutoRun(deps) {
  const { update, send, pump, log, changed, approve, isRunning, recordTasks = () => {}, newRound = () => {}, nextMilestone = () => false, incident = () => {} } = deps;
  // Khối không phải Dev "running" lâu hơn mức này mà không có phiên chat thì coi là kẹt (xem settleStale).
  const STALE_RUN_MS = 60 * 1000;
  // Xoá trạng thái của vòng trước (dùng khi GD mở vòng mới và khi kế hoạch PO sang mốc mới); giữ phiên CLI của các khối.
  function resetRound(thread) {
    graph.resetRun(thread); thread.leadPhase = 'planning'; thread.qaFailRounds = 0; delete thread.tweak;
    delete thread.qaPhase; delete thread.reviewRejects; delete thread.qaPassedAt; delete thread.planProblems; delete thread.reassign; delete thread.reassignRounds; delete thread.adPhase; delete thread.uiuxRejects; delete thread.adRejects; delete thread.uiuxReview; delete thread.adPlanProblems; delete thread.artRework; delete thread.artReworks; delete thread.artRedo;
  }
  const active = thread => Boolean(thread.auto?.enabled) && !isHalted(thread) && thread.status !== 'done';
  const note = (thread, text) => { log(thread, 'Tự động', text); changed(); };
  const handedOff = (thread, label, summary) => log(thread, label + ' · bàn giao tự động', summary || label + ' hoàn tất');
  const started = thread => Object.values(graph.runOf(thread).nodes).some(state => state.status !== 'idle');
  // Bước "hiện tại" để hiển thị và cho các thao tác cũ (team.cjs) dựa vào stage/leadPhase.
  // Nhiều Dev/VFX chạy song song thì bước hiện tại là khối Dev đầu tiên đang chạy.
  function focus(thread, node, status = 'working') {
    const running = isDevType(labelType(thread, node.label)) ? graph.ensureGraph(thread).nodes.filter(item => isDevType(labelType(thread, item.label)) && graph.stateOf(thread, item.id).status === 'running').map(item => thread.flow.indexOf(item.label)) : [];
    const index = Math.min(thread.flow.indexOf(node.label), ...running.filter(at => at >= 0));
    if (index >= 0) thread.stage = index; if (node.phase) thread[phaseKey(thread, node.label)] = node.phase; if (status) thread.status = status;
  }
  // Dừng ở một khối: báo main.cjs (incident) để Fixer chẩn đoán và gọi đúng khối chạy tiếp, nếu session có Fixer.
  // fix=false: dừng có chủ đích, chờ người dùng (khối cần ảnh/quyết định/đăng nhập, bạn bấm dừng hoặc tạm dừng, chạm giới hạn số vòng):
  // không gọi Fixer, vì không có lỗi để chẩn đoán và Fixer chạy lại khối chỉ làm khối hỏi lại đúng câu đó.
  function block(thread, node, text, fix = true) { graph.finish(thread, node.id, 'blocked'); note(thread, text); if (fix && active(thread) && !worker(thread, node.label).paused) incident(thread, { label: node.label, kind: 'bị chặn', reason: text }); }
  const wait = (thread, node, text) => block(thread, node, text, false);

  async function enable(thread, reason) {
    if (!(await approve(thread))) { note(thread, reason + ' Người dùng không xác nhận; giữ chạy thủ công.'); return false; }
    thread.auto = { enabled: true, approvedAt: now(), scope: approvalScope(thread) };
    note(thread, `${reason} Bật chạy tự động theo sơ đồ.`); return true;
  }
  function disable(thread) { if (thread.auto) thread.auto.enabled = false; note(thread, 'Tắt chạy tự động; các lượt đang chạy vẫn tiếp tục tới khi xong.'); }

  // Chạy một nút đã sẵn sàng. Dev/VFX không có task thì bỏ qua (kết quả skipped) để các nút sau không phải chờ.
  async function startNode(thread, node) {
    const state = graph.stateOf(thread, node.id);
    if (node.id === graph.END) {
      // Nhánh song song chưa xong (khối khác đang chạy, đang chờ hoặc bị chặn, ví dụ Art chờ ảnh trong lúc Lead review đã đạt): chưa
      // Hoàn tất, nếu không session thành "xong", tắt chạy tự động và bàn giao sau đó của nhánh kia bị bỏ qua. Bước kết thúc được kích
      // hoạt lại khi nhánh đó đi tới nó.
      const open = graph.ensureGraph(thread).nodes.find(item => item.id !== graph.END && ['running', 'queued', 'blocked'].includes(graph.stateOf(thread, item.id).status));
      if (open) { state.status = 'idle'; log(thread, 'Tự động', `Chưa Hoàn tất: còn ${graph.nodeLabel(open)} (${graph.stateOf(thread, open.id).status === 'blocked' ? 'bị chặn' : 'đang chạy/chờ'}).`); return; }
      // Kế hoạch PO đã duyệt còn mốc sau: app áp mốc (thêm/xoá/tạm nghỉ khối, giao GD) rồi chạy tiếp từ GD, không dừng ở Hoàn tất.
      if (!thread.tweak && nextMilestone(thread)) return startMilestone(thread);
      state.status = 'done'; thread.status = 'done'; delete thread.tweak; note(thread, 'Hoàn tất theo sơ đồ.'); return;
    }
    // Khối tạm nghỉ theo kế hoạch PO ở mốc này: bỏ qua để các bước sau không phải chờ.
    // Kết quả pass để mọi cạnh xong/pass đi tiếp (QA nghỉ không chặn review/Hoàn tất); hiển thị là bỏ qua.
    if (worker(thread, node.label).idle) { graph.finish(thread, node.id, 'pass'); graph.stateOf(thread, node.id).status = 'skipped'; log(thread, 'Tự động', `${graph.nodeLabel(node)} tạm nghỉ ở mốc này theo kế hoạch PO · bỏ qua.`); return; }
    // Vòng chỉnh sửa: Release không tự đóng gói (bạn gom nhiều chỉnh sửa rồi bấm Build); Art Director chỉ review khi vòng có đổi art.
    if (thread.tweak && labelType(thread, node.label) === RELEASE) {
      Object.assign(state, { status: 'skipped', outcome: 'skipped' }); graph.queue(thread, graph.END);
      log(thread, 'Tự động', 'Chỉnh sửa xong · Release không tự chạy; bấm Build preview/production ở khối Release khi muốn đóng gói.'); return;
    }
    if (thread.tweak && node.phase === 'review' && labelType(thread, node.label) === ART_DIRECTOR && !(thread.dispatch || []).some(task => ART_TYPES.includes(labelType(thread, task.worker)))) {
      log(thread, 'Tự động', `${graph.nodeLabel(node)}: vòng chỉnh sửa không đổi art · bỏ qua.`); graph.finish(thread, node.id, 'pass'); return;
    }
    // Lead review chỉ chạy khi việc sửa của vòng đã xong: Lead triage còn chờ/chạy/bị chặn (QA hoặc Art Director báo issue) thì review
    // sẽ chấm trên code chưa sửa và tốn lượt sửa duy nhất. Bỏ hàng chờ; review được kích hoạt lại khi QA/Art Director pass sau vòng sửa.
    if (node.phase === 'review' && labelType(thread, node.label) === LEAD) {
      const triage = graph.nodesFor(thread, node.label).find(item => item.phase === 'triage');
      if (triage && ['queued', 'running', 'blocked'].includes(graph.stateOf(thread, triage.id).status)) { state.status = 'idle'; log(thread, 'Tự động', `${graph.nodeLabel(node)} chờ vòng sửa (${graph.nodeLabel(triage)}) xong mới chạy.`); return; }
    }
    if (worker(thread, node.label).paused) { if (!state.pausedNoted) { state.pausedNoted = true; focus(thread, node, ''); note(thread, `${node.label} đang tạm dừng; dùng /role ${node.label} start để tiếp tục.`); } return; }
    delete state.pausedNoted;
    if (isRunning(thread, node.label)) return;
    if (isDevType(labelType(thread, node.label))) {
      let task = openTask(thread, node.label);
      if (!task && !hasLead(thread)) { task = freshTask(thread, node.label); (thread.dispatch ||= []).push(task); }
      if (!task) { graph.finish(thread, node.id, 'skipped'); log(thread, 'Tự động', `${node.label} không có task ở vòng này · bỏ qua.`); return; }
      if (task.status === 'pending') task.status = 'queued';
      state.status = 'running'; focus(thread, node); changed(); await pump(thread); return;
    }
    state.status = 'running'; state.startedAt = Date.now(); focus(thread, node);
    if (!state.waitNoted) log(thread, 'Tự động', 'Bắt đầu ' + graph.nodeLabel(node)); changed();
    try {
      const result = await send(thread, node.label, stageText(thread, node.label));
      if (result?.loginStarted) wait(thread, node, `${node.label} cần đăng nhập; đăng nhập rồi dùng /role ${node.label} start.`);
      else if (result === false) wait(thread, node, `Lượt ${node.label} bị hủy ở bước xác nhận; dùng /role ${node.label} start để chạy lại.`);
    } catch (error) {
      // Lỗi tạm thời (khối khác đang ghi cùng tệp, ví dụ QA và Art Director · review cùng ghi ISSUES.md; đủ phiên chat): nút về hàng chờ
      // và chạy khi lượt đang chạy xong (after → advance), thay vì bị chặn chờ người dùng.
      if (error.code === RETRY) {
        state.status = 'queued';
        if (!state.waitNoted) { state.waitNoted = true; log(thread, 'Tự động', `${graph.nodeLabel(node)} chờ lượt đang chạy xong rồi chạy: ${error.message}`); }
        // Tự thử lại: lượt kia xong nhưng CLI chưa thoát hẳn thì lần advance lúc đó vẫn gặp lỗi tạm thời và không còn sự kiện nào gọi lại.
        if (!state.retryTimer) { const timer = setTimeout(() => { delete state.retryTimer; if (active(thread) && graph.stateOf(thread, node.id).status === 'queued') advance(thread).catch(() => {}); }, RETRY_WAIT_MS); timer.unref?.(); Object.defineProperty(state, 'retryTimer', { value: timer, enumerable: false, configurable: true, writable: true }); }
        changed(); return;
      }
      block(thread, node, `Không chạy được ${node.label}: ${error.message}`);
    }
  }
  // Nút Dev/VFX/Art/Anim "running" mà khối không chạy và không còn task trong hàng (bị dừng giữa chừng, task bị kế hoạch mới bỏ,
  // app đóng khi đang chạy) làm QA và các bước sau chờ mãi. Đưa nút về đúng trạng thái theo task của khối:
  // còn task chờ hoặc vừa được kích hoạt lại → chờ chạy (không có task thì startNode bỏ qua); task xong → xong; bị chặn/lỗi/dừng → chặn.
  function settleStale(thread) {
    const graphNow = graph.ensureGraph(thread);
    for (const node of graphNow.nodes) {
      const state = graph.stateOf(thread, node.id);
      // Khối có task chờ nhưng nút chưa từng được kích hoạt: nút bước trước đã xong lúc khối chưa có trên sơ đồ (thêm khối/đặt lại sơ đồ
      // sau khi Lead giao việc). Không đưa vào hàng chờ thì task nằm "pending" mãi và các khối phụ thuộc (dependsOn) chờ theo.
      if (state.status === 'idle' && isDevType(labelType(thread, node.label)) && !isRunning(thread, node.label)
        && (thread.dispatch || []).some(task => task.worker === node.label && task.status === 'pending' && !task.artReject)
        && graph.incoming(graphNow, node.id).some(edge => { const from = graph.stateOf(thread, edge.from); return from.status === 'done' && graph.matches(edge.when, from.outcome); })) { graph.queue(thread, node.id); continue; }
      // Khối không phải Dev (QA, Lead, Art Director, Release…) "running" mà không còn phiên chat: CLI chết/lỗi trước khi bàn giao
      // (main.cjs handler 'error' chỉ xoá chats, hoặc handler 'close' ném lỗi trước after()). Chặn để Fixer xử lý thay vì đứng mãi.
      // Chờ STALE_RUN_MS: giữa lúc đặt running (startNode) và lúc chat mở thật (chats.set) có khoảng async.
      if (state.status === 'running' && !isDevType(labelType(thread, node.label)) && !isRunning(thread, node.label)
        && Date.now() - (state.startedAt || 0) > STALE_RUN_MS) {
        block(thread, node, `${node.label} dừng giữa chừng: phiên CLI đã kết thúc mà không bàn giao. Dùng /role ${node.label} start để chạy lại.`);
        continue;
      }
      if (state.status !== 'running' || !isDevType(labelType(thread, node.label)) || isRunning(thread, node.label)) continue;
      const tasks = (thread.dispatch || []).filter(task => task.worker === node.label);
      if (tasks.some(task => [...RUNNING_TASK, 'paused'].includes(task.status))) continue;
      if (state.again || tasks.some(task => task.status === 'pending' && !task.artReject)) { state.status = 'queued'; delete state.again; continue; }
      const stuck = tasks.find(task => ['blocked', 'failed', 'cancelled'].includes(task.status));
      if (stuck) block(thread, node, `${node.label} ${{ failed: 'lỗi', blocked: 'bị chặn', cancelled: 'đã bị dừng' }[stuck.status]}${stuck.error ? ': ' + stuck.error : ''}. Xử lý rồi dùng /role ${node.label} start (chạy tiếp task) hoặc Thử lại task bị chặn.`, stuck.status === 'failed' || /giới hạn|lỗi|error|treo|timeout/i.test(stuck.error || ''));
      else if (tasks.some(task => task.status === 'finished')) graph.finish(thread, node.id, 'done');
      else block(thread, node, `${node.label} đã dừng giữa chừng, không còn task; dùng /role ${node.label} start để chạy lại.`);
    }
  }
  // Chạy mọi nút sẵn sàng cho tới khi không còn gì đổi (nút bị bỏ qua kích hoạt tiếp nút sau ngay trong vòng lặp).
  async function advance(thread) {
    let startedAny = false;
    for (let guard = 0; guard < 100 && active(thread); guard++) {
      settleStale(thread);
      const next = graph.ready(thread); let moved = false;
      for (const node of next) { const before = graph.stateOf(thread, node.id).status; await startNode(thread, node); if (graph.stateOf(thread, node.id).status !== before) { moved = true; startedAny = true; } }
      if (!moved) break;
    }
    changed(); return startedAny;
  }
  // Nút ứng với lượt vừa xong của khối: nút đang chạy; nếu không (chạy tay), nút đang chờ/bị chặn/chưa chạy, ưu tiên đúng pha Lead.
  function nodeOfRun(thread, label) {
    const nodes = graph.nodesFor(thread, label), status = node => graph.stateOf(thread, node.id).status;
    return nodes.find(node => status(node) === 'running') || nodes.find(node => ['queued', 'blocked', 'idle'].includes(status(node)) && (!node.phase || node.phase === (thread[phaseKey(thread, label)] || 'planning'))) || nodes[0];
  }

  // Dev/QA bị chặn kèm reassign: ghi yêu cầu (prompt.cjs chèn vào lượt Lead) rồi chuyển sang Lead triage khi các Dev khác xong.
  function reassign(thread, node, label, handoff) {
    if ((thread.reassignRounds || 0) >= REASSIGN_LIMIT) return wait(thread, node, `${label} bị chặn và cần giao lại, nhưng đã tự chuyển Lead ${REASSIGN_LIMIT} lần trong vòng này; dừng để bạn quyết định. Lý do: ${handoff.summary || '(không ghi)'}`);
    graph.stateOf(thread, node.id).status = 'blocked'; graph.stateOf(thread, node.id).outcome = 'blocked';
    (thread.reassign ||= []).push({ worker: label, summary: handoff.summary || label + ' cần giao lại' });
    note(thread, `${label} bị chặn, cần khối khác làm tiếp · chuyển Lead triage để giao lại.`);
    routeReassign(thread);
  }
  // Còn Dev đang chạy thì đợi; task Dev chưa tới lượt bị huỷ vì Lead sẽ lập kế hoạch mới. Nút đang chờ (QA) không chạy trên phần dở.
  function routeReassign(thread) {
    if (!thread.reassign?.length || (thread.dispatch || []).some(task => RUNNING_TASK.includes(task.status))) return;
    const leadNodes = graph.ensureGraph(thread).nodes.filter(item => labelType(thread, item.label) === LEAD);
    const target = leadNodes.find(item => item.phase === 'triage') || leadNodes.find(item => item.phase === 'planning');
    if (!target) return note(thread, 'Không có nút Lead triage/lập kế hoạch trên sơ đồ; dừng để bạn giao lại task.');
    if ((thread.dispatch || []).some(task => task.status === 'paused')) return note(thread, 'Còn task đang tạm dừng; bỏ tạm dừng hoặc huỷ task đó để Lead giao lại.');
    for (const task of thread.dispatch || []) if (task.status === 'pending' && !ownedByAd(thread, task)) { task.status = 'cancelled'; task.error = 'Lead lập lại kế hoạch'; }
    for (const item of graph.ensureGraph(thread).nodes) if (item.id !== target.id && graph.stateOf(thread, item.id).status === 'queued') graph.stateOf(thread, item.id).status = 'idle';
    thread.reassignRounds = (thread.reassignRounds || 0) + 1; graph.queue(thread, target.id);
  }

  // Kế hoạch mới thay task chưa chạy của kế hoạch trước, nhưng nút của khối đó có thể vẫn "running" từ lần kích hoạt trước
  // (task cũ còn chờ trong hàng thì bị thay). finish() không kích hoạt lại nút đang running, nên task mới nằm "pending" mãi:
  // đưa thẳng vào hàng chờ; main.cjs pump sau lượt này.
  function queueStale(thread) {
    for (const task of thread.dispatch || []) {
      if (task.status !== 'pending' || task.artReject || isRunning(thread, task.worker)) continue;
      if (graph.nodesFor(thread, task.worker).some(item => graph.stateOf(thread, item.id).status === 'running')) task.status = 'queued';
    }
  }
  async function afterLead(thread, node, message, handoff, proposalApplied, planBlocked) {
    if (node.phase !== 'review') {
      if (proposalApplied) { graph.finish(thread, node.id, 'done'); queueStale(thread); return note(thread, 'Lead đã phân công; chạy Dev/VFX theo sơ đồ.'); }
      if (planBlocked) return block(thread, node, planBlocked);
      if (handoff?.status === 'blocked') return wait(thread, node, 'Lead Dev cần người dùng: ' + handoff.summary);
      if (!devLabels(thread).length && handoff?.status === 'done') { handedOff(thread, node.label, handoff.summary); return graph.finish(thread, node.id, 'done'); }
      return block(thread, node, `Lead Dev chưa xuất khối tasks hợp lệ${thread.planProblems ? ' (' + thread.planProblems + ')' : ''}; dừng tự động ở bước này.`);
    }
    if (!handoff) return block(thread, node, `${node.label} chưa xuất khối handoff hợp lệ; dừng tự động ở bước review.`);
    if (handoff.status === 'pass' || handoff.status === 'done') { handedOff(thread, node.label, handoff.summary || 'Review đạt'); note(thread, 'Lead review đạt.'); return graph.finish(thread, node.id, 'pass'); }
    if (handoff.status === 'reject') {
      if ((thread.reviewRejects || 0) >= REVIEW_RETRY_LIMIT) return wait(thread, node, `Review vẫn không đạt sau ${REVIEW_RETRY_LIMIT} lần sửa; dừng tự động để bạn quyết định. Mục chưa đạt: ${handoff.summary || '(không ghi)'}. Muốn sửa thêm một vòng: nhắn Lead Dev giao task sửa (Lead xuất khối tasks, app áp như triage rồi chạy tiếp); hoặc chấp nhận và chạy tiếp các bước sau.`);
      // Khối tasks có nhưng sai (định dạng, tệp…): không giao nguyên nhận xét cho mọi khối (fallback) và không tính lần sửa; Lead xuất lại.
      const problems = [], hasTasks = /```tasks/.test(message.text), planned = hasTasks ? taskPlan(message.text, thread, problems) : null;
      if (hasTasks && !planned) { thread.planProblems = problems.join('; '); return block(thread, node, `Lead review không đạt nhưng khối tasks không hợp lệ (${thread.planProblems}); chưa giao Dev và chưa tính lần sửa. Dùng /role ${node.label} start để Lead xuất lại tasks.`); }
      delete thread.planProblems;
      thread.reviewRejects = (thread.reviewRejects || 0) + 1; thread.qaPhase = 'functional';
      update(thread, 'review-reject', { text: handoff.summary || 'Review không đạt' });
      if (!devLabels(thread).length) return block(thread, node, 'Review không đạt nhưng không có Dev để sửa.');
      const tasks = planned || fallbackTasks(thread, handoff.summary || 'Review không đạt');
      thread.dispatch = tasks.map(task => ({ ...task, status: 'pending' })); recordTasks(thread, tasks, 'Review không đạt · sửa lần ' + thread.reviewRejects);
      return graph.finish(thread, node.id, 'reject');
    }
    return wait(thread, node, `Lead Dev cần người dùng: ${handoff.summary || handoff.status}`);
  }
  // Issue từ QA / Art Director · review / Release: vòng sửa đã được tính khi Lead triage đang chờ hoặc đang chạy thì không đếm thêm vòng fail.
  function reportIssue(thread, payload) {
    const triage = graph.ensureGraph(thread).nodes.find(item => item.phase === 'triage' && labelType(thread, item.label) === LEAD);
    update(thread, 'issue', { ...payload, sameRound: Boolean(triage) && ['queued', 'running'].includes(graph.stateOf(thread, triage.id).status) });
  }
  // QA và Art Director review chạy song song: một bên pass đã đưa Lead review vào hàng chờ, bên kia báo issue/reject thì Lead review
  // không được chạy trên phần đang sửa; bỏ hàng chờ, nó được kích hoạt lại khi cả hai pass ở vòng sau.
  function holdLeadReview(thread) {
    for (const item of graph.ensureGraph(thread).nodes) if (item.phase === 'review' && labelType(thread, item.label) === LEAD && graph.stateOf(thread, item.id).status === 'queued') graph.stateOf(thread, item.id).status = 'idle';
  }
  // Dev/VFX/Anim không ghép được ảnh Art Director đã duyệt (lệch UI/UX, thừa chi tiết, thiếu layer): theo cạnh reject của sơ đồ về
  // Art Director review lại. Task của khối giữ ở pending để chạy tiếp khi art xong; QA/Lead review đang chờ bỏ hàng chờ để không kiểm
  // trên phần dở (khối chạy lại xong sẽ kích hoạt lại chúng).
  function artRework(thread, node, label, task) {
    const { reason, art, summary } = task.artReject, why = `${label} báo ảnh không dùng được (${ART_REJECT_REASONS[reason]})${art.length ? ': ' + art.join(', ') : ''}`;
    if (!hasArtDirector(thread)) return wait(thread, node, `${why}, nhưng session không có Art Director. ${summary}`);
    if ((thread.artReworks || 0) >= AD_REJECT_LIMIT) return wait(thread, node, `${why}; đã trả Art Director ${AD_REJECT_LIMIT} lần trong vòng này, dừng để bạn quyết định. ${summary}`);
    if (!graph.outgoing(graph.ensureGraph(thread), node.id).some(edge => edge.when === 'reject')) return wait(thread, node, `${why}, nhưng sơ đồ chưa có cạnh ${label} —reject→ Art Director · review.`);
    thread.artReworks = (thread.artReworks || 0) + 1; task.artRouted = true; (thread.artRework ||= []).push({ worker: label, reason, art, summary });
    for (const item of graph.ensureGraph(thread).nodes) if ((labelType(thread, item.label) === 'QA' || (item.phase === 'review' && labelType(thread, item.label) === LEAD)) && graph.stateOf(thread, item.id).status === 'queued') graph.stateOf(thread, item.id).status = 'idle';
    note(thread, why + ' · chuyển Art Director review lại.');
    graph.finish(thread, node.id, 'reject');
  }
  // Art đã sửa xong (hoặc Art Director xác nhận art đạt, lỗi ở cách ghép): task chờ art chạy lại với ghi chú, phiên CLI mới để đọc ảnh mới.
  function resumeArtWaiters(thread, reason) {
    for (const task of thread.dispatch || []) {
      if (task.status !== 'pending' || !task.artRouted) continue;
      delete task.artReject; delete task.artRouted; delete task.session;
      task.task = clipText(task.task + '\n\n' + reason, TASK_LIMIT);
      for (const item of graph.nodesFor(thread, task.worker)) graph.queue(thread, item.id);
    }
    delete thread.artRework; delete thread.artRedo;
  }
  // Art Director pha planning: duyệt mockup UI/UX (reject → UI/UX sửa theo uiuxReview), viết ART.md và giao Art (main.cjs áp task).
  // Pha review: pass; reject kèm task Art làm lại (main.cjs đã áp); issue = lỗi visual do code/layout → Issue và Lead triage.
  function afterAd(thread, node, message, handoff, proposalApplied, planBlocked) {
    if (planBlocked) return block(thread, node, planBlocked);
    if (!handoff) return block(thread, node, `${node.label} chưa xuất khối handoff hợp lệ; dừng tự động. Trả lời ${node.label} hoặc dùng /role ${node.label} start.`);
    const summary = handoff.summary || handoff.status, tasksGiven = /```tasks/.test(message.text);
    if (handoff.status === 'blocked') return handoff.reassign && hasLead(thread) ? reassign(thread, node, node.label, handoff) : wait(thread, node, `${node.label} cần người dùng: ${summary}`);
    if (proposalApplied) queueStale(thread);
    if (tasksGiven && !proposalApplied) return block(thread, node, `${node.label} chưa xuất task Art hợp lệ (${thread.adPlanProblems || 'xem tin Điều phối'}); dừng tự động ở bước này.`);
    if (node.phase === 'planning') {
      if (handoff.status === 'reject') {
        if (!thread.flow.some(label => labelType(thread, label) === 'UI/UX')) return wait(thread, node, `${node.label} không duyệt mockup nhưng session không có UI/UX: ${summary}`);
        if ((thread.uiuxRejects || 0) >= AD_REJECT_LIMIT) return wait(thread, node, `${node.label} vẫn chưa duyệt mockup sau ${AD_REJECT_LIMIT} lần sửa; dừng để bạn quyết định. ${summary}`);
        thread.uiuxRejects = (thread.uiuxRejects || 0) + 1; thread.uiuxReview = summary; handedOff(thread, node.label, 'Chưa duyệt mockup: ' + summary);
        return graph.finish(thread, node.id, 'reject');
      }
      if (['done', 'pass'].includes(handoff.status)) { handedOff(thread, node.label, summary); return graph.finish(thread, node.id, 'done'); }
    } else {
      // Review lại do Dev trả ảnh: art đạt (lỗi ở cách ghép) thì khối chờ chạy lại kèm hướng dẫn, không đi tiếp tới Lead review.
      if (['done', 'pass'].includes(handoff.status) && thread.artRework?.length) {
        handedOff(thread, node.label, 'Review lại: art đạt · ' + summary); resumeArtWaiters(thread, 'Art Director review lại, art giữ nguyên; hướng dẫn ghép: ' + summary);
        Object.assign(graph.stateOf(thread, node.id), { status: 'done', outcome: 'pass' }); return;
      }
      if (['done', 'pass'].includes(handoff.status)) { handedOff(thread, node.label, summary); return graph.finish(thread, node.id, 'pass'); }
      if (handoff.status === 'issue') { delete thread.artRework; delete thread.artRedo; reportIssue(thread, { text: '[Visual · Art Director] ' + summary }); holdLeadReview(thread); return graph.finish(thread, node.id, 'issue'); }
      if (handoff.status === 'reject') {
        if (!tasksGiven) return block(thread, node, `${node.label} trả ảnh về nhưng không kèm khối tasks giao Art: ${summary}`);
        if ((thread.adRejects || 0) >= AD_REJECT_LIMIT) return wait(thread, node, `Ảnh vẫn chưa đạt sau ${AD_REJECT_LIMIT} lần Art làm lại; dừng để bạn quyết định. ${summary}`);
        thread.adRejects = (thread.adRejects || 0) + 1; handedOff(thread, node.label, 'Trả Art làm lại: ' + summary);
        if (thread.artRework?.length) thread.artRedo = true; // khối chờ art chạy lại khi Art xong phần làm lại này
        holdLeadReview(thread); return graph.finish(thread, node.id, 'reject');
      }
    }
    return block(thread, node, `Trạng thái handoff "${handoff.status}" không hợp lệ cho ${graph.nodeLabel(node)}.`);
  }
  // QA hai pha: chức năng (theo GDD/AC) → khi hết Issue và không có Issue mới mới sang performance (GC Alloc, CPU, GPU).
  function afterQa(thread, node, handoff) {
    if (handoff.status === 'issue') { reportIssue(thread, { text: handoff.summary || 'QA báo lỗi' }); holdLeadReview(thread); return graph.finish(thread, node.id, 'issue'); }
    if (handoff.status !== 'pass') return wait(thread, node, 'QA cần người dùng: ' + (handoff.summary || handoff.status));
    for (const item of handoff.retested) if (openIssues(thread).some(issue => issue.id === item.id)) update(thread, 'retest', { issue: item.id, text: item.evidence || handoff.summary || 'QA retest đạt' });
    if (openIssues(thread).length) return block(thread, node, `QA pass nhưng còn ${openIssues(thread).length} Issue chưa ghi retest; dừng tự động.`);
    if (thread.qaPhase !== 'performance' && !thread.tweak) { thread.qaPhase = 'performance'; graph.stateOf(thread, node.id).status = 'queued'; return note(thread, 'Hết Issue chức năng · QA chuyển sang kiểm performance.'); }
    thread.qaPassedAt = now(); thread.qaFailRounds = 0; handedOff(thread, node.label, handoff.summary || 'QA pass');
    return graph.finish(thread, node.id, 'pass');
  }
  // Release: pass → Hoàn tất; issue (build lỗi, vượt dung lượng…) → Issue và Lead triage giao sửa, rồi QA/review/Release chạy lại.
  function afterRelease(thread, node, handoff) {
    if (handoff.status === 'issue') { reportIssue(thread, { text: '[Release] ' + (handoff.summary || 'Release lỗi') }); return graph.finish(thread, node.id, 'issue'); }
    if (handoff.status === 'pass') { handedOff(thread, node.label, handoff.summary || 'Release đạt'); return graph.finish(thread, node.id, 'pass'); }
    return block(thread, node, `Trạng thái handoff "${handoff.status}" không hợp lệ cho ${node.label}; Release trả pass hoặc issue.`);
  }
  // Vòng mới: người dùng báo vấn đề rồi GD chốt khi luồng đã chạy. Xoá trạng thái vòng trước, giữ phiên CLI của các khối.
  // Không mở vòng mới khi còn task Dev đang chạy, để không có hai kế hoạch song song.
  async function newRoundFromGd(thread, node, handoff) {
    const busy = (thread.dispatch || []).filter(task => ['queued', 'starting', 'running'].includes(task.status));
    if (busy.length) return note(thread, `GD đã chốt thay đổi nhưng ${busy.map(task => task.worker).join(', ')} còn đang làm; đợi xong rồi dùng /chot ở bước GD để chạy vòng mới.`);
    if (!thread.auto?.enabled && !(await enable(thread, 'GD chốt thay đổi mới.'))) return;
    resetRound(thread);
    thread.dispatch = []; thread.round = (thread.round || 1) + 1; newRound(thread, thread.round, handoff.summary);
    focus(thread, node); handedOff(thread, node.label, handoff.summary || 'GD chốt thay đổi mới');
    const next = graph.finish(thread, node.id, 'done').map(id => graph.nodeLabel(graph.ensureGraph(thread).nodes.find(item => item.id === id)));
    note(thread, 'GD chốt thay đổi mới · mở vòng mới: ' + next.join(', ') + '.');
    return advance(thread);
  }
  async function startMilestone(thread) {
    resetRound(thread); thread.dispatch = []; thread.round = (thread.round || 1) + 1;
    const plan = thread.poPlan, milestone = plan.plan.milestones[plan.current];
    newRound(thread, thread.round, `Mốc ${plan.current + 1}: ${milestone.title}`);
    const nodes = graph.ensureGraph(thread).nodes, gd = nodes.find(item => labelType(thread, item.label) === 'GD'), owner = nodes.find(item => labelType(thread, item.label) === PO_TYPE);
    if (owner) graph.stateOf(thread, owner.id).status = 'done'; // PO đã lên kế hoạch; mốc mới bắt đầu từ GD
    thread.status = 'working'; note(thread, `Sang mốc ${plan.current + 1}/${plan.plan.milestones.length} của kế hoạch PO: ${milestone.title}.`);
    if (gd) graph.queue(thread, gd.id); else for (const item of graph.entries(graph.ensureGraph(thread))) graph.queue(thread, item.id);
    return advance(thread);
  }
  // Gọi sau mỗi lượt chat của một khối (main.cjs, sự kiện close).
  // planBlocked: kế hoạch Lead hợp lệ nhưng main.cjs chưa áp vì còn Dev đang chạy/tạm dừng (lý do để báo đúng).
  // Session đã Hoàn tất (sơ đồ cũ có thể đã tới bước kết thúc khi nhánh khác còn dở) mà khối đó vẫn có nút chưa xong: mở lại.
  function reopen(thread, label) {
    if (thread.status !== 'done' || !thread.auto?.enabled) return;
    if (!graph.nodesFor(thread, label).some(node => ['running', 'queued', 'blocked'].includes(graph.stateOf(thread, node.id).status))) return;
    thread.status = 'working'; const end = graph.stateOf(thread, graph.END); end.status = 'idle'; delete end.outcome;
    note(thread, `Mở lại chạy tự động: ${label} còn bước chưa xong trên sơ đồ.`);
  }
  async function after(thread, label, message, { proposalApplied = false, planBlocked = '' } = {}) {
    if (!label || !thread.flow.includes(label)) return;
    if (!graph.nodesFor(thread, label).length) return; // khối không có nút trên sơ đồ (Fixer)
    graph.ensureGraph(thread); reopen(thread, label);
    const handoff = parseHandoff(message.text), type = labelType(thread, label); let node = nodeOfRun(thread, label);
    const status = graph.stateOf(thread, node.id).status, gdDone = type === 'GD' && handoff?.status === 'done' && !message.error;
    // Sơ đồ vòng lặp (Lead review → GD): GD chạy sau khi review đạt cũng là mở vòng mới. Không xoá task của vòng trước thì task
    // bị chặn còn sót (Dev hết lượt tool) giữ phạm vi tệp, Art Director giao vòng sau bị báo "chồng tệp" và tự động dừng.
    const reviewPassed = Object.entries(graph.runOf(thread).nodes).some(([id, state]) => state.outcome === 'pass' && /@review$/.test(id) && labelType(thread, id.replace(/@review$/, '')) === LEAD);
    if (gdDone && started(thread) && (status !== 'running' || reviewPassed)) return newRoundFromGd(thread, node, handoff);
    if (!thread.auto?.enabled) {
      // Chạy tay: Lead phân công thì Dev chạy ngay như trước; GD chốt thiết kế = điểm bắt đầu chạy tự động.
      if (type === LEAD && proposalApplied) { for (const task of thread.dispatch || []) if (task.status === 'pending') task.status = 'queued'; changed(); }
      if (!gdDone || !(await enable(thread, 'GD đã chốt thiết kế.'))) return;
      graph.resetRun(thread); focus(thread, node);
    }
    if (!active(thread) || worker(thread, label).paused) return;
    // Lead phân công trong lúc nút Lead của pha đã xong (bạn gõ tay cho Lead, ví dụ giao lại sau khi Dev bị chặn): coi lượt này là
    // bước Lead của pha hiện tại để các Dev chạy theo sơ đồ; nếu không, task Lead vừa giao kẹt ở "chờ tới lượt" mãi.
    if (type === LEAD && proposalApplied && !['running', 'queued', 'blocked'].includes(graph.stateOf(thread, node.id).status)) {
      const nodes = graph.nodesFor(thread, label);
      node = nodes.find(item => item.phase === (thread.leadPhase || 'planning')) || nodes.find(item => item.phase === 'planning') || node;
      graph.stateOf(thread, node.id).status = 'running';
    }
    // Lượt chạy tay của khối không ở bước nào trên sơ đồ (nút chưa tới lượt hoặc đã xong) không làm đổi luồng.
    if (!['running', 'queued', 'blocked'].includes(graph.stateOf(thread, node.id).status) && !(gdDone && !started(thread))) return;
    try {
      if (isDevType(type)) {
        const rework = (thread.dispatch || []).find(item => item.worker === label && item.status === 'pending' && item.artReject && !item.artRouted);
        if (rework && !message.error) { artRework(thread, node, label, rework); return await advance(thread); }
        const task = (thread.dispatch || []).find(item => item.worker === label && item.status !== 'pending');
        if (task?.status === 'blocked' && handoff?.reassign && !message.error && hasLead(thread)) { reassign(thread, node, label, handoff); return await advance(thread); }
        if (task && ['blocked', 'failed'].includes(task.status)) return block(thread, node, `${label} ${task.status === 'failed' ? 'lỗi' : 'bị chặn'}${task.error ? ': ' + task.error : ''}. Xử lý rồi dùng /role ${label} start hoặc Thử lại task bị chặn.`, !(handoff?.status === 'blocked' && !message.error && !message.maxTurns) && task.status !== 'cancelled');
        if (task?.status === 'finished') graph.finish(thread, node.id, 'done');
        // Art/Anim làm lại xong mọi task Art Director giao: khối đang chờ art chạy tiếp (ảnh mới xem trong ART.md, CHANGES.md).
        const artOpen = (thread.dispatch || []).some(item => ownedByAd(thread, item) && !['finished', 'cancelled'].includes(item.status));
        if (task?.status === 'finished' && ownedByAd(thread, task) && thread.artRedo && !artOpen) resumeArtWaiters(thread, 'Art đã làm lại theo Art Director; xem mục ART-… trong ART.md và tệp mới trong CHANGES.md rồi ghép lại.');
        routeReassign(thread);
        return await advance(thread);
      }
      if (message.error) return block(thread, node, message.stopped ? `${label} đã bị bạn dừng; dùng /role ${label} start để chạy lại.` : `${label} lỗi hoặc bị dừng; dùng /role ${label} start để chạy lại.`, !message.stopped);
      focus(thread, node);
      if (type === LEAD) await afterLead(thread, node, message, handoff, proposalApplied, planBlocked);
      else if (type === ART_DIRECTOR) afterAd(thread, node, message, handoff, proposalApplied, planBlocked);
      else if (!handoff) block(thread, node, `${label} chưa xuất khối handoff hợp lệ; dừng tự động. Trả lời ${label} hoặc dùng /role ${label} start.`);
      else if (handoff.status === 'blocked' && handoff.reassign && type === 'QA' && hasLead(thread)) reassign(thread, node, label, handoff);
      else if (handoff.status === 'blocked') wait(thread, node, `${label} cần người dùng: ${handoff.summary}`);
      else if (type === 'QA') afterQa(thread, node, handoff);
      else if (type === RELEASE) afterRelease(thread, node, handoff);
      else if (['done', 'pass'].includes(handoff.status)) { if (type === 'UI/UX') delete thread.uiuxReview; handedOff(thread, label, handoff.summary); graph.finish(thread, node.id, handoff.status); }
      else block(thread, node, `Trạng thái handoff "${handoff.status}" không hợp lệ cho ${label}.`);
      return await advance(thread);
    } catch (error) { note(thread, 'Dừng tự động: ' + error.message); }
  }
  // Chạy tiếp theo sơ đồ. label: khối người dùng muốn chạy lại (/role X start) → đưa nút bị chặn/chưa chạy của khối vào hàng chờ.
  // Không có gì để chạy mà luồng chưa xong thì chạy nút của bước hiện tại.
  async function runStage(thread, label = '') {
    if (label) reopen(thread, label);
    if (!active(thread)) return false;
    graph.ensureGraph(thread);
    if (!started(thread)) for (const node of graph.entries(graph.ensureGraph(thread))) graph.queue(thread, node.id);
    if (label) { const node = nodeOfRun(thread, label); if (['blocked', 'idle', 'skipped', 'done'].includes(graph.stateOf(thread, node.id).status)) graph.queue(thread, node.id); }
    const busy = () => graph.ensureGraph(thread).nodes.some(node => ['queued', 'running'].includes(graph.stateOf(thread, node.id).status));
    if (!busy() && thread.flow[thread.stage]) graph.queue(thread, nodeOfRun(thread, thread.flow[thread.stage]).id);
    return advance(thread);
  }
  // Quyết định sau khi QA fail quá số vòng: tiếp tục → chạy nút đã chờ (Lead triage); chấp nhận → bỏ hàng chờ, sang review/Hoàn tất.
  async function decide(thread, choice) {
    if (choice === 'accept') {
      for (const node of graph.ensureGraph(thread).nodes) if (graph.stateOf(thread, node.id).status === 'queued') graph.stateOf(thread, node.id).status = 'idle';
      const review = graph.ensureGraph(thread).nodes.find(node => node.phase === 'review' && labelType(thread, node.label) === LEAD) || graph.ensureGraph(thread).nodes.find(node => node.id === graph.END);
      if (review) graph.queue(thread, review.id);
    }
    return choice === 'stop' ? false : advance(thread);
  }
  // /chot: người dùng chốt bước GD hiện tại và chạy tiếp tự động.
  async function chot(thread) {
    if (!thread.flow.length) throw Error('Session chưa có role');
    const label = thread.flow[thread.stage];
    if (isRunning(thread, label)) throw Error(`${label} đang chạy; đợi xong hoặc dùng /role ${label} pause`);
    if (!thread.auto?.enabled && !(await enable(thread, 'Người dùng chốt.'))) return false;
    if (labelType(thread, label) === 'GD') {
      const node = nodeOfRun(thread, label);
      if (started(thread) && graph.stateOf(thread, node.id).status !== 'running') { graph.resetRun(thread); thread.dispatch = []; }
      focus(thread, node); handedOff(thread, label, 'Người dùng chốt thiết kế GD.'); graph.finish(thread, node.id, 'done');
      await advance(thread); return true;
    }
    return runStage(thread);
  }
  // Vòng chỉnh sửa (team.cjs requestTweak đã ghi Issue [Chỉnh sửa] và chuyển Lead triage): chạy lại từ nút Lead triage →
  // khối được giao → QA/Art Director → Lead review; không qua GD, UI/UX, Art Director lập kế hoạch và Release.
  async function tweak(thread, summary = '') {
    if (!thread.auto?.enabled && !(await enable(thread, 'Yêu cầu chỉnh sửa.'))) return false;
    const triage = graph.ensureGraph(thread).nodes.find(node => node.phase === 'triage' && labelType(thread, node.label) === LEAD);
    if (!triage) { note(thread, 'Sơ đồ không có nút Lead triage; chạy khối phụ trách bằng tay để làm Issue [Chỉnh sửa].'); return false; }
    graph.resetRun(thread); thread.dispatch = []; thread.leadPhase = 'triage';
    for (const key of ['qaPhase', 'reviewRejects', 'planProblems', 'reassign', 'reassignRounds', 'artRework', 'artRedo', 'artReworks', 'adRejects']) delete thread[key];
    thread.round = (thread.round || 1) + 1; newRound(thread, thread.round, 'Chỉnh sửa: ' + summary);
    graph.queue(thread, triage.id); note(thread, 'Vòng chỉnh sửa: Lead triage giao khối phụ trách, rồi QA và Lead review; Release không tự chạy.');
    return advance(thread);
  }
  async function setAuto(thread, on) {
    if (!on) return disable(thread);
    if (!thread.flow.length) throw Error('Session chưa có role');
    if (!thread.auto?.enabled && !(await enable(thread, 'Người dùng bật tự động.'))) return false;
    return runStage(thread);
  }
  // Fixer kết luận cần giao lại: như khối tự báo blocked kèm reassign (chuyển Lead triage, có giới hạn số lần).
  async function reassignFor(thread, label, summary) { const node = nodeOfRun(thread, label); if (!node) return false; reassign(thread, node, label, { summary }); return advance(thread); }
  return { after, runStage, chot, setAuto, enable, decide, tweak, reassignFor };
}
module.exports = { parseHandoff, parseCommand, createAutoRun, fallbackTasks, freshDevTasks, approvalScope, HANDOFF_STATUSES };
