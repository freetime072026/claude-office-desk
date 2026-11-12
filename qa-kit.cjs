// Kit QA PLA (kits/pla-qa/): harness Playwright + kịch bản mẫu, dùng chung cho mọi project PLA.
// Quy tắc: thứ Office Desk cần và dùng lại được thì nằm ở Office Desk; project cần thì chép sang và sửa trong project.
// Bản trong Office Desk chỉ sửa khi có bug hoặc nâng cấp, không sửa theo đặc trưng của một project.
// Trước lượt QA của session PLA: chép các tệp kit còn thiếu vào <project>/.office-desk/qa/, không ghi đè tệp đã có.
const fs = require('node:fs');
const path = require('node:path');

// Bản đóng gói: kits/ và playwright-core nằm ở app.asar.unpacked để node của project đọc được.
const unpacked = dir => dir.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
const APP_DIR = unpacked(__dirname);
const KIT_DIR = path.join(APP_DIR, 'kits', 'pla-qa');
// Tệp chép nguyên (đường dẫn trong kit = đường dẫn trong thư mục qa). lib/kit.json do ensure() ghi riêng.
const KIT_FILES = ['lib/harness.js', 'smoke.js', 'KIT.md'];
const PLA = 'PLA';

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const kitInfo = () => readJson(path.join(KIT_DIR, 'lib', 'kit.json')) || { name: 'pla-qa', version: 0 };
const isPla = thread => [thread?.preset, thread?.poProduct].includes(PLA);

// Chép phần còn thiếu của kit vào qaDir. Trả { copied, version, projectVersion } (projectVersion: version của bản project đang có).
function ensure(qaDir, officeDesk = APP_DIR) {
  const kit = kitInfo(), copied = [];
  if (!fs.existsSync(KIT_DIR)) return { copied, version: kit.version, projectVersion: null, missing: true };
  for (const file of KIT_FILES) {
    const target = path.join(qaDir, file);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, file), target);
    copied.push(file);
  }
  // kit.json của project: version đã chép + nơi tìm playwright-core. Chỉ cập nhật officeDesk khi Office Desk đổi chỗ cài.
  const infoFile = path.join(qaDir, 'lib', 'kit.json'), current = readJson(infoFile);
  if (!current) { fs.mkdirSync(path.dirname(infoFile), { recursive: true }); fs.writeFileSync(infoFile, JSON.stringify({ name: kit.name, version: kit.version, officeDesk, copiedAt: new Date().toISOString() }, null, 2) + '\n'); copied.push('lib/kit.json'); }
  else if (current.officeDesk !== officeDesk) fs.writeFileSync(infoFile, JSON.stringify({ ...current, officeDesk }, null, 2) + '\n');
  return { copied, version: kit.version, projectVersion: current ? current.version : kit.version };
}

// Dòng hướng dẫn cho prompt QA: dùng kit trong project, không tự dựng harness; báo khi Office Desk có kit mới hơn.
function guide(info, qaDir) {
  if (!info || info.missing) return '';
  const rel = file => path.join(qaDir, file);
  const newer = info.projectVersion != null && info.projectVersion < info.version
    ? ` Office Desk có kit v${info.version} mới hơn bản project (v${info.projectVersion}) ở ${KIT_DIR}: xem KIT.md ở đó, chỉ chép phần sửa lỗi cần cho lượt này vào bản project.`
    : '';
  return `Kit QA PLA của Office Desk đã có trong ${qaDir}: harness Playwright ${rel('lib/harness.js')} (tự bật/tắt dev server và trình duyệt, chặn request ngoài, ghi collector tracking, chạm CTA, chụp ảnh, báo cáo out/<tên>.md) và kịch bản mẫu ${rel('smoke.js')}. Đọc ${rel('KIT.md')} rồi viết kịch bản bằng run() của harness; không tự dựng harness CDP/Playwright khác. Project có \`npm run verify\` (template-pla) thì chạy \`npm run verify -- dev\` trước, kit dùng cho phần verify không kiểm (luồng chơi theo AC, tracking theo GDD, thời gian vào game, bản build trong dist/ qua --file). Sửa kit cho nhu cầu riêng thì sửa bản trong project, không sửa bản của Office Desk.${newer}`;
}

module.exports = { KIT_DIR, KIT_FILES, APP_DIR, isPla, ensure, guide, kitInfo };
