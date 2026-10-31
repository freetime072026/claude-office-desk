const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const fresh = () => { const team = initial(); const id = update(team, 'create', { request: 'Feature' }); return { team, id, thread: team.threads[0] }; };

test('archiving unpins the session, stops auto-run and can be undone', () => {
  const { team, id, thread } = fresh(); thread.pinned = true; thread.auto = { enabled: true };
  update(team, 'archive', { id }); assert.equal(thread.archived, true); assert.equal(thread.pinned, false); assert.equal(thread.auto.enabled, false);
  update(team, 'archive', { id, archived: false }); assert.equal(thread.archived, false);
});

test('only an archived session can be deleted, and never while something of it is running', () => {
  const { team, id } = fresh();
  assert.throws(() => update(team, 'delete', { id }), /đã lưu trữ/);
  assert.throws(() => update(team, 'archive', { id, busy: ['Dev'] }), /đang chạy \(Dev\)/);
  update(team, 'archive', { id });
  assert.throws(() => update(team, 'delete', { id, busy: ['Terminal'] }), /đang chạy/);
  update(team, 'delete', { id }); assert.equal(team.threads.length, 0);
  assert.throws(() => update(team, 'delete', { id }), /không tồn tại/);
});

test('moving a session to an unknown project is refused', () => {
  const { team, id } = fresh(); const project = update(team, 'project', { name: 'Game' });
  update(team, 'move', { id, project }); assert.equal(team.threads[0].project, project);
  assert.throws(() => update(team, 'move', { id, project: 'missing' }), /Dự án không tồn tại/);
});
