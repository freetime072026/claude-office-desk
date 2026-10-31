const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsage, foldersOf, extraFolderArgs } = require('../usage.cjs');
test('usage rejects invalid values, expires reset windows and marks stale', () => {
  const now = Date.now(); const result = normalizeUsage({ updatedAt: now - 3600000, five_hour: { used_percentage: 99, resets_at: now / 1000 + 100 }, seven_day: { used_percentage: 50, resets_at: now / 1000 - 1 } }, now);
  assert.equal(result.stale, true); assert.equal(result.five_hour.used_percentage, 99); assert.equal(result.seven_day, undefined);
  assert.equal(normalizeUsage({ updatedAt: now + 999999 }, now), null);
  assert.equal(normalizeUsage({ updatedAt: now, five_hour: { used_percentage: 101, resets_at: now / 1000 + 5 } }, now).five_hour, undefined);
});
test('legacy folder stays primary; extras passed separately without interpolation', () => { const folders = foldersOf({ folder: 'C:\\Main', relatedFolders: ['C:\\Ref space', 'C:\\Main'] }); assert.deepEqual(folders, ['C:\\Main', 'C:\\Ref space']); assert.deepEqual(extraFolderArgs(folders), ['--add-dir', 'C:\\Ref space']); });
