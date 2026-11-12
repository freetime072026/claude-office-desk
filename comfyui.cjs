// ComfyUI cho chế độ sinh ảnh 'comfyui' của Art: model chạy trên máy, miễn phí, không giới hạn lượt.
// Office Desk không cài ComfyUI (người dùng cài ComfyUI Desktop, bản portable hoặc comfy-cli); module này dò server đang chạy, dò GPU,
// tìm thư mục models/ và tải model trong CATALOG vào đúng thư mục con. Art sinh ảnh bằng kit comfy.py (kits/art-frames/comfy.py)
// qua API của ComfyUI, đọc preset của model đã cài trong <project>/.office-desk/art/comfy.json (projectConfig).
// Thuần Node: không Electron (main.cjs nối nút và hộp chọn thư mục).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HF = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;
// Model chọn theo license dùng thương mại được (Apache 2.0, OpenRAIL++, OpenRAIL-M, BSD) và chạy bằng node có sẵn của ComfyUI
// (không cần custom node). size: byte của tệp trên Hugging Face, để báo dung lượng trước khi tải.
// minVram: VRAM (GB) để chạy ở tốc độ dùng được; slowVram: VRAM tối thiểu để còn chạy chậm được (mặc định nửa minVram); ramGb: RAM máy cần khi ComfyUI đẩy bớt model sang RAM.
// gen: tham số mặc định cho comfy.py (family chọn workflow). addon: LoRA / upscaler dùng kèm, không sinh ảnh một mình.
const CATALOG = Object.freeze([
  { id: 'dreamshaper-xl-lightning', name: 'DreamShaper XL Lightning', family: 'sdxl', minVram: 6, ramGb: 16, license: 'OpenRAIL++',
    use: 'Đa dụng: nhân vật, item, icon, background stylized. Nhanh (4–6 bước), hợp card 6–8 GB.',
    files: [{ dir: 'checkpoints', name: 'DreamShaperXL_Lightning.safetensors', size: 6.94e9, url: HF('Lykon/dreamshaper-xl-lightning', 'DreamShaperXL_Lightning.safetensors') }],
    gen: { steps: 6, cfg: 2, sampler: 'dpmpp_sde', scheduler: 'karras', width: 1024, height: 1024, prompt: 'tags' } },
  { id: 'animagine-xl-4', name: 'Animagine XL 4.0', family: 'sdxl', minVram: 6, ramGb: 16, license: 'OpenRAIL++',
    use: 'Anime / chibi / nhân vật 2D. 28 bước; thêm SDXL Lightning LoRA (--fast) để còn 4 bước.',
    files: [{ dir: 'checkpoints', name: 'animagine-xl-4.0-opt.safetensors', size: 6.94e9, url: HF('cagliostrolab/animagine-xl-4.0', 'animagine-xl-4.0-opt.safetensors') }],
    gen: { steps: 28, cfg: 5, sampler: 'euler_ancestral', scheduler: 'normal', width: 1024, height: 1024, prompt: 'tags' } },
  { id: 'z-image-turbo', name: 'Z-Image-Turbo', family: 'zimage', minVram: 12, ramGb: 32, license: 'Apache 2.0',
    use: 'Chất lượng cao nhất trong nhóm nhanh: nhân vật, key art, background, icon; prompt câu tự nhiên.',
    files: [
      { dir: 'diffusion_models', name: 'z_image_turbo_bf16.safetensors', size: 12.31e9, url: HF('Comfy-Org/Z-Image-Turbo', 'split_files/diffusion_models/z_image_turbo_bf16.safetensors') },
      { dir: 'text_encoders', name: 'qwen_3_4b.safetensors', size: 8.04e9, url: HF('Comfy-Org/Z-Image-Turbo', 'split_files/text_encoders/qwen_3_4b.safetensors') },
      { dir: 'vae', name: 'ae.safetensors', size: 0.34e9, url: HF('Comfy-Org/Z-Image-Turbo', 'split_files/vae/ae.safetensors') },
    ],
    gen: { steps: 9, cfg: 1, sampler: 'res_multistep', scheduler: 'simple', width: 1024, height: 1024, shift: 3, clipType: 'lumina2', prompt: 'natural' } },
  { id: 'qwen-image', name: 'Qwen-Image 2512', family: 'qwen', minVram: 12, slowVram: 10, ramGb: 48, license: 'Apache 2.0',
    use: 'Hiểu prompt dài tốt nhất, vẽ được chữ (UI, banner, logo). Rất nặng (~30 GB), cần RAM 48 GB trở lên; chậm.',
    files: [
      { dir: 'diffusion_models', name: 'qwen_image_2512_fp8_e4m3fn.safetensors', size: 20.43e9, url: HF('Comfy-Org/Qwen-Image', 'split_files/diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors') },
      { dir: 'text_encoders', name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', size: 9.38e9, url: HF('Comfy-Org/Qwen-Image', 'split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors') },
      { dir: 'vae', name: 'qwen_image_vae.safetensors', size: 0.25e9, url: HF('Comfy-Org/Qwen-Image', 'split_files/vae/qwen_image_vae.safetensors') },
    ],
    gen: { steps: 20, cfg: 2.5, sampler: 'euler', scheduler: 'simple', width: 1328, height: 1328, shift: 3.1, clipType: 'qwen_image', prompt: 'natural' } },
  { id: 'sdxl-lightning-lora', name: 'SDXL Lightning LoRA (4 bước)', family: 'lora', addon: true, minVram: 6, ramGb: 8, license: 'OpenRAIL++',
    use: 'Tăng tốc model SDXL nhiều bước (Animagine): comfy.py --fast còn 4 bước, cfg 1.',
    files: [{ dir: 'loras', name: 'sdxl_lightning_4step_lora.safetensors', size: 0.39e9, url: HF('ByteDance/SDXL-Lightning', 'sdxl_lightning_4step_lora.safetensors') }],
    gen: { strength: 1 } },
  { id: 'pixel-art-xl', name: 'Pixel Art XL LoRA', family: 'lora', addon: true, minVram: 6, ramGb: 8, license: 'OpenRAIL-M',
    use: 'Pixel art cho model SDXL: comfy.py --lora pixel-art-xl, rồi thu nhỏ 8 lần (nearest) và đưa về palette.',
    files: [{ dir: 'loras', name: 'pixel-art-xl.safetensors', size: 0.17e9, url: HF('nerijs/pixel-art-xl', 'pixel-art-xl.safetensors') }],
    gen: { strength: 1.2 } },
  { id: 'realesrgan-x4plus', name: 'RealESRGAN x4plus', family: 'upscale', addon: true, minVram: 2, ramGb: 8, license: 'BSD-3',
    use: 'Phóng to ảnh cho nét (comfy.py upscale), dùng cho mọi model.',
    files: [{ dir: 'upscale_models', name: 'RealESRGAN_x4plus.safetensors', size: 0.07e9, url: HF('Comfy-Org/Real-ESRGAN', 'RealESRGAN_x4plus.safetensors') }],
    gen: {} },
]);
const MODEL_DIRS = Object.freeze([...new Set(CATALOG.flatMap(model => model.files.map(file => file.dir)))]);
// ComfyUI Desktop mặc định cổng 8000, bản portable / chạy tay mặc định 8188.
const DEFAULT_URLS = Object.freeze(['http://127.0.0.1:8188', 'http://127.0.0.1:8000']);
const DOWNLOAD_PAGE = 'https://www.comfy.org/download';
const sizeOf = model => model.files.reduce((sum, file) => sum + file.size, 0);
const gb = bytes => Math.round(bytes / 1e8) / 10;

// Mức hợp card: ok = chạy được ở tốc độ dùng được; slow = chạy được nhưng chậm (ComfyUI đẩy model sang RAM); no = không nên cài.
// Chưa biết VRAM (không có card NVIDIA / chưa dò được) thì không kết luận.
function fitOf(model, gpu) {
  const vram = gpu?.vramGb || 0, ram = gpu?.ramGb || 0;
  if (!vram) return 'unknown';
  if (vram >= model.minVram && (!ram || ram >= model.ramGb)) return 'ok';
  if (vram >= (model.slowVram ?? model.minVram * 0.5) && (!ram || ram >= model.ramGb * 0.66)) return 'slow';
  return 'no';
}
// Bộ khuyên cài theo card: một model chính hợp card + LoRA / upscaler nhẹ. Card 12 GB: Z-Image làm model chính, giữ DreamShaper cho stylized nhanh.
function recommended(gpu) {
  const vram = gpu?.vramGb || 0;
  const ids = ['dreamshaper-xl-lightning', 'pixel-art-xl', 'realesrgan-x4plus'];
  if (vram >= 12) ids.unshift('z-image-turbo');
  return ids;
}

// Thư mục ComfyUI người dùng chọn có thể là gốc ComfyUI (có models/) hoặc chính thư mục models.
function modelsRootOf(dir) {
  if (!dir) return '';
  const inner = path.join(dir, 'models');
  if (fs.existsSync(inner) && fs.statSync(inner).isDirectory()) return inner;
  if (path.basename(dir).toLowerCase() === 'models' || MODEL_DIRS.some(name => fs.existsSync(path.join(dir, name)))) return dir;
  return inner;
}
// ComfyUI Desktop ghi thư mục cài (basePath) trong %APPDATA%\ComfyUI\config.json.
function desktopBase(env = process.env) {
  const appData = env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
  try { const config = JSON.parse(fs.readFileSync(path.join(appData, 'ComfyUI', 'config.json'), 'utf8')); return typeof config.basePath === 'string' ? config.basePath : ''; } catch { return ''; }
}
// ComfyUI cài bằng comfy-cli (pip install comfy-cli; comfy install): workspace ghi trong config.ini của comfy-cli
// (%LOCALAPPDATA%\comfy-cli trên Windows). Ưu tiên default_workspace (comfy set-default), rồi recent_workspace (lần install/launch gần nhất).
// Chỉ dựa vào env truyền vào (test truyền env rỗng thì không đọc config thật của máy).
function cliConfigDir(env = process.env, platform = process.platform) {
  const home = env.USERPROFILE || env.HOME || '';
  if (platform === 'win32') return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'comfy-cli') : home ? path.join(home, 'AppData', 'Local', 'comfy-cli') : '';
  if (!home && !env.XDG_CONFIG_HOME) return '';
  return platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'comfy-cli') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'comfy-cli');
}
function cliBase(env = process.env, platform = process.platform) {
  const dir = cliConfigDir(env, platform); if (!dir) return '';
  let text = ''; try { text = fs.readFileSync(path.join(dir, 'config.ini'), 'utf8'); } catch { return ''; }
  const value = key => (new RegExp(`^\\s*${key}\\s*[=:]\\s*(.+?)\\s*$`, 'm').exec(text) || [])[1] || '';
  return [value('default_workspace'), value('recent_workspace')].find(dir => dir && fs.existsSync(dir)) || '';
}

