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
