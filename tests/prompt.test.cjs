const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PROMPT_LIMITS, roleContext, buildPrompt, rolePrompt } = require('../prompt.cjs');
const { defaults } = require('../roles.cjs');
const TASK_BLOCK = /fenced code có nhãn tasks/;
const CHECKLIST = /Không duplicate code logic/;
const thread = (extra = {}) => ({ flow: ['GD', 'Lead Dev', 'Dev', 'QA'], workers: { Dev: { type: 'Dev', task: 'Sửa UI' } }, messages: [{ role: 'Bạn', text: 'Yêu cầu gốc' }], attachments: [], ...extra });
const message = (role, text) => ({ role, text, time: '2026-10-31T00:00:00Z' });

test('TC-PROMPT-01 / AC-PROMPT-01.1: non-Lead roles never get the Lead tasks guide or review checklist', () => {
  for (const label of ['GD', 'Dev', 'QA']) {
    const { text } = rolePrompt({}, thread(), label, { content: 'Làm việc', resumed: false });
    assert.doesNotMatch(text, TASK_BLOCK); assert.doesNotMatch(text, CHECKLIST); assert.doesNotMatch(text, /vòng \d\/3/);
    assert.match(text, new RegExp('^Vai trò ' + label + '\\.'));
  }
});
test('TC-PROMPT-02 / AC-PROMPT-01.1 / AC-LOOP-01.7 / AC-REVIEW-01.1: Lead prompt depends on phase and shows round n/3', () => {
  const planning = rolePrompt({}, thread({ leadPhase: 'planning', qaFailRounds: 0 }), 'Lead Dev', { content: 'Lập kế hoạch' }).text;
  assert.match(planning, /Vai trò Lead Dev — pha planning, vòng 0\/3\./); assert.match(planning, TASK_BLOCK); assert.doesNotMatch(planning, CHECKLIST);
  const triage = rolePrompt({}, thread({ leadPhase: 'triage', qaFailRounds: 2 }), 'Lead Dev', { content: 'Triage' }).text;
  assert.match(triage, /pha triage, vòng 2\/3/); assert.match(triage, TASK_BLOCK);
  const review = rolePrompt({}, thread({ leadPhase: 'review', qaFailRounds: 0 }), 'Lead Dev', { content: 'Review' }).text;
  assert.match(review, /pha review/); assert.doesNotMatch(review, TASK_BLOCK);
  for (const item of [/1\. Code clean: tên rõ nghĩa, hàm ngắn một nhiệm vụ, không code chết, không magic value\./, CHECKLIST, /3\. Phạm vi diff khớp task và AC/, /file:line/]) assert.match(review, item);
});
test('AC-PROMPT-01.2: empty fields are dropped, no blank lines', () => {
  const { text } = rolePrompt({}, thread(), 'QA', { content: 'Kiểm thử' });
  assert.doesNotMatch(text, /Yêu cầu riêng của session|Task của khối|Riêng session/); assert(text.split('\n').every(line => line.trim()));
  assert.match(rolePrompt({}, thread(), 'Dev', { content: 'x' }).text, /Task của khối: Sửa UI/);
});
test('AC-PROMPT-01.3 / PLAN L-7: roleContext reads thread.roleConfig → team.roleTemplates → defaults', () => {
  const team = { roleTemplates: { QA: { responsibility: 'Template QA', output: 'Template output' } } };
  assert.deepEqual(roleContext(team, thread({ roleConfig: { QA: { responsibility: 'Session QA', output: '', instructions: 'Chỉ test UI' } } }), 'QA'), { key: 'QA', responsibility: 'Session QA', output: 'Template output', instructions: 'Chỉ test UI' });
  assert.equal(roleContext({}, thread(), 'QA #2').responsibility, defaults.QA.responsibility);
  assert.equal(roleContext({}, thread({ workers: { 'Lead Dev': { type: 'Lead Dev' } } }), 'Lead Dev').output, defaults['Lead Dev'].output);
});
test('TC-PROMPT-03 / AC-PROMPT-02.3/02.4: without resume send original request, latest handoff per role and N recent messages', () => {
  const messages = [message('Bạn', 'Yêu cầu gốc'), message('Dev · bàn giao thủ công', 'H'.repeat(3000))];
  for (let index = 0; index < 248; index++) messages.push(message('Ghi chú', 'tin ' + index));
  const { text, omitted } = rolePrompt({}, thread({ messages }), 'QA', { content: 'NOW', resumed: false });
  assert.equal(omitted, 228); assert.match(text, /\[Đã lược 228 tin cũ\]/);
  assert.match(text, /Yêu cầu gốc: Yêu cầu gốc/); assert.match(text, new RegExp('Dev · bàn giao thủ công: H{' + (PROMPT_LIMITS.handoff - 'Dev · bàn giao thủ công: '.length) + '}…'));
  assert.match(text, /tin 247\n/); assert.match(text, /tin 228\n/); assert.doesNotMatch(text, /tin 227\n/);
  assert(text.endsWith('NOW'));
  const limits = { ...PROMPT_LIMITS, total: 500, handoff: 50 };
  const small = rolePrompt({}, thread({ messages }), 'QA', { content: 'NOW', limits });
  const block = small.text.slice(small.text.indexOf('Bối cảnh session'), small.text.lastIndexOf('\nNOW'));
  assert(block.length <= limits.total, 'context block ' + block.length + ' exceeds ' + limits.total); assert(small.omitted > 228);
});
test('TC-PROMPT-04 / AC-PROMPT-02.1/02.2: resumed prompt has no history, only the delta since the role last spoke', () => {
  const messages = [message('Bạn', 'Yêu cầu gốc'), message('Hệ thống', 'cũ'), message('Lead Dev', 'Kế hoạch'), message('QA', 'Báo cáo QA mới'), message('Issue', 'Bug mới')];
  const { text } = rolePrompt({}, thread({ messages, leadPhase: 'triage', qaFailRounds: 1 }), 'Lead Dev', { content: 'Triage tiếp', resumed: true });
  assert.doesNotMatch(text, /Bối cảnh session|Yêu cầu gốc|Trách nhiệm|Đầu ra|Đội hiện có|: cũ/);
  assert.match(text, /^Vai trò Lead Dev — pha triage, vòng 1\/3\./); assert.match(text, /QA: Báo cáo QA mới\nIssue: Bug mới\nTriage tiếp/);
  const off = rolePrompt({}, thread({ messages }), 'Lead Dev', { content: 'x', resumed: true, limits: { ...PROMPT_LIMITS, resumeDelta: 0 } });
  assert.doesNotMatch(off.text, /Báo cáo QA mới/);
});
test('plain chat and terminal runs: no role header; history can be disabled; attachments listed once', () => {
  const attachments = [{ path: 'C:\\img\\a.png', name: 'a.png' }];
  assert.equal(buildPrompt({ content: 'Chạy', history: false, attachments }).text, 'Chạy\nẢnh tham chiếu đính kèm tin này, dùng Read để xem:\nC:\\img\\a.png (a.png)');
  assert.equal(buildPrompt({ label: null, content: 'Chạy', history: false }).text, 'Chạy');
});
