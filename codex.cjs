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

module.exports = { home, imagesDir, status, openLogin, loginCommand, INSTALL_COMMAND, LOGIN_COMMAND };
