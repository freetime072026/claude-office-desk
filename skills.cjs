// Skill theo chuẩn Agent Skills (thư mục có SKILL.md với frontmatter name/description). App không bật tool Skill của CLI:
// app tự đọc frontmatter và chèn danh sách vào brief, model dùng Read để đọc SKILL.md khi việc khớp mô tả. Nhờ vậy danh sách
// tool, phạm vi ghi và hộp duyệt của app giữ nguyên (allowed-tools trong frontmatter không có tác dụng).
// Nguồn: <userData>/skills (dùng chung mọi hồ sơ; /skills add tải từ GitHub vào đây) và <thư mục dự án>/.claude/skills;
// trùng tên thì skill của dự án thắng.
const fs = require('node:fs');
const path = require('node:path');
const { MCP_NAME: NAME } = require('./modes.cjs');
const DESCRIPTION_LIMIT = 300, LIST_LIMIT = 30;
const PROJECT_DIR = path.join('.claude', 'skills');
// Khoá của chat thường trong team.roleSkills: chat thường cũng chỉ dùng skill đã bật (skill tải về chưa được kiểm tra).
const CHAT_KEY = '*chat';
// Skill tải từ GitHub (skill-import.cjs) ghi nguồn vào tệp này trong thư mục skill.
const SOURCE_FILE = '.office-desk-source.json';
// Frontmatter YAML đơn giản: key: value, giá trị có thể trong ngoặc kép/đơn hoặc nhiều dòng sau > / |.
function frontmatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text); if (!match) return {};
  const lines = match[1].split(/\r?\n/), data = {};
  for (let index = 0; index < lines.length; index++) {
    const field = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[index]); if (!field) continue;
    let value = field[2].trim();
    if (/^[>|][+-]?$/.test(value)) { const block = []; while (/^\s+\S/.test(lines[index + 1] || '')) block.push(lines[++index].trim()); value = block.join(' '); }
    else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    data[field[1]] = value;
  }
  return data;
}
// Đọc lại SKILL.md chỉ khi tệp đổi: snapshot gửi danh sách skill tới giao diện nhiều lần mỗi giây khi đang stream.
const cache = new Map();
function readSkill(dir, source) {
  const file = path.join(dir, 'SKILL.md');
  let mtimeMs; try { mtimeMs = fs.statSync(file).mtimeMs; } catch { cache.delete(file); return null; }
  const cached = cache.get(file); if (cached?.mtimeMs === mtimeMs) return cached.skill;
  let skill = null;
  try {
    const data = frontmatter(fs.readFileSync(file, 'utf8')), name = data.name || path.basename(dir);
    const description = (data.description || '').replace(/\s+/g, ' ').trim();
    let origin = ''; try { origin = JSON.parse(fs.readFileSync(path.join(dir, SOURCE_FILE), 'utf8')).repo || ''; } catch {}
    if (NAME.test(name) && description) skill = { name, description: description.length > DESCRIPTION_LIMIT ? description.slice(0, DESCRIPTION_LIMIT) + '…' : description, file, dir, source, origin };
  } catch {}
  cache.set(file, { mtimeMs, skill }); return skill;
}
function scan(root, source) {
  let entries; try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries.filter(entry => entry.isDirectory()).map(entry => readSkill(path.join(root, entry.name), source)).filter(Boolean);
}
// Skill dùng được trong thư mục dự án folder, xếp theo tên.
function list(appDir, folder) {
  const byName = new Map();
  for (const skill of [...scan(appDir, 'app'), ...(folder ? scan(path.join(folder, PROJECT_DIR), 'project') : [])]) byName.set(skill.name, skill);
  return [...byName.values()].sort((first, second) => first.name.localeCompare(second.name));
}
const pick = (skills, names) => skills.filter(skill => names.includes(skill.name));
// Skill của app nằm ngoài thư mục session: thêm --add-dir để Read đọc được mà không phải duyệt.
const extraDirs = skills => skills.slice(0, LIST_LIMIT).filter(skill => skill.source === 'app').map(skill => skill.dir);
// "/<tên> [ghi chú]" trùng tên skill của dự án (.claude/skills): người dùng tự gõ lệnh nên skill chạy được dù chưa bật cho khối.
// Trả về skill và nội dung gửi khối thay cho lệnh; null khi không có skill dự án trùng tên.
function projectCommand(content, folder) {
  const match = /^\/([A-Za-z0-9_-]{1,64})(?:\s+([\s\S]*))?$/.exec(content || ''); if (!match || !folder) return null;
  const skill = scan(path.join(folder, PROJECT_DIR), 'project').find(item => item.name === match[1]); if (!skill) return null;
  const note = (match[2] || '').trim();
  return { skill, prompt: `Lệnh /${skill.name} của dự án: dùng Read đọc ${skill.file} rồi làm đúng từng bước trong đó. Trong lượt này, chỗ nào hướng dẫn của skill khác yêu cầu chung của vai trò thì theo skill.` + (note ? '\nGhi chú của người dùng: ' + note : '') };
}
function guide(skills) {
  if (!skills.length) return '';
  const shown = skills.slice(0, LIST_LIMIT), more = skills.length - shown.length;
  return ['Skill dùng được (hướng dẫn đóng gói cho từng loại việc). Khi việc đang làm khớp mô tả của một skill, dùng Read đọc SKILL.md của skill đó trước rồi làm theo; tệp khác trong thư mục skill chỉ mở khi SKILL.md chỉ tới. Không có tool Skill. Skill không mở thêm quyền: vẫn chỉ ghi trong phạm vi của bạn, lệnh shell vẫn qua duyệt, bước cần tool không có trong phiên thì bỏ qua và ghi rõ trong handoff.',
    ...shown.map(skill => `- ${skill.name}: ${skill.description} (${skill.file})`), more > 0 ? `(+${more} skill khác không liệt kê)` : ''].filter(Boolean).join('\n');
}
module.exports = { NAME, PROJECT_DIR, CHAT_KEY, SOURCE_FILE, frontmatter, list, pick, extraDirs, guide, projectCommand, DESCRIPTION_LIMIT, LIST_LIMIT };
