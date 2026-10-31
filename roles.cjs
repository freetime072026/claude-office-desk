const defaults = {
  'UI/UX': { responsibility: 'Thiết kế luồng UI/UX theo GDD, US và AC; phối hợp GD và Lead, không tự thay gameplay đã chốt.', output: 'User flow, wireframe, cấu trúc màn hình, component/state, tương tác, accessibility và hướng dẫn bàn giao Dev.' },
  GD: { responsibility: 'Chỉ đọc. Giải quyết vấn đề đầu vào cùng người dùng, ghi GDD và chia việc cho các khối phía sau (UI/UX, Dev, QA). Đánh dấu giả định/câu hỏi chưa chốt. Không viết code.', output: 'GDD.md: mục tiêu, phạm vi, US/AC có ID, phân việc theo khối, ngân sách performance, câu hỏi mở.' },
  'Lead Dev': { responsibility: 'Chỉ nhận phần việc liên quan Dev. Chia task, lập phương án cho từng task và giao danh sách tệp không chồng nhau để các Dev sửa song song không xung đột. Nhận Issue thì lập lại kế hoạch sửa. Sau khi QA xác nhận hết vấn đề thì review code: clean, refactor code trùng lặp.', output: 'PROJECT.md (bản đồ project cho Dev), khối tasks có files/dependsOn, fix plan, kết quả review.' },
  Dev: { responsibility: 'Chỉ nhận task từ Lead Dev và chỉ sửa trong danh sách tệp được giao. Không cần đọc GDD. Không tự đổi AC hoặc tự xác nhận QA pass.', output: 'Thay đổi code trong phạm vi task, test, danh sách tệp đã sửa và lý do, cách kiểm.' },
  VFX: { responsibility: 'Dev chuyên hiệu ứng: chỉ nhận task từ Lead Dev và chỉ sửa trong danh sách tệp được giao. Đọc mục VFX trong GDD. Ưu tiên shader viết bằng code và script điều khiển hiệu ứng; tạo/sửa prefab, material, VFX Graph bằng script Editor thay vì sửa YAML/GUID bằng tay. Không tự đánh giá được bằng mắt: ghi rõ cần ảnh chụp hoặc kiểm tra trực quan nào.', output: 'Shader, script hiệu ứng, thông số particle/material trong phạm vi task, danh sách tệp đã sửa, cách xem hiệu ứng và chi phí ước tính (particle, overdraw, draw call).' },
  QA: { responsibility: 'Khi mọi Dev xong: kiểm theo GDD/AC, ghi lỗi vào ISSUES.md rồi chuyển Lead Dev. Khi hết Issue và không có Issue mới mới kiểm performance (GC Alloc, CPU, GPU) theo ngân sách trong GDD. Test hook/cheat chỉ ở Editor/Development Build. Không có công cụ thì báo chưa chạy.', output: 'ISSUES.md (ID, AC, bước tái hiện, kỳ vọng/thực tế), PERF.md (cách đo, số đo), kết quả retest.' }
};
// Nhãn Lead cũ (≤ 0.8) chỉ còn để đọc dữ liệu cũ và migrate; không nơi nào sinh nhãn này nữa.
const LEGACY_LEAD = Object.freeze(['Lead Planning', 'Lead Review']);
const roleKey = role => LEGACY_LEAD.includes(role) ? 'Lead Dev' : role;
// US-02: model mặc định khi tạo khối mới. GD và Lead cần suy luận nhiều; Dev/QA/UI/UX dùng model rẻ hơn.
const DEFAULT_MODELS = Object.freeze({ GD: 'claude-opus-5-5', 'Lead Dev': 'claude-opus-5-5' });
const FALLBACK_MODEL = 'sonnet';
// US-06: giới hạn số lượt tool trong một lượt chat (--max-turns).
const MAX_TURNS = Object.freeze({ GD: 30, 'Lead Dev': 30, Dev: 60, VFX: 60, QA: 40 });
// Loại khối làm việc như Dev: nhận task từ Lead (khối tasks), sửa trong phạm vi tệp, chạy song song trong vòng Dev.
const DEV_TYPES = Object.freeze(['Dev', 'VFX']);
const isDevType = type => DEV_TYPES.includes(type);
const DEFAULT_MAX_TURNS = 30;
module.exports = { defaults, roleKey, LEGACY_LEAD, DEFAULT_MODELS, FALLBACK_MODEL, MAX_TURNS, DEFAULT_MAX_TURNS, DEV_TYPES, isDevType };
