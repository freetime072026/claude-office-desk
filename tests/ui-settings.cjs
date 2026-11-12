// Kiểm tay hộp Settings: nút ⚙ nằm bên phải nút tài khoản; mở ra có mục Tài khoản / Usage / Tùy chỉnh, tab Connectors (MCP server
// trong mcp-servers.json), Skills, Plugins (Codex, RIFE, ComfyUI và model), lọc Của bạn / Khám phá và ô tìm. Khối Art chỉ còn một dòng
// trạng thái + nút mở Plugins. Chạy một ComfyUI giả ở cổng 8188; không bấm Cài (sẽ tải thật).
// Chạy: npx electron tests/ui-settings.cjs [thư mục ảnh]
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'settings-' + Date.now());
const outDir = process.argv.slice(2).find(arg => !arg.startsWith('-') && !arg.endsWith('.cjs')) || userData;
app.setPath('userData', userData);
const flow = ['GD', 'Art', 'Dev'], workers = Object.fromEntries(flow.map(label => [label, { type: label, mode: 'read' }]));
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], artGenerator: 'comfyui', roleMcp: { 'UI/UX': ['penpot'] }, threads: [{ id: 'st-thread', title: 'Settings', request: 'Settings', status: 'working', stage: 1, flow, workers, messages: [], issues: [], dispatch: [] }] } }));
fs.writeFileSync(path.join(userData, 'mcp-servers.json'), JSON.stringify({ mcpServers: { penpot: { type: 'http', url: 'http://localhost:4401/mcp' }, files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: { SECRET: 'x' } } } }));
const models = path.join(userData, 'ComfyUI', 'models');
const routes = {
  '/system_stats': { system: { comfyui_version: '0.4.1-fake' }, devices: [{ name: 'cuda:0 NVIDIA GeForce GTX 1660 SUPER : cudaMallocAsync', type: 'cuda', vram_total: 6 * 2 ** 30 }] },
  '/internal/folder_paths': Object.fromEntries(['checkpoints', 'loras', 'vae', 'text_encoders', 'diffusion_models', 'upscale_models'].map(kind => [kind, [[path.join(models, kind)], ['.safetensors']]])),
  '/models/checkpoints': ['DreamShaperXL_Lightning.safetensors'],
};
const server = http.createServer((request, response) => { const body = routes[request.url]; response.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body || {})); });
require('../main.cjs');
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(8188, '127.0.0.1', resolve));
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  const shot = async name => { const image = await window.webContents.capturePage(); const file = path.join(outDir, name); fs.writeFileSync(file, image.toPNG()); console.log('ảnh: ' + file); };
  const js = code => window.webContents.executeJavaScript(`(async () => { const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); ${code} })()`);
  try {
    window.setSize(1400, 900); await delay(300);
    const layout = await js(`
      const consoleBox = document.querySelector('#console').getBoundingClientRect(), gear = document.querySelector('#settings-open').getBoundingClientRect();
      for (let i = 0; i < 40 && !document.querySelector('#dispatch-summary .team-chip'); i++) await wait(100);
      [...document.querySelectorAll('#dispatch-summary .team-chip')].find(item => item.textContent === 'Art').click(); await wait(200); document.querySelector('#panel-tab-config').click();
      for (let i = 0; i < 60 && !/ComfyUI: ✓/.test(document.querySelector('#art-tools-status').textContent); i++) await wait(100);
      return { gearRight: gear.left >= consoleBox.right - 1 && Math.abs(gear.top - consoleBox.top) < 4, art: { hidden: document.querySelector('#art-tools').hidden, status: document.querySelector('#art-tools-status').textContent }, oldFields: Boolean(document.querySelector('#comfy-field, #codex-field, #rife-field')) };`);
    console.log(JSON.stringify(layout));
    if (!layout.gearRight || layout.art.hidden || !/ComfyUI: ✓ đang chạy · 1 model/.test(layout.art.status) || layout.oldFields) throw Error('nút ⚙ / dòng Art chưa đúng');
    const rows = `[...document.querySelectorAll('#settings-rows tr')].map(tr => [...tr.children].map(td => td.innerText.replace(/\\s+/g, ' ').trim()).join(' | '))`;
    const connectors = await js(`document.querySelector('#settings-open').click(); for (let i = 0; i < 40 && !document.querySelector('#settings-rows tr'); i++) await wait(100); return { open: document.querySelector('#settings').open, head: document.querySelector('#settings-head').innerText, rows: ${rows} };`);
    console.log(JSON.stringify(connectors, null, 1)); await shot('settings-connectors.png');
    if (!connectors.open || connectors.rows.length !== 2 || !/penpot .*localhost:4401 \| Web \(http\) \| UI\/UX/.test(connectors.rows.join('\n')) || /SECRET/.test(JSON.stringify(connectors))) throw Error('tab Connectors chưa đúng');
    const discover = await js(`document.querySelector('[data-scope=discover]').click(); await wait(150); return ${rows};`);
    if (!/Penpot .*✓ Đã thêm/.test(discover.join('\n'))) throw Error('Khám phá Connectors chưa đúng: ' + discover.join('\n'));
    const plugins = await js(`document.querySelector('[data-tab=plugins]').click(); for (let i = 0; i < 80 && !/Codex CLI/.test(document.querySelector('#settings-rows').innerText) ; i++) await wait(100); await wait(800); return ${rows};`);
    console.log(JSON.stringify(plugins, null, 1)); await shot('settings-plugins-discover.png');
    if (!plugins.some(row => /^Z-Image-Turbo/.test(row) && /Cài \(20\.7 GB\)/.test(row)) || plugins.some(row => /^DreamShaper/.test(row))) throw Error('Khám phá Plugins chưa đúng');
    const yours = await js(`document.querySelector('[data-scope=yours]').click(); await wait(200); return ${rows};`);
    console.log(JSON.stringify(yours, null, 1)); await shot('settings-plugins-yours.png');
    if (!yours.some(row => /^ComfyUI .*Đang chạy ở http:\/\/127\.0\.0\.1:8188/.test(row)) || !yours.some(row => /^DreamShaper XL Lightning.*✓ Đã cài/.test(row))) throw Error('Plugins Của bạn chưa đúng');
    const search = await js(`const box = document.querySelector('#settings-search'); document.querySelector('[data-scope=discover]').click(); box.value = 'pixel'; box.dispatchEvent(new Event('input')); await wait(150); return ${rows};`);
    if (search.length !== 1 || !/^Pixel Art XL LoRA/.test(search[0])) throw Error('ô tìm chưa đúng: ' + search.join('\n'));
    const skills = await js(`document.querySelector('[data-tab=skills]').click(); for (let i = 0; i < 40 && !document.querySelector('#settings-rows tr'); i++) await wait(100); return ${rows};`);
    if (!/Anthropic Skills .*anthropics\/skills .*Cài/.test(skills.join('\n'))) throw Error('Khám phá Skills chưa đúng: ' + skills.join('\n'));
    const account = await js(`document.querySelector('[data-section=account]').click(); await wait(150); return { customizeHidden: document.querySelector('#settings-section-customize').hidden, text: document.querySelector('#settings-section-account').innerText };`);
    if (!account.customizeHidden || !/Tài khoản/.test(account.text)) throw Error('mục Tài khoản chưa đúng');
    const fromArt = await js(`document.querySelector('#settings-close').click(); await wait(100); document.querySelector('#art-tools-open').click(); await wait(300); return { open: document.querySelector('#settings').open, tab: document.querySelector('[data-tab=plugins]').getAttribute('aria-selected') };`);
    if (!fromArt.open || fromArt.tab !== 'true') throw Error('nút Quản lý trong Plugins chưa mở đúng tab');
    console.log('UI settings passed');
  } catch (error) { console.error(error); process.exitCode = 1; }
  server.close(); app.quit();
});
