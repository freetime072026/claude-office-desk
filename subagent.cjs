// Subagent dò/đọc code chạy bằng model rẻ trong ngữ cảnh riêng: đọc nhiều tệp nhưng chỉ trả bản tóm tắt ngắn,
// nên ngữ cảnh chính của Lead/Dev/VFX/QA (gửi lại ở mỗi lần gọi model) không phình theo số tệp đã đọc.
const READER = 'code-reader';
const READER_MODEL = 'haiku';
const definition = {
  [READER]: {
    description: 'Dò và đọc code, trả về tóm tắt ngắn: tệp/dòng liên quan, hàm/lớp chính, cách các phần nối với nhau. Dùng trước khi tự đọc nhiều tệp hoặc tệp lớn.',
    prompt: 'Bạn là trợ lý đọc code chỉ đọc. Tìm bằng Grep/Glob, đọc đúng đoạn cần (Read với offset/limit). Trả lời ngắn gọn, tối đa khoảng 300 từ: đường dẫn kèm số dòng, tên hàm/lớp, trích đoạn code ngắn khi thật cần. Không đoán; chưa tìm thấy thì nói rõ.',
    tools: ['Read', 'Grep', 'Glob'],
    model: READER_MODEL
  }
};
const agentsArg = () => JSON.stringify(definition);
// Ép lời gọi Agent về đúng subagent đọc code, model rẻ, chạy chờ kết quả (print mode không chờ được agent chạy nền).
const readerCall = (input = {}) => ({ ...input, subagent_type: READER, model: READER_MODEL, run_in_background: false });
const GUIDE = `Cần dò hoặc đọc nhiều tệp/tệp lớn thì gọi tool Agent với subagent_type "${READER}" và câu hỏi cụ thể; subagent đọc trong ngữ cảnh riêng và trả tóm tắt. Chỉ tự Read đoạn cần sửa.`;
module.exports = { READER, READER_MODEL, agentsArg, readerCall, GUIDE };
