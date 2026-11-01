const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { worker, mergePlan, PIPELINE } = require('../workers.cjs');
const { rolePrompt, FILE_ROLES } = require('../prompt.cjs');
const { roleScope } = require('../permissions.cjs');
const { filesOf, TEMPLATES } = require('../session-files.cjs');
const { SHELL_TYPES, DEV_TYPES, MAX_TURNS } = require('../roles.cjs');
const graph = require('../flowgraph.cjs');
const fence = (name, value) => '```' + name + '\n' + JSON.stringify(value) + '\n```';
const tasks = list => fence('tasks', { tasks: list.map(([worker, files]) => ({ worker, task: 'Việc của ' + worker, files })) });
const session = roles => { const team = initial(); const id = update(team, 'create', { request: 'Game' }); for (const type of roles) update(team, 'add-worker', { id, type }); return { team, id, thread: team.threads[0] }; };

test('Sound is a Dev-type role after Anim and before QA: Sonnet, edit mode, shell, 40 tool turns, works from .md files', () => {
  assert.deepEqual(PIPELINE, ['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'Sound', 'QA']);
  const { team, id, thread } = session(['QA', 'Sound', 'Dev', 'Lead Dev']);
  assert.deepEqual(thread.flow, ['Lead Dev', 'Dev', 'Sound', 'QA']);
  assert.equal(worker(thread, 'Sound').model, 'sonnet'); assert.equal(worker(thread, 'Sound').mode, 'edit');
  assert(DEV_TYPES.includes('Sound') && SHELL_TYPES.includes('Sound') && FILE_ROLES.includes('Sound')); assert.equal(MAX_TURNS.Sound, 40);
  assert.equal(update(team, 'add-worker', { id, type: 'Sound' }), 'Sound #2');
  assert.equal(roleScope('Sound', filesOf({ id: 's', folder: 'E:\\game' }), ['Assets/Audio/'], 'E:\\game').bash, true);
});

test('the Lead assigns Sound even when an Art Director exists; Sound runs beside Dev and before QA', () => {
  const { thread } = session(['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'Sound', 'QA']);
  assert(mergePlan(thread, 'Lead Dev', tasks([['Dev', ['src/']], ['Sound', ['Assets/Audio/']]])).dispatch);
  assert.match(mergePlan(thread, 'Art Director', tasks([['Sound', ['Assets/Audio/']]])).problems, /không phải Art\/Anim/);
  const edges = graph.defaultGraph(thread).edges.map(edge => `${edge.from}>${edge.to}:${edge.when}`);
  for (const edge of ['Lead Dev@planning>Sound:done', 'Sound>QA:done']) assert(edges.includes(edge), edge);
  assert(!edges.includes('Art Director@review>Sound:reject'));
});

test('Sound prompt: Sound section of GDD, project tools or audio MCP, import settings by Editor script, measured self-check, code hooks for Dev', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['GD', 'Lead Dev', 'Sound', 'QA'], workers: { Sound: { type: 'Sound', task: 'SFX bắn', files: ['Assets/Audio/'] } }, messages: [], attachments: [] };
  const { brief } = rolePrompt({}, thread, 'Sound', { content: 'x', files });
  assert.match(brief, /mục Sound trong .*GDD\.md/); assert.match(brief, /Chỉ được sửa: Assets\/Audio\//); assert.match(brief, /tool MCP âm thanh/);
  assert.match(brief, /Load Type, Compression, Force To Mono/); assert.match(brief, /Bạn không nghe được/); assert.match(brief, /để Lead giao Dev/);
  assert.match(brief, /peak\/LUFS/); assert.match(brief, /"reassign":true/);
  assert.match(rolePrompt({}, { flow: ['Lead Dev', 'Sound'], workers: {}, messages: [] }, 'Lead Dev', { content: 'x' }).brief, /SFX, nhạc, import âm thanh giao cho Sound/);
  assert.match(TEMPLATES.gdd, /## Sound\n<!-- SFX\/nhạc nào[^\n]*\n\n## Ngân sách performance/);
});
