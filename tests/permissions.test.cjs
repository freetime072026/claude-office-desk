const { test } = require('node:test'); const assert = require('node:assert/strict');
const path = require('node:path');
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
test('shared note files (MISSING_SOUNDS.md, ART_PROMPTS.md) do not make two blocks with separate files overlap', () => {
  const { roleScope, scopesOverlap, exclusivePaths } = require('../permissions.cjs');
  const files = { missingSounds: 'D:/p/.office-desk/MISSING_SOUNDS.md', artPrompts: 'D:/p/.office-desk/s/ART_PROMPTS.md', artLessons: 'D:/p/.office-desk/ART_LESSONS.md' };
  const dev = roleScope('Dev', files, ['src/a/'], 'D:/p'), dev2 = roleScope('Dev', files, ['src/b/'], 'D:/p');
  const art = roleScope('Art', files, ['assets/x/'], 'D:/p'), art2 = roleScope('Art', files, ['assets/y/'], 'D:/p');
  assert.equal(scopesOverlap(dev.paths, dev2.paths), true); // vẫn cùng được ghi tệp chung
  assert.equal(scopesOverlap(exclusivePaths(dev), exclusivePaths(dev2)), false);
  assert.equal(scopesOverlap(exclusivePaths(art), exclusivePaths(art2)), false);
  assert.equal(scopesOverlap(exclusivePaths(roleScope('Dev', files, ['src/'], 'D:/p')), exclusivePaths(dev)), true);
  // ISSUES.md is a shared note file too (QA, Art Director, Lead, Release only add their own entries).
  assert.deepEqual(exclusivePaths(roleScope('QA', { ...files, issues: 'I', perf: 'P' })), ['P']);
});

test('a write outside an Anim task from the Art Director names the Art Director, the allowed folders, and not a Sound role', () => {
  const { roleScope, decide } = require('../permissions.cjs'), { filesOf } = require('../session-files.cjs');
  const folder = path.resolve('/game'), files = filesOf({ id: 's', folder });
  const scope = roleScope('Anim', files, ['assets/anim/dj/', 'assets/anim/tut/'], folder, 'Art Director');
  const verdict = decide({ scope, mode: 'edit', tool: 'Write', input: { file_path: path.join(folder, 'assets/anim/README.md') }, cwd: folder });
  assert.equal(verdict.action, 'deny');
  assert.match(verdict.message, /files của task Art Director giao/);
  assert.ok(verdict.message.includes(`Được ghi: ${path.join(folder, 'assets/anim/dj') + path.sep}, ${path.join(folder, 'assets/anim/tut') + path.sep}.`), verdict.message);
  assert.match(verdict.message, /để Art Director giao lại/);
  assert.doesNotMatch(verdict.message.split('Được ghi')[1], /MISSING_SOUNDS/);
});

test('shell commands that scan a whole drive (find / -iname ffmpeg.exe hung Sound for 10+ minutes) are denied with a faster alternative', () => {
  const { decide, wholeDiskScan } = require('../permissions.cjs');
  const scope = { paths: [], bash: true, label: 'Sound' };
  const verdict = decide({ scope, mode: 'edit', tool: 'Bash', input: { command: 'cd /d/ArcherPLA; which ffmpeg; find / -iname ffmpeg.exe 2>/dev/null | head -3' } });
  assert.equal(verdict.action, 'deny'); assert.match(verdict.message, /Không quét cả ổ đĩa/); assert.match(verdict.message, /command -v ffmpeg/);
  for (const command of ['find /d -name "*.mp3"', 'find /c/ -name a', 'find D:/ -name a', 'ls -laR /', 'x && find -L / -name y']) assert.ok(wholeDiskScan(command), command);
  for (const command of ['find Resource -iname "*bass*"', 'find /d/ArcherPLA/Resource -name x', 'find . -name a', 'ls -R src/', 'which ffmpeg lame', 'find /tmp/w -name a']) assert.equal(wholeDiskScan(command), '', command);
  assert.equal(decide({ scope, mode: 'bypass', tool: 'Bash', input: { command: 'find Resource -name "*.mp3"' } }).action, 'allow');
});
