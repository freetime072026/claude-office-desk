// Cấu hình build của khối Release cho project dùng @smoud/playable-scripts (build.json có "networks" và "tracking").
// Khối chưa lưu cấu hình riêng thì theo build.json của project; đã lưu (thread.workers[nhãn].release) thì app ghi các giá trị
// đó vào build.json trước mỗi lượt Release, Release commit build.json cùng bản gửi. Chế độ: Production = tracking.env
// "production", Preview = "test" (collector ghi vào bucket test); adapter network build như nhau.
const fs = require('node:fs');
const path = require('node:path');
// Network của playable-scripts 1.1.4 (allowedAdNetworks), bỏ 'preview' vì không phải network gửi.
const NETWORKS = Object.freeze(['applovin', 'unity', 'google', 'ironsource', 'facebook', 'moloco', 'adcolony', 'mintegral', 'vungle', 'tapjoy', 'snapchat', 'tiktok', 'appreciate', 'chartboost', 'pangle', 'mytarget', 'liftoff', 'smadex', 'adikteev', 'bigabid', 'inmobi']);
const ENVS = Object.freeze(['production', 'test']);
const FILE = 'build.json';
const ID = /^[A-Za-z0-9._-]{1,120}$/, APP = /^[^\\/:*?"<>|\r\n]{1,80}$/;
const LABELS = { networks: 'network đích', env: 'chế độ', playableId: 'playable_id', packageName: 'package name', app: 'tên app', googlePlayUrl: 'Google Play URL', appStoreUrl: 'App Store URL' };
const envName = env => env === 'test' ? 'Preview (tracking.env "test")' : 'Production (tracking.env "production")';
function load(folder) {
  if (!folder) return null; const file = path.join(folder, FILE);
  let raw; try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let data; try { data = JSON.parse(raw); } catch { return null; }
  if (!data || !Array.isArray(data.networks) || !data.tracking || typeof data.tracking !== 'object') return null;
  return { file, raw, data };
}
const fromData = data => ({ networks: data.networks.filter(name => NETWORKS.includes(name)), env: data.tracking.env === 'test' ? 'test' : 'production', playableId: String(data.tracking.playable_id || ''), packageName: String(data.tracking.package_name || ''), app: String(data.app || ''), googlePlayUrl: String(data.google_play_url || ''), appStoreUrl: String(data.app_store_url || '') });
// Giá trị đang có trong build.json; null khi thư mục không phải project playable-scripts (panel ẩn mục này).
function read(folder) { const loaded = load(folder); return loaded && fromData(loaded.data); }
function url(value, label) {
  let parsed; try { parsed = new URL(String(value).trim()); } catch { throw Error(label + ' không hợp lệ'); }
  if (parsed.protocol !== 'https:' || parsed.href.length > 500) throw Error(label + ' phải là link https');
  return String(value).trim();
}
function validate(config) {
  if (!config || typeof config !== 'object') throw Error('Cấu hình build không hợp lệ');
  if (!Array.isArray(config.networks) || !config.networks.every(name => NETWORKS.includes(name))) throw Error('Network đích không hợp lệ');
  const networks = NETWORKS.filter(name => config.networks.includes(name)); if (!networks.length) throw Error('Chọn ít nhất một network đích');
  if (!ENVS.includes(config.env)) throw Error('Chế độ build phải là Preview hoặc Production');
  const playableId = String(config.playableId || '').trim(), packageName = String(config.packageName || '').trim(), app = String(config.app || '').trim();
  if (!ID.test(playableId)) throw Error('playable_id chỉ gồm chữ, số, . _ -');
  if (!ID.test(packageName)) throw Error('Package name chỉ gồm chữ, số, . _ -');
  if (!APP.test(app)) throw Error('Tên app trống, quá dài hoặc có ký tự không dùng được trong tên tệp');
  return { networks, env: config.env, playableId, packageName, app, googlePlayUrl: url(config.googlePlayUrl, 'Google Play URL'), appStoreUrl: url(config.appStoreUrl, 'App Store URL') };
}
// Ghi cấu hình của khối vào build.json, giữ các khoá khác, thụt lề và kiểu xuống dòng của tệp. Trả về tên các mục đã đổi.
function apply(folder, config) {
  const loaded = load(folder); if (!loaded) throw Error('Không đọc được build.json của project');
  const before = fromData(loaded.data), changed = Object.keys(LABELS).filter(key => JSON.stringify(before[key]) !== JSON.stringify(config[key]));
  if (!changed.length) return [];
  const { data } = loaded;
  Object.assign(data, { app: config.app, google_play_url: config.googlePlayUrl, app_store_url: config.appStoreUrl, networks: config.networks });
  Object.assign(data.tracking, { package_name: config.packageName, playable_id: config.playableId, env: config.env });
  const indent = /^([ \t]+)"/m.exec(loaded.raw)?.[1] || 2, eol = loaded.raw.includes('\r\n') ? '\r\n' : '\n';
  const text = JSON.stringify(data, null, indent).replace(/\n/g, eol) + (/\r?\n$/.test(loaded.raw) ? eol : '');
  fs.writeFileSync(loaded.file, text); return changed.map(key => LABELS[key]);
}
// Trước lượt Release: khối có cấu hình riêng thì ghi vào build.json; prompt nhận cấu hình đang dùng. '' khi không phải project
// playable-scripts.
function prepare(folder, config) {
  const current = read(folder); if (!current) return '';
  const used = config ? validate(config) : current, changed = config ? apply(folder, used) : [];
  const lines = [`Cấu hình build (${FILE}, ${config ? 'theo cấu hình của khối' : 'theo tệp của project'}): network đích ${used.networks.join(', ')}; chế độ ${envName(used.env)}; playable_id ${used.playableId}; package name ${used.packageName}; tên app ${used.app}; Google Play ${used.googlePlayUrl}; App Store ${used.appStoreUrl}. Đóng gói đúng các network này bằng lệnh có sẵn của project (npm run build đọc networks trong ${FILE}); bảng kết quả trong RELEASE.md ghi đủ từng network và chế độ build.`];
  if (changed.length) lines.push(`App vừa ghi ${FILE} (đổi: ${changed.join(', ')}): commit ${FILE} cùng bản gửi; không tự sửa lại ${FILE}.`);
  return lines.join('\n');
}
module.exports = { NETWORKS, ENVS, FILE, read, validate, apply, prepare };
