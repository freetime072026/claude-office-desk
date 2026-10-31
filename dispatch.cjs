function canStart(task, tasks) { return (task.dependsOn || []).every(owner => tasks.find(item => item.worker === owner)?.status === 'finished'); }
// Lỗi tạm thời (khối bận, đủ 8 chat, trùng thư mục đang sửa): task về hàng chờ thay vì bị chặn. main.cjs gắn code này.
const RETRY = 'RETRY';
function retryable(message) { return Object.assign(Error(message), { code: RETRY }); }
// Một lượt quét: chạy mọi task queued đủ điều kiện. Trả về true nếu có task đổi trạng thái.
async function sweep(thread, send, changed) {
  let moved = false;
  for (const task of thread.dispatch || []) {
    if (task.status !== 'queued') continue;
    if ((task.dependsOn || []).some(owner => ['blocked', 'failed', 'cancelled'].includes(thread.dispatch.find(item => item.worker === owner)?.status))) { task.status = 'blocked'; task.error = 'Task phụ thuộc chưa hoàn thành'; moved = true; continue; }
    if (!canStart(task, thread.dispatch)) continue;
    task.status = 'starting';
    try { const result = await send(task); task.status = result?.loginStarted ? 'blocked' : result === false ? 'cancelled' : 'running'; if (result?.loginStarted) task.error = 'Cần đăng nhập hồ sơ rồi thử lại'; }
    catch (error) { if (error.code === RETRY) task.status = 'queued'; else { task.status = 'blocked'; task.error = error.message; } }
    if (task.status !== 'queued') moved = true;
    changed();
  }
  return moved;
}
// Lời gọi pump trong lúc đang quét (ví dụ Dev khác vừa xong khi đang chờ hộp xác nhận) không bị bỏ: đánh dấu và quét lại.
// Quét lại cả khi lượt trước có task đổi trạng thái (task bị chặn có thể làm chặn task phụ thuộc đứng trước nó). Mỗi task chỉ rời queued một lần nên vòng lặp hữu hạn.
async function pump(thread, send, changed) {
  if (thread.dispatchPumping) { thread.dispatchAgain = true; return; }
  thread.dispatchPumping = true;
  try {
    let moved;
    do { thread.dispatchAgain = false; moved = await sweep(thread, send, changed); } while (thread.dispatchAgain || moved);
  } finally { delete thread.dispatchPumping; delete thread.dispatchAgain; changed(); }
}
// Chạy lại một task đang dở: tiếp tục phiên CLI cũ (không bao giờ mở phiên mới; CLI tự compact khi ngữ cảnh lớn).
const contextAverage = usage => usage?.turns ? Math.round((usage.input + usage.cacheRead + usage.cacheWrite) / usage.turns) : 0;
const taskSession = (id, key, usage) => ({ id, key, contextAverage: contextAverage(usage) });
const continuationOf = task => task.session || null;
module.exports = { pump, canStart, retryable, RETRY, taskSession, continuationOf };
