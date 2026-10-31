// Sơ đồ luồng chạy của một session: nút = khối (Lead Dev tách 3 nút theo pha), cạnh = "khi nút nguồn kết thúc với kết quả X
// thì kích hoạt nút đích". Thuần dữ liệu, không Electron; bộ chạy tự động (pipeline.cjs) gọi các hàm ở đây.
//
// Luật chạy:
// - Kết quả của nút: done, pass, issue, reject, skipped (Dev không có task), blocked (dừng chờ người dùng).
// - Cạnh khớp khi: 'done' → done/pass/skipped; 'always' → mọi kết quả trừ blocked; 'pass'/'issue'/'reject' → đúng kết quả đó.
// - Nút được kích hoạt sẽ chờ (queued) và chỉ chạy khi không còn nút nối vào nó đang chờ/đang chạy: QA chờ đủ mọi Dev,
//   còn Dev có nhiều nguồn thay thế nhau (planning/triage/review) thì chỉ cần nguồn vừa kích hoạt.
const { LEAD, labelType } = require('./workers.cjs');
const { isDevType } = require('./roles.cjs');
const END = '@end';
const LEAD_PHASES = Object.freeze(['planning', 'triage', 'review']);
const CONDITIONS = Object.freeze(['done', 'pass', 'issue', 'reject', 'always']);
const CONDITION_NAMES = Object.freeze({ done: 'xong', pass: 'pass', issue: 'issue', reject: 'reject', always: 'luôn' });
const PHASE_NAMES = Object.freeze({ planning: 'lập kế hoạch', triage: 'triage', review: 'review' });
const OUTCOMES = Object.freeze(['done', 'pass', 'issue', 'reject', 'skipped', 'blocked']);
const leadId = phase => `${LEAD}@${phase}`;
const nodeLabel = node => node.id === END ? 'Hoàn tất' : node.phase ? `${node.label} · ${PHASE_NAMES[node.phase]}` : node.label;
function matches(when, outcome) {
  if (outcome === 'blocked' || !OUTCOMES.includes(outcome)) return false;
  if (when === 'always') return true;
  if (when === 'done') return ['done', 'pass', 'skipped'].includes(outcome);
  return when === outcome;
}
// ---- Sơ đồ mặc định từ danh sách khối (cũng dùng cho session cũ): trước Lead nối tiếp, Dev/VFX song song, QA chờ đủ Dev.
function defaultGraph(thread) {
  const type = label => labelType(thread, label), flow = thread.flow || [];
  const pre = flow.filter(label => ['GD', 'UI/UX'].includes(type(label)));
  const lead = flow.find(label => type(label) === LEAD), devs = flow.filter(label => isDevType(type(label)));
  const qas = flow.filter(label => type(label) === 'QA');
  const custom = flow.filter(label => !pre.includes(label) && label !== lead && !devs.includes(label) && !qas.includes(label));
  const nodes = [], edges = [], at = (column, row, rows) => ({ x: 40 + column * 200, y: 180 + (row - (rows - 1) / 2) * 100 });
  let column = 0;
  const add = (id, label, phase, position) => { nodes.push({ id, label, ...(phase ? { phase } : {}), ...position }); return id; };
  const link = (from, to, when = 'done') => { if (from && to && !edges.some(edge => edge.from === from && edge.to === to && edge.when === when)) edges.push({ id: `${from}>${to}:${when}`, from, to, when }); };
  const linkAll = (froms, tos, when) => { for (const from of froms) for (const to of tos) link(from, to, when); };
  let tail = [];
  for (const label of pre) { add(label, label, '', at(column++, 0, 1)); linkAll(tail, [label]); tail = [label]; }
  const planning = lead ? add(leadId('planning'), lead, 'planning', at(column++, 0, 1)) : '';
  if (planning) { linkAll(tail, [planning]); tail = [planning]; }
  const devColumn = column; devs.forEach((label, row) => add(label, label, '', at(column, row, devs.length))); if (devs.length) column++;
  if (devs.length) { linkAll(tail, devs); tail = devs; }
  qas.forEach((label, row) => add(label, label, '', at(column, row, qas.length))); if (qas.length) column++;
  if (qas.length) { linkAll(tail, qas); tail = qas; }
  // Vòng sửa lỗi: QA issue → Lead triage → Dev (không có Lead thì QA issue → Dev).
  if (qas.length && devs.length) {
    // Triage đặt phía trên nút lập kế hoạch (cùng cột) để cạnh triage → Dev đi xuôi, không đè lên các Dev.
    if (lead) { const top = Math.min(...nodes.filter(node => devs.includes(node.id)).map(node => node.y)); const triage = add(leadId('triage'), lead, 'triage', { x: 40 + (devColumn - 1) * 200, y: top - 120 }); linkAll(qas, [triage], 'issue'); linkAll([triage], devs); }
    else linkAll(qas, devs, 'issue');
  }
  const forward = qas.length ? 'pass' : 'done';
  for (const label of custom) { add(label, label, '', at(column++, 0, 1)); linkAll(tail, [label], tail === qas ? forward : 'done'); tail = [label]; }
  const finalWhen = tail === qas ? forward : 'done';
  if (lead) { const review = add(leadId('review'), lead, 'review', at(column++, 0, 1)); linkAll(tail, [review], finalWhen); linkAll([review], devs, 'reject'); tail = [review]; }
  add(END, '', '', at(column, 0, 1)); linkAll(tail, [END], lead ? 'pass' : finalWhen);
  // Dời cả sơ đồ để nút cao nhất cách mép trên 40px (nhiều Dev xếp chồng có thể đẩy lên trên).
  const shift = 40 - Math.min(...nodes.map(node => node.y)); for (const node of nodes) node.y += shift;
  return { nodes, edges };
}
// ---- Kiểm tra sơ đồ người dùng sửa: nút phải là khối có trong session (hoặc Hoàn tất), cạnh nối nút có thật, điều kiện hợp lệ.
function validate(thread, graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw Error('Sơ đồ không hợp lệ');
  if (graph.nodes.length > 60 || graph.edges.length > 300) throw Error('Sơ đồ quá lớn');
  const ids = new Set(), nodes = graph.nodes.map(node => {
    const id = String(node.id || ''), label = String(node.label || ''), phase = node.phase ? String(node.phase) : '';
    if (ids.has(id)) throw Error('Nút trùng: ' + id); ids.add(id);
    if (id === END) return { id, label: '', x: Math.round(Number(node.x) || 0), y: Math.round(Number(node.y) || 0) };
    if (!thread.flow.includes(label)) throw Error(`Khối "${label}" không có trong session`);
    if (labelType(thread, label) === LEAD ? !LEAD_PHASES.includes(phase) || id !== leadId(phase) : phase || id !== label) throw Error('Nút không hợp lệ: ' + id);
    return { id, label, ...(phase ? { phase } : {}), x: Math.round(Number(node.x) || 0), y: Math.round(Number(node.y) || 0) };
  });
  const edges = [];
  for (const edge of graph.edges) {
    const from = String(edge.from || ''), to = String(edge.to || ''), when = String(edge.when || 'done');
    if (!ids.has(from) || !ids.has(to) || from === to || from === END) throw Error(`Cạnh không hợp lệ: ${from} → ${to}`);
    if (!CONDITIONS.includes(when)) throw Error('Điều kiện không hợp lệ: ' + when);
    if (!edges.some(item => item.from === from && item.to === to && item.when === when)) edges.push({ id: `${from}>${to}:${when}`, from, to, when });
  }
  return { custom: true, nodes, edges };
}
// Session cũ hoặc session vừa đổi khối: dựng sơ đồ mặc định khi chưa có; bỏ nút/cạnh của khối đã xoá.
function ensureGraph(thread) {
  if (!thread.graph) { thread.graph = defaultGraph(thread); return thread.graph; }
  const keep = node => node.id === END || thread.flow.includes(node.label);
  thread.graph.nodes = thread.graph.nodes.filter(keep);
  const ids = new Set(thread.graph.nodes.map(node => node.id));
  thread.graph.edges = thread.graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  return thread.graph;
}
// Danh sách khối đổi: sơ đồ chưa được người dùng sửa thì dựng lại mặc định; đã sửa (custom) thì giữ và chỉ bỏ nút của khối đã xoá.
function syncGraph(thread) { if (!thread.graph?.custom) { thread.graph = defaultGraph(thread); return thread.graph; } return ensureGraph(thread); }
// Khối mới thêm vào sơ đồ người dùng đã sửa: Dev/VFX nối như các Dev khác (song song), loại khác đặt riêng, chưa nối.
function addNode(thread, label) {
  if (!thread.graph?.custom) return syncGraph(thread);
  const graph = ensureGraph(thread); if (graph.nodes.some(node => node.label === label)) return graph;
  const type = labelType(thread, label), peers = graph.nodes.filter(node => node.id !== END && isDevType(labelType(thread, node.label)));
  if (type === LEAD) { LEAD_PHASES.forEach((phase, index) => graph.nodes.push({ id: leadId(phase), label, phase, x: 40 + index * 200, y: 30 })); return graph; }
  const lowest = Math.max(30, ...graph.nodes.map(node => node.y));
  if (isDevType(type) && peers.length) {
    const sample = peers[0];
    graph.nodes.push({ id: label, label, x: sample.x, y: Math.max(...peers.map(node => node.y)) + 100 });
    for (const edge of graph.edges.filter(edge => edge.to === sample.id)) graph.edges.push({ id: `${edge.from}>${label}:${edge.when}`, from: edge.from, to: label, when: edge.when });
    for (const edge of graph.edges.filter(edge => edge.from === sample.id)) graph.edges.push({ id: `${label}>${edge.to}:${edge.when}`, from: label, to: edge.to, when: edge.when });
  } else graph.nodes.push({ id: label, label, x: 40, y: lowest + 100 });
  return graph;
}
// ---- Trạng thái chạy (thread.graphRun.nodes[id] = { status, outcome }); status: idle, queued, running, done, skipped, blocked.
const runOf = thread => (thread.graphRun ||= { nodes: {} });
const stateOf = (thread, id) => (runOf(thread).nodes[id] ||= { status: 'idle' });
function resetRun(thread) { thread.graphRun = { nodes: {} }; return thread.graphRun; }
const incoming = (graph, id) => graph.edges.filter(edge => edge.to === id);
const outgoing = (graph, id) => graph.edges.filter(edge => edge.from === id);
// Nút vào: không có cạnh nào dẫn tới (thường là GD). Dùng khi bắt đầu chạy.
const entries = graph => graph.nodes.filter(node => node.id !== END && !incoming(graph, node.id).length);
// Nút kết thúc với kết quả → kích hoạt các nút đích của cạnh khớp. Trả về id các nút vừa được kích hoạt.
function finish(thread, id, outcome) {
  const graph = ensureGraph(thread), state = stateOf(thread, id);
  state.status = outcome === 'blocked' ? 'blocked' : outcome === 'skipped' ? 'skipped' : 'done'; state.outcome = outcome;
  const targets = [...new Set(outgoing(graph, id).filter(edge => matches(edge.when, outcome)).map(edge => edge.to))];
  for (const target of targets) { const next = stateOf(thread, target); if (next.status !== 'running') next.status = 'queued'; else next.again = true; }
  return targets;
}
function queue(thread, id) { const state = stateOf(thread, id); if (state.status !== 'running') state.status = 'queued'; }
// Nút đang chờ và không còn nút nối vào nó đang chờ/chạy. Nếu không có gì chạy được mà vẫn còn nút chờ (vòng chờ lẫn nhau),
// chạy nút chờ đầu tiên theo thứ tự trong sơ đồ để luồng không đứng im.
function ready(thread) {
  const graph = ensureGraph(thread), status = id => stateOf(thread, id).status;
  const queued = graph.nodes.filter(node => status(node.id) === 'queued');
  const free = queued.filter(node => !incoming(graph, node.id).some(edge => edge.from !== node.id && ['queued', 'running'].includes(status(edge.from))));
  if (free.length || graph.nodes.some(node => status(node.id) === 'running')) return free;
  return queued.slice(0, 1);
}
const nodesFor = (thread, label) => ensureGraph(thread).nodes.filter(node => node.label === label);
module.exports = { syncGraph, END, LEAD_PHASES, CONDITIONS, CONDITION_NAMES, PHASE_NAMES, leadId, nodeLabel, matches, defaultGraph, validate, ensureGraph, addNode, runOf, stateOf, resetRun, entries, finish, queue, ready, nodesFor, incoming, outgoing };
