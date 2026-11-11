// Penpot (công cụ thiết kế mã nguồn mở) qua MCP chính thức @penpot/mcp: server chạy local, nối với editor qua plugin
// mở trong tab trình duyệt. Không giới hạn số lần gọi như Figma MCP. MCP luôn thao tác trên page đang focus và chỉ
// một tab dùng được, nên app chỉ cho một khối gọi Penpot tại một thời điểm (createLock). Khối có bước duyệt từng
// thao tác (CLI mode default/plan: mọi khối trong luồng) chỉ giữ khoá trong chuỗi gọi Penpot liền nhau (chat.cjs LOCK_LEASE_MS),
// nên nhiều Art vẽ song song và chỉ xếp hàng ở phần dùng Penpot; lượt không có bước duyệt (Auto, Bypass của chat thường) giữ khoá cả lượt.
const fs = require('node:fs');
const NAME = 'penpot';
const SERVER_URL = 'http://localhost:4401/mcp';
const PLUGIN_URL = 'http://localhost:4400/manifest.json';
const ROLES = Object.freeze(['UI/UX', 'Art Director', 'Art']);
const isPenpot = name => /penpot/i.test(String(name || ''));
const usesPenpot = servers => (servers || []).some(isPenpot);

const SETUP = [
  'Cách bật Penpot cho các khối:',
  '1. Chạy server: bấm ▶ Chạy Penpot MCP trong ô "MCP server của role" của khối có tích Penpot (panel khối → Cấu hình → Trách nhiệm & yêu cầu riêng), hoặc mở terminal chạy: npx -y @penpot/mcp@stable (cần Node.js 20+; để chạy suốt lúc làm việc).',
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
const COMMON = 'Penpot MCP (mcp__penpot__*): gọi penpot_api_info trước khi viết execute_code (API plugin Penpot, không phải Figma); high_level_overview để nắm file; export_shape để xem ảnh một board/shape. MCP thao tác trên page đang mở trong Penpot: tạo/sửa trong board đặt tên theo ID (SCR-…, ART-…), không xoá hay sửa board của ID khác. Tab Penpot dùng chung với các khối khác, page đang mở có thể đổi giữa hai lượt của bạn: tìm board bằng penpotUtils.findShape/findShapeById (tìm mọi page), không dựa vào penpot.root hay penpot.selection; trước khi tạo shape hoặc import_image, kiểm penpot.currentPage là page chứa board của bạn, khác thì penpot.openPage(page) rồi mới tạo; shape vừa tạo appendChild ngay vào board ID của bạn; export_shape truyền id board, không dùng "page"/"selection"; làm liền các lần gọi Penpot của một việc, không chen lệnh khác vào giữa (app giữ Penpot cho bạn tới khi bạn gọi tool khác). Tool báo chưa kết nối thì dừng và báo blocked: "mở Penpot và plugin MCP".';
const BY_ROLE = {
  'UI/UX': 'Dựng mockup mỗi màn hình SCR-… thành một board cùng tên trong Penpot (layout, kích thước px, trạng thái chính) và ghi tên page/board vào UIUX.md cạnh mục SCR đó.',
  'Art Director': 'Duyệt mockup bằng export_shape các board SCR-… trong Penpot; khi giao Art, ghi tên board SCR/ART làm tham chiếu kích thước, vị trí, màu.',
  Art: 'Lấy kích thước, màu, vị trí từ board SCR-…/ART-… được giao trong Penpot thay vì đoán; làm ảnh xong thì import_image đặt vào board ART-… cùng tên để Art Director xem.'
};
function guide(type) { return [COMMON, BY_ROLE[type] || ''].filter(Boolean).join(' '); }

// CLI chỉ gửi yêu cầu duyệt (can_use_tool) cho tool chưa được cho phép sẵn ở mode default/plan; Auto và Bypass tự quyết.
const perCall = cliMode => ['default', 'plan'].includes(cliMode);

// Khoá dùng chung: chủ là một lượt (run = id tin), giữ một hoặc nhiều key (tool_use_id; '*' = cả lượt); lượt khác xếp hàng theo
// thứ tự đến. Cùng lượt vào lại được ngay: CLI gửi tool_result của các lần gọi song song trong một tin chung sau khi cả loạt xong,
// nên bắt lần gọi thứ hai chờ lần thứ nhất trả kết quả sẽ khoá chết lượt.
function createLock() {
  let owner = null; const queue = [];
  const grant = item => { (owner ||= { run: item.run, label: item.label, keys: new Set() }).keys.add(item.key); item.resolve(); };
  const next = () => {
    if (owner || !queue.length) return;
    const run = queue[0].run;
    for (let index = 0; index < queue.length;) if (queue[index].run === run) grant(queue.splice(index, 1)[0]); else index++;
  };
  return {
    holder: () => owner && { run: owner.run, label: owner.label },
    waiting: () => queue.length,
    // Lượt giữ khoá cả lượt không chen trước các lần gọi đang chờ.
    tryAcquire(run, label) { if (owner || queue.length) return false; owner = { run, label, keys: new Set(['*']) }; return true; },
    acquire(run, key, label) {
      return new Promise((resolve, reject) => {
        const item = { run, key, label, resolve, reject };
        if (owner?.run === run || !owner && !queue.length) grant(item); else queue.push(item);
      });
    },
    release(run, key) { if (owner?.run !== run) return; owner.keys.delete(key); if (!owner.keys.size) { owner = null; next(); } },
    // Lượt kết thúc/bị huỷ: trả khoá nó đang giữ và bỏ các lần gọi của nó còn chờ (để không giữ khoá cho tiến trình đã chết).
    releaseRun(run, reason = 'Lượt đã kết thúc.') {
      for (let index = queue.length - 1; index >= 0; index--) if (queue[index].run === run) queue.splice(index, 1)[0].reject(Error(reason));
      if (owner?.run === run) owner = null;
      next();
    }
  };
}

// ---- Server Penpot MCP chạy từ app (nút trong panel khối khi role có tích Penpot): `npx -y @penpot/mcp@stable`, dùng chung cả app.
// Cổng 4401 đã có server (bạn chạy ở terminal) thì không chạy thêm bản thứ hai. Tắt cả cây tiến trình khi dừng hoặc khi app thoát.
const SERVER_PORT = 4401, START_COMMAND = 'npx -y @penpot/mcp@stable';
function portOpen(port = SERVER_PORT, host = '127.0.0.1', timeout = 800) {
  return new Promise(resolve => {
    const socket = require('node:net').connect({ port, host });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeout, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false));
  });
}
function createServer({ changed = () => {}, spawn = require('node:child_process').spawn, execFile = require('node:child_process').execFile, probe = portOpen } = {}) {
  let run = null; // { child, log, startedAt, running, code, external }
  const state = () => run && { running: run.running, external: Boolean(run.external), startedAt: run.startedAt, code: run.code, log: run.log.slice(-1500), command: START_COMMAND, plugin: PLUGIN_URL };
  async function start() {
    if (run?.running) return state();
    if (await probe()) { run = { log: `Cổng ${SERVER_PORT} đã có server Penpot MCP đang chạy (ngoài app).`, startedAt: new Date().toISOString(), running: true, code: null, external: true }; changed(); return state(); }
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', '@penpot/mcp@stable'], { shell: process.platform === 'win32', windowsHide: true, env: { ...process.env, FORCE_COLOR: '0' } });
    run = { child, log: '', startedAt: new Date().toISOString(), running: true, code: null, external: false };
    const take = chunk => { run.log = (run.log + String(chunk).replace(/\x1b\[[0-9;]*m/g, '')).slice(-4000); changed(); };
    child.stdout?.on('data', take); child.stderr?.on('data', take);
    child.on('exit', code => { run.running = false; run.code = code; changed(); });
    child.on('error', error => { run.running = false; run.log += '\n' + error.message; changed(); });
    changed(); return state();
  }
  function stop() {
    if (!run?.running) return false;
    if (run.external) { run.running = false; changed(); return true; } // server ngoài app: chỉ thôi theo dõi, không tắt hộ
    const pid = run.child.pid;
    if (process.platform === 'win32' && pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    else try { process.kill(-pid); } catch { run.child.kill(); }
    return true;
  }
  return { start, stop, state };
}

module.exports = { SERVER_PORT, START_COMMAND, portOpen, createServer, NAME, SERVER_URL, PLUGIN_URL, ROLES, SETUP, isPenpot, usesPenpot, perCall, createLock, install, guide };
