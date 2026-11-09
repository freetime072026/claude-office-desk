// Tab "Tin của khối": chỉ tin liên quan tới khối đang chọn.
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { related, mentionsOf, isStop } = require('../block-feed.js');
const flow = ['PO', 'GD', 'Art Director', 'Lead Dev', 'Art', 'Art #2', 'Art #3', 'Fixer'];
const m = (role, text, extra = {}) => ({ role, text, ...extra });
// Mẫu theo session BaseTD 021b1d4b.
const messages = [
  m('Bạn', 'lập lại kế hoạch từ C34', { to: 'PO' }),
  m('PO', 'Tôi đã lập lại kế hoạch'),
  m('Tự động', 'Bắt đầu Art Director · lập kế hoạch'),
  m('Điều phối', 'Tự động: thực hiện bước Art Director (pha planning)'),
  m('Art Director', 'Tôi đã duyệt mốc 1 và giao việc cho 5 khối Art.'),
  m('Tự động', 'Art Director chưa xuất task Art hợp lệ (Art và Art #2 có tệp chồng nhau); dừng tự động ở bước này.'),
  m('Fixer', 'Sự cố ở khối Art Director: Art (C34) và Art #2 (C35) cùng nhánh Hero'),
  m('Fixer · kết luận', 'Art Director: gộp task → chạy tiếp Art Director'),
  m('Phân công đã duyệt', 'Art, Art #3. Nội dung task nằm trong khối tasks'),
  m('Tự động', 'Art #2 không có task ở vòng này · bỏ qua.'),
  m('Điều phối', 'Thực hiện task Art Director giao ở mục "Task của khối".', { to: 'Art' }),
  m('Art', 'Đã viết lệnh vẽ C34; chờ ảnh.'),
  m('Art · bàn giao tự động', 'Chờ ảnh C34'),
  m('Tự động', 'Art bị chặn: Chờ ảnh C34 trong art/inbox/C34/.'),
  m('Lead Dev', 'Art cần ảnh C34 trước khi Dev ghép.'),
  m('Bạn', 'vẽ lại nền', { to: 'Art #3' })
];
const texts = label => related(messages, label, flow).map(item => item.text);

test('a block feed keeps its own turns, its handoffs, words sent to it and app logs naming it', () => {
  assert.deepEqual(texts('Art'), [
    'Art Director chưa xuất task Art hợp lệ (Art và Art #2 có tệp chồng nhau); dừng tự động ở bước này.',
    'Sự cố ở khối Art Director: Art (C34) và Art #2 (C35) cùng nhánh Hero',
    'Art, Art #3. Nội dung task nằm trong khối tasks',
    'Thực hiện task Art Director giao ở mục "Task của khối".', 'Đã viết lệnh vẽ C34; chờ ảnh.', 'Chờ ảnh C34', 'Art bị chặn: Chờ ảnh C34 trong art/inbox/C34/.'
  ]);
});

test('"Art" does not match "Art Director" or "Art #2"; other blocks replies naming it are left out', () => {
  const ad = texts('Art Director');
  assert.ok(ad.includes('Tôi đã duyệt mốc 1 và giao việc cho 5 khối Art.') && ad.includes('Tự động: thực hiện bước Art Director (pha planning)'));
  assert.ok(ad.includes('Art Director: gộp task → chạy tiếp Art Director'), 'Fixer verdict about it');
  assert.equal(ad.includes('Đã viết lệnh vẽ C34; chờ ảnh.'), false);
  assert.deepEqual(texts('Art #2'), ['Art Director chưa xuất task Art hợp lệ (Art và Art #2 có tệp chồng nhau); dừng tự động ở bước này.', 'Sự cố ở khối Art Director: Art (C34) và Art #2 (C35) cùng nhánh Hero', 'Art #2 không có task ở vòng này · bỏ qua.']);
  assert.equal(texts('Art').includes('Art cần ảnh C34 trước khi Dev ghép.'), false, 'Lead reply mentioning Art stays in the Lead feed');
  assert.deepEqual(texts('Art #3'), ['Art, Art #3. Nội dung task nằm trong khối tasks', 'vẽ lại nền']);
  assert.deepEqual([...mentionsOf(flow)('Art #2 và Art Director')].sort(), ['Art #2', 'Art Director']);
});

test('old messages without a target: the prompt right before the block turn belongs to it', () => {
  const old = [m('Điều phối', 'Thực hiện task'), m('Art', 'xong'), m('Bạn', 'câu hỏi chung'), m('PO', 'trả lời')];
  assert.deepEqual(related(old, 'Art', ['Art', 'PO']).map(item => item.text), ['Thực hiện task', 'xong']);
  assert.deepEqual(related(old, '', ['Art']), []);
});

test('stop messages are marked so the feed highlights them', () => {
  assert.equal(isStop(m('Tự động', 'Art bị chặn: Chờ ảnh')), true);
  assert.equal(isStop(m('Tự động', 'Art Director chưa xuất task Art hợp lệ')), true);
  assert.equal(isStop(m('Art', 'bị chặn vì thiếu ảnh')), false, 'only app logs, not the block reply text');
  assert.equal(isStop(m('Tự động', 'Bắt đầu Art')), false);
});
