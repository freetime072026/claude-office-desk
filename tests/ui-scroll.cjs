// UI: đổi qua lại giữa các session thì khung chat luôn ở tin cuối, kể cả khi ảnh trong tin tải sau làm khung cao thêm.
// Chạy: npx electron tests/ui-scroll.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'scroll-' + Date.now());
app.setPath('userData', userData);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const attach = path.join(userData, 'attachments', 'b'); fs.mkdirSync(attach, { recursive: true });
const image = path.join(attach, 'shot.png'); fs.writeFileSync(image, Buffer.from(png, 'base64'));
const text = n => Array.from({ length: n }, (_, i) => 'Dòng nội dung dài số ' + i).join('\n');
const thread = (id, title, count, withImages) => ({ id, model: 'claude-opus-5-5', title, project: '', pinned: false, stage: 0, status: 'waiting', flow: ['GD'], workers: { GD: { type: 'GD' } }, issues: [], folder: '', attachments: [],
  messages: Array.from({ length: count }, (_, i) => ({ id: id + i, role: i % 2 ? 'GD' : 'Bạn', text: text(8) + (i === count - 1 ? '\nTIN CUỐI ' + id : ''), time: new Date().toISOString(), ...(withImages && i % 5 === 0 ? { attachments: [{ path: image, name: 'shot.png' }] } : {}) })) });
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], threads: [thread('a', 'Session A', 60, false), { ...thread('b', 'Session B', 60, true), issues: Array.from({ length: 6 }, (_, i) => ({ id: 'ISS-' + i, text: 'Issue mở rất dài '.repeat(30) })), attachments: [{ path: image, name: 'shot.png' }] }] } }));
require('../main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const open = title => [...document.querySelectorAll('#groups .thread')].find(item => item.title === title).click();
      const gap = () => { const box = document.querySelector('#activity'); return Math.round(box.scrollHeight - box.scrollTop - box.clientHeight); };
      const out = [];
      for (const title of ['Session A', 'Session B', 'Session A', 'Session B']) {
        open(title); await wait(50); const early = gap(); await wait(900);
        out.push(title + ' gap ' + early + '→' + gap());
        if (gap() > 5) throw Error(title + ' not at the last message: ' + out.join(' | '));
      }
      // Scrolled up to read: a re-render keeps the position (no jump to the bottom).
      const box = document.querySelector('#activity'); box.scrollTop = 200; box.dispatchEvent(new Event('scroll')); await wait(1200);
      if (Math.abs(box.scrollTop - 200) > 5) throw Error('jumped while reading old messages: ' + box.scrollTop);
      return out.join(' | ');
    })()`);
    console.log('UI scroll passed: ' + result);
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
