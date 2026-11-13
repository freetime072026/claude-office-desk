// Hộp Settings (nút ⚙ cạnh menu tài khoản ở chân sidebar): mục Tài khoản, Usage, Tùy chỉnh và Preview asset (Build preview
// bằng kit asset-preview, preview-kit.cjs). Tùy chỉnh có ba tab:
// Connectors (MCP server trong mcp-servers.json), Skills (skill của app và của dự án) và Plugins (phần cài thêm: Codex CLI, RIFE,
// ComfyUI và model của ComfyUI). Mỗi tab lọc Của bạn (đã có) / Khám phá (cài được), tìm theo tên, nút ＋ Thêm.
// Dữ liệu: snapshot của main (team-ui gọi update) + main.cjs action settings / codex / rife / comfyui.
(() => {
  const get = selector => document.querySelector(selector);
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const run = (action, payload) => window.office.run(action, payload);
  let host = { showError: error => console.error(error), openUsage: () => {}, onChange: () => {} };
  let snap = null; // snapshot gần nhất của main
  let section = 'customize', tab = 'connectors', scope = 'yours', query = '', navQuery = '';
  let mcpInfo = null, mcpLoading = false, note = '';
  let codexState = null, codexChecking = false, codexPoll = null, comfyAsked = false;
  const preview = { folders: null, folder: '', state: null, poll: null };
  const dialog = () => get('#settings');
  const isOpen = () => Boolean(dialog()?.open);
  const fail = error => { host.showError(error); setNote(error.message, true); };
  function setNote(text, bad = false) { note = text || ''; const box = get('#settings-note'); if (box) { box.textContent = note; box.classList.toggle('is-bad', bad); } }

  // ---- Mở / đóng, điều hướng.
  function open(where = {}) {
    if (where.section) section = where.section; if (where.tab) { section = 'customize'; tab = where.tab; } if (where.scope) scope = where.scope;
    if (!isOpen()) dialog().showModal();
    setNote(''); load(); paint();
  }
  function load() {
    if (section === 'preview') { preview.folders = null; previewLoad(); return; }
    if (section !== 'customize') return;
    if ((tab === 'connectors' || tab === 'skills') && !mcpInfo && !mcpLoading) refreshMcp();
    if (tab === 'plugins') { if (!codexState && !codexChecking) checkCodex(); if (!snap?.comfy && !comfyAsked) { comfyAsked = true; comfy('status'); } }
  }
  async function refreshMcp() { mcpLoading = true; try { mcpInfo = await run('settings', { op: 'mcp' }); } catch (error) { fail(error); } mcpLoading = false; paint(); }

  // ---- Plugin: Codex (kiểm trạng thái, mở cửa sổ đăng nhập rồi kiểm lại mỗi 3 s tới 5 phút), RIFE, ComfyUI.
  async function checkCodex() {
    codexChecking = true; paint();
    try { codexState = await run('codex', { op: 'status' }); } catch (error) { codexState = { installed: false, loggedIn: false, text: error.message }; }
    codexChecking = false; if (codexState.loggedIn && codexPoll) { clearInterval(codexPoll); codexPoll = null; } paint(); host.onChange();
  }
  async function codexLogin() {
    try {
      codexState = await run('codex', { op: 'login' }); if (codexState.loggedIn) return paint();
      clearInterval(codexPoll); const until = Date.now() + 5 * 60 * 1000;
      codexPoll = setInterval(() => { if (Date.now() > until) { clearInterval(codexPoll); codexPoll = null; } if (!codexChecking) checkCodex(); }, 3000);
      setNote('Đã mở cửa sổ Codex: trình duyệt mở ra thì chọn Sign in with ChatGPT. Đang chờ đăng nhập…'); paint();
    } catch (error) { fail(error); }
  }
  async function rife(op) { try { const state = await run('rife', { op }); if (snap) snap.rife = state; paint(); host.onChange(); } catch (error) { fail(error); } }
  async function comfy(op, extra = {}) { try { const state = await run('comfyui', { op, ...extra }); if (state && typeof state === 'object' && snap) snap.comfy = state; paint(); host.onChange(); } catch (error) { fail(error); } }

  // ---- Bảng: dòng theo khoá, ô chỉ dựng lại khi nội dung đổi, nút giữ nguyên phần tử (tiến độ tải cập nhật liên tục không làm mất cú bấm).
  const handlers = new Map();
  const HEADS = { connectors: ['Connector', 'Loại', 'Dùng cho', 'Trạng thái'], skills: ['Skill', 'Nguồn', 'Bật cho', 'Trạng thái'], plugins: ['Plugin', 'Loại', 'Yêu cầu', 'Trạng thái'] };
  // Ô: chuỗi, hoặc mảng phần { text, tag?, sub? } (tag = nhãn tròn, sub = dòng phụ nhỏ).
  function fillCell(cell, value) {
    const parts = Array.isArray(value) ? value : [{ text: value || '—', muted: !value }];
    const sig = JSON.stringify(parts); if (cell.dataset.sig === sig) return; cell.dataset.sig = sig;
    cell.replaceChildren(...parts.filter(part => part && part.text).map(part => part.tag ? make('span', { className: 'set-tag ' + part.tag, textContent: part.text }) : part.sub ? make('small', { className: 'set-sub', textContent: part.text }) : part.strong ? make('b', { textContent: part.text }) : make('span', { className: part.muted ? 'set-muted' : '', textContent: part.text })));
  }
  function fillActions(cell, key, actions) {
    const ids = actions.map(action => action.id);
    for (const button of [...cell.querySelectorAll('button')]) if (!ids.includes(button.dataset.act)) button.remove();
    for (const [index, action] of actions.entries()) {
      handlers.set(key + '|' + action.id, action.run);
      let button = cell.querySelector(`button[data-act="${action.id}"]`);
      if (!button) { button = make('button', { type: 'button' }); button.dataset.act = action.id; button.dataset.key = key; }
      if (cell.children[index] !== button) cell.insertBefore(button, cell.children[index] || null);
      button.textContent = action.label; button.disabled = Boolean(action.disabled); button.title = action.title || '';
      button.className = action.done ? 'set-done' : action.primary ? 'set-btn primary' : 'set-btn';
    }
  }
  function renderRows(rows, empty) {
    const body = get('#settings-rows'), keys = new Set(rows.map(row => row.key));
    for (const tr of [...body.children]) if (!keys.has(tr.dataset.key)) tr.remove();
    handlers.clear();
    rows.forEach((row, index) => {
      let tr = body.querySelector(`tr[data-key="${CSS.escape(row.key)}"]`);
      if (!tr) { tr = make('tr'); tr.dataset.key = row.key; }
      tr.className = row.className || '';
      if (row.wide) { // dòng chi tiết trải hết bảng (vd thông tin ComfyUI)
        if (tr.children.length !== 1) tr.replaceChildren(make('td', { colSpan: 4 }));
        const cell = tr.children[0]; let text = cell.querySelector('.set-detail'), bar = cell.querySelector('.set-actions');
        if (!text) { text = make('div', { className: 'set-detail' }); bar = make('div', { className: 'set-actions' }); cell.replaceChildren(text, bar); }
        text.textContent = row.wide; fillActions(bar, row.key, row.actions || []);
      } else {
        if (tr.children.length !== 4) tr.replaceChildren(...[0, 1, 2, 3].map(() => make('td')));
        fillCell(tr.children[0], row.cells[0]); fillCell(tr.children[1], row.cells[1]); fillCell(tr.children[2], row.cells[2]);
        let bar = tr.children[3].querySelector('.set-actions'); if (!bar) { bar = make('div', { className: 'set-actions' }); tr.children[3].replaceChildren(bar); }
        fillActions(bar, row.key, row.actions || []);
      }
      if (body.children[index] !== tr) body.insertBefore(tr, body.children[index] || null);
    });
    const blank = get('#settings-empty'); blank.hidden = rows.length > 0; blank.textContent = empty;
  }
  const done = text => ({ id: 'done', label: '✓ ' + text, disabled: true, done: true });
  const matches = (...texts) => !query || texts.join(' ').toLowerCase().includes(query.toLowerCase());

  // ---- Connectors: MCP server đã khai báo (Của bạn) và connector Office Desk cài được (Khám phá).
  function connectorRows() {
    if (!mcpInfo) return { rows: [], empty: mcpLoading ? 'Đang đọc mcp-servers.json…' : '' };
    const penpotServer = snap?.penpotServer;
    if (scope === 'yours') {
      const rows = mcpInfo.servers.filter(server => matches(server.name, server.detail)).map(server => ({ key: 'mcp:' + server.name,
        cells: [[{ text: server.name, strong: true }, { text: server.detail, sub: true }], server.type === 'stdio' ? 'Trên máy (stdio)' : 'Web (' + server.type + ')', server.roles.join(', ') || ''],
        actions: server.penpot && penpotServer ? [penpotServer.running ? { id: 'stop', label: 'Dừng Penpot MCP', run: () => penpotRun('stop') } : { id: 'start', label: 'Chạy Penpot MCP', primary: true, run: () => penpotRun('start') }, ...(penpotServer.running ? [done('Đang chạy')] : [])] : [done('Đã khai báo')] }));
      return { rows, empty: mcpInfo.error ? mcpInfo.error : query ? 'Không có connector khớp.' : 'Chưa khai báo MCP server nào. Bấm ＋ Thêm > Sửa mcp-servers.json, hoặc xem Khám phá.' };
    }
    const have = name => mcpInfo.servers.some(server => server.name.toLowerCase().includes(name));
    const rows = mcpInfo.discover.filter(item => matches(item.name, item.description)).map(item => ({ key: 'discover:' + item.id,
      cells: [[{ text: item.name, strong: true }, { text: item.description, sub: true }], 'Web (' + item.type + ')', 'UI/UX, Art Director, Art'],
      actions: have(item.id) ? [done('Đã thêm')] : [{ id: 'add', label: 'Thêm', primary: true, run: async () => { try { const result = await run('settings', { op: 'install-penpot' }); setNote(result.text); mcpInfo = null; refreshMcp(); } catch (error) { fail(error); } } }] }));
    return { rows, empty: 'Không có connector khớp.' };
  }
  async function penpotRun(op) { try { await run('penpot-server', { op }); } catch (error) { fail(error); } }

  // ---- Skills: skill của app (tải từ GitHub hoặc chép tay) và của dự án; Khám phá = bộ skill chính thức.
  function skillRows() {
    const catalog = snap?.skills || {}, enabled = snap?.team?.roleSkills || {};
    const all = new Map(); for (const [folder, list] of Object.entries(catalog)) for (const skill of list) if (!all.has(skill.name + skill.source)) all.set(skill.name + skill.source, { ...skill, folder });
    if (scope === 'yours') {
      const rows = [...all.values()].filter(skill => matches(skill.name, skill.description, skill.origin)).sort((a, b) => a.name.localeCompare(b.name)).map(skill => {
        const roles = Object.entries(enabled).filter(([, names]) => names.includes(skill.name)).map(([role]) => role === '*chat' ? 'chat thường' : role);
        return { key: 'skill:' + skill.source + ':' + skill.name,
          cells: [[{ text: skill.name, strong: true }, { text: skill.description, sub: true }], skill.source === 'project' ? [{ text: 'Dự án' }, { text: skill.folder, sub: true }] : skill.origin || 'App (chép tay)', roles.join(', ') || ''],
          actions: skill.source === 'app' ? [{ id: 'remove', label: 'Gỡ', title: 'Xoá thư mục skill khỏi Office Desk', run: async () => { if (!confirm(`Gỡ skill "${skill.name}" khỏi Office Desk?`)) return; try { setNote((await run('settings', { op: 'skill-remove', name: skill.name })).text); } catch (error) { fail(error); } } }] : [done('Của dự án')] };
      });
      return { rows, empty: query ? 'Không có skill khớp.' : 'Chưa có skill. Bấm ＋ Thêm > Thêm skill từ GitHub, hoặc xem Khám phá.' };
    }
    const origins = [...all.values()].map(skill => (skill.origin || '').toLowerCase());
    const rows = (mcpInfo?.discoverSkills || []).filter(item => matches(item.name, item.description, item.repo)).map(item => ({ key: 'discover-skill:' + item.id,
      cells: [[{ text: item.name, strong: true }, { text: item.description, sub: true }], item.repo, ''],
      actions: origins.some(origin => origin.includes(item.repo.toLowerCase())) ? [done('Đã cài')] : [{ id: 'add', label: 'Cài', primary: true, run: () => addSkill(item.url) }] }));
    return { rows, empty: mcpInfo ? 'Không có skill khớp.' : 'Đang tải…' };
  }
  async function addSkill(url) {
    setNote('Đang tải và kiểm tra skill từ GitHub…');
    try { setNote((await run('settings', { op: 'skill-add', url })).text); } catch (error) { fail(error); }
  }

  // ---- Plugins: phần cài thêm của Office Desk.
  const FIT = { ok: ['Hợp card', 'is-ok'], slow: ['Chậm trên card này', 'is-slow'], no: ['Card không đủ', 'is-bad'] };
  function pluginRows() {
    const rows = [], rifeState = snap?.rife, comfyState = snap?.comfy, yours = scope === 'yours';
    const add = (installed, row) => { if (installed === yours && matches(...row.search)) rows.push(row); };
    // Codex CLI
    const codex = codexState;
    add(Boolean(codex?.installed), { key: 'plugin:codex', search: ['Codex CLI ChatGPT sinh ảnh'],
      cells: [[{ text: 'Codex CLI', strong: true }, { text: codexChecking && !codex ? 'Đang kiểm…' : codex ? (codex.loggedIn ? `${codex.text}${codex.version ? ' · ' + codex.version : ''}` : codex.installed ? codex.text : 'Chưa cài Codex CLI') : '', sub: true }],
        [{ text: 'Sinh ảnh' }, { text: 'Art chế độ Codex, dùng gói ChatGPT', sub: true }], 'Node.js, tài khoản ChatGPT'],
      actions: codex?.loggedIn ? [done('Đã đăng nhập'), { id: 'check', label: '↻', title: 'Kiểm lại (codex login status)', run: () => { codexState = null; checkCodex(); } }]
        : [{ id: 'login', label: codex && !codex.installed ? 'Cài & đăng nhập' : 'Đăng nhập', primary: true, disabled: codexChecking && !codex, title: 'Mở cửa sổ codex login (chưa cài thì npm i -g @openai/codex trước)', run: codexLogin }, { id: 'check', label: '↻', title: 'Kiểm lại', run: () => { codexState = null; checkCodex(); } }] });
    // RIFE
    if (rifeState?.supported) add(Boolean(rifeState.installed), { key: 'plugin:rife', search: ['RIFE nội suy frame animation'],
      cells: [[{ text: 'RIFE', strong: true }, { text: rifeState.installed ? rifeState.exe : rifeState.error ? 'Lỗi lần trước: ' + rifeState.error : 'rife-ncnn-vulkan (MIT) của nihui', sub: true }],
        [{ text: 'Nội suy frame' }, { text: 'Kit art-frames bù frame giữa key pose', sub: true }], `GPU qua Vulkan · ~${rifeState.sizeMb} MB`],
      actions: rifeState.installed ? [done('Đã cài')] : [{ id: 'install', label: rifeState.installing ? `Đang tải ${Math.round((rifeState.progress || 0) * 100)}%…` : `Cài (~${rifeState.sizeMb} MB)`, primary: true, disabled: rifeState.installing, run: () => rife('install') }] });
    // ComfyUI + model
    const comfyFound = Boolean(comfyState && (comfyState.server.ok || comfyState.modelsDir));
    const gpu = comfyState?.gpu;
    add(comfyFound, { key: 'plugin:comfyui', search: ['ComfyUI sinh ảnh trên máy'],
      cells: [[{ text: 'ComfyUI', strong: true }, { text: !comfyState ? 'Đang dò…' : comfyState.checking ? 'Đang dò…' : comfyState.server.ok ? `Đang chạy ở ${comfyState.server.url}${comfyState.server.version ? ' · bản ' + comfyState.server.version : ''}` : comfyState.launching ? 'Đang mở ComfyUI…' : comfyState.launchError || 'Chưa chạy', sub: true }],
        [{ text: 'Sinh ảnh trên máy' }, { text: 'Art chế độ ComfyUI, miễn phí, không giới hạn', sub: true }], gpu?.vramGb ? [{ text: `${gpu.name}` }, { text: `${gpu.vramGb} GB VRAM · RAM ${gpu.ramGb} GB`, sub: true }] : 'Card NVIDIA'],
      // Đã cài mà chưa chạy (bản git/comfy-cli/portable): nút Mở ComfyUI thay cho Tải ComfyUI. ComfyUI Desktop thì mở app Desktop.
      actions: [...(comfyState?.server.ok ? [done('Đang chạy')] : comfyState?.launchable ? [{ id: 'launch', label: comfyState.launching ? 'Đang mở…' : 'Mở ComfyUI', primary: true, disabled: comfyState.launching, title: comfyState.launchError || 'Chạy ComfyUI trong ' + comfyState.base + ' (cổng 8188), chạy tiếp khi đóng Office Desk', run: () => comfy('launch') }]
        : [{ id: 'download', label: 'Tải ComfyUI', primary: !comfyFound, title: 'Mở trang tải ComfyUI Desktop (comfy.org)', run: () => run('comfyui', { op: 'download-page' }).catch(fail) }]),
        { id: 'check', label: '↻', title: 'Dò lại ComfyUI, GPU và model đã cài', disabled: Boolean(comfyState?.checking), run: () => comfy('status') }] });
    if (comfyState && matches('ComfyUI model thư mục')) rows.push({ key: 'plugin:comfyui-info', className: 'set-group', wide: (comfyState.modelsDir ? 'Model ComfyUI lưu vào ' + comfyState.modelsDir + (comfyState.baseSource === 'comfy-cli' && !comfyState.server.ok ? ' (workspace của comfy-cli)' : '') : 'Chưa biết thư mục ComfyUI: mở ComfyUI rồi bấm ↻, hoặc chọn thư mục ComfyUI.') + (yours ? '' : ' · Model bên dưới đều có license dùng thương mại được.'),
      actions: [{ id: 'folder', label: 'Chọn thư mục ComfyUI', title: 'Thư mục có models/ (khi ComfyUI chưa chạy)', run: () => comfy('pick-folder') }] });
    for (const model of comfyState?.models || []) {
      const tags = [model.recommended && !model.installed ? { text: 'Khuyên dùng', tag: 'is-pick' } : null, model.addon ? { text: 'Dùng kèm', tag: 'is-plain' } : null, FIT[model.fit] ? { text: FIT[model.fit][0], tag: FIT[model.fit][1] } : null].filter(Boolean);
      add(model.installed || model.installing, { key: 'model:' + model.id, className: 'set-child', search: [model.name, model.use, 'ComfyUI model'],
        cells: [[{ text: model.name, strong: true }, ...tags, { text: model.use, sub: true }], [{ text: 'Model ComfyUI' }, { text: model.license, sub: true }],
          [{ text: `~${model.minVram} GB VRAM` }, { text: `${model.sizeGb} GB${model.error && !model.installing ? ' · Lỗi: ' + model.error : ''}`, sub: true }]],
        actions: model.installed ? [done('Đã cài')] : model.installing ? [{ id: 'cancel', label: `Đang tải ${Math.floor(model.progress * 100)}% · Huỷ`, run: () => comfy('cancel', { model: model.id }) }]
          : [{ id: 'install', label: `Cài (${model.sizeGb} GB)`, primary: model.recommended, run: () => { if (model.fit === 'no' && !confirm(`${model.name} cần khoảng ${model.minVram} GB VRAM và ${model.ramGb} GB RAM, máy này không đủ nên sẽ rất chậm hoặc không chạy được. Vẫn tải ${model.sizeGb} GB?`)) return; comfy('install', { model: model.id }); } }] });
    }
    return { rows, empty: query ? 'Không có plugin khớp.' : yours ? 'Chưa cài plugin nào. Xem Khám phá.' : 'Đã cài hết plugin.' };
  }

  // ---- Mục Tài khoản / Usage: hồ sơ CLI (cùng thao tác với menu tài khoản).
  function paintAccount() {
    const box = get('#settings-section-account'), profiles = snap?.profiles || [];
    box.replaceChildren(make('h3', { textContent: 'Tài khoản' }), make('p', { className: 'set-muted', textContent: 'Hồ sơ Claude Code dùng cho phiên mới. Phiên đang chạy giữ tài khoản ban đầu.' }),
      ...profiles.map(item => { const active = item.id === snap.activeProfileId, row = make('div', { className: 'set-card' }); row.append(make('b', { textContent: (active ? '✓ ' : '') + item.name }), make('button', { type: 'button', className: active ? 'set-done' : 'set-btn', textContent: active ? 'Đang dùng' : 'Dùng hồ sơ này', disabled: active, onclick: async () => { try { const auth = await run('select-profile', { id: item.id }); if (auth?.loginStarted) await run('navigate', { page: 'index.html' }); } catch (error) { fail(error); } } })); return row; }),
      make('button', { type: 'button', className: 'set-btn', textContent: '＋ Thêm / quản lý tài khoản & terminal', onclick: () => run('navigate', { page: 'index.html' }).catch(fail) }));
  }
  function paintUsage() {
    const box = get('#settings-section-usage'), profiles = snap?.profiles || [];
    box.replaceChildren(make('h3', { textContent: 'Usage' }), ...profiles.map(item => { const row = make('div', { className: 'set-card' }); row.append(make('b', { textContent: item.name }), make('small', { className: 'set-sub', textContent: host.usageLabel ? host.usageLabel(item.usage) : '' })); return row; }),
      make('button', { type: 'button', className: 'set-btn', textContent: 'Xem usage chính thức (/usage)', disabled: !profiles.length, onclick: () => { dialog().close(); host.openUsage(); } }));
  }

  // ---- Mục Preview asset: chọn thư mục session, Build preview (chạy nền, hỏi lại status mỗi giây), Mở preview, kit, KIT.md.
  const timeOf = ms => new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  const stopPoll = () => { clearInterval(preview.poll); preview.poll = null; };
  async function previewLoad() {
    try {
      if (!preview.folders) preview.folders = (await run('asset-preview', { op: 'folders' })).folders;
      if (!preview.folders.includes(preview.folder)) preview.folder = preview.folders[0] || '';
      preview.state = preview.folder ? await run('asset-preview', { op: 'status', folder: preview.folder }) : null;
    } catch (error) { fail(error); }
    if (preview.state?.build?.running && !preview.poll) preview.poll = setInterval(previewTick, 1000);
    paint();
  }
  async function previewTick() {
    if (!isOpen() || section !== 'preview') return stopPoll();
    try { preview.state = await run('asset-preview', { op: 'status', folder: preview.folder }); } catch (error) { fail(error); }
    if (!preview.state?.build?.running) stopPoll();
    paint();
  }
  async function previewDo(op) {
    if (!preview.folder) return;
    try {
      if (op === 'build') { preview.state = await run('asset-preview', { op, folder: preview.folder }); if (preview.state?.build?.running && !preview.poll) preview.poll = setInterval(previewTick, 1000); return paint(); }
      await run('asset-preview', { op, folder: preview.folder });
    } catch (error) { fail(error); }
  }
  function paintPreview() {
    const box = get('#settings-section-preview');
    if (!box.dataset.ready) {
      box.dataset.ready = '1';
      const select = make('select', { id: 'set-preview-folder', onchange: event => { preview.folder = event.target.value; preview.state = null; stopPoll(); previewLoad(); } });
      const button = (id, text, op, primary) => make('button', { type: 'button', id, className: primary ? 'set-btn primary' : 'set-btn', textContent: text, onclick: () => previewDo(op) });
      const pick = make('div', { className: 'set-preview-row' }), actions = make('div', { className: 'set-preview-row' });
      pick.append(make('b', { textContent: 'Project' }), select);
      actions.append(button('set-preview-build', 'Build preview', 'build', true), button('set-preview-open', 'Mở preview', 'open'), button('set-preview-kit', 'Mở thư mục kit', 'open-kit'), button('set-preview-doc', 'Quy ước (KIT.md)', 'open-doc'));
      box.replaceChildren(make('h3', { textContent: 'Preview asset' }),
        make('p', { className: 'set-muted', textContent: 'Trang xem trước mọi ảnh trong assets/ và input/, anim Spine (mọi clip), anim frame-by-frame và VFX thật của game. Kit asset-preview của Office Desk: lần đầu chép vào <project>/.office-desk/preview/; kết quả là input/_preview/index.html, mở bằng trình duyệt, không cần server.' }),
        pick, make('div', { className: 'set-card', id: 'set-preview-info' }), actions, make('pre', { className: 'set-preview-log', id: 'set-preview-log', hidden: true }));
    }
    const select = get('#set-preview-folder'), folders = preview.folders || [];
    const sig = folders.join('|'); if (select.dataset.sig !== sig) { select.dataset.sig = sig; select.replaceChildren(...folders.map(folder => make('option', { value: folder, textContent: folder }))); }
    select.value = preview.folder; select.disabled = !folders.length;
    const st = preview.state, job = st?.build, info = get('#set-preview-info');
    const newer = st && st.projectVersion != null && st.projectVersion < st.version ? ` · Office Desk có v${st.version} mới hơn (đọc KIT.md của Office Desk, chép phần sửa lỗi cần)` : '';
    const lines = !folders.length ? ['Chưa có session nào có thư mục project.'] : !st ? ['Đang đọc…'] : [
      st.kitMissing ? 'Kit: không thấy kits/asset-preview trong Office Desk' : st.copied ? `Kit: v${st.projectVersion ?? '?'} trong ${st.dir}${newer}` : `Kit: chưa chép (Build preview sẽ chép v${st.version} vào ${st.dir})`,
      st.builtAt ? `Preview: build lúc ${timeOf(st.builtAt)} · ${st.index}` : 'Preview: chưa build',
      st.vfx ? 'VFX: có vfx_entry.ts + vfx_effects.js' : 'VFX: chưa bật (chép vfx_*.example thành vfx_entry.ts / vfx_effects.js, xem KIT.md)',
      job?.running ? `Đang build… ${Math.round((Date.now() - job.startedAt) / 1000)} s` : job ? (job.code === 0 ? `✓ Build xong trong ${Math.round((job.endedAt - job.startedAt) / 1000)} s` : '✕ Build lỗi: ' + (job.error || 'xem log')) : ''].filter(Boolean);
    const isig = lines.join('\n'); if (info.dataset.sig !== isig) { info.dataset.sig = isig; info.replaceChildren(...lines.map(text => make('small', { className: 'set-sub', textContent: text }))); }
    const busy = Boolean(job?.running), build = get('#set-preview-build');
    build.disabled = !st || busy || st.kitMissing; build.textContent = busy ? 'Đang build…' : 'Build preview';
    get('#set-preview-open').disabled = !st?.builtAt || busy; get('#set-preview-kit').disabled = !st; get('#set-preview-doc').disabled = !st;
    const log = get('#set-preview-log'), text = job ? [...job.log, job.error && !job.running ? '! ' + job.error : ''].filter(Boolean).join('\n') : '';
    log.hidden = !text; log.classList.toggle('is-bad', Boolean(job && !job.running && job.code !== 0));
    if (log.textContent !== text) { const end = log.scrollTop + log.clientHeight >= log.scrollHeight - 4; log.textContent = text; if (end) log.scrollTop = log.scrollHeight; }
  }

  function paint() {
    if (!isOpen()) return;
    for (const button of document.querySelectorAll('#settings-nav [data-section]')) { const on = button.dataset.section === section; button.setAttribute('aria-current', on ? 'page' : 'false'); button.hidden = Boolean(navQuery) && !button.textContent.toLowerCase().includes(navQuery.toLowerCase()); }
    for (const name of ['account', 'usage', 'customize', 'preview']) get('#settings-section-' + name).hidden = section !== name;
    if (section === 'account') return paintAccount();
    if (section === 'preview') return paintPreview();
    if (section === 'usage') return paintUsage();
    for (const button of document.querySelectorAll('#settings-tabs [data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    for (const button of document.querySelectorAll('#settings-scope [data-scope]')) button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
    const head = get('#settings-head'), sig = HEADS[tab].join('|'); if (head.dataset.sig !== sig) { head.dataset.sig = sig; head.replaceChildren(...HEADS[tab].map(text => make('th', { textContent: text }))); }
    const { rows, empty } = tab === 'connectors' ? connectorRows() : tab === 'skills' ? skillRows() : pluginRows();
    renderRows(rows, empty);
  }

  // ---- Menu ＋ Thêm theo tab.
  function addMenu() {
    const menu = get('#settings-add-menu');
    const item = (text, action) => make('button', { type: 'button', textContent: text, onclick: () => { menu.hidden = true; action(); } });
    const items = tab === 'connectors' ? [item('Sửa mcp-servers.json', () => run('settings', { op: 'open-mcp' }).then(() => setNote('Đã mở mcp-servers.json. Lưu tệp rồi bấm ↻ (đổi tab) để đọc lại.'), fail)), item('Đọc lại danh sách', () => { mcpInfo = null; refreshMcp(); }), item('Thêm Penpot MCP', () => { scope = 'discover'; paint(); })]
      : tab === 'skills' ? [item('Thêm skill từ GitHub…', () => { const url = prompt('Link GitHub của skill (https://github.com/<owner>/<repo>[/tree/<nhánh>/<thư mục>])'); if (url) addSkill(url); }), item('Mở thư mục skill', () => run('settings', { op: 'open-skills' }).catch(fail))]
        : [item('Kiểm lại mọi plugin', () => { codexState = null; checkCodex(); comfy('status'); rife('status'); }), item('Tải ComfyUI', () => run('comfyui', { op: 'download-page' }).catch(fail)), item('Chọn thư mục ComfyUI', () => comfy('pick-folder'))];
    menu.replaceChildren(...items); menu.hidden = !menu.hidden;
  }

  // ---- Gắn sự kiện một lần.
  function bind() {
    get('#settings-open').onclick = () => open();
    get('#settings-close').onclick = () => dialog().close();
    dialog().addEventListener('click', event => { if (event.target === dialog()) dialog().close(); if (!event.target.closest('#settings-add, #settings-add-menu')) get('#settings-add-menu').hidden = true; });
    for (const button of document.querySelectorAll('#settings-nav [data-section]')) button.onclick = () => { section = button.dataset.section; setNote(''); load(); paint(); };
    get('#settings-nav-search').oninput = event => { navQuery = event.target.value.trim(); paint(); };
    for (const button of document.querySelectorAll('#settings-tabs [data-tab]')) button.onclick = () => { tab = button.dataset.tab; query = ''; get('#settings-search').value = ''; if (tab !== 'plugins') mcpInfo = null; setNote(''); load(); paint(); };
    for (const button of document.querySelectorAll('#settings-scope [data-scope]')) button.onclick = () => { scope = button.dataset.scope; paint(); };
    get('#settings-search').oninput = event => { query = event.target.value.trim(); paint(); };
    get('#settings-add').onclick = event => { event.stopPropagation(); addMenu(); };
    get('#settings-rows').onclick = async event => {
      const button = event.target.closest('button[data-act]'); if (!button || button.disabled) return;
      const handler = handlers.get(button.dataset.key + '|' + button.dataset.act); if (handler) await handler();
    };
  }

  // Dòng ngắn ở panel khối Art: trạng thái công cụ sinh ảnh đang chọn + RIFE, nút mở tab Plugins.
  function artSummary(mode) {
    const parts = [];
    if (mode === 'codex') parts.push(!codexState ? 'Codex: chưa kiểm' : codexState.loggedIn ? 'Codex: ✓ đã đăng nhập' : codexState.installed ? 'Codex: chưa đăng nhập' : 'Codex: chưa cài');
    if (mode === 'comfyui') { const state = snap?.comfy; parts.push(!state ? 'ComfyUI: chưa dò' : `ComfyUI: ${state.server.ok ? '✓ đang chạy' : 'chưa chạy'} · ${state.models.filter(model => model.installed && !model.addon).length} model`); }
    if (mode !== 'tool' && snap?.rife?.supported) parts.push(snap.rife.installed ? 'RIFE: ✓ đã cài' : 'RIFE: chưa cài');
    return parts.join(' · ');
  }
  function ensureArt(mode) {
    if (mode === 'codex' && !codexState && !codexChecking) checkCodex();
    if (mode === 'comfyui' && !snap?.comfy && !comfyAsked) { comfyAsked = true; comfy('status'); }
  }

  window.OfficeSettings = {
    init(options) { host = { ...host, ...options }; bind(); },
    update(state) { snap = state; if (isOpen()) paint(); },
    open, artSummary, ensureArt,
  };
})();
