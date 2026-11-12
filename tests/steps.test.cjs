const { test } = require('node:test');
const assert = require('node:assert/strict');
const { consume } = require('../chat.cjs');
const toolUse = (id, name, input, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });

test('each tool call becomes a step with detail, then gets its clipped result and status', () => {
  const message = { text: '', time: new Date().toISOString() }, seen = new Set();
  consume(message, toolUse('a', 'Bash', { command: 'bash .office-desk/unity.sh   wait-compile' }), seen);
  consume(message, toolUse('b', 'Read', { file_path: 'E:/p/Assets/A.cs', offset: 40, limit: 30 }), seen);
  consume(message, toolUse('c', 'Grep', { pattern: 'TryGetShotOrigin', path: 'Assets' }, 'agent-1'), seen);
  assert.deepEqual(message.steps.map(step => [step.tool, step.detail, Boolean(step.sub)]), [['Bash', 'bash .office-desk/unity.sh wait-compile', false], ['Read', 'E:/p/Assets/A.cs (dòng 40+30)', false], ['Grep', 'TryGetShotOrigin · Assets', true]]);
  consume(message, toolResult('a', [{ type: 'text', text: 'error CS1010: Newline in constant\n'.repeat(20) }], true), seen);
  consume(message, toolResult('b', 'ok'), seen);
  const [bash, read, grep] = message.steps;
  assert.equal(bash.ok, false); assert(bash.end); assert(bash.result.length <= 201); assert.match(bash.result, /^error CS1010/);
  assert.equal(read.ok, true); assert.equal(read.result, 'ok'); assert.equal(grep.end, undefined);
  consume(message, toolUse('a', 'Bash', { command: 'dup' }), seen); assert.equal(message.steps.length, 3);
});
test('the step log keeps only the most recent steps', () => {
  const message = { text: '' }, seen = new Set();
  for (let index = 0; index < 55; index++) consume(message, toolUse('t' + index, 'Read', { file_path: 'f' + index }), seen);
  assert.equal(message.steps.length, 40); assert.equal(message.steps[0].detail, 'f15'); assert.equal(message.progress.steps, 55);
});
test('reading an image keeps its full path on the step so the log can open it, even when the shown detail is clipped', () => {
  const message = { text: '' }, seen = new Set(), long = 'C:/Users/u/.codex/generated_images/' + 'x'.repeat(220) + '/exec-1.png';
  consume(message, toolUse('i', 'Read', { file_path: long }), seen);
  consume(message, toolUse('t', 'Read', { file_path: 'E:/p/a.md' }), seen);
  consume(message, toolResult('i', [{ type: 'image', source: {} }]), seen);
  const [image, text] = message.steps;
  assert.equal(image.image, long); assert.equal(image.result, '[ảnh]'); assert.match(image.detail, /…$/);
  assert.equal(text.image, undefined);
});
test('the chat file reader opens images in the Codex image folder, read only', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { readProjectFile } = require('../files.cjs');
  const codexImages = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-')), project = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-'));
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a2f20000000049454e44ae426082', 'hex');
  const file = path.join(codexImages, 'sess', 'exec-1.png'); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, png);
  assert.throws(() => readProjectFile(file, [project]), 'outside the session folders without the Codex root');
  assert.equal(readProjectFile(file, [project], { readOnlyRoots: [codexImages] }).kind, 'image');
});
