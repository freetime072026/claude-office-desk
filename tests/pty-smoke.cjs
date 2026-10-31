const pty = require('node-pty');
const path = require('node:path');
const powershell = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const terminal = pty.spawn(powershell, ['-NoProfile', '-Command', "Write-Output 'OFFICE_PTY_OK'"], { cols: 80, rows: 24, env: process.env, cwd: process.cwd() });
let output = '';
const deadline = setTimeout(() => { terminal.kill(); process.exit(1); }, 15000);
terminal.onData(data => { output += data; });
terminal.onExit(({ exitCode }) => { clearTimeout(deadline); const passed = exitCode === 0 && output.includes('OFFICE_PTY_OK'); console.log(passed ? 'PTY smoke passed' : 'PTY smoke failed'); process.exit(passed ? 0 : 1); });
