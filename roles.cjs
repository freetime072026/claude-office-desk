const defaults = {
  'UI/UX': { responsibility: 'Thiết kế luồng UI/UX theo GDD, US và AC; phối hợp GD và Lead, không tự thay gameplay đã chốt.', output: 'User flow, wireframe, cấu trúc màn hình, component/state, tương tác, accessibility và hướng dẫn bàn giao Dev.' },
  GD: { responsibility: 'Làm rõ yêu cầu game, thiết kế tính năng và lập kế hoạch. Đánh dấu giả định/câu hỏi chưa chốt.', output: 'Design, User Stories (US), Acceptance Criteria (AC) có ID và tiêu chí kiểm thử.' },
  'Lead Dev': { responsibility: 'Brainstorm phương án, chọn kiến trúc, chia task, phân tích Issue. Review correctness, clean code và duplicate code sau QA.', output: 'Phương án kỹ thuật, task/dependency, fix plan, kết quả code review và yêu cầu QA retest khi code thay đổi.' },
  Dev: { responsibility: 'Triển khai task đã giao, bổ sung test và tài liệu. Không tự thay AC hoặc tự xác nhận QA pass.', output: 'Thay đổi code, test, mô tả diff/revision và hướng dẫn kiểm thử.' },
  QA: { responsibility: 'Kiểm thử theo GD/US/AC; đo CPU/GPU/frame time thật. Test hook/cheat chỉ ở Editor/Development Build. Không có công cụ thì báo chưa chạy.', output: 'Test cases, kết quả/evidence, số đo performance, Issue có repro và lịch sử retest.' }
};
// Nhãn Lead cũ (≤ 0.8) chỉ còn để đọc dữ liệu cũ và migrate; không nơi nào sinh nhãn này nữa.
const LEGACY_LEAD = Object.freeze(['Lead Planning', 'Lead Review']);
const roleKey = role => LEGACY_LEAD.includes(role) ? 'Lead Dev' : role;
module.exports = { defaults, roleKey, LEGACY_LEAD };
