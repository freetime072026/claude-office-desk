// Kiểm tay ô Model Codex của khối Art: Art chế độ Codex thì panel (tab Cấu hình) hiện danh sách model theo cache tài khoản;
// model đã lưu không còn trong danh sách (gpt-5.5) thì chọn luna + ghi chú; đổi model/mức suy nghĩ thì lưu. Khối khác thì ẩn.
// Không chạy Codex. Chạy: npx electron tests/ui-codex-model.cjs [ảnh.png]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'codex-model-' + Date.now());
const out = process.argv.find(arg => arg.endsWith('.png')) || path.join(userData, 'codex-model.png');
app.setPath('userData', userData);
const codexHome = path.join(userData, 'codex'); fs.mkdirSync(codexHome, { recursive: true }); process.env.CODEX_HOME = codexHome;
fs.writeFileSync(path.join(codexHome, 'models_cache.json'), JSON.stringify({ models: [
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list' }, { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
  { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list' }, { slug: 'gpt-reserve', visibility: 'hide' }] }));
const flow = ['GD', 'Art', 'Dev'], workers = Object.fromEntries(flow.map(label => [label, { type: label, mode: 'read' }]));
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], artGenerator: 'codex', codexModel: 'gpt-5.5', threads: [{ id: 'cx-thread', title: 'Codex', request: 'Codex', status: 'working', stage: 1, flow, workers, messages: [], issues: [], dispatch: [] }] } }));
require('../main.cjs');
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  try {
    window.setSize(1500, 900); await delay(300);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)), $ = id => document.querySelector(id);
      const pick = async label => { const chip = [...document.querySelectorAll('#dispatch-summary .team-chip')].find(item => item.textContent === label); chip.click(); await wait(200); $('#panel-tab-config').click(); await wait(150); };
      for (let i = 0; i < 40 && !document.querySelector('#dispatch-summary .team-chip'); i++) await wait(100);
      await pick('Art');
      const art = { hidden: $('#codex-field').hidden, options: [...$('#codex-model').options].map(item => item.value), model: $('#codex-model').value, effort: $('#codex-effort').value, note: $('#codex-note').textContent };
      $('#codex-model').value = 'gpt-6.1-sol'; $('#codex-effort').value = 'medium'; $('#codex-effort').dispatchEvent(new Event('change')); await wait(600);
      const saved = { model: $('#codex-model').value, effort: $('#codex-effort').value, note: $('#codex-note').textContent };
      await pick('Dev'); const dev = { hidden: $('#codex-field').hidden };
      await pick('Art'); return { art, saved, dev };
    })()`);
    console.log(JSON.stringify(result, null, 1));
    const image = await window.webContents.capturePage(); fs.writeFileSync(out, image.toPNG()); console.log('ảnh: ' + out);
    const ok = !result.art.hidden && result.art.options.join() === 'gpt-6.1-sol,gpt-6-luna,gpt-5.6-luna' && result.art.model === 'gpt-6-luna' && result.art.effort === 'low'
      && /gpt-5\.5 không còn/.test(result.art.note) && result.saved.model === 'gpt-6.1-sol' && result.saved.effort === 'medium' && /-m gpt-6\.1-sol · suy nghĩ medium/.test(result.saved.note) && result.dev.hidden;
    if (!ok) throw Error('ô Model Codex chưa đúng');
    console.log('OK');
  } catch (error) { console.error(error); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
