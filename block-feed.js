// Tin liên quan tới một khối, cho tab "Tin của khối" ở khung bên phải chat (team-ui.js): chat chung dài và trôi nhanh khi nhiều
// khối chạy song song, nên tin bị chặn của một khối (vd Art) dễ bị đẩy mất. Thuần, dùng chung cho trang (window.blockFeed) và test.
(function (root) {
  // Tin app ghi (log điều phối, hệ thống, Fixer): thuộc khối khi nhắc đúng tên khối.
  const APP_ROLES = ['Tự động', 'Điều phối', 'Hệ thống', 'Cấu hình', 'Phân công đã duyệt', 'Issue', 'Chỉnh sửa'];
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Nhắc tên khối: so khớp tên dài trước để "Art" không khớp vào "Art Director" hay "Art #2".
  function mentionsOf(labels) {
    const sorted = [...new Set(labels)].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!sorted.length) return () => new Set();
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}#])(${sorted.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    return text => new Set([...String(text || '').matchAll(pattern)].map(match => match[1]));
  }
  const authoredBy = (message, label) => message.role === label || String(message.role || '').startsWith(label + ' · ');
  // messages: tin của session; label: khối đang chọn; labels: mọi khối của session (thread.flow).
  function related(messages, label, labels = []) {
    if (!label) return [];
    const mentions = mentionsOf([label, ...labels]);
    return (messages || []).filter((message, index) => {
      if (message.to) return message.to === label; // lời gửi cho một khối (app ghi từ 0.26)
      if (authoredBy(message, label)) return true;
      // Tin cũ chưa có "to": lời bạn hoặc điều phối gửi ngay trước lượt của khối.
      if (['Bạn', 'Điều phối'].includes(message.role) && messages[index + 1] && authoredBy(messages[index + 1], label) && messages[index + 1].role === label) return true;
      if (APP_ROLES.includes(message.role) || message.role === 'Bạn' || String(message.role || '').startsWith('Fixer')) return mentions(message.text).has(label);
      return false;
    });
  }
  // Tin cho thấy khối đang bị chặn hoặc dừng (để đánh dấu nổi bật trong tab).
  const STOP = /bị chặn|dừng|lỗi|chạm giới hạn|chưa xuất/i;
  const isStop = message => APP_ROLES.includes(message.role) && STOP.test(String(message.text || ''));
  const api = { related, mentionsOf, isStop };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.blockFeed = api;
})(typeof window === 'undefined' ? globalThis : window);
