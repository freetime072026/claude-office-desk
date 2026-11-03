// Tải skill từ GitHub (/skills add|update|remove). Chỉ tải và đọc: không chạy gì trong repo. Mỗi skill được kiểm tra trước
// khi cài (audit: nội dung, tệp, giới hạn kích thước) và repo được đánh giá độ tin cậy qua GitHub API (reputation).
// Skill mới không tự bật cho role hay chat thường: người dùng đọc SKILL.md rồi tự bật.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { frontmatter, NAME, SOURCE_FILE } = require('./skills.cjs');
const TRUSTED_OWNERS = Object.freeze(['anthropics']);
const LIMITS = Object.freeze({ repoKb: 100 * 1024, skillBytes: 10 * 1024 * 1024, files: 300, scanBytes: 1024 * 1024, skillMd: 50 * 1024, skillsPerAdd: 30, depth: 5, findingsShown: 8 });
const GIT_TIMEOUT_MS = 180000, API_TIMEOUT_MS = 10000;

// ---- Nguồn: https://github.com/<owner>/<repo>[.git][/tree|blob/<ref>/<đường dẫn>]. Ref chứa "/" không hỗ trợ.
function parseSource(url) {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?(?:\/(?:tree|blob)\/([A-Za-z0-9._-]{1,100})(?:\/([^?#]*?))?)?\/?(?:[?#].*)?$/.exec(String(url || '').trim());
  if (!match || ['.', '..'].includes(match[2])) throw Error('Chỉ nhận link GitHub dạng https://github.com/<owner>/<repo> hoặc .../tree/<nhánh>/<thư mục skill>');
  let subpath = decodeURIComponent(match[4] || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (/(^|\/)SKILL\.md$/i.test(subpath)) subpath = path.posix.dirname(subpath).replace(/^\.$/, '');
  if (subpath.split('/').some(part => part === '..' || part === '.git')) throw Error('Đường dẫn trong repo không hợp lệ');
  const [owner, repo, ref = ''] = match.slice(1);
  return { owner, repo, ref, subpath, repoName: owner + '/' + repo, cloneUrl: `https://github.com/${owner}/${repo}.git`, url: `https://github.com/${owner}/${repo}` + (ref ? `/tree/${ref}` + (subpath ? '/' + subpath : '') : '') };
}

// ---- Tải: clone nông, không tag, không submodule, không LFS, symlink thành tệp thường; không hỏi đăng nhập.
const run = (args, cwd) => new Promise((resolve, reject) => execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GCM_INTERACTIVE: 'never' } }, (error, stdout, stderr) => error ? reject(Error((stderr || error.message).trim().split(/\r?\n/).slice(-2).join(' '))) : resolve(stdout.trim())));
async function gitClone(source, target) {
  await run(['-c', 'core.symlinks=false', '-c', 'protocol.file.allow=never', 'clone', '--depth', '1', '--single-branch', '--no-tags', ...(source.ref ? ['--branch', source.ref] : []), '--', source.cloneUrl, target]);
  return run(['-C', target, 'rev-parse', 'HEAD']);
}
async function githubInfo(source) {
  const response = await fetch(`https://api.github.com/repos/${source.owner}/${source.repo}`, { headers: { 'User-Agent': 'office-desk', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) throw Error('GitHub API trả ' + response.status);
  return response.json();
}

// ---- Độ tin cậy của repo. level: cao | trung bình | thấp | không rõ.
const DAY = 86400000;
function reputation(info, source, now = Date.now()) {
  if (!info) return { level: 'không rõ', lines: ['Không kiểm được độ tin cậy (GitHub API không trả lời); tự xem repo trước khi bật.'], block: '' };
  if (info.size > LIMITS.repoKb) return { level: 'không rõ', lines: [], block: `Repo quá lớn (${Math.round(info.size / 1024)} MB > ${LIMITS.repoKb / 1024} MB); dùng link tới đúng thư mục skill không giúp được vì vẫn phải tải cả repo.` };
  const trusted = TRUSTED_OWNERS.includes(source.owner.toLowerCase()), stars = info.stargazers_count || 0, age = (now - Date.parse(info.created_at)) / DAY, idle = (now - Date.parse(info.pushed_at)) / DAY;
  const lines = [`${info.full_name || source.repoName}: ${stars} sao, ${info.forks_count || 0} fork, chủ ${info.owner?.type === 'Organization' ? 'tổ chức' : 'cá nhân'}${trusted ? ' (nguồn chính thức)' : ''}, license ${info.license?.spdx_id || 'không có'}.`];
  if (info.archived) lines.push('Repo đã lưu trữ (không còn bảo trì).');
  if (info.fork) lines.push('Repo là fork' + (info.parent?.full_name ? ' của ' + info.parent.full_name : '') + '; nên dùng repo gốc nếu được.');
  if (age < 30) lines.push(`Repo mới tạo ${Math.max(0, Math.floor(age))} ngày trước.`);
  if (idle > 730) lines.push('Hơn 2 năm không cập nhật.');
  const level = trusted ? 'cao' : stars >= 500 && age >= 180 && !info.archived && !info.fork ? 'cao' : stars >= 50 && age >= 30 ? 'trung bình' : 'thấp';
  if (level === 'thấp') lines.push('Ít người dùng hoặc repo mới: đọc kỹ toàn bộ skill trước khi bật.');
  return { level, lines, block: '' };
}

// ---- Kiểm tra nội dung một thư mục skill. Phát hiện "block" thì không cài (trừ --force); "hard" không bỏ qua được.
const NATIVE = /\.(exe|dll|scr|msi|com|so|dylib|lnk|reg|hta|cpl|sys|appx|msix)$/i;
const SCRIPT = /\.(ps1|psm1|bat|cmd|vbs|vbe|js|mjs|cjs|jse|wsf|sh|bash|zsh|py|rb|pl|php|ts)$/i;
const TEXT = /\.(md|txt|json|ya?ml|toml|ini|cfg|csv|xml|html?|css|ps1|psm1|bat|cmd|vbs|js|mjs|cjs|ts|sh|bash|zsh|py|rb|pl|php|sql)$|^[^.]+$/i;
const RULES = Object.freeze([
  // Cần có tham số giữa curl và "|": câu cảnh báo "đừng chạy curl | sh" trong tài liệu không bị chặn.
  ['block', /\b(curl|wget)\s+[^\n|]+\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, 'tải rồi chạy thẳng bằng shell (curl | sh)'],
  ['block', /\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|DownloadFile)\b[^\n]*\|\s*(iex|Invoke-Expression)\b|\biex\s*\(\s*(New-Object|iwr|irm|\(New-Object)/i, 'tải rồi chạy thẳng bằng PowerShell (iwr | iex)'],
  ['block', /\bpowershell(\.exe)?\b[^\n]*\s-(e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}/i, 'lệnh PowerShell mã hoá base64'],
  ['block', /[\u202A-\u202E\u2066-\u2069]/, 'ký tự đảo chiều văn bản ẩn (Trojan Source)'],
  ['block', /\b(ignore|disregard|forget)\b[^\n.]{0,20}\b(all\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?|messages)/i, 'chỉ dẫn yêu cầu bỏ qua hướng dẫn trước (prompt injection)'],
  ['block', /\b(do not|don't|never)\s+(tell|inform|show|notify|mention\s+(this\s+)?to)\s+the\s+user\s*(about\s+(this|these|it)\b|that\s+you\b|what\s+you\b|(?=[.!;:\n]))|\bwithout\s+(telling|notifying)\s+the\s+user\b|\bbỏ qua (mọi |các |tất cả )?(hướng dẫn|chỉ dẫn|quy tắc)\b|\b(không|đừng) (báo|nói) (cho |với )?người dùng\b/i, 'chỉ dẫn giấu việc khỏi người dùng hoặc bỏ qua quy tắc (prompt injection)'],
  // Nhắc tới tệp bí mật (thường trong ghi chú bảo mật) chỉ cảnh báo; cùng tệp có lệnh gửi ra mạng thì chặn.
  ['warn', /(\.ssh[\\/]|\bid_rsa\b|\bid_ed25519\b|\.aws[\\/]credentials|\.credentials\.json|\bLogin Data\b|\bLocal State\b|\.git-credentials|\bwallet\.dat\b|CLAUDE_CODE_OAUTH_TOKEN)/i, 'nhắc tới tệp khoá/bí mật/mật khẩu trình duyệt', null, /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|requests\.(post|put)|urllib|http\.request|https\.request|fetch\s*\(|axios|XMLHttpRequest|nc\s+-|scp\s)/i],
  ['block', /dangerously-skip-permissions|\bbypassPermissions\b|\bdisableAllHooks\b|\bSet-ExecutionPolicy\s+(Bypass|Unrestricted)/i, 'tắt cơ chế duyệt quyền'],
  ['block', /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(--no-preserve-root\s+)?(\/|~|\$HOME)(\s|$)|\bRemove-Item\b[^\n]*-Recurse[^\n]*\s(C:\\|\$env:USERPROFILE|~)(\s|$)|\bformat\s+[a-z]:/i, 'xoá ổ đĩa/thư mục người dùng'],
  // Tài liệu SDK chính thức dùng biến môi trường API key; chỉ cảnh báo để người dùng biết skill cần key.
  ['warn', /\b[A-Z][A-Z0-9_]*_(API_KEY|SECRET|TOKEN)\b/, 'dùng API key/token từ biến môi trường'],
  ['warn', /\.env\b/, 'nhắc tới tệp .env (bí mật của dự án)'],
  ['warn', /[\u200B-\u200D\u2060]/, 'ký tự ẩn độ rộng 0'],
  // Chú thích HTML chỉ "ẩn" trong Markdown; trong .html/.py là code bình thường.
  ['warn', /<!--[\s\S]*?-->/, 'chú thích HTML ẩn (không hiện khi xem Markdown nhưng model vẫn đọc)', /\.md$/i],
  ['warn', /[A-Za-z0-9+/]{300,}={0,2}/, 'khối dữ liệu base64 dài'],
  ['warn', /https?:\/\/(?!127\.)\d{1,3}(\.\d{1,3}){3}\b/, 'gọi thẳng tới địa chỉ IP'],
  ['warn', /(webhook\.site|pastebin\.com|ngrok(-free)?\.(io|app)|requestbin|hooks\.slack\.com\/services|discord(app)?\.com\/api\/webhooks)/i, 'gửi dữ liệu ra dịch vụ bên ngoài (webhook/paste)'],
]);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
function walk(dir, visit, relative = '') {
  for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(dir, visit, rel); else visit(rel, fs.lstatSync(path.join(dir, rel)));
  }
}
function audit(dir) {
  const findings = [], add = (level, text, extra = {}) => findings.push({ level, text, ...extra });
  // Một quy tắc khớp ở nhiều tệp chỉ báo chỗ đầu tiên kèm số chỗ còn lại.
  let skill = null, files = 0, bytes = 0; const scripts = [], domains = new Set(), hits = new Map();
  try {
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), data = frontmatter(text), name = data.name || path.basename(dir);
    if (!NAME.test(name)) add('block', `tên skill "${name}" chỉ được gồm chữ, số, _ và -`, { hard: true });
    if (!data.description) add('block', 'SKILL.md thiếu description', { hard: true });
    if (data['allowed-tools']) add('info', `allowed-tools (${data['allowed-tools']}) không có tác dụng trong app`);
    if (text.length > LIMITS.skillMd) add('warn', `SKILL.md dài ${Math.round(text.length / 1024)} KB, tốn token mỗi lần đọc`);
    skill = { name, description: (data.description || '').replace(/\s+/g, ' ').trim() };
  } catch (error) { add('block', 'không đọc được SKILL.md: ' + error.message, { hard: true }); }
  walk(dir, (rel, stat) => {
    files++; bytes += stat.size;
    if (stat.isSymbolicLink()) return add('block', 'liên kết tượng trưng ' + rel, { hard: true });
    if (NATIVE.test(rel)) return add('block', 'tệp thực thi/nhị phân ' + rel);
    if (SCRIPT.test(rel)) scripts.push(rel);
    if (!TEXT.test(path.basename(rel)) || stat.size > LIMITS.scanBytes) return;
    const text = fs.readFileSync(path.join(dir, rel), 'utf8'); if (text.includes('\0')) return;
    for (const [base, pattern, label, only, escalate] of RULES) {
      const found = (!only || only.test(rel)) && pattern.exec(text); if (!found) continue;
      const level = escalate?.test(text) ? 'block' : base, key = level + label;
      const hit = hits.get(key); if (hit) hit.more++; else hits.set(key, { level, label: label + (level !== base ? ' kèm lệnh gửi ra mạng trong cùng tệp' : ''), where: `${rel}:${lineOf(text, found.index)} «${found[0].replace(/\s+/g, ' ').slice(0, 80)}»`, more: 0 });
    }
    for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) domains.add(match[1].toLowerCase());
  });
  for (const hit of hits.values()) add(hit.level, `${hit.label}: ${hit.where}${hit.more ? ` (+${hit.more} tệp khác)` : ''}`);
  if (files > LIMITS.files) add('block', `quá nhiều tệp (${files} > ${LIMITS.files})`, { hard: true });
  if (bytes > LIMITS.skillBytes) add('block', `quá lớn (${Math.round(bytes / 1048576)} MB > ${LIMITS.skillBytes / 1048576} MB)`, { hard: true });
  if (scripts.length) add('warn', `có ${scripts.length} script (${scripts.slice(0, 5).join(', ')}${scripts.length > 5 ? ', …' : ''}); model chỉ chạy được qua Bash và vẫn qua hộp duyệt`);
  if (domains.size) add('info', 'liên kết tới: ' + [...domains].slice(0, 8).join(', ') + (domains.size > 8 ? ', …' : ''));
  return { skill, findings, blocked: findings.some(item => item.level === 'block'), hardBlocked: findings.some(item => item.hard) };
}

// ---- Tìm thư mục skill (có SKILL.md) trong repo đã tải; không đi tiếp vào trong một skill.
function findSkills(root, depth = LIMITS.depth, relative = '') {
  const dir = path.join(root, relative);
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return [relative];
  if (!depth) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory() && !['.git', 'node_modules', '.github'].includes(entry.name)).flatMap(entry => findSkills(root, depth - 1, path.join(relative, entry.name)));
}
const readSource = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8')); } catch { return null; } };
// Chép sang thư mục tạm cạnh đích rồi đổi tên: lỗi giữa chừng không để lại skill hỏng.
function install(from, target, source) {
  const staging = target + '.new-' + process.pid;
  fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  fs.cpSync(from, staging, { recursive: true, filter: file => path.basename(file) !== '.git' });
  fs.writeFileSync(path.join(staging, SOURCE_FILE), JSON.stringify(source, null, 2));
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 }); fs.renameSync(staging, target);
}
const findingLines = findings => ['block', 'warn', 'info'].flatMap(level => findings.filter(item => item.level === level)).slice(0, LIMITS.findingsShown).map(item => `   ${{ block: '⛔', warn: '⚠', info: '·' }[item.level]} ${item.text}`).concat(findings.length > LIMITS.findingsShown ? [`   … +${findings.length - LIMITS.findingsShown} mục`] : []);

let busy = false;
async function withRepo(source, options, work) {
  if (busy) throw Error('Đang tải skill khác; đợi lệnh trước xong.'); busy = true;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-desk-skill-'));
  try {
    let info = null; try { info = await (options.repoInfo || githubInfo)(source); } catch {}
    const trust = reputation(info, source, options.now);
    if (trust.block) return { trust, text: trust.block };
    const repoDir = path.join(temp, 'repo'), commit = await (options.clone || gitClone)(source, repoDir);
    return await work({ repoDir, commit, trust });
  } finally { busy = false; fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); }
}
const trustBlock = trust => [`Độ tin cậy: ${trust.level}`, ...trust.lines.map(line => '  ' + line)];

