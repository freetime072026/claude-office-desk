const { test } = require('node:test'); const assert = require('node:assert/strict');
const { describeTool } = require('../permissions.cjs');
const { toolsFor, allowedFor, needsTurnConfirm, permissionMode } = require('../modes.cjs');

test('edit shows a -/+ diff, Bash shows the command, web warns about page content', () => {
  assert.equal(describeTool('Edit', { file_path: 'a.js', old_string: 'x = 1', new_string: 'x = 2' }), 'Sửa tệp: a.js\n\n- x = 1\n+ x = 2');
  assert.match(describeTool('Bash', { command: 'npm test', description: 'Run tests' }), /^Lệnh shell:\nnpm test\n\nMô tả: Run tests$/);
  assert.match(describeTool('WebFetch', { url: 'https://example.com', prompt: 'tóm tắt' }), /example\.com[\s\S]*chỉ thị độc hại/);
  assert.match(describeTool('mcp__unity__build', { target: 'win' }), /"target": "win"/);
});

test('long content is cut by lines and by total length', () => {
  const text = describeTool('Write', { file_path: 'big.txt', content: Array.from({ length: 100 }, (_, index) => 'line ' + index).join('\n') });
  assert.match(text, /\+ … \(\+70 dòng\)/); assert.ok(text.length < 3100);
});

test('tools per mode: web everywhere except Bypass, writes only outside Plan, nothing risky pre-allowed', () => {
  assert.equal(toolsFor('read'), 'Read,Glob,Grep,TodoWrite,WebFetch,WebSearch');
  assert.match(toolsFor('edit'), /Write,Edit,NotebookEdit,Bash,WebFetch,WebSearch$/);
  assert.doesNotMatch(toolsFor('bypass'), /Web/);
  for (const mode of ['read', 'edit', 'auto', 'bypass']) assert.doesNotMatch(allowedFor(mode, ['unity']), /b(Write|Edit|Bash|WebFetch|WebSearch)b/);
  assert.equal(allowedFor('edit', ['unity']), 'Read,Glob,Grep,TodoWrite,mcp__unity');
  assert.equal(permissionMode('edit'), 'default');
});

test('only Bypass on a protected drive still asks before the whole turn', () => {
  const env = { SystemDrive: 'C:', USERPROFILE: 'C:\Users\me' };
  assert.equal(needsTurnConfirm('bypass', ['C:\work'], env), true);
  assert.equal(needsTurnConfirm('bypass', ['E:\work'], env), false);
  for (const mode of ['read', 'edit', 'auto']) assert.equal(needsTurnConfirm(mode, ['C:\work'], env), false);
});
