const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test'); const assert = require('node:assert/strict');
const comfy = require('../comfyui.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-'));
const noServer = async () => { throw Error('ECONNREFUSED'); };
const GTX1660 = async () => ({ name: 'NVIDIA GeForce GTX 1660 SUPER', vramGb: 6 });
const RTX3060 = async () => ({ name: 'NVIDIA GeForce RTX 3060', vramGb: 12 });
const GB = 2 ** 30;

test('catalog: Hugging Face URLs, commercial-friendly licenses, valid ComfyUI folders, files match the family', () => {
  const ids = new Set();
  for (const model of comfy.CATALOG) {
    assert(!ids.has(model.id), model.id); ids.add(model.id);
    assert(['OpenRAIL++', 'OpenRAIL-M', 'Apache 2.0', 'BSD-3'].includes(model.license), model.id);
    assert(['sdxl', 'zimage', 'qwen', 'lora', 'upscale'].includes(model.family), model.id);
    assert.equal(Boolean(model.addon), ['lora', 'upscale'].includes(model.family), model.id);
    for (const file of model.files) { assert.match(file.url, /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\//); assert(file.url.endsWith('/' + file.name), file.name); assert(file.size > 1e7); }
  }
  assert.deepEqual([...comfy.MODEL_DIRS].sort(), ['checkpoints', 'diffusion_models', 'loras', 'text_encoders', 'upscale_models', 'vae']);
  // comfy.py dựng workflow từ các khoá này.
  for (const model of comfy.CATALOG.filter(item => item.family === 'sdxl')) assert.deepEqual(model.files.map(file => file.dir), ['checkpoints']);
  for (const model of comfy.CATALOG.filter(item => ['zimage', 'qwen'].includes(item.family))) assert.deepEqual(model.files.map(file => file.dir).sort(), ['diffusion_models', 'text_encoders', 'vae']);
});

test('fit and recommendation follow the GPU: 6 GB gets SDXL, 12 GB adds Z-Image; Qwen-Image needs lots of RAM', () => {
  const byId = id => comfy.CATALOG.find(model => model.id === id);
  const small = { vramGb: 6, ramGb: 16 }, mid = { vramGb: 12, ramGb: 32 };
  assert.equal(comfy.fitOf(byId('dreamshaper-xl-lightning'), small), 'ok');
  assert.equal(comfy.fitOf(byId('z-image-turbo'), small), 'no'); // ~20 GB tệp, card 6 GB + RAM 16 GB không gánh nổi
  assert.equal(comfy.fitOf(byId('z-image-turbo'), { vramGb: 6, ramGb: 32 }), 'slow');
  assert.equal(comfy.fitOf(byId('qwen-image'), small), 'no');
  assert.equal(comfy.fitOf(byId('qwen-image'), { vramGb: 6, ramGb: 64 }), 'no'); // 30 GB model: card 6 GB không chạy nổi dù RAM nhiều
  assert.equal(comfy.fitOf(byId('z-image-turbo'), mid), 'ok');
  assert.equal(comfy.fitOf(byId('qwen-image'), mid), 'slow');
  assert.equal(comfy.fitOf(byId('qwen-image'), { vramGb: 12, ramGb: 64 }), 'ok');
  assert.equal(comfy.fitOf(byId('z-image-turbo'), { vramGb: 0 }), 'unknown');
  assert(!comfy.recommended(small).includes('z-image-turbo')); assert(comfy.recommended(small).includes('dreamshaper-xl-lightning'));
  assert.equal(comfy.recommended(mid)[0], 'z-image-turbo');
});

test('without a running server: GPU from nvidia-smi, folder from the chosen ComfyUI dir (saved), install downloads only missing files into models/<dir>', async () => {
  const root = temp(), base = temp(); fs.mkdirSync(path.join(base, 'models', 'checkpoints'), { recursive: true });
  const calls = [];
  const fakeDownload = async (url, target, { progress }) => { calls.push(target); progress(10); fs.writeFileSync(target, 'x'); return target; };
  const tool = comfy.createComfy({ root, fetchJson: noServer, gpuProbe: GTX1660, download: fakeDownload, env: {}, totalRam: 16 * GB });
  let state = await tool.refresh();
  assert.equal(state.server.ok, false); assert.equal(state.gpu.vramGb, 6); assert.equal(state.gpu.ramGb, 16); assert.equal(state.base, '');
  assert.throws(() => tool.install('dreamshaper-xl-lightning'), /Chưa biết thư mục ComfyUI/);
  tool.setBase(base);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tools', 'comfyui.json'), 'utf8')).base, base);
  state = tool.state(); assert.equal(state.modelsDir, path.join(base, 'models'));
  const model = state.models.find(item => item.id === 'dreamshaper-xl-lightning');
  assert.equal(model.installed, false); assert.equal(model.recommended, true); assert.equal(model.fit, 'ok'); assert.equal(model.sizeGb, 6.9);
  await tool.install('z-image-turbo');
  assert.deepEqual(calls.map(file => path.relative(base, file)).sort(), [path.join('models', 'diffusion_models', 'z_image_turbo_bf16.safetensors'), path.join('models', 'text_encoders', 'qwen_3_4b.safetensors'), path.join('models', 'vae', 'ae.safetensors')].sort());
  assert.equal(tool.state().models.find(item => item.id === 'z-image-turbo').installed, true);
  // Đã có tệp thì không tải lại.
  calls.length = 0; await tool.install('z-image-turbo'); assert.equal(calls.length, 0);
  // Mở lại app vẫn nhớ thư mục đã chọn.
  assert.equal(comfy.createComfy({ root, fetchJson: noServer, gpuProbe: GTX1660, env: {} }).state().base, base);
  assert.throws(() => tool.install('midjourney'), /không có trong danh sách/);
});

test('running server: GPU, model folders and installed files come from the ComfyUI API (Desktop port 8000 is probed too)', async () => {
  const root = temp(), models = temp();
  const responses = {
    'http://127.0.0.1:8000/system_stats': { system: { comfyui_version: '0.4.1' }, devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync', type: 'cuda', vram_total: 12 * GB }] },
    'http://127.0.0.1:8000/internal/folder_paths': { checkpoints: [[path.join(models, 'checkpoints')], ['.safetensors']], loras: [[path.join(models, 'loras')], ['.safetensors']] },
    'http://127.0.0.1:8000/models/checkpoints': ['sub/DreamShaperXL_Lightning.safetensors'],
  };
  const fetchJson = async url => { if (url in responses) return responses[url]; throw Error('404 ' + url); };
  const tool = comfy.createComfy({ root, fetchJson, gpuProbe: async () => { throw Error('should not probe'); }, env: {}, totalRam: 32 * GB });
  const state = await tool.refresh();
  assert.deepEqual(state.server, { ok: true, url: 'http://127.0.0.1:8000', version: '0.4.1', error: '' });
  assert.deepEqual(state.gpu, { name: 'NVIDIA GeForce RTX 3060', vramGb: 12, ramGb: 32 });
  assert.equal(tool.dirOf('loras'), path.join(models, 'loras'));
  assert.equal(state.models.find(item => item.id === 'dreamshaper-xl-lightning').installed, true);
  assert.equal(state.models.find(item => item.id === 'z-image-turbo').recommended, true);
  // comfy.json cho kit: server đang chạy + preset model đã cài.
  const artDir = path.join(temp(), 'art'); const config = tool.writeProjectConfig(artDir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(artDir, 'comfy.json'), 'utf8')), JSON.parse(JSON.stringify(config)));
  assert.equal(config.server, 'http://127.0.0.1:8000'); assert.deepEqual(config.models.map(item => item.id), ['dreamshaper-xl-lightning']);
  assert.deepEqual(config.models[0].files, { checkpoints: 'DreamShaperXL_Lightning.safetensors' }); assert.equal(config.models[0].steps, 6);
});

test('install runs in the background with progress, can be cancelled and reports the error', async () => {
  const root = temp(), base = temp();
  const download = (url, target, { signal, progress }) => new Promise((resolve, reject) => { progress(0.16e9); signal.addEventListener('abort', () => reject(Error('Đã huỷ'))); });
  const tool = comfy.createComfy({ root, fetchJson: noServer, gpuProbe: RTX3060, download, env: {} });
  tool.setBase(base);
  const run = tool.install('pixel-art-xl');
  let model = tool.state().models.find(item => item.id === 'pixel-art-xl');
  assert.equal(model.installing, true); assert(model.progress > 0.9 && model.progress <= 1, String(model.progress));
  tool.cancel('pixel-art-xl');
  await assert.rejects(run, /Đã huỷ/);
  model = tool.state().models.find(item => item.id === 'pixel-art-xl');
  assert.equal(model.installing, false); assert.equal(model.error, 'Đã huỷ');
});

test('modelsRootOf accepts the ComfyUI root or the models folder itself; desktopBase reads the ComfyUI Desktop config', () => {
  const base = temp(); fs.mkdirSync(path.join(base, 'models'));
  assert.equal(comfy.modelsRootOf(base), path.join(base, 'models'));
  assert.equal(comfy.modelsRootOf(path.join(base, 'models')), path.join(base, 'models'));
  const appData = temp(); fs.mkdirSync(path.join(appData, 'ComfyUI')); fs.writeFileSync(path.join(appData, 'ComfyUI', 'config.json'), JSON.stringify({ basePath: 'D:\\ComfyUI' }));
  assert.equal(comfy.desktopBase({ APPDATA: appData }), 'D:\\ComfyUI');
  assert.equal(comfy.desktopBase({ APPDATA: temp() }), '');
});

test('launcherOf finds a runnable ComfyUI: git/comfy-cli install with .venv, portable root or its ComfyUI folder; models-only or no Python is null', () => {
  const touch = (...parts) => { const file = path.join(...parts); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; };
  const cli = temp(); touch(cli, 'main.py'); assert.equal(comfy.launcherOf(cli, 'win32'), null);
  const venvPython = touch(cli, '.venv', 'Scripts', 'python.exe');
  assert.deepEqual(comfy.launcherOf(cli, 'win32'), { python: venvPython, main: path.join(cli, 'main.py'), cwd: cli, portable: false });
  const portable = temp(), embedded = touch(portable, 'python_embeded', 'python.exe'); touch(portable, 'ComfyUI', 'main.py');
  assert.deepEqual(comfy.launcherOf(portable, 'win32'), { python: embedded, main: path.join(portable, 'ComfyUI', 'main.py'), cwd: path.join(portable, 'ComfyUI'), portable: true });
  assert.equal(comfy.launcherOf(path.join(portable, 'ComfyUI'), 'win32').python, embedded);
  const models = temp(); fs.mkdirSync(path.join(models, 'checkpoints')); assert.equal(comfy.launcherOf(models, 'win32'), null);
});

test('launch starts ComfyUI detached on the saved port and polls until the server answers', async () => {
  const root = temp(), base = temp(); fs.writeFileSync(path.join(base, 'main.py'), ''); fs.mkdirSync(path.join(base, '.venv', 'Scripts'), { recursive: true }); fs.writeFileSync(path.join(base, '.venv', 'Scripts', 'python.exe'), '');
  let up = false; const spawned = [];
  const fetchJson = async url => { if (!up) throw Error('down'); if (url.endsWith('/system_stats')) return { system: { comfyui_version: '0.45.0' }, devices: [] }; throw Error('n/a'); };
  const spawn = (file, args, options) => { spawned.push({ file, args, options }); setTimeout(() => { up = true; }, 5); return { once() {}, unref() {} }; };
  const tool = comfy.createComfy({ root, fetchJson, gpuProbe: async () => null, env: {}, spawn, pollMs: 10, waitMs: 2000 });
  tool.setBase(base);
  assert.equal(tool.state().launchable, true);
  const pending = tool.launch(); assert.equal(tool.state().launching, true);
  assert.equal(tool.launch(), pending); // bấm lại khi đang mở không chạy thêm tiến trình
  const state = await pending;
  assert.equal(state.server.ok, true); assert.equal(state.launching, false); assert.equal(spawned.length, 1);
  assert.equal(spawned[0].file, path.join(base, '.venv', 'Scripts', 'python.exe'));
  assert.deepEqual(spawned[0].args, [path.join(base, 'main.py'), '--listen', '127.0.0.1', '--port', '8188']);
  assert.equal(spawned[0].options.detached, true); assert.equal(spawned[0].options.cwd, base);
  // Server đã chạy: không mở thêm.
  await tool.launch(); assert.equal(spawned.length, 1);
  // Thư mục không chạy được: báo lỗi thay vì mở.
  const empty = comfy.createComfy({ root: temp(), fetchJson, env: {} }); empty.setBase(temp());
  assert.equal(empty.state().launchable, false); assert.throws(() => empty.launch(), /Không tìm thấy ComfyUI/);
});

test('cliBase finds a ComfyUI installed with comfy-cli: default_workspace first, then recent_workspace; missing folders are skipped', () => {
  const local = temp(), dir = path.join(local, 'comfy-cli'), ini = text => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'config.ini'), text); };
  const env = { LOCALAPPDATA: local }, recent = temp(), chosen = temp();
  assert.equal(comfy.cliConfigDir(env, 'win32'), dir);
  assert.equal(comfy.cliBase(env, 'win32'), '');
  ini(`[DEFAULT]\nrecent_workspace = ${recent}\n`); assert.equal(comfy.cliBase(env, 'win32'), recent);
  ini(`[DEFAULT]\ndefault_workspace = ${chosen}\nrecent_workspace = ${recent}\n`); assert.equal(comfy.cliBase(env, 'win32'), chosen);
  ini(`[DEFAULT]\ndefault_workspace = ${path.join(chosen, 'gone')}\nrecent_workspace = ${recent}\n`); assert.equal(comfy.cliBase(env, 'win32'), recent);
  // Office Desk dùng workspace comfy-cli khi chưa chọn thư mục và không có ComfyUI Desktop.
  ini(`[DEFAULT]\ndefault_workspace = ${chosen}\n`);
  const state = comfy.createComfy({ root: temp(), env: { ...env, APPDATA: temp() } }).state();
  if (process.platform === 'win32') { assert.equal(state.base, chosen); assert.equal(state.baseSource, 'comfy-cli'); }
});

