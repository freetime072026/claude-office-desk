// Kiểm tay nút "Xem ảnh" trong nhật ký bước: bước Read một ảnh (ảnh Codex nằm ngoài thư mục session) mở khung xem ảnh của chat.
// Bước ghi trước khi có step.image (chỉ có detail đủ đường dẫn) cũng có nút. Chạy: npx electron tests/ui-step-image.cjs [ảnh.png]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'step-image-' + Date.now());
const out = process.argv.find(arg => arg.endsWith('.png')) || path.join(userData, 'step-image.png');
app.setPath('userData', userData);
const codexHome = path.join(userData, 'codex'), image = path.join(codexHome, 'generated_images', 'sess-1', 'exec-1.png'), folder = path.join(userData, 'project');
fs.mkdirSync(path.dirname(image), { recursive: true }); fs.mkdirSync(folder, { recursive: true }); process.env.CODEX_HOME = codexHome;
fs.writeFileSync(image, Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f5d1d20000000049454e44ae426082', 'hex'));
const now = new Date().toISOString(), flow = ['Art'], workers = { Art: { type: 'Art', mode: 'read' } };
const steps = [{ id: 'a', tool: 'Read', detail: image, image, at: now, end: now, ok: true, result: '[ảnh]' }, { id: 'c', tool: 'Read', detail: image, at: now, end: now, ok: true, result: '[ảnh]' }, { id: 'b', tool: 'Bash', detail: 'echo ok', at: now, end: now, ok: true, result: 'ok' }];
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], threads: [{ id: 'img-thread', title: 'Ảnh', request: 'Ảnh', folder, status: 'working', stage: 0, flow, workers, issues: [], dispatch: [],
  messages: [{ id: 'm1', role: 'Art', text: 'Duyệt ảnh Codex.', time: now, steps, progress: { startedAt: now, finishedAt: now, steps: 2 } }] }] } }));
require('../main.cjs');
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  try {
    window.setSize(1500, 900); await delay(300);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)), $ = id => document.querySelector(id);
      for (let i = 0; i < 40 && !document.querySelector('.step-log'); i++) await wait(100);
      const log = document.querySelector('.step-log'); if (!log) return { log: false };
      log.open = true; await wait(300);
      const buttons = [...document.querySelectorAll('.step-log .step-image')], texts = [...document.querySelectorAll('.step-log .step-result')].map(item => item.textContent);
      buttons[0]?.click(); for (let i = 0; i < 30 && !$('#image-viewer').open; i++) await wait(100);
      return { log: true, buttons: buttons.map(item => item.textContent), texts, open: $('#image-viewer').open, src: ($('#image-view').src || '').slice(0, 22), title: $('#image-title').textContent };
    })()`);
    console.log(JSON.stringify(result, null, 1));
    const shot = await window.webContents.capturePage(); fs.writeFileSync(out, shot.toPNG()); console.log('ảnh: ' + out);
    if (!result.log || result.buttons.join() !== '🖼 Xem ảnh,🖼 Xem ảnh' || result.texts.includes('[ảnh]') || !result.open || !result.src.startsWith('data:image/png')) throw Error('nút Xem ảnh chưa đúng');
    console.log('OK');
  } catch (error) { console.error(error); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
