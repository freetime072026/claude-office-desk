function normalizeUsage(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.updatedAt) || value.updatedAt > now + 60000) return null;
  const output = { updatedAt: value.updatedAt, stale: now - value.updatedAt > 15 * 60000 };
  for (const key of ['five_hour', 'seven_day']) {
    const window = value[key];
    if (window && Number.isFinite(window.used_percentage) && window.used_percentage >= 0 && window.used_percentage <= 100 && Number.isFinite(window.resets_at) && window.resets_at * 1000 > now) output[key] = { used_percentage: window.used_percentage, resets_at: window.resets_at };
    else if (window && Number.isFinite(window.resets_at) && window.resets_at * 1000 > now && ['allowed', 'allowed_warning', 'rejected'].includes(window.status)) output[key] = { resets_at: window.resets_at, status: window.status };
  }
  return output;
}
function foldersOf(thread) { return [...new Set([thread.folder, ...(thread.relatedFolders || [])].filter(Boolean))]; }
function extraFolderArgs(folders) { return folders.slice(1).flatMap(folder => ['--add-dir', folder]); }
function usageEvent(event, previous = {}) {
  if (event.type !== 'rate_limit_event' || !event.rate_limit_info) return null;
  const info = event.rate_limit_info; if (!['five_hour', 'seven_day'].includes(info.rateLimitType) || !Number.isFinite(info.resetsAt)) return null;
  const value = { ...previous, updatedAt: Date.now() }; const window = { resets_at: info.resetsAt, status: ['allowed', 'allowed_warning', 'rejected'].includes(info.status) ? info.status : 'unknown' };
  if (Number.isFinite(info.utilization) && info.utilization >= 0 && info.utilization <= 1) window.used_percentage = info.utilization * 100;
  else if (previous[info.rateLimitType]?.resets_at === info.resetsAt && Number.isFinite(previous[info.rateLimitType]?.used_percentage)) window.used_percentage = previous[info.rateLimitType].used_percentage;
  value[info.rateLimitType] = window; return value;
}
module.exports = { normalizeUsage, foldersOf, extraFolderArgs, usageEvent };
