// UI: khi khối đang chạy (main gửi trạng thái liên tục), một lần click chuột thật vào session khác vẫn đổi được session.
// Trước đây sidebar dựng lại mỗi lần nhận trạng thái nên nút bị thay giữa lúc nhấn và nhả, click bị mất.
// Chạy: npx electron tests/ui-switch.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'switch-' + Date.now());
app.setPath('userData', userData); fs.mkdirSync(userData, { recursive: true });
const time = new Date().toISOString();
const thread = (id, title) => ({ id, model: 'claude-opus-5-5', title, project: '', pinned: false, stage: 0, status: 'working', flow: ['GD'], workers: { GD: { type: 'GD' } }, issues: [], folder: '', attachments: [],
  messages: [{ id: id + '0', role: 'Bạn', text: 'Yêu cầu ' + title, time }, { id: id + '1', role: 'GD', text: 'Đang chạy', time, streaming: true, progress: { started: time } }] });
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], threads: [thread('a', 'Session A'), thread('b', 'Session B'), thread('c', 'Session C')] } }));
require('../main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0], run = code => window.webContents.executeJavaScript(code);
  try {
    const state = await run(`window.office.run('state')`);
    let tick = 0; const timer = setInterval(() => { for (const item of state.team.threads) item.messages[1].text = 'Đang chạy ' + tick++; window.webContents.send('state', state); }, 20);
    const results = [];
    for (const title of ['Session A', 'Session C', 'Session B', 'Session A']) {
      const point = await run(`(() => { const rect = [...document.querySelectorAll('#groups .thread')].find(item => item.title === ${JSON.stringify(title)}).getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }; })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 }); await delay(120);
      window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 }); await delay(200);
      const shown = await run(`document.querySelector('#title').textContent`); results.push(title + '→' + shown);
      if (shown !== title) { clearInterval(timer); throw Error('one click did not switch: ' + results.join(' | ')); }
    }
    clearInterval(timer);
    console.log('UI switch passed: ' + results.join(' | '));
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
