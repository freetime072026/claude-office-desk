// Kit art-frames (kits/art-frames/): script Python dựng animation từng frame từ sheet key pose (tách nền, cắt key, canh theo
// đường chân, bù frame giữa, đo). Cùng quy tắc với kit QA PLA (qa-kit.cjs): Office Desk giữ bản gốc, project nhận một bản chép
// và sửa ở đó. Trước lượt của khối Art: chép tệp còn thiếu vào <project>/.office-desk/art/, không ghi đè tệp đã có.
const fs = require('node:fs');
const path = require('node:path');
const { APP_DIR } = require('./qa-kit.cjs');

const KIT_DIR = path.join(APP_DIR, 'kits', 'art-frames');
const KIT_FILES = ['frames.py', 'comfy.py', 'scene.py', 'KIT.md'];
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const kitInfo = () => readJson(path.join(KIT_DIR, 'kit.json')) || { name: 'art-frames', version: 0 };
// <project>/.office-desk/art/ (cạnh qa/ và tmp/ của session-files.cjs).
const dirOf = files => path.join(files.project ? path.dirname(files.project) : path.dirname(path.dirname(files.issues || '.')), 'art') + path.sep;

// rife: trạng thái RIFE của Office Desk (rife.cjs). kit.json của project ghi đường dẫn exe + model để frames.py tự dùng; đổi khi
// RIFE được cài / gỡ / Office Desk đổi chỗ cài, không đụng các trường khác của project.
function ensure(artDir, { rife = null } = {}) {
  const kit = kitInfo(), copied = [];
  if (!fs.existsSync(KIT_DIR)) return { copied, version: kit.version, projectVersion: null, missing: true };
  for (const file of KIT_FILES) {
    const target = path.join(artDir, file);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, file), target);
    copied.push(file);
  }
  const infoFile = path.join(artDir, 'kit.json'), current = readJson(infoFile);
  const tool = { rife: rife?.installed ? rife.exe : '', rifeModel: rife?.installed ? rife.model : '' };
  if (!current) { fs.writeFileSync(infoFile, JSON.stringify({ name: kit.name, version: kit.version, ...tool, copiedAt: new Date().toISOString() }, null, 2) + '\n'); copied.push('kit.json'); }
  // rife null (lượt Art Director, Art chế độ tool): không biết trạng thái RIFE, giữ nguyên kit.json
  else if (rife && (current.rife !== tool.rife || current.rifeModel !== tool.rifeModel)) fs.writeFileSync(infoFile, JSON.stringify({ ...current, ...tool }, null, 2) + '\n');
  return { copied, version: kit.version, projectVersion: current ? current.version : kit.version, rife: Boolean(tool.rife), rifeInstalling: Boolean(rife?.installing) };
}

// Dòng hướng dẫn cho prompt Art: bước d) của quy trình frame dùng kit khi project chưa có script nội suy riêng.
function guide(info, artDir) {
  if (!info || info.missing) return '';
  const script = path.join(artDir, 'frames.py').split(path.sep).join('/'), kitMd = path.join(artDir, 'KIT.md');
  const newer = info.projectVersion != null && info.projectVersion < info.version
    ? ` Office Desk có kit v${info.version} mới hơn bản project (v${info.projectVersion}) ở ${KIT_DIR}: xem KIT.md ở đó, chỉ chép phần sửa lỗi cần cho lượt này.`
    : '';
  return `Kit art-frames của Office Desk đã có trong ${artDir}: khi project chưa có script nội suy riêng, quy trình frame (cắt key, tách nền cùng tham số, canh theo đường chân, bù frame giữa, đo) chạy bằng MỘT lệnh \`python "${script}" run --sheet "<ảnh sheet, kể cả ảnh trong thư mục ảnh của Codex>" [--grid CỘTxHÀNG] [--count N] [--loop] --between N --fps N --out .office-desk/tmp/<clip>\` thay vì tự viết script; đọc ${kitMd} cho tham số. Đọc report.md và Read contact.png của kết quả: kit báo "nên sinh thêm key giữa X và Y" thì đó là chỗ hai key quá xa (sinh thêm key, không tính lần trượt); nền bị ăn vào hình thì chỉnh --tolerance / --bg rồi chạy lại. ${info.rife ? 'RIFE đã cài trên máy (đường dẫn trong kit.json): kit tự dùng RIFE cho cặp key có quãng dịch vừa, optical flow cho quãng dịch nhỏ.' : info.rifeInstalling ? 'RIFE đang được Office Desk tải: lượt này kit dùng optical flow / giữ frame, lượt sau tự dùng RIFE.' : 'Máy chưa cài RIFE (người dùng cài ở Settings > Plugins): kit dùng optical flow / giữ frame; không tự tải RIFE.'} Thiếu numpy/Pillow thì cài \`python -m pip install numpy pillow\`; không có opencv-python và RIFE thì kit chỉ giữ frame, ghi đề xuất cài vào handoff. Sửa kit cho nhu cầu riêng thì sửa bản trong project.${newer}`;
}

// Dòng hướng dẫn scene.py cho Art (mọi chế độ sinh ảnh) và Art Director: kiểm kê object của ref, ảnh thay thế "thả vào là khớp",
// rào/tường thẳng theo trục iso, so cả cảnh với ref. PA0008 (Game-13): nền vẽ lại làm mất rào/thùng phuy vẽ sẵn trong BG cũ,
// rào bờ cây lệch 63 px khỏi chỗ ảnh cũ, Art Director chỉ Read từng ảnh nên không thấy.
function sceneGuide(info, artDir) {
  if (!info || info.missing) return '';
  const script = path.join(artDir, 'scene.py').split(path.sep).join('/');
  return `Công cụ đo cảnh của kit (${script}, cần numpy + Pillow): \`python "${script}" baked --img <ảnh nền/ảnh ghép cũ> --out .office-desk/tmp/baked.png\` liệt kê và đánh số B1… mọi object vẽ sẵn trong nền (nền vẽ lại thì mỗi B# phải có thứ thay hoặc được chốt bỏ); \`swap --old <ảnh cũ> --new <ảnh thay>\` kiểm ảnh thay thế cùng canvas, khung alpha, điểm cực, độ dốc (TRƯỢT = sửa ảnh, không chữa bằng toạ độ trong code); \`line --points x1,y1 x2,y2 … --slope 0.5\` kiểm các điểm đặt rào/tường/băng (world px) thẳng hàng, đúng trục iso, không gãy; \`compare --ref <ảnh chụp ref> --shot <ảnh chụp game cùng khung hình> --out .office-desk/tmp/compare.png\` ra ảnh ref | game | chồng 50% | khác, có lưới toạ độ để Read và đi từng dòng kiểm kê. Lệnh kiểm trả mã 1 khi TRƯỢT; dán số đo vào handoff/review.`;
}

module.exports = { KIT_DIR, KIT_FILES, kitInfo, dirOf, ensure, guide, sceneGuide };
