const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const release = require('../release-config.cjs');
const { initial, update } = require('../team.cjs');
const { rolePrompt } = require('../prompt.cjs');
const BUILD = { app: 'Playable', name: 'Template', version: 'v1', google_play_url: 'https://play.google.com/store/games', app_store_url: 'https://www.apple.com/app-store/', tracking: { package_name: 'com.old.app', playable_id: 'PA0001', env: 'production', max_tracking_duration_sec: 60, platform_camp: 'Android' }, networks: ['applovin', 'google', 'facebook'] };
const project = (data = BUILD, eol = '\r\n') => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'release-')); fs.writeFileSync(path.join(folder, 'build.json'), JSON.stringify(data, null, 2).replace(/\n/g, eol) + eol); return folder; };
const config = (extra = {}) => ({ networks: ['google', 'unity'], env: 'test', playableId: 'PA0002', packageName: 'com.office.desk', app: 'OfficeDesk', googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.office.desk', appStoreUrl: 'https://apps.apple.com/app/id123', ...extra });
const releaseSession = () => { const team = initial(); const id = update(team, 'create', { request: 'Playable' }); update(team, 'select-roles', { id, roles: ['Dev', 'QA', 'Release'] }); return { team, id, thread: team.threads[0] }; };

test('read gives the build.json values; a folder without a playable-scripts build.json gives null', () => {
  assert.deepEqual(release.read(project()), { networks: ['applovin', 'google', 'facebook'], env: 'production', playableId: 'PA0001', packageName: 'com.old.app', app: 'Playable', googlePlayUrl: BUILD.google_play_url, appStoreUrl: BUILD.app_store_url });
  assert.equal(release.read(project({ app: 'x' })), null); assert.equal(release.read(fs.mkdtempSync(path.join(os.tmpdir(), 'release-'))), null); assert.equal(release.read(''), null);
});

test('validate keeps networks in playable-scripts order and refuses bad values', () => {
  assert.deepEqual(release.validate(config({ networks: ['unity', 'google', 'unity'] })).networks, ['unity', 'google']);
  for (const [extra, message] of [[{ networks: [] }, /ít nhất một/], [{ networks: ['preview'] }, /Network/], [{ env: 'staging' }, /Preview hoặc Production/], [{ playableId: 'PA 1' }, /playable_id/], [{ packageName: '' }, /Package name/], [{ app: 'a/b' }, /Tên app/], [{ googlePlayUrl: 'http://x.com' }, /https/], [{ appStoreUrl: 'not a url' }, /App Store URL/]]) assert.throws(() => release.validate(config(extra)), message);
});

test('apply writes only the mapped keys and keeps the other keys and CRLF line endings', () => {
  const folder = project(), changed = release.apply(folder, release.validate(config()));
  assert.deepEqual(changed, ['network đích', 'chế độ', 'playable_id', 'package name', 'tên app', 'Google Play URL', 'App Store URL']);
  const raw = fs.readFileSync(path.join(folder, 'build.json'), 'utf8'), data = JSON.parse(raw);
  assert.match(raw, /\r\n  "app": "OfficeDesk",\r\n/); assert(raw.endsWith('}\r\n'));
  assert.deepEqual(data.networks, ['unity', 'google']); assert.equal(data.tracking.env, 'test'); assert.equal(data.tracking.playable_id, 'PA0002'); assert.equal(data.tracking.package_name, 'com.office.desk');
  assert.equal(data.name, 'Template'); assert.equal(data.tracking.max_tracking_duration_sec, 60);
  assert.deepEqual(release.apply(folder, release.validate(config())), []);
});

test('prepare: block without its own config reads build.json and writes nothing; with config it writes and asks to commit build.json', () => {
  const folder = project(), before = fs.readFileSync(path.join(folder, 'build.json'), 'utf8');
  const plain = release.prepare(folder, undefined); assert.match(plain, /theo tệp của project/); assert.match(plain, /applovin, google, facebook/); assert.match(plain, /Production/); assert.doesNotMatch(plain, /commit build\.json/);
  assert.equal(fs.readFileSync(path.join(folder, 'build.json'), 'utf8'), before);
  const own = release.prepare(folder, config()); assert.match(own, /theo cấu hình của khối/); assert.match(own, /unity, google/); assert.match(own, /Preview/); assert.match(own, /commit build\.json cùng bản gửi/);
  assert.doesNotMatch(release.prepare(folder, config()), /App vừa ghi/);
  assert.equal(release.prepare(fs.mkdtempSync(path.join(os.tmpdir(), 'release-')), config()), '');
});

test('release-config is stored per Release block, validated, and null goes back to build.json', () => {
  const { team, id, thread } = releaseSession(), messages = thread.messages.length;
  update(team, 'release-config', { id, role: 'Release', config: config() }); assert.equal(thread.workers.Release.release.playableId, 'PA0002');
  assert.deepEqual(thread.workers.Release.release.networks, ['unity', 'google']); assert.equal(thread.messages.length, messages);
  assert.throws(() => update(team, 'release-config', { id, role: 'Release', config: config({ env: 'dev' }) }), /Preview hoặc Production/); assert.equal(thread.workers.Release.release.env, 'test');
  assert.throws(() => update(team, 'release-config', { id, role: 'Dev', config: config() }), /Chỉ khối Release/);
  update(team, 'release-config', { id, role: 'Release', config: null }); assert.equal(thread.workers.Release.release, undefined);
});

test('the Release brief carries the build config; other roles do not', () => {
  const { team, thread } = releaseSession(), guide = release.prepare(project(), undefined);
  assert(rolePrompt(team, thread, 'Release', { content: 'x', release: guide }).brief.includes(guide));
  assert(!rolePrompt(team, thread, 'QA', { content: 'x', release: guide }).brief.includes(guide));
});
