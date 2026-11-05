// Dev server của project PLA (nút ở khối PO): chạy một script dev trong package.json của thư mục chính, ghi lại địa chỉ localhost
// in ra trong log, mở địa chỉ đó trong trình duyệt và tắt cả cây tiến trình khi dừng hoặc khi app thoát. Mỗi session một server.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const LOG_LIMIT = 4000;
const SCRIPT_HINT = /dev|serve|start|preview|watch/i;
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?\/?[^\s'"`)\]]*/i;
const PORT_MIN = 1024, PORT_MAX = 65535;
// Bỏ mã màu ANSI trong log (webpack in màu) trước khi tìm URL.
const plain = text => String(text).replace(/\x1b\[[0-9;]*m/g, '');

// Script chạy được: mục trong package.json "scripts" có tên gợi ý dev server (dev, serve, start, preview, watch); dev đứng đầu.
function scripts(folder) {
  let pkg; try { pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); } catch { return []; }
  return Object.entries(pkg.scripts || {}).filter(([name]) => SCRIPT_HINT.test(name))
    .map(([name, command]) => ({ name, command: String(command).slice(0, 300) }))
    .sort((a, b) => (b.name === 'dev') - (a.name === 'dev'));
}
// Địa chỉ mở trong trình duyệt: URL đầu tiên server in ra (0.0.0.0 đổi thành localhost); chưa in thì localhost:<cổng đã chọn>.
function urlOf(log, port) {
  const match = URL_PATTERN.exec(plain(log));
  if (match) return match[0].replace('0.0.0.0', 'localhost').replace(/[.,;:]+$/, '');
  return port ? `http://localhost:${port}/` : '';
}
const validPort = port => port === '' || port === undefined || port === null || (Number.isInteger(Number(port)) && Number(port) >= PORT_MIN && Number(port) <= PORT_MAX);
// Lệnh chạy: npm run <script>; có cổng thì thêm "-- --port N" và biến PORT (playable-scripts, webpack-dev-server, vite đều nhận một trong hai).
function commandOf(script, port) {
  const args = ['run', script];
  if (port) args.push('--', '--port', String(port));
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

function createDevServers({ changed = () => {} } = {}) {
  const runs = new Map(); // threadId -> { child, script, port, url, log, startedAt, running, code }
  const state = id => { const run = runs.get(id); if (!run) return null; const { script, port, url, startedAt, running, code } = run; return { script, port, url, startedAt, running, code, log: run.log.slice(-1200) }; };
  function start(id, folder, script, port) {
    if (!folder) throw Error('Session chưa có thư mục chính');
    if (!scripts(folder).some(item => item.name === script)) throw Error(`package.json không có script "${script}"`);
    if (!validPort(port)) throw Error(`Cổng phải là số từ ${PORT_MIN} đến ${PORT_MAX}`);
    if (runs.get(id)?.running) throw Error('Dev server của session này đang chạy; dừng trước khi chạy lại');
    const { command, args } = commandOf(script, port ? Number(port) : 0);
    const child = spawn(command, args, { cwd: folder, env: { ...process.env, ...(port ? { PORT: String(port) } : {}), BROWSER: 'none', FORCE_COLOR: '0' }, shell: process.platform === 'win32', windowsHide: true });
    const run = { child, script, port: port ? Number(port) : 0, url: port ? `http://localhost:${port}/` : '', log: '', startedAt: new Date().toISOString(), running: true, code: null };
    const take = chunk => { run.log = (run.log + plain(chunk)).slice(-LOG_LIMIT); const found = urlOf(run.log, 0); if (found && found !== run.url) { run.url = found; changed(); } };
    child.stdout?.on('data', take); child.stderr?.on('data', take);
    child.on('exit', code => { run.running = false; run.code = code; changed(); });
    child.on('error', error => { run.running = false; run.log += '\n' + error.message; changed(); });
    runs.set(id, run); changed();
    return state(id);
  }
  // Tắt cả cây tiến trình (npm → node → webpack…): trên Windows kill() chỉ tắt npm.cmd, server con vẫn giữ cổng.
  function stop(id) {
    const run = runs.get(id); if (!run?.running) return false;
    const pid = run.child.pid;
    if (process.platform === 'win32' && pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    else try { process.kill(-pid); } catch { run.child.kill(); }
    return true;
  }
  const stopAll = () => { for (const id of runs.keys()) stop(id); };
  const all = () => Object.fromEntries([...runs.keys()].map(id => [id, state(id)]));
  return { start, stop, stopAll, state, all };
}
module.exports = { scripts, urlOf, commandOf, validPort, createDevServers };
