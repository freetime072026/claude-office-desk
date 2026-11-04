const fs = require('node:fs'); const path = require('node:path');
// Không tự cấp quyền cho gốc ổ đĩa hoặc thư mục hệ thống chỉ vì đường dẫn xuất hiện trong tin nhắn (ví dụ dán log có C:\Windows\System32\...).
function systemFolder(folder, env = process.env) {
  const value = folder.toLowerCase().replace(/[\\/]+$/, '');
  if (/^[a-z]:$/.test(value) || /^\\\\[^\\]+\\[^\\]+$/.test(value)) return true;
  return [env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData].filter(Boolean).map(item => item.toLowerCase().replace(/[\\/]+$/, '')).some(root => value === root || value.startsWith(root + '\\'));
}
// refused nhận các thư mục hệ thống bị bỏ qua để báo lại cho người dùng. fileFolders nhận thư mục chứa các đường dẫn tệp
// (ví dụ "Demo: D:\Res\index.html"): tệp chỉ là tham chiếu, không phải lời chỉ định thư mục làm việc.
function pathsFromInput(text, refused = [], fileFolders = []) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(/["`]([^"`]+)["`]|(?:^|\s)((?:[A-Za-z]:[\\/]|\\\\)[^\r\n"`<>|?*]*)/g)];
    for (const match of matches) {
      const value = (match[1] || match[2] || '').trim(); if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) continue;
      let folder, isFile = false; try { const resolved = fs.realpathSync(value); const stat = fs.statSync(resolved); isFile = stat.isFile(); folder = stat.isDirectory() ? resolved : isFile ? path.dirname(resolved) : null; } catch { continue; }
      if (!folder) continue;
      if (systemFolder(folder)) { if (!refused.some(item => item.toLowerCase() === folder.toLowerCase())) refused.push(folder); continue; }
      const target = isFile ? fileFolders : found;
      if (!target.some(item => item.toLowerCase() === folder.toLowerCase())) target.push(folder);
    }
  }
  return found;
}
// Thư mục gõ trong tin thành thư mục chính (ví dụ "project là D:\game"). Đường dẫn tệp chỉ cấp thêm thư mục chứa nó làm thư mục liên
// quan và không đổi thư mục chính (dán "Demo: D:\Res\index.html" từng đổi thư mục chính sang D:\Res, mọi đường dẫn tương đối của
// Lead/Dev trỏ sai project); session chưa có thư mục thì tệp vẫn xác định thư mục làm việc.
function adoptPaths(thread, text, refused = []) {
  const fileFolders = [], detected = pathsFromInput(text, refused, fileFolders); if (!detected.length && !fileFolders.length) return false;
  const current = [thread.folder, ...(thread.relatedFolders || [])].filter(Boolean), folders = [];
  const add = folder => { if (!folders.some(item => item.toLowerCase() === folder.toLowerCase())) folders.push(folder); };
  for (const folder of detected) add(folder);
  for (const folder of current.length ? [...current, ...fileFolders] : [...fileFolders]) add(folder);
  if (folders.length > 16) throw Error('Tối đa 16 thư mục');
  const changed = folders.length !== current.length || folders.some((folder, index) => folder.toLowerCase() !== current[index]?.toLowerCase());
  thread.folder = folders[0]; thread.relatedFolders = folders.slice(1); return changed;
}
module.exports = { pathsFromInput, adoptPaths, systemFolder };
