// Dọn tiến trình con còn sót sau khi một lượt CLI kết thúc (Windows).
// Lệnh Bash của khối hay bật dev server bằng `cmd &` rồi tắt bằng `kill $PID`; trên Git Bash lệnh đó chỉ dừng vỏ bash, server node
// sống tiếp, giữ cổng. Lượt QA sau bật server cùng cổng bị EADDRINUSE và vòng chờ "compiled" đứng hết 3 phút mỗi lần chạy
// (session PLA: 4 lần chạy × 3 phút chờ vô ích, 6 dev server mồ côi từ các lượt trước).
// Windows giữ ParentProcessId của tiến trình con kể cả khi cha đã thoát, nên sau khi CLI thoát vẫn lần ra được cây con của nó;
// CreationDate không sớm hơn lúc bắt đầu lượt để không giết nhầm tiến trình khác dùng lại PID cũ.
const { execFile } = require('node:child_process');
const path = require('node:path');

const system32 = file => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', file);
const LIST = '$ErrorActionPreference = "SilentlyContinue"; Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString(\'o\') })" }';

function processes() {
  return new Promise(resolve => execFile(system32('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', LIST], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
    if (error && !stdout) return resolve([]);
    resolve(String(stdout).split(/\r?\n/).map(line => line.trim().split('|')).filter(parts => parts.length === 3).map(([pid, ppid, created]) => ({ pid: Number(pid), ppid: Number(ppid), created: Date.parse(created) })).filter(item => item.pid > 0));
  }));
}
// Mọi hậu duệ của root được tạo từ lúc since (ms) trở đi; không gồm root.
function descendants(list, root, since) {
  const children = new Map();
  for (const item of list) { if (!children.has(item.ppid)) children.set(item.ppid, []); children.get(item.ppid).push(item); }
  const found = [], queue = [root], seen = new Set([root]);
  while (queue.length) {
    for (const item of children.get(queue.shift()) || []) {
      if (seen.has(item.pid) || !(item.created >= since - 1000)) continue;
      seen.add(item.pid); found.push(item.pid); queue.push(item.pid);
    }
  }
  return found;
}
// Giết các hậu duệ còn sống của root (đã thoát hoặc sắp thoát). Trả về danh sách PID đã giết.
async function killLeftovers(root, since) {
  if (process.platform !== 'win32' || !root) return [];
  const pids = descendants(await processes(), root, since);
  if (!pids.length) return [];
  await new Promise(resolve => execFile(system32('taskkill.exe'), ['/F', '/T', ...pids.flatMap(pid => ['/PID', String(pid)])], { windowsHide: true }, () => resolve()));
  return pids;
}
module.exports = { descendants, killLeftovers, processes };
