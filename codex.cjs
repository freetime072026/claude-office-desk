// Codex CLI cho chế độ sinh ảnh 'codex' của Art (prompt.cjs artCodexGuide). Thuần Node: không Electron.
// Codex lưu ảnh vào <CODEX_HOME>/generated_images (mặc định ~/.codex): Art luôn được đọc thư mục này (permissions.cjs).
const os = require('node:os');
const path = require('node:path');
const home = (env = process.env) => env.CODEX_HOME || path.join(os.homedir(), '.codex');
const imagesDir = (env = process.env) => path.join(home(env), 'generated_images');
const INSTALL_COMMAND = 'npm i -g @openai/codex';
const LOGIN_COMMAND = 'codex login';
// Lệnh mở cửa sổ đăng nhập: chưa cài thì cài trước. `codex login` tự mở trình duyệt để chọn Sign in with ChatGPT.
const loginCommand = installed => installed ? LOGIN_COMMAND : `${INSTALL_COMMAND} && ${LOGIN_COMMAND}`;

// installed: có lệnh codex; loggedIn: `codex login status` thoát mã 0; text: dòng đầu Codex in ra.
// exec (một chuỗi lệnh qua shell) để Windows tìm được codex.cmd của npm; args là hằng số trong tệp này, không lấy từ người dùng.
function status({ exec = require('node:child_process').exec } = {}) {
  const run = args => new Promise(resolve => exec(['codex', ...args].join(' '), { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => resolve({ ok: !error, text: String(stdout || stderr || error?.message || '').trim().split(/\r?\n/).filter(Boolean)[0] || '' })));
  return run(['--version']).then(version => {
    if (!version.ok) return { installed: false, loggedIn: false, version: '', text: 'Chưa cài Codex CLI' };
    return run(['login', 'status']).then(login => ({ installed: true, loggedIn: login.ok, version: version.text, text: login.text || (login.ok ? 'Đã đăng nhập' : 'Chưa đăng nhập') }));
  });
}

// Mở một cửa sổ console riêng để bạn thấy tiến trình cài/đăng nhập (OAuth chạy trong trình duyệt, app không chạm vào tài khoản).
function openLogin({ installed, spawn = require('node:child_process').spawn, platform = process.platform } = {}) {
  const command = loginCommand(installed);
  const child = platform === 'win32'
    ? spawn(`start "Codex login" cmd /k "${command}"`, { shell: true, detached: true, stdio: 'ignore', windowsHide: false })
    : platform === 'darwin'
      ? spawn('osascript', ['-e', `tell application "Terminal" to do script "${command}"`], { detached: true, stdio: 'ignore' })
      : spawn('x-terminal-emulator', ['-e', 'sh', '-c', `${command}; exec sh`], { detached: true, stdio: 'ignore' });
  child.on?.('error', () => {}); child.unref?.();
  return command;
}

// ---- Model chữ của Codex cho Art. Model này chỉ đọc lệnh vẽ (khối Art viết sẵn) rồi gọi công cụ tạo ảnh; chất lượng ảnh do công cụ
// tạo ảnh quyết định, nên mặc định chọn bậc rẻ nhất ("luna") + suy nghĩ low. Danh sách lấy từ cache Codex CLI tự tải theo tài khoản
// (<CODEX_HOME>/models_cache.json, chỉ mục visibility "list"): model trong config.toml không có trong danh sách thì Codex báo
// model_not_found (2026-11-12: config "gpt-5.5" do app Codex desktop ghi làm cả 3 khối Art bị chặn).
const DEFAULT_MODEL = 'gpt-5.6-luna', DEFAULT_EFFORT = 'low';
const EFFORTS = Object.freeze(['low', 'medium', 'high']);
const MODEL_RE = /^[a-z0-9][a-z0-9.-]{1,60}$/i;   // tên model đi vào lệnh shell của Art: chỉ chữ, số, dấu chấm, gạch nối
function models({ env = process.env, read = file => require('node:fs').readFileSync(file, 'utf8') } = {}) {
  try {
    const list = JSON.parse(read(path.join(home(env), 'models_cache.json'))).models || [];
    return list.filter(item => item && MODEL_RE.test(item.slug || '') && (item.visibility || 'list') === 'list')
      .map(item => ({ slug: item.slug, name: item.display_name || item.slug, description: String(item.description || '').slice(0, 120) }));
  } catch { return []; }
}
// Model dùng thật: model bạn chọn nếu còn trong danh sách; không thì luna đầu tiên (rẻ nhất), rồi model đầu danh sách.
// Chưa có cache (Codex chưa chạy lần nào) thì tin model đã chọn / mặc định.
function chooseModel(saved, list = []) {
  const chosen = MODEL_RE.test(saved || '') ? saved : '';
  if (!list.length) return chosen || DEFAULT_MODEL;
  if (chosen && list.some(item => item.slug === chosen)) return chosen;
  return (list.find(item => /-luna$/i.test(item.slug)) || list[0]).slug;
}
const chooseEffort = saved => EFFORTS.includes(saved) ? saved : DEFAULT_EFFORT;
// Cờ thêm vào `codex exec` của Art (prompt.cjs artCodexGuide).
const execFlags = ({ model = DEFAULT_MODEL, effort = DEFAULT_EFFORT } = {}) => `-m ${MODEL_RE.test(model) ? model : DEFAULT_MODEL} -c model_reasoning_effort=${EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT}`;

// ---- Hết hạn mức gói ChatGPT giữa chừng: khối Art trả handoff blocked kèm "quota":"codex" (prompt.cjs artCodexGuide), app hẹn giờ
// chạy lại task đó (main.cjs) thay vì để nó nằm chặn tới khi bạn bấm Thử lại. Giờ chạy lại lấy từ lời Codex, ví dụ
// "You've hit your usage limit … try again in 2 days 3 hours 4 minutes" hoặc "… try again at Nov 14th, 2026 2:30 PM" / "at 3:42 PM".
// Chỉ nhận câu Codex in ra (tiếng Anh). Không nhận "hạn mức": câu bàn giao blocked của Art luôn có "kiểm hạn mức gói ChatGPT" kể cả
// khi lỗi khác (vd model_not_found), trước đây app hiểu nhầm là hết hạn mức và hẹn chạy lại mỗi giờ một lỗi không tự hết.
const QUOTA_RE = /usage limit|hit your limit|rate limit|quota exceeded|insufficient_quota|try again (?:in|at) /i;
const NOT_QUOTA_RE = /model_not_found|invalid_request_error|not supported|not logged in|unauthorized/i;
const QUOTA_FALLBACK_MS = 60 * 60 * 1000;   // Codex không ghi giờ: thử lại sau 1 giờ (hết nữa thì hẹn tiếp)
const QUOTA_MARGIN_MS = 2 * 60 * 1000;      // chạy lại sau giờ Codex ghi một chút để hạn mức chắc chắn đã mở
const QUOTA_MAX_MS = 8 * 24 * 60 * 60 * 1000;
const isQuota = text => QUOTA_RE.test(String(text || '')) && !NOT_QUOTA_RE.test(String(text || ''));
const UNITS = { d: 86400000, day: 86400000, h: 3600000, hr: 3600000, hour: 3600000, m: 60000, min: 60000, minute: 60000, s: 1000, sec: 1000, second: 1000 };
function inDuration(text) {
  const match = /try again in\s+([^.\n]+)/i.exec(text); if (!match) return 0;
  let total = 0;
  for (const [, amount, unit] of match[1].matchAll(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)) total += Number(amount) * (UNITS[unit.toLowerCase().replace(/s$/, '')] || UNITS[unit.toLowerCase()] || 0);
  return total;
}
function atTime(text, now) {
  const match = /try again at\s+([^\n]+?)(?:\.(?:\s|$)|$)/i.exec(text); if (!match) return null;
  const value = match[1].replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const clock = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(value);
  if (clock) {
    let hours = Number(clock[1]) % (clock[3] ? 12 : 24); if (/pm/i.test(clock[3] || '')) hours += 12;
    const at = new Date(now); at.setHours(hours, Number(clock[2]), 0, 0); if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  const parsed = Date.parse(value); return Number.isNaN(parsed) ? null : new Date(parsed);
}
// Giờ chạy lại (Date) cho lỗi hết hạn mức; null nếu không phải lỗi hạn mức. hinted: retryAt khối Art ghi trong handoff (ISO).
function quotaRetryAt(text, { now = new Date(), hinted = '', flagged = false } = {}) {
  const value = String(text || '');
  // flagged: khối Art tự báo "quota":"codex". Lời Codex là lỗi khác (model không hỗ trợ, chưa đăng nhập) thì vẫn không hẹn.
  if (NOT_QUOTA_RE.test(value) || (!isQuota(value) && !hinted && !flagged)) return null;
  const sane = date => date && !Number.isNaN(date.getTime()) && date > now && date - now <= QUOTA_MAX_MS ? date : null;
  const span = inDuration(value);
  const at = sane(span ? new Date(now.getTime() + span) : null) || sane(atTime(value, now)) || sane(hinted ? new Date(hinted) : null);
  return new Date((at ? at.getTime() + QUOTA_MARGIN_MS : now.getTime() + QUOTA_FALLBACK_MS));
}

module.exports = { home, imagesDir, status, openLogin, loginCommand, isQuota, quotaRetryAt, models, chooseModel, chooseEffort, execFlags, MODEL_RE, EFFORTS, DEFAULT_MODEL, DEFAULT_EFFORT, INSTALL_COMMAND, LOGIN_COMMAND, QUOTA_FALLBACK_MS };
