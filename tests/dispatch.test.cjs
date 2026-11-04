const { test } = require('node:test'); const assert = require('node:assert/strict'); const { pump } = require('../dispatch.cjs'); const { adoptPaths } = require('../path-input.cjs');
test('direct existing path becomes workspace, without granting a non-existent parent fallback', {skip:process.platform !== 'win32'}, () => { const thread = {}; assert.equal(adoptPaths(thread, __dirname + '\nđánh giá hệ thống'), true); assert.equal(thread.folder.toLowerCase(), __dirname.toLowerCase()); const before = thread.folder; assert.equal(adoptPaths(thread, __dirname + ' not-a-real-directory'), false); assert.equal(thread.folder, before); });
test('independent Dev tasks start without waiting for other Dev completion; dependent task waits', async () => { const thread = {dispatch:[{worker:'Dev',task:'A',status:'queued'},{worker:'Dev #2',task:'B',status:'queued'},{worker:'Dev #3',task:'C',status:'queued',dependsOn:['Dev']}]}; const started=[]; await pump(thread, async task => {started.push(task.worker); return true;},()=>{}); assert.deepEqual(started,['Dev','Dev #2']); thread.dispatch[0].status='finished'; await pump(thread,async task=>{started.push(task.worker);return true;},()=>{}); assert.equal(started.at(-1),'Dev #3'); });
test('authentication and validation failures become visible blockers, not completed tasks', async()=>{const thread={dispatch:[{worker:'Dev',task:'A',status:'queued'}]};await pump(thread,async()=>({loginStarted:true}),()=>{});assert.equal(thread.dispatch[0].status,'blocked');});
test('a pasted file path (e.g. "Demo: <folder>\index.html") adds its folder as related but never switches the main folder', { skip: process.platform !== 'win32' }, () => {
  const path = require('node:path'), main = path.resolve(__dirname, '..'), file = __filename;
  const thread = { folder: main, relatedFolders: [] };
  assert.equal(adoptPaths(thread, 'Demo: ' + file), true);
  assert.equal(thread.folder, main); assert.deepEqual(thread.relatedFolders.map(item => item.toLowerCase()), [__dirname.toLowerCase()]);
  assert.equal(adoptPaths(thread, 'lại là ' + file), false, 'already known: nothing changes');
  // Thư mục gõ trực tiếp vẫn là lời chỉ định thư mục chính.
  assert.equal(adoptPaths(thread, 'project là ' + __dirname), true); assert.equal(thread.folder.toLowerCase(), __dirname.toLowerCase());
  const fresh = {}; assert.equal(adoptPaths(fresh, file), true); assert.equal(fresh.folder.toLowerCase(), __dirname.toLowerCase());
});
