// Penpot (công cụ thiết kế mã nguồn mở) qua MCP chính thức @penpot/mcp: server chạy local, nối với editor qua plugin
// mở trong tab trình duyệt. Không giới hạn số lần gọi như Figma MCP. MCP luôn thao tác trên page đang focus và chỉ
// một tab dùng được, nên app chỉ cho một khối dùng Penpot tại một thời điểm.
const fs = require('node:fs');
const NAME = 'penpot';
const SERVER_URL = 'http://localhost:4401/mcp';
const PLUGIN_URL = 'http://localhost:4400/manifest.json';
const ROLES = Object.freeze(['UI/UX', 'Art Director', 'Art']);
const isPenpot = name => /penpot/i.test(String(name || ''));
const usesPenpot = servers => (servers || []).some(isPenpot);

const SETUP = [
  'Cách bật Penpot cho các khối:',
  '1. Mở terminal, chạy: npx -y @penpot/mcp@stable (cần Node.js 20+; để terminal chạy suốt lúc làm việc).',
  `2. Mở file thiết kế trên Penpot (design.penpot.app hoặc bản tự host) → Plugins → Load from URL → ${PLUGIN_URL} → chạy plugin, bấm "Connect to MCP server" tới khi báo Connected.`,
  '3. Giữ tab Penpot và cửa sổ plugin mở. Trình duyệt Chromium có thể hỏi quyền truy cập mạng local: cho phép; không được thì dùng Firefox.',
  `Server: ${SERVER_URL}. Đã bật cho ${ROLES.join(', ')} (đổi ở mục MCP của từng khối).`
].join('\n');

// Thêm server vào mcp-servers.json (không đè cấu hình sẵn có) và bật cho các role thiết kế. Trả về câu báo kết quả.
function install(file, team) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')); data.mcpServers ||= {};
  const existing = Object.keys(data.mcpServers).find(isPenpot), name = existing || NAME;
  if (!existing) { data.mcpServers[NAME] = { type: 'http', url: SERVER_URL }; fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  team.roleMcp ||= {}; for (const role of ROLES) team.roleMcp[role] = [...new Set([...(team.roleMcp[role] || []), name])];
  return (existing ? `mcp-servers.json đã có "${existing}".` : `Đã thêm "${NAME}" vào mcp-servers.json.`) + '\n' + SETUP;
}

// Hướng dẫn cho khối có Penpot (chèn vào brief). Ghi chú chung + phần theo role.
const COMMON = 'Penpot MCP (mcp__penpot__*): gọi penpot_api_info trước khi viết execute_code (API plugin Penpot, không phải Figma); high_level_overview để nắm file; export_shape để xem ảnh một board/shape. MCP thao tác trên page đang mở trong Penpot: tạo/sửa trong board đặt tên theo ID (SCR-…, ART-…), không xoá hay sửa board của ID khác. Tool báo chưa kết nối thì dừng và báo blocked: "mở Penpot và plugin MCP".';
const BY_ROLE = {
  'UI/UX': 'Dựng mockup mỗi màn hình SCR-… thành một board cùng tên trong Penpot (layout, kích thước px, trạng thái chính) và ghi tên page/board vào UIUX.md cạnh mục SCR đó.',
  'Art Director': 'Duyệt mockup bằng export_shape các board SCR-… trong Penpot; khi giao Art, ghi tên board SCR/ART làm tham chiếu kích thước, vị trí, màu.',
  Art: 'Lấy kích thước, màu, vị trí từ board SCR-…/ART-… được giao trong Penpot thay vì đoán; làm ảnh xong thì import_image đặt vào board ART-… cùng tên để Art Director xem.'
};
function guide(type) { return [COMMON, BY_ROLE[type] || ''].filter(Boolean).join(' '); }

module.exports = { NAME, SERVER_URL, PLUGIN_URL, ROLES, SETUP, isPenpot, usesPenpot, install, guide };
