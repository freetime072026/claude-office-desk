const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const skills = require('../skills.cjs');
const { buildPrompt } = require('../prompt.cjs');
const { initial, update } = require('../team.cjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
function skill(root, dir, text) { fs.mkdirSync(path.join(root, dir), { recursive: true }); fs.writeFileSync(path.join(root, dir, 'SKILL.md'), text); }

test('frontmatter reads quoted, plain and folded values', () => {
  assert.deepEqual(skills.frontmatter('---\nname: "pdf-tools"\ndescription: >\n  Extract text\n  from PDFs\nallowed-tools: Bash\n---\nbody'), { name: 'pdf-tools', description: 'Extract text from PDFs', 'allowed-tools': 'Bash' });
  assert.deepEqual(skills.frontmatter('﻿---\r\ndescription: x\r\n---\r\n'), { description: 'x' });
  assert.deepEqual(skills.frontmatter('# no frontmatter'), {});
});

test('lists app and project skills; project wins on name clash; invalid ones skipped', () => {
  const app = temp(), folder = temp(), project = path.join(folder, skills.PROJECT_DIR);
  skill(app, 'review', '---\nname: review\ndescription: App review\n---');
  skill(app, 'deploy', '---\ndescription: Deploy steps\n---');
  skill(app, 'empty', '---\nname: empty\n---');
  skill(app, 'bad', '---\nname: bad name\ndescription: x\n---');
  skill(project, 'review', '---\nname: review\ndescription: Project review\n---');
  const all = skills.list(app, folder);
  assert.deepEqual(all.map(item => [item.name, item.source, item.description]), [['deploy', 'app', 'Deploy steps'], ['review', 'project', 'Project review']]);
  assert.deepEqual(skills.list(app, '').map(item => item.name), ['deploy', 'review']);
  assert.deepEqual(skills.list(path.join(app, 'missing'), ''), []);
  assert.deepEqual(skills.extraDirs(all), [path.join(app, 'deploy')]);
  assert.deepEqual(skills.pick(all, ['review', 'other']).map(item => item.name), ['review']);
});

test('re-reads SKILL.md when it changes and clips long descriptions', () => {
  const app = temp(), file = path.join(app, 'a', 'SKILL.md');
  skill(app, 'a', '---\ndescription: first\n---');
  assert.equal(skills.list(app, '')[0].description, 'first');
  fs.writeFileSync(file, '---\ndescription: ' + 'x'.repeat(skills.DESCRIPTION_LIMIT + 50) + '\n---'); const later = new Date(Date.now() + 5000); fs.utimesSync(file, later, later);
  assert.equal(skills.list(app, '')[0].description.length, skills.DESCRIPTION_LIMIT + 1);
});

test('guide lists name, description and SKILL.md path; brief carries it for roles and plain chat', () => {
  const app = temp(); skill(app, 'deploy', '---\ndescription: Deploy steps\n---');
  const text = skills.guide(skills.list(app, ''));
  assert.match(text, /dùng Read đọc SKILL\.md/); assert.match(text, /Không có tool Skill/); assert.ok(text.includes('- deploy: Deploy steps (' + path.join(app, 'deploy', 'SKILL.md') + ')'));
  assert.equal(skills.guide([]), '');
  const many = Array.from({ length: skills.LIST_LIMIT + 2 }, (_, index) => ({ name: 's' + index, description: 'd', file: 'f', dir: 'd', source: 'app' }));
  assert.match(skills.guide(many), /\(\+2 skill khác không liệt kê\)/); assert.equal(skills.extraDirs(many).length, skills.LIST_LIMIT);
  const role = buildPrompt({ label: 'Dev', type: 'Dev', content: 'làm task', skills: text });
  assert.ok(role.brief.endsWith(text)); assert.ok(!role.body.includes(text));
  const chat = buildPrompt({ content: 'hi', skills: text }); assert.equal(chat.brief, text); assert.equal(chat.body, 'hi');
});

test('skills are enabled per role type for every session, validated by name', () => {
  const team = initial(); const id = update(team, 'create', { request: 'Game' }); update(team, 'add-worker', { id, type: 'Art' });
  update(team, 'role-skills', { id, role: 'Art', skills: ['deploy', 'deploy', 'pdf_tools'] });
  assert.deepEqual(team.roleSkills, { Art: ['deploy', 'pdf_tools'] }); assert.match(team.threads[0].messages.at(-1).text, /Skill của Art: deploy, pdf_tools/);
  update(team, 'role-skills', { id, role: 'Art', skills: [] }); assert.deepEqual(team.roleSkills.Art, []);
  assert.throws(() => update(team, 'role-skills', { id, role: 'Art', skills: ['bad name'] }), /không hợp lệ/);
  assert.throws(() => update(team, 'role-skills', { id, role: 'Nope', skills: [] }), /Role không hợp lệ/);
  update(team, 'role-skills', { id, role: skills.CHAT_KEY, skills: ['deploy'] });
  assert.deepEqual(team.roleSkills[skills.CHAT_KEY], ['deploy']); assert.match(team.threads[0].messages.at(-1).text, /Skill của chat thường: deploy/);
});

test('a typed /<name> runs the project skill of that name with the user note; anything else is not a project command', () => {
  const folder = temp(), app = temp(); skill(path.join(folder, '.claude', 'skills'), 'build_preview', '---\nname: build_preview\ndescription: Build preview\n---\nsteps');
  skill(app, 'only_app', '---\nname: only_app\ndescription: App skill\n---\n');
  const found = skills.projectCommand('/build_preview', folder);
  assert.equal(found.skill.name, 'build_preview'); assert.match(found.prompt, /Lệnh \/build_preview của dự án: dùng Read đọc .*SKILL\.md/); assert.doesNotMatch(found.prompt, /Ghi chú/);
  assert.match(skills.projectCommand('/build_preview  chỉ applovin\nnhanh', folder).prompt, /Ghi chú của người dùng: chỉ applovin\nnhanh$/);
  for (const content of ['/build_previews', '/only_app', 'build_preview', '/build preview', '/skills']) assert.equal(skills.projectCommand(content, folder), null, content);
  assert.equal(skills.projectCommand('/build_preview', ''), null);
});

test('projectSkill finds a skill of the project folder by name only', () => {
  const folder = temp(); skill(path.join(folder, '.claude', 'skills'), 'build_production', '---\nname: build_production\ndescription: Build production\n---\n');
  assert.equal(skills.projectSkill(folder, 'build_production').name, 'build_production');
  assert.equal(skills.projectSkill(folder, 'build_preview'), null); assert.equal(skills.projectSkill('', 'build_production'), null);
});
