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
