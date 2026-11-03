const { test } = require('node:test'); const assert = require('node:assert/strict');
const { initial, update } = require('../team.cjs');
const { rolePrompt, roleContext } = require('../prompt.cjs');
const { PRESETS, purposeConfig } = require('../presets.cjs');
const { defaults } = require('../roles.cjs');
const session = () => { const team = initial(); const id = update(team, 'create', { request: 'Playable tower defense' }); return { team, id, thread: team.threads[0] }; };

test('PLA preset picks the PLA team and marks every block as PLA-only', () => {
  const { team, id, thread } = session(); update(team, 'select-roles', { id, roles: ['GD', 'VFX'] });
  update(team, 'apply-preset', { id, preset: 'PLA' });
  assert.deepEqual(thread.flow, PRESETS.PLA.roles); assert.equal(thread.preset, 'PLA');
  for (const label of thread.flow) assert.equal(thread.workers[label].purpose, 'pla', label);
  assert.throws(() => update(team, 'apply-preset', { id, preset: 'nope' }), /Preset không hợp lệ/);
});

test('a PLA Dev/QA uses PLA responsibility and is told to refuse non-PLA work', () => {
  const { team, id, thread } = session(); update(team, 'apply-preset', { id, preset: 'PLA' });
  for (const type of ['Dev', 'QA']) {
    const context = roleContext(team, thread, type);
    assert.equal(context.responsibility, PRESETS.PLA.config[type].responsibility); assert.match(context.instructions, /chỉ phục vụ làm playable ad/);
  }
  assert.match(rolePrompt(team, thread, 'Dev', { content: 'x' }).brief, /không request ngoài/);
});

test('purpose is per block: switching a Dev back to game restores the normal role text', () => {
  const { team, id, thread } = session(); update(team, 'apply-preset', { id, preset: 'PLA' });
  const second = update(team, 'add-worker', { id, type: 'Dev' }); assert.equal(thread.workers[second].purpose, 'pla');
  update(team, 'worker-config', { id, role: second, mode: 'edit', model: 'sonnet', task: '', purpose: 'game' });
  assert.equal(thread.workers[second].purpose, undefined); assert.equal(roleContext(team, thread, second).responsibility, defaults.Dev.responsibility);
  assert.equal(thread.workers.Dev.purpose, 'pla');
  update(team, 'worker-config', { id, role: second, mode: 'edit', model: 'sonnet', task: '', purpose: 'pla' }); assert.equal(thread.workers[second].purpose, 'pla');
  assert.throws(() => update(team, 'worker-config', { id, role: 'Dev', mode: 'edit', model: 'sonnet', task: '', purpose: 'web' }), /Mục đích không hợp lệ/);
});

test('a plain session keeps blocks on game; roles outside the preset cannot be PLA', () => {
  const { team, id, thread } = session(); update(team, 'select-roles', { id, roles: ['Dev', 'VFX'] });
  assert.equal(thread.workers?.Dev?.purpose, undefined); assert.equal(purposeConfig('VFX', 'pla'), null);
  update(team, 'add-worker', { id, type: 'QA' }); assert.equal(thread.workers.QA.purpose, undefined);
  assert.throws(() => update(team, 'worker-config', { id, role: 'VFX', mode: 'edit', model: 'sonnet', task: '', purpose: 'pla' }), /Mục đích không hợp lệ/);
});

test('engine chosen with the PLA preset reaches every PLA block; it can change later or go back to Lead choosing', () => {
  const { team, id, thread } = session(); update(team, 'apply-preset', { id, preset: 'PLA', engine: 'cocos' });
  assert.equal(thread.engine, 'cocos'); assert.match(thread.messages.at(-1).text, /Engine: Cocos Creator/);
  for (const type of ['Dev', 'QA', 'Art']) assert.match(roleContext(team, thread, type).instructions, /Engine: Cocos Creator/, type);
  update(team, 'preset-engine', { id, engine: 'phaser' }); assert.match(roleContext(team, thread, 'Dev').instructions, /Engine: Phaser/);
  update(team, 'preset-engine', { id, engine: '' }); assert.equal(thread.engine, undefined); assert.doesNotMatch(roleContext(team, thread, 'Dev').instructions, /Engine:/);
  assert.throws(() => update(team, 'preset-engine', { id, engine: 'unreal' }), /Engine không hợp lệ/);
  assert.throws(() => update(team, 'apply-preset', { id, preset: 'PLA', engine: 'unreal', restart: true }), /Engine không hợp lệ/); assert.equal(thread.engine, undefined);
});

test('a game block in a PLA session does not get the engine guide', () => {
  const { team, id, thread } = session(); update(team, 'apply-preset', { id, preset: 'PLA', engine: 'pixi' });
  update(team, 'worker-config', { id, role: 'Dev', mode: 'edit', model: 'sonnet', task: '', purpose: 'game' });
  assert.equal(roleContext(team, thread, 'Dev').instructions, '');
  assert.deepEqual(Object.keys(PRESETS.PLA.engines), ['luna', 'cocos', 'phaser', 'pixi', 'playcanvas', 'threejs']);
});

test('Spine choice made with the PLA preset reaches every PLA block after the engine guide; it can change later or go back to Lead choosing', () => {
  const { team, id, thread } = session(); update(team, 'apply-preset', { id, preset: 'PLA', engine: 'phaser', spine: 'tween' });
  assert.equal(thread.spine, 'tween'); assert.match(thread.messages.at(-1).text, /Spine: Dựng lại bằng tween/);
  const anim = roleContext(team, thread, 'Anim').instructions; assert.match(anim, /Engine: Phaser[\s\S]*không dùng runtime Spine/);
  update(team, 'preset-spine', { id, spine: 'runtime' }); assert.match(roleContext(team, thread, 'Dev').instructions, /@esotericsoftware\/spine-phaser/);
  update(team, 'preset-spine', { id, spine: '' }); assert.equal(thread.spine, undefined); assert.doesNotMatch(roleContext(team, thread, 'Dev').instructions, /Spine đầu vào/);
  assert.throws(() => update(team, 'preset-spine', { id, spine: 'dragonbones' }), /Spine không hợp lệ/);
  assert.throws(() => update(team, 'apply-preset', { id, preset: 'PLA', spine: 'x' }), /Spine không hợp lệ/);
});