// /skills add <url> [--force]
async function add(url, { appDir, force = false, ...options }) {
  const source = parseSource(url);
  return withRepo(source, options, ({ repoDir, commit, trust }) => {
    const base = path.join(repoDir, ...source.subpath.split('/').filter(Boolean));
    if (!fs.existsSync(base)) return { text: `Không thấy thư mục ${source.subpath} trong ${source.repoName}.` };
    const found = findSkills(base);
    if (!found.length) return { text: `Không thấy SKILL.md nào trong ${source.url}.` };
    if (found.length > LIMITS.skillsPerAdd) return { text: `Repo có ${found.length} skill (> ${LIMITS.skillsPerAdd}); dùng link tới đúng thư mục skill (…/tree/<nhánh>/<thư mục>).` };
    fs.mkdirSync(appDir, { recursive: true });
    const lines = [`Nguồn: ${source.url} @ ${commit.slice(0, 7)}`, ...trustBlock(trust)], installed = [];
    for (const relative of found) {
      const dir = path.join(base, relative), result = audit(dir), name = result.skill?.name || path.basename(dir), target = path.join(appDir, name);
      const label = relative || source.subpath || source.repo;
      if (result.hardBlocked || (result.blocked && !force)) { lines.push(`✗ ${name} (${label}): không cài.`, ...findingLines(result.findings)); continue; }
      if (fs.existsSync(target)) { lines.push(`– ${name}: đã có trong thư mục skill của app, bỏ qua (dùng /skills update ${name} hoặc /skills remove ${name}).`); continue; }
      const repoPath = path.posix.join(source.subpath, relative.split(path.sep).join('/')).replace(/^\.$/, '');
      install(dir, target, { url: source.url, repo: source.repoName, cloneUrl: source.cloneUrl, ref: source.ref, path: repoPath, commit, installedAt: new Date().toISOString(), trust: trust.level, forced: result.blocked });
      installed.push(name);
      lines.push(`✓ ${name}${result.blocked ? ' (cài bằng --force dù có cảnh báo chặn)' : ''}: ${path.join(target, 'SKILL.md')}`, ...findingLines(result.findings));
    }
    if (lines.some(line => line.startsWith('✗')) && !force) lines.push('Skill bị chặn vì nội dung nguy hiểm. Nếu đã tự đọc và chắc là an toàn: /skills add ' + url + ' --force (trừ lỗi tên, kích thước, symlink).');
    if (installed.length) lines.push('Skill mới chưa bật cho role nào và chat thường. Đọc SKILL.md ở trên rồi bật trong mục Skill của role / Skill của chat thường.');
    return { text: lines.join('\n'), installed };
  });
}

