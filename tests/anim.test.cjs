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

test('Anim is a Dev-type role after Art and before QA: Sonnet, edit mode, shell, 40 tool turns, works from .md files', () => {
  assert.deepEqual(PIPELINE, ['PO', 'GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'VFX', 'Art', 'Anim', 'Sound', 'QA', 'Release']);
  const { team, id, thread } = session(['QA', 'Anim', 'Art', 'Dev', 'Lead Dev']);
  assert.deepEqual(thread.flow, ['Lead Dev', 'Dev', 'Art', 'Anim', 'QA']);
  assert.equal(worker(thread, 'Anim').model, 'sonnet'); assert.equal(worker(thread, 'Anim').mode, 'edit');
  assert(DEV_TYPES.includes('Anim') && SHELL_TYPES.includes('Anim') && FILE_ROLES.includes('Anim')); assert.equal(MAX_TURNS.Anim, 40);
  assert.equal(update(team, 'add-worker', { id, type: 'Anim' }), 'Anim #2');
  assert.equal(roleScope('Anim', filesOf({ id: 's', folder: 'E:\\game' }), ['Assets/_Art/Anim/'], 'E:\\game').bash, true);
});

test('who assigns Anim: Lead without an Art Director, the Art Director when there is one; AD review reject can send work back to Anim', () => {
  const solo = session(['Lead Dev', 'Dev', 'Anim']).thread;
  assert(mergePlan(solo, 'Lead Dev', tasks([['Dev', ['src/']], ['Anim', ['Assets/Anim/']]])).dispatch);
  const { thread } = session(['GD', 'UI/UX', 'Art Director', 'Lead Dev', 'Dev', 'Art', 'Anim', 'Sound', 'QA']);
  assert.match(mergePlan(thread, 'Lead Dev', tasks([['Anim', ['Assets/Anim/']]])).problems, /Anim: ở pha lập kế hoạch, Art\/Anim do Art Director giao/);
  const ad = mergePlan(thread, 'Art Director', tasks([['Art', ['ArtGen/']], ['Anim', ['Assets/Anim/']]])).dispatch;
  assert.deepEqual(ad.map(task => task.worker + ':' + task.by), ['Art:Art Director', 'Anim:Art Director']);
  const edges = graph.defaultGraph(thread).edges.map(edge => `${edge.from}>${edge.to}:${edge.when}`);
  for (const edge of ['Lead Dev@planning>Anim:done', 'Anim>QA:done', 'Anim>Art Director@review:done', 'Art Director@review>Anim:reject']) assert(edges.includes(edge), edge);
});

test('Anim prompt: Anim section of GDD and ANIM specs, Editor scripts over hand-edited YAML, frame-by-frame self-check, clip details in handoff', () => {
  const files = filesOf({ id: 's', folder: 'E:\\game' });
  const thread = { flow: ['GD', 'Lead Dev', 'Anim', 'QA'], workers: { Anim: { type: 'Anim', task: 'ANIM-1 attack', files: ['Assets/Anim/'] } }, messages: [], attachments: [] };
  const { brief } = rolePrompt({}, thread, 'Anim', { content: 'x', files });
  assert.match(brief, /mục ANIM-… của task trong .*ART\.md/); assert.match(brief, /mục Anim trong .*GDD\.md/); assert.match(brief, /Chỉ được sửa: Assets\/Anim\//);
  assert.match(brief, /không sửa YAML \.anim\/\.controller/); assert.match(brief, /chụp các frame chính hoặc contact sheet rồi Read/);
  assert.match(brief, /số frame, fps, thời lượng, event, loop/); assert.match(brief, /"reassign":true/);
  assert.match(TEMPLATES.gdd, /## Art\n[^\n]*\n\n## Anim\n<!-- Animation nào[^\n]*\n\n## Sound\n/);
  assert.match(TEMPLATES.art, /ANIM-…: clip, số frame, fps/);
});
