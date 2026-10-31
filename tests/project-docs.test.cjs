const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projectDocs = require('../project-docs.cjs');
const { buildPrompt } = require('../prompt.cjs');
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));

test('reads CLAUDE.md before AGENTS.md, clips long text and notes README', () => {
  const dir = folder(); fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'agents'); fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'x'.repeat(projectDocs.GUIDE_LIMIT + 10)); fs.writeFileSync(path.join(dir, 'README.md'), '# r');
  const info = projectDocs.read(dir);
  assert.equal(info.name, 'CLAUDE.md'); assert.equal(info.text.length, projectDocs.GUIDE_LIMIT + 1); assert.equal(info.readme, true);
  fs.rmSync(path.join(dir, 'CLAUDE.md')); assert.equal(projectDocs.read(dir).text, 'agents');
  assert.equal(projectDocs.read(folder()), null);
});
test('full guide only once per CLI session; README line every turn, role-specific', () => {
  const info = { name: 'CLAUDE.md', text: 'Đọc README trước', readme: true }, thread = { cliSessions: {} }, key = 'p:f:Lead Dev';
  assert.equal(projectDocs.needsFull(thread, key, false), true);
  projectDocs.markSent(thread, key, false); thread.cliSessions[key] = 'abc';
  assert.equal(projectDocs.needsFull(thread, key, true), false);
  const resumedOld = { cliSessions: { [key]: 'old' } }; assert.equal(projectDocs.needsFull(resumedOld, key, true), true);
  projectDocs.markSent(resumedOld, key, true); assert.equal(projectDocs.needsFull(resumedOld, key, true), false);
  const full = projectDocs.guide(info, 'Lead Dev', true), short = projectDocs.guide(info, 'Lead Dev', false);
  assert.match(full, /Đọc README trước/); assert.doesNotMatch(short, /Đọc README trước/); assert.match(short, /tra README/);
  assert.match(projectDocs.guide(info, 'GD', false), /Bỏ qua docs\/rules/);
  assert.equal(projectDocs.guide(null, 'Dev', true), '');
});
test('prompt carries the project guide after the role lines', () => {
  const text = buildPrompt({ label: 'Dev', type: 'Dev', content: 'làm task', projectDocs: 'HƯỚNG DẪN DỰ ÁN' }).text;
  assert(text.indexOf('HƯỚNG DẪN DỰ ÁN') > text.indexOf('Vai trò Dev')); assert(text.indexOf('HƯỚNG DẪN DỰ ÁN') < text.indexOf('làm task'));
});
