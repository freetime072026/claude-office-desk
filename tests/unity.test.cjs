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
    assert.match(text, /KHÔNG chạy Unity\.exe -batchmode/); assert.match(text, new RegExp(`127\\.0\\.0\\.1:${server.address().port}/skill/<tên>\\?expectProject=Purrge!`)); assert.match(text, /SKILL\.md/);
  } finally { server.close(); other.close(); }
});

test('Editor open but API silent, or no Unity-Skills → say it is locked and to report blocked', async () => {
  const silent = await unity.context(project({ open: true, skills: true }), { env: env(true), ports: [1] });
  assert.equal(silent.port, 0); assert.match(unity.guide(silent), /Unity-Skills đã cài nhưng API không phản hồi[\s\S]*báo blocked/);
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
