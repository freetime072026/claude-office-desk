// Thẻ duyệt kế hoạch đội của PO (po.cjs): các mốc, khối thêm/xoá/tạm nghỉ ở từng mốc, phần giao GD, trách nhiệm riêng và
// ảnh sơ đồ luồng của đội ở mỗi mốc. Người dùng duyệt một lần cả kế hoạch; app tự áp khi tới mốc (team.cjs applyMilestone).
(() => {
  const SVG = 'http://www.w3.org/2000/svg', NODE_W = 170, NODE_H = 56;
  const get = selector => document.querySelector(selector);
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const svg = (tag, attrs = {}) => { const element = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); return element; };
  const PHASES = { planning: 'lập kế hoạch', triage: 'triage', review: 'review' };
  const nameOf = node => node.id === '@end' ? 'Hoàn tất' : node.phase ? `${node.label} · ${PHASES[node.phase] || node.phase}` : node.label;
  // Ảnh sơ đồ tĩnh: khối và dây (vuông góc; dây quay lại vòng phía trên). Khối mới của mốc tô xanh, khối tạm nghỉ mờ.
  function preview(graph, step) {
    const xs = graph.nodes.map(node => node.x), ys = graph.nodes.map(node => node.y), minX = Math.min(...xs) - 20, minY = Math.min(...ys) - 70;
    const width = Math.max(...xs) + NODE_W + 20 - minX, height = Math.max(...ys) + NODE_H + 20 - minY;
    const root = svg('svg', { viewBox: `${minX} ${minY} ${width} ${height}`, class: 'po-preview', role: 'img', 'aria-label': 'Sơ đồ luồng của mốc' });
    const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
    for (const edge of graph.edges) {
      const from = byId[edge.from], to = byId[edge.to]; if (!from || !to) continue;
      const sx = from.x + NODE_W, sy = from.y + NODE_H / 2, tx = to.x, ty = to.y + NODE_H / 2, mid = (sx + tx) / 2;
      const d = tx > sx + 10 ? `M${sx},${sy} H${mid} V${ty} H${tx}` : `M${sx},${sy} H${sx + 14} V${Math.min(from.y, to.y) - 30} H${tx - 14} V${ty} H${tx}`;
      root.append(svg('path', { d, class: 'po-edge ' + edge.when }));
    }
    for (const node of graph.nodes) {
      const state = step.add.includes(node.label) ? ' added' : step.idle.includes(node.label) ? ' idle' : '';
      root.append(svg('rect', { x: node.x, y: node.y, width: NODE_W, height: NODE_H, rx: 10, class: 'po-node' + state + (node.id === '@end' ? ' end' : '') }));
      const label = svg('text', { x: node.x + 12, y: node.y + NODE_H / 2 + 5, class: 'po-node-text' }); label.textContent = nameOf(node); root.append(label);
    }
    return root;
  }
  const chips = (title, labels, kind) => labels.length ? make('p', { className: 'po-chips ' + kind, textContent: `${title}: ${labels.join(', ')}` }) : null;
  window.poPlanView = {
    paint(thread, act) {
      const box = get('#po-plan'), plan = thread?.poPlan;
      // Đã duyệt: một dòng mốc đang chạy; chờ duyệt: thẻ đầy đủ.
      get('#po-status').hidden = plan?.status !== 'approved';
      if (plan?.status === 'approved') { const milestone = plan.plan.milestones[plan.current ?? 0]; get('#po-status').textContent = `Kế hoạch PO · mốc ${(plan.current ?? 0) + 1}/${plan.plan.milestones.length}: ${milestone?.title || ''}`; }
      box.hidden = plan?.status !== 'proposed'; if (box.hidden) { box.dataset.key = ''; return; }
      const key = thread.id + plan.proposedAt; if (box.dataset.key === key) return; box.dataset.key = key;
      const body = [make('h3', { textContent: `Kế hoạch đội của PO · ${plan.plan.milestones.length} mốc · chờ bạn duyệt` })];
      if (plan.plan.summary) body.push(make('p', { className: 'po-summary', textContent: plan.plan.summary }));
      body.push(make('p', { className: 'po-note', textContent: 'Duyệt một lần cho cả kế hoạch: khối cần ở mốc sau sẽ được thêm, khối không còn cần sẽ bị xoá, khối không dùng ở một mốc sẽ tạm nghỉ, khi tới mốc đó app tự làm và không hỏi lại.' }));
      plan.plan.milestones.forEach((milestone, index) => {
        const step = plan.steps[index] || { add: [], remove: [], idle: [] }, section = make('details', { className: 'po-milestone', open: index === 0 });
        section.append(make('summary', { textContent: `Mốc ${index + 1}: ${milestone.title}` }));
        if (milestone.goal) section.append(make('p', { textContent: 'Mục tiêu: ' + milestone.goal }));
        section.append(...[chips('Khối hoạt động', milestone.blocks, 'active'), chips('Thêm', step.add, 'add'), chips('Xoá', step.remove, 'remove'), chips('Tạm nghỉ', step.idle, 'idle')].filter(Boolean));
        if (milestone.reasons) section.append(make('p', { className: 'po-reasons', textContent: 'Lý do: ' + milestone.reasons }));
        if (plan.previews?.[index]) section.append(preview(plan.previews[index], step));
        const gd = make('details', { className: 'po-gd' }); gd.append(make('summary', { textContent: 'Phần giao GD' }), make('pre', { textContent: milestone.gd })); section.append(gd);
        body.push(section);
      });
      const roles = Object.entries(plan.plan.responsibilities || {});
      if (roles.length) { const list = make('details', { className: 'po-roles' }); list.append(make('summary', { textContent: `Trách nhiệm riêng trong session (${roles.length} khối)` }), ...roles.map(([name, value]) => make('p', { textContent: `${name}: ${value}` }))); body.push(list); }
      const reason = make('input', { type: 'text', placeholder: 'Lý do từ chối (PO sẽ nhận ở lượt sau)', className: 'po-reason' });
      const approve = make('button', { type: 'button', className: 'primary', textContent: 'Duyệt kế hoạch đội' }), reject = make('button', { type: 'button', textContent: 'Từ chối' });
      approve.onclick = () => act('po-approve'); reject.onclick = () => act('po-reject', { reason: reason.value });
      const actions = make('div', { className: 'po-actions' }); actions.append(approve, reject, reason); body.push(actions);
      box.replaceChildren(...body);
    }
  };
})();
