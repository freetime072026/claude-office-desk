// Tệp .md làm "trí nhớ" chung thay cho lịch sử chat. Đặt trong thư mục chính của session:
//   .office-desk/PROJECT.md                 bản đồ project, Lead cập nhật, Dev đọc (dùng chung mọi session của project)
//   .office-desk/<session>/GDD.md           GD ghi; Lead (phần Dev) và QA đọc
//   .office-desk/<session>/UIUX.md          UI/UX ghi; Lead trích màn hình vào task Dev, QA đọc khi kiểm UI
//   .office-desk/<session>/TASKS.md         app ghi từ khối tasks hợp lệ của Lead
//   .office-desk/<session>/ISSUES.md        QA ghi; Lead đọc khi triage
//   .office-desk/<session>/PERF.md          QA ghi ở pha performance
//   .office-desk/<session>/CHANGES.md       app ghi từ handoff của Dev
const fs = require('node:fs'); const path = require('node:path');
const DIR = '.office-desk';
const SUMMARY_LIMIT = 1500;
const TEMPLATES = {
  gdd: '# GDD\n\n## Mục tiêu\n\n## Phạm vi / ngoài phạm vi\n\n## User Stories và AC\n<!-- US-1 … / AC-1.1 … có ID để QA kiểm -->\n\n## Phân việc theo khối\n<!-- UI/UX, Dev, VFX, QA nhận gì -->\n\n## VFX\n<!-- Hiệu ứng nào, cho sự kiện nào, cảm giác mong muốn, ảnh tham chiếu; "Không có" nếu không cần -->\n\n## Ngân sách performance\n<!-- GC Alloc, CPU, GPU, frame time; ghi "Không áp dụng" nếu không cần -->\n\n## Câu hỏi mở\n',
  project: '# PROJECT\n<!-- Lead cập nhật: thư mục, module, quy ước, tệp quan trọng. Ngắn gọn để Dev đọc thay vì dò cả project. -->\n',
  uiux: '# UIUX\n<!-- UI/UX ghi. Mỗi màn hình một mục có ID để Lead trích vào task Dev:\n## SCR-1 · Tên màn hình\nAC: AC-1.2\nLuồng vào/ra: …\nTrạng thái: bình thường, trống, lỗi, đang tải\nLayout và component: …\n-->\n',
  tasks: '# TASKS\n<!-- App ghi từ khối tasks của Lead. Không sửa tay khi đang chạy. -->\n',
  issues: '# ISSUES\n<!-- QA ghi. Mẫu:\n## ISS-1 · mở · cao\nAC: AC-1.2\nBước tái hiện: …\nKỳ vọng: …\nThực tế: …\n-->\n',
  perf: '# PERF\n<!-- QA ghi ở pha performance: ngân sách, cách đo, số đo, kết luận. -->\n',
  changes: '# CHANGES\n<!-- App ghi từ handoff của Dev: tệp đã sửa và lý do. -->\n'
};
const NAMES = { gdd: 'GDD.md', uiux: 'UIUX.md', tasks: 'TASKS.md', issues: 'ISSUES.md', perf: 'PERF.md', changes: 'CHANGES.md' };
function filesOf(thread) {
  if (!thread.folder) return null;
  const base = path.join(thread.folder, DIR), own = path.join(base, thread.id);
  return { project: path.join(base, 'PROJECT.md'), ...Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, path.join(own, name)])) };
}
// Tạo tệp còn thiếu (không ghi đè tệp đã có).
function ensureFiles(thread) {
  const files = filesOf(thread); if (!files) return null;
  for (const [key, file] of Object.entries(files)) { fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, TEMPLATES[key]); }
  return files;
}
const stamp = () => new Date().toISOString();
const clip = value => { const text = String(value || '').trim(); return text.length > SUMMARY_LIMIT ? text.slice(0, SUMMARY_LIMIT) + '…' : text; };
function appendChange(thread, role, status, summary) { const files = ensureFiles(thread); if (files) fs.appendFileSync(files.changes, `\n## ${stamp()} · ${role} · ${status}\n${clip(summary) || '(không có tóm tắt)'}\n`); }
// Ranh giới vòng (GD chốt thay đổi mới): ghi vào CHANGES.md để thay đổi các vòng không lẫn nhau; lịch sử cũ giữ nguyên.
function appendRound(thread, round, summary) { const files = ensureFiles(thread); if (files) fs.appendFileSync(files.changes, `\n# Vòng ${round} · ${stamp()}\n${clip(summary) || '(GD chốt thay đổi mới)'}\n`); }
// TASKS.md luôn phản ánh lượt phân công mới nhất; lượt cũ được giữ bên dưới để tra cứu.
function writeTasks(thread, tasks, reason) {
  const files = ensureFiles(thread); if (!files) return;
  const block = `\n## ${stamp()} · ${reason}\n` + tasks.map(task => `\n### ${task.worker}\nTệp được sửa: ${(task.files || []).join(', ') || '(không giới hạn)'}\n${task.dependsOn?.length ? 'Sau: ' + task.dependsOn.join(', ') + '\n' : ''}\n${task.task}\n`).join('');
  const previous = fs.readFileSync(files.tasks, 'utf8').replace(TEMPLATES.tasks, '');
  fs.writeFileSync(files.tasks, TEMPLATES.tasks + block + (previous.trim() ? '\n---\n' + previous : ''));
}
module.exports = { DIR, filesOf, ensureFiles, appendChange, appendRound, writeTasks, TEMPLATES };
