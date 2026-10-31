// Bộ chạy tự động theo luồng GD → UI/UX → Lead Dev → Dev* → QA → (role tùy chỉnh) → Lead review.
// Chỉ chuyển bước theo khối ```handoff``` / ```tasks``` hợp lệ; không đoán từ văn bản tự do.
// Mọi thay đổi trạng thái team đi qua team.cjs (update) để giữ gate QA, giới hạn vòng và log.
const { LEAD, ACTIVE_TASK, labelType, worker, taskPlan, openIssues } = require('./workers.cjs');
const { isHalted } = require('./team.cjs');
const { foldersOf } = require('./usage.cjs');
const HANDOFF_STATUSES = Object.freeze(['done', 'blocked', 'issue', 'pass', 'reject']);
const ROLE_VERBS = Object.freeze(['start', 'pause']);
const SUMMARY_LIMIT = 4000;
// Lead review không đạt thì cho Dev sửa thêm đúng 1 lần; lần sau vẫn không đạt thì dừng chờ người dùng.
const REVIEW_RETRY_LIMIT = 1;
const TASK_LIMIT = 11000;
const clipText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const now = () => new Date().toISOString();
// Phạm vi đã được duyệt khi bật tự động: mode từng khối + thư mục. Đổi mode/thư mục thì lượt tự động phải hỏi lại (main.cjs).
function approvalScope(thread) {
  const folders = foldersOf(thread).map(folder => folder.toLowerCase()).sort();
  return JSON.stringify({ folders, modes: thread.flow.map(label => label + '=' + worker(thread, label).mode) });
}