// comfy.py (kit): dựng workflow đúng node của ComfyUI theo family; chỉ chạy khi máy có Python.
const PYTHON = ['python', 'python3', 'py'].find(cmd => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0);
test('comfy.py builds SDXL (LoRA, --fast) and Z-Image workflows from comfy.json', { skip: !PYTHON && 'no python' }, () => {
  const dir = temp(), script = path.join(__dirname, '..', 'kits', 'art-frames', 'comfy.py');
  const pick = ids => comfy.CATALOG.filter(model => ids.includes(model.id)).map(model => ({ id: model.id, family: model.family, addon: Boolean(model.addon), files: Object.fromEntries(model.files.map(file => [file.dir, file.name])), ...model.gen }));
  const config = path.join(dir, 'comfy.json'); fs.writeFileSync(config, JSON.stringify({ server: '', servers: [], models: pick(['dreamshaper-xl-lightning', 'animagine-xl-4', 'z-image-turbo', 'pixel-art-xl', 'sdxl-lightning-lora']) }));
  const exec = args => spawnSync(PYTHON, ['-B', script, '--config', config, ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const run = args => { const result = exec(args); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
  const sdxl = run(['gen', '--model', 'dreamshaper-xl-lightning', '--prompt', 'a red potion', '--lora', 'pixel-art-xl', '--seed', '7', '--out', 'x.png', '--dry-run']);
  assert.equal(sdxl['1'].class_type, 'CheckpointLoaderSimple'); assert.equal(sdxl['1'].inputs.ckpt_name, 'DreamShaperXL_Lightning.safetensors');
  assert.equal(sdxl['20'].class_type, 'LoraLoader'); assert.equal(sdxl['20'].inputs.lora_name, 'pixel-art-xl.safetensors'); assert.equal(sdxl['20'].inputs.strength_model, 1.2);
  assert.deepEqual(sdxl['8'].inputs.model, ['20', 0]); assert.equal(sdxl['8'].inputs.steps, 6); assert.equal(sdxl['8'].inputs.seed, 7); assert.match(sdxl['6'].inputs.text, /watermark/);
  const fast = run(['gen', '--model', 'animagine-xl-4', '--prompt', 'chibi knight', '--fast', '--out', 'x.png', '--dry-run']);
  assert.equal(fast['8'].inputs.steps, 4); assert.equal(fast['8'].inputs.cfg, 1); assert.equal(fast['8'].inputs.scheduler, 'sgm_uniform'); assert.equal(fast['20'].inputs.lora_name, 'sdxl_lightning_4step_lora.safetensors');
  const zimage = run(['gen', '--model', 'z-image-turbo', '--prompt', 'A knight', '--width', '768', '--out', 'x.png', '--dry-run']);
  assert.equal(zimage['1'].class_type, 'UNETLoader'); assert.equal(zimage['2'].inputs.type, 'lumina2'); assert.equal(zimage['4'].class_type, 'ModelSamplingAuraFlow');
  assert.equal(zimage['7'].class_type, 'EmptySD3LatentImage'); assert.equal(zimage['7'].inputs.width, 768); assert.equal(zimage['8'].inputs.cfg, 1); assert.equal(zimage['8'].inputs.sampler_name, 'res_multistep');
  // Model chưa cài: báo rõ danh sách đã cài.
  const missing = exec(['gen', '--model', 'qwen-image', '--prompt', 'x', '--out', 'x.png', '--dry-run']);
  assert.notEqual(missing.status, 0); assert.match(missing.stderr, /chưa cài.*dreamshaper-xl-lightning/);
});
