// Kiểm tay Codex và RIFE sau khi chuyển vào Settings > Plugins: khối Art chế độ 'codex' hiện một dòng trạng thái (Codex thật trên máy này
// qua codex login status, RIFE) + nút Quản lý trong Plugins; chế độ Script/MCP thì ẩn; khối khác không có. Tab Plugins có dòng Codex CLI
// (Đăng nhập / ✓ Đã đăng nhập) và RIFE (Cài ~430 MB, profile tạm chưa cài). Không bấm Đăng nhập (sẽ mở cửa sổ thật).
// Chạy: npx electron tests/ui-codex-login.cjs [ảnh.png]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'codex-' + Date.now());
const out = process.argv.find(arg => arg.endsWith('.png')) || path.join(userData, 'codex-login.png');
app.setPath('userData', userData);
const flow = ['GD', 'Art', 'Dev'], workers = Object.fromEntries(flow.map(label => [label, { type: label, mode: 'read' }]));
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], artGenerator: 'codex', threads: [{ id: 'cx-thread', title: 'Codex', request: 'Codex', status: 'working', stage: 1, flow, workers, messages: [], issues: [], dispatch: [] }] } }));
require('../main.cjs');
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  try {
    window.setSize(1500, 900); await delay(300);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const pick = async label => { const chip = [...document.querySelectorAll('#dispatch-summary .team-chip')].find(item => item.textContent === label); chip.click(); await wait(200); document.querySelector('#panel-tab-config').click(); await wait(150); };
      const read = () => ({ hidden: document.querySelector('#art-tools').hidden, status: document.querySelector('#art-tools-status').textContent });
      for (let i = 0; i < 40 && !document.querySelector('#dispatch-summary .team-chip'); i++) await wait(100);
      await pick('Art'); for (let i = 0; i < 100 && /chưa kiểm|^$/.test(document.querySelector('#art-tools-status').textContent); i++) await wait(100);
      const art = read();
      const select = document.querySelector('#art-generator'); select.value = 'tool'; select.dispatchEvent(new Event('change')); await wait(300); const tool = read();
      select.value = 'codex'; select.dispatchEvent(new Event('change')); await wait(300);
      await pick('Dev'); const dev = read(); await pick('Art');
      document.querySelector('#art-tools-open').click(); await wait(300);
      const rows = () => [...document.querySelectorAll('#settings-rows tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim());
      document.querySelector('[data-scope=yours]').click(); await wait(200); const yours = rows();
      document.querySelector('[data-scope=discover]').click(); await wait(200); const discover = rows();
      return { art, tool, dev, plugins: [...yours, ...discover] };
    })()`);
    console.log(JSON.stringify(result, null, 1));
    const image = await window.webContents.capturePage(); fs.writeFileSync(out, image.toPNG()); console.log('ảnh: ' + out);
    if (result.art.hidden || !/Codex: /.test(result.art.status) || !/RIFE: chưa cài/.test(result.art.status) || !result.tool.hidden || !result.dev.hidden) throw Error('dòng Codex/RIFE ở khối Art chưa đúng');
    if (!result.plugins.some(row => /^Codex CLI/.test(row) && /Đăng nhập|Đã đăng nhập/.test(row)) || !result.plugins.some(row => /^RIFE .*Cài \(~430 MB\)/.test(row))) throw Error('tab Plugins chưa có Codex / RIFE');
    console.log('UI codex login passed');
  } catch (error) { console.error(error); process.exitCode = 1; }
  app.quit();
});
