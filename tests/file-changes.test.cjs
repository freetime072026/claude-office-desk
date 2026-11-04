const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitStatus, changedFiles, changesText } = require('../file-changes.cjs');
const { consume } = require('../chat.cjs');
const { buildPrompt } = require('../prompt.cjs');
const git = (folder, ...args) => execFileSync('git', ['-C', folder, ...args], { stdio: 'ignore' });
let hasGit = true; try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }

test('git snapshot inside the Dev scope finds files created by scripts and files edited', { skip: !hasGit }, () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'changes-'));
  git(folder, 'init', '-q'); fs.mkdirSync(path.join(folder, 'src')); fs.writeFileSync(path.join(folder, 'src', 'a.cs'), 'a'); fs.writeFileSync(path.join(folder, 'other.cs'), 'o');
  git(folder, 'add', '.'); git(folder, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const scope = [path.join(folder, 'src') + path.sep], before = gitStatus(folder, scope);
  fs.writeFileSync(path.join(folder, 'src', 'a.cs'), 'a2'); fs.writeFileSync(path.join(folder, 'src', 'New.cs'), 'n'); fs.writeFileSync(path.join(folder, 'other.cs'), 'changed outside scope');
  const changed = changedFiles({ folder, before, after: gitStatus(folder, scope), fileOps: { [path.join(folder, 'src', 'Tool.cs')]: 'created' } });
  assert.deepEqual(changed, { created: ['src/New.cs', 'src/Tool.cs'], edited: ['src/a.cs'], deleted: [] });
  assert.equal(changesText(changed), 'Tạo mới: src/New.cs, src/Tool.cs\nSửa: src/a.cs');
  assert.equal(gitStatus(fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-')), [path.join(os.tmpdir(), 'x')]), null);
});
test('Write to a missing file counts as created, Edit as edited; a created file stays created', () => {
  const message = { text: '' }, seen = new Set(), missing = path.join(os.tmpdir(), 'missing-' + Date.now() + '.cs'), existing = __filename;
  const use = (id, name, input) => consume(message, { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, seen);
  use('1', 'Write', { file_path: missing }); use('2', 'Edit', { file_path: missing }); use('3', 'Write', { file_path: existing }); use('4', 'Read', { file_path: 'x' });
  assert.deepEqual(message.fileOps, { [missing]: 'created', [existing]: 'edited' });
});
test('Dev handoff asks for new files; Lead review must update PROJECT.md from CHANGES', () => {
  const files = { changes: 'CHANGES.md', issues: 'ISSUES.md', perf: 'PERF.md', project: 'PROJECT.md' };
  assert.match(buildPrompt({ label: 'Dev', type: 'Dev', content: 'x' }).text, /Tệp mới: mỗi tệp một dòng/);
  assert.match(buildPrompt({ label: 'Lead Dev', type: 'Lead Dev', lead: true, phase: 'review', files, content: 'x' }).text, /bắt buộc cập nhật bản đồ theo các tệp "Tạo mới"/);
});
test('git snapshot also covers task paths in a related session folder, keyed by absolute path', { skip: !hasGit }, () => {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'main-')), game = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
  git(game, 'init', '-q'); fs.mkdirSync(path.join(game, 'assets')); fs.writeFileSync(path.join(game, 'assets', 'a.webp'), 'a');
  git(game, 'add', '.'); git(game, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  const scope = [path.join(game, 'assets') + path.sep], folders = [main, game], before = gitStatus(main, scope, folders);
  fs.writeFileSync(path.join(game, 'assets', 'new.webp'), 'n'); fs.writeFileSync(path.join(game, 'assets', 'a.webp'), 'a2');
  const changed = changedFiles({ folder: main, before, after: gitStatus(main, scope, folders), fileOps: { [path.join(game, 'assets', 'new.webp')]: 'created' } });
  const top = execFileSync('git', ['-C', game, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const abs = file => path.resolve(top, file).split(path.sep).join('/');
  assert.deepEqual(changed.edited, [abs('assets/a.webp')]);
  assert.ok(changed.created.length >= 1 && changed.created.every(file => /new\.webp$/.test(file)));
});
