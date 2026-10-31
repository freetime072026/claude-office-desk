// Tab "Sơ đồ luồng": xem và sửa sơ đồ chạy của session (flowgraph.cjs). Kéo nút để sắp xếp, kéo từ chấm ● bên phải nút sang
// nút khác để nối, bấm nhãn trên cạnh để đổi điều kiện hoặc xoá. Sửa trên bản nháp; Lưu mới gửi về main (kiểm tra ở team.cjs).
(() => {
  const NODE_W = 170, NODE_H = 56, END = '@end';
  const CONDITIONS = [['done', 'xong'], ['pass', 'pass'], ['issue', 'issue'], ['reject', 'reject'], ['always', 'luôn']];
  const CONDITION_NAMES = Object.fromEntries(CONDITIONS);
  const PHASES = { planning: 'lập kế hoạch', triage: 'triage', review: 'review' };
  const STATUS_NAMES = { idle: '', queued: 'chờ', running: 'đang chạy', done: 'xong', skipped: 'bỏ qua', blocked: 'bị chặn' };
  const SVG = 'http://www.w3.org/2000/svg';
  const get = selector => document.querySelector(selector);
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const svg = (tag, attrs = {}) => { const element = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); return element; };
  const nodeName = node => node.id === END ? 'Hoàn tất' : node.phase ? `${node.label} · ${PHASES[node.phase]}` : node.label;
  let thread, draft, dirty = false, draftOf = '', menu, scale = 1, fitted = '';
  const canvas = get('#graph-canvas'), edgesLayer = get('#graph-edges');

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
  function loadDraft() { draft = structuredClone(thread?.graph || { nodes: [], edges: [] }); dirty = false; draftOf = thread?.id || ''; get('#graph-save').disabled = get('#graph-cancel').disabled = true; get('#graph-state').textContent = ''; }
  window.graphView = {
    // Gọi từ team-ui.js mỗi lần vẽ lại. Bản nháp đang sửa không bị ghi đè bởi trạng thái mới từ main.
    paint(next) { thread = next; if (!thread || draftOf !== thread.id || !dirty) loadDraft(); if (!get('#graph-view').hidden) render(); }
  };

  // ---- Vẽ
  const position = id => draft.nodes.find(node => node.id === id);
  function edgePath(from, to) {
    const sx = from.x + NODE_W, sy = from.y + NODE_H / 2, tx = to.x, ty = to.y + NODE_H / 2;
    if (tx > sx + 20) { const bend = Math.max(40, (tx - sx) / 2); return { d: `M${sx},${sy} C${sx + bend},${sy} ${tx - bend},${ty} ${tx},${ty}`, mx: (sx + tx) / 2, my: (sy + ty) / 2 }; }
    // Cạnh quay lại (vòng sửa lỗi): vòng lên phía trên hai nút.
    const top = Math.min(from.y, to.y) - 70;
    return { d: `M${sx},${sy} C${sx + 90},${top} ${tx - 90},${top} ${tx},${ty}`, mx: (sx + tx) / 2, my: top + 18 };
  }
  function renderEdges() {
    edgesLayer.replaceChildren(svg('defs'));
    const defs = edgesLayer.firstChild;
    for (const [when] of CONDITIONS) { const marker = svg('marker', { id: 'arrow-' + when, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }); marker.append(svg('path', { d: 'M0,0 L10,5 L0,10 z', class: 'edge-head ' + when })); defs.append(marker); }
    const seen = {};
    for (const edge of draft.edges) {
      const from = position(edge.from), to = position(edge.to); if (!from || !to) continue;
      const pair = edge.from + '>' + edge.to, offset = (seen[pair] = (seen[pair] || 0) + 1) - 1;
      const { d, mx, my } = edgePath(from, to);
      edgesLayer.append(svg('path', { d, class: 'graph-edge ' + edge.when, 'marker-end': `url(#arrow-${edge.when})` }));
      // Vùng bấm rộng dọc theo cạnh (đường vẽ chỉ 1,6px); cạnh "xong" (mặc định) không hiện nhãn cho đỡ rối.
      const hit = svg('path', { d, class: 'graph-edge-hit' }); hit.append(svg('title')); hit.firstChild.textContent = `${nodeName(from)} → ${nodeName(to)}: ${CONDITION_NAMES[edge.when]} · bấm để sửa`;
      hit.addEventListener('click', event => { event.stopPropagation(); const box = canvas.getBoundingClientRect(); openMenu(edge, (event.clientX - box.left) / scale, (event.clientY - box.top) / scale); });
      edgesLayer.append(hit);
      if (edge.when === 'done') continue;
      const tag = svg('g', { class: 'edge-tag ' + edge.when, transform: `translate(${mx},${my + offset * 18})`, tabindex: '0', role: 'button', 'aria-label': `Cạnh ${nodeName(from)} → ${nodeName(to)}: ${CONDITION_NAMES[edge.when]}` });
      const text = svg('text', { 'text-anchor': 'middle', y: '4' }); text.textContent = CONDITION_NAMES[edge.when];
      tag.append(svg('rect', { x: '-26', y: '-9', width: '52', height: '18', rx: '9' }), text);
      tag.addEventListener('click', event => { event.stopPropagation(); openMenu(edge, mx, my + offset * 18); });
      tag.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openMenu(edge, mx, my + offset * 18); } });
      edgesLayer.append(tag);
    }
  }
  // Thu phóng: canvas vẽ theo toạ độ sơ đồ rồi scale; khung bọc (#graph-sizer) mang kích thước đã scale để thanh cuộn đúng.
  const content = () => ({ width: Math.max(...draft.nodes.map(node => node.x + NODE_W + 80), 400), height: Math.max(...draft.nodes.map(node => node.y + NODE_H + 80), 300) });
  function resize() {
    const { width, height } = content(), view = canvas.parentElement.parentElement;
    const w = Math.max(width, (view.clientWidth - 2) / scale), h = Math.max(height, (view.clientHeight - 2) / scale);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; canvas.style.transform = `scale(${scale})`; edgesLayer.setAttribute('width', w); edgesLayer.setAttribute('height', h);
    canvas.parentElement.style.width = w * scale + 'px'; canvas.parentElement.style.height = h * scale + 'px';
    get('#graph-zoom-level').textContent = Math.round(scale * 100) + '%';
  }
  function zoom(next) { scale = Math.min(1.5, Math.max(0.3, Math.round(next * 100) / 100)); resize(); }
  function fit() { const { width, height } = content(), view = canvas.parentElement.parentElement; zoom(Math.min(1, (view.clientWidth - 20) / width, (view.clientHeight - 20) / height)); }
  const scroller = canvas.parentElement.parentElement;
  scroller.addEventListener('wheel', event => {
    event.preventDefault();
    const box = scroller.getBoundingClientRect(), pointX = event.clientX - box.left, pointY = event.clientY - box.top;
    const worldX = (scroller.scrollLeft + pointX) / scale, worldY = (scroller.scrollTop + pointY) / scale;
    zoom(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    scroller.scrollLeft = worldX * scale - pointX; scroller.scrollTop = worldY * scale - pointY;
  }, { passive: false });
  get('#graph-zoom-in').onclick = () => zoom(scale + 0.1); get('#graph-zoom-out').onclick = () => zoom(scale - 0.1); get('#graph-fit').onclick = fit;
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
      if (node.id !== END) { const handle = make('span', { className: 'graph-handle', title: 'Kéo sang nút khác để nối' }); handle.addEventListener('pointerdown', event => startLink(event, node)); element.append(handle); }
      element.addEventListener('pointerdown', event => startDrag(event, node, element));
      canvas.append(element);
    }
    if (fitted !== thread.id) { fitted = thread.id; fit(); } else resize();
    renderEdges();
  }

  // ---- Kéo nút
  function startDrag(event, node, element) {
    if (event.button !== 0 || event.target.classList.contains('graph-handle')) return;
    if (thread.archived) { if (node.id !== END) window.officeSelectBlock?.(node.label); return; }
    event.preventDefault(); closeMenu(); element.setPointerCapture(event.pointerId);
    const startX = event.clientX / scale - node.x, startY = event.clientY / scale - node.y, downX = event.clientX, downY = event.clientY; let moved = false;
    element.onpointermove = move => { if (!moved && Math.hypot(move.clientX - downX, move.clientY - downY) < 4) return; moved = true; node.x = Math.max(0, Math.round((move.clientX / scale - startX) / 10) * 10); node.y = Math.max(0, Math.round((move.clientY / scale - startY) / 10) * 10); element.style.left = node.x + 'px'; element.style.top = node.y + 'px'; resize(); renderEdges(); markDirty(); };
    element.onpointerup = () => { element.onpointermove = element.onpointerup = null; if (!moved && node.id !== END) window.officeSelectBlock?.(node.label); };
  }
  // ---- Nối cạnh: kéo từ chấm ● tới nút đích. Mặc định điều kiện "xong"; đổi bằng cách bấm nhãn.
  function startLink(event, from) {
    if (thread.archived) return;
    event.preventDefault(); event.stopPropagation(); closeMenu();
    const box = canvas.getBoundingClientRect(), line = svg('line', { class: 'graph-edge drafting', x1: from.x + NODE_W, y1: from.y + NODE_H / 2, x2: from.x + NODE_W, y2: from.y + NODE_H / 2 });
    edgesLayer.append(line);
    const move = moveEvent => { line.setAttribute('x2', (moveEvent.clientX - box.left) / scale); line.setAttribute('y2', (moveEvent.clientY - box.top) / scale); };
    const up = upEvent => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); line.remove();
      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('.graph-node')?.dataset.id;
      if (!target || target === from.id || draft.edges.some(edge => edge.from === from.id && edge.to === target && edge.when === 'done')) return;
      draft.edges.push({ id: `${from.id}>${target}:done`, from: from.id, to: target, when: 'done' }); markDirty(); renderEdges();
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }
  // ---- Menu cạnh: đổi điều kiện / xoá.
  function closeMenu() { menu?.remove(); menu = null; }
  function openMenu(edge, x, y) {
    closeMenu(); if (thread.archived) return;
    menu = make('div', { className: 'graph-edge-menu' }); menu.style.left = x + 'px'; menu.style.top = (y + 14) + 'px';
    const select = make('select'); select.setAttribute('aria-label', 'Điều kiện của cạnh');
    for (const [value, name] of CONDITIONS) select.append(make('option', { value, textContent: name }));
    select.value = edge.when;
    select.onchange = () => { edge.when = select.value; edge.id = `${edge.from}>${edge.to}:${edge.when}`; markDirty(); renderEdges(); closeMenu(); };
    const remove = make('button', { type: 'button', textContent: 'Xoá cạnh' });
    remove.onclick = () => { draft.edges = draft.edges.filter(item => item !== edge); markDirty(); renderEdges(); closeMenu(); };
    menu.append(make('small', { textContent: `${nodeName(position(edge.from))} → ${nodeName(position(edge.to))}` }), select, remove);
    canvas.append(menu); select.focus();
  }
  canvas.addEventListener('click', event => { if (!event.target.closest('.graph-edge-menu')) closeMenu(); });

  // ---- Lưu / huỷ / đặt lại
  const showError = error => { get('#graph-state').textContent = error.message; };
  get('#graph-save').onclick = async () => { try { await window.office.run('team', { action: 'graph-save', id: thread.id, graph: { nodes: draft.nodes, edges: draft.edges } }); dirty = false; get('#graph-save').disabled = get('#graph-cancel').disabled = true; get('#graph-state').textContent = '✓ Đã lưu sơ đồ'; } catch (error) { showError(error); } };
  get('#graph-cancel').onclick = () => { loadDraft(); render(); };
  get('#graph-reset').onclick = async () => { if (!confirm('Đặt lại sơ đồ theo mặc định? Các nối và vị trí đã sửa sẽ mất.')) return; try { await window.office.run('team', { action: 'graph-reset', id: thread.id }); dirty = false; draftOf = ''; } catch (error) { showError(error); } };

  let saved = 'chat'; try { saved = localStorage.getItem('main-tab') || 'chat'; } catch {}
  setTab(saved === 'graph' ? 'graph' : 'chat');
})();
