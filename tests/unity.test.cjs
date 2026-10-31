const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const unity = require('../unity.cjs');
const { rolePrompt } = require('../prompt.cjs');
function project({ open = false, skills = false, name = 'Purrge!' } = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-proj-'));
  fs.mkdirSync(path.join(folder, 'ProjectSettings')); fs.writeFileSync(path.join(folder, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.4.8f1\nm_EditorVersionWithRevision: 6000.4.8f1 (x)\n');
  fs.writeFileSync(path.join(folder, 'ProjectSettings', 'ProjectSettings.asset'), `PlayerSettings:\n  companyName: X\n  productName: ${name}\n`);
  fs.mkdirSync(path.join(folder, 'Packages')); fs.writeFileSync(path.join(folder, 'Packages', 'manifest.json'), JSON.stringify({ dependencies: skills ? { 'com.besty.unity-skills': 'git' } : {} }));
  if (skills) { const doc = path.join(folder, 'Library', 'PackageCache', 'com.besty.unity-skills@abc', 'unity-skills~'); fs.mkdirSync(doc, { recursive: true }); fs.writeFileSync(path.join(doc, 'SKILL.md'), '#'); }
  if (open) { fs.mkdirSync(path.join(folder, 'Temp')); fs.writeFileSync(path.join(folder, 'Temp', 'UnityLockfile'), ''); }
  return folder;
}
const env = installed => { const base = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-hub-')); if (installed) { const exe = path.join(base, 'Unity', 'Hub', 'Editor', '6000.4.8f1', 'Editor'); fs.mkdirSync(exe, { recursive: true }); fs.writeFileSync(path.join(exe, 'Unity.exe'), ''); } return { ProgramFiles: base, APPDATA: base }; };
function healthServer(projectName) { return new Promise(resolve => { const server = http.createServer((request, response) => { response.end(JSON.stringify({ status: 'ok', projectName })); }).listen(0, '127.0.0.1', () => resolve(server)); }); }

test('not a Unity project → nothing is added', async () => {
  assert.equal(unity.detect(fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'))), null);
  assert.equal(await unity.context(''), null); assert.equal(unity.guide(null), '');
});

test('Editor open with Unity-Skills of the same project → REST guide with expectProject, no batchmode', async () => {
  const server = await healthServer('Purrge!'), other = await healthServer('Another');
  try {
    const folder = project({ open: true, skills: true });
    const info = await unity.context(folder, { env: env(true), ports: [other.address().port, server.address().port] });
    assert.deepEqual([info.version, info.productName, info.editorOpen, info.hasSkills, info.port], ['6000.4.8f1', 'Purrge!', true, true, server.address().port]);
    const text = unity.guide(info);
    assert.match(text, /KHÔNG chạy Unity\.exe -batchmode/); assert.match(text, /CHỈ qua bash ".*\/\.office-desk\/unity\.sh" <GET\|POST>/); assert.match(text, /không curl thẳng vào cổng/); assert.match(text, /SKILL\.md/);
    assert.doesNotMatch(text, /API chưa trả lời/);
  } finally { server.close(); other.close(); }
});

test('Editor open but API silent, or no Unity-Skills → say it is locked and to report blocked', async () => {
  const silent = await unity.context(project({ open: true, skills: true }), { env: env(true), ports: [1] });
  assert.equal(silent.port, 0); assert.match(unity.guide(silent), /API chưa trả lời \(có thể đang nạp lại\): script sẽ chờ; quá thời gian thì báo blocked/);
  assert.match(unity.guide(await unity.context(project({ open: true }), { env: env(true), ports: [1] })), /chưa cài Unity-Skills/);
});

test('Editor closed → batchmode command with the matching editor, or blocked when that version is missing', async () => {
  const folder = project(), info = await unity.context(folder, { env: env(true) });
  assert.equal(info.editorOpen, false); assert.match(unity.guide(info), /-batchmode -quit -projectPath ".*unity-proj-[^"]*"[\s\S]*600000 ms/);
  assert.match(unity.guide(await unity.context(folder, { env: env(false) })), /chưa tìm thấy Unity\.exe: báo blocked, nêu cần cài Unity 6000\.4\.8f1/);
});

test('only blocks that run shell get the Unity guide', () => {
  const thread = { flow: ['GD', 'Lead Dev', 'Dev', 'QA'], workers: { Dev: { type: 'Dev', task: 'x' } }, messages: [], attachments: [] };
  for (const label of ['Lead Dev', 'Dev', 'QA']) assert.match(rolePrompt({}, thread, label, { content: 'x', unity: 'UNITY-GUIDE' }).text, /UNITY-GUIDE/, label);
  assert.doesNotMatch(rolePrompt({}, thread, 'GD', { content: 'x', unity: 'UNITY-GUIDE' }).text, /UNITY-GUIDE/);
});

// ---- unity.sh chạy thật bằng Git Bash với sổ đăng ký và server giả (bỏ qua nếu máy không có Git Bash).
const { spawn } = require('node:child_process');
const BASH = path.join(process.env.ProgramFiles || 'C:\Program Files', 'Git', 'bin', 'bash.exe');
const noBash = !fs.existsSync(BASH);
function echoServer(projectName) { return new Promise(resolve => { const server = http.createServer((request, response) => { let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => response.end(request.url === '/health' ? JSON.stringify({ status: 'ok', projectName, compilation: { isCompiling: false } }) : JSON.stringify({ method: request.method, url: request.url, body }))); }); server.listen(0, '127.0.0.1', () => resolve(server)); }); }
function helperFor(port, extraEnv = {}) {
  const folder = project({ open: true, skills: true }), info = unity.detect(folder), script = unity.writeHelper(info);
  const registry = path.join(folder, 'registry.json'); fs.writeFileSync(registry, JSON.stringify({ [folder]: { name: 'Purrge!', path: folder, port } }, null, 2));
  const env = { ...process.env, UNITY_SKILLS_REGISTRY: registry, UNITY_FIRST_PORT: '1', UNITY_LAST_PORT: '1', ...extraEnv };
  return args => new Promise(resolve => { const child = spawn(BASH, [script, ...args], { env }); let out = '', err = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; }); child.on('close', code => resolve({ code, out, err })); });
}
test('unity.sh finds the port in the registry, adds expectProject and forwards the JSON body', { skip: noBash, timeout: 30000 }, async () => {
  const server = await echoServer('Purrge!');
  try {
    const run = helperFor(server.address().port);
    const health = await run(['GET', '/health']); assert.equal(health.code, 0); assert.match(health.out, /"projectName":"Purrge!"/);
    const call = JSON.parse((await run(['POST', '/skill/debug_get_errors', '{"limit":5}'])).out);
    assert.deepEqual(call, { method: 'POST', url: '/skill/debug_get_errors?expectProject=Purrge!', body: '{"limit":5}' });
  } finally { server.close(); }
});
test('unity.sh waits while Unity is reloading, and gives a clear blocked message when it never comes back', { skip: noBash, timeout: 40000 }, async () => {
  const probe = await echoServer('x'), port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const waiting = helperFor(port, { UNITY_WAIT: '20' })(['GET', '/health']);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const late = http.createServer((request, response) => response.end(JSON.stringify({ status: 'ok', projectName: 'Purrge!' }))).listen(port, '127.0.0.1');
  try { const result = await waiting; assert.equal(result.code, 0); assert.match(result.out, /Purrge!/); } finally { late.close(); }
  const gone = await helperFor(port, { UNITY_WAIT: '1' })(['GET', '/health']);
  assert.equal(gone.code, 3); assert.match(gone.err, /không sẵn sàng sau 1s[\s\S]*Báo blocked/);
});