// Cách mở ComfyUI từ thư mục cài: bản git/comfy-cli (main.py + .venv hoặc venv) và bản portable (python_embeded + ComfyUI/main.py;
// thư mục chọn có thể là gốc portable hoặc thư mục ComfyUI bên trong). Không tìm được (ComfyUI Desktop, hoặc chỉ chọn thư mục models)
// thì null: UI giữ nút Tải ComfyUI. Python của hệ thống không dùng: thiếu torch của ComfyUI.
function launcherOf(dir, platform = process.platform) {
  if (!dir) return null;
  const bin = platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
  const file = (...parts) => { const target = path.join(...parts); return fs.existsSync(target) && fs.statSync(target).isFile() ? target : ''; };
  for (const [main, pythons] of [
    [file(dir, 'main.py'), [file(dir, '.venv', ...bin), file(dir, 'venv', ...bin), file(dir, '..', 'python_embeded', 'python.exe')]],
    [file(dir, 'ComfyUI', 'main.py'), [file(dir, 'python_embeded', 'python.exe')]],
  ]) {
    const python = pythons.find(Boolean);
    if (main && python) return { python: path.resolve(python), main: path.resolve(main), cwd: path.dirname(path.resolve(main)), portable: /[\\/]python_embeded[\\/]/i.test(python) };
  }
  return null;
}

