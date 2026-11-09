// Khối PO (Product Owner): nhận yêu cầu project, lên kế hoạch đội theo từng mốc (vòng lớn) và phần việc giao GD mỗi mốc.
// PO xuất một khối ```team```; app kiểm tra, cho người dùng duyệt một lần cả kế hoạch (kể cả khối chỉ cần ở mốc sau, khối
// sẽ xoá ở mốc sau), rồi tự áp từng mốc: thêm khối, xoá khối, tạm nghỉ khối không dùng ở mốc đó, ghi trách nhiệm riêng.
// Thuần: không đọc tệp, không Electron.
const { defaults } = require('./roles.cjs');
const { PIPELINE, SINGLE_TYPES, typeOf, sortFlow } = require('./workers.cjs');
const { isDevType } = require('./roles.cjs');
const { PRESETS, PURPOSES } = require('./presets.cjs');
const path = require('node:path');
const PO = 'PO';
const MILESTONE_LIMIT = 8, DEV_LIMIT = 5, TEXT_LIMIT = 6000, RESPONSIBILITY_LIMIT = 1500, LANE_LIMIT = 4;
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
// ---- Nhánh (lanes) của một mốc: 2–LANE_LIMIT mảng nội dung chạy song song, mỗi nhánh có chuỗi khối làm việc riêng (theo thứ tự
// chạy), thư mục gốc riêng (không chồng nhánh khác) và page Penpot riêng. flowgraph.cjs dựng mỗi nhánh thành một làn có
// QA, Art Director · review và Lead triage riêng.
const slash = file => file.trim().replaceAll('\\', '/');
// So như thư mục (mục nhánh thường kết thúc bằng /): chồng khi một đường dẫn là chính hoặc nằm trong đường dẫn kia.
const resolveIn = (folder, file) => (folder && !path.isAbsolute(file) ? path.resolve(folder, file) : folder ? path.resolve(file) : file).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
function parseLanes(raw, labels, where, fail, folder) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > LANE_LIMIT) return fail(`${where}: lanes phải là mảng 2–${LANE_LIMIT} nhánh (một nhánh thì bỏ lanes)`);
  const lanes = [], owner = {};
  for (const item of raw) {
    const name = text(item?.name, 200);
    if (!name || name.length > 40 || /[~@\n]/.test(name)) return fail(`${where}: tên nhánh cần 1–40 ký tự, không có ~ hoặc @`);
    if (lanes.some(lane => lane.name.toLowerCase() === name.toLowerCase())) return fail(`${where}: trùng tên nhánh "${name}"`);
    const blocks = Array.isArray(item.blocks) ? item.blocks.map(String) : [];
    if (!blocks.length) return fail(`${where}: nhánh "${name}" cần blocks (nhãn khối theo thứ tự chạy)`);
    for (const label of blocks) {
      if (!labels.includes(label)) return fail(`${where}: nhánh "${name}" có "${label}" không nằm trong blocks của mốc (nhãn khối: ${labels.join(', ')})`);
      if (!isDevType(typeOf(label))) return fail(`${where}: "${label}" không phải khối làm việc (Dev, VFX, Art, Anim, Sound) nên không vào nhánh được`);
      if (owner[label]) return fail(`${where}: "${label}" nằm ở cả nhánh "${owner[label]}" và "${name}"; mỗi khối thuộc đúng một nhánh`);
      owner[label] = name;
    }
    const files = Array.isArray(item.files) ? [...new Set(item.files.map(String).filter(file => file.trim()).map(slash))] : [];
    if (!files.length) return fail(`${where}: nhánh "${name}" cần files (thư mục gốc của nhánh)`);
    const bad = files.find(file => file.length > 500 || file.split('/').includes('..'));
    if (bad !== undefined) return fail(`${where}: nhánh "${name}" có đường dẫn không hợp lệ "${bad.slice(0, 200)}"`);
    const penpot = text(item.penpot, 200);
    lanes.push({ name, blocks, files, ...(penpot ? { penpot } : {}) });
  }
  const loose = labels.filter(label => isDevType(typeOf(label)) && !owner[label]);
  if (loose.length) return fail(`${where}: ${loose.join(', ')} chưa thuộc nhánh nào; khi chia nhánh, mỗi khối làm việc phải thuộc đúng một nhánh`);
  for (const [index, lane] of lanes.entries()) for (const other of lanes.slice(index + 1)) {
    if (lane.penpot && other.penpot && lane.penpot.toLowerCase() === other.penpot.toLowerCase()) return fail(`${where}: nhánh "${lane.name}" và "${other.name}" cùng page Penpot "${lane.penpot}"`);
    const hit = lane.files.find(file => other.files.some(item => overlaps(resolveIn(folder, file), resolveIn(folder, item))));
    if (hit) return fail(`${where}: files của nhánh "${lane.name}" (${hit}) chồng với nhánh "${other.name}"; mỗi nhánh một thư mục riêng`);
  }
  return lanes;
}
// Nhánh chứa khối (null nếu không thuộc nhánh nào).
const laneOf = (lanes, label) => (lanes || []).find(lane => lane.blocks.includes(label)) || null;
// ---- Bảng phủ yêu cầu (requirements) của mỗi mốc: PO liệt kê hạng mục cụ thể của project kèm loại việc, cỡ và khối phụ trách.
// App kiểm để kế hoạch không thiếu khối đúng loại, không khối làm việc nào quá tải và không khối nào thừa (trước đây PO đoán số khối).
const KINDS = Object.freeze({ code: 'Dev', art: 'Art', anim: 'Anim', vfx: 'VFX', sound: 'Sound', ui: 'UI/UX', design: 'GD' });
const SIZES = Object.freeze({ S: 1, M: 2, L: 4 });
// Điểm việc tối đa của một khối làm việc trong một mốc: một khối nhận một task mỗi lần Lead/Art Director giao (≤ 8 tệp), tức ~ một cỡ L.
const CAPACITY = 4, REQUIREMENT_LIMIT = 40;
const points = value => Math.round(value * 10) / 10;
function parseRequirements(raw, labels, lanes, where, fail, seen) {
  if (!Array.isArray(raw) || !raw.length || raw.length > REQUIREMENT_LIMIT) return fail(`${where}: requirements phải là mảng 1–${REQUIREMENT_LIMIT} hạng mục (mỗi hạng mục: id, text, kind, size, owners)`);
  const list = [], load = {};
  for (const item of raw) {
    const id = text(item?.id, 40), body = text(item?.text, 400), kind = String(item?.kind || '').trim().toLowerCase(), size = String(item?.size || '').trim().toUpperCase();
    const owners = Array.isArray(item?.owners) ? [...new Set(item.owners.map(String))] : [];
    if (!id || seen.has(id.toLowerCase())) return fail(`${where}: hạng mục "${id || '(trống)'}" cần id riêng, không trùng trong cả kế hoạch`);
    seen.add(id.toLowerCase());
    if (!body) return fail(`${where}: ${id} cần text (hạng mục cụ thể: màn hình, hệ thống, nhóm asset, clip anim, nhóm âm thanh…)`);
    if (!Object.hasOwn(KINDS, kind)) return fail(`${where}: ${id} kind phải là ${Object.keys(KINDS).join(', ')}`);
    if (!Object.hasOwn(SIZES, size)) return fail(`${where}: ${id} size phải là S, M hoặc L`);
    if (!owners.length) return fail(`${where}: ${id} cần owners (khối phụ trách)`);
    const missing = owners.find(label => !labels.includes(label));
    if (missing !== undefined) return fail(`${where}: ${id} giao cho "${missing}" nhưng khối này không có trong blocks của mốc (${labels.join(', ')}); thêm khối vào blocks hoặc đổi owners`);
    const need = KINDS[kind];
    if (!owners.some(label => typeOf(label) === need)) return fail(`${where}: ${id} (${kind}) cần khối ${need} trong owners${labels.some(label => typeOf(label) === need) ? '' : `; mốc chưa có ${need}, thêm "${need}" vào blocks`}`);
    const workers = owners.filter(label => isDevType(typeOf(label)));
    const laneNames = new Set(workers.map(label => laneOf(lanes, label)?.name || ''));
    if (lanes.length && laneNames.size > 1) return fail(`${where}: ${id} giao cho khối của nhiều nhánh (${[...laneNames].join(', ')}); tách thành hạng mục riêng cho mỗi nhánh`);
    for (const label of workers) load[label] = (load[label] || 0) + SIZES[size] / workers.length;
    list.push({ id, text: body, kind, size, owners });
  }
  const over = Object.entries(load).find(([, value]) => value > CAPACITY);
  if (over) {
    const [label, value] = over, items = list.filter(item => item.owners.includes(label)).map(item => `${item.id} ${item.size}`).join(', ');
    return fail(`${where}: ${label} nhận ${points(value)} điểm việc (${items}) > ${CAPACITY}: một khối làm khoảng một task mỗi mốc (≤ 8 tệp; S=1, M=2, L=4 điểm); thêm khối cùng loại (tối đa ${DEV_LIMIT}), chuyển hạng mục sang khối khác hoặc tách sang mốc sau`);
  }
  const idle = labels.filter(label => isDevType(typeOf(label)) && !load[label]);
  if (idle.length) return fail(`${where}: ${idle.join(', ')} không có hạng mục nào; bỏ khối khỏi blocks hoặc giao hạng mục cho khối đó`);
  return list;
}
const requirementLine = item => `${item.id} (${item.kind}, ${item.size}; ${item.owners.join(', ')}): ${item.text}`;
// Phần việc giao GD của mốc kèm các hạng mục (GD đưa vào GDD/AC; Lead và Art Director giao task theo đó).
const gdTask = milestone => milestone.requirements?.length ? `${milestone.gd}\n\nHạng mục của mốc (PO ước lượng; mỗi hạng mục cần AC trong GDD):\n${milestone.requirements.map(item => '- ' + requirementLine(item)).join('\n')}` : milestone.gd;
// Đọc khối ```team```. Trả về kế hoạch hoặc null (lý do ghi vào problems để báo lại cho PO).
// folder: thư mục chính của session, để so files của các nhánh theo đường dẫn thật (không có thì so như chuỗi).
function parsePlan(source, problems = [], { folder = '' } = {}) {
  const fail = reason => { problems.push(reason); return null; };
  const body = require('./fence.cjs').fenceBody(source, 'team'); if (body === null) return fail('không có khối team');
  let data; try { data = JSON.parse(body); } catch { return fail('JSON trong khối team không đọc được'); }
  if (!Array.isArray(data.milestones) || !data.milestones.length || data.milestones.length > MILESTONE_LIMIT) return fail(`milestones phải là mảng 1–${MILESTONE_LIMIT} mốc`);
  const product = data.product === undefined || data.product === '' ? '' : String(data.product).trim().toLowerCase();
  if (product && !PRODUCTS.includes(product)) return fail(`product phải là ${PRODUCTS.map(item => '"' + item + '"').join(' hoặc ')}`);
  const allowed = choices(), milestones = [], seen = new Set();
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
    const labels = sortFlow(labelsOf(blocks)), lanes = parseLanes(item.lanes, labels, where, fail, folder);
    if (!lanes) return null;
    const requirements = parseRequirements(item.requirements, labels, lanes, where, fail, seen);
    if (!requirements) return null;
    milestones.push({ title: text(item.title, 200) || `Mốc ${index + 1}`, goal: text(item.goal, 1000), gd, blocks: labels, reasons: text(item.reasons, 2000), ...(lanes.length ? { lanes } : {}), requirements });
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
    lines.push('Khối: ' + item.blocks.join(', '));
    if (item.lanes?.length) lines.push('', 'Nhánh (chạy song song; mỗi khối chỉ sửa thư mục của nhánh mình):', ...item.lanes.map(lane => `- **${lane.name}**: ${lane.blocks.join(' → ')} · thư mục: ${lane.files.join(', ')}${lane.penpot ? ` · Penpot: page "${lane.penpot}"` : ''}`));
    if (item.requirements?.length) lines.push('', 'Hạng mục (loại, cỡ; khối phụ trách):', ...item.requirements.map(requirement => '- ' + requirementLine(requirement)));
    lines.push('', '### Giao GD', item.gd, '');
  });
  const entries = Object.entries(plan.responsibilities); if (entries.length) lines.push('## Trách nhiệm riêng trong session', ...entries.map(([key, value]) => `- **${key}**: ${value}`), '');
  return lines.join('\n');
}
// ---- Xem lại kế hoạch khi một mốc xong: app đếm số liệu thật của mốc (từ poPlan.mark ghi lúc áp mốc), PO chỉnh các mốc còn lại.
const BLOCKED = /bị chặn|lỗi|dừng giữa chừng|chạm giới hạn/;
function milestoneReport(thread, now = Date.now()) {
  const plan = thread.poPlan, k = plan.current ?? 0, milestone = plan.plan.milestones[k], mark = plan.mark || {};
  const messages = (thread.messages || []).slice(mark.messages || 0), issues = (thread.issues || []).slice(mark.issues || 0);
  const minutes = mark.at ? Math.max(0, Math.round((now - Date.parse(mark.at)) / 60000)) : null, rounds = (thread.round || 1) - (mark.round || thread.round || 1) + 1;
  const rows = milestone.blocks.map(label => {
    const turns = messages.filter(message => message.role === label && !message.streaming), limit = turns.filter(message => message.maxTurns).length, errors = turns.filter(message => message.error).length;
    const stops = messages.filter(message => message.role === 'Tự động' && typeof message.text === 'string' && message.text.startsWith(label + ' ') && BLOCKED.test(message.text)).length;
    const items = (milestone.requirements || []).filter(item => item.owners.includes(label)).map(item => `${item.id} ${item.size}`);
    return `- ${label}: ${turns.length} lượt${limit ? `, ${limit} lần chạm giới hạn lượt tool` : ''}${errors ? `, ${errors} lượt lỗi` : ''}${stops ? `, ${stops} lần bị chặn/dừng` : ''}${items.length ? ` · hạng mục: ${items.join(', ')}` : ''}`;
  });
  const open = issues.filter(issue => !issue.closed), accepted = open.filter(issue => issue.accepted);
  return [
    `Số liệu mốc ${k + 1} "${milestone.title}" (app đếm từ lúc bắt đầu mốc):`,
    `- ${minutes === null ? '' : `Thời gian: ${minutes} phút; `}số vòng làm: ${rounds} (1 = không phải mở vòng mới)${thread.reviewRejects ? `; Lead review trả về sửa ${thread.reviewRejects} lần` : ''}`,
    `- Issue mới: ${issues.length}${accepted.length ? `; còn ${accepted.length} lỗi được chấp nhận chưa sửa: ${accepted.slice(0, 8).map(issue => issue.text.slice(0, 120)).join(' | ')}` : ''}`,
    'Theo khối:', ...rows
  ].join('\n');
}
function reviewPrompt(plan, k, report, problems = '') {
  const rest = plan.milestones.slice(k + 1).map((item, index) => `- Mốc ${k + 2 + index}: ${item.title} · khối: ${item.blocks.join(', ')}${item.requirements?.length ? ' · hạng mục: ' + item.requirements.map(requirement => `${requirement.id} ${requirement.kind} ${requirement.size} → ${requirement.owners.join('+')}`).join('; ') : ''}`);
  return [
    `Mốc ${k + 1}/${plan.milestones.length} vừa xong. Xem lại kế hoạch các mốc còn lại trước khi app chạy tiếp, dựa trên số liệu thật của mốc vừa xong.`,
    report, 'Kế hoạch các mốc còn lại hiện tại:', ...rest,
    'Cách xem: khối nhiều lượt, chạm giới hạn lượt tool hoặc bị chặn nhiều là quá tải: giảm cỡ hạng mục mỗi khối, thêm khối cùng loại hoặc tách mốc; khối ít lượt so với hạng mục là ước lượng dư: gộp hoặc bỏ khối; lỗi được chấp nhận chưa sửa và phần còn thiếu của mốc này thì thêm thành hạng mục ở mốc sau; chỉnh cỡ S/M/L của các mốc sau theo số lượt thật của mốc vừa xong.',
    `Cần đổi: xuất khối team chỉ gồm các mốc còn lại (phần tử đầu của milestones là mốc ${k + 2}), cùng định dạng và luật như khi lập kế hoạch (blocks, requirements, lanes; responsibilities chỉ ghi khối cần đổi; id hạng mục không trùng mốc đã xong). Giữ nguyên: không xuất khối team, chỉ trả handoff {"status":"done","summary":"giữ kế hoạch: lý do"}.`,
    problems ? `Lần xem lại trước bị từ chối: ${problems}. Sửa đúng điểm này.` : ''
  ].filter(Boolean).join('\n');
}
// Kế hoạch sau khi PO chỉnh: giữ các mốc đã xong (0..k), thay các mốc sau bằng bản mới; loại sản phẩm giữ nguyên.
function mergeRemaining(plan, k, next) {
  return { ...(plan.product ? { product: plan.product } : {}), summary: next.summary || plan.summary, milestones: [...plan.milestones.slice(0, k + 1), ...next.milestones], responsibilities: { ...plan.responsibilities, ...next.responsibilities } };
}
// Câu đầu của trách nhiệm (dấu chấm cuối câu, không cắt ở "CLAUDE.md"), cắt ngắn để hướng dẫn PO gọn (dùng cho trách nhiệm preset).
const brief = value => { const first = String(value || '').split(/\.(?:\s|$)/)[0]; return first.length > 200 ? first.slice(0, 200) + '…' : first; };
// Trách nhiệm bản game cho PO chọn đội: tới ~400 ký tự, cắt ở cuối câu (câu đầu thường quá ngắn để biết khối làm được gì).
const summaryOf = (value, limit = 400) => {
  const body = String(value || '').trim(); if (body.length <= limit) return body;
  const cut = body.slice(0, limit), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (end > 80 ? cut.slice(0, end + 1) : cut) + '…';
};
// Năng lực thật của khối (app áp), để PO tính số khối thay vì đoán.
const CAPACITY_GUIDE = `Năng lực mỗi khối (app áp, không đổi được): mỗi khối làm việc (Dev, VFX, Art, Anim, Sound) nhận tối đa một task mỗi lần Lead/Art Director giao, mỗi mốc thường một lần giao cộng vài vòng sửa; task tối đa 8 tệp/thư mục; mỗi lượt tối đa 40 lần gọi tool (GD và Lead Dev 30); Art vẽ bằng ChatGPT thì mỗi ảnh chờ người dùng tạo, nên một task chỉ nên 6–10 ảnh; một mốc chỉ có một lần Lead review được trả về sửa; tối đa ${DEV_LIMIT} khối mỗi loại và 8 phiên chạy cùng lúc. Cỡ hạng mục: S = 1 điểm (1–2 tệp, 1–3 ảnh, 1 clip ngắn), M = 2 điểm (3–4 tệp, 4–6 ảnh, 2–3 clip), L = 4 điểm (5–8 tệp hoặc một hệ thống, 6–10 ảnh); mỗi khối làm việc tối đa ${CAPACITY} điểm mỗi mốc.`;
const ESTIMATE_GUIDE = 'Cách lập kế hoạch: (1) đọc yêu cầu và kiểm kê project (thư mục code, asset, script, màn hình đã có) để biết phần nào đã có; (2) liệt kê mọi hạng mục cụ thể còn phải làm: từng màn hình, hệ thống, nhóm asset, nhóm animation, nhóm hiệu ứng, nhóm âm thanh; yêu cầu nhắc tới hình, chuyển động, hiệu ứng, âm thanh thì phải có hạng mục và khối loại đó; (3) xếp hạng mục vào mốc theo thứ tự phụ thuộc, gán loại việc và cỡ; (4) cộng điểm theo loại: số khối loại đó = tổng điểm / ' + CAPACITY + ' làm tròn lên; vượt ' + DEV_LIMIT + ' khối thì tách mốc; (5) chỉ ghi khối có hạng mục trong mốc đó. Ghi trong reasons cách bạn tính số khối.';
// Hướng dẫn cho PO (prompt.cjs): loại khối có sẵn kèm trách nhiệm ngắn (bản game và bản của từng preset), định dạng khối team.
// preset: preset hiện có của session (thread.preset), là loại sản phẩm khi PO không ghi product.
// chosen: loại sản phẩm người dùng chọn ở panel khối PO (thread.poProduct); có thì PO không tự chọn và chỉ thấy trách nhiệm của loại đó.
function guide(problems = '', preset = '', chosen = '') {
  const roles = choices().map(type => `- ${type}: ${summaryOf(defaults[type].responsibility)}`).join('\n');
  const presetLine = ([key, item], lead) => `${lead || 'Các khối'}${lead ? 'các khối' : ''} ${item.roles.join(', ')} dùng trách nhiệm riêng của ${key} thay cho bản game (${item.roles.map(type => `${type}: ${brief(item.config[type]?.responsibility)}`).join('; ')}), loại khác vẫn làm theo bản game.`;
  const fixed = PRODUCTS.includes(chosen) ? chosen : '', fixedPreset = Object.entries(PRESETS).find(([key]) => key.toLowerCase() === fixed);
  const presets = fixed ? (fixedPreset ? [presetLine(fixedPreset, '')] : []) : Object.entries(PRESETS).map(entry => presetLine(entry, `Nếu project là ${entry[1].name} thì ghi "product":"${entry[0].toLowerCase()}"; khi đó `));
  const current = preset && PRESETS[preset] ? `${PRESETS[preset].name} ("${preset.toLowerCase()}")` : 'Game ("game")';
  return [
    `Bạn là PO (Product Owner): đọc yêu cầu project và bối cảnh dự án (README, CLAUDE.md, .office-desk/PROJECT.md nếu có), ${fixed ? '' : 'xác định loại sản phẩm, '}chia project thành các mốc (vòng lớn) theo thứ tự làm, chọn đội cần cho từng mốc và viết phần việc giao GD của mỗi mốc. Không thiết kế chi tiết thay GD, không viết code.`,
    fixed ? `Người dùng đã chọn loại sản phẩm: ${productName(fixed)}. Lên kế hoạch cho loại này và ghi "product":"${fixed}".` : '',
    `Loại khối có sẵn (trách nhiệm khi làm ${fixedPreset ? 'game, cho loại khối ngoài đội ' + fixedPreset[0] : 'game'}):\n` + roles,
    CAPACITY_GUIDE,
    ESTIMATE_GUIDE,
    ...presets,
    fixed ? '' : `Loại sản phẩm hiện tại của session: ${current}; không ghi product thì giữ nguyên.`,
    `Cuối câu trả lời xuất khối fenced code nhãn team chứa JSON {"product":"${fixed || PRODUCTS.join('" hoặc "')}","summary":"tóm tắt project và cách chia mốc","milestones":[{"title":"tên mốc","goal":"kết quả của mốc","gd":"phần giao GD: mục tiêu, phạm vi làm và không làm, ưu tiên, ràng buộc, câu hỏi mở","blocks":["GD","UI/UX","Lead Dev","Dev","Dev","QA"],"requirements":[{"id":"R1","text":"hạng mục cụ thể","kind":"code","size":"M","owners":["Dev"]},{"id":"R2","text":"…","kind":"code","size":"L","owners":["Dev #2"]},{"id":"R3","text":"…","kind":"ui","size":"M","owners":["UI/UX"]}],"reasons":"cách tính số khối, vì sao bỏ khối khác"}],"responsibilities":{"tên loại hoặc tên khối (Dev #2)":"trách nhiệm riêng trong session này"}}.`,
    `requirements (bắt buộc mỗi mốc, 1–${REQUIREMENT_LIMIT} hạng mục, id không trùng trong cả kế hoạch): kind là ${Object.entries(KINDS).map(([kind, type]) => `${kind} (cần khối ${type})`).join(', ')}; size S/M/L; owners là nhãn khối trong blocks của mốc và phải có khối đúng loại của kind. App từ chối kế hoạch khi: hạng mục thiếu khối đúng loại, một khối làm việc quá ${CAPACITY} điểm trong mốc (hạng mục nhiều owners thì chia đều điểm), có khối làm việc không có hạng mục nào, hoặc (khi chia nhánh) một hạng mục giao cho khối của nhiều nhánh.`,
    `Mảng nội dung tách rời (vd. Hero, Enemy, UI, Map) làm song song được thì chia mốc thành 2–${LANE_LIMIT} nhánh bằng "lanes" trong mốc, vd. "lanes":[{"name":"Hero","blocks":["Art","Anim","Dev"],"files":["Assets/_Art/hero/","Assets/Scripts/Hero/"],"penpot":"Hero"},{"name":"Enemy","blocks":["Art #2","Anim #2","Dev #2"],"files":["Assets/_Art/enemy/","Assets/Scripts/Enemy/"],"penpot":"Enemy"}]: blocks là nhãn khối của mốc (Art, Art #2…) theo thứ tự chạy trong nhánh; mỗi khối làm việc (Dev, VFX, Art, Anim, Sound) của mốc thuộc đúng một nhánh, nên blocks của mốc cần đủ khối cho mọi nhánh; files là thư mục gốc của nhánh, không chồng nhánh khác; penpot là page Penpot riêng của nhánh (khi dùng Penpot). Nhánh nào xong được QA và Art Director kiểm ngay, lỗi chỉ quay về khối của nhánh đó. Trong một nhánh mỗi lúc chỉ một khối chạy; app chạy tối đa 8 phiên cùng lúc. Không có mảng tách rời thì bỏ lanes.`,
    `blocks liệt kê đủ khối hoạt động của mốc đó, lặp loại để có nhiều khối (hai "Dev" = Dev và Dev #2); mỗi mốc cần GD; GD, UI/UX, Lead Dev, Art Director, Release tối đa một khối; loại khác tối đa ${DEV_LIMIT}; tối đa ${MILESTONE_LIMIT} mốc. Khối chỉ cần ở mốc sau thì chỉ ghi ở mốc đó; khối không ghi ở một mốc sẽ tạm nghỉ, không còn ở các mốc sau sẽ bị xoá. Ghi đủ các mốc ngay từ đầu; khi mỗi mốc xong, app gửi bạn số liệu thật của mốc đó để chỉnh các mốc còn lại.`,
    problems ? `Kế hoạch trước bị app từ chối: ${problems}. Sửa đúng lỗi này.` : ''
  ].filter(Boolean).join('\n');
}
module.exports = { LANE_LIMIT, laneOf, KINDS, SIZES, CAPACITY, gdTask, milestoneReport, reviewPrompt, mergeRemaining, PO, PRODUCTS, presetKey, productName, choices, labelsOf, parsePlan, changesAt, timeline, responsibilityFor, planMarkdown, guide, MILESTONE_LIMIT, DEV_LIMIT, PIPELINE };
