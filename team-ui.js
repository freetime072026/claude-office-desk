(() => {
  let team, selected = localStorage.getItem('selected-thread'), naming, selectedWorker;
  const get = selector => document.querySelector(selector);
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const names = { waiting: 'Chờ thực hiện', working: 'Đang làm', done: 'Hoàn tất', 'awaiting-decision': 'Chờ quyết định', cancelled: 'Đã dừng' };
  const phaseNames = { planning: 'Planning', triage: 'Triage', review: 'Review' };
  const taskNames = { queued: 'Chờ lượt/phụ thuộc', starting: 'Đang chuẩn bị', running: 'Đang thực hiện', finished: 'Đã trả kết quả · chưa QA', failed: 'Lỗi thực thi', blocked: 'Bị chặn', cancelled: 'Đã dừng', paused: 'Tạm dừng' };
  const MODES = [['read', 'Plan · chỉ đọc'], ['edit', 'Đọc & sửa · duyệt từng thao tác'], ['auto', 'Auto · CLI tự xét quyền'], ['bypass', 'Bypass · bỏ duyệt tệp']];
  const MODELS = [['claude-opus-5-5', 'Opus 5.5'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']];
  const COMMANDS = [['/model', 'Chọn model'], ['/status', 'Cấu hình session'], ['/role', 'Chạy/tạm dừng khối: /role <tên> start|pause'], ['/chot', 'Chốt GD, chạy tự động các bước sau'], ['/auto', 'Bật/tắt tự động: /auto on|off'], ['/mcp', 'MCP server (/mcp open để sửa)'], ['/usage', 'Usage nhận từ CLI'], ['/help', 'Trợ giúp']];
  const TAKES_ARGS = ['/role', '/auto'];
  // Thứ tự role, giới hạn vòng QA và quyền xóa đều lấy từ backend (snapshot), UI không tự tính.
  let removal = {}, qaRoundLimit, roleTypes = [], knownProfiles = [], defaultRoles = {};
  const isLead = (thread, role) => (thread.workers?.[role]?.type || role) === 'Lead Dev';
  const current = () => team?.threads.find(thread => thread.id === selected);
  // Thông báo ngắn ở dòng trạng thái được giữ vài giây, không bị paint() (chạy mỗi lần main publish) ghi đè ngay.
  let flash = { text: '', until: 0 };
  const showStatus = (text, ms = 6000) => { flash = { text, until: Date.now() + ms }; get('#status').textContent = text; };
  const showError = error => showStatus(error.message, 10000);
  const select = id => { selected = id; localStorage.setItem('selected-thread', id); closeMenus(); paint(); };
  window.office.run('role-defaults').then(value => { defaultRoles = value; });
  async function act(action, payload = {}) { try { return await window.office.run('team', { action, id: selected, ...payload }); } catch (error) { showError(error); } }
  async function ensureThread() { if (current()) return selected; const id = await act('create', { project: '' }); if (id) selected = id; return id; }

  // ---- Menu dùng chung: ⋯ header, Thủ công, menu session ở sidebar. Escape/nhấp ngoài để đóng.
  const menus = [['#more', '#more-menu'], ['#manual', '#manual-menu']];
  function closeMenus() { for (const [button, menu] of menus) { get(menu).hidden = true; get(button).setAttribute('aria-expanded', 'false'); } get('#session-menu').hidden = true; closeAccounts(); }
  for (const [button, menu] of menus) get(button).onclick = event => { event.stopPropagation(); const open = get(menu).hidden; closeMenus(); get(menu).hidden = !open; get(button).setAttribute('aria-expanded', String(open)); if (open) get(menu).querySelector('button:not([disabled])')?.focus(); };
  document.addEventListener('click', event => { if (!event.target.closest('.menu, #account-menu')) closeMenus(); });
  document.addEventListener('keydown', event => {
    const open = [...document.querySelectorAll('.menu:not([hidden]), #account-menu:not([hidden])')][0]; if (!open) return;
    if (event.key === 'Escape') { closeMenus(); return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const buttons = [...open.querySelectorAll('button:not([disabled])')]; const index = buttons.indexOf(document.activeElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) % buttons.length]?.focus(); }
  });

  // ---- Panel phải: ẩn/hiện, nhớ lựa chọn theo máy.
  const panelOpen = () => { try { return (localStorage.getItem('panel') ?? (innerWidth >= 1200 ? 'open' : 'closed')) === 'open'; } catch { return true; } };
  const applyPanel = open => { document.body.classList.toggle('panel-hidden', !open); get('#panel-toggle').setAttribute('aria-expanded', String(open)); };
  get('#panel-toggle').onclick = () => { const open = document.body.classList.contains('panel-hidden'); localStorage.setItem('panel', open ? 'open' : 'closed'); applyPanel(open); };
  applyPanel(panelOpen());

  // ---- Tài khoản ở chân sidebar.
  const accountMenu = make('div', { id: 'account-menu', hidden: true }); accountMenu.setAttribute('role', 'menu'); get('footer').append(accountMenu);
  get('#console').setAttribute('aria-haspopup', 'menu'); get('#console').setAttribute('aria-expanded', 'false');
  function closeAccounts() { accountMenu.hidden = true; get('#console').setAttribute('aria-expanded', 'false'); }
  get('#console').onclick = event => { event.stopPropagation(); const open = accountMenu.hidden; closeMenus(); accountMenu.hidden = !open; get('#console').setAttribute('aria-expanded', String(open)); if (open) accountMenu.querySelector('button')?.focus(); };
  function usageLabel(usage) {
    if (!usage) return 'Usage: CLI chưa gửi dữ liệu · xem /usage';
    const parts = [['five_hour', '5 giờ'], ['seven_day', '7 ngày']].filter(([key]) => usage[key]).map(([key, label]) => `${label}: ${Number.isFinite(usage[key].used_percentage) ? Math.round(usage[key].used_percentage) + '% đã dùng' : usage[key].status === 'rejected' ? 'đã chạm giới hạn' : usage[key].status === 'allowed_warning' ? 'gần giới hạn' : 'CLI cho phép · chưa có %'} · reset ${new Date(usage[key].resets_at * 1000).toLocaleString()}`);
    return (parts.join(' | ') || 'Usage: chưa có dữ liệu phù hợp') + ` · cập nhật ${new Date(usage.updatedAt).toLocaleTimeString()}${usage.stale ? ' (dữ liệu cũ)' : ''}`;
  }
  function paintAccounts(state) {
    knownProfiles = state.profiles;
    const profile = state.profiles.find(item => item.id === state.activeProfileId);
    get('#console').textContent = profile ? `◉ ${profile.name} ▾` : '◉ Chọn tài khoản ▾'; get('#console').title = 'Hồ sơ dùng cho phiên mới. Phiên đang chạy giữ tài khoản ban đầu.';
    get('#usage-summary').textContent = usageLabel(profile?.usage);
    accountMenu.replaceChildren(make('small', { textContent: 'HỒ SƠ TÀI KHOẢN' }));
    for (const item of state.profiles) {
      const button = make('button', { type: 'button', textContent: `${item.id === state.activeProfileId ? '✓' : '○'} ${item.name}` }); button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(item.id === state.activeProfileId));
      button.append(make('small', { textContent: usageLabel(item.usage) }));
      button.onclick = async () => { try { const auth = await window.office.run('select-profile', { id: item.id }); closeAccounts(); get('#console').focus(); if (auth?.loginStarted) await window.office.run('navigate', { page: 'index.html' }); } catch (error) { showError(error); } };
      accountMenu.append(button);
    }
    accountMenu.append(make('small', { textContent: state.profiles.length ? 'Đổi hồ sơ cho phiên mới; không đổi phiên đang chạy.' : 'Chưa có hồ sơ. Thêm tài khoản để bắt đầu.' }));
    accountMenu.append(make('button', { type: 'button', textContent: 'Xem usage chính thức (/usage)', disabled: !state.profiles.length, onclick: openUsage }));
    accountMenu.append(make('button', { type: 'button', textContent: '＋ Thêm / quản lý tài khoản & terminal', onclick: () => window.office.run('navigate', { page: 'index.html' }).catch(showError) }));
  }

  // ---- Sidebar: nhóm Pinned / dự án / không dự án / Đã lưu trữ; menu ⋯ (hoặc chuột phải) và kéo thả để chuyển dự án.
  function groupsOf() {
    const live = team.threads.filter(thread => !thread.archived);
    return [{ key: 'pinned', name: '★ Pinned', threads: live.filter(thread => thread.pinned) }, ...team.projects.map(project => ({ key: 'project:' + project.id, project: project.id, name: project.name, threads: live.filter(thread => thread.project === project.id) })), { key: 'project:', project: '', name: 'Không thuộc dự án', threads: live.filter(thread => !thread.project) }, { key: 'archived', name: '🗄 Đã lưu trữ', threads: team.threads.filter(thread => thread.archived), closed: true }];
  }
  function sidebar() {
    const query = get('#search').value.toLocaleLowerCase();
    get('#groups').replaceChildren(...groupsOf().filter(group => group.key !== 'archived' || group.threads.length).map(group => {
      const detail = make('details'); const stored = localStorage.getItem('group:' + group.name); detail.open = stored ? stored !== 'closed' : !group.closed; detail.ontoggle = () => localStorage.setItem('group:' + group.name, detail.open ? 'open' : 'closed');
      const summary = make('summary', { textContent: group.name + (group.key === 'archived' ? ` (${group.threads.length})` : '') }); detail.append(summary);
      if (group.key !== 'archived') {
        summary.ondragover = event => { if (event.dataTransfer.types.includes('text/x-thread')) { event.preventDefault(); summary.classList.add('drop'); } };
        summary.ondragleave = () => summary.classList.remove('drop');
        summary.ondrop = async event => { summary.classList.remove('drop'); const id = event.dataTransfer.getData('text/x-thread'); if (!id) return; event.preventDefault(); event.stopPropagation(); const thread = team.threads.find(item => item.id === id); if (group.key === 'pinned') { if (!thread?.pinned) await act('pin', { id }); } else await act('move', { id, project: group.project }); };
      }
      for (const thread of [...group.threads].reverse().filter(item => item.title.toLocaleLowerCase().includes(query))) {
        const row = make('div', { className: 'thread-row' + (thread.id === selected ? ' selected' : '') });
        const button = make('button', { className: 'thread', type: 'button', title: thread.title, draggable: true }); button.append(make('span', { className: 'thread-title', textContent: thread.title }), make('small', { textContent: thread.flow.length ? `${thread.flow[thread.stage] || ''} · ${names[thread.status]}` : 'Claude Code' }));
        button.onclick = () => select(thread.id);
        button.ondragstart = event => { event.dataTransfer.setData('text/x-thread', thread.id); event.dataTransfer.effectAllowed = 'move'; };
        const more = make('button', { className: 'thread-more', type: 'button', textContent: '⋯', title: 'Thao tác session' }); more.setAttribute('aria-haspopup', 'menu');
        more.onclick = event => { event.stopPropagation(); openSessionMenu(thread, more.getBoundingClientRect()); };
        row.oncontextmenu = event => { event.preventDefault(); openSessionMenu(thread, { left: event.clientX, bottom: event.clientY, right: event.clientX }); };
        row.append(button, more); detail.append(row);
      }
      return detail;
    }));
  }
  function openSessionMenu(thread, anchor) {
    closeMenus(); const menu = get('#session-menu'); menu.replaceChildren();
    const item = (text, onclick, options = {}) => { const button = make('button', { type: 'button', textContent: text, ...options }); button.setAttribute('role', 'menuitem'); button.onclick = async () => { closeMenus(); await onclick(); }; menu.append(button); return button; };
    item('Mở session', () => select(thread.id));
    if (thread.archived) {
      item('↩ Khôi phục', () => act('archive', { id: thread.id, archived: false }));
      item('🗑 Xoá hẳn…', () => deleteThread(thread), { className: 'danger' });
    } else {
      item(thread.pinned ? '★ Bỏ ghim' : '☆ Ghim', () => act('pin', { id: thread.id }));
      menu.append(make('small', { textContent: 'Chuyển tới dự án' }));
      for (const project of [{ id: '', name: 'Không thuộc dự án' }, ...team.projects]) item((thread.project === project.id ? '✓ ' : '　') + project.name, () => act('move', { id: thread.id, project: project.id }), { disabled: thread.project === project.id });
      item('🗄 Lưu trữ', () => act('archive', { id: thread.id }));
    }
    menu.hidden = false;
    const width = menu.offsetWidth, height = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(anchor.left, innerWidth - width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(anchor.bottom + 4, innerHeight - height - 8)) + 'px';
    menu.querySelector('button')?.focus();
  }
  async function deleteThread(thread) {
    if (!confirm(`Xoá hẳn session "${thread.title}"?\nLịch sử hội thoại và ảnh đính kèm trong app sẽ bị xoá, không khôi phục được. Lịch sử CLI của Claude Code không bị đụng tới.`)) return;
    if (await act('delete', { id: thread.id }) && selected === thread.id) { selected = undefined; localStorage.removeItem('selected-thread'); }
  }

  // ---- Header và menu ⋯.
  function options(target, value = '') { target.replaceChildren(...[{ id: '', name: 'Không thuộc dự án' }, ...team.projects].map(project => make('option', { value: project.id, textContent: project.name }))); target.value = value; }
  get('#pin').onclick = () => { closeMenus(); act('pin'); };
  get('#move').onchange = () => act('move', { project: get('#move').value });
  get('#archive').onclick = () => { closeMenus(); act('archive'); };
  get('#restore').onclick = () => act('archive', { archived: false });
  get('#retry-blocked').onclick = async () => { closeMenus(); try { await window.office.run('dispatch-retry', { id: selected }); } catch (error) { showError(error); } };
  get('#folders').onclick = async () => { try { await ensureThread(); await window.office.run('thread-folder', { id: selected }); } catch (error) { showError(error); } };
  get('#edit-request').onclick = () => { closeMenus(); const thread = current(); if (!thread) return; openNaming('edit-request', 'Chỉnh sửa yêu cầu session', thread.messages.find(message => message.role === 'Bạn')?.text || ''); };
  get('#project').onclick = () => openNaming('project', 'Tên dự án mới');
  function openNaming(kind, label, request) {
    naming = kind; get('#name-label').textContent = label;
    const editing = kind === 'edit-request'; get('#new-name').hidden = editing; get('#new-name').required = !editing; get('#new-name').maxLength = 80; get('#request-editor').hidden = !editing; if (editing) get('#request-editor').value = request;
    get('#naming').showModal();
  }
  get('#cancel-name').onclick = () => get('#naming').close();
  get('#name-form').onsubmit = async event => {
    event.preventDefault(); const payload = naming === 'edit-request' ? { text: get('#request-editor').value } : { name: get('#new-name').value };
    if (naming === 'edit-request' && (current().stage > 0 || current().status !== 'waiting')) { if (!confirm('Thay đổi này bắt đầu lại quy trình và yêu cầu kiểm tra lại kết quả. Tiếp tục?')) return; payload.restart = true; }
    if (await act(naming, payload)) { get('#naming').close(); get('#name-form').reset(); }
  };
  for (const button of get('#decision-banner').querySelectorAll('button')) button.onclick = () => act('decision', { choice: button.dataset.choice });

  // ---- Token theo session/role (US-01). addUsage là chỗ cộng duy nhất.
  const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'costUsd', 'turns'];
  const addUsage = (total, usage) => { for (const key of USAGE_FIELDS) total[key] = (total[key] || 0) + (Number(usage?.[key]) || 0); return total; };
  function usageByRole(messages) { const roles = new Map(); for (const message of messages) if (message.usage) { if (!roles.has(message.role)) roles.set(message.role, addUsage({}, null)); addUsage(roles.get(message.role), message.usage); } return roles; }
  const tokens = value => Math.round(value).toLocaleString();
  const usageText = usage => `vào ${tokens(usage.input)} (cache ${tokens(usage.cacheRead + usage.cacheWrite)}) · ra ${tokens(usage.output)} · $${usage.costUsd.toFixed(4)}`;
  const usageDetail = usage => `input ${tokens(usage.input)} · cache đọc ${tokens(usage.cacheRead)} · cache ghi ${tokens(usage.cacheWrite)} · output ${tokens(usage.output)} · ${usage.turns} turn`;
  function paintSessionUsage(thread) {
    const node = get('#usage-tokens'), roles = usageByRole(thread?.messages || []); node.hidden = !roles.size; if (!roles.size) { node.textContent = ''; return; }
    const total = [...roles.values()].reduce(addUsage, addUsage({}, null));
    node.textContent = 'Token session: ' + usageText(total) + ' | ' + [...roles].map(([role, usage]) => role + ': ' + usageText(usage)).join(' | ');
    node.title = [...roles].map(([role, usage]) => role + ': ' + usageDetail(usage)).join('\n');
  }

  // ---- Tiến độ lượt chạy.
  function elapsed(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)), minutes = Math.floor(seconds / 60); return minutes ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`; }
  function progressText(message) {
    const progress = message.progress; if (!progress?.startedAt) return '';
    const steps = progress.steps ? ` · ${progress.steps} bước` : '';
    if (!message.streaming) return progress.finishedAt ? `✓ Xong sau ${elapsed(Date.parse(progress.finishedAt) - Date.parse(progress.startedAt))}${steps}` : '';
    if (progress.waiting) return `⏸ ${elapsed(Date.now() - Date.parse(progress.startedAt))} · chờ bạn duyệt ${progress.waiting}${steps}`;
    const doing = progress.lastTool ? progress.lastTool + (progress.target ? ' ' + progress.target : '') : message.text ? 'đang viết trả lời' : 'đang suy nghĩ';
    return `● ${elapsed(Date.now() - Date.parse(progress.startedAt))} · ${doing}${steps}`;
  }
  const runningOf = (thread, role) => thread.messages.findLast(message => message.role === role && message.streaming);

  // ---- Sơ đồ khối. Bấm khối để chọn và xem/cấu hình ở panel phải.
  function blockLabel(thread, role, index) {
    const task = thread.dispatch?.find(item => item.worker === role); let text;
    if (runningOf(thread, role)) text = '● Đang thực hiện';
    else if (thread.workers?.[role]?.paused) text = '⏸ Tạm dừng';
    else if (task) text = taskNames[task.status] || task.status;
    else if (index < thread.stage || thread.status === 'done') text = ['Dev', 'VFX'].includes(thread.workers?.[role]?.type) && thread.flow[thread.stage] === 'QA' ? '✓ Đã làm · chờ QA' : '✓ Đã bàn giao';
    else text = index === thread.stage ? names[thread.status] : 'Chưa đến bước';
    if (isLead(thread, role) && qaRoundLimit) text += ` · ${phaseNames[thread.leadPhase] || phaseNames.planning} · QA ${thread.qaFailRounds || 0}/${qaRoundLimit}`;
    return text;
  }
  function paintFlow(thread) {
    const flow = get('#flow'); flow.replaceChildren();
    thread.flow.forEach((role, index) => {
      if (index) flow.append(make('span', { className: 'arrow', textContent: '→' }));
      const block = make('div', { className: 'block' + (index < thread.stage || thread.status === 'done' ? ' finished' : index === thread.stage ? ' current' : '') + (role === selectedWorker ? ' selected' : ''), tabIndex: 0 });
      block.setAttribute('role', 'button'); block.setAttribute('aria-pressed', String(role === selectedWorker));
      const task = thread.dispatch?.find(item => item.worker === role); block.title = task?.error || task?.task || role;
      block.append(make('b', { textContent: role }), make('small', { textContent: blockLabel(thread, role, index) }));
      const running = runningOf(thread, role); if (running) block.append(make('em', { className: 'block-progress', textContent: progressText(running) }));
      block.onclick = () => chooseWorker(role); block.onkeydown = event => { if (event.target === block && ['Enter', ' '].includes(event.key)) { event.preventDefault(); chooseWorker(role); } };
      const check = removal[thread.id]?.[role], title = check?.ok ? `Xóa ${role} (${check.reason})` : check?.reason || 'Không xóa được';
      const remove = make('button', { className: 'remove-role', type: 'button', textContent: '×', disabled: !check?.ok || thread.archived, title }); remove.setAttribute('aria-label', title);
      remove.onclick = async event => { event.stopPropagation(); if (confirm('Xóa ' + role + '? Cấu hình riêng và phiên chat của khối này sẽ bị xóa.')) await act('remove-role', { role }); };
      block.append(remove); flow.append(block);
    });
  }
  function chooseWorker(role) { selectedWorker = role; panelKey = ''; if (document.body.classList.contains('panel-hidden')) applyPanel(true); paint(); }
  function paintDispatch(thread) {
    const tasks = thread.dispatch || [], count = status => tasks.filter(task => task.status === status).length;
    const parts = [thread.auto?.enabled ? '⚙ Tự động: bật' : 'Tự động: tắt (/chot hoặc /auto on)'];
    if (tasks.length) { parts.push(`Dev ${count('finished')}/${tasks.length} đã xong`); for (const [status, title] of [['running', 'đang chạy'], ['queued', 'chờ'], ['paused', 'tạm dừng'], ['blocked', 'bị chặn'], ['failed', 'lỗi']]) if (count(status)) parts.push(`${count(status)} ${title}`); }
    get('#dispatch-summary').hidden = !thread.flow.length; get('#dispatch-summary').textContent = parts.join(' · ');
  }

  // ---- Panel khối đang chọn. Chỉ ghi đè ô không đang được sửa để publish (stream) không xoá chữ đang gõ.
  for (const [value, title] of MODES) get('#chat-mode').append(make('option', { value, textContent: title }));
  for (const [value, title] of MODELS) get('#chat-model').append(make('option', { value, textContent: title }));
  let panelKey = '';
  const setField = (field, value, force) => { if (force || document.activeElement !== field) field.value = value; };
  const roleType = (thread, role) => thread.workers?.[role]?.type || role.replace(/ #\d+$/, '');
  function paintPanel(thread) {
    const role = thread?.flow.includes(selectedWorker) ? selectedWorker : '', key = (thread?.id || '') + ':' + role, force = key !== panelKey; panelKey = key;
    const config = role ? thread.workers?.[role] || {} : {};
    get('#panel-title').textContent = role || 'Chat thường';
    const running = role ? runningOf(thread, role) : thread?.messages.findLast(message => message.role === 'Claude' && message.streaming);
    get('#panel-state').textContent = !thread ? 'Chưa có session' : running ? progressText(running) : role ? blockLabel(thread, role, thread.flow.indexOf(role)) : 'Không role · chạy Claude Code thường';
    for (const id of ['#account-field', '#task-field', '#role-texts']) get(id).hidden = !role;
    paintSessionFiles(thread, role);
    for (const field of document.querySelectorAll('#panel select, #panel textarea')) field.disabled = !thread || thread.archived;
    setField(get('#chat-mode'), config.mode || thread?.mode || 'read', force); setField(get('#chat-model'), config.model || thread?.model || 'claude-opus-5-5', force);
    if (force) get('#panel-saved').textContent = '';
    if (!role) return;
    const account = get('#worker-account'); if (force || document.activeElement !== account) { account.replaceChildren(...[{ id: '', name: 'Theo tài khoản đang chọn' }, ...knownProfiles].map(profile => make('option', { value: profile.id, textContent: profile.name }))); account.value = config.profileId || ''; }
    setField(get('#worker-task'), config.task || '', force);
    const type = roleType(thread, role), base = team.roleTemplates?.[type] || defaultRoles[type] || {};
    setField(get('#role-responsibility'), base.responsibility || '', force); setField(get('#role-output'), base.output || '', force); setField(get('#role-instructions'), thread.roleConfig?.[type]?.instructions || '', force);
  }
  // Tệp .md của session (session-files.cjs) mở bằng trình xem tệp; tệp chỉ có sau lượt chạy role đầu tiên.
  const SESSION_FILES = [['GDD.md', 'GDD'], ['TASKS.md', 'Tasks'], ['ISSUES.md', 'Issues'], ['PERF.md', 'Perf'], ['CHANGES.md', 'Changes']];
  function paintSessionFiles(thread, role) {
    const files = role ? thread.workers?.[role]?.files || [] : [];
    get('#worker-files').hidden = !files.length; get('#worker-files').textContent = 'Tệp được sửa: ' + files.join(', ');
    const box = get('#session-files'); box.hidden = !thread?.flow.length || !thread.folder; if (box.hidden) return;
    const base = thread.folder.replace(/[\\/]+$/, '') + '\\.office-desk\\';
    const links = [['PROJECT.md', 'Project', base + 'PROJECT.md'], ...SESSION_FILES.map(([name, title]) => [name, title, base + thread.id + '\\' + name])];
    const key = links.map(link => link[2]).join('|'); if (box.dataset.key === key) return; box.dataset.key = key;
    box.querySelector('.file-links').replaceChildren(...links.map(([name, title, file]) => make('button', { type: 'button', textContent: title, title: file, onclick: () => window.openChatFile(file) })));
  }
  async function saveWorker() {
    const thread = current(); if (!thread) return; const saved = get('#panel-saved');
    if (!thread.flow.includes(selectedWorker)) { if (await act('chat-options', { mode: get('#chat-mode').value, model: get('#chat-model').value })) saved.textContent = '✓ Đã lưu'; return; }
    const result = await act('worker-config', { role: selectedWorker, mode: get('#chat-mode').value, model: get('#chat-model').value, profileId: get('#worker-account').value, task: get('#worker-task').value });
    if (result?.loginStarted) { await window.office.run('navigate', { page: 'index.html' }); return; } if (result) saved.textContent = '✓ Đã lưu cấu hình riêng của khối';
  }
  for (const id of ['#chat-mode', '#chat-model', '#worker-account', '#worker-task']) get(id).onchange = saveWorker;
  async function saveRoleTexts() {
    const thread = current(); if (!thread?.flow.includes(selectedWorker)) return;
    try { await window.office.run('team', { action: 'role-config', id: selected, role: roleType(thread, selectedWorker), responsibility: get('#role-responsibility').value, output: get('#role-output').value, instructions: get('#role-instructions').value, saveDefault: true }); get('#panel-saved').textContent = '✓ Đã lưu'; } catch (error) { get('#panel-saved').textContent = error.message; }
  }
  for (const id of ['#role-responsibility', '#role-output', '#role-instructions']) get(id).onchange = saveRoleTexts;

  // ---- Hội thoại render theo khóa tin nhắn: chỉ dựng lại thẻ có nội dung đổi, giữ vị trí cuộn và vùng chữ đang bôi đen.
  const cardCache = new Map(); let cachedThread;
  const messageKey = (message, index) => message.id || `${index}:${message.time}:${message.role}`;
  const profileName = id => knownProfiles.find(profile => profile.id === id)?.name || 'Hồ sơ';
  const signature = message => [message.text, message.streaming, message.error, (message.tools || []).join(','), message.profileId, message.model, message.profileId ? profileName(message.profileId) : '', JSON.stringify(message.usage || null), (message.denied || []).join(','), message.progress?.waiting || ''].join('\u0000');
  function updateProgress(card, message) { const node = card.querySelector('.run-progress'); if (node) node.textContent = progressText(message); }
  function buildCard(message) {
    const card = make('article'), header = make('header');
    header.append(make('b', { textContent: message.profileId ? `${message.role} · ${profileName(message.profileId)} · ${message.model || ''}` : message.role }), make('time', { textContent: new Date(message.time).toLocaleString() }));
    card.append(header, window.renderChatText ? window.renderChatText(message.text) : make('p', { textContent: message.text }));
    if (message.attachments?.length) { const row = make('div', { className: 'message-images' }); row.append(...message.attachments.map(image => thumbnail(image))); card.append(row); }
    if (message.progress) { const progress = make('small', { className: 'run-progress' }); progress.setAttribute('aria-live', 'polite'); card.append(progress); updateProgress(card, message); }
    if (message.streaming) card.classList.add('streaming'); if (message.error) card.classList.add('chat-error');
    if (message.tools?.length) card.append(make('small', { textContent: 'Công cụ: ' + message.tools.join(', ') }));
    if (message.denied?.length) card.append(make('small', { className: 'run-denied', textContent: 'Bạn đã từ chối: ' + message.denied.join(', ') }));
    if (message.usage) { const usage = addUsage({}, message.usage); card.append(make('small', { className: 'run-usage', textContent: 'Token: ' + usageText(usage), title: usageDetail(usage) })); }
    return card;
  }
  function renderActivity(thread) {
    const activity = get('#activity'), switched = cachedThread !== thread.id;
    const atBottom = activity.scrollHeight - activity.scrollTop - activity.clientHeight < 80, top = activity.scrollTop;
    if (switched) { cardCache.clear(); cachedThread = thread.id; }
    const used = new Set();
    const cards = thread.messages.map((message, index) => {
      const key = messageKey(message, index), sig = signature(message), hit = cardCache.get(key); used.add(key);
      if (hit && hit.sig === sig) { updateProgress(hit.card, message); return hit.card; }
      const card = buildCard(message); cardCache.set(key, { sig, card }); return card;
    });
    for (const key of [...cardCache.keys()]) if (!used.has(key)) cardCache.delete(key);
    // Chỉ thay phần đuôi khác nhau; các thẻ cũ không bị gỡ khỏi DOM.
    const children = [...activity.children]; let same = 0; while (same < cards.length && children[same] === cards[same]) same++;
    for (const child of children.slice(same)) child.remove(); activity.append(...cards.slice(same));
    activity.scrollTop = switched || atBottom ? activity.scrollHeight : top;
  }
  setInterval(() => {
    const thread = current(); if (!thread) return;
    thread.messages.forEach((message, index) => { if (message.streaming) { const hit = cardCache.get(messageKey(message, index)); if (hit) updateProgress(hit.card, message); } });
    get('#flow').querySelectorAll('.block').forEach((block, index) => { const running = runningOf(thread, thread.flow[index]), node = block.querySelector('.block-progress'); if (node && running) node.textContent = progressText(running); });
    const running = selectedWorker ? runningOf(thread, selectedWorker) : null; if (running) get('#panel-state').textContent = progressText(running);
  }, 1000);

  // ---- Vẽ toàn bộ theo trạng thái hiện tại.
  function paint() {
    sidebar(); const thread = current();
    get('#title').textContent = thread?.title || 'Không gian phát triển game'; get('#title').title = thread?.title || '';
    options(get('#move'), thread?.project || ''); get('#pin').textContent = thread?.pinned ? '★ Bỏ ghim' : '☆ Ghim';
    for (const id of ['#pin', '#move', '#edit-request', '#retry-blocked', '#archive', '#more']) get(id).disabled = !thread;
    get('#archived-banner').hidden = !thread?.archived;
    for (const id of ['#pin', '#move', '#edit-request', '#retry-blocked', '#archive', '#role', '#folders']) if (thread?.archived) get(id).disabled = true;
    paintSessionUsage(thread);
    get('#issues').replaceChildren(); get('#attachments').replaceChildren(); get('#folder-list').replaceChildren();
    get('#decision-banner').hidden = thread?.status !== 'awaiting-decision';
    get('#decision-text').textContent = `QA fail ${thread?.qaFailRounds || 0}/${qaRoundLimit} vòng. Chọn cách xử lý:`;
    if (!thread) { paintPanel(thread); get('#flow').replaceChildren(); get('#dispatch-summary').hidden = true; get('#manual').hidden = true; get('#role').disabled = false; get('#folders').disabled = false; return; }
    if (!thread.archived) { get('#role').disabled = false; get('#folders').disabled = false; }
    if (selectedWorker && !thread.flow.includes(selectedWorker)) selectedWorker = undefined;
    if (!selectedWorker) selectedWorker = thread.flow[thread.stage] || thread.flow[0];
    paintFlow(thread); paintDispatch(thread); paintPanel(thread); renderActivity(thread);
    const folders = [thread.folder, ...(thread.relatedFolders || [])].filter(Boolean);
    get('#folders').textContent = `📁 Thư mục${folders.length ? ' (' + folders.length + ')' : ''}`;
    get('#folder-list').replaceChildren(...folders.map((folder, index) => { const chip = make('span', { className: 'image-chip', textContent: `${index === 0 ? 'Chính' : 'Liên quan'}: ${folder} `, title: folder }); const remove = make('button', { type: 'button', textContent: '×', title: 'Bỏ thư mục khỏi session (không xóa trên đĩa)', disabled: thread.archived }); remove.onclick = async () => { try { await window.office.run('remove-folder', { id: selected, folder }); } catch (error) { showError(error); } }; chip.append(remove); return chip; }));
    for (const image of thread.attachments || []) get('#attachments').append(thumbnail(image, thread.archived ? null : async () => { try { await window.office.run('remove-attachment', { id: selected, path: image.path }); } catch (error) { showError(error); } }));
    for (const issue of thread.issues) { const row = make('div', { className: 'issue' }); row.append(make('span', { textContent: `${issue.closed ? '✓ Đã retest' : '● Mở'} · ${issue.text}` })); if (!issue.closed) row.append(make('button', { type: 'button', textContent: 'Xác nhận retest', onclick: async () => { if (await act('retest', { issue: issue.id, text: get('#message').value })) get('#message').value = ''; } })); get('#issues').append(row); }
    const roles = thread.flow.length > 0; get('#manual').hidden = !roles || thread.archived;
    get('#begin').disabled = thread.status !== 'waiting'; get('#handoff').disabled = thread.status !== 'working'; get('#issue').disabled = ['done', 'awaiting-decision', 'cancelled'].includes(thread.status);
    get('#review-reject').hidden = !isLead(thread, thread.flow[thread.stage]) || thread.leadPhase !== 'review' || thread.status !== 'working';
    get('#run-role').hidden = !roles; get('#run-role').textContent = selectedWorker ? 'Chạy ' + selectedWorker : 'Chạy';
    for (const id of ['#run-role', '#stop', '#message']) get(id).disabled = thread.archived;
    get('#composer button.primary').disabled = thread.archived;
    get('#status').textContent = Date.now() < flash.until ? flash.text : (selectedWorker || 'Chat thường') + (runningOf(thread, selectedWorker || 'Claude') ? ' · Đang chạy' : ' · Sẵn sàng');
    if (!get('#message').value && localStorage.getItem('draft:' + selected)) get('#message').value = localStorage.getItem('draft:' + selected);
  }

  // ---- Thêm role.
  get('#role').onclick = async () => {
    if (!current()) { if (!(await ensureThread())) return; team = (await window.office.run('state')).team; paint(); }
    const thread = current(), hasLead = thread.flow.some(label => isLead(thread, label));
    get('#add-role-choices').replaceChildren(...roleTypes.filter(type => type !== 'Lead Dev' || !hasLead).map(role => make('button', { type: 'button', textContent: '+ ' + role, onclick: async () => { const added = await act('add-worker', { type: role }); if (added) { selectedWorker = added; panelKey = ''; get('#add-role-dialog').close(); paint(); } } })));
    get('#add-role-dialog').showModal();
  };
  get('#add-role-cancel').onclick = () => get('#add-role-dialog').close();

  // ---- Ô soạn: lệnh, gợi ý, thủ công, chạy/dừng/gửi.
  get('#commands').append(make('option', { value: '', textContent: '/ Lệnh' }), ...['/chot', '/auto on', '/auto off', '/mcp', '/model', '/status', '/usage', '/help'].map(value => make('option', { value, textContent: value })));
  get('#commands').onchange = () => { const value = get('#commands').value; if (value) { get('#message').value = value; get('#message').focus(); get('#commands').value = ''; } };
  const suggestions = get('#command-suggestions'); let suggestionIndex = 0;
  function suggest() {
    const value = get('#message').value; const matching = value.startsWith('/') && !/\s/.test(value) ? COMMANDS.filter(([command]) => command.startsWith(value)) : [];
    suggestions.hidden = !matching.length; suggestionIndex = 0;
    suggestions.replaceChildren(...matching.map(([command, title]) => make('button', { type: 'button', textContent: command + ' — ' + title, onclick: () => { get('#message').value = command + (TAKES_ARGS.includes(command) ? ' ' : ''); suggestions.hidden = true; get('#message').focus(); } })));
    suggestions.firstElementChild?.classList.add('active');
  }
  get('#message').addEventListener('input', suggest);
  get('#message').addEventListener('keydown', event => {
    if (suggestions.hidden) return; const buttons = [...suggestions.querySelectorAll('button')];
    if (event.key === 'Escape') { suggestions.hidden = true; return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length; buttons.forEach((button, index) => button.classList.toggle('active', index === suggestionIndex)); }
    if (event.key === 'Tab' || event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); buttons[suggestionIndex]?.click(); }
  });
  get('#message').addEventListener('keydown', event => { if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.defaultPrevented) return; event.preventDefault(); if (get('#message').value.trim()) get('#composer').requestSubmit(); });
  const manualText = async action => { closeMenus(); if (await act(action, { text: get('#message').value })) get('#message').value = ''; };
  get('#begin').onclick = () => { closeMenus(); act('start'); };
  get('#handoff').onclick = () => manualText('handoff'); get('#issue').onclick = () => manualText('issue'); get('#review-reject').onclick = () => manualText('review-reject');
  get('#stop').onclick = () => window.office.run('chat-stop', { id: selected, role: selectedWorker }).catch(showError);
  async function sendChat(role) {
    if (get('#message').value.trim() === '/usage') { get('#message').value = ''; await openUsage(); return; }
    if (!(await ensureThread())) return; role ||= selectedWorker;
    try {
      const result = await window.office.run('chat-send', { id: selected, role, text: get('#message').value.trim() || (role ? 'Thực hiện nhiệm vụ theo yêu cầu session.' : '') });
      if (result?.loginStarted) { localStorage.setItem('draft:' + selected, get('#message').value); await window.office.run('navigate', { page: 'index.html' }); return; }
      if (result) { localStorage.removeItem('draft:' + selected); get('#message').value = ''; }
    } catch (error) { showError(error); }
  }
  get('#composer').onsubmit = event => { event.preventDefault(); sendChat(); };
  get('#run-role').onclick = () => sendChat(selectedWorker || current()?.flow[current().stage]);

  // ---- Ảnh tham chiếu cho tin đang soạn: dán (Ctrl+V) vào ô chat hoặc kéo thả vào cửa sổ.
  // Kéo session trong sidebar không có 'Files' nên không bị coi là ảnh.
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  async function attachImages(files) {
    const images = files.filter(file => IMAGE_TYPES.includes(file.type)), skipped = files.length - images.length;
    if (!images.length) { if (skipped) showStatus('Chỉ nhận ảnh PNG, JPEG, WebP hoặc GIF'); return; }
    try { if (!(await ensureThread())) return; for (const file of images) await window.office.attach(selected, file); showStatus(`Đã đính kèm ${images.length} ảnh` + (skipped ? `, bỏ qua ${skipped} tệp không phải ảnh` : '')); }
    catch (error) { showError(error); }
  }
  get('#message').addEventListener('paste', event => {
    const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    // Clipboard chỉ có ảnh thì không dán gì vào ô chữ; có cả chữ (vd. copy từ Word) thì vẫn dán chữ.
    if (!event.clipboardData.types.includes('text/plain')) event.preventDefault();
    attachImages(files);
  });
  let dragDepth = 0;
  const dragging = on => get('#composer').classList.toggle('drop-target', on);
  document.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { dragDepth++; dragging(true); } });
  document.addEventListener('dragleave', event => { if (event.dataTransfer.types.includes('Files') && --dragDepth <= 0) { dragDepth = 0; dragging(false); } });
  document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
  document.addEventListener('drop', event => {
    dragDepth = 0; dragging(false);
    if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault();
    attachImages([...event.dataTransfer.files]);
  });
  // Thumbnail: main đọc ảnh trong thư mục attachments của app và trả data URL; nhớ lại để không đọc lại mỗi lần vẽ.
  const previews = new Map();
  const previewOf = file => { if (!previews.has(file)) previews.set(file, window.office.run('attachment-preview', { path: file }).catch(() => '')); return previews.get(file); };
  function thumbnail(image, onRemove) {
    const chip = make('span', { className: 'image-thumb', title: image.name }), picture = make('img', { alt: image.name });
    previewOf(image.path).then(url => { if (url) picture.src = url; else chip.classList.add('missing'); });
    picture.onclick = () => openImage(image); chip.append(picture);
    if (onRemove) { const remove = make('button', { type: 'button', textContent: '×', title: 'Bỏ ảnh khỏi tin đang soạn' }); remove.setAttribute('aria-label', 'Bỏ ảnh ' + image.name); remove.onclick = onRemove; chip.append(remove); }
    return chip;
  }
  async function openImage(image) { const url = await previewOf(image.path); if (!url) return; get('#image-view').src = url; get('#image-title').textContent = image.name; get('#image-viewer').showModal(); }
  get('#image-close').onclick = () => get('#image-viewer').close();

  // ---- Xem tệp được nhắc trong chat.
  get('#file-copy').onclick = () => window.office.run('copy-text', { text: get('#file-text').textContent });
  get('#file-close').onclick = () => get('#file-viewer').close();
  window.openChatFile = async reference => { try { const file = await window.office.run('file-read', { id: selected, path: reference }); get('#file-title').textContent = file.path; get('#file-text').textContent = file.content; get('#file-viewer').showModal(); } catch (error) { showError(error); } };

  // ---- /usage: terminal CLI chính thức trong dialog.
  let usageId, usageTerm;
  async function openUsage() {
    closeMenus();
    try {
      if (usageId) { get('#usage-viewer').showModal(); return; }
      usageId = await window.office.run('usage-open', { id: selected, role: selectedWorker });
      get('#usage-viewer').showModal(); usageTerm = new Terminal({ fontSize: 13, cols: 90, rows: 25, theme: { background: '#10131a', foreground: '#e6e7ed' } }); const fit = new FitAddon.FitAddon(); usageTerm.loadAddon(fit); usageTerm.open(get('#usage-terminal')); fit.fit();
      const buffer = await window.office.run('buffer', { id: usageId }); usageTerm.write(buffer.data); usageTerm.onData(data => window.office.run('input', { id: usageId, data })); await window.office.run('resize', { id: usageId, cols: usageTerm.cols, rows: usageTerm.rows }); usageTerm.focus();
    } catch (error) { usageId = undefined; showError(error); }
  }
  window.office.onTerminal(chunk => { if (chunk.id === usageId && usageTerm) usageTerm.write(chunk.data); });
  get('#usage-close').onclick = () => get('#usage-viewer').close();
  get('#usage-viewer').addEventListener('close', () => { if (usageId) window.office.run('close', { id: usageId }).catch(() => {}); usageId = undefined; usageTerm?.dispose(); usageTerm = undefined; get('#usage-terminal').replaceChildren(); });

  // ---- Trạng thái từ main.
  const applyState = state => { paintAccounts(state); removal = state.removal || {}; qaRoundLimit = state.qaRoundLimit; roleTypes = state.pipeline || []; team = state.team; if (team && (!selected || !current())) selected = team.threads.filter(thread => !thread.archived).at(-1)?.id || team.threads.at(-1)?.id; if (team) paint(); };
  window.office.onState(applyState);
  get('#search').oninput = sidebar;
  get('#new-thread').onclick = async () => { const id = await act('create', { project: current()?.archived ? '' : current()?.project || '' }); if (id) { select(id); get('#message').focus(); } };
  window.office.run('state').then(applyState);
})();
