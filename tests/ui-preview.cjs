// Kiểm tay mục Settings > Preview asset: chọn thư mục session, Build preview chép kit asset-preview vào
// <project>/.office-desk/preview/ rồi chạy build_preview.py (cần Python + Pillow), log hiện trong hộp, nút Mở preview bật.
// Chạy: npx electron tests/ui-preview.cjs [thư mục ảnh]
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const userData = path.join(__dirname, '..', '.smoke-profile', 'preview-' + Date.now());
const outDir = process.argv.slice(2).find(arg => !arg.startsWith('-') && !arg.endsWith('.cjs')) || userData;
app.setPath('userData', userData);
// Project giả: một ảnh + một chuỗi frame fx (Pillow vẽ).
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-preview-'));
const draw = `
import sys, os
from PIL import Image, ImageDraw
root = sys.argv[1]
for rel, size in [('assets/images/logo.png', (80, 40))] + [(f'input/vfx/fx_boom/boom_{i:03d}.png', (64, 64)) for i in range(1, 7)]:
    p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    im = Image.new('RGBA', size, (0, 0, 0, 0)); ImageDraw.Draw(im).ellipse([4, 4, size[0] - 4, size[1] - 4], fill=(255, 150, 0, 255)); im.save(p)
`;
if (spawnSync('python', ['-c', draw, project], { encoding: 'utf8' }).status !== 0) { console.error('cần python + Pillow'); process.exit(1); }
const flow = ['Dev'], workers = { Dev: { type: 'Dev', mode: 'read' } };
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], threads: [{ id: 'pv-thread', title: 'Preview', request: 'Preview', status: 'working', stage: 1, flow, workers, folder: project, messages: [], issues: [], dispatch: [] }] } }));
const opened = [];
shell.openPath = async target => { opened.push(target); return ''; }; // không mở trình duyệt thật
require('../main.cjs');
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  // capturePage có thể lỗi khi cửa sổ bị che (UnknownVizError): ảnh chỉ để xem, không làm hỏng lượt kiểm
  const shot = async name => { try { const image = await window.webContents.capturePage(); const file = path.join(outDir, name); fs.writeFileSync(file, image.toPNG()); console.log('ảnh: ' + file); } catch (error) { console.log(`không chụp được ${name}: ${error.message}`); } };
  const js = code => window.webContents.executeJavaScript(`(async () => { const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); ${code} })()`);
  try {
    window.setSize(1400, 900); await delay(300);
    const before = await js(`
      document.querySelector('#settings-open').click(); await wait(200);
      document.querySelector('#settings-nav [data-section=preview]').click();
      for (let i = 0; i < 40 && !document.querySelector('#set-preview-info small'); i++) await wait(100);
      await wait(300);
      return { visible: !document.querySelector('#settings-section-preview').hidden, folder: document.querySelector('#set-preview-folder').value,
        info: document.querySelector('#set-preview-info').innerText, open: document.querySelector('#set-preview-open').disabled };`);
    console.log(JSON.stringify(before, null, 1)); await shot('preview-before.png');
    if (!before.visible || before.folder !== project || !/Kit: chưa chép/.test(before.info) || !/Preview: chưa build/.test(before.info) || !before.open) throw Error('mục Preview asset trước khi build chưa đúng');
    const after = await js(`
      document.querySelector('#set-preview-build').click();
      for (let i = 0; i < 600 && !/Build xong|Build lỗi/.test(document.querySelector('#set-preview-info').innerText); i++) await wait(100);
      return { info: document.querySelector('#set-preview-info').innerText, log: document.querySelector('#set-preview-log').innerText,
        build: document.querySelector('#set-preview-build').textContent, open: document.querySelector('#set-preview-open').disabled };`);
    console.log(JSON.stringify(after, null, 1)); await shot('preview-after.png');
    const index = path.join(project, 'input', '_preview', 'index.html');
    if (!/✓ Build xong/.test(after.info) || !/Kit: v1 trong/.test(after.info) || !/7 images, 0 spine rigs, 1 frame sequences \(1 likely anim\)/.test(after.log) || after.open || !fs.existsSync(index)) throw Error('Build preview chưa đúng');
    if (!fs.existsSync(path.join(project, '.office-desk', 'preview', 'KIT.md'))) throw Error('kit chưa được chép');
    await js(`document.querySelector('#set-preview-open').click(); await wait(200); document.querySelector('#set-preview-doc').click(); await wait(200);`);
    if (opened[0] !== index || !/KIT\.md$/.test(opened[1] || '')) throw Error('Mở preview / KIT.md chưa đúng: ' + opened.join(', '));
    console.log('OK');
    app.exit(0);
  } catch (error) { console.error(error); await shot('preview-fail.png').catch(() => {}); app.exit(1); }
});
