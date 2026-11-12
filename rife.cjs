// RIFE (rife-ncnn-vulkan, mã nguồn mở MIT của nihui): nội suy frame bằng AI, chạy GPU qua Vulkan, một tệp exe không cần Python.
// Kit art-frames dùng RIFE cho cặp key có quãng dịch vừa (đẹp hơn optical flow); chưa cài thì kit vẫn chạy bằng flow / giữ frame.
// Cài một lần cho cả máy vào <userData>/tools/rife/, dùng chung mọi project. Thuần Node: không Electron (main.cjs hỏi / hiện nút).
const fs = require('node:fs');
const path = require('node:path');

const RELEASE = '20221029';
const ASSETS = { win32: 'windows', darwin: 'macos', linux: 'ubuntu' };
const SIZE_MB = 430; // gói phát hành gồm mọi model (~431 MB bản Windows); sau khi cài chỉ giữ KEEP_MODELS
// rife-v4.6 / rife-v4 nhận -s (time step bất kỳ) nên sinh được nhiều frame giữa; model cũ chỉ ra frame 0.5.
const KEEP_MODELS = ['rife-v4.6', 'rife-v4'];
// Windows Defender quét tệp vừa giải nén có thể khoá chúng vài trăm ms (EBUSY/EPERM khi xoá): thử lại thay vì báo cài lỗi.
const RETRY = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 };
const EXE = platform => platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan';
const urlOf = platform => ASSETS[platform] ? `https://github.com/nihui/rife-ncnn-vulkan/releases/download/${RELEASE}/rife-ncnn-vulkan-${RELEASE}-${ASSETS[platform]}.zip` : '';

// Tải theo redirect (GitHub chuyển sang máy chủ tệp), báo tiến độ, ghi vào .part rồi đổi tên khi xong.
function httpsDownload(url, target, progress = () => {}, redirects = 5) {
  const https = require('node:https');
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'office-desk' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume(); return resolve(httpsDownload(new URL(response.headers.location, url).href, target, progress, redirects - 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(Error(`Tải RIFE lỗi HTTP ${response.statusCode}`)); }
      const total = Number(response.headers['content-length']) || 0, part = target + '.part', file = fs.createWriteStream(part);
      let done = 0;
      response.on('data', chunk => { done += chunk.length; if (total) progress(done / total); });
      response.pipe(file);
      file.on('finish', () => file.close(() => { fs.renameSync(part, target); resolve(target); }));
      file.on('error', reject); response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(60000, () => request.destroy(Error('Tải RIFE quá 60 giây không nhận dữ liệu')));
  });
}

// tar có sẵn trên Windows 10+ (bsdtar) và macOS/Linux, giải được zip. Trên Windows gọi thẳng System32\tar.exe: PATH có usr/bin của
// Git thì "tar" là GNU tar, không đọc zip và hiểu "C:\…" là máy chủ từ xa ("Cannot connect to C: resolve failed").
const tarPath = (platform = process.platform) => {
  if (platform !== 'win32') return 'tar';
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(system) ? system : 'tar';
};
function tarExtract(zip, dir) {
  const { execFile } = require('node:child_process');
  return new Promise((resolve, reject) => execFile(tarPath(), ['-xf', zip, '-C', dir], { windowsHide: true, maxBuffer: 1 << 20 }, error => error ? reject(Error('Giải nén RIFE lỗi: ' + error.message)) : resolve()));
}

function createRife({ root, platform = process.platform, changed = () => {}, download = httpsDownload, extract = tarExtract } = {}) {
  const home = path.join(root, 'tools', 'rife');
  const state = { supported: Boolean(ASSETS[platform]), installed: false, exe: '', model: '', installing: false, progress: 0, error: '', asked: false };
  // Tìm exe trong <home>/rife-ncnn-vulkan-*/ (thư mục gốc của gói zip).
  function locate() {
    let found = null;
    try {
      for (const name of fs.readdirSync(home)) {
        const exe = path.join(home, name, EXE(platform)), model = path.join(home, name, KEEP_MODELS[0]);
        if (fs.existsSync(exe) && fs.existsSync(model)) found = { exe, model };
      }
    } catch {}
    Object.assign(state, found ? { installed: true, exe: found.exe, model: found.model } : { installed: false, exe: '', model: '' });
    return state.installed;
  }
  locate();
  async function install() {
    if (state.installing || locate()) return snapshot();
    if (!state.supported) throw Error('Chưa có bản RIFE cho hệ điều hành này');
    Object.assign(state, { installing: true, progress: 0, error: '' }); changed();
    const zip = path.join(home, `rife-ncnn-vulkan-${RELEASE}.zip`);
    try {
      fs.mkdirSync(home, { recursive: true });
      let shown = 0;
      await download(urlOf(platform), zip, ratio => { state.progress = ratio; if (ratio - shown >= 0.02) { shown = ratio; changed(); } });
      await extract(zip, home);
      // Chỉ giữ model dùng được (-s time step): gói gốc có hơn chục model, mỗi cái vài chục MB.
      for (const name of fs.readdirSync(home)) {
        const dir = path.join(home, name);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const entry of fs.readdirSync(dir)) if (/^rife/i.test(entry) && !KEEP_MODELS.includes(entry) && fs.statSync(path.join(dir, entry)).isDirectory()) fs.rmSync(path.join(dir, entry), RETRY);
      }
      if (!locate()) throw Error('Giải nén xong nhưng không thấy ' + EXE(platform));
    } catch (error) {
      state.error = error.message;
    } finally {
      try { fs.rmSync(zip, RETRY); fs.rmSync(zip + '.part', RETRY); } catch {}
      state.installing = false; changed();
    }
    if (state.error) throw Error(state.error);
    return snapshot();
  }
  // Hỏi một lần mỗi lần mở app: trả true nếu lượt này nên hỏi (chưa cài, không đang cài, chưa hỏi), rồi đánh dấu đã hỏi.
  function shouldAsk() {
    if (!state.supported || state.asked || state.installing || locate()) return false;
    state.asked = true; return true;
  }
  const snapshot = () => ({ ...state, home, sizeMb: SIZE_MB, url: urlOf(platform) });
  return { install, shouldAsk, locate, state: snapshot };
}

module.exports = { createRife, httpsDownload, tarExtract, tarPath, RELEASE, SIZE_MB, KEEP_MODELS, urlOf };
