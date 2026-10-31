const fs = require('node:fs'); const path = require('node:path');
function pathsFromInput(text) {
  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(/["`]([^"`]+)["`]|(?:^|\s)((?:[A-Za-z]:[\\/]|\\\\)[^\r\n"`<>|?*]*)/g)];
    for (const match of matches) {
      let value = (match[1] || match[2] || '').trim(); if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value)) continue;
      while (value) {
        try { const resolved = fs.realpathSync(value); const stat = fs.statSync(resolved); const folder = stat.isDirectory() ? resolved : stat.isFile() ? path.dirname(resolved) : null; if (folder && !found.some(item => item.toLowerCase() === folder.toLowerCase())) found.push(folder); break; } catch {}
        break;
      }
    }
  }
  return found;
}
function adoptPaths(thread, text) { const detected = pathsFromInput(text); if (!detected.length) return false; const folders = [...detected]; for (const folder of [thread.folder, ...(thread.relatedFolders || [])].filter(Boolean)) if (!folders.some(item => item.toLowerCase() === folder.toLowerCase())) folders.push(folder); if (folders.length > 16) throw Error('Tối đa 16 thư mục'); thread.folder = folders[0]; thread.relatedFolders = folders.slice(1); return true; }
module.exports = { pathsFromInput, adoptPaths };