function parseHandoff(text) {
  const blocks = [...String(text || '').matchAll(/```handoff\s*([\s\S]*?)```/g)]; if (!blocks.length) return null;
  let data; try { data = JSON.parse(blocks.at(-1)[1]); } catch { return null; }
  if (!data || typeof data !== 'object' || !HANDOFF_STATUSES.includes(data.status)) return null;
  const retested = Array.isArray(data.retested) ? data.retested.filter(item => item && typeof item.id === 'string').slice(0, 50).map(item => ({ id: item.id, evidence: clipText(item.evidence, SUMMARY_LIMIT) })) : [];
  return { status: data.status, summary: clipText(data.summary, SUMMARY_LIMIT), retested };
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

const devIndexes = thread => thread.flow.flatMap((label, index) => labelType(thread, label) === 'Dev' ? [index] : []);
const roundDone = thread => Boolean(thread.dispatch?.length) && thread.dispatch.every(task => task.status === 'finished');
const issueText = thread => openIssues(thread).map(issue => '- ' + issue.text).join('\n');
// Task sửa khi không có khối tasks hợp lệ: giao lại cho các Dev của lượt trước (hoặc Dev đầu tiên).
function fallbackTasks(thread, reason) {
  const devs = devIndexes(thread).map(index => thread.flow[index]);
  const previous = (thread.dispatch || []).filter(task => devs.includes(task.worker));
  const owners = previous.length ? previous.map(task => task.worker) : devs.slice(0, 1);
  return owners.map(owner => { const before = previous.find(task => task.worker === owner)?.task || worker(thread, owner).task || ''; return { worker: owner, task: clipText(['Sửa theo yêu cầu:', reason, before ? 'Task trước:\n' + before : ''].filter(Boolean).join('\n'), TASK_LIMIT) }; });
}
// Lượt Dev khi bước Dev bắt đầu mà không có phân công của Lead (session không có Lead hoặc vòng sửa không qua Lead).
function freshDevTasks(thread) {
  const issues = issueText(thread);
  return devIndexes(thread).map(index => { const label = thread.flow[index]; return { worker: label, task: clipText([worker(thread, label).task || 'Thực hiện yêu cầu session theo bàn giao trước.', issues ? 'Issue cần sửa:\n' + issues : ''].filter(Boolean).join('\n'), TASK_LIMIT), status: 'queued' }; });
}
function stageText(thread, label) {
  const phase = labelType(thread, label) === LEAD ? ` (pha ${thread.leadPhase || 'planning'})` : '';
  return `Tự động: thực hiện bước ${label}${phase} dựa trên bàn giao trước. Hoàn thành vai trò rồi xuất khối handoff ở cuối.`;
}

// deps: update(thread, action, payload), send(thread, label, text) → kết quả chat-send, pump(thread), log(thread, role, text),
// changed(), approve(thread) → Promise<boolean>, isRunning(thread, label) → boolean.
function createAutoRun(deps) {
  const { update, send, pump, log, changed, approve, isRunning, recordTasks = () => {} } = deps;
  const active = thread => Boolean(thread.auto?.enabled) && !isHalted(thread) && thread.status !== 'done';
  const note = (thread, text) => { log(thread, 'Tự động', text); changed(); };

  async function enable(thread, reason) {
    if (!(await approve(thread))) { note(thread, reason + ' Người dùng không xác nhận; giữ chạy thủ công.'); return false; }
    thread.auto = { enabled: true, approvedAt: now(), scope: approvalScope(thread) };
    note(thread, `${reason} Bật chạy tự động: ${thread.flow.slice(thread.stage).join(' → ')}.`); return true;
  }
  function disable(thread) { if (thread.auto) thread.auto.enabled = false; note(thread, 'Tắt chạy tự động; các lượt đang chạy vẫn tiếp tục tới khi xong.'); }
  function leaveDevs(thread) {
    const last = Math.max(...devIndexes(thread));
    if (last >= thread.flow.length - 1) { thread.status = 'done'; note(thread, 'Dev đã xong và không còn bước sau.'); return; }
    thread.stage = last + 1; thread.status = 'waiting';
  }
  async function startDevs(thread) {
    if (!(thread.dispatch || []).some(task => ACTIVE_TASK.includes(task.status))) thread.dispatch = freshDevTasks(thread);
    if (!thread.dispatch.length) { note(thread, 'Không có Dev để chạy.'); return false; }
    changed(); await pump(thread); return true;
  }
  async function runStage(thread) {
    if (!active(thread)) return false;
    const label = thread.flow[thread.stage]; if (!label) return false;
    if (worker(thread, label).paused) { note(thread, `${label} đang tạm dừng; dùng /role ${label} start để tiếp tục.`); return false; }
    if (isRunning(thread, label)) return false;
    if (thread.status === 'waiting') { thread.status = 'working'; log(thread, 'Tự động', 'Bắt đầu ' + label + (labelType(thread, label) === LEAD ? ' · pha ' + (thread.leadPhase || 'planning') : '')); }
    if (labelType(thread, label) === 'Dev') return startDevs(thread);
    changed();
    try {
      const result = await send(thread, label, stageText(thread, label));
      if (result?.loginStarted) note(thread, `${label} cần đăng nhập; đăng nhập rồi dùng /role ${label} start.`);
      else if (result === false) note(thread, `Lượt ${label} bị hủy ở bước xác nhận; dùng /role ${label} start để chạy lại.`);
    } catch (error) { note(thread, `Không chạy được ${label}: ${error.message}`); }
    changed(); return true;
  }
  async function afterLead(thread, label, message, handoff, proposalApplied) {
    if (thread.leadPhase !== 'review') {
      if (proposalApplied) { const first = devIndexes(thread)[0]; thread.stage = first; thread.status = 'working'; note(thread, 'Lead đã phân công; chạy Dev theo phụ thuộc.'); await pump(thread); return; }
      if (handoff?.status === 'blocked') return note(thread, 'Lead Dev cần người dùng: ' + handoff.summary);
      if (!devIndexes(thread).length && handoff?.status === 'done') { update(thread, 'handoff', { text: handoff.summary || 'Lead Dev hoàn tất', auto: true }); return runStage(thread); }
      return note(thread, 'Lead Dev chưa xuất khối tasks hợp lệ; dừng tự động ở bước này.');
    }
    if (!handoff) return note(thread, `${label} chưa xuất khối handoff hợp lệ; dừng tự động ở bước review.`);
    if (handoff.status === 'pass' || handoff.status === 'done') { update(thread, 'handoff', { text: handoff.summary || 'Review đạt', auto: true }); return note(thread, 'Lead review đạt · session hoàn tất.'); }
    if (handoff.status === 'reject') {
      if ((thread.reviewRejects || 0) >= REVIEW_RETRY_LIMIT) return note(thread, `Review vẫn không đạt sau ${REVIEW_RETRY_LIMIT} lần sửa; dừng tự động để bạn quyết định. Mục chưa đạt: ${handoff.summary || '(không ghi)'}`);
      thread.reviewRejects = (thread.reviewRejects || 0) + 1; thread.qaPhase = 'functional';
      update(thread, 'review-reject', { text: handoff.summary || 'Review không đạt' });
      if (!devIndexes(thread).length) return note(thread, 'Review không đạt nhưng không có Dev để sửa.');
      const tasks = taskPlan(message.text, thread) || fallbackTasks(thread, handoff.summary || 'Review không đạt');
      thread.dispatch = tasks.map(task => ({ ...task, status: 'queued' })); recordTasks(thread, tasks, 'Review không đạt · sửa lần ' + thread.reviewRejects); thread.status = 'working'; changed(); await pump(thread); return;
    }
    return note(thread, `Lead Dev cần người dùng: ${handoff.summary || handoff.status}`);
  }
  // QA hai pha: chức năng (theo GDD/AC) → khi hết Issue và không có Issue mới mới sang performance (GC Alloc, CPU, GPU).
  async function afterQa(thread, handoff) {
    if (handoff.status === 'issue') { update(thread, 'issue', { text: handoff.summary || 'QA báo lỗi' }); return runStage(thread); }
    if (handoff.status !== 'pass') return note(thread, 'QA cần người dùng: ' + (handoff.summary || handoff.status));
    for (const item of handoff.retested) if (openIssues(thread).some(issue => issue.id === item.id)) update(thread, 'retest', { issue: item.id, text: item.evidence || handoff.summary || 'QA retest đạt' });
    if (openIssues(thread).length) return note(thread, `QA pass nhưng còn ${openIssues(thread).length} Issue chưa ghi retest; dừng tự động.`);
    if (thread.qaPhase !== 'performance') { thread.qaPhase = 'performance'; thread.status = 'waiting'; note(thread, 'Hết Issue chức năng · QA chuyển sang kiểm performance.'); return runStage(thread); }
    update(thread, 'handoff', { text: handoff.summary || 'QA pass', auto: true }); return runStage(thread);
  }
  // Gọi sau mỗi lượt chat của một khối (main.cjs, sự kiện close).
  async function after(thread, label, message, { proposalApplied = false } = {}) {
    if (!label) return;
    const handoff = parseHandoff(message.text), type = labelType(thread, label), current = thread.flow[thread.stage] === label;
    if (!thread.auto?.enabled) {
      // GD chốt thiết kế = điểm bắt đầu chạy tự động.
      if (!(type === 'GD' && current && handoff?.status === 'done' && !message.error)) return;
      if (!(await enable(thread, 'GD đã chốt thiết kế.'))) return;
    }
    if (!active(thread) || worker(thread, label).paused) return;
    try {
      if (type === 'Dev') {
        const stuck = (thread.dispatch || []).find(task => task.worker === label && ['blocked', 'failed'].includes(task.status));
        if (stuck) return note(thread, `${label} ${stuck.status === 'failed' ? 'lỗi' : 'bị chặn'}${stuck.error ? ': ' + stuck.error : ''}. Xử lý rồi dùng /role ${label} start hoặc Thử lại task bị chặn.`);
        if (devIndexes(thread).includes(thread.stage) && roundDone(thread)) { leaveDevs(thread); await runStage(thread); }
        return;
      }
      if (!current) return;
      if (message.error) return note(thread, `${label} lỗi hoặc bị dừng; dùng /role ${label} start để chạy lại.`);
      thread.status = 'working';
      if (type === LEAD) return await afterLead(thread, label, message, handoff, proposalApplied);
      if (!handoff) return note(thread, `${label} chưa xuất khối handoff hợp lệ; dừng tự động. Trả lời ${label} hoặc dùng /role ${label} start.`);
      if (handoff.status === 'blocked') return note(thread, `${label} cần người dùng: ${handoff.summary}`);
      if (type === 'QA') return await afterQa(thread, handoff);
      if (['done', 'pass'].includes(handoff.status)) { update(thread, 'handoff', { text: handoff.summary || label + ' hoàn tất', auto: true }); return await runStage(thread); }
      return note(thread, `Trạng thái handoff "${handoff.status}" không hợp lệ cho ${label}.`);
    } catch (error) { note(thread, 'Dừng tự động: ' + error.message); }
  }
  // /chot: người dùng chốt bước GD hiện tại và chạy tiếp tự động.
  async function chot(thread) {
    if (!thread.flow.length) throw Error('Session chưa có role');
    const label = thread.flow[thread.stage];
    if (isRunning(thread, label)) throw Error(`${label} đang chạy; đợi xong hoặc dùng /role ${label} pause`);
    if (!thread.auto?.enabled && !(await enable(thread, 'Người dùng chốt.'))) return false;
    if (labelType(thread, label) === 'GD') { thread.status = 'working'; update(thread, 'handoff', { text: 'Người dùng chốt thiết kế GD.', auto: true }); }
    await runStage(thread); return true;
  }
  async function setAuto(thread, on) {
    if (!on) return disable(thread);
    if (!thread.flow.length) throw Error('Session chưa có role');
    if (!thread.auto?.enabled && !(await enable(thread, 'Người dùng bật tự động.'))) return false;
    return runStage(thread);
  }
  return { after, runStage, chot, setAuto, enable };
}
module.exports = { parseHandoff, parseCommand, createAutoRun, fallbackTasks, freshDevTasks, approvalScope, HANDOFF_STATUSES };
