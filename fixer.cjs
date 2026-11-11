// Khối Fixer: khi luồng tự động dừng ở một khối (bị chặn, lỗi CLI, chạm giới hạn lượt tool, treo, task đứng mãi trong hàng
// chờ vì trùng tệp đang ghi), app gọi Fixer với ngữ cảnh sự cố. Fixer đọc và chạy lệnh kiểm tra (không sửa code), tìm nguyên
// nhân, rồi xuất khối ```fix```; app làm theo: chạy tiếp đúng khối (kèm hướng dẫn), làm lại phiên mới, giao lại Lead triage,
// hoặc dừng chờ người dùng. Thuần: không đọc tệp, không Electron.
const { fenceBody } = require('./fence.cjs');
const FIXER = 'Fixer';
// complete: khối đã làm xong việc nhưng không bàn giao (CLI dừng/lỗi trước handoff, chạm giới hạn lượt sau khi xong) → app ghi bàn giao
// thay khối (status + message) và luồng chạy tiếp như khối vừa bàn giao.
const ACTIONS = Object.freeze(['continue', 'restart', 'complete', 'reassign', 'user']);
const COMPLETE_STATUSES = Object.freeze(['done', 'pass', 'issue', 'reject']);
const ATTEMPTS = 2; // mỗi khối tối đa 2 lần Fixer can thiệp trong một vòng; quá thì dừng chờ người dùng
const clip = (value, limit) => { const text = String(value ?? '').trim(); return text.length > limit ? text.slice(0, limit) + '…' : text; };
// Câu trả lời dài: giữ đầu (tóm tắt) và đuôi (khối tasks/handoff nằm cuối); lược ở giữa để Fixer không tưởng khối bị cụt.
const clipMiddle = (value, limit) => { const text = String(value ?? '').trim(); if (text.length <= limit) return text; const head = Math.floor(limit / 4); return text.slice(0, head) + `\n…[app lược ${text.length - limit} ký tự ở giữa]…\n` + text.slice(text.length - (limit - head)); };
const BRIEF_LIMIT = 11000;
// lane: sự cố ở bước của một nhánh (vd Art Director · review · Hero). Mỗi nhánh có lượt Fixer riêng: Art Director dùng hết lượt ở
// nhánh này (hoặc ở bước lập kế hoạch) không làm nhánh khác mất Fixer.
const keyOf = (thread, label, lane = '') => `${thread.round || 1}:${label}${lane ? '~' + lane : ''}`;
const attempts = (thread, label, lane = '') => thread.fixCounts?.[keyOf(thread, label, lane)] || 0;
const canFix = (thread, label, lane = '') => label !== FIXER && attempts(thread, label, lane) < ATTEMPTS;
function count(thread, label, lane = '') { (thread.fixCounts ||= {})[keyOf(thread, label, lane)] = attempts(thread, label, lane) + 1; }
// Ngữ cảnh gửi Fixer: khối, loại sự cố, lý do app ghi, task và phạm vi tệp, câu trả lời cuối và nhật ký bước của lượt cuối.
function brief(thread, incident) {
  const label = incident.label, task = (thread.dispatch || []).find(item => item.worker === label);
  const last = [...(thread.messages || [])].reverse().find(message => message.role === label && !message.streaming);
  const steps = (last?.steps || []).slice(-25).map(step => `- ${step.tool}${step.sub ? ' (subagent)' : ''}: ${clip(step.detail, 120)}${step.end ? (step.ok ? ' → ✓ ' : ' → ✗ ') + clip(step.result, 120) : ' → (không kết thúc)'}`);
  // Ô chat nhận tối đa 12000 ký tự: giữ tổng dưới BRIEF_LIMIT để lượt Fixer không bị từ chối.
  return clipMiddle([
    // Tên khối đứng riêng (Fixer chép vào target); nhánh ghi ở câu sau. Lần đếm đã được tính trước khi dựng brief (main.cjs scheduleFix).
    `Sự cố ở khối ${label}${incident.manual ? ' (bạn gọi Fixer)' : ` (lần ${Math.max(1, attempts(thread, label, incident.lane))}/${ATTEMPTS} trong vòng này)`}: ${incident.kind}.${incident.lane ? ` Bước của nhánh ${incident.lane} (target vẫn ghi đúng tên khối "${label}"; app tự chạy lại đúng bước của nhánh này).` : ''}`,
    'Lý do app ghi: ' + clip(incident.reason, 1500),
    task ? `Task của ${label} (${task.status}${task.error ? ', lỗi: ' + clip(task.error, 400) : ''}): ${clip(task.task, 2500)}\nTệp được giao: ${(task.files || []).join(', ') || '(không giới hạn)'}${task.dependsOn?.length ? '\nPhụ thuộc: ' + task.dependsOn.join(', ') : ''}` : (thread.workers?.[label]?.task ? 'Task của khối: ' + clip(thread.workers[label].task, 2500) : ''),
    last ? `Câu trả lời cuối của ${label}${last.maxTurns ? ' (chạm giới hạn lượt tool)' : last.error ? ' (lỗi)' : ''}:\n${clipMiddle(last.text, 5000)}` : `${label} chưa có lượt nào.`,
    steps.length ? 'Nhật ký các bước cuối:\n' + steps.join('\n') : '',
    incident.queue ? 'Hàng chờ hiện tại: ' + incident.queue : ''
  ].filter(Boolean).join('\n\n'), BRIEF_LIMIT);
}
// Bạn bấm chạy Fixer bằng tay: tìm sự cố đang mở để gửi kèm ngữ cảnh (không có thì Fixer chỉ nhận "thực hiện nhiệm vụ" và
// kết luận không được áp). Ưu tiên sự cố app ghi gần nhất nếu khối đó vẫn dừng; không thì nút sơ đồ/task đang bị chặn.
const STOPPED = ['blocked', 'failed', 'cancelled'];
function currentIncident(thread, nodes = []) {
  const runs = thread.graphRun?.nodes || {};
  const blockedNode = label => nodes.some(node => node.label === label && STOPPED.includes(runs[node.id]?.status));
  const blockedTask = label => (thread.dispatch || []).some(task => task.worker === label && STOPPED.includes(task.status));
  const stopped = label => label && label !== FIXER && (blockedNode(label) || blockedTask(label));
  const last = thread.lastIncident; if (last && stopped(last.label)) return last;
  const label = nodes.find(node => node.label !== FIXER && STOPPED.includes(runs[node.id]?.status))?.label
    || (thread.dispatch || []).find(task => task.worker !== FIXER && STOPPED.includes(task.status))?.worker;
  if (!label) return null;
  const said = [...(thread.messages || [])].reverse().find(message => ['Tự động', 'Điều phối'].includes(message.role) && String(message.text || '').startsWith(label))?.text || `${label} đang dừng.`;
  const plan = thread.planProblems && thread.flow?.includes(label) && thread.workers?.[label]?.type === 'Lead Dev' && !said.includes(thread.planProblems) ? ` App từ chối khối tasks: ${thread.planProblems}.` : '';
  return { label, kind: 'bị chặn', reason: said + plan };
}
// Đọc khối ```fix```. Trả về kết luận hoặc null (problems ghi lý do).
function parseFix(text, flow, problems = []) {
  const fail = reason => { problems.push(reason); return null; };
  const body = fenceBody(text, 'fix'); if (body === null) return fail('không có khối fix');
  let data; try { data = JSON.parse(body); } catch { return fail('JSON trong khối fix không đọc được'); }
  if (!ACTIONS.includes(data.action)) return fail(`action phải là một trong ${ACTIONS.join(', ')}`);
  // Fixer hay chép nguyên tên bước có nhánh/pha ("Art Director · nhánh Hero", "Art Director~Hero", "Lead Dev · review") vào target:
  // lấy phần tên khối có trong session (dài nhất trước, để "Art" không khớp "Art Director").
  const raw = String(data.target || '').trim(), named = [...flow].sort((a, b) => b.length - a.length).find(label => raw === label || raw.startsWith(label + ' ') || raw.startsWith(label + '~') || raw.startsWith(label + ' ·') || raw.startsWith(label + ' ('));
  const target = flow.includes(raw) ? raw : named || raw;
  if (data.action !== 'user' && (!flow.includes(target) || target === FIXER)) return fail(`target "${target}" không phải khối trong session`);
  if (data.action === 'complete' && !COMPLETE_STATUSES.includes(data.status)) return fail(`complete cần status là một trong ${COMPLETE_STATUSES.join(', ')} (kết quả khối đã làm xong)`);
  return { cause: clip(data.cause, 2000) || '(không ghi)', fix: clip(data.fix, 2000), action: data.action, target, message: clip(data.message, 4000), ...(data.action === 'complete' ? { status: data.status } : {}) };
}
const ACTION_NAMES = { continue: 'chạy tiếp', restart: 'làm lại phiên mới', complete: 'ghi nhận đã xong', reassign: 'giao lại Lead triage', user: 'cần người dùng' };
function entryMarkdown(incident, result) {
  return `\n## ${new Date().toISOString()} · ${incident.label} · ${incident.kind} → ${ACTION_NAMES[result.action]}${result.target && result.action !== 'user' ? ' ' + result.target : ''}\nNguyên nhân: ${result.cause}\n${result.fix ? 'Cách khắc phục: ' + result.fix + '\n' : ''}${result.message ? 'Hướng dẫn: ' + result.message + '\n' : ''}`;
}
const GUIDE = [
  'Bạn là Fixer: luồng tự động vừa dừng ở một khối. Tìm nguyên nhân thật (đọc nhật ký bước, tệp liên quan, chạy lệnh kiểm tra như git status/diff, xem log, bash .office-desk/unity.sh wait-compile nếu là project Unity) và cách khắc phục. Không sửa code, không chạy lệnh làm thay đổi project; ghi chẩn đoán vào FIXES.md nếu cần ghi dài.',
  'Bạn KHÔNG cần tự chạy khối hay sửa trạng thái app: app làm đúng hành động trong khối fix ngay khi bạn trả lời (chạy lại khối đang dừng/lỗi/kẹt, mở phiên mới, ghi nhận xong, giao lại Lead). Tiến trình bị bỏ lại (dev server, trình duyệt) giữ cổng/tệp thì tự tắt bằng lệnh (taskkill /PID … /T /F, kill) trước khi chọn hành động.',
  'Cách chọn hành động: complete = khối thật ra đã làm xong (kết quả đã ghi vào tệp, chỉ thiếu bàn giao vì CLI dừng/lỗi/chạm giới hạn lượt) → thêm "status" là kết quả khối đó lẽ ra bàn giao (done cho Dev/Lead/Art Director lập kế hoạch, pass hoặc issue cho QA/review, reject cho review không đạt) và message là tóm tắt kết quả; continue = khối làm tiếp phiên đang dở theo hướng dẫn của bạn (ví dụ chạm giới hạn lượt khi việc gần xong, lỗi compile đã rõ cách sửa, lệnh treo cần đổi cách gọi); restart = mở phiên mới cho khối (phiên cũ rối hoặc ngữ cảnh quá lớn); reassign = phương án/AC sai, cần tệp ngoài phạm vi hoặc cần khối khác làm → Lead triage lập lại; user = chỉ khi cần người dùng thật (đăng nhập, quyền, cài đặt máy/Unity, quyết định thiết kế), ghi rõ người dùng cần làm gì.',
  'message là hướng dẫn gửi thẳng khối target: cụ thể, làm được ngay (tệp, dòng, lệnh nên dùng/tránh). Không lặp lại cách đã thất bại.',
  `Cuối câu trả lời xuất khối fenced code nhãn fix chứa JSON {"cause":"nguyên nhân","fix":"cách khắc phục","action":"${ACTIONS.join('|')}","target":"tên khối chạy tiếp (thường là khối bị dừng; reassign thì là khối bị dừng)","message":"hướng dẫn cho khối target (complete: tóm tắt kết quả)","status":"chỉ với complete: done|pass|issue|reject"}.`
].join('\n');
module.exports = { FIXER, ACTIONS, COMPLETE_STATUSES, ATTEMPTS, BRIEF_LIMIT, currentIncident, canFix, count, attempts, brief, parseFix, entryMarkdown, GUIDE, ACTION_NAMES };
