function canStart(task, tasks) { return (task.dependsOn || []).every(owner => tasks.find(item => item.worker === owner)?.status === 'finished'); }
async function pump(thread, send, changed) {
  if (thread.dispatchPumping) return;
  thread.dispatchPumping = true;
  try {
    for (const task of thread.dispatch || []) {
      if (task.status !== 'queued') continue;
      if ((task.dependsOn || []).some(owner => ['blocked', 'failed', 'cancelled'].includes(thread.dispatch.find(item => item.worker === owner)?.status))) { task.status = 'blocked'; task.error = 'Task phụ thuộc chưa hoàn thành'; continue; }
      if (!canStart(task, thread.dispatch)) continue;
      task.status = 'starting';
      try { const result = await send(task); task.status = result?.loginStarted ? 'blocked' : result === false ? 'cancelled' : 'running'; if (result?.loginStarted) task.error = 'Cần đăng nhập hồ sơ rồi thử lại'; }
      catch (error) { if (/đang sửa|lượt sửa|ghi đè|Tối đa 8|Khối.*đang trả lời/i.test(error.message)) task.status = 'queued'; else { task.status = 'blocked'; task.error = error.message; } }
      changed();
    }
  } finally { delete thread.dispatchPumping; changed(); }
}
module.exports = { pump, canStart };
