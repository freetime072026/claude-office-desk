// Kiểm tay tab "Tin của khối": dựng session mẫu, bấm khối Art ở dòng khối, chụp màn hình vào thư mục được truyền (mặc định .smoke-profile).
// Chạy: npx electron tests/ui-block-feed.cjs [thư mục ảnh]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const userData = path.join(__dirname, '..', '.smoke-profile', 'feed-' + Date.now());
const out = process.argv.find(arg => arg.endsWith('.png')) || path.join(userData, 'block-feed.png');
app.setPath('userData', userData);
const at = minute => new Date(Date.UTC(2026, 10, 9, 18, minute)).toISOString();
const flow = ['PO', 'GD', 'Art Director', 'Lead Dev', 'Art', 'Art #2', 'Art #3', 'Fixer'];
const messages = [
  ['Bạn', 'lập lại kế hoạch từ C34', { to: 'PO' }], ['PO', 'Đã lập lại kế hoạch 8 mốc.'],
  ['Tự động', 'Bắt đầu Art Director · lập kế hoạch'], ['Điều phối', 'Tự động: thực hiện bước Art Director (pha planning).', { to: 'Art Director' }],
  ['Art Director', 'Đã duyệt mốc 1 và giao việc cho 3 nhánh.'], ['Phân công đã duyệt', 'Art, Art #3. Nội dung task nằm trong khối tasks.'],
  ['Điều phối', 'Thực hiện task Art Director giao ở mục "Task của khối".', { to: 'Art' }], ['Art', 'Đã viết lệnh vẽ C34 vào ART_PROMPTS_Hero.md. Chờ ảnh của bạn trong art/inbox/C34/.'],
  ['Tự động', 'Art bị chặn: Chờ ảnh C34 (6 ảnh) trong art/inbox/C34/. Lưu ảnh rồi bấm Thử lại task bị chặn.'],
  ...Array.from({ length: 12 }, (_, index) => ['Lead Dev', `Lượt Lead ${index + 1}: kiểm Dev, không liên quan Art.`])
].map(([role, text, extra], index) => ({ role, text, time: at(index), ...(extra || {}) }));
fs.mkdirSync(userData, { recursive: true });
const workers = Object.fromEntries(flow.map(label => [label, { type: label.replace(/ #\d+$/, ''), mode: 'read' }]));
fs.writeFileSync(path.join(userData, 'workspace.json'), JSON.stringify({ profiles: [], executable: '', team: { projects: [], roles: [], threads: [{ id: 'feed-thread', title: 'Vòng art', request: 'Vòng art', status: 'working', stage: 4, flow, workers, messages, issues: [], dispatch: [{ worker: 'Art', task: 'C34', files: ['art/source/hero/'], status: 'blocked', error: 'Chờ ảnh C34' }] }] } }));
fs.writeFileSync(path.join(userData, 'mcp-servers.json'), JSON.stringify({ mcpServers: {} }));
require('../main.cjs');
const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
app.whenReady().then(async () => {
  await delay(1500);
  const window = BrowserWindow.getAllWindows()[0];
  try {
    window.setSize(1500, 900); await delay(300);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i = 0; i < 40 && !document.querySelector('#dispatch-summary .team-chip'); i++) { document.querySelector('[data-thread="feed-thread"], #groups button')?.click(); await wait(100); }
      const chip = [...document.querySelectorAll('#dispatch-summary .team-chip')].find(item => item.textContent === 'Art'); if (!chip) throw Error('no Art chip');
      chip.click(); await wait(300);
      const feed = [...document.querySelectorAll('#block-feed-list article')].map(card => card.querySelector('p, div')?.textContent?.slice(0, 60));
      const feedMode = document.querySelector('#panel').classList.contains('feed-mode'), modeHiddenInFeed = getComputedStyle(document.querySelector('#chat-mode').closest('label')).display === 'none';
      document.querySelector('#panel-tab-config').click(); await wait(100);
      const config = { modeShown: getComputedStyle(document.querySelector('#chat-mode').closest('label')).display !== 'none', feedHidden: getComputedStyle(document.querySelector('#block-feed')).display === 'none' };
      document.querySelector('#panel-tab-feed').click(); await wait(100);
      return { feedMode, modeHiddenInFeed, config, stop: document.querySelectorAll('#block-feed-list article.feed-stop').length, count: feed.length, feed };
    })()`);
    console.log(JSON.stringify(result, null, 1));
    const image = await window.webContents.capturePage(); fs.writeFileSync(out, image.toPNG()); console.log('ảnh: ' + out);
    if (!result.feedMode || !result.modeHiddenInFeed || result.count !== 4 || result.stop !== 1) throw Error('tab Tin của khối chưa đúng');
    if (!result.config.modeShown || !result.config.feedHidden) throw Error('tab Cấu hình chưa đúng');
    console.log('UI block feed passed');
  } catch (error) { console.error(error); process.exitCode = 1; }
  app.quit();
});
