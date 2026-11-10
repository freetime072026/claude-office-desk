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
      // graphs: sơ đồ mốc bạn đã sửa (graph-ui.js editMilestone) thay ảnh sơ đồ PO dựng sẵn.
      const key = thread.id + plan.proposedAt + (thread.poProduct || '') + (thread.preset || '') + JSON.stringify(plan.graphs || []); if (box.dataset.key === key) return; box.dataset.key = key;
      // startAt: PO chỉnh các mốc còn lại sau khi một mốc xong; các mốc trước đó đã chạy nên không hiện lại.
      const review = Number.isInteger(plan.startAt), first = review ? plan.startAt : 0;
      const body = [make('h3', { textContent: review ? `PO đề xuất chỉnh kế hoạch từ mốc ${first + 1}/${plan.plan.milestones.length} · chờ bạn duyệt` : `Kế hoạch đội của PO · ${plan.plan.milestones.length} mốc · chờ bạn duyệt` })];
      // Loại sản phẩm: duyệt thì app đặt preset của session theo đó (PLA: khối dùng trách nhiệm PLA); không ghi thì giữ preset hiện có.
      // Loại bạn chọn ở panel khối PO (thread.poProduct) thắng product trong kế hoạch.
      const names = { game: 'Game', pla: 'Playable Ads (PLA)' }, chosen = thread.poProduct || plan.plan.product, product = names[chosen];
      const source = thread.poProduct ? ' · bạn chọn ở panel khối PO' : plan.plan.product ? ' · PO chọn, đổi ở panel khối PO' : '';
      body.push(make('p', { className: 'po-product', textContent: 'Loại sản phẩm: ' + (product ? product + (chosen === 'game' ? '' : ' (các khối dùng trách nhiệm và giới hạn của preset này)') : 'giữ như session hiện tại (' + (thread.preset ? names.pla : names.game) + ')') + source }));
      if (plan.plan.summary) body.push(make('p', { className: 'po-summary', textContent: plan.plan.summary }));
      body.push(make('p', { className: 'po-note', textContent: (review ? 'Mốc đã xong giữ nguyên; các mốc từ đây thay bằng bản PO chỉnh theo số liệu thật của mốc vừa xong. ' : 'Duyệt một lần cho cả kế hoạch: ') + 'khối cần ở mốc sau sẽ được thêm, khối không còn cần sẽ bị xoá, khối không dùng ở một mốc sẽ tạm nghỉ. Mỗi mốc xong, PO xem lại các mốc sau và chỉ hỏi lại bạn khi muốn đổi.' }));
      plan.plan.milestones.forEach((milestone, index) => {
        if (index < first) return;
        const step = plan.steps[index] || { add: [], remove: [], idle: [] }, section = make('details', { className: 'po-milestone', open: index === first });
        section.append(make('summary', { textContent: `Mốc ${index + 1}: ${milestone.title}` }));
        if (milestone.goal) section.append(make('p', { textContent: 'Mục tiêu: ' + milestone.goal }));
        section.append(...[chips('Khối hoạt động', milestone.blocks, 'active'), chips('Thêm', step.add, 'add'), chips('Xoá', step.remove, 'remove'), chips('Tạm nghỉ', step.idle, 'idle')].filter(Boolean));
        if (milestone.reasons) section.append(make('p', { className: 'po-reasons', textContent: 'Lý do: ' + milestone.reasons }));
        // Hạng mục PO ước lượng (po.cjs requirements): loại việc, cỡ S/M/L và khối phụ trách.
        if (milestone.requirements?.length) { const list = make('details', { className: 'po-requirements' }); list.append(make('summary', { textContent: `Hạng mục (${milestone.requirements.length})` }), ...milestone.requirements.map(item => make('p', { textContent: `${item.id} · ${item.kind} · ${item.size} · ${item.owners.join(', ')}: ${item.text}` }))); section.append(list); }
        // Ảnh nhỏ chỉ để xem nhanh: bấm ảnh hoặc nút để mở sơ đồ mốc ở tab Sơ đồ luồng (phóng to, kéo, sửa khối/dây rồi Lưu vào kế hoạch).
        if (plan.previews?.[index]) {
          const edited = Boolean(plan.graphs?.[index]), open = () => window.graphView?.editMilestone(index);
          const image = preview(plan.graphs?.[index] || plan.previews[index], step); image.classList.add('editable'); image.addEventListener('click', open);
          const bar = make('div', { className: 'po-graph-bar' }), button = make('button', { type: 'button', textContent: '⤢ Phóng to & sửa sơ đồ' }); button.onclick = open;
          bar.append(button, make('small', { textContent: edited ? 'Đã sửa · app dùng sơ đồ này khi tới mốc' : 'Sơ đồ PO dựng sẵn' }));
          section.append(image, bar);
        }
        const gd = make('details', { className: 'po-gd' }); gd.append(make('summary', { textContent: 'Phần giao GD' }), make('pre', { textContent: milestone.gd })); section.append(gd);
        body.push(section);
      });
      const roles = Object.entries(plan.plan.responsibilities || {});
      if (roles.length) { const list = make('details', { className: 'po-roles' }); list.append(make('summary', { textContent: `Trách nhiệm riêng trong session (${roles.length} khối)` }), ...roles.map(([name, value]) => make('p', { textContent: `${name}: ${value}` }))); body.push(list); }
      const reason = make('input', { type: 'text', placeholder: 'Lý do từ chối (PO sẽ nhận ở lượt sau)', className: 'po-reason' });
      const approve = make('button', { type: 'button', className: 'primary', textContent: 'Duyệt kế hoạch đội' }), reject = make('button', { type: 'button', textContent: 'Từ chối' });
      approve.onclick = () => act('po-approve'); reject.onclick = () => act('po-reject', { reason: reason.value });
      const actions = make('div', { className: 'po-actions' });
      if (review) {
        approve.textContent = 'Duyệt thay đổi'; reject.textContent = 'Từ chối, PO làm lại'; reason.placeholder = 'Lý do (PO xem lại theo lý do này)';
        const keep = make('button', { type: 'button', textContent: 'Giữ kế hoạch cũ' }); keep.onclick = () => act('po-keep');
        actions.append(approve, keep, reject, reason);
      } else actions.append(approve, reject, reason);
      body.push(actions);
      box.replaceChildren(...body);
    }
  };
})();
