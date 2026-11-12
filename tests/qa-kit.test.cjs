const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const qaKit = require('../qa-kit.cjs');
const { filesOf, qaDir } = require('../session-files.cjs');
const { buildPrompt } = require('../prompt.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'office-qakit-'));

test('the PLA QA kit lives in Office Desk with a version and every file it copies', () => {
  for (const file of [...qaKit.KIT_FILES, 'lib/kit.json']) assert.ok(fs.existsSync(path.join(qaKit.KIT_DIR, file)), file);
  assert.ok(qaKit.kitInfo().version >= 1);
  // Office Desk ships playwright-core so a project without it can still run the kit.
  assert.ok(require.resolve('playwright-core', { paths: [qaKit.APP_DIR] }));
});

test('only PLA sessions get the kit (preset or PO product)', () => {
  assert.equal(qaKit.isPla({ preset: 'PLA' }), true);
  assert.equal(qaKit.isPla({ poProduct: 'PLA' }), true);
  assert.equal(qaKit.isPla({ preset: 'Unity' }), false);
  assert.equal(qaKit.isPla(null), false);
});

test('ensure copies missing kit files into the project once and never overwrites the project copy', () => {
  const folder = temp(), dir = qaDir(filesOf({ id: 's1', folder }));
  const first = qaKit.ensure(dir, 'D:\\office');
  assert.deepEqual(first.copied.sort(), [...qaKit.KIT_FILES, 'lib/kit.json'].sort());
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'lib', 'kit.json'), 'utf8'));
  assert.equal(info.officeDesk, 'D:\\office'); assert.equal(info.version, qaKit.kitInfo().version);
  // The project edits its copy: Office Desk leaves it alone.
  fs.writeFileSync(path.join(dir, 'lib', 'harness.js'), '// project copy');
  const again = qaKit.ensure(dir, 'D:\\office');
  assert.deepEqual(again.copied, []);
  assert.equal(fs.readFileSync(path.join(dir, 'lib', 'harness.js'), 'utf8'), '// project copy');
  // A deleted kit file comes back; a moved Office Desk only updates the lookup path.
  fs.rmSync(path.join(dir, 'smoke.js'));
  const moved = qaKit.ensure(dir, 'E:\\office');
  assert.deepEqual(moved.copied, ['smoke.js']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'lib', 'kit.json'), 'utf8')).officeDesk, 'E:\\office');
});

test('the QA prompt points at the kit, and reports a newer Office Desk kit without copying it', () => {
  const folder = temp(), files = filesOf({ id: 's1', folder }), dir = qaDir(files);
  const line = qaKit.guide(qaKit.ensure(dir), dir);
  assert.match(line, /harness Playwright/); assert.match(line, /KIT\.md/); assert.match(line, /npm run verify -- dev/);
  assert.doesNotMatch(line, /mới hơn/);
  const older = JSON.parse(fs.readFileSync(path.join(dir, 'lib', 'kit.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'lib', 'kit.json'), JSON.stringify({ ...older, version: 0 }));
  assert.match(qaKit.guide(qaKit.ensure(dir), dir), /mới hơn bản project \(v0\)/);

  const qa = buildPrompt({ label: 'QA', type: 'QA', files, qaKit: line }).brief;
  assert.ok(qa.includes(line));
  const dev = buildPrompt({ label: 'Dev', type: 'Dev', files, qaKit: line }).brief;
  assert.ok(!dev.includes(line));
});

test('the kit harness and smoke script load and find the project from .office-desk/qa', () => {
  const folder = temp(), dir = qaDir(filesOf({ id: 's1', folder }));
  qaKit.ensure(dir);
  const harness = require(path.join(dir, 'lib', 'harness.js'));
  assert.equal(path.resolve(harness.ROOT), path.resolve(folder));
  assert.deepEqual(harness.VIEWPORTS.portrait, [390, 844]);
  assert.equal(typeof harness.run, 'function');
  // playwright-core comes from Office Desk when the project has none.
  assert.equal(typeof harness.loadPlaywright().chromium.launch, 'function');
});
