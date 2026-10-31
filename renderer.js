let state = { profiles: [], sessions: [] }, selected, active;
const terminals = new Map();
const element = selector => document.querySelector(selector);
async function run(action, payload) { try { return await window.office.run(action, payload); } catch (error) { element('#status').textContent = error.message; return undefined; } }
function resize() { if (!active || !terminals.has(active)) return; const current = terminals.get(active); current.fit.fit(); run('resize', { id: active, cols: current.term.cols, rows: current.term.rows }); }
async function show(id) {
  active = id; element('#empty').hidden = true; element('#terminal').style.display = 'block';
  for (const [key, current] of terminals) current.pane.style.display = key === id ? 'block' : 'none';
  if (!terminals.has(id)) {
    const pane = document.createElement('div'); pane.className = 'terminal-pane'; element('#terminal').append(pane);
    const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'Consolas, monospace', scrollback: 3000, allowProposedApi: false, theme: { background: '#10131a', foreground: '#e6e7ed' } });
    const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open(pane);
    terminals.set(id, { pane, term, fit, ready: false, pending: [] });
    term.onData(data => run('input', { id, data }));
    const buffer = await run('buffer', { id });
    const current = terminals.get(id); if (!current) return;
    term.write(buffer?.data || '');
    for (const chunk of current.pending) if (chunk.sequence > (buffer?.sequence || 0)) term.write(chunk.data);
    current.ready = true; current.pending = [];
  }
  renderTabs(); resize(); terminals.get(id)?.term.focus();
}
function renderTabs() {
  element('#tabs').replaceChildren(...state.sessions.map(session => {
    const tab = document.createElement('div'); tab.className = 'tab' + (session.id === active ? ' active' : '');
    const select = document.createElement('button');
    const owner = state.profiles.find(item => item.id === session.profileId);
    select.textContent = `${session.running ? '●' : '○'} ${owner?.name || 'Hồ sơ'} · ${session.kind === 'work' ? 'Làm việc' : session.kind === 'login' ? 'Đăng nhập' : 'Đăng xuất'}${session.running ? '' : ` (${session.code ?? 'đã dừng'})`}`;
    select.onclick = () => show(session.id);
    const close = document.createElement('button'); close.textContent = '×'; close.title = 'Dừng và đóng phiên';
    close.onclick = async () => { if (session.running && !confirm('Dừng phiên đang chạy?')) return; await run('close', { id: session.id }); };
    tab.append(select, close); return tab;
  }));
}
function render(next) {
  state = next;
  selected = state.activeProfileId || state.profiles[0]?.id;
  const current = state.profiles.find(item => item.id === selected);
  element('#profiles').replaceChildren(...state.profiles.map(profile => {
    const button = document.createElement('button'); button.className = 'profile' + (profile.id === selected ? ' selected' : ''); button.textContent = profile.name;
    const count = document.createElement('small'); count.textContent = `${state.sessions.filter(session => session.profileId === profile.id && session.running).length} phiên đang chạy`; button.append(count);
    button.onclick = () => run('select-profile', { id: profile.id }); return button;
  }));
  element('#heading').textContent = current?.name || 'Bắt đầu công việc'; element('#folder-label').textContent = current?.folder || 'Chưa chọn thư mục';
  element('#cli-path').textContent = state.executable || 'Chưa chọn Claude Code';
  for (const action of ['folder', 'login', 'logout', 'rename', 'start']) element('#' + action).disabled = !current;
  for (const [id, terminal] of terminals) if (!state.sessions.some(session => session.id === id)) { terminal.term.dispose(); terminal.pane.remove(); terminals.delete(id); }
  if (active && !state.sessions.some(session => session.id === active)) { active = undefined; const other = state.sessions.at(-1); if (other) show(other.id); else { element('#empty').hidden = false; element('#terminal').style.display = 'none'; } }
  renderTabs();
}
element('#add').onsubmit = async event => { event.preventDefault(); await run('add', { name: element('#profile-name').value }); element('#profile-name').value = ''; };
element('#choose-cli').onclick = () => run('executable');
element('#folder').onclick = () => run('folder', { id: selected });
element('#rename').onclick = () => { const input = element('#profile-name'); if (input.value.trim()) run('rename', { id: selected, name: input.value }); else { input.focus(); element('#status').textContent = 'Nhập tên mới vào ô tên hồ sơ bên trái, rồi nhấn Đổi tên.'; } };
for (const [button, kind] of [['login', 'login'], ['logout', 'logout'], ['start', 'work']]) element('#' + button).onclick = async () => { const id = await run('start', { id: selected, kind }); if (id) show(id); };
window.office.onState(render);
window.office.onTerminal(chunk => { const current = terminals.get(chunk.id); if (current?.ready) current.term.write(chunk.data); else if (current) current.pending.push(chunk); });
new ResizeObserver(resize).observe(element('#workspace'));
run('state').then(value => { if (value) render(value); });
run('state').then(value => { const latest = value?.sessions.at(-1); if (latest) show(latest.id); });
const backToTeam = document.createElement('button');
backToTeam.textContent = '← Sessions & đội ngũ';
backToTeam.onclick = () => run('navigate', { page: 'dashboard.html' });
document.querySelector('aside').prepend(backToTeam);