async function fetchJson(url, timeout = 2500) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response.json();
}
// nvidia-smi có sẵn khi cài driver NVIDIA; dùng khi ComfyUI chưa chạy (server chạy thì lấy GPU từ /system_stats).
function nvidiaGpu({ execFile = require('node:child_process').execFile } = {}) {
  return new Promise(resolve => execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 }, (error, stdout) => {
    if (error) return resolve(null);
    const [name, mib] = String(stdout).split(/\r?\n/)[0].split(',').map(part => part.trim());
    resolve(name && Number(mib) ? { name, vramGb: Math.round(Number(mib) / 1024 * 10) / 10 } : null);
  }));
}

// Tải một tệp lớn: theo redirect (Hugging Face chuyển sang CDN), tiếp tục từ .part còn dở (Range), huỷ được (signal).
function download(url, target, { progress = () => {}, signal, redirects = 8 } = {}) {
  const https = require('node:https');
  const part = target + '.part';
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Error('Đã huỷ'));
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const request = https.get(url, { headers: { 'User-Agent': 'office-desk', ...(have ? { Range: `bytes=${have}-` } : {}) } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume(); return resolve(download(new URL(response.headers.location, url).href, target, { progress, signal, redirects: redirects - 1 }));
      }
      if (response.statusCode === 416 && have) { response.resume(); fs.renameSync(part, target); return resolve(target); }
      if (![200, 206].includes(response.statusCode)) { response.resume(); return reject(Error(`Tải lỗi HTTP ${response.statusCode}`)); }
      const append = response.statusCode === 206, start = append ? have : 0;
      const total = start + (Number(response.headers['content-length']) || 0);
      const file = fs.createWriteStream(part, { flags: append ? 'a' : 'w' });
      let done = start;
      response.on('data', chunk => { done += chunk.length; progress(done, total); });
      response.pipe(file);
      file.on('finish', () => file.close(() => { if (signal?.aborted) return reject(Error('Đã huỷ')); fs.renameSync(part, target); resolve(target); }));
      file.on('error', reject); response.on('error', reject);
    });
    request.on('error', error => reject(signal?.aborted ? Error('Đã huỷ') : error));
    request.setTimeout(60000, () => request.destroy(Error('Quá 60 giây không nhận dữ liệu')));
    signal?.addEventListener('abort', () => request.destroy(Error('Đã huỷ')), { once: true });
  });
}

