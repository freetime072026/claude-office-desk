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
// ---- Script gọi Unity-Skills đặt tại <project>/.office-desk/unity.sh (chạy bằng Git Bash, chỉ cần curl/awk/grep).
// Mỗi lần gọi: lấy cổng hiện tại từ sổ đăng ký ~/.unity_skills/registry.json (dò 8090–8100 nếu không có), kiểm /health
// đúng tên project, chờ khi Unity đang compile/nạp lại domain (vào/ra Play Mode), luôn có timeout. Cổng đổi giữa chừng không sao.
const HELPER = 'unity.sh';
const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const helperPath = folder => path.join(folder, '.office-desk', HELPER);
function helperScript(info) {
  return `#!/usr/bin/env bash
# Office Desk tạo tự động; không sửa tay (bị ghi đè). Gọi Unity-Skills của project ${info.productName}.
# Dùng:  bash .office-desk/${HELPER} GET /health
#        bash .office-desk/${HELPER} GET '/skills/recommend?intent=console%20errors&topN=3'
#        bash .office-desk/${HELPER} POST /skill/<tên> '<json>'
#        bash .office-desk/${HELPER} wait-compile     (sau khi sửa xong các tệp .cs: chờ Unity compile + nạp lại, in lỗi compile)
# Cả lệnh gói trong ~110 s (dưới giới hạn 120 s của Bash). Việc lâu (test, build): UNITY_TIMEOUT=600 và đặt timeout của Bash lớn hơn.
PROJECT_KEY=${shellQuote(JSON.stringify(info.folder.replace(/\//g, '\\')).slice(1, -1))}
PROJECT_NAME=${shellQuote(info.productName)}
EXPECT=${shellQuote(encodeURIComponent(info.productName))}
REGISTRY="\${UNITY_SKILLS_REGISTRY:-$HOME/.unity_skills/registry.json}"
FIRST_PORT="\${UNITY_FIRST_PORT:-8090}"; LAST_PORT="\${UNITY_LAST_PORT:-8100}"
WAIT="\${UNITY_WAIT:-90}"; TIMEOUT="\${UNITY_TIMEOUT:-}"
method="\${1:-GET}"; route="\${2:-/health}"; body="\${3:-}"
case "$route" in /*) ;; *) route="/$route" ;; esac

# Cổng trả /health đúng project và không đang compile/nạp lại thì dùng được; why giữ lý do lần dò cuối để báo khi hết giờ.
why='chưa thấy Unity-Skills của project (Editor đóng hoặc server tắt)'
ready() { local h; h=$(curl -s --max-time 3 "http://127.0.0.1:$1/health") || return 1
  printf '%s' "$h" | grep -qF "\\"projectName\\":\\"$PROJECT_NAME\\"" || return 1
  printf '%s' "$h" | grep -qE '"isCompiling":true' && { why='Unity đang compile'; return 1; }
  printf '%s' "$h" | grep -qE '"isUpdating":true' && { why='Unity đang import asset'; return 1; }
  printf '%s' "$h" | grep -qE '"domainReloadPending":true' && { why='Unity sắp nạp lại domain'; return 1; }; return 0; }
# Khoá trong sổ đăng ký là đường dẫn JSON-escaped (E:\\\\Game); truyền qua ENVIRON vì awk -v tự xử lý dấu \\.
registry_port() { [ -f "$REGISTRY" ] && KEY="\\"$PROJECT_KEY\\": {" awk 'index($0, ENVIRON["KEY"]) { found = 1 } found && /"port"/ { gsub(/[^0-9]/, ""); print; exit }' "$REGISTRY"; }
# Gán PORT (không chạy trong subshell để giữ why). Cổng trong sổ đăng ký không trả lời thường là đang nạp lại domain.
find_port() { local p; p=$(registry_port); if [ -n "$p" ]; then ready "$p" && { PORT=$p; return 0; }
    curl -s --max-time 3 "http://127.0.0.1:$p/health" >/dev/null || why='Unity không trả lời (đang nạp lại domain, vào/ra Play Mode hoặc bị treo)'; fi
  for p in $(seq "$FIRST_PORT" "$LAST_PORT"); do ready "$p" && { PORT=$p; return 0; }; done; return 1; }
# WAIT tính từ lúc script bắt đầu (SECONDS), dùng chung cho mọi lần chờ trong một lệnh.
wait_port() { while :; do find_port && return 0; [ "$SECONDS" -ge "$WAIT" ] && return 1; sleep 3; done; }
not_ready() { echo "unity.sh: sau \${SECONDS}s Unity vẫn chưa sẵn sàng: $why. Unity ở nền vẫn tự compile/nạp lại (mỗi vòng thường dưới 1 phút): gọi lại đúng lệnh này. Nếu nhiều lần liền Unity không trả lời thì báo blocked, ghi rõ cần kiểm tra Unity." >&2; exit 3; }

# wait-compile: BackgroundAutoRefresh của project gom thay đổi rồi mới compile, nên chờ một nhịp rồi cần hai lần sẵn sàng
# cách nhau vài giây (tránh khe giữa compile và nạp lại domain), sau đó hỏi kết quả compile gần nhất.
if [ "$method" = wait-compile ]; then
  sleep 3; wait_port || not_ready; sleep 4; wait_port || not_ready
  method=POST; route=/skill/debug_check_compilation; body='{}'
fi
wait_port || not_ready
port=$PORT
[ -z "$TIMEOUT" ] && { TIMEOUT=$((110 - SECONDS)); [ "$TIMEOUT" -lt 15 ] && TIMEOUT=15; }
url="http://127.0.0.1:$port$route"
case "$route" in /skill/*|/skills/batch*) case "$route" in *\\?*) url="$url&expectProject=$EXPECT" ;; *) url="$url?expectProject=$EXPECT" ;; esac ;; esac
send() { if [ -n "$body" ]; then curl -sS --max-time "$TIMEOUT" -X "$method" -H 'Content-Type: application/json' --data-binary "$body" "$url"
  else curl -sS --max-time "$TIMEOUT" -X "$method" "$url"; fi; }
send; code=$?
# Chưa kết nối được (mã 7) thì yêu cầu chưa tới Unity: chờ Unity sẵn sàng rồi gửi lại một lần.
if [ "$code" = 7 ]; then wait_port || not_ready; port=$PORT; url=$(printf '%s' "$url" | sed "s#127.0.0.1:[0-9]*#127.0.0.1:$port#"); send; code=$?; fi
case "$code" in
  0) ;;
  28) echo "unity.sh: quá \${TIMEOUT}s chưa có kết quả. Unity có thể đang nạp lại (Play Mode/compile) và thao tác có thể đã chạy một phần: gọi GET /health rồi kiểm tra kết quả trước khi gọi lại; việc lâu thì tăng UNITY_TIMEOUT." >&2 ;;
  52|56) echo "unity.sh: Unity đóng kết nối không trả kết quả (thường do nạp lại domain). Thao tác có thể đã chạy một phần: kiểm tra kết quả trước khi gọi lại." >&2 ;;
esac
exit "$code"
`;
}
// Ghi (đè) script khi project có Unity-Skills. Trả về đường dẫn hoặc '' nếu không ghi được.
function writeHelper(info) {
  if (!info?.hasSkills) return '';
  try { const file = helperPath(info.folder); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, helperScript(info).replace(/\r\n/g, '\n')); return file; } catch { return ''; }
}
const quoted = value => `"${value}"`;
// Hướng dẫn ngắn chèn vào prompt; chỉ nêu cách đang dùng được.
function guide(info) {
  if (!info) return '';
  const head = `Project Unity ${info.version} ("${info.productName}"). Editor: ${info.editor || `chưa thấy bản ${info.version} trong Unity Hub`}.`;
  if (info.editorOpen && info.hasSkills) {
    const script = `bash "${helperPath(info.folder).replace(/\\/g, '/')}"`;
    return `${head} Editor đang mở project này: KHÔNG chạy Unity.exe -batchmode trên project (bị khoá). Gọi Unity-Skills của Editor đang mở CHỈ qua ${script} <GET|POST> <đường dẫn> ['<json>'], không curl thẳng vào cổng: cổng có thể đổi mỗi lần Unity nạp lại domain (compile, vào/ra Play Mode); script tự lấy cổng hiện tại, chờ Unity sẵn sàng, tự thêm expectProject và gói cả lệnh trong ~110 giây cho vừa giới hạn 120 giây của Bash (việc lâu như test/build: đặt UNITY_TIMEOUT=600 trước lệnh và đặt timeout của Bash 660000). Script báo "chưa sẵn sàng" (Unity đang compile/nạp lại) thì gọi lại đúng lệnh đó, không chuyển lệnh sang chạy nền. Tìm skill: ${script} GET '/skills/recommend?intent=<từ khoá>&includeSchema=true&topN=3'; gọi: ${script} POST /skill/<tên> '<json>'; nhiều bước: POST /skills/batch.${info.skillsDoc ? ` Hướng dẫn skill: ${info.skillsDoc} (đọc theo đoạn khi cần).` : ''} Unity tự compile khi tệp .cs đổi, kể cả lúc ở nền (mỗi vòng compile + nạp lại thường dưới 1 phút; không cần focus). Sửa xong mọi tệp .cs của task rồi mới gọi Unity, không gọi sau từng lần lưu; sau đó chạy ${script} wait-compile: lệnh chờ compile xong và in kết quả compile gần nhất (finishedAtUtc phải sau lần sửa cuối; lỗi ở tệp của Dev khác thì ghi vào handoff, không sửa tệp ngoài phạm vi). Không vào Play Mode khi compile chưa sạch; vào/ra Play Mode xong gọi GET /health qua script trước khi làm tiếp. Phải đọc lỗi compile/console qua API trước khi báo done.${info.port ? '' : ' Lúc bắt đầu lượt API chưa trả lời (có thể đang nạp lại): script sẽ chờ; quá thời gian thì báo blocked.'}`;
  }
  if (info.editorOpen) return `${head} Editor đang mở project này nên Unity dòng lệnh bị khoá và project chưa cài Unity-Skills. Không điều khiển được Editor thì báo blocked, ghi rõ bước cần người dùng làm trong Editor.`;
  if (!info.editor) return `${head} Editor đang đóng và chưa tìm thấy Unity.exe: báo blocked, nêu cần cài Unity ${info.version}.`;
  return `${head} Editor đang đóng: chạy ${quoted(info.editor)} -batchmode -quit -projectPath ${quoted(info.folder)} -logFile <tệp log> kèm -executeMethod <Lớp.Hàm> hoặc -runTests -testPlatform EditMode -testResults <tệp xml> (bỏ -quit khi -runTests). Lệnh có thể chạy vài phút: đặt timeout của Bash tới 600000 ms và đọc tệp log để lấy lỗi.`;
}
module.exports = { detect, health, skillsPort, context, guide, editorPaths, helperScript, writeHelper, helperPath, HELPER, SKILLS_PORTS };
