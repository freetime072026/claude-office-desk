const fs = require('node:fs'); const path = require('node:path');
// Không tự cấp quyền cho gốc ổ đĩa hoặc thư mục hệ thống chỉ vì đường dẫn xuất hiện trong tin nhắn (ví dụ dán log có C:\Windows\System32\...).
function systemFolder(folder, env = process.env) {
  const value = folder.toLowerCase().replace(/[\\/]+$/, '');
  if (/^[a-z]:$/.test(value) || /^\\\\[^\\]+\\[^\\]+$/.test(value)) return true;
  return [env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData].filter(Boolean).map(item => item.toLowerCase().replace(/[\\/]+$/, '')).some(root => value === root || value.startsWith(root + '\\'));
}
// refused nhận các thư mục hệ thống bị bỏ qua để báo lại cho người dùng.
function pathsFromInput(text, refused = []) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(/["`]([^"`]+)["`]|(?:^|\s)((?:[A-Za-z]:[\\/]|\\\\)[^\r\n"`<>|?*]*)/g)];
    for (const match of matches) {
      const value = (match[1] || match[2] || '').trim(); if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) continue;
      let folder; try { const resolved = fs.realpathSync(value); const stat = fs.statSync(resolved); folder = stat.isDirectory() ? resolved : stat.isFile() ? path.dirname(resolved) : null; } catch { continue; }
      if (!folder) continue;
      if (systemFolder(folder)) { if (!refused.some(item => item.toLowerCase() === folder.toLowerCase())) refused.push(folder); continue; }
      if (!found.some(item => item.toLowerCase() === folder.toLowerCase())) found.push(folder);
    }
  }
  return found;
}
function adoptPaths(thread, text, refused = []) { const detected = pathsFromInput(text, refused); if (!detected.length) return false; const folders = [...detected]; for (const folder of [thread.folder, ...(thread.relatedFolders || [])].filter(Boolean)) if (!folders.some(item => item.toLowerCase() === folder.toLowerCase())) folders.push(folder); if (folders.length > 16) throw Error('Tối đa 16 thư mục'); thread.folder = folders[0]; thread.relatedFolders = folders.slice(1); return true; }
module.exports = { pathsFromInput, adoptPaths, systemFolder };
