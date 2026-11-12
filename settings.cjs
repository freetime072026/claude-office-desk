// Dữ liệu cho hộp Settings (nút ⚙ cạnh menu tài khoản): tab Connectors (MCP server trong mcp-servers.json), Skills (skill của app
// và của dự án) và Plugins (Codex, RIFE, ComfyUI: trạng thái lấy từ codex.cjs, rife.cjs, comfyui.cjs). Thuần Node: không Electron.
const { isPenpot } = require('./penpot.cjs');

// Một dòng mỗi MCP server: loại (stdio = chạy lệnh trên máy, http/sse = server qua URL) và chi tiết ngắn (lệnh hoặc host).
// Không gửi env/headers ra giao diện (có thể chứa token).
function mcpEntries(data, roleMcp = {}) {
  const servers = data && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers) ? data.mcpServers : {};
  return Object.entries(servers).map(([name, server]) => {
    const url = typeof server?.url === 'string' ? server.url : '';
    const type = server?.type || (url ? 'http' : 'stdio');
    let detail = '';
    if (url) { try { detail = new URL(url).host; } catch { detail = url.slice(0, 60); } }
    else if (typeof server?.command === 'string') detail = [server.command, ...(Array.isArray(server.args) ? server.args : [])].join(' ').slice(0, 80);
    const roles = Object.entries(roleMcp || {}).filter(([, names]) => Array.isArray(names) && names.includes(name)).map(([role]) => role);
    return { name, type: String(type), detail, roles, penpot: isPenpot(name) };
  }).sort((first, second) => first.name.localeCompare(second.name));
}

// Mục Khám phá: những thứ Office Desk cài được bằng một nút. Connector: Penpot (thêm vào mcp-servers.json, bật cho UI/UX, Art Director, Art).
// Skill: bộ skill chính thức của Anthropic (repo tin cậy, vẫn qua kiểm tra của skill-import.cjs).
const DISCOVER_CONNECTORS = Object.freeze([
  { id: 'penpot', name: 'Penpot', type: 'http', description: 'Thiết kế UI mã nguồn mở: UI/UX dựng mockup, Art Director duyệt, Art lấy kích thước/màu từ board.' },
]);
const DISCOVER_SKILLS = Object.freeze([
  { id: 'anthropics-skills', name: 'Anthropic Skills', repo: 'anthropics/skills', url: 'https://github.com/anthropics/skills', description: 'Bộ skill chính thức của Anthropic (tài liệu, bảng tính, slide, thiết kế…). Cài xong tự bật cho khối cần dùng.' },
]);

module.exports = { mcpEntries, DISCOVER_CONNECTORS, DISCOVER_SKILLS };
