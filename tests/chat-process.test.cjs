const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launch, CLI_FAILED_TEXT } = require('../chat.cjs');
const skip = process.platform !== 'win32';
async function run(prompt) {
  const thread = { folder: __dirname, messages: [], mode: 'read', model: 'sonnet' };
  const started = launch({ executable: path.join(__dirname, 'fake-cli.cmd'), directory: __dirname, settings: 'unused.json', mcp: 'unused.json', thread, profileId: 'test-profile', prompt, save: () => {}, publish: () => {} });
  await new Promise((resolve, reject) => { started.child.once('error', reject); started.child.once('close', resolve); });
  return thread;
}
test('PowerShell bridge streams Unicode prompt and saves resume id without terminal UI', { skip, timeout: 20000 }, async () => {
  const thread = await run('Xin chào "Unity" & $example');
  assert.equal(thread.messages[0].text, 'Echo: Xin chào "Unity" & $example');
  assert.equal(thread.messages[0].streaming, false);
  assert.equal(Object.values(thread.cliSessions)[0], 'mock-native-session');
  assert.deepEqual(thread.messages[0].usage, { input: 1200, output: 345, cacheRead: 5000, cacheWrite: 800, costUsd: 0.0421, turns: 3 });
});
test('CLIXML-only stderr is dropped and the standard error text is shown', { skip, timeout: 20000 }, async () => {
  const message = (await run('[clixml]')).messages[0];
  assert.equal(message.error, true);
  assert.equal(message.text.trim(), CLI_FAILED_TEXT);
  assert.doesNotMatch(message.text, /CLIXML|<Objs/);
});
test('real stderr lines survive CLIXML filtering', { skip, timeout: 20000 }, async () => {
  const message = (await run('[clixml+error]')).messages[0];
  assert.equal(message.error, true);
  assert.equal(message.text.trim(), 'Login required');
});