// root: thư mục dữ liệu của Office Desk (lưu <root>/tools/comfyui.json: thư mục ComfyUI và URL server người dùng chọn).
const LAUNCH_WAIT_MS = 120000, LAUNCH_POLL_MS = 2000;
function createComfy({ root, changed = () => {}, fetchJson: getJson = fetchJson, gpuProbe = nvidiaGpu, download: fetchFile = download, env = process.env, totalRam = os.totalmem(), spawn = require('node:child_process').spawn, pollMs = LAUNCH_POLL_MS, waitMs = LAUNCH_WAIT_MS } = {}) {
  const configFile = path.join(root, 'tools', 'comfyui.json');
  const readConfig = () => { try { return JSON.parse(fs.readFileSync(configFile, 'utf8')) || {}; } catch { return {}; } };
  let config = readConfig();
  const state = { server: { ok: false, url: config.url || '', version: '', error: '' }, gpu: null, serverDirs: null, serverFiles: null, checking: false, checkedAt: 0 };
  const jobs = new Map(); // id -> { progress, done, total, error, controller, installing }

  const base = () => config.base ? { dir: config.base, source: 'chosen' } : desktopBase(env) ? { dir: desktopBase(env), source: 'desktop' } : cliBase(env) ? { dir: cliBase(env), source: 'comfy-cli' } : { dir: '', source: '' };
  // Thư mục đích của một loại model: server đang chạy báo đường dẫn thật (kể cả extra_model_paths) thì dùng; không thì <base>/models/<dir>.
  function dirOf(kind) {
    const fromServer = state.serverDirs?.[kind]?.[0];
    if (fromServer) return fromServer;
    const modelsRoot = modelsRootOf(base().dir);
    return modelsRoot ? path.join(modelsRoot, kind) : '';
  }
  const hasFile = file => { const dir = dirOf(file.dir); return Boolean(dir && fs.existsSync(path.join(dir, file.name))) || Boolean(state.serverFiles?.[file.dir]?.includes(file.name)); };
  const installed = model => model.files.every(hasFile);

  async function probeServer() {
    const urls = [...new Set([config.url, ...DEFAULT_URLS].filter(Boolean))];
    for (const url of urls) {
      try {
        const stats = await getJson(url + '/system_stats');
        const device = (stats.devices || []).find(item => item.type === 'cuda') || stats.devices?.[0];
        const gpu = device?.vram_total ? { name: String(device.name || '').replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*\w+$/, ''), vramGb: Math.round(device.vram_total / 2 ** 30 * 10) / 10 } : null;
        // /internal/folder_paths: { checkpoints: [[đường dẫn…], [đuôi…]], … }; bản cũ không có thì dùng thư mục người dùng chọn.
        let dirs = null; try { const raw = await getJson(url + '/internal/folder_paths'); dirs = Object.fromEntries(Object.entries(raw).map(([kind, value]) => [kind, Array.isArray(value?.[0]) ? value[0] : Array.isArray(value) ? value : []])); } catch {}
        const files = {}; for (const kind of MODEL_DIRS) { try { const list = await getJson(`${url}/models/${kind}`); if (Array.isArray(list)) files[kind] = list.map(name => path.basename(String(name))); } catch {} }
        return { ok: true, url, version: stats.system?.comfyui_version || '', gpu, dirs, files };
      } catch {}
    }
    return { ok: false, url: config.url || DEFAULT_URLS[0] };
  }
  async function refresh() {
    if (state.checking) return snapshot();
    state.checking = true; changed();
    try {
      const server = await probeServer();
      state.server = { ok: server.ok, url: server.url, version: server.version || '', error: server.ok ? '' : 'ComfyUI chưa chạy' };
      state.serverDirs = server.dirs || null; state.serverFiles = server.ok ? server.files : null;
      const gpu = server.gpu || await gpuProbe().catch(() => null);
      state.gpu = gpu ? { ...gpu, ramGb: Math.round(totalRam / 2 ** 30) } : { name: '', vramGb: 0, ramGb: Math.round(totalRam / 2 ** 30) };
    } finally { state.checking = false; state.checkedAt = Date.now(); changed(); }
    return snapshot();
  }

  function setBase(dir) {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw Error('Thư mục không tồn tại');
    config = { ...config, base: dir }; fs.mkdirSync(path.dirname(configFile), { recursive: true }); fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n'); changed();
    return snapshot();
  }

  // Kiểm tra (model hợp lệ, biết thư mục đích) chạy đồng bộ để lỗi ném ngay cho nút bấm; phần tải chạy nền trong promise trả về.
  function install(id) {
    const model = CATALOG.find(item => item.id === id); if (!model) throw Error('Model không có trong danh sách');
    if (jobs.get(id)?.installing) return Promise.resolve(snapshot());
    const missing = model.files.filter(file => !hasFile(file));
    if (!missing.length) return Promise.resolve(snapshot());
    if (missing.some(file => !dirOf(file.dir))) throw Error('Chưa biết thư mục ComfyUI: mở ComfyUI rồi bấm ↻ Kiểm tra, hoặc bấm Chọn thư mục ComfyUI');
    return runInstall(id, missing);
  }
  async function runInstall(id, missing) {
    const controller = new AbortController(), total = missing.reduce((sum, file) => sum + file.size, 0);
    const job = { installing: true, done: 0, total, error: '', controller }; jobs.set(id, job); changed();
    let shown = 0, before = 0;
    try {
      for (const file of missing) {
        const dir = dirOf(file.dir); fs.mkdirSync(dir, { recursive: true });
        await fetchFile(file.url, path.join(dir, file.name), { signal: controller.signal, progress: done => { job.done = before + done; if (job.done - shown >= total * 0.005) { shown = job.done; changed(); } } });
        before += file.size; job.done = before;
      }
    } catch (error) { job.error = error.message; }
    finally { job.installing = false; job.controller = null; changed(); }
    if (job.error) throw Error(job.error);
    jobs.delete(id); changed();
    return snapshot();
  }
  // Huỷ giữ lại tệp .part để lần cài sau tải tiếp từ chỗ dở.
  function cancel(id) { jobs.get(id)?.controller?.abort(); return snapshot(); }

  // Mở ComfyUI đã cài (launcherOf) ở cổng của URL đã lưu (mặc định 8188), tách khỏi app: đóng Office Desk không tắt ComfyUI.
  // Log ghi vào <root>/tools/comfyui.log. Trả về ngay; dò server mỗi pollMs tới khi chạy hoặc quá waitMs.
  let launching = null;
  function launch() {
    if (state.server.ok) return Promise.resolve(snapshot());
    if (launching) return launching;
    const run = launcherOf(base().dir); if (!run) throw Error('Không tìm thấy ComfyUI chạy được trong thư mục đã chọn (cần main.py và Python của ComfyUI)');
    const port = (() => { try { return new URL(config.url || DEFAULT_URLS[0]).port || '8188'; } catch { return '8188'; } })();
    const logFile = path.join(root, 'tools', 'comfyui.log'); fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.openSync(logFile, 'a');
    const args = [...(run.portable ? ['-s'] : []), run.main, '--listen', '127.0.0.1', '--port', port, ...(run.portable ? ['--windows-standalone-build'] : [])];
    let child;
    try { child = spawn(run.python, args, { cwd: run.cwd, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...env, PYTHONIOENCODING: 'utf-8' } }); }
    finally { fs.closeSync(log); }
    let exited = null; child.once?.('exit', code => { exited = code; }); child.once?.('error', error => { exited = error.message; }); child.unref?.();
    state.launch = { at: Date.now(), error: '', log: logFile }; changed();
    launching = (async () => {
      try {
        let ok = false;
        for (let waited = 0; waited < waitMs && !ok && exited === null; waited += pollMs) {
          await new Promise(resolve => setTimeout(resolve, pollMs));
          ok = (await refresh()).server.ok;
        }
        state.launch = ok ? null : { ...state.launch, error: exited !== null ? `ComfyUI thoát (${exited}); xem ${logFile}` : `ComfyUI chưa lên sau ${Math.round(waitMs / 1000)} giây; xem ${logFile}` };
      } finally { launching = null; changed(); }
      return snapshot();
    })();
    return launching;
  }

  function models() {
    return CATALOG.map(model => {
      const job = jobs.get(model.id);
      return { id: model.id, name: model.name, family: model.family, addon: Boolean(model.addon), use: model.use, license: model.license, minVram: model.minVram, ramGb: model.ramGb,
        sizeGb: gb(sizeOf(model)), installed: installed(model), fit: fitOf(model, state.gpu), recommended: recommended(state.gpu).includes(model.id),
        installing: Boolean(job?.installing), progress: job?.total ? Math.min(1, job.done / job.total) : 0, error: job?.error || '' };
    });
  }
  const snapshot = () => { const where = base(); return { server: { ...state.server }, gpu: state.gpu, checking: state.checking, checkedAt: state.checkedAt, base: where.dir, baseSource: where.source, launchable: Boolean(launcherOf(where.dir)), launching: Boolean(launching), launchError: state.launch?.error || '', modelsDir: state.serverDirs?.checkpoints?.[0] ? path.dirname(state.serverDirs.checkpoints[0]) : modelsRootOf(where.dir), models: models(), downloadPage: DOWNLOAD_PAGE }; };

  // comfy.json cho kit comfy.py trong project: server + preset của model đã cài (tên tệp đúng như ComfyUI liệt kê).
  function projectConfig() {
    const list = CATALOG.filter(installed).map(model => ({ id: model.id, name: model.name, family: model.family, addon: Boolean(model.addon), use: model.use,
      files: Object.fromEntries(model.files.map(file => [file.dir, file.name])), ...model.gen }));
    return { server: state.server.ok ? state.server.url : config.url || '', servers: [...new Set([config.url, state.server.url, ...DEFAULT_URLS].filter(Boolean))], gpu: state.gpu, models: list };
  }
  function writeProjectConfig(artDir) {
    const file = path.join(artDir, 'comfy.json'), data = projectConfig();
    fs.mkdirSync(artDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    return data;
  }

  return { refresh, setBase, install, cancel, launch, state: snapshot, projectConfig, writeProjectConfig, dirOf };
}

module.exports = { CATALOG, MODEL_DIRS, DEFAULT_URLS, DOWNLOAD_PAGE, createComfy, fitOf, recommended, modelsRootOf, desktopBase, cliBase, cliConfigDir, launcherOf, download, nvidiaGpu, sizeOf };
