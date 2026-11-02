// Tệp .md làm "trí nhớ" chung thay cho lịch sử chat. Đặt trong thư mục chính của session:
//   .office-desk/PROJECT.md                 bản đồ project, Lead cập nhật, Dev đọc (dùng chung mọi session của project)
//   .office-desk/STYLE.md                   style guide, ngân sách texture; Art Director ghi, Art/UI/UX đọc (dùng chung project)
//   .office-desk/MISSING_SOUNDS.md          âm thanh GDD cần mà project chưa có; Dev ghi khi dùng sound tạm, Sound làm và đánh dấu (dùng chung project)
//   .office-desk/ASSETS.md                  tài nguyên common và quy ước thư mục theo feature; Art Director ghi
//   .office-desk/<session>/ART_PROMPTS.md   prompt sinh ảnh Art viết để người dùng dán vào ChatGPT; ảnh lưu vào <session>/inbox/
//   .office-desk/<session>/ART.md           đặc tả từng ảnh (ART-…); Art Director ghi, Art đọc mục của task
//   .office-desk/<session>/GDD.md           GD ghi; Lead (phần Dev) và QA đọc
//   .office-desk/<session>/UIUX.md          UI/UX ghi; Lead trích màn hình vào task Dev, QA đọc khi kiểm UI
//   .office-desk/<session>/TASKS.md         app ghi từ khối tasks hợp lệ của Lead
//   .office-desk/<session>/ISSUES.md        QA ghi; Lead đọc khi triage
//   .office-desk/<session>/PERF.md          QA ghi ở pha performance
//   .office-desk/<session>/CHANGES.md       app ghi từ handoff của Dev
//   .office-desk/<session>/RELEASE.md       Release ghi: phiên bản, lệnh build, tệp đầu ra, dung lượng, checklist gửi
const fs = require('node:fs'); const path = require('node:path');
const DIR = '.office-desk';
const SUMMARY_LIMIT = 1500;
const TEMPLATES = {
  gdd: '# GDD\n\n## Mục tiêu\n\n## Phạm vi / ngoài phạm vi\n\n## User Stories và AC\n<!-- US-1 … / AC-1.1 … có ID để QA kiểm -->\n\n## Phân việc theo khối\n<!-- UI/UX, Dev, VFX, Art, Anim, Sound, QA nhận gì -->\n\n## VFX\n<!-- Hiệu ứng nào, cho sự kiện nào, cảm giác mong muốn, ảnh tham chiếu; "Không có" nếu không cần -->\n\n## Art\n<!-- Sprite/icon/ảnh UI cần làm: ID, kích thước, phong cách, ảnh tham chiếu; "Không có" nếu không cần -->\n\n## Anim\n<!-- Animation nào, cho unit/sự kiện nào, cảm giác, timing, tham chiếu; "Không có" nếu không cần -->\n\n## Sound\n<!-- SFX/nhạc nào, cho sự kiện nào, cảm giác, độ dài, loop, tham chiếu; "Không có" nếu không cần -->\n\n## Ngân sách performance\n<!-- GC Alloc, CPU, GPU, frame time; ghi "Không áp dụng" nếu không cần -->\n\n## Câu hỏi mở\n',
  style: '# STYLE\n<!-- Art Director ghi. Style guide đo được: bảng màu (hex), tỉ lệ nhân vật/cỡ sprite theo ô, nét viền, ánh sáng, đổ bóng; UI: font, cỡ chữ, khoảng cách, trạng thái nút; ảnh tham chiếu chuẩn. Ngân sách: kích thước texture tối đa, nén, atlas. -->\n',
  assets: '# ASSETS\n<!-- Art Director ghi. Tài nguyên dùng chung (UI/icon common): đường dẫn, dùng ở đâu. Quy ước: common ở thư mục chung, tài nguyên theo feature ở thư mục của feature; đặt tên; atlas. -->\n',
  art: '# ART\n<!-- Art Director ghi. Mỗi ảnh/màn một mục:\n## ART-1 · Tên (SCR-… / item trong GDD)\nCách vẽ, khung, decor, hoạ tiết, bảng màu: …\nKích thước px, pivot, 9-slice, trạng thái: …\nDùng lại (ASSETS.md) hay mới, đường dẫn tệp: …\nẢnh tham chiếu: …\nAnimation một mục ANIM-…: clip, số frame, fps, thời lượng, pose chính, frame có event, loop, tham chiếu.\n-->\n',
  missingSounds: '# MISSING SOUNDS\n<!-- Dev/VFX/Anim ghi khi code cần âm thanh mà project chưa có tệp; Sound làm rồi đổi trạng thái. Mẫu:\n## SND-1 · thiếu · Tên âm thanh\nKey/đường dẫn đích: sfx_tower_shoot → Assets/Audio/SFX/tower_shoot.wav\nĐang dùng tạm: Assets/Audio/Default/click.wav\nChỗ gọi: Scripts/Tower.cs:42 (sự kiện bắn)\nYêu cầu: cảm giác, độ dài, loop, mono/stereo, âm lượng tương đối, tham chiếu\nSession: … · ngày: …\n-->\n',
  artPrompts: '# ART PROMPTS\n<!-- Art ghi. Đầu tệp: Style prompt chung (dán đầu mọi prompt để ảnh cùng style). Mỗi ảnh một mục:\n## ART-1 · chờ ảnh · Tên\nLưu ảnh vào: .office-desk/<session>/inbox/ART-1.png\nẢnh tham chiếu upload kèm: …\nPrompt (dán vào ChatGPT):\n…\nSau khi nhận: kích thước cuối, pivot, đường dẫn đích\n-->\n',
  project: '# PROJECT\n<!-- Lead cập nhật: thư mục, module, quy ước, tệp quan trọng. Ngắn gọn để Dev đọc thay vì dò cả project. -->\n',
  uiux: '# UIUX\n<!-- UI/UX ghi. Mỗi màn hình một mục có ID để Lead trích vào task Dev:\n## SCR-1 · Tên màn hình\nAC: AC-1.2\nLuồng vào/ra: …\nTrạng thái: bình thường, trống, lỗi, đang tải\nLayout và component: …\n-->\n',
  tasks: '# TASKS\n<!-- App ghi từ khối tasks của Lead. Không sửa tay khi đang chạy. -->\n',
  issues: '# ISSUES\n<!-- QA ghi. Mẫu:\n## ISS-1 · mở · cao\nAC: AC-1.2\nBước tái hiện: …\nKỳ vọng: …\nThực tế: …\n-->\n',
  perf: '# PERF\n<!-- QA ghi ở pha performance: ngân sách, cách đo, số đo, kết luận. -->\n',
  changes: '# CHANGES\n<!-- App ghi sau mỗi lượt Dev: tệp tạo mới/sửa (app tự lấy từ tool và git), rồi tóm tắt handoff của Dev. -->\n',
  release: '# RELEASE\n<!-- Release ghi mỗi lần build bản gửi. Mẫu:\n## <phiên bản> · <ngày> · đạt | lỗi\nCommit: … (sạch / có thay đổi chưa commit)\nLệnh: …\n| Tệp | Đích (network/store) | Dung lượng | Giới hạn | Kết quả |\nChecklist trước khi gửi: …\n-->\n'
};
const NAMES = { artPrompts: 'ART_PROMPTS.md', art: 'ART.md', gdd: 'GDD.md', uiux: 'UIUX.md', tasks: 'TASKS.md', issues: 'ISSUES.md', perf: 'PERF.md', changes: 'CHANGES.md', release: 'RELEASE.md' };
function filesOf(thread) {
  if (!thread.folder) return null;
  const base = path.join(thread.folder, DIR), own = path.join(base, thread.id);
  return { project: path.join(base, 'PROJECT.md'), style: path.join(base, 'STYLE.md'), assets: path.join(base, 'ASSETS.md'), missingSounds: path.join(base, 'MISSING_SOUNDS.md'), ...Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, path.join(own, name)])) };
}
// Tạo tệp còn thiếu (không ghi đè tệp đã có).
function ensureFiles(thread) {
  const files = filesOf(thread); if (!files) return null;
  for (const [key, file] of Object.entries(files)) { fs.mkdirSync(path.dirname(file), { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, TEMPLATES[key]); }
  return files;
}
const stamp = () => new Date().toISOString();
const clip = value => { const text = String(value || '').trim(); return text.length > SUMMARY_LIMIT ? text.slice(0, SUMMARY_LIMIT) + '…' : text; };
// changed: danh sách tệp app tự ghi (file-changes.cjs), đặt trước tóm tắt của Dev để Lead/QA tra nhanh.
function appendChange(thread, role, status, summary, changed = '') { const files = ensureFiles(thread); if (files) fs.appendFileSync(files.changes, `\n## ${stamp()} · ${role} · ${status}\n${changed ? changed + '\n' : ''}${clip(summary) || '(không có tóm tắt)'}\n`); }
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
