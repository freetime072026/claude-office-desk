// UI: tin đang stream nhận thêm chữ thì thẻ tin được sửa tại chỗ: đoạn chữ và ảnh đã vẽ giữ nguyên nút (không tải lại ảnh,
// chữ không nhảy), khung vẫn ở tin cuối. Chạy: npx electron tests/ui-stream.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'stream-' + Date.now());
app.setPath('userData', userData);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const attach = path.join(userData, 'attachments', 's'); fs.mkdirSync(attach, { recursive: true });
const image = path.join(attach, 'shot.png'); fs.writeFileSync(image, Buffer.from(png, 'base64'));
const time = new Date().toISOString();
const messages = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'GD' : 'Bạn', text: 'Tin cũ ' + i + '\nDòng hai', time }));
const live = { id: 'live', role: 'GD', time, streaming: true, progress: { started: time }, text: `Mở đầu\n![ảnh](${image.replace(/\\/g, '/')})\n- mục một` };
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], threads: [{ id: 's', model: 'claude-opus-5-5', title: 'Session S', project: '', pinned: false, stage: 0, status: 'working', flow: ['GD'], workers: { GD: { type: 'GD' } }, issues: [], folder: attach, attachments: [], messages: [...messages, live] }] } }));
require('../main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0], run = code => window.webContents.executeJavaScript(code);
  try {
    await run(`[...document.querySelectorAll('#groups .thread')].find(item => item.title === 'Session S').click()`); await delay(800);
    const mark = await run(`(() => { const card = document.querySelector('#activity').lastElementChild, img = card.querySelector('img.chat-image'), p = card.querySelector('.chat-text p');
      if (!img || !img.src) throw Error('inline image not loaded'); card.dataset.mark = img.dataset.mark = p.dataset.mark = 'old'; return true; })()`);
    const state = await run(`window.office.run('state')`);
    const thread = state.team.threads[0], last = thread.messages.at(-1);
    for (let i = 0; i < 6; i++) { last.text += '\n- mục thêm ' + i + '\nĐoạn chữ mới ' + i; last.steps = Array.from({ length: i + 1 }, (_, n) => ({ tool: 'Read', at: time, detail: 'f' + n })); window.webContents.send('state', state); await delay(60); }
    await delay(400);
    const result = await run(`(() => { const box = document.querySelector('#activity'), card = box.lastElementChild, img = card.querySelector('img.chat-image'), p = card.querySelector('.chat-text p');
      return { card: card.dataset.mark, img: img?.dataset.mark, p: p?.dataset.mark, text: card.textContent.includes('Đoạn chữ mới 5'), items: card.querySelectorAll('.chat-text li').length, gap: Math.round(box.scrollHeight - box.scrollTop - box.clientHeight) }; })()`);
    if (!mark || result.card !== 'old' || result.img !== 'old' || result.p !== 'old' || !result.text || result.items !== 7 || result.gap > 5) throw Error('streamed card was redrawn: ' + JSON.stringify(result));
    console.log('UI stream passed: ' + JSON.stringify(result));
    window.destroy(); app.exit(0);
  } catch (error) { console.error(error); window.destroy(); app.exit(1); }
});
