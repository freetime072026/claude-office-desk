(() => {
  let team, selected = localStorage.getItem('selected-thread'), naming;
  const get = selector => document.querySelector(selector);
  const names = { waiting: 'Chờ thực hiện', working: 'Đang làm', done: 'Hoàn tất', 'awaiting-decision': 'Chờ quyết định', cancelled: 'Đã dừng' };
  const phaseNames = { planning: 'Planning', triage: 'Triage', review: 'Review' };
  // Thứ tự role, giới hạn vòng QA và quyền xóa đều lấy từ backend (snapshot), UI không tự tính.
  let removal = {}, qaRoundLimit, roleTypes = [];
  const isLead = (thread, role) => (thread.workers?.[role]?.type || role) === 'Lead Dev';
  const applyState = state => { removal = state.removal || {}; qaRoundLimit = state.qaRoundLimit; roleTypes = state.pipeline || []; };
  const current = () => team?.threads.find(thread => thread.id === selected);
  let defaultRoles = {};
  let knownProfiles = [], selectedWorker;
  window.office.run('role-defaults').then(value => { defaultRoles = value; });
  const editRequest = document.createElement('button'); editRequest.textContent = 'Sửa yêu cầu'; editRequest.onclick = () => { const thread = current(); if (!thread) return; naming = 'edit-request'; get('#new-name').hidden = true; get('#new-name').required = false; roleChoices.hidden = true; requestEditor.hidden = false; requestEditor.value = thread.messages.find(message => message.role === 'Bạn')?.text || ''; get('#name-label').textContent = 'Chỉnh sửa yêu cầu session'; get('#naming').showModal(); }; get('.actions').append(editRequest);
  const commands = document.createElement('select'); commands.setAttribute('aria-label', 'Lệnh Claude Code');
  for (const value of ['', '/chot', '/auto on', '/auto off', '/mcp', '/model', '/status', '/usage', '/help']) { const option = document.createElement('option'); option.value = value; option.textContent = value || '/ Lệnh'; commands.append(option); }
  commands.onchange = () => { if (commands.value) { get('#message').value = commands.value; get('#message').focus(); commands.value = ''; } }; get('#composer > div:last-child').prepend(commands);
  const runRole = document.createElement('button'); runRole.type = 'button'; runRole.textContent = 'Chạy role trong CLI'; get('#handoff').before(runRole);
  runRole.onclick = async () => { const thread = current(); if (!thread?.flow.length) return; try { await window.office.run('run-thread', { id: selected, role: thread.flow[thread.stage], text: get('#message').value.trim() || 'Thực hiện vai trò theo yêu cầu session. Báo rõ kết quả và việc chưa kiểm chứng.' }); await window.office.run('navigate', { page: 'index.html' }); } catch (error) { get('#status').textContent = error.message; } };
  const folderButton = document.createElement('button'); folderButton.textContent = '📁 Thêm thư mục'; folderButton.type = 'button'; get('.actions').prepend(folderButton);
  const folderList = document.createElement('div'); folderList.id = 'folder-list'; get('#composer').prepend(folderList);
  function usageLabel(usage) {
    if (!usage) return 'Usage: CLI chưa gửi dữ liệu · xem /usage';
    const parts = [['five_hour', '5 giờ'], ['seven_day', '7 ngày']].filter(([key]) => usage[key]).map(([key, label]) => `${label}: ${Number.isFinite(usage[key].used_percentage) ? Math.round(usage[key].used_percentage) + '% đã dùng' : usage[key].status === 'rejected' ? 'đã chạm giới hạn' : usage[key].status === 'allowed_warning' ? 'gần giới hạn' : 'CLI cho phép · chưa có %'} · reset ${new Date(usage[key].resets_at * 1000).toLocaleString()}`);
    return (parts.join(' | ') || 'Usage: chưa có dữ liệu phù hợp') + ` · cập nhật ${new Date(usage.updatedAt).toLocaleTimeString()}${usage.stale ? ' (dữ liệu cũ)' : ''}`;
  }
  const usageSummary = document.createElement('small'); usageSummary.id = 'usage-summary'; get('#console').after(usageSummary);
  folderButton.onclick = async () => { try { await window.office.run('thread-folder', { id: selected }); } catch (error) { get('#status').textContent = error.message; } };
  const attached = document.createElement('div'); attached.id = 'attachments'; get('#composer').prepend(attached);
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', async event => {
    event.preventDefault();
    try {
      if (!current()) selected = await act('create', { project: '' });
      for (const file of event.dataTransfer.files) await window.office.attach(selected, file);
    } catch (error) { get('#status').textContent = error.message; }
  });
  const accountMenu = document.createElement('div');
  accountMenu.id = 'account-menu'; accountMenu.hidden = true; accountMenu.setAttribute('role', 'menu');
  get('#console').parentElement.append(accountMenu);
  get('#console').setAttribute('aria-haspopup', 'menu'); get('#console').setAttribute('aria-expanded', 'false');
  function closeAccounts() { accountMenu.hidden = true; get('#console').setAttribute('aria-expanded', 'false'); }
  function paintAccounts(state) {
    knownProfiles = state.profiles;
    const profile = state.profiles.find(item => item.id === state.activeProfileId);
    get('#console').textContent = profile ? `◉ ${profile.name} ▾` : '◉ Chọn tài khoản ▾';
    usageSummary.textContent = usageLabel(profile?.usage);
    get('#console').title = 'Hồ sơ dùng cho phiên mới. Phiên đang chạy giữ tài khoản ban đầu.';
    accountMenu.replaceChildren();
    const heading = document.createElement('small'); heading.textContent = 'HỒ SƠ TÀI KHOẢN'; accountMenu.append(heading);
    for (const item of state.profiles) {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(item.id === state.activeProfileId));
      button.textContent = `${item.id === state.activeProfileId ? '✓' : '○'} ${item.name}`;
      const usage = document.createElement('small'); usage.textContent = usageLabel(item.usage); button.append(usage);
      button.onclick = async () => { try { const auth = await window.office.run('select-profile', { id: item.id }); closeAccounts(); get('#console').focus(); if (auth?.loginStarted) await window.office.run('navigate', { page: 'index.html' }); } catch (error) { get('#status').textContent = error.message; } };
      accountMenu.append(button);
    }
    const note = document.createElement('small'); note.textContent = state.profiles.length ? 'Đổi hồ sơ cho phiên mới; không đổi phiên đang chạy.' : 'Chưa có hồ sơ. Thêm tài khoản để bắt đầu.'; accountMenu.append(note);
    const usageButton = document.createElement('button'); usageButton.textContent = 'Xem usage chính thức (/usage)'; usageButton.disabled = !state.profiles.length;
    usageButton.onclick = async () => { try { await window.office.run('usage-open'); await window.office.run('navigate', { page: 'index.html' }); } catch (error) { get('#status').textContent = error.message; } }; accountMenu.append(usageButton);
    const manage = document.createElement('button'); manage.type = 'button'; manage.textContent = '＋ Thêm / quản lý tài khoản & terminal'; manage.onclick = () => window.office.run('navigate', { page: 'index.html' }).catch(error => { get('#status').textContent = error.message; }); accountMenu.append(manage);
  }
  document.addEventListener('click', event => { if (!accountMenu.contains(event.target) && !get('#console').contains(event.target)) closeAccounts(); });
  document.addEventListener('keydown', event => {
    if (accountMenu.hidden) return;
    if (event.key === 'Escape') { closeAccounts(); get('#console').focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const buttons = [...accountMenu.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) % buttons.length]?.focus(); }
  });
  async function act(action, payload = {}) { try { return await window.office.run('team', { action, id: selected, ...payload }); } catch (error) { get('#status').textContent = error.message; } }
  function options(select, value = '') { select.replaceChildren(); for (const project of [{ id: '', name: 'Không thuộc dự án' }, ...team.projects]) { const option = document.createElement('option'); option.value = project.id; option.textContent = project.name; select.append(option); } select.value = value; }
  function sidebar() {
    const groups = [{ name: '★ Pinned', threads: team.threads.filter(thread => thread.pinned) }, ...team.projects.map(project => ({ name: project.name, threads: team.threads.filter(thread => thread.project === project.id) })), { name: 'Không thuộc dự án', threads: team.threads.filter(thread => !thread.project) }];
    const query = get('#search').value.toLocaleLowerCase();
    get('#groups').replaceChildren(...groups.map(group => {
      const detail = document.createElement('details'); detail.open = localStorage.getItem('group:' + group.name) !== 'closed'; detail.ontoggle = () => localStorage.setItem('group:' + group.name, detail.open ? 'open' : 'closed');
      const summary = document.createElement('summary'); summary.textContent = group.name; detail.append(summary);
      for (const thread of [...group.threads].reverse().filter(item => item.title.toLocaleLowerCase().includes(query))) { const button = document.createElement('button'); button.className = 'thread' + (thread.id === selected ? ' selected' : ''); button.textContent = thread.title; const label = document.createElement('small'); label.textContent = thread.flow.length ? `${thread.flow[thread.stage]} · ${names[thread.status]}` : 'Claude Code'; button.append(label); button.onclick = () => { selected = thread.id; localStorage.setItem('selected-thread', selected); paint(); }; detail.append(button); }
      return detail;
    }));
  }
  function paint() {
    sidebar(); const thread = current(); get('#title').textContent = thread?.title || 'Không gian phát triển game'; options(get('#move'), thread?.project || ''); get('#pin').textContent = thread?.pinned ? '★ Đã ghim' : '☆ Ghim';
    for (const selector of ['#pin', '#move', '#begin', '#issue', '#handoff']) get(selector).disabled = !thread;
    get('#flow').replaceChildren(); get('#issues').replaceChildren(); attached.replaceChildren(); paintSessionUsage(thread); if (!thread) return;
    const folders = [thread.folder, ...(thread.relatedFolders || [])].filter(Boolean);
    folderButton.textContent = `📁 Thêm thư mục${folders.length ? ' (' + folders.length + ')' : ''}`; folderButton.title = 'Thư mục đầu tiên là thư mục chính; các thư mục còn lại được cấp qua --add-dir.';
    folderList.replaceChildren(...folders.map((folder, index) => { const chip = document.createElement('span'); chip.className = 'image-chip'; chip.textContent = `${index === 0 ? 'Chính' : 'Liên quan'}: ${folder} `; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Bỏ thư mục khỏi session (không xóa trên đĩa)'; remove.onclick = async () => { try { await window.office.run('remove-folder', { id: selected, folder }); } catch (error) { get('#status').textContent = error.message; } }; chip.append(remove); return chip; }));
    for (const image of thread.attachments || []) { const chip = document.createElement('span'); chip.textContent = '▧ ' + image.name; chip.className = 'image-chip'; attached.append(chip); }
    thread.flow.forEach((role, index) => { if (index) { const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→'; get('#flow').append(arrow); } const block = document.createElement('div'); block.className = 'block' + (index < thread.stage || thread.status === 'done' ? ' finished' : index === thread.stage ? ' current' : ''); const name = document.createElement('b'); name.textContent = role; const label = document.createElement('small'); label.textContent = index < thread.stage || thread.status === 'done' ? (role === 'Dev' && thread.flow[thread.stage] === 'QA' ? '✓ Đã làm · chờ QA' : '✓ Đã bàn giao') : index === thread.stage ? names[thread.status] : 'Chưa đến bước'; block.append(name, label); get('#flow').append(block); });
    renderActivity(thread);
    for (const issue of thread.issues) { const row = document.createElement('div'); row.className = 'issue'; const label = document.createElement('span'); label.textContent = `${issue.closed ? '✓ Đã retest' : '● Mở'} · ${issue.text}`; row.append(label); if (!issue.closed) { const button = document.createElement('button'); button.textContent = 'Xác nhận retest'; button.onclick = async () => { if (await act('retest', { issue: issue.id, text: get('#message').value })) get('#message').value = ''; }; row.append(button); } get('#issues').append(row); }
    get('#begin').hidden = get('#handoff').hidden = get('#issue').hidden = !thread.flow.length;
    runRole.hidden = !thread.flow.length;
    get('#begin').disabled = thread.status !== 'waiting'; get('#handoff').disabled = thread.status !== 'working'; get('#issue').disabled = ['done', 'awaiting-decision', 'cancelled'].includes(thread.status); get('#status').textContent = thread.flow.length ? `${thread.flow[thread.stage]} · ${names[thread.status]}` : 'Claude Code · Gửi để mở yêu cầu trong terminal';
    get('.notice').textContent = thread.flow.length ? 'Role: bàn giao thủ công · Chưa tự điều phối AI hoặc chạy Unity/Profiler.' : 'Claude Code thường · Phản hồi và xác nhận quyền hiển thị trong terminal. Có thể kéo thả ảnh vào đây.';
  }
  // Hội thoại render theo khóa tin nhắn: chỉ dựng lại thẻ có nội dung đổi, giữ nguyên vị trí cuộn (sửa lỗi bị cuộn lên đầu
  // mỗi lần publish/stream) và giữ vùng chữ đang bôi đen.
  const cardCache = new Map(); let cachedThread;
  const messageKey = (message, index) => message.id || `${index}:${message.time}:${message.role}`;
  const profileName = id => knownProfiles.find(profile => profile.id === id)?.name || 'Hồ sơ';
  const signature = message => [message.text, message.streaming, message.error, (message.tools || []).join(','), message.profileId, message.model, message.profileId ? profileName(message.profileId) : '', JSON.stringify(message.usage || null)].join('\u0000');
  // US-01: token/chi phí. addUsage là chỗ cộng duy nhất, dùng cho cả dòng từng tin, tổng theo role và tổng session.
  const USAGE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'costUsd', 'turns'];
  const addUsage = (total, usage) => { for (const key of USAGE_FIELDS) total[key] = (total[key] || 0) + (Number(usage?.[key]) || 0); return total; };
  function usageByRole(messages) { const roles = new Map(); for (const message of messages) if (message.usage) { if (!roles.has(message.role)) roles.set(message.role, addUsage({}, null)); addUsage(roles.get(message.role), message.usage); } return roles; }
  const tokens = value => Math.round(value).toLocaleString();
  const usageText = usage => `vào ${tokens(usage.input)} (cache ${tokens(usage.cacheRead + usage.cacheWrite)}) · ra ${tokens(usage.output)} · $${usage.costUsd.toFixed(4)}`;
  const usageDetail = usage => `input ${tokens(usage.input)} · cache đọc ${tokens(usage.cacheRead)} · cache ghi ${tokens(usage.cacheWrite)} · output ${tokens(usage.output)} · ${usage.turns} turn`;
  const sessionUsage = document.createElement('span'); sessionUsage.id = 'usage-tokens'; get('#title').after(sessionUsage);
  function paintSessionUsage(thread) {
    const roles = usageByRole(thread?.messages || []); sessionUsage.hidden = !roles.size; if (!roles.size) { sessionUsage.textContent = ''; return; }
    const total = [...roles.values()].reduce(addUsage, addUsage({}, null));
    sessionUsage.textContent = 'Token session: ' + usageText(total) + ' | ' + [...roles].map(([role, usage]) => role + ': ' + usageText(usage)).join(' | ');
    sessionUsage.title = [...roles].map(([role, usage]) => role + ': ' + usageDetail(usage)).join('\n');
  }
  function elapsed(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)), minutes = Math.floor(seconds / 60); return minutes ? `${minutes}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`; }
  function progressText(message) {
    const progress = message.progress; if (!progress?.startedAt) return '';
    const steps = progress.steps ? ` · ${progress.steps} bước` : '';
    if (!message.streaming) return progress.finishedAt ? `✓ Xong sau ${elapsed(Date.parse(progress.finishedAt) - Date.parse(progress.startedAt))}${steps}` : '';
    const doing = progress.lastTool ? progress.lastTool + (progress.target ? ' ' + progress.target : '') : message.text ? 'đang viết trả lời' : 'đang suy nghĩ';
    return `● ${elapsed(Date.now() - Date.parse(progress.startedAt))} · ${doing}${steps}`;
  }
  function updateProgress(card, message) { const node = card.querySelector('.run-progress'); if (node) node.textContent = progressText(message); }
  function buildCard(message) {
    const card = document.createElement('article'); const header = document.createElement('header'); const name = document.createElement('b');
    name.textContent = message.profileId ? `${message.role} · ${profileName(message.profileId)} · ${message.model || ''}` : message.role;
    const time = document.createElement('time'); time.textContent = new Date(message.time).toLocaleString(); header.append(name, time);
    let content; if (window.renderChatText) content = window.renderChatText(message.text); else { content = document.createElement('p'); content.textContent = message.text; }
    card.append(header, content);
    if (message.progress) { const progress = document.createElement('small'); progress.className = 'run-progress'; progress.setAttribute('aria-live', 'polite'); card.append(progress); updateProgress(card, message); }
    if (message.streaming) card.classList.add('streaming'); if (message.error) card.classList.add('chat-error');
    if (message.tools?.length) { const tools = document.createElement('small'); tools.textContent = 'Công cụ: ' + message.tools.join(', '); card.append(tools); }
    if (message.usage) { const usage = addUsage({}, message.usage), line = document.createElement('small'); line.className = 'run-usage'; line.textContent = 'Token: ' + usageText(usage); line.title = usageDetail(usage); card.append(line); }
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
  function refreshProgress() {
    const thread = current(); if (!thread) return;
    thread.messages.forEach((message, index) => { if (message.streaming) { const hit = cardCache.get(messageKey(message, index)); if (hit) updateProgress(hit.card, message); } });
    get('#flow').querySelectorAll('.block').forEach((block, index) => { const running = thread.messages.findLast(message => message.role === thread.flow[index] && message.streaming); const node = block.querySelector('.block-progress'); if (node && running) node.textContent = progressText(running); });
  }
  setInterval(refreshProgress, 1000);
  window.office.onState(state => { paintAccounts(state); applyState(state); team = state.team; if (team) { if (!selected || !current()) selected = team.threads.at(-1)?.id; paint(); } });
  get('#search').oninput = sidebar;
  get('#new-thread').onclick = async () => { const id = await act('create', { project: current()?.project || '' }); if (id) { selected = id; localStorage.setItem('selected-thread', id); paint(); get('#message').focus(); } };
  get('#cancel-create').onclick = () => get('#create').close();
  get('#create-form').onsubmit = async event => { event.preventDefault(); const id = await act('create', { title: get('#new-title').value, request: get('#request').value, project: get('#new-project').value }); if (id) { selected = id; localStorage.setItem('selected-thread', selected); get('#create').close(); get('#create-form').reset(); paint(); } };
  get('#project').onclick = () => { naming = 'project'; requestEditor.hidden = true; get('#new-name').hidden = false; get('#new-name').required = true; get('#name-label').textContent = 'Tên dự án mới'; get('#new-name').maxLength = 80; roleChoices.hidden = true; get('#naming').showModal(); };
  const roleChoices = document.createElement('div'); roleChoices.hidden = true; get('#new-name').after(roleChoices);
  const requestEditor = document.createElement('textarea'); requestEditor.hidden = true; requestEditor.maxLength = 12000; roleChoices.after(requestEditor);
  get('#role').onclick = () => {
    const thread = current(); if (!thread) { get('#status').textContent = 'Tạo session trước khi chọn role'; return; }
    naming = 'select-roles'; requestEditor.hidden = true; get('#new-name').hidden = true; get('#new-name').required = false; get('#name-label').textContent = 'Chọn / xóa role và cấu hình'; roleChoices.hidden = false; roleChoices.replaceChildren();
    const roles = [...new Set([...roleTypes, ...thread.flow])];
    for (const role of roles) {
      const section = document.createElement('section'); section.className = 'role-config';
      const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.role = 'true'; checkbox.value = role; checkbox.checked = thread.flow.includes(role); label.append(checkbox, document.createTextNode(' ' + role)); section.append(label);
      const config = thread.roleConfig?.[role] || team.roleTemplates?.[role] || defaultRoles[role] || {};
      const editors = {};
      for (const [key, title] of [['responsibility', 'Trách nhiệm'], ['output', 'Đầu ra'], ['instructions', 'Yêu cầu riêng trong session']]) { const heading = document.createElement('small'); heading.textContent = title; const field = document.createElement('textarea'); field.value = config[key] || ''; field.maxLength = key === 'instructions' ? 12000 : 6000; field.setAttribute('aria-label', role + ' · ' + title); editors[key] = field; section.append(heading, field); }
      const saveLabel = document.createElement('label'); const saveDefault = document.createElement('input'); saveDefault.type = 'checkbox'; saveLabel.append(saveDefault, document.createTextNode(' Dùng trách nhiệm/đầu ra này làm mặc định lần sau')); section.append(saveLabel);
      const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Lưu cấu hình ' + role;
      save.onclick = async () => { if (await act('role-config', { role, responsibility: editors.responsibility.value, output: editors.output.value, instructions: editors.instructions.value, saveDefault: saveDefault.checked })) save.textContent = '✓ Đã lưu ' + role; }; section.append(save); roleChoices.append(section);
    }
    const note = document.createElement('p'); note.textContent = 'Bỏ tích để xóa role khỏi luồng, rồi Lưu. Cấu hình riêng vẫn được giữ. Đổi role khi đã chạy cần xác nhận bắt đầu lại.'; roleChoices.append(note); get('#naming').showModal();
  };
  get('#cancel-name').onclick = () => get('#naming').close();
  get('#name-form').onsubmit = async event => { event.preventDefault(); const payload = naming === 'select-roles' ? { roles: [...roleChoices.querySelectorAll('input[data-role]:checked')].map(input => input.value) } : naming === 'edit-request' ? { text: requestEditor.value } : { name: get('#new-name').value }; if (['select-roles', 'edit-request'].includes(naming) && (current().stage > 0 || current().status !== 'waiting')) { if (!confirm('Thay đổi này bắt đầu lại quy trình và yêu cầu kiểm tra lại kết quả. Tiếp tục?')) return; payload.restart = true; } if (await act(naming, payload)) { get('#naming').close(); get('#name-form').reset(); } };
  get('#pin').onclick = () => act('pin'); get('#move').onchange = () => act('move', { project: get('#move').value }); get('#begin').onclick = () => act('start');
  get('#handoff').onclick = async () => { if (await act('handoff', { text: get('#message').value })) get('#message').value = ''; };
  get('#issue').onclick = async () => { if (await act('issue', { text: get('#message').value })) get('#message').value = ''; };
  get('#composer').onsubmit = async event => {
    event.preventDefault();
    if (!current()) { const id = await act('create', { project: '' }); if (!id) return; selected = id; }
    if (current()?.flow.length && !get('#message').value.trim().startsWith('/')) { if (await act('message', { text: get('#message').value })) get('#message').value = ''; return; }
    try { await window.office.run('run-thread', { id: selected, text: get('#message').value }); get('#message').value = ''; await window.office.run('navigate', { page: 'index.html' }); }
    catch (error) { get('#status').textContent = error.message; }
  };
  get('#console').onclick = () => { accountMenu.hidden = !accountMenu.hidden; get('#console').setAttribute('aria-expanded', String(!accountMenu.hidden)); if (!accountMenu.hidden) accountMenu.querySelector('button')?.focus(); };
  window.office.run('state').then(state => { paintAccounts(state); applyState(state); team = state.team; if (!current()) selected = team?.threads.at(-1)?.id; if (team) paint(); });
  const modelSelect = document.createElement('select'); modelSelect.id = 'chat-model'; modelSelect.setAttribute('aria-label', 'Model');
  for (const model of ['claude-opus-5-5', 'sonnet', 'opus', 'haiku']) { const option = document.createElement('option'); option.value = model; option.textContent = model === 'claude-opus-5-5' ? 'Opus 5.5' : model[0].toUpperCase() + model.slice(1); modelSelect.append(option); }
  const modeSelect = document.createElement('select'); modeSelect.id = 'chat-mode'; modeSelect.setAttribute('aria-label', 'Mode');
  for (const [value, title] of [['read', 'Plan · chỉ đọc'], ['edit', 'Đọc & sửa tệp · xác nhận mỗi lượt'], ['auto', 'Auto · CLI tự xét quyền'], ['bypass', 'Bypass · bỏ duyệt tệp']]) { const option = document.createElement('option'); option.value = value; option.textContent = title; modeSelect.append(option); }
  const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'Dừng khối'; stop.onclick = () => window.office.run('chat-stop', { id: selected, role: selectedWorker });
  get('#composer > div:last-child').prepend(modeSelect, modelSelect, stop);
  const saveOptions = () => selectedWorker ? act('worker-config', { role: selectedWorker, mode: modeSelect.value, model: modelSelect.value, profileId: current().workers?.[selectedWorker]?.profileId || '', task: current().workers?.[selectedWorker]?.task || '' }) : act('chat-options', { mode: modeSelect.value, model: modelSelect.value }); modeSelect.onchange = modelSelect.onchange = saveOptions;
  const applyPlan = document.createElement('button'); applyPlan.type = 'button'; applyPlan.textContent = 'Thử lại task bị chặn'; applyPlan.onclick = async () => { try { await window.office.run('dispatch-retry', { id: selected }); } catch (error) { get('#status').textContent = error.message; } }; get('.actions').append(applyPlan);
  async function sendChat(role) {
    if (!current()) { const id = await act('create', { project: '' }); if (!id) return; selected = id; }
    role ||= selectedWorker;
    try { const result = await window.office.run('chat-send', { id: selected, role, text: get('#message').value.trim() || (role ? 'Thực hiện nhiệm vụ theo yêu cầu session.' : '') }); if (result?.loginStarted) { localStorage.setItem('draft:' + selected, get('#message').value); await window.office.run('navigate', { page: 'index.html' }); return; } if (result) { localStorage.removeItem('draft:' + selected); get('#message').value = ''; } } catch (error) { get('#status').textContent = error.message; }
  }
  get('#composer').onsubmit = event => { event.preventDefault(); sendChat(); };
  runRole.textContent = 'Chạy khối đang chọn'; runRole.onclick = () => sendChat(selectedWorker || current()?.flow[current().stage]);
  const suggestions = document.createElement('div'); suggestions.id = 'command-suggestions'; suggestions.hidden = true; suggestions.setAttribute('role', 'listbox'); get('#message').before(suggestions);
  let suggestionIndex = 0;
  const commandHelp = [['/model', 'Chọn model'], ['/status', 'Cấu hình session'], ['/role', 'Chạy/tạm dừng khối: /role <tên> start|pause'], ['/chot', 'Chốt GD, chạy tự động các bước sau'], ['/auto', 'Bật/tắt tự động: /auto on|off'], ['/mcp', 'MCP server (/mcp open để sửa)'], ['/usage', 'Usage nhận từ CLI'], ['/help', 'Trợ giúp']];
  const takesArgs = ['/role', '/auto'];
  function suggest() { const value = get('#message').value; const matching = value.startsWith('/') && !/\s/.test(value) ? commandHelp.filter(([command]) => command.startsWith(value)) : []; suggestions.hidden = !matching.length; suggestionIndex = 0; suggestions.replaceChildren(...matching.map(([command, title]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = command + ' — ' + title; button.onclick = () => { get('#message').value = command + (takesArgs.includes(command) ? ' ' : ''); suggestions.hidden = true; get('#message').focus(); }; return button; })); suggestions.firstElementChild?.classList.add('active'); }
  get('#message').addEventListener('input', suggest);
  get('#message').addEventListener('keydown', event => { if (suggestions.hidden) return; const buttons = [...suggestions.querySelectorAll('button')]; if (event.key === 'Escape') { suggestions.hidden = true; return; } if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length; buttons.forEach((button, index) => button.classList.toggle('active', index === suggestionIndex)); } if (event.key === 'Tab' || event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); buttons[suggestionIndex]?.click(); } });
  const roleEditor = document.createElement('dialog'); roleEditor.id = 'role-detail';
  const roleHeading = document.createElement('h2'); const defaultHeading = document.createElement('p'); defaultHeading.textContent = 'Mặc định · tự lưu sau khi rời ô';
  const responsibility = document.createElement('textarea'); responsibility.setAttribute('aria-label', 'Trách nhiệm mặc định'); responsibility.maxLength = 6000;
  const output = document.createElement('textarea'); output.setAttribute('aria-label', 'Đầu ra mặc định'); output.maxLength = 6000;
  const ownHeading = document.createElement('p'); ownHeading.textContent = 'Trách nhiệm và nhiệm vụ riêng trong session này';
  const ownInstructions = document.createElement('textarea'); ownInstructions.setAttribute('aria-label', 'Nhiệm vụ session'); ownInstructions.maxLength = 12000;
  const saved = document.createElement('small'); const closeDetail = document.createElement('button'); closeDetail.textContent = 'Đóng'; closeDetail.onclick = () => roleEditor.close();
  roleEditor.append(roleHeading, defaultHeading, responsibility, output, ownHeading, ownInstructions, saved, closeDetail); document.body.append(roleEditor);
  let editingRole, editingThread;
  let editingWorker;
  const workerAccount = document.createElement('select'); workerAccount.setAttribute('aria-label', 'Tài khoản của khối');
  const workerMode = document.createElement('select'); workerMode.setAttribute('aria-label', 'Mode của khối'); workerMode.replaceChildren(...[...modeSelect.options].map(option => option.cloneNode(true)));
  const workerModel = document.createElement('select'); workerModel.setAttribute('aria-label', 'Model của khối'); workerModel.replaceChildren(...[...modelSelect.options].map(option => option.cloneNode(true)));
  const workerTask = document.createElement('textarea'); workerTask.setAttribute('aria-label', 'Task riêng của khối'); workerTask.placeholder = 'Task được Lead giao: owner, phạm vi file, AC, phụ thuộc…';
  roleEditor.insertBefore(workerAccount, ownHeading); roleEditor.insertBefore(workerMode, ownHeading); roleEditor.insertBefore(workerModel, ownHeading); roleEditor.insertBefore(workerTask, saved);
  const saveWorker = async () => { const result = await act('worker-config', { id: editingThread, role: editingWorker, mode: workerMode.value, model: workerModel.value, profileId: workerAccount.value, task: workerTask.value }); if (result?.loginStarted) { await window.office.run('navigate', { page: 'index.html' }); return; } if (result) saved.textContent = '✓ Đã lưu cấu hình riêng của khối'; };
  for (const field of [workerAccount, workerMode, workerModel, workerTask]) field.onchange = saveWorker;
  async function saveDetail() { try { await window.office.run('team', { action: 'role-config', id: editingThread, role: editingRole, responsibility: responsibility.value, output: output.value, instructions: ownInstructions.value, saveDefault: true }); saved.textContent = '✓ Đã lưu'; } catch (error) { saved.textContent = error.message; } }
  for (const field of [responsibility, output, ownInstructions]) field.onchange = saveDetail;
  function openRole(role) { selectedWorker = role; editingWorker = role; editingRole = current().workers?.[role]?.type || role.replace(/ #\d+$/, ''); editingThread = selected; const base = team.roleTemplates?.[editingRole] || defaultRoles[editingRole] || {}; roleHeading.textContent = role; responsibility.value = base.responsibility || ''; output.value = base.output || ''; ownInstructions.value = current().roleConfig?.[editingRole]?.instructions || ''; const config = current().workers?.[role] || {}; workerTask.value = config.task || ''; workerMode.value = config.mode || current().mode || 'read'; workerModel.value = config.model || current().model || 'claude-opus-5-5'; workerAccount.replaceChildren(); for (const profile of [{ id: '', name: 'Theo tài khoản đang chọn' }, ...knownProfiles]) { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; workerAccount.append(option); } workerAccount.value = config.profileId || ''; saved.textContent = ''; roleEditor.showModal(); paint(); }
  const decisionBanner = document.createElement('div'); decisionBanner.id = 'decision-banner'; decisionBanner.setAttribute('role', 'alert'); decisionBanner.hidden = true; get('#flow').before(decisionBanner);
  const decisionText = document.createElement('p'); decisionBanner.append(decisionText);
  for (const [choice, title] of [['continue', 'Tiếp tục thêm 1 vòng'], ['accept', 'Chấp nhận với lỗi đã biết'], ['stop', 'Dừng']]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.dataset.choice = choice; button.onclick = () => act('decision', { choice }); decisionBanner.append(button); }
  const reviewReject = document.createElement('button'); reviewReject.type = 'button'; reviewReject.id = 'review-reject'; reviewReject.textContent = 'Review không đạt → Dev'; reviewReject.title = 'Ghi mục không đạt kèm file:line vào ô nội dung rồi bấm'; reviewReject.hidden = true; get('#handoff').after(reviewReject);
  reviewReject.onclick = async () => { if (await act('review-reject', { text: get('#message').value })) get('#message').value = ''; };
  function paintLoop(thread) {
    decisionBanner.hidden = thread?.status !== 'awaiting-decision';
    decisionText.textContent = `QA fail ${thread?.qaFailRounds || 0}/${qaRoundLimit} vòng. Chọn cách xử lý:`;
    reviewReject.hidden = !thread || !isLead(thread, thread.flow[thread.stage]) || thread.leadPhase !== 'review' || thread.status !== 'working';
  }
  const paintOriginal = paint;
  paint = function () {
    paintOriginal(); const thread = current(); paintLoop(thread); if (!thread) return;
    if (!thread.flow.includes(selectedWorker)) selectedWorker = thread.flow[thread.stage] || thread.flow[0];
    if (!get('#message').value && localStorage.getItem('draft:' + selected)) get('#message').value = localStorage.getItem('draft:' + selected);
    const selectedConfig = thread.workers?.[selectedWorker]; modeSelect.value = selectedConfig?.mode || thread.mode || 'read'; modelSelect.value = selectedConfig?.model || thread.model || 'claude-opus-5-5';
    runRole.textContent = selectedWorker ? 'Chạy ' + selectedWorker : 'Chạy role';
    get('.notice').textContent = 'Chat trực tiếp · Plan chỉ đọc · Đọc & sửa/Auto: tệp + shell, hỏi mỗi lượt · Bypass: chỉ hỏi khi thư mục ở ổ C · MCP theo /mcp · /role <khối> start|pause.';
    get('#status').textContent = (selectedWorker || 'Chat thường') + (thread.messages.some(message => message.streaming && message.role === (selectedWorker || 'Claude')) ? ' · Đang chạy' : ' · Sẵn sàng');
    get('#flow').querySelectorAll('.block').forEach((block, index) => { const role = thread.flow[index]; block.tabIndex = 0; block.setAttribute('role', 'button'); block.onclick = () => openRole(role); block.onkeydown = event => { if (event.target === block && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openRole(role); } }; const remove = document.createElement('button'); remove.className = 'remove-role'; remove.textContent = '×'; const check = removal[thread.id]?.[role]; remove.disabled = !check?.ok; remove.title = check?.ok ? `Xóa ${role} (${check.reason})` : check?.reason || 'Không xóa được'; remove.setAttribute('aria-label', remove.title); remove.onclick = async event => { event.stopPropagation(); if (confirm('Xóa ' + role + '? Cấu hình riêng và phiên chat của khối này sẽ bị xóa.')) await act('remove-role', { role }); }; block.append(remove); });
    get('#flow').querySelectorAll('.block').forEach((block, index) => {
      const role = thread.flow[index]; const task = thread.dispatch?.find(task => task.worker === role); const running = thread.messages.findLast(message => message.role === role && message.streaming); const label = block.querySelector('small');
      if (running) label.textContent = '● Đang thực hiện'; else if (thread.workers?.[role]?.paused) label.textContent = '⏸ Tạm dừng'; else if (task) label.textContent = taskNames[task.status] || task.status;
      if (isLead(thread, role) && qaRoundLimit) label.textContent += ` · ${phaseNames[thread.leadPhase] || phaseNames.planning} · QA ${thread.qaFailRounds || 0}/${qaRoundLimit}`;
      if (running) { const progress = document.createElement('em'); progress.className = 'block-progress'; progress.textContent = progressText(running); block.append(progress); }
      block.title = task?.error || task?.task || role;
    });
    paintDispatch(thread);
  };
  const taskNames = { queued: 'Chờ lượt/phụ thuộc', starting: 'Đang chuẩn bị', running: 'Đang thực hiện', finished: 'Đã trả kết quả · chưa QA', failed: 'Lỗi thực thi', blocked: 'Bị chặn', cancelled: 'Đã dừng', paused: 'Tạm dừng' };
  const dispatchSummary = document.createElement('p'); dispatchSummary.id = 'dispatch-summary'; dispatchSummary.setAttribute('role', 'status'); get('#flow').after(dispatchSummary);
  function paintDispatch(thread) {
    const tasks = thread.dispatch || [], count = status => tasks.filter(task => task.status === status).length;
    const parts = [thread.auto?.enabled ? '⚙ Tự động: bật' : 'Tự động: tắt (/chot hoặc /auto on)'];
    if (tasks.length) { parts.push(`Dev ${count('finished')}/${tasks.length} đã xong`); for (const [status, title] of [['running', 'đang chạy'], ['queued', 'chờ'], ['paused', 'tạm dừng'], ['blocked', 'bị chặn'], ['failed', 'lỗi']]) if (count(status)) parts.push(`${count(status)} ${title}`); }
    dispatchSummary.hidden = !thread.flow.length; dispatchSummary.textContent = parts.join(' · ');
  }
  const addRoleDialog = document.createElement('dialog'); addRoleDialog.id = 'add-role-dialog'; const addTitle = document.createElement('h2'); addTitle.textContent = 'Thêm role'; addRoleDialog.append(addTitle); document.body.append(addRoleDialog);
  get('#role').onclick = async () => {
    if (!current()) { const id = await act('create', { project: '' }); if (!id) return; selected = id; team = (await window.office.run('state')).team; paint(); }
    addRoleDialog.replaceChildren(addTitle);
    const thread = current(); const hasLead = thread.flow.some(label => isLead(thread, label));
    for (const role of roleTypes.filter(type => type !== 'Lead Dev' || !hasLead)) { const button = document.createElement('button'); button.type = 'button'; button.textContent = '+ ' + role; button.onclick = async () => { const added = await act('add-worker', { type: role }); if (added) { selectedWorker = added; addRoleDialog.close(); paint(); } }; addRoleDialog.append(button); }
    const close = document.createElement('button'); close.textContent = 'Hủy'; close.onclick = () => addRoleDialog.close(); addRoleDialog.append(close); addRoleDialog.showModal();
  };
  if (team) paint();
  get('#message').addEventListener('keydown', event => { if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.defaultPrevented) return; event.preventDefault(); if (get('#message').value.trim()) get('#composer').requestSubmit(); });
  const fileDialog = document.createElement('dialog'); fileDialog.id = 'file-viewer';
  const fileTitle = document.createElement('h3'); const fileText = document.createElement('pre'); const fileCopy = document.createElement('button'); fileCopy.textContent = 'Copy nội dung'; fileCopy.onclick = () => window.office.run('copy-text', { text: fileText.textContent }); const fileClose = document.createElement('button'); fileClose.textContent = 'Đóng'; fileClose.onclick = () => fileDialog.close(); fileDialog.append(fileTitle, fileCopy, fileClose, fileText); document.body.append(fileDialog);
  window.openChatFile = async reference => { try { const file = await window.office.run('file-read', { id: selected, path: reference }); fileTitle.textContent = file.path; fileText.textContent = file.content; fileDialog.showModal(); } catch (error) { get('#status').textContent = error.message; } };
  const usageDialog = document.createElement('dialog'); usageDialog.id = 'usage-viewer'; const usageTitle = document.createElement('h3'); usageTitle.textContent = 'Usage chính thức của hồ sơ CLI'; const usageHint = document.createElement('p'); usageHint.textContent = 'Nếu CLI hiện onboarding, hoàn tất tại đây rồi nhập /usage. Không tự gửi prompt AI.'; const usageClose = document.createElement('button'); usageClose.textContent = 'Đóng'; const usageTerminal = document.createElement('div'); usageTerminal.id = 'usage-terminal'; usageDialog.append(usageTitle, usageHint, usageClose, usageTerminal); document.body.append(usageDialog);
  let usageId, usageTerm, usageFit;
  async function openUsage() {
    try {
      if (usageId) { usageDialog.showModal(); return; }
      usageId = await window.office.run('usage-open', { id: selected, role: selectedWorker });
      usageDialog.showModal(); usageTerm = new Terminal({ fontSize: 13, cols: 90, rows: 25, theme: { background: '#10131a', foreground: '#e6e7ed' } }); usageFit = new FitAddon.FitAddon(); usageTerm.loadAddon(usageFit); usageTerm.open(usageTerminal); usageFit.fit();
      const buffer = await window.office.run('buffer', { id: usageId }); usageTerm.write(buffer.data); usageTerm.onData(data => window.office.run('input', { id: usageId, data })); await window.office.run('resize', { id: usageId, cols: usageTerm.cols, rows: usageTerm.rows }); usageTerm.focus();
    } catch (error) { usageId = undefined; get('#status').textContent = error.message; }
  }
  window.office.onTerminal(chunk => { if (chunk.id === usageId && usageTerm) usageTerm.write(chunk.data); });
  usageClose.onclick = () => usageDialog.close();
  usageDialog.addEventListener('close', () => { if (usageId) window.office.run('close', { id: usageId }).catch(() => {}); usageId = undefined; usageTerm?.dispose(); usageTerm = undefined; usageTerminal.replaceChildren(); });
  const originalSend = sendChat; sendChat = async role => { if (get('#message').value.trim() === '/usage') { get('#message').value = ''; await openUsage(); return; } await originalSend(role); };
  const originalAccounts = paintAccounts; paintAccounts = function (state) { originalAccounts(state); const button = [...accountMenu.querySelectorAll('button')].find(item => item.textContent.startsWith('Xem usage chính thức')); if (button) button.onclick = openUsage; };
})();
