// Khối PO (Product Owner): nhận yêu cầu project, lên kế hoạch đội theo từng mốc (vòng lớn) và phần việc giao GD mỗi mốc.
// PO xuất một khối ```team```; app kiểm tra, cho người dùng duyệt một lần cả kế hoạch (kể cả khối chỉ cần ở mốc sau, khối
// sẽ xoá ở mốc sau), rồi tự áp từng mốc: thêm khối, xoá khối, tạm nghỉ khối không dùng ở mốc đó, ghi trách nhiệm riêng.
// Thuần: không đọc tệp, không Electron.
const { defaults } = require('./roles.cjs');
const { PIPELINE, SINGLE_TYPES, typeOf, sortFlow } = require('./workers.cjs');
const { isDevType } = require('./roles.cjs');
const { PRESETS, PURPOSES } = require('./presets.cjs');
const PO = 'PO';
const MILESTONE_LIMIT = 8, DEV_LIMIT = 5, TEXT_LIMIT = 6000, RESPONSIBILITY_LIMIT = 1500;
// Loại khối PO được chọn: mọi role có sẵn trừ chính PO.
const choices = () => Object.keys(defaults).filter(type => type !== PO);
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
// Loại sản phẩm của kế hoạch: 'game' hoặc khoá preset viết thường ('pla'). Duyệt kế hoạch thì app đặt preset của session theo đó.
const PRODUCTS = PURPOSES;
const presetKey = product => Object.keys(PRESETS).find(key => key.toLowerCase() === product);
const productName = product => product === 'game' ? 'Game' : PRESETS[presetKey(product)]?.name || '';
// Nhãn khối theo thứ tự xuất hiện: Dev, Dev #2, … (giống workers.addWorker) để mọi mốc dùng chung một tên.
function labelsOf(types) {
  const seen = {}; return types.map(type => { seen[type] = (seen[type] || 0) + 1; return seen[type] === 1 ? type : `${type} #${seen[type]}`; });
}
// Đọc khối ```team```. Trả về kế hoạch hoặc null (lý do ghi vào problems để báo lại cho PO).
function parsePlan(source, problems = []) {
  const fail = reason => { problems.push(reason); return null; };
  const match = /```team\s*([\s\S]*?)```/.exec(String(source || '')); if (!match) return fail('không có khối team');
  let data; try { data = JSON.parse(match[1]); } catch { return fail('JSON trong khối team không đọc được'); }
  if (!Array.isArray(data.milestones) || !data.milestones.length || data.milestones.length > MILESTONE_LIMIT) return fail(`milestones phải là mảng 1–${MILESTONE_LIMIT} mốc`);
  const product = data.product === undefined || data.product === '' ? '' : String(data.product).trim().toLowerCase();
  if (product && !PRODUCTS.includes(product)) return fail(`product phải là ${PRODUCTS.map(item => '"' + item + '"').join(' hoặc ')}`);
  const allowed = choices(), milestones = [];
  for (const [index, item] of data.milestones.entries()) {
    const where = `mốc ${index + 1}`, blocks = Array.isArray(item?.blocks) ? item.blocks.map(String) : null;
    if (!blocks?.length) return fail(`${where}: blocks phải là danh sách loại khối`);
    const bad = blocks.find(type => !allowed.includes(type)); if (bad) return fail(`${where}: "${bad}" không phải loại khối có sẵn (${allowed.join(', ')})`);
    for (const type of new Set(blocks)) {
      const count = blocks.filter(item => item === type).length;
      if (SINGLE_TYPES.includes(type) || type === 'GD' || type === 'UI/UX') { if (count > 1) return fail(`${where}: ${type} chỉ có một khối`); }
      else if (count > DEV_LIMIT) return fail(`${where}: ${type} tối đa ${DEV_LIMIT} khối`);
    }
    if (!blocks.includes('GD')) return fail(`${where}: cần GD để chốt thiết kế của mốc`);
    const gd = text(item.gd, TEXT_LIMIT); if (!gd) return fail(`${where}: gd (phần việc giao GD) không được trống`);
    milestones.push({ title: text(item.title, 200) || `Mốc ${index + 1}`, goal: text(item.goal, 1000), gd, blocks: sortFlow(labelsOf(blocks)), reasons: text(item.reasons, 2000) });
  }
  const responsibilities = {};
  for (const [key, value] of Object.entries(data.responsibilities || {})) {
    const known = milestones.some(item => item.blocks.includes(key)) || milestones.some(item => item.blocks.some(label => typeOf(label) === key));
    if (!known) return fail(`responsibilities: "${key}" không có trong kế hoạch`);
    const body = text(value, RESPONSIBILITY_LIMIT); if (body) responsibilities[key] = body;
  }
  return { ...(product ? { product } : {}), milestones, responsibilities, summary: text(data.summary, 2000) };
}
// Thay đổi khi bắt đầu mốc k so với đội hiện có (bỏ PO): thêm khối mới cần, xoá khối không còn cần ở mốc k và các mốc sau,
// tạm nghỉ khối không dùng ở mốc k nhưng cần lại sau.
function changesAt(plan, k, flow) {
  const current = flow.filter(label => label !== PO), need = plan.milestones[k].blocks;
  const later = new Set(plan.milestones.slice(k).flatMap(item => item.blocks));
  return { add: need.filter(label => !current.includes(label)), remove: current.filter(label => !later.has(label)), idle: current.filter(label => !need.includes(label) && later.has(label)), active: need };
}
// Đội ở từng mốc khi áp lần lượt (để xem trước và tóm tắt trong thẻ duyệt).
function timeline(plan, flow) {
  let team = flow.filter(label => label !== PO); const steps = [];
  for (let k = 0; k < plan.milestones.length; k++) {
    const change = changesAt(plan, k, team); team = sortFlow([...team.filter(label => !change.remove.includes(label)), ...change.add]);
    steps.push({ ...change, flow: sortFlow([...(flow.includes(PO) ? [PO] : []), ...team]) });
  }
  return steps;
}
// Trách nhiệm riêng cho một khối: theo nhãn (Dev #2) trước, rồi theo loại (Dev).
const responsibilityFor = (plan, label) => plan.responsibilities[label] || plan.responsibilities[typeOf(label)] || '';
// Nội dung PO.md: GD và các khối đọc phần việc của mốc hiện tại ở đây thay vì đọc lại yêu cầu thô.
function planMarkdown(plan, current = 0) {
  const lines = ['# PO', '<!-- App ghi từ kế hoạch PO đã duyệt. GD làm phần "Giao GD" của mốc đang chạy. -->', ''];
  if (plan.product) lines.push('Loại sản phẩm: ' + productName(plan.product), '');
  if (plan.summary) lines.push(plan.summary, '');
  plan.milestones.forEach((item, index) => {
    lines.push(`## Mốc ${index + 1}: ${item.title}${index === current ? ' (đang chạy)' : index < current ? ' (đã xong)' : ''}`);
    if (item.goal) lines.push('Mục tiêu: ' + item.goal);
    lines.push('Khối: ' + item.blocks.join(', '), '', '### Giao GD', item.gd, '');
  });
  const entries = Object.entries(plan.responsibilities); if (entries.length) lines.push('## Trách nhiệm riêng trong session', ...entries.map(([key, value]) => `- **${key}**: ${value}`), '');
  return lines.join('\n');
}
// Câu đầu của trách nhiệm (dấu chấm cuối câu, không cắt ở "CLAUDE.md"), cắt ngắn để hướng dẫn PO gọn.
const brief = value => { const first = String(value || '').split(/\.(?:\s|$)/)[0]; return first.length > 200 ? first.slice(0, 200) + '…' : first; };
// Hướng dẫn cho PO (prompt.cjs): loại khối có sẵn kèm trách nhiệm ngắn (bản game và bản của từng preset), định dạng khối team.
// preset: preset hiện có của session (thread.preset), là loại sản phẩm khi PO không ghi product.
function guide(problems = '', preset = '') {
  const roles = choices().map(type => `${type}: ${brief(defaults[type].responsibility)}`).join('; ');
  const presets = Object.entries(PRESETS).map(([key, item]) => `Nếu project là ${item.name} thì ghi "product":"${key.toLowerCase()}"; khi đó các khối ${item.roles.join(', ')} dùng trách nhiệm riêng của ${key} thay cho bản game (${item.roles.map(type => `${type}: ${brief(item.config[type]?.responsibility)}`).join('; ')}), loại khác vẫn làm theo bản game.`);
  const current = preset && PRESETS[preset] ? `${PRESETS[preset].name} ("${preset.toLowerCase()}")` : 'Game ("game")';
  return [
    'Bạn là PO (Product Owner): đọc yêu cầu project và bối cảnh dự án (README, CLAUDE.md, .office-desk/PROJECT.md nếu có), xác định loại sản phẩm, chia project thành các mốc (vòng lớn) theo thứ tự làm, chọn đội cần cho từng mốc và viết phần việc giao GD của mỗi mốc. Không thiết kế chi tiết thay GD, không viết code.',
    'Loại khối có sẵn (trách nhiệm khi làm game): ' + roles + '.',
    ...presets,
    `Loại sản phẩm hiện tại của session: ${current}; không ghi product thì giữ nguyên.`,
    `Cuối câu trả lời xuất khối fenced code nhãn team chứa JSON {"product":"${PRODUCTS.join('" hoặc "')}","summary":"tóm tắt project và cách chia mốc","milestones":[{"title":"tên mốc","goal":"kết quả của mốc","gd":"phần giao GD: mục tiêu, phạm vi làm và không làm, ưu tiên, ràng buộc, câu hỏi mở","blocks":["GD","UI/UX","Lead Dev","Dev","Dev","QA"],"reasons":"vì sao cần từng khối, vì sao bỏ khối khác"}],"responsibilities":{"tên loại hoặc tên khối (Dev #2)":"trách nhiệm riêng trong session này"}}.`,
    `blocks liệt kê đủ khối hoạt động của mốc đó, lặp loại để có nhiều khối (hai "Dev" = Dev và Dev #2); mỗi mốc cần GD; GD, UI/UX, Lead Dev, Art Director, Release tối đa một khối; loại khác tối đa ${DEV_LIMIT}; tối đa ${MILESTONE_LIMIT} mốc. Khối chỉ cần ở mốc sau thì chỉ ghi ở mốc đó; khối không ghi ở một mốc sẽ tạm nghỉ, không còn ở các mốc sau sẽ bị xoá. Người dùng duyệt một lần cả kế hoạch nên ghi đủ các mốc ngay từ đầu.`,
    problems ? `Kế hoạch trước bị app từ chối: ${problems}. Sửa đúng lỗi này.` : ''
  ].filter(Boolean).join('\n');
}
module.exports = { PO, PRODUCTS, presetKey, productName, choices, labelsOf, parsePlan, changesAt, timeline, responsibilityFor, planMarkdown, guide, MILESTONE_LIMIT, DEV_LIMIT, PIPELINE };
