// Sơ đồ luồng chạy của một session: nút = khối (Lead Dev tách 3 nút theo pha, Art Director 2 nút), cạnh = "khi nút nguồn kết thúc với kết quả X
// thì kích hoạt nút đích". Thuần dữ liệu, không Electron; bộ chạy tự động (pipeline.cjs) gọi các hàm ở đây.
//
// Luật chạy:
// - Kết quả của nút: done, pass, issue, reject, skipped (Dev không có task), blocked (dừng chờ người dùng).
// - Cạnh khớp khi: 'done' → done/pass/skipped; 'always' → mọi kết quả trừ blocked; 'pass'/'issue'/'reject' → đúng kết quả đó.
// - Nút được kích hoạt sẽ chờ (queued) và chỉ chạy khi không còn nút nối vào nó đang chờ/đang chạy: QA chờ đủ mọi Dev,
//   còn Dev có nhiều nguồn thay thế nhau (planning/triage/review) thì chỉ cần nguồn vừa kích hoạt.
const { LEAD, labelType } = require('./workers.cjs');
const { isDevType, ART_DIRECTOR, AD_PHASES, RELEASE, ART_CONSUMER_TYPES } = require('./roles.cjs');
const END = '@end';
const LEAD_PHASES = Object.freeze(['planning', 'triage', 'review']);
// Khối có pha: mỗi pha là một nút riêng, id = "<nhãn>@<pha>".
const PHASED = Object.freeze({ [LEAD]: LEAD_PHASES, [ART_DIRECTOR]: AD_PHASES });
const phaseId = (label, phase) => `${label}@${phase}`;
const CONDITIONS = Object.freeze(['done', 'pass', 'issue', 'reject', 'always']);
const CONDITION_NAMES = Object.freeze({ done: 'xong', pass: 'pass', issue: 'issue', reject: 'reject', always: 'luôn' });
const PHASE_NAMES = Object.freeze({ planning: 'lập kế hoạch', triage: 'triage', review: 'review' });
const OUTCOMES = Object.freeze(['done', 'pass', 'issue', 'reject', 'skipped', 'blocked']);
const leadId = phase => phaseId(LEAD, phase);
// Khoảng cách cột của sơ đồ mặc định (khối rộng 170): chừa khe ~110px cho các dây chạy dọc giữa hai cột (graph-ui.js dùng cùng số).
const COLUMN = 280;
// Nút theo nhánh (thread.lanes, po.cjs): QA, Lead Dev · triage và Art Director · review có một nút mỗi nhánh, id "<id thường>~<nhánh>".
const laneId = (base, lane) => `${base}~${lane}`;
const laneNames = thread => (thread.lanes || []).map(lane => lane.name);
const nodeLabel = node => node.id === END ? 'Hoàn tất' : [node.label, node.phase ? PHASE_NAMES[node.phase] : '', node.lane || ''].filter(Boolean).join(' · ');
// Nút được phép gắn nhánh: QA, Lead Dev pha triage và review, Art Director pha review.
const laneable = (type, phase) => (type === 'QA' && !phase) || (type === LEAD && ['triage', 'review'].includes(phase)) || (type === ART_DIRECTOR && phase === 'review');
function matches(when, outcome) {
  if (outcome === 'blocked' || !OUTCOMES.includes(outcome)) return false;
  if (when === 'always') return true;
  if (when === 'done') return ['done', 'pass', 'skipped'].includes(outcome);
  return when === outcome;
}
// ---- Sơ đồ mặc định từ danh sách khối (cũng dùng cho session cũ): trước Lead nối tiếp, Dev/VFX song song, QA chờ đủ Dev.
function defaultGraph(thread) {
  const type = label => labelType(thread, label), flow = thread.flow || [];
  const pre = flow.filter(label => ['PO', 'GD', 'UI/UX'].includes(type(label)));
  const lead = flow.find(label => type(label) === LEAD), devs = flow.filter(label => isDevType(type(label)));
  const qas = flow.filter(label => type(label) === 'QA'), ad = flow.find(label => type(label) === ART_DIRECTOR), release = flow.find(label => type(label) === RELEASE);
  const custom = flow.filter(label => type(label) !== 'Fixer' && !pre.includes(label) && label !== lead && label !== ad && label !== release && !devs.includes(label) && !qas.includes(label));
  const nodes = [], edges = [], at = (column, row, rows) => ({ x: 40 + column * COLUMN, y: 180 + (row - (rows - 1) / 2) * 100 });
  let column = 0;
  const add = (id, label, phase, position) => { nodes.push({ id, label, ...(phase ? { phase } : {}), ...position }); return id; };
  const link = (from, to, when = 'done') => { if (from && to && !edges.some(edge => edge.from === from && edge.to === to && edge.when === when)) edges.push({ id: `${from}>${to}:${when}`, from, to, when }); };
  const linkAll = (froms, tos, when) => { for (const from of froms) for (const to of tos) link(from, to, when); };
  let tail = [];
  for (const label of pre) { add(label, label, '', at(column++, 0, 1)); linkAll(tail, [label]); tail = [label]; }
  // Art Director duyệt mockup UI/UX (không đạt → reject về UI/UX), viết đặc tả ảnh và giao Art trước khi Lead lập kế hoạch.
  const adPlanning = ad ? add(phaseId(ad, 'planning'), ad, 'planning', at(column++, 0, 1)) : '';
  if (adPlanning) { linkAll(tail, [adPlanning]); const uiux = pre.find(label => type(label) === 'UI/UX'); if (uiux) link(adPlanning, uiux, 'reject'); tail = [adPlanning]; }
  const planning = lead ? add(leadId('planning'), lead, 'planning', at(column++, 0, 1)) : '';
  if (planning) { linkAll(tail, [planning]); tail = [planning]; }
  const devColumn = column;
  // Bước kiểm (QA, Art Director · review) đi tiếp khi pass; khối làm việc đi tiếp khi xong.
  const checkerIds = new Set(), linkOn = (froms, to) => { for (const from of froms) link(from, to, checkerIds.has(from) ? 'pass' : 'done'); };
  // Khối nhận việc lại khi Lead review trả về hoặc Release báo lỗi mà không có Lead: khối đầu mỗi nhánh (giữ thứ tự trong nhánh) hoặc mọi Dev.
  let fixTargets = devs;
  const lanes = (thread.lanes || []).map(lane => ({ ...lane, blocks: lane.blocks.filter(label => devs.includes(label)) })).filter(lane => lane.blocks.length);
  // Triage đặt phía trên nút lập kế hoạch (cùng cột) để cạnh triage → Dev đi xuôi, không đè lên các Dev.
  const addTriage = () => { const top = Math.min(...nodes.filter(node => devs.includes(node.id)).map(node => node.y)); return add(leadId('triage'), lead, 'triage', { x: 40 + (devColumn - 1) * COLUMN, y: top - 120 }); };
  const triageOf = () => nodes.find(node => node.id === leadId('triage'))?.id || (lead && devs.length ? (id => { linkAll([id], fixTargets); return id; })(addTriage()) : '');
  if (lanes.length) {
    // Nhánh song song (po.cjs lanes): mỗi nhánh là một làn khối nối tiếp → QA và Art Director · review của nhánh → Lead Dev · review của
    // nhánh; issue/reject chỉ quay về khối của nhánh đó (Lead triage riêng mỗi nhánh). Bước sau (Release / Hoàn tất) nối từ review của mọi
    // nhánh và chờ đủ các nhánh pass. Art Director và Lead Dev chạy các bước của từng nhánh song song (pipeline.cjs parallelLane).
    // Trong nhánh, các khối cùng loại liền nhau (Art, Art #2…) là một chặng chạy song song: PO thêm khối cùng loại để chia việc, không phải
    // để chờ nhau (trước đây Art → Art #2 nối tiếp nên nhánh Hero chỉ vẽ từng ảnh một trong khi nhánh khác đã xong). Chặng khác loại vẫn
    // nối tiếp (Art → Anim → Dev: khối sau dùng sản phẩm khối trước).
    const stagesOf = blocks => blocks.reduce((stages, label) => { const last = stages.at(-1); if (last && type(last[0]) === type(label)) last.push(label); else stages.push([label]); return stages; }, []);
    const laneStages = lanes.map(lane => stagesOf(lane.blocks));
    const width = Math.max(...laneStages.map(stages => stages.length)), deepest = Math.max(...laneStages.flatMap(stages => stages.map(stage => stage.length)));
    const perLane = Math.max(1, qas.length + (ad ? 1 : 0), deepest), band = perLane * 100 + 60;
    const checkColumn = column + width, x = col => 40 + col * COLUMN, ends = [];
    lanes.forEach((lane, index) => {
      const stages = laneStages[index], y = index * band, mark = { lane: lane.name }, first = stages[0], last = stages.at(-1);
      stages.forEach((stage, step) => stage.forEach((label, row) => add(label, label, '', { x: x(column + step), y: y + row * 100 })));
      linkAll(tail, first); stages.slice(1).forEach((stage, step) => linkAll(stages[step], stage));
      const qaIds = qas.map((label, row) => add(laneId(label, lane.name), label, '', { x: x(checkColumn), y: y + row * 100, ...mark }));
      const adId = ad ? add(laneId(phaseId(ad, 'review'), lane.name), ad, 'review', { x: x(checkColumn), y: y + qas.length * 100, ...mark }) : '';
      const checks = [...qaIds, ...(adId ? [adId] : [])]; checks.forEach(id => checkerIds.add(id));
      linkAll(last, checks);
      const review = lead ? add(laneId(leadId('review'), lane.name), lead, 'review', { x: x(checkColumn + 2), y, ...mark }) : '';
      if (review) { linkOn(checks.length ? checks : last, review); linkAll([review], first, 'reject'); checkerIds.add(review); ends.push(review); }
      else ends.push(...(checks.length ? checks : last));
      const triage = lead ? add(laneId(leadId('triage'), lane.name), lead, 'triage', { x: x(checkColumn + 1), y, ...mark }) : '';
      if (triage) linkAll([triage], first);
      linkAll(qaIds, triage ? [triage] : first, 'issue');
      if (adId) {
        linkAll([adId], lane.blocks.filter(label => ['Art', 'Anim'].includes(type(label))), 'reject');
        linkAll([adId], triage ? [triage] : first, 'issue');
        linkAll(lane.blocks.filter(label => ART_CONSUMER_TYPES.includes(type(label))), [adId], 'reject');
      }
    });
    // Khối thêm tay ngoài mọi nhánh: chạy song song sau lập kế hoạch, không qua kiểm của nhánh nào.
    const loose = devs.filter(label => !lanes.some(lane => lane.blocks.includes(label)));
    loose.forEach((label, row) => { add(label, label, '', { x: x(column), y: (lanes.length + row) * band }); linkAll(tail, [label]); ends.push(label); });
    fixTargets = [...laneStages.flatMap(stages => stages[0]), ...loose];
    // Lead triage chung: Issue không thuộc nhánh nào (Release, bạn tự báo, chỉnh sửa) giao được cho khối của mọi nhánh.
    if (lead) triageOf();
    column = checkColumn + (lead ? 3 : 1); tail = ends;
  } else {
    devs.forEach((label, row) => add(label, label, '', at(column, row, devs.length))); if (devs.length) column++;
    if (devs.length) { linkAll(tail, devs); tail = devs; }
    // Kiểm sau vòng Dev: QA và Art Director review chạy song song; bước sau chờ cả hai pass.
    const adReview = ad && devs.length ? phaseId(ad, 'review') : '', checkers = [...qas, ...(adReview ? [adReview] : [])];
    qas.forEach((label, row) => add(label, label, '', at(column, row, checkers.length)));
    if (adReview) add(adReview, ad, 'review', at(column, qas.length, checkers.length));
    if (checkers.length) { column++; linkAll(tail, checkers); tail = checkers; checkers.forEach(id => checkerIds.add(id)); }
    // Vòng sửa lỗi: QA issue → Lead triage → Dev (không có Lead thì QA issue → Dev).
    if (qas.length && devs.length) {
      if (lead) { const triage = addTriage(); linkAll(qas, [triage], 'issue'); linkAll([triage], devs); }
      else linkAll(qas, devs, 'issue');
    }
    // Art Director review: ảnh/animation sai → reject kèm task Art/Anim làm lại; lỗi visual do code/layout → issue về Lead triage (hoặc Dev).
    // Dev/VFX/Anim ghép không được ảnh đã duyệt (lệch UI/UX, thừa chi tiết, thiếu layer) → reject về Art Director review lại.
    if (adReview) {
      linkAll([adReview], devs.filter(label => ['Art', 'Anim'].includes(type(label))), 'reject');
      const triage = triageOf();
      if (triage) link(adReview, triage, 'issue'); else linkAll([adReview], devs, 'issue');
      linkAll(devs.filter(label => ART_CONSUMER_TYPES.includes(type(label))), [adReview], 'reject');
    }
  }
  for (const label of custom) { add(label, label, '', at(column++, 0, 1)); linkOn(tail, label); tail = [label]; }
  // Có nhánh: mỗi nhánh đã có Lead Dev · review riêng (ở trên), không thêm review chung.
  if (lead && !lanes.length) { const review = add(leadId('review'), lead, 'review', at(column++, 0, 1)); linkOn(tail, review); linkAll([review], fixTargets, 'reject'); tail = [review]; }
  // Release sau Lead review (hoặc bước cuối): pass → Hoàn tất; issue → Lead triage giao sửa (không có Lead thì về Dev).
  const finalChecked = tail.length && tail.every(id => checkerIds.has(id));
  let endWhen = lead ? 'pass' : finalChecked ? 'pass' : 'done';
  if (release) {
    add(release, release, '', at(column++, 0, 1)); linkAll(tail, [release], endWhen); tail = [release]; endWhen = 'pass';
    const triage = triageOf(); if (triage) link(release, triage, 'issue'); else linkAll([release], fixTargets, 'issue');
  }
  add(END, '', '', at(column, 0, 1)); linkAll(tail, [END], endWhen);
  // Dời cả sơ đồ để nút cao nhất cách mép trên 40px (nhiều Dev xếp chồng có thể đẩy lên trên).
  const shift = 40 - Math.min(...nodes.map(node => node.y)); for (const node of nodes) node.y += shift;
  return { nodes, edges };
}
// ---- Kiểm tra sơ đồ người dùng sửa: nút phải là khối có trong session (hoặc Hoàn tất), cạnh nối nút có thật, điều kiện hợp lệ.
// Dây (graph-ui.js): points = các điểm gập {x, y} (mỗi đoạn thẳng theo mọi hướng; [] = nối thẳng, thiếu = tự xếp);
// fromPort / toPort = cổng riêng của dây trên viền khối { side, at }. Dữ liệu sai thì bỏ để dây tự xếp lại.
const COORD_LIMIT = 100000;
// Vị trí nút có thể âm (sơ đồ mở rộng về trái/lên trên), giới hạn để dữ liệu hỏng không làm vỡ giao diện.
const coord = value => Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, Math.round(Number(value) || 0)));
function pointsOf(value) {
  if (!Array.isArray(value) || value.length > 30) return null;
  const points = value.map(point => ({ x: Number(point?.x), y: Number(point?.y) }));
  return points.every(point => [point.x, point.y].every(number => Number.isFinite(number) && Math.abs(number) <= COORD_LIMIT)) ? points.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })) : null;
}
const SIDES = ['left', 'right', 'top', 'bottom'];
function portOf(value) {
  const at = Number(value?.at);
  return SIDES.includes(value?.side) && Number.isFinite(at) && at >= 0 && at <= 1 ? { side: value.side, at: Math.round(at * 1000) / 1000 } : null;
}
function wireOf(edge) {
  const points = pointsOf(edge.points), fromPort = portOf(edge.fromPort), toPort = portOf(edge.toPort);
  return { ...(points ? { points } : {}), ...(fromPort ? { fromPort } : {}), ...(toPort ? { toPort } : {}) };
}
function validate(thread, graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw Error('Sơ đồ không hợp lệ');
  if (graph.nodes.length > 60 || graph.edges.length > 300) throw Error('Sơ đồ quá lớn');
  const ids = new Set(), nodes = graph.nodes.map(node => {
    const id = String(node.id || ''), label = String(node.label || ''), phase = node.phase ? String(node.phase) : '', lane = node.lane ? String(node.lane) : '';
    if (ids.has(id)) throw Error('Nút trùng: ' + id); ids.add(id);
    if (id === END) return { id, label: '', x: coord(node.x), y: coord(node.y) };
    if (!thread.flow.includes(label)) throw Error(`Khối "${label}" không có trong session`);
    const type = labelType(thread, label), phases = PHASED[type], base = phases ? phaseId(label, phase) : label;
    if (phases ? !phases.includes(phase) : phase) throw Error('Nút không hợp lệ: ' + id);
    if (lane && (!laneable(type, phase) || !laneNames(thread).includes(lane))) throw Error(`Nút ${id}: nhánh "${lane}" không có trong session hoặc khối không chia theo nhánh`);
    if (id !== (lane ? laneId(base, lane) : base)) throw Error('Nút không hợp lệ: ' + id);
    return { id, label, ...(phase ? { phase } : {}), ...(lane ? { lane } : {}), x: coord(node.x), y: coord(node.y) };
  });
  const edges = [];
  for (const edge of graph.edges) {
    const from = String(edge.from || ''), to = String(edge.to || ''), when = String(edge.when || 'done');
    if (!ids.has(from) || !ids.has(to) || from === to || from === END) throw Error(`Cạnh không hợp lệ: ${from} → ${to}`);
    if (!CONDITIONS.includes(when)) throw Error('Điều kiện không hợp lệ: ' + when);
    if (!edges.some(item => item.from === from && item.to === to && item.when === when)) edges.push({ id: `${from}>${to}:${when}`, from, to, when, ...wireOf(edge) });
  }
  return { custom: true, nodes, edges };
}
// Session cũ hoặc session vừa đổi khối: dựng sơ đồ mặc định khi chưa có; bỏ nút/cạnh của khối đã xoá.
function ensureGraph(thread) {
  if (!thread.graph) { thread.graph = defaultGraph(thread); return thread.graph; }
  // Nút của nhánh đã bỏ (mốc mới không còn nhánh đó) bị bỏ cùng cạnh của nó.
  const keep = node => node.id === END || (thread.flow.includes(node.label) && (!node.lane || laneNames(thread).includes(node.lane)));
  thread.graph.nodes = thread.graph.nodes.filter(keep);
  const ids = new Set(thread.graph.nodes.map(node => node.id));
  thread.graph.edges = thread.graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  return thread.graph;
}
// Danh sách khối đổi: sơ đồ chưa được người dùng sửa thì dựng lại mặc định; đã sửa (custom) thì giữ và chỉ bỏ nút của khối đã xoá.
function syncGraph(thread) { if (!thread.graph?.custom) { thread.graph = defaultGraph(thread); return thread.graph; } return ensureGraph(thread); }
// Khối chuyển sang nhánh khác giữa mốc (pipeline.cjs lendBlocks) trên sơ đồ người dùng đã sửa: bỏ cạnh cũ, nối và đặt như khối
// cùng loại (peer) của nhánh mới, nên chạy song song với peer và cùng được bước kiểm của nhánh đó trả về / giao tiếp.
function moveNode(thread, label, peer) {
  const graph = ensureGraph(thread), node = graph.nodes.find(item => item.id === label), sample = graph.nodes.find(item => item.id === peer);
  if (!node || !sample || label === peer) return graph;
  graph.edges = graph.edges.filter(edge => edge.from !== label && edge.to !== label);
  const copies = [...graph.edges.filter(edge => edge.to === peer).map(edge => ({ from: edge.from, to: label, when: edge.when })), ...graph.edges.filter(edge => edge.from === peer).map(edge => ({ from: label, to: edge.to, when: edge.when }))];
  for (const edge of copies) if (!graph.edges.some(item => item.from === edge.from && item.to === edge.to && item.when === edge.when)) graph.edges.push({ id: `${edge.from}>${edge.to}:${edge.when}`, ...edge });
  const stack = graph.nodes.filter(item => item.id !== label && item.x === sample.x && item.y >= sample.y && labelType(thread, item.label) === labelType(thread, label));
  Object.assign(node, { x: sample.x, y: Math.max(...stack.map(item => item.y)) + 100 });
  return graph;
}
// Khối mới thêm vào sơ đồ người dùng đã sửa: Dev/VFX nối như các Dev khác (song song), loại khác đặt riêng, chưa nối.
function addNode(thread, label) {
  if (!thread.graph?.custom) return syncGraph(thread);
  const graph = ensureGraph(thread); if (graph.nodes.some(node => node.label === label)) return graph;
  const type = labelType(thread, label), peers = graph.nodes.filter(node => node.id !== END && isDevType(labelType(thread, node.label)));
  if (PHASED[type]) { PHASED[type].forEach((phase, index) => graph.nodes.push({ id: phaseId(label, phase), label, phase, x: 40 + index * COLUMN, y: type === LEAD ? 30 : Math.max(30, ...graph.nodes.map(node => node.y)) + 100 })); return graph; }
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
  state.status = outcome === 'blocked' ? 'blocked' : outcome === 'skipped' ? 'skipped' : 'done'; state.outcome = outcome; delete state.again; delete state.waitNoted;
  const targets = [...new Set(outgoing(graph, id).filter(edge => matches(edge.when, outcome)).map(edge => edge.to))];
  for (const target of targets) { const next = stateOf(thread, target); if (next.status !== 'running') next.status = 'queued'; else next.again = true; }
  return targets;
}
// App vừa mở: không còn lượt nào chạy, nút đang "running" (QA, Lead, Art Director… bị ngắt khi đóng app) về hàng chờ để /role <khối> start
// hoặc bước tự động kế tiếp chạy lại; nếu không chúng đứng mãi và giữ các bước sau. Nút Dev có task bị ngắt sẽ bị chặn kèm lý do (pipeline settleStale).
function recoverRunning(thread) { for (const state of Object.values(thread.graphRun?.nodes || {})) if (state.status === 'running') { state.status = 'queued'; delete state.again; } }
function queue(thread, id) { const state = stateOf(thread, id); if (state.status !== 'running') state.status = 'queued'; }
// Nút đang chờ và không còn nút nối vào nó đang chờ/chạy. Nếu không có gì chạy được mà vẫn còn nút chờ (vòng chờ lẫn nhau),
// chạy nút chờ đầu tiên theo thứ tự trong sơ đồ để luồng không đứng im.
// Nút nằm sau id theo các cạnh đi tiếp (xong/pass/luôn), không tính cạnh quay về (issue/reject).
function downstream(graph, id) {
  const seen = new Set(), stack = [id];
  while (stack.length) for (const edge of outgoing(graph, stack.pop())) if (['done', 'pass', 'always'].includes(edge.when) && !seen.has(edge.to)) { seen.add(edge.to); stack.push(edge.to); }
  return seen;
}
// Nút chờ nằm phía sau (ví dụ Art Director · review chờ Art, nối ngược về Art bằng cạnh reject) không giữ nút phía trước,
// nếu không hai bên chờ nhau và các Art/Anim chỉ được chạy lần lượt qua nhánh dự phòng bên dưới.
function ready(thread) {
  const graph = ensureGraph(thread), status = id => stateOf(thread, id).status;
  const queued = graph.nodes.filter(node => status(node.id) === 'queued');
  const holds = (edge, node) => edge.from !== node.id && (status(edge.from) === 'running' || status(edge.from) === 'queued' && !downstream(graph, node.id).has(edge.from));
  const free = queued.filter(node => !incoming(graph, node.id).some(edge => holds(edge, node)));
  if (free.length || graph.nodes.some(node => status(node.id) === 'running')) return free;
  return queued.slice(0, 1);
}
const nodesFor = (thread, label) => ensureGraph(thread).nodes.filter(node => node.label === label);
module.exports = { laneId, laneable, syncGraph, moveNode, recoverRunning, END, LEAD_PHASES, PHASED, phaseId, CONDITIONS, CONDITION_NAMES, PHASE_NAMES, leadId, nodeLabel, matches, defaultGraph, validate, ensureGraph, addNode, runOf, stateOf, resetRun, entries, finish, queue, ready, nodesFor, incoming, outgoing };
