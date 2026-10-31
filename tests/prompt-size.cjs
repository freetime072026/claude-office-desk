// Đo kích thước prompt (ký tự) mà rolePrompt dựng cho từng role. Chạy tay: node tests/prompt-size.cjs
// Không nằm trong npm test (tên không có .test.). Thread mẫu cố định, không ngẫu nhiên, để so trước/sau giữa các đợt.
const { rolePrompt } = require('../prompt.cjs');

const filler = (label, length) => { const unit = `${label}: nội dung mẫu cố định để đo kích thước prompt. `; return unit.repeat(Math.ceil(length / unit.length)).slice(0, length); };
const handoff = (status, summary) => '\n```handoff\n' + JSON.stringify({ status, summary }) + '\n```';
const AUTO_STEP = role => `Tự động: thực hiện bước ${role} dựa trên bàn giao trước. Hoàn thành vai trò rồi xuất khối handoff ở cuối.`;
const DEV_TASK = label => filler(label + ' task (phạm vi file + AC)', 11000);
const DEVS = ['Dev', 'Dev #2', 'Dev #3'];
const LEAD_DEV_CONTENT = label => 'Thực hiện task Lead giao:\n' + DEV_TASK(label);

function sampleThread() {
  let minute = 0;
  const message = (role, text, extra = {}) => ({ role, text, time: new Date(Date.UTC(2026, 9, 31, 8, minute++)).toISOString(), ...extra });
  const messages = [
    message('Hệ thống', 'Đã thêm GD'), message('Hệ thống', 'Đã thêm Lead Dev'), message('Hệ thống', 'Đã thêm Dev'), message('Hệ thống', 'Đã thêm Dev #2'), message('Hệ thống', 'Đã thêm Dev #3'), message('Hệ thống', 'Đã thêm QA'),
    message('Bạn', 'Đánh giá hệ thống và lập plan giảm tiêu thụ token. ' + filler('Yêu cầu', 600)),
    message('Tự động', 'Bật chạy tự động: GD → Lead Dev → Dev → QA.'),
    message('Điều phối', AUTO_STEP('GD')),
    message('GD', filler('Thiết kế GD', 6000) + handoff('done', filler('Tóm tắt thiết kế', 900))),
    message('Tự động', 'Bắt đầu Lead Dev · pha planning'),
    message('Điều phối', AUTO_STEP('Lead Dev')),
    message('Lead Dev', filler('Kế hoạch Lead', 14000) + '\n```tasks\n' + JSON.stringify({ tasks: DEVS.map(worker => ({ worker, task: DEV_TASK(worker), dependsOn: [] })) }) + '\n```'),
    message('Phân công đã duyệt', DEVS.map(label => label + ': ' + DEV_TASK(label)).join('\n')),
    message('Tự động', 'Lead đã phân công; chạy Dev theo phụ thuộc.'),
    ...DEVS.flatMap(label => [message('Điều phối', LEAD_DEV_CONTENT(label)), message(label, filler('Kết quả ' + label, 3500) + handoff('done', filler('Diff ' + label, 600)))]),
    message('Dev #3', '\n#< CLIXML', { error: true }),
    message('Tự động', 'Dev #3 lỗi thực thi; chờ thử lại.'),
    message('Điều phối', LEAD_DEV_CONTENT('Dev #3')),
    message('Dev #3', filler('Kết quả Dev #3 lần 2', 2500) + handoff('done', filler('Diff Dev #3 lần 2', 500))),
    message('Tự động', 'Tất cả Dev đã xong; chuyển QA.'),
    message('Điều phối', AUTO_STEP('QA')),
    message('QA', filler('Báo cáo QA', 4000) + handoff('issue', filler('Lỗi QA', 700))),
    message('Hệ thống', 'Đã mở Issue I-1'),
    message('Bạn', 'Tiếp tục sửa theo Issue.')
  ];
  if (messages.length !== 30) throw Error('Thread mẫu phải có đúng 30 tin, hiện có ' + messages.length);
  const flow = ['GD', 'Lead Dev', ...DEVS, 'QA'];
  const workers = Object.fromEntries(flow.map(label => [label, { type: label.replace(/ #\d+$/, ''), mode: 'read', model: 'claude-opus-5-5', profileId: '', task: DEVS.includes(label) ? DEV_TASK(label) : '' }]));
  return { id: 'prompt-size', title: 'Prompt size', flow, stage: 4, status: 'working', leadPhase: 'planning', qaFailRounds: 1, workers, messages, issues: [{ id: 'I-1', text: filler('Issue', 900), closed: false }], attachments: [] };
}

const contentFor = label => DEVS.includes(label) ? LEAD_DEV_CONTENT(label) : AUTO_STEP(label);
const thread = sampleThread(), team = { roleTemplates: {} };
const rows = thread.flow.map(label => ({ label, fresh: rolePrompt(team, thread, label, { content: contentFor(label), resumed: false }).text.length, resumed: rolePrompt(team, thread, label, { content: contentFor(label), resumed: true }).text.length }));
const total = key => rows.reduce((sum, row) => sum + row[key], 0);
console.log('| Role | resumed=false | resumed=true |');
console.log('|---|---:|---:|');
for (const row of rows) console.log(`| ${row.label} | ${row.fresh} | ${row.resumed} |`);
console.log(`| **Tổng** | **${total('fresh')}** | **${total('resumed')}** |`);
