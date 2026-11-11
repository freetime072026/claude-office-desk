// Kiểm tay nút Chạy Penpot MCP: role Art có tích penpot thì panel (tab Cấu hình) hiện nút; role khác không tích thì ẩn.
// Không bấm nút (sẽ chạy npx thật). Chạy: npx electron tests/ui-penpot-run.cjs [ảnh.png]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'penpot-' + Date.now());
const out = process.argv.find(arg => arg.endsWith('.png')) || path.join(userData, 'penpot-run.png');
app.setPath('userData', userData);
const flow = ['GD', 'Art', 'Dev'], workers = Object.fromEntries(flow.map(label => [label, { type: label, mode: 'read' }]));
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], roleMcp: { Art: ['penpot'] }, threads: [{ id: 'pp-thread', title: 'Penpot', request: 'Penpot', status: 'working', stage: 1, flow, workers, messages: [], issues: [], dispatch: [] }] } }));
fs.writeFileSync(path.join(userData, 'mcp-servers.json'), JSON.stringify({ mcpServers: { penpot: { type: 'http', url: 'http://localhost:4401/mcp' }, other: { command: 'x', args: [] } } }));
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
      for (let i = 0; i < 40 && !document.querySelector('#dispatch-summary .team-chip'); i++) await wait(100);
      await pick('Art'); const art = { hidden: document.querySelector('#penpot-run').hidden, button: document.querySelector('#penpot-start').textContent, status: document.querySelector('#penpot-status').textContent };
      await pick('Dev'); const dev = { hidden: document.querySelector('#penpot-run').hidden };
      await pick('Art'); return { art, dev };
    })()`);
    console.log(JSON.stringify(result, null, 1));
    const image = await window.webContents.capturePage(); fs.writeFileSync(out, image.toPNG()); console.log('ảnh: ' + out);
    if (result.art.hidden || result.art.button !== '▶ Chạy Penpot MCP' || !result.dev.hidden) throw Error('nút Penpot chưa đúng');
    console.log('UI penpot run passed');
  } catch (error) { console.error(error); process.exitCode = 1; }
  app.quit();
});
