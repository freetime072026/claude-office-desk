// Mô tả ngắn (2–3 câu): gửi lại ở mọi lượt của Lead/Dev/VFX/QA. Không lặp phần app tự chèn (tệp .md, phạm vi ghi, handoff).
const defaults = {
  'UI/UX': { responsibility: 'Thiết kế luồng màn hình và trạng thái theo AC. Không đổi gameplay, không viết code.', output: 'Mỗi màn hình có luồng vào/ra, các trạng thái (bình thường, trống, lỗi, đang tải) và thông số layout cho Dev. Xong khi mỗi AC liên quan UI có màn hình và trạng thái tương ứng.' },
  GD: { responsibility: 'Làm rõ yêu cầu với người dùng tới khi không còn câu hỏi mở. Chốt phạm vi và chia việc cho UI/UX, Dev, VFX, QA. Không viết code, không chọn giải pháp kỹ thuật.', output: 'US/AC có ID và kiểm được (có số, có điều kiện; tránh "mượt", "đẹp"), mục VFX, ngân sách performance, câu hỏi mở. Xong khi mọi AC đều kiểm được và không còn câu hỏi mở.' },
  'Lead Dev': { responsibility: 'Chỉ nhận phần kỹ thuật. Chọn phương án, chia task tự hoàn thành và kiểm được, tệp của các task không chồng nhau. Triage Issue thành kế hoạch sửa; review sau khi QA xác nhận. Không tự sửa code của Dev.', output: 'PROJECT.md ngắn và đúng hiện trạng; mỗi task có phương án, AC liên quan, tệp được sửa, phụ thuộc; review ghi đạt/không đạt theo file:line. Xong khi mọi AC đã có task phụ trách.' },
  Dev: { responsibility: 'Làm đúng task, đúng tệp được giao. Không refactor ngoài task, không đổi AC, không tự xác nhận QA pass. Cần sửa tệp ngoài phạm vi thì báo trong handoff để Lead giao lại.', output: 'Code chạy được, có test cho logic chính nếu project có test; handoff liệt kê tệp, lý do và cách kiểm. Xong khi build/compile không lỗi và đã tự kiểm theo AC của task.' },
  VFX: { responsibility: 'Làm hiệu ứng theo mục VFX và ảnh tham chiếu, trong tệp được giao. Ưu tiên shader viết bằng code và script Editor thay vì sửa YAML/GUID tay. Không đổi gameplay.', output: 'Hiệu ứng kèm cách xem và chi phí ước tính (particle, overdraw, draw call). Xong khi có đủ cách xem và chi phí để người dùng hoặc QA đánh giá được.' },
  QA: { responsibility: 'Kiểm theo AC, không kiểm theo cảm nhận; mỗi lỗi một Issue tái hiện được. Không sửa code. Không có công cụ để kiểm thì báo "chưa kiểm được", không đoán là pass. Test hook/cheat chỉ ở Editor/Development Build.', output: 'Bảng AC với đạt/không đạt và bằng chứng; Issue gồm ID, AC, các bước, kỳ vọng/thực tế; pha performance ghi số đo so với ngân sách. Xong khi mọi AC đều có kết quả kèm bằng chứng.' }
};
// Nhãn Lead cũ (≤ 0.8) chỉ còn để đọc dữ liệu cũ và migrate; không nơi nào sinh nhãn này nữa.
const LEGACY_LEAD = Object.freeze(['Lead Planning', 'Lead Review']);
const roleKey = role => LEGACY_LEAD.includes(role) ? 'Lead Dev' : role;
// US-02: model mặc định khi tạo khối mới. GD và Lead cần suy luận nhiều; Dev/QA/UI/UX dùng model rẻ hơn.
const DEFAULT_MODELS = Object.freeze({ GD: 'claude-opus-5-5', 'Lead Dev': 'claude-opus-5-5' });
const FALLBACK_MODEL = 'sonnet';
// Khối làm code/test mặc định Đọc & sửa: sửa tệp được giao và chạy lệnh (hỏi từng lần). Role khác theo mode của session.
const DEFAULT_MODES = Object.freeze({ Dev: 'edit', VFX: 'edit', QA: 'edit' });
// Role được chạy shell trong phạm vi của mình ở mọi mode (permissions.roleScope đặt bash: true).
const SHELL_TYPES = Object.freeze(['Lead Dev', 'Dev', 'VFX', 'QA']);
// US-06: giới hạn số lượt tool trong một lượt chat (--max-turns).
// Dev/VFX 40: lượt dài làm ngữ cảnh phình, chi phí tăng nhanh hơn số lượt (session BaseTD: 60 lượt, ~150k token mỗi lần gọi).
const MAX_TURNS = Object.freeze({ GD: 30, 'Lead Dev': 30, Dev: 40, VFX: 40, QA: 40 });
// Loại khối làm việc như Dev: nhận task từ Lead (khối tasks), sửa trong phạm vi tệp, chạy song song trong vòng Dev.
const DEV_TYPES = Object.freeze(['Dev', 'VFX']);
const isDevType = type => DEV_TYPES.includes(type);
const DEFAULT_MAX_TURNS = 30;
// Ngưỡng tự compact của CLI (--autocompact, 100k–1M): người dùng chọn 1M để một pha dài không bị compact giữa chừng.
// Mỗi lượt gọi vẫn gửi lại toàn bộ ngữ cảnh (đọc từ cache), nên phiên càng dài mỗi lượt càng tốn.
const AUTOCOMPACT_WINDOW = '1m';
module.exports = { defaults, roleKey, LEGACY_LEAD, DEFAULT_MODELS, FALLBACK_MODEL, DEFAULT_MODES, SHELL_TYPES, MAX_TURNS, DEFAULT_MAX_TURNS, AUTOCOMPACT_WINDOW, DEV_TYPES, isDevType };
