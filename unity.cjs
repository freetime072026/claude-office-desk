// Phát hiện project Unity trong thư mục session để Lead/Dev/VFX/QA biết cách gọi Unity:
// - Editor đang mở project (Temp/UnityLockfile) thì Unity dòng lệnh bị khoá → dùng Unity-Skills REST nếu có;
// - Editor đóng thì chạy Unity.exe -batchmode đúng phiên bản của project.
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const SKILLS_PACKAGE = 'com.besty.unity-skills';
const SKILLS_PORTS = [8090, 8091, 8092];
const PROBE_TIMEOUT_MS = 600;
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
function editorPaths(version, env = process.env) {
  const roots = [path.join(env.ProgramFiles || 'C:\\Program Files', 'Unity', 'Hub', 'Editor')];
  try { const secondary = JSON.parse(readText(path.join(env.APPDATA || '', 'UnityHub', 'secondaryInstallPath.json')) || '""'); if (secondary) roots.push(secondary); } catch {}
  return roots.map(root => path.join(root, version, 'Editor', 'Unity.exe'));
}
// Thông tin tĩnh, đọc từ đĩa: null nếu thư mục không phải project Unity.
function detect(folder, env = process.env) {
  if (!folder) return null;
  const version = /m_EditorVersion:\s*(\S+)/.exec(readText(path.join(folder, 'ProjectSettings', 'ProjectVersion.txt')))?.[1];
  if (!version) return null;
  const productName = /productName:\s*(.+)/.exec(readText(path.join(folder, 'ProjectSettings', 'ProjectSettings.asset')))?.[1]?.trim() || path.basename(folder);
  const editor = editorPaths(version, env).find(file => fs.existsSync(file)) || '';
  const hasSkills = readText(path.join(folder, 'Packages', 'manifest.json')).includes(`"${SKILLS_PACKAGE}"`);
  let skillsDoc = '';
  if (hasSkills) { try { const cache = path.join(folder, 'Library', 'PackageCache'); const dir = fs.readdirSync(cache).find(name => name.startsWith(SKILLS_PACKAGE)); const doc = dir && path.join(cache, dir, 'unity-skills~', 'SKILL.md'); if (doc && fs.existsSync(doc)) skillsDoc = doc; } catch {} }
  return { folder, version, productName, editor, editorOpen: fs.existsSync(path.join(folder, 'Temp', 'UnityLockfile')), hasSkills, skillsDoc };
}
function health(port, timeout = PROBE_TIMEOUT_MS) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port, path: '/health', timeout }, response => { let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { if (body.length < 20000) body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } }); });
    request.on('timeout', () => { request.destroy(); resolve(null); }); request.on('error', () => resolve(null));
  });
}
// Tìm cổng Unity-Skills của đúng project (so tên productName với projectName của /health).
async function skillsPort(productName, ports = SKILLS_PORTS) {
  for (const port of ports) { const status = await health(port); if (status?.status === 'ok' && status.projectName === productName) return port; }
  return 0;
}
async function context(folder, options = {}) {
  const info = detect(folder, options.env); if (!info) return null;
  info.port = info.hasSkills && info.editorOpen ? await skillsPort(info.productName, options.ports) : 0;
  return info;
}
const quoted = value => `"${value}"`;
// Hướng dẫn ngắn chèn vào prompt; chỉ nêu cách đang dùng được.
function guide(info) {
  if (!info) return '';
  const head = `Project Unity ${info.version} ("${info.productName}"). Editor: ${info.editor || `chưa thấy bản ${info.version} trong Unity Hub`}.`;
  if (info.editorOpen && info.port) {
    const base = `http://127.0.0.1:${info.port}`, guard = `expectProject=${encodeURIComponent(info.productName)}`;
    return `${head} Editor đang mở project này: KHÔNG chạy Unity.exe -batchmode trên project (bị khoá). Điều khiển Editor đang mở qua Unity-Skills bằng curl: GET ${base}/health; tìm skill bằng GET ${base}/skills/recommend?intent=<từ khoá>&includeSchema=true&topN=3; gọi POST ${base}/skill/<tên>?${guard} với JSON; nhiều bước dùng POST ${base}/skills/batch?${guard}.${info.skillsDoc ? ` Hướng dẫn: ${info.skillsDoc} (đọc theo đoạn khi cần).` : ''} Sau khi sửa C# phải refresh/compile và đọc lỗi console qua API trước khi báo done.`;
  }
  if (info.editorOpen) return `${head} Editor đang mở project này nên Unity dòng lệnh bị khoá${info.hasSkills ? '; Unity-Skills đã cài nhưng API không phản hồi ở cổng 8090–8092 (Editor có thể đang reload hoặc server tắt): thử GET http://127.0.0.1:8090/health sau vài giây' : ' và project chưa cài Unity-Skills'}. Không điều khiển được Editor thì báo blocked, ghi rõ bước cần người dùng làm trong Editor.`;
  if (!info.editor) return `${head} Editor đang đóng và chưa tìm thấy Unity.exe: báo blocked, nêu cần cài Unity ${info.version}.`;
  return `${head} Editor đang đóng: chạy ${quoted(info.editor)} -batchmode -quit -projectPath ${quoted(info.folder)} -logFile <tệp log> kèm -executeMethod <Lớp.Hàm> hoặc -runTests -testPlatform EditMode -testResults <tệp xml> (bỏ -quit khi -runTests). Lệnh có thể chạy vài phút: đặt timeout của Bash tới 600000 ms và đọc tệp log để lấy lỗi.`;
}
module.exports = { detect, health, skillsPort, context, guide, editorPaths, SKILLS_PORTS };
