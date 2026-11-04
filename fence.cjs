// Đọc khối fenced code có nhãn (```tasks, ```handoff, ```fix, ```team) trong câu trả lời của role.
// Fence đóng phải nằm đầu dòng: chuỗi JSON bên trong hay nhắc tới ```tasks``` / ```handoff``` (ví dụ hướng dẫn "xuất lại khối
// ```tasks```"), nếu dừng ở ``` đầu tiên thì JSON bị cắt giữa chừng và bị coi là hỏng. Không thấy dạng đó thì quay về cách cũ
// (khối viết trên một dòng: ```tasks {...}```).
const escape = label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function fenceBodies(text, label) {
  const source = String(text || ''), name = escape(label);
  const strict = [...source.matchAll(new RegExp('```' + name + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```', 'g'))].map(match => match[1]);
  if (strict.length) return strict;
  return [...source.matchAll(new RegExp('```' + name + '\\s*([\\s\\S]*?)```', 'g'))].map(match => match[1]);
}
const fenceBody = (text, label) => fenceBodies(text, label)[0] ?? null;
module.exports = { fenceBodies, fenceBody };