// /skills update [tên] [--force]: skill của app có nguồn GitHub; mỗi repo/nhánh chỉ tải một lần.
async function update(name, { appDir, list, force = false, ...options }) {
  const targets = list.filter(skill => skill.source === 'app' && (!name || skill.name === name)).map(skill => ({ skill, origin: readSource(skill.dir) }));
  if (name && !targets.length) return { text: `Không có skill "${name}" trong thư mục skill của app.` };
  const lines = [], groups = new Map();
  for (const target of targets) {
    if (!target.origin?.cloneUrl) { if (name) lines.push(`– ${target.skill.name}: không tải từ GitHub nên không cập nhật được.`); continue; }
    const key = target.origin.cloneUrl + '#' + (target.origin.ref || ''); groups.set(key, [...(groups.get(key) || []), target]);
  }
  for (const group of groups.values()) {
    const origin = group[0].origin, source = { ...parseSource(origin.cloneUrl.replace(/\.git$/, '')), ref: origin.ref || '' };
    try {
      const result = await withRepo(source, options, ({ repoDir, commit, trust }) => {
        const out = [`${source.repoName}${source.ref ? ' (' + source.ref + ')' : ''} @ ${commit.slice(0, 7)}`, ...trustBlock(trust)];
        for (const { skill, origin: own } of group) {
          if (own.commit === commit) { out.push(`= ${skill.name}: đã mới nhất.`); continue; }
          const dir = path.join(repoDir, ...own.path.split('/').filter(Boolean));
          if (!fs.existsSync(path.join(dir, 'SKILL.md'))) { out.push(`✗ ${skill.name}: không còn ${own.path || 'SKILL.md'} trong repo; giữ bản cũ.`); continue; }
          const checked = audit(dir);
          if (checked.skill?.name !== skill.name) { out.push(`✗ ${skill.name}: bản mới đổi tên thành "${checked.skill?.name}"; giữ bản cũ (gỡ rồi add lại nếu muốn).`); continue; }
          if (checked.hardBlocked || (checked.blocked && !force)) { out.push(`✗ ${skill.name}: bản mới không qua kiểm tra, giữ bản cũ.`, ...findingLines(checked.findings)); continue; }
          install(dir, skill.dir, { ...own, commit, updatedAt: new Date().toISOString(), trust: trust.level, forced: checked.blocked });
          out.push(`✓ ${skill.name}: ${own.commit?.slice(0, 7) || '?'} → ${commit.slice(0, 7)}. Xem lại SKILL.md vì nội dung đã đổi.`, ...findingLines(checked.findings));
        }
        return { text: out.join('\n') };
      });
      lines.push(result.text);
    } catch (error) { lines.push(`✗ ${source.repoName}: ${error.message}`); }
  }
  return { text: lines.join('\n') || 'Không có skill nào tải từ GitHub để cập nhật.' };
}

// /skills remove <tên>: chỉ xoá skill trong thư mục của app; skill của dự án nằm trong repo của dự án.
function remove(name, { appDir, list }) {
  const skill = list.find(item => item.name === name);
  if (!skill) return { text: `Không có skill "${name}".`, removed: false };
  if (skill.source !== 'app') return { text: `"${name}" là skill của dự án (${skill.dir}); xoá thư mục đó trong repo dự án.`, removed: false };
  if (path.dirname(skill.dir) !== path.resolve(appDir)) throw Error('Đường dẫn skill không hợp lệ');
  fs.rmSync(skill.dir, { recursive: true, force: true, maxRetries: 3 });
  return { text: `Đã gỡ skill ${name} (${skill.dir}).`, removed: true };
}
module.exports = { parseSource, reputation, audit, findSkills, add, update, remove, readSource, SOURCE_FILE, TRUSTED_OWNERS, LIMITS };
