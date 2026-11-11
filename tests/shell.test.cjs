const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withShell, decide, roleScope } = require('../permissions.cjs');
const { cliTools } = require('../modes.cjs');
const { update, initial } = require('../team.cjs');
const files = { gdd: 'E:/g/.office-desk/s/GDD.md', project: 'E:/g/.office-desk/PROJECT.md', issues: 'E:/g/.office-desk/s/ISSUES.md', perf: 'E:/g/.office-desk/s/PERF.md', uiux: 'E:/g/.office-desk/s/UIUX.md' };

test('default: roles with shell are asked; GD has no shell but keeps web', () => {
  const dev = roleScope('Dev', files, ['src/a.cs'], 'E:/g'), gd = roleScope('GD', files, [], 'E:/g');
  assert.equal(decide({ scope: withShell(dev, undefined), mode: 'edit', tool: 'Bash', input: { command: 'ls' } }).action, 'ask');
  assert.equal(decide({ scope: gd, mode: 'edit', tool: 'Bash', input: { command: 'ls' } }).action, 'deny');
  assert.match(cliTools('edit', gd), /WebSearch/); assert.doesNotMatch(cliTools('edit', gd), /Bash/);
});
test('allow: shell runs without asking, also for a block that normally has none, and keeps its web tools', () => {
  const gd = withShell(roleScope('GD', files, [], 'E:/g'), 'allow');
  assert.equal(decide({ scope: gd, mode: 'edit', tool: 'Bash', input: { command: 'ls' } }).action, 'allow');
  assert.match(cliTools('edit', gd), /Bash/); assert.match(cliTools('edit', gd), /WebSearch/);
  const dev = withShell(roleScope('Dev', files, ['src/a.cs'], 'E:/g'), 'allow');
  assert.equal(decide({ scope: dev, mode: 'edit', tool: 'Bash', input: { command: 'curl http://localhost:8090/health' } }).action, 'allow');
  assert.doesNotMatch(cliTools('edit', dev), /WebSearch/);
});
test('deny: shell and the code-reader subagent are off', () => {
  const dev = withShell(roleScope('Dev', files, ['src/a.cs'], 'E:/g'), 'deny');
  assert.equal(decide({ scope: dev, mode: 'bypass', tool: 'Bash', input: { command: 'ls' } }).action, 'deny');
  assert.doesNotMatch(cliTools('edit', dev), /Bash|Agent/);
});
test('worker-config stores the shell option and a change forgets the session approval', () => {
  const team = initial(), id = update(team, 'create', { request: 'x' });
  update(team, 'add-worker', { id, type: 'Dev' }); const thread = team.threads.find(item => item.id === id);
  thread.shellApproved = { Dev: 'yes' };
  const base = { id, role: 'Dev', mode: 'edit', model: 'sonnet', profileId: '', task: '' };
  update(team, 'worker-config', { ...base, shell: 'once' }); assert.equal(thread.shellApproved.Dev, 'yes'); assert.equal(thread.workers.Dev.shell, undefined);
  update(team, 'worker-config', { ...base, shell: 'deny' }); assert.equal(thread.workers.Dev.shell, 'deny'); assert.equal(thread.shellApproved.Dev, undefined);
  assert.throws(() => update(team, 'worker-config', { ...base, shell: 'root' }), /shell không hợp lệ/);
  update(team, 'remove-role', { id, role: 'Dev' }); assert.equal(thread.shellApproved.Dev, undefined);
});
test('quoted Git Bash paths with spaces stay whole, and cd to the parent of the session folders explains the fix', () => {
  const { outsidePaths } = require('../permissions.cjs'); const folders = ['D:/Work/Game-13', 'D:/Work/Game-10'];
  assert.deepEqual(outsidePaths('ls "/d/Work/Game-13/input/My Assets" \'/d/Work/Game-10/a b.png\'', folders), []);
  assert.deepEqual(outsidePaths('ls "/d/Other Place/x.png"', folders), ['D:/Other Place/x.png']); // trước đây cắt thành D:/Other
  const programs = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles;
  if (programs) { const bash = '/' + programs[0].toLowerCase() + programs.slice(2).split(require('node:path').sep).join('/'); assert.deepEqual(outsidePaths(`ls "${bash}/Microsoft/Edge/Application/msedge.exe"`, folders), []); }
  const dev = roleScope('Dev', files, ['src/'], 'D:/Work/Game-13');
  const parent = decide({ scope: withShell(dev, 'allow'), mode: 'edit', tool: 'Bash', input: { command: 'cd /d/Work; ls Game-10/node_modules' }, folders });
  assert.equal(parent.action, 'deny'); assert.match(parent.message, /thư mục cha của thư mục session: không cd lên đó/);
  const other = decide({ scope: withShell(dev, 'allow'), mode: 'edit', tool: 'Bash', input: { command: 'ls /d/Elsewhere' }, folders });
  assert.equal(other.action, 'deny'); assert.doesNotMatch(other.message, /thư mục cha/);
});
