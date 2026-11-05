const { test } = require('node:test'); const assert = require('node:assert/strict'); const path = require('node:path'); const { readProjectFile } = require('../files.cjs'); const { usageEvent, normalizeUsage } = require('../usage.cjs');
test('file viewer stays inside granted roots and strips line suffix', () => { const result = readProjectFile('files.test.cjs:2', [__dirname]); assert.match(result.content, /file viewer/); assert.throws(() => readProjectFile('../main.cjs', [__dirname])); assert.throws(() => readProjectFile('package.json', [__dirname])); assert.throws(() => readProjectFile('image.exe', [__dirname])); });
test('rate limit events retain absent percentages as unknown, not zero', () => { const reset = Date.now() / 1000 + 1000; const event = { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', resetsAt: reset, status: 'allowed' } }; const usage = usageEvent(event); assert.equal(usage.five_hour.used_percentage, undefined); assert.equal(normalizeUsage(usage).five_hour.status, 'allowed'); event.rate_limit_info.utilization = .84; assert.equal(usageEvent(event).five_hour.used_percentage, 84); });
test('file viewer returns project images as data URLs and accepts chat-style references', () => {
  const fs = require('node:fs'), os = require('node:os'); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'files-')); fs.mkdirSync(path.join(root, 'Assets', 'Art'), { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]); fs.writeFileSync(path.join(root, 'Assets', 'Art', 'hero ảnh.png'), png); fs.writeFileSync(path.join(root, 'Assets', 'Hero.prefab'), '%YAML 1.1\n');
  const image = readProjectFile('Assets/Art/hero%20%E1%BA%A3nh.png', [root]); assert.equal(image.kind, 'image'); assert.equal(image.url, 'data:image/png;base64,' + png.toString('base64'));
  assert.equal(readProjectFile('file:///' + path.join(root, 'Assets', 'Art', 'hero ảnh.png').split(path.sep).join('/'), [root]).kind, 'image');
  const text = readProjectFile('<Assets/Hero.prefab>#L1', [root]); assert.equal(text.kind, 'text'); assert.match(text.content, /YAML/);
  assert.throws(() => readProjectFile(path.join(os.tmpdir(), 'outside.png'), [root]));
  fs.rmSync(root, { recursive: true, force: true });
});

const fs = require('node:fs'), os = require('node:os');
test('bare names and partial paths from chat are found inside the session folders, session docs first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-find-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('src/stage/Stage.ts', 'stage'); write('src/ui/Hud.ts', 'hud'); write('node_modules/x/Hud.ts', 'nope');
  write('.office-desk/s1/ISSUES.md', 'mine'); write('.office-desk/s2/ISSUES.md', 'other'); write('.office-desk/PROJECT.md', 'project');
  assert.equal(readProjectFile('Stage.ts', [root]).content, 'stage');
  assert.equal(readProjectFile('`ui/Hud.ts:12`'.replace(/`/g, ''), [root]).content, 'hud');
  assert.equal(readProjectFile('ISSUES.md', [root], { sessionId: 's1' }).content, 'mine');
  assert.equal(readProjectFile('ISSUES.md', [root], { sessionId: 's2' }).content, 'other');
  assert.equal(readProjectFile('PROJECT.md', [root], { sessionId: 's1' }).content, 'project');
  assert.throws(() => readProjectFile('Cards.ts', [root]), /Không tìm thấy tệp "Cards.ts"/);
});

test('a missing session folder does not break links to the other folders; temp files open by full path only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-root-')), gone = path.join(root, 'deleted-folder');
  fs.writeFileSync(path.join(root, 'a.md'), 'A');
  assert.equal(readProjectFile('a.md', [gone, root]).content, 'A');
  const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-qa-')), 'shot.png'); fs.writeFileSync(shot, Buffer.from([137, 80, 78, 71]));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'od-other-'));
  assert.throws(() => readProjectFile(shot, [path.join(other, 'nothing-here')]), /ngoài thư mục/);
  assert.equal(readProjectFile(shot, [other], { readOnlyRoots: [os.tmpdir()] }).kind, 'image');
  assert.throws(() => readProjectFile('shot.png', [path.join(other, 'x')], { readOnlyRoots: [os.tmpdir()] }), /Không tìm thấy/);
  if (process.platform === 'win32') assert.equal(readProjectFile('/' + root[0].toLowerCase() + root.slice(2).split(path.sep).join('/') + '/a.md', [root]).content, 'A');
});
