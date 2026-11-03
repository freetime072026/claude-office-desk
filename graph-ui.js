// Tab "Sơ đồ luồng": xem và sửa sơ đồ chạy của session (flowgraph.cjs). Kéo nền để di chuyển cả sơ đồ (mở rộng mọi hướng),
// Shift + kéo nền để quét chọn nhiều nút rồi kéo cả nhóm. Mỗi dây có cổng riêng ở hai đầu, kéo đầu dây để đặt tuỳ ý trên viền khối; kéo ● sang khối khác để tạo dây mới.
// Dây là các đoạn thẳng (dọc/ngang/chéo) qua các điểm gập kéo được; bấm dây/nhãn để đổi điều kiện.
// Sửa trên bản nháp; Lưu mới gửi về main (kiểm tra ở flowgraph.validate).
(() => {
  const NODE_W = 170, NODE_H = 56, END = '@end', GRID = 10, STUB = 24, LANE = 14;
  const CONDITIONS = [['done', 'xong'], ['pass', 'pass'], ['issue', 'issue'], ['reject', 'reject'], ['always', 'luôn']];
  const CONDITION_NAMES = Object.fromEntries(CONDITIONS);
  const PHASES = { planning: 'lập kế hoạch', triage: 'triage', review: 'review' };
  const STATUS_NAMES = { idle: '', queued: 'chờ', running: 'đang chạy', done: 'xong', skipped: 'bỏ qua', blocked: 'bị chặn' };
  const SVG = 'http://www.w3.org/2000/svg';
  const get = selector => document.querySelector(selector);
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const svg = (tag, attrs = {}) => { const element = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); return element; };
  const nodeName = node => node.id === END ? 'Hoàn tất' : node.phase ? `${node.label} · ${PHASES[node.phase]}` : node.label;
  const snap = value => Math.round(value / GRID) * GRID;
  let thread, draft, dirty = false, draftOf = '', menu, scale = 1, panX = 0, panY = 0, fitted = '';
  const selected = new Set();
  const viewport = get('.graph-scroll'), canvas = get('#graph-canvas'), edgesLayer = get('#graph-edges');

  // ---- Chuyển tab Hội thoại / Sơ đồ (nhớ theo máy).
  function setTab(name) {
    const graph = name === 'graph';
    get('#graph-view').hidden = !graph; for (const id of ['#activity', '#issues', '#composer']) get(id).hidden = graph;
    get('#tab-chat').setAttribute('aria-selected', String(!graph)); get('#tab-graph').setAttribute('aria-selected', String(graph));
    try { localStorage.setItem('main-tab', name); } catch {}
    if (graph) { fitted = ''; render(); }
  }
  get('#tab-chat').onclick = () => setTab('chat'); get('#tab-graph').onclick = () => setTab('graph');

  const markDirty = () => { dirty = true; get('#graph-save').disabled = get('#graph-cancel').disabled = !thread || thread.archived; get('#graph-state').textContent = 'Có thay đổi chưa lưu'; };
  function loadDraft() { draft = structuredClone(thread?.graph || { nodes: [], edges: [] }); dirty = false; draftOf = thread?.id || ''; selected.clear(); get('#graph-save').disabled = get('#graph-cancel').disabled = true; get('#graph-state').textContent = ''; }
  window.graphView = {
    // Gọi từ team-ui.js mỗi lần vẽ lại. Bản nháp đang sửa không bị ghi đè bởi trạng thái mới từ main.
    paint(next) { thread = next; if (!thread || draftOf !== thread.id || !dirty) loadDraft(); if (!get('#graph-view').hidden) render(); }
  };

  // ---- Khung nhìn: canvas vẽ theo toạ độ sơ đồ (có thể âm), dời bằng pan và phóng bằng scale.
  const toWorld = (clientX, clientY) => { const box = viewport.getBoundingClientRect(); return { x: (clientX - box.left - panX) / scale, y: (clientY - box.top - panY) / scale }; };
  function applyView() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    viewport.style.backgroundPosition = `${panX}px ${panY}px`; viewport.style.backgroundSize = `${20 * scale}px ${20 * scale}px`;
    get('#graph-zoom-level').textContent = Math.round(scale * 100) + '%';
  }
  // Phóng quanh một điểm trên màn hình (con trỏ chuột hoặc giữa khung) để điểm đó đứng yên.
  function zoomAt(next, clientX, clientY) {
    const box = viewport.getBoundingClientRect(), x = clientX ?? box.left + box.width / 2, y = clientY ?? box.top + box.height / 2, world = toWorld(x, y);
    scale = Math.min(1.5, Math.max(0.3, Math.round(next * 100) / 100));
    panX = x - box.left - world.x * scale; panY = y - box.top - world.y * scale; applyView();
  }
  function bounds() {
    const xs = draft.nodes.map(node => node.x), ys = draft.nodes.map(node => node.y);
    if (!xs.length) return { minX: 0, minY: 0, maxX: 400, maxY: 300 };
    return { minX: Math.min(...xs), minY: Math.min(...ys) - 60, maxX: Math.max(...xs) + NODE_W, maxY: Math.max(...ys) + NODE_H };
  }
  function fit() {
    const { minX, minY, maxX, maxY } = bounds(), width = viewport.clientWidth || 800, height = viewport.clientHeight || 400;
    scale = Math.min(1, Math.max(0.3, Math.min((width - 40) / (maxX - minX), (height - 40) / (maxY - minY))));
    panX = (width - (maxX - minX) * scale) / 2 - minX * scale; panY = (height - (maxY - minY) * scale) / 2 - minY * scale; applyView();
  }
  viewport.addEventListener('wheel', event => { event.preventDefault(); zoomAt(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1), event.clientX, event.clientY); }, { passive: false });
  get('#graph-zoom-in').onclick = () => zoomAt(scale + 0.1); get('#graph-zoom-out').onclick = () => zoomAt(scale - 0.1); get('#graph-fit').onclick = fit;

  // ---- Cổng theo từng dây: edge.fromPort / edge.toPort = { side, at } (cạnh và vị trí 0…1 dọc theo cạnh), kéo đầu dây
  // để đặt tuỳ ý trên viền khối. Chưa đặt thì các dây ra của một khối chia đều cạnh phải, dây vào chia đều cạnh trái
  // (xếp theo vị trí khối bên kia để ít cắt nhau), nên nhiều dây không chung một điểm.
  const position = id => draft.nodes.find(node => node.id === id);
  let spread = new Map();
  function spreadPorts() {
    spread = new Map(); const outgoing = {}, incoming = {};
    for (const edge of draft.edges) { if (!position(edge.from) || !position(edge.to)) continue; (outgoing[edge.from] ||= []).push(edge); (incoming[edge.to] ||= []).push(edge); }
    const share = (lists, end, side, other) => { for (const list of Object.values(lists)) { list.sort((a, b) => position(a[other]).y - position(b[other]).y); list.forEach((edge, index) => spread.set(edge, { ...spread.get(edge), [end]: { side, at: Math.round((index + 1) / (list.length + 1) * 100) / 100 } })); } };
    share(outgoing, 'from', 'right', 'to'); share(incoming, 'to', 'left', 'from');
  }
  const portOf = (edge, end) => edge[end + 'Port'] || spread.get(edge)?.[end] || { side: end === 'from' ? 'right' : 'left', at: 0.5 };
  function sidePoint(node, { side, at }) {
    if (side === 'left' || side === 'right') return { x: side === 'left' ? node.x : node.x + NODE_W, y: node.y + at * NODE_H };
    return { x: node.x + at * NODE_W, y: side === 'top' ? node.y : node.y + NODE_H };
  }
  const portPoint = (edge, end) => sidePoint(position(end === 'from' ? edge.from : edge.to), portOf(edge, end));
  // Điểm trên viền nút gần con trỏ nhất → { side, at } (làm tròn 0,05, chừa hai góc).
  function nearestPort(node, point) {
    const distance = { left: Math.abs(point.x - node.x), right: Math.abs(point.x - node.x - NODE_W), top: Math.abs(point.y - node.y), bottom: Math.abs(point.y - node.y - NODE_H) };
    const side = Object.keys(distance).reduce((best, key) => (distance[key] < distance[best] ? key : best));
    const raw = side === 'left' || side === 'right' ? (point.y - node.y) / NODE_H : (point.x - node.x) / NODE_W;
    return { side, at: Math.min(0.95, Math.max(0.05, Math.round(raw * 20) / 20)) };
  }

  // ---- Dây: các đoạn thẳng (dọc, ngang hoặc chéo) nối cổng ra → các điểm gập edge.points → cổng vào; mũi tên ở cổng vào.
  // Dây chưa có điểm gập thì tự xếp kiểu vuông góc theo cạnh của hai cổng; kéo một điểm (hoặc thêm điểm) thì dây giữ điểm đó.
  const across = side => side === 'left' || side === 'right';
  const away = side => (side === 'left' || side === 'top' ? -1 : 1);
  function autoPoints(edge, from, to, lane) {
    const o = portOf(edge, 'from').side, i = portOf(edge, 'to').side, s = portPoint(edge, 'from'), t = portPoint(edge, 'to');
    if (across(o) !== across(i)) return [across(o) ? { x: t.x, y: s.y } : { x: s.x, y: t.y }];
    const key = across(o) ? 'x' : 'y', start = s[key] + away(o) * STUB, end = t[key] + away(i) * STUB;
    let bends;
    if (away(o) === away(i)) bends = [snap(away(o) > 0 ? Math.max(start, end) : Math.min(start, end)) + away(o) * lane * 6];
    else if ((t[key] - s[key]) * away(o) >= GRID) bends = [snap((s[key] + t[key]) / 2)];
    else bends = [start + away(o) * lane * 6, snap(across(o) ? Math.min(from.y, to.y) - 40 - lane * LANE : Math.max(from.x, to.x) + NODE_W + 40 + lane * LANE), end + away(i) * lane * 6];
    // Bends xen kẽ toạ độ của đoạn vuông góc với hướng ra: dựng thành các góc, đoạn cuối vào cổng theo hướng của cổng vào.
    const points = []; let horizontal = across(o), current = s;
    const step = next => { points.push(next); current = next; horizontal = !horizontal; };
    for (const value of bends) step(horizontal ? { x: value, y: current.y } : { x: current.x, y: value });
    if (horizontal === across(i)) step(horizontal ? { x: snap((current.x + t.x) / 2), y: current.y } : { x: current.x, y: snap((current.y + t.y) / 2) });
    step(horizontal ? { x: t.x, y: current.y } : { x: current.x, y: t.y });
    return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  }
  function bendPoints(edge, from, to, lane) { return Array.isArray(edge.points) ? edge.points : autoPoints(edge, from, to, lane); }
  // Dây tự xếp chuyển thành điểm gập cố định trước khi sửa.
  const own = (edge, bends) => (edge.points ||= bends.map(point => ({ x: point.x, y: point.y })));
  function labelPoint(points) {
    let best = -1, at = points[0];
    for (let j = 0; j < points.length - 1; j++) { const a = points[j], b = points[j + 1], length = Math.hypot(b.x - a.x, b.y - a.y); if (length > best) { best = length; at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; } }
    return at;
  }
  function renderEdges() {
    edgesLayer.replaceChildren(svg('defs'));
    const defs = edgesLayer.firstChild;
    for (const [when] of CONDITIONS) { const marker = svg('marker', { id: 'arrow-' + when, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }); marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'edge-head ' + when })); defs.append(marker); }
    const lanes = {}, all = []; spreadPorts();
    for (const edge of draft.edges) {
      const from = position(edge.from), to = position(edge.to); if (!from || !to) continue;
      const lane = (lanes[edge.from + '>' + edge.to] = (lanes[edge.from + '>' + edge.to] ?? -1) + 1) + (lanes['@' + edge.to] = (lanes['@' + edge.to] ?? -1) + 1);
      const bends = bendPoints(edge, from, to, lane), custom = Array.isArray(edge.points), points = [portPoint(edge, 'from'), ...bends, portPoint(edge, 'to')];
      all.push(...points);
      edgesLayer.append(svg('path', { d: points.map((point, index) => (index ? 'L' : 'M') + point.x + ',' + point.y).join(' '), class: 'graph-edge ' + edge.when, 'marker-end': `url(#arrow-${edge.when})` }));
      // Mỗi đoạn: bấm mở menu, kéo để tạo điểm gập mới tại đó rồi kéo, nhấp đúp để thêm điểm gập.
      for (let j = 0; j < points.length - 1; j++) {
        const a = points[j], b = points[j + 1], hit = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'graph-seg-hit' });
        hit.append(svg('title')); hit.firstChild.textContent = `${nodeName(from)} → ${nodeName(to)}: ${CONDITION_NAMES[edge.when]} · bấm để sửa, kéo hoặc nhấp đúp để thêm điểm gập`;
        hit.addEventListener('pointerdown', event => segmentDown(event, edge, j, bends));
        hit.addEventListener('dblclick', event => { event.stopPropagation(); if (thread.archived) return; const point = toWorld(event.clientX, event.clientY); own(edge, bends).splice(j, 0, { x: snap(point.x), y: snap(point.y) }); markDirty(); renderEdges(); });
        edgesLayer.append(hit);
      }
      // Điểm gập: kéo để dời (mỗi đoạn tới điểm kế bên thẳng theo mọi hướng), nhấp đúp để bỏ. Điểm tự xếp hiện mờ.
      bends.forEach((point, index) => {
        const dot = svg('circle', { cx: point.x, cy: point.y, r: 4.5, class: `graph-waypoint ${edge.when}${custom ? '' : ' auto'}` }); dot.append(svg('title')); dot.firstChild.textContent = 'Kéo để dời điểm gập · nhấp đúp để bỏ';
        dot.addEventListener('pointerdown', event => dragWaypoint(event, edge, index, bends));
        dot.addEventListener('dblclick', event => { event.stopPropagation(); if (thread.archived) return; own(edge, bends).splice(index, 1); markDirty(); renderEdges(); });
        edgesLayer.append(dot);
      });
      // Hai đầu dây: kéo dọc viền khối để dời cổng của riêng dây này, nhấp đúp để về vị trí chia đều.
      for (const end of ['from', 'to']) {
        const at = points[end === 'from' ? 0 : points.length - 1], cap = svg('circle', { cx: at.x, cy: at.y, r: 4, class: `graph-port ${end} ${edge.when}` });
        cap.append(svg('title')); cap.firstChild.textContent = (end === 'from' ? 'Cổng ra' : 'Cổng vào') + ' của dây · kéo dọc viền khối để dời · nhấp đúp để đặt lại';
        cap.addEventListener('pointerdown', event => moveEnd(event, edge, end));
        cap.addEventListener('dblclick', event => { event.stopPropagation(); if (thread.archived) return; delete edge[end + 'Port']; markDirty(); renderEdges(); });
        edgesLayer.append(cap);
      }
      if (edge.when === 'done') continue; // cạnh "xong" (mặc định) không hiện nhãn cho đỡ rối
      const at = labelPoint(points);
      const tag = svg('g', { class: 'edge-tag ' + edge.when, transform: `translate(${at.x},${at.y})`, tabindex: '0', role: 'button', 'aria-label': `Cạnh ${nodeName(from)} → ${nodeName(to)}: ${CONDITION_NAMES[edge.when]}` });
      const text = svg('text', { 'text-anchor': 'middle', y: '4' }); text.textContent = CONDITION_NAMES[edge.when];
      tag.append(svg('rect', { x: '-26', y: '-9', width: '52', height: '18', rx: '9' }), text);
      tag.addEventListener('pointerdown', event => event.stopPropagation());
      tag.addEventListener('click', event => { event.stopPropagation(); openMenu(edge, at.x, at.y); });
      tag.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openMenu(edge, at.x, at.y); } });
      edgesLayer.append(tag);
    }
    // Lớp SVG phủ đúng vùng có nút và dây (toạ độ có thể âm) để bấm được mọi đoạn.
    const xs = [...all.map(point => point.x), ...draft.nodes.flatMap(node => [node.x, node.x + NODE_W])], ys = [...all.map(point => point.y), ...draft.nodes.flatMap(node => [node.y, node.y + NODE_H])];
    const minX = Math.min(0, ...xs) - 200, minY = Math.min(0, ...ys) - 200, width = Math.max(400, ...xs) + 200 - minX, height = Math.max(300, ...ys) + 200 - minY;
    Object.assign(edgesLayer.style, { left: minX + 'px', top: minY + 'px', width: width + 'px', height: height + 'px' });
    edgesLayer.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`); edgesLayer.setAttribute('width', width); edgesLayer.setAttribute('height', height);
  }
  // Kéo chuột với ngưỡng 4px; thả khi chưa vượt ngưỡng thì coi là bấm.
  function track(event, onDrag, onClick, onEnd) {
    const downX = event.clientX, downY = event.clientY; let moved = false;
    const onMove = moveEvent => { if (!moved && Math.hypot(moveEvent.clientX - downX, moveEvent.clientY - downY) < 4) return; moved = true; onDrag(toWorld(moveEvent.clientX, moveEvent.clientY), moveEvent); };
    const onUp = upEvent => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); if (!moved) onClick?.(); else onEnd?.(upEvent); };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }
  // Tự nắn thẳng: đoạn từ điểm đang kéo tới điểm kề bên lệch dưới 15° so với phương ngang/dọc thì kéo về đúng ngang/dọc
  // (mỗi trục nắn theo một điểm kề, nên điểm gập ở góc vuông khớp cả hai đoạn). Giữ Alt khi kéo để tắt.
  const SNAP_SLOPE = Math.tan(15 * Math.PI / 180);
  function straighten(point, neighbors) {
    let { x, y } = point, lockedX = false, lockedY = false;
    for (const near of neighbors) {
      if (!near) continue; const dx = Math.abs(x - near.x), dy = Math.abs(y - near.y);
      if (!lockedY && dy <= dx * SNAP_SLOPE) { y = near.y; lockedY = true; } else if (!lockedX && dx <= dy * SNAP_SLOPE) { x = near.x; lockedX = true; }
    }
    return { x, y };
  }
  // Đặt điểm gập thứ index của dây: bắt lưới rồi nắn theo hai điểm kề (cổng hoặc điểm gập).
  function placeBend(edge, list, index, point, free) {
    const grid = { x: snap(point.x), y: snap(point.y) };
    list[index] = free ? grid : straighten(grid, [index ? list[index - 1] : portPoint(edge, 'from'), index < list.length - 1 ? list[index + 1] : portPoint(edge, 'to')]);
  }
  // Bấm một đoạn: mở menu. Kéo đoạn: thêm điểm gập tại chỗ bấm rồi kéo theo chuột.
  function segmentDown(event, edge, j, bends) {
    if (event.button !== 0 || event.shiftKey) return; // Shift: để nền quét chọn
    event.stopPropagation(); event.preventDefault(); closeMenu();
    const start = toWorld(event.clientX, event.clientY); let added = false;
    track(event, (point, moveEvent) => {
      if (thread.archived) return;
      const list = own(edge, bends); if (!added) { added = true; list.splice(j, 0, { x: snap(start.x), y: snap(start.y) }); }
      placeBend(edge, list, j, point, moveEvent.altKey); markDirty(); renderEdges();
    }, () => openMenu(edge, start.x, start.y));
  }
  function dragWaypoint(event, edge, index, bends) {
    if (event.button !== 0 || thread.archived) return;
    event.stopPropagation(); event.preventDefault(); closeMenu();
    track(event, (point, moveEvent) => { placeBend(edge, own(edge, bends), index, point, moveEvent.altKey); markDirty(); renderEdges(); });
  }

  // ---- Nút
  function paintSelection() { for (const element of canvas.querySelectorAll('.graph-node')) element.classList.toggle('selected', selected.has(element.dataset.id)); }
  function render() {
    closeMenu();
    for (const element of [...canvas.querySelectorAll('.graph-node')]) element.remove();
    get('#graph-empty').hidden = Boolean(thread?.flow?.length); get('#graph-reset').disabled = !thread?.flow?.length || thread.archived;
    if (!thread?.flow?.length) { edgesLayer.replaceChildren(); return; }
    const run = thread.graphRun?.nodes || {};
    for (const node of draft.nodes) {
      const status = run[node.id]?.status || 'idle';
      const element = make('div', { className: `graph-node ${status}${node.id === END ? ' end' : ''}`, tabIndex: 0 });
      element.dataset.id = node.id; element.style.left = node.x + 'px'; element.style.top = node.y + 'px';
      element.append(make('b', { textContent: nodeName(node) }), make('small', { textContent: STATUS_NAMES[status] }));
      if (node.id !== END) { const handle = make('span', { className: 'graph-handle', title: 'Kéo sang khối khác để tạo dây mới' }); handle.addEventListener('pointerdown', event => startLink(event, node)); element.append(handle); }
      element.addEventListener('pointerdown', event => startDrag(event, node));
      canvas.append(element);
    }
    paintSelection(); renderEdges();
    if (fitted !== thread.id && viewport.clientWidth) { fitted = thread.id; fit(); } else applyView();
  }
  // Kéo đầu dây dọc viền khối của nó: đặt cổng riêng cho dây; dây tự xếp đi lại theo cổng mới.
  function moveEnd(event, edge, end) {
    if (event.button !== 0 || thread.archived) return;
    event.stopPropagation(); event.preventDefault(); closeMenu();
    const node = position(end === 'from' ? edge.from : edge.to);
    track(event, (point, moveEvent) => {
      const port = nearestPort(node, point), list = edge.points;
      // Nắn cổng: đoạn đầu (hoặc cuối) của dây gần ngang/dọc thì dời cổng dọc cạnh cho đoạn thẳng hẳn; chỉ khi dây có điểm
      // gập do người dùng đặt hoặc nối thẳng (dây tự xếp đã vuông góc sẵn).
      const near = !Array.isArray(list) ? null : list.length ? list[end === 'from' ? 0 : list.length - 1] : portPoint(edge, end === 'from' ? 'to' : 'from');
      if (near && !moveEvent.altKey) {
        const at = sidePoint(node, port), sideways = port.side === 'left' || port.side === 'right', dx = Math.abs(near.x - at.x), dy = Math.abs(near.y - at.y);
        const value = sideways ? (near.y - node.y) / NODE_H : (near.x - node.x) / NODE_W;
        if ((sideways ? dy <= dx * SNAP_SLOPE : dx <= dy * SNAP_SLOPE) && value >= 0.05 && value <= 0.95) port.at = Math.round(value * 1000) / 1000;
      }
      edge[end + 'Port'] = port; markDirty(); renderEdges();
    });
  }
  // Kéo nút: nút chưa chọn thì chọn riêng nó; nút đã chọn thì kéo cả nhóm (điểm gập của dây có hai đầu trong nhóm dời theo).
  // Shift/Ctrl + bấm: thêm/bỏ nút khỏi nhóm chọn.
  function startDrag(event, node) {
    if (event.button !== 0 || event.target.closest('.graph-handle')) return;
    event.preventDefault(); event.stopPropagation(); closeMenu();
    if (thread.archived) { if (node.id !== END) window.officeSelectBlock?.(node.label); return; }
    if (event.shiftKey || event.ctrlKey || event.metaKey) { if (selected.has(node.id)) selected.delete(node.id); else selected.add(node.id); paintSelection(); return; }
    if (!selected.has(node.id)) { selected.clear(); selected.add(node.id); paintSelection(); }
    const group = draft.nodes.filter(item => selected.has(item.id)), origin = new Map(group.map(item => [item, { x: item.x, y: item.y }]));
    const inner = draft.edges.filter(edge => edge.points?.length && selected.has(edge.from) && selected.has(edge.to)), pointOrigin = new Map(inner.map(edge => [edge, edge.points.map(point => ({ ...point }))]));
    const start = toWorld(event.clientX, event.clientY);
    track(event, point => {
      const dx = snap(point.x - start.x), dy = snap(point.y - start.y);
      for (const item of group) { item.x = origin.get(item).x + dx; item.y = origin.get(item).y + dy; const element = canvas.querySelector(`.graph-node[data-id="${CSS.escape(item.id)}"]`); if (element) { element.style.left = item.x + 'px'; element.style.top = item.y + 'px'; } }
      for (const edge of inner) edge.points = pointOrigin.get(edge).map(was => ({ x: was.x + dx, y: was.y + dy }));
      renderEdges(); markDirty();
    }, () => { if (node.id !== END && selected.size === 1) window.officeSelectBlock?.(node.label); });
  }
  // ---- Nền: kéo để di chuyển cả sơ đồ (chuột trái hoặc giữa); Shift + kéo để quét chọn; bấm (không kéo) để bỏ chọn.
  // Shift + kéo bắt đầu quét chọn cả khi điểm bấm nằm trên dây (dây phủ dày khoảng giữa các nút).
  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest(event.shiftKey ? '.graph-node, .graph-edge-menu' : '.graph-node, .graph-edge-menu, .graph-seg-hit, .graph-waypoint, .graph-port, .edge-tag') || ![0, 1].includes(event.button)) return;
    event.preventDefault(); closeMenu();
    const downX = event.clientX, downY = event.clientY, startPan = { x: panX, y: panY }, box = viewport.getBoundingClientRect(); let moved = false, marquee = null;
    const sweeping = event.button === 0 && event.shiftKey;
    const onMove = moveEvent => {
      if (!moved && Math.hypot(moveEvent.clientX - downX, moveEvent.clientY - downY) < 4) return; moved = true;
      if (!sweeping) { panX = startPan.x + moveEvent.clientX - downX; panY = startPan.y + moveEvent.clientY - downY; viewport.classList.add('panning'); applyView(); return; }
      marquee ||= viewport.appendChild(make('div', { className: 'graph-marquee' }));
      Object.assign(marquee.style, { left: Math.min(downX, moveEvent.clientX) - box.left + 'px', top: Math.min(downY, moveEvent.clientY) - box.top + 'px', width: Math.abs(moveEvent.clientX - downX) + 'px', height: Math.abs(moveEvent.clientY - downY) + 'px' });
    };
    const onUp = upEvent => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); viewport.classList.remove('panning');
      if (marquee) {
        const a = toWorld(downX, downY), b = toWorld(upEvent.clientX, upEvent.clientY), left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
        for (const node of draft.nodes) if (node.x < right && node.x + NODE_W > left && node.y < bottom && node.y + NODE_H > top) selected.add(node.id);
        marquee.remove(); paintSelection();
      } else if (!moved) { selected.clear(); paintSelection(); }
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !get('#graph-view').hidden && selected.size) { selected.clear(); paintSelection(); } });


  // ---- Tạo dây: kéo từ chấm ● tới khối đích. Mặc định điều kiện "xong"; đổi bằng cách bấm dây hoặc nhãn.
  function startLink(event, from) {
    if (event.button !== 0 || thread.archived) return;
    event.preventDefault(); event.stopPropagation(); closeMenu();
    const start = { x: from.x + NODE_W, y: from.y + NODE_H / 2 }, line = edgesLayer.appendChild(svg('line', { class: 'graph-edge drafting', x1: start.x, y1: start.y, x2: start.x, y2: start.y }));
    track(event, point => { line.setAttribute('x2', point.x); line.setAttribute('y2', point.y); }, () => line.remove(), upEvent => {
      line.remove();
      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('.graph-node')?.dataset.id;
      if (!target || target === from.id || draft.edges.some(edge => edge.from === from.id && edge.to === target && edge.when === 'done')) return;
      draft.edges.push({ id: `${from.id}>${target}:done`, from: from.id, to: target, when: 'done' }); markDirty(); renderEdges();
    });
  }
  // ---- Menu cạnh: đổi điều kiện / đặt lại đường nối / xoá.
  function closeMenu() { menu?.remove(); menu = null; }
  function openMenu(edge, x, y) {
    closeMenu(); if (thread.archived) return;
    menu = make('div', { className: 'graph-edge-menu' }); menu.style.left = x + 'px'; menu.style.top = (y + 14) + 'px';
    menu.addEventListener('pointerdown', event => event.stopPropagation());
    const select = make('select'); select.setAttribute('aria-label', 'Điều kiện của cạnh');
    for (const [value, name] of CONDITIONS) select.append(make('option', { value, textContent: name }));
    select.value = edge.when;
    select.onchange = () => { edge.when = select.value; edge.id = `${edge.from}>${edge.to}:${edge.when}`; markDirty(); renderEdges(); closeMenu(); };
    const remove = make('button', { type: 'button', textContent: 'Xoá cạnh' });
    remove.onclick = () => { draft.edges = draft.edges.filter(item => item !== edge); markDirty(); renderEdges(); closeMenu(); };
    menu.append(make('small', { textContent: `${nodeName(position(edge.from))} → ${nodeName(position(edge.to))}` }), select);
    if (edge.fromPort || edge.toPort) { const ports = make('button', { type: 'button', className: 'reset-route', textContent: 'Đặt lại cổng hai đầu' }); ports.onclick = () => { delete edge.fromPort; delete edge.toPort; markDirty(); renderEdges(); closeMenu(); }; menu.append(ports); }
    if (Array.isArray(edge.points)) { const straighten = make('button', { type: 'button', className: 'reset-route', textContent: 'Đặt lại đường nối (tự xếp)' }); straighten.onclick = () => { delete edge.points; markDirty(); renderEdges(); closeMenu(); }; menu.append(straighten); }
    menu.append(remove); canvas.append(menu); select.focus();
  }

  // ---- Lưu / huỷ / đặt lại
  const showError = error => { get('#graph-state').textContent = error.message; };
  get('#graph-save').onclick = async () => { try { await window.office.run('team', { action: 'graph-save', id: thread.id, graph: { nodes: draft.nodes, edges: draft.edges } }); dirty = false; get('#graph-save').disabled = get('#graph-cancel').disabled = true; get('#graph-state').textContent = '✓ Đã lưu sơ đồ'; } catch (error) { showError(error); } };
  get('#graph-cancel').onclick = () => { loadDraft(); render(); };
  get('#graph-reset').onclick = async () => { if (!confirm('Đặt lại sơ đồ theo mặc định? Các nối, đường dây và vị trí đã sửa sẽ mất.')) return; try { await window.office.run('team', { action: 'graph-reset', id: thread.id }); dirty = false; draftOf = ''; } catch (error) { showError(error); } };

  let saved = 'chat'; try { saved = localStorage.getItem('main-tab') || 'chat'; } catch {}
  setTab(saved === 'graph' ? 'graph' : 'chat');
})();
