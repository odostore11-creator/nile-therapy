'use strict';
// Nile Therapy portal — single-page app, no framework.

const $app = document.getElementById('app');
const state = { user: null, ai: null, loginRole: 'admin', sessionsView: 'grouped' };

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => String(name || '?').replace(/^Dr\.?\s*/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const typeClass = t => /home/i.test(t) ? 'home' : /online/i.test(t) ? 'online' : '';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { state.user = null; render(); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

const icons = {
  sessions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  doctors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.6" stroke-linecap="round"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>',
};
const waves = `<svg class="waves" viewBox="0 0 600 200" preserveAspectRatio="none"><path d="M0 120c80-60 140 40 220-10s120-90 200-40 120 30 180-10v140H0Z" fill="#165a5b"/><path d="M0 150c90-40 150 30 240-5s130-60 210-20 100 20 150-5v80H0Z" fill="#1c6b69"/><path d="M0 60c100-60 160 60 260 0s140-70 220-30 90 20 120 0" fill="none" stroke="#e9c46a" stroke-width="3"/></svg>`;

// ---------- routing ----------
function route() { return (location.hash.replace(/^#\/?/, '') || '').split('/'); }
window.addEventListener('hashchange', render);

async function boot() {
  try { const r = await api('/api/me'); state.user = r.user; state.ai = r.ai; } catch { state.user = null; }
  render();
}

function render() {
  if (!state.user) return renderLogin();
  const [page, arg] = route();
  if (state.user.role === 'doctor') return shell('log', doctorPortal);
  if (page === 'doctors' && arg) return shell('doctors', el => doctorProfile(el, Number(arg)));
  if (page === 'doctors') return shell('doctors', doctorsPage);
  if (page === 'chat') return shell('chat', chatPage);
  return shell('sessions', sessionsPage);
}

// ---------- login ----------
function renderLogin() {
  const admin = state.loginRole === 'admin';
  $app.innerHTML = `
  <div class="login">
    <section class="login-art">
      <div class="brand"><img src="/logo.svg" alt=""> NILE THERAPY</div>
      <div>
        <h1>Care that moves with the river.</h1>
        <p>The internal portal for Nile Therapy's founders and doctors — session logs, the doctor team, and each founder's AI partner in one place.</p>
      </div>
      <p class="small">Internal use only</p>
      ${waves}
    </section>
    <section class="login-form">
      <form class="login-card" id="login">
        <h2>Sign in</h2>
        <p class="muted">Use the username and password Nile Therapy gave you.</p>
        <div class="role-switch" role="tablist">
          <button type="button" role="tab" aria-selected="${admin}" class="${admin ? 'on' : ''}" data-role="admin">Founder</button>
          <button type="button" role="tab" aria-selected="${!admin}" class="${!admin ? 'on' : ''}" data-role="doctor">Doctor</button>
        </div>
        <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus placeholder="${admin ? 'e.g. abdurrahman' : 'e.g. dr.mona'}"></div>
        <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn block" type="submit">${admin ? 'Enter admin dashboard' : 'Enter doctor portal'}</button>
        <div class="error" id="err"></div>
      </form>
    </section>
  </div>`;
  $app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { state.loginRole = b.dataset.role; renderLogin(); });
  document.getElementById('login').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api('/api/login', { method: 'POST', body: formData(e.target) });
      if (r.user.role !== state.loginRole) {
        toast(r.user.role === 'admin' ? 'Signed in as a founder' : 'Signed in as a doctor');
      }
      const me = await api('/api/me'); state.user = me.user; state.ai = me.ai;
      location.hash = r.user.role === 'admin' ? '#/sessions' : '#/log';
      render();
    } catch (err) { document.getElementById('err').textContent = err.message; btn.disabled = false; }
  };
}

// ---------- layout ----------
function shell(active, renderPage) {
  const u = state.user;
  const nav = u.role === 'admin'
    ? [['sessions', 'Sessions', icons.sessions], ['doctors', 'Doctors', icons.doctors], ['chat', 'My AI room', icons.chat]]
    : [['log', 'My sessions', icons.log]];
  $app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><img src="/logo.svg" alt=""> NILE THERAPY</div>
      ${nav.map(([k, label, ic]) => `<a class="nav ${active === k ? 'on' : ''}" href="#/${k}">${ic}${label}</a>`).join('')}
      <div class="spacer"></div>
      <div class="me">
        <strong>${esc(u.full_name)}</strong><span class="muted">${esc(u.title || (u.role === 'admin' ? 'Founder' : 'Doctor'))}</span>
        <div class="row"><button id="pw">Password</button><button id="out">Log out</button></div>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  document.getElementById('out').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.user = null; location.hash = ''; render(); };
  document.getElementById('pw').onclick = passwordModal;
  renderPage(document.getElementById('main'));
}

function modal(html, onMount) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.appendChild(bg);
  bg.querySelector('input, textarea, select, button')?.focus();
  onMount?.(bg.querySelector('.modal'), close);
}

function passwordModal() {
  modal(`<h2>Change password</h2>
    <form id="pwf">
      <div class="field"><label>Current password</label><input name="current" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>New password (8+ characters)</label><input name="next" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="error" id="pwerr"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Save</button></div>
    </form>`, (m, close) => {
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/me/password', { method: 'POST', body: formData(e.target) }); close(); toast('Password changed'); }
      catch (err) { m.querySelector('#pwerr').textContent = err.message; }
    };
  });
}

// ---------- session form (shared by doctors and founders) ----------
function sessionFormHtml(s = {}, { doctors } = {}) {
  const types = ['Home visit', 'Clinic', 'Online'];
  const type = s.session_type || 'Home visit';
  return `
    ${doctors ? `<div class="field"><label>Doctor</label><select name="doctor_id" required><option value="">Choose…</option>${doctors.filter(d => d.active).map(d => `<option value="${d.id}" ${s.doctor_id === d.id ? 'selected' : ''}>${esc(d.full_name)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>Patient name</label><input name="patient_name" dir="auto" required value="${esc(s.patient_name)}" placeholder="Short name, e.g. Ahmed S."></div>
    <div class="field"><label>Session type</label>
      <input type="hidden" name="session_type" value="${esc(type)}">
      <div class="type-pick">${types.map(t => `<button type="button" data-type="${t}" class="${t === type ? 'on' : ''}">${t}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Where was the session?</label><input name="location" dir="auto" required value="${esc(s.location)}" placeholder="Area / address, or 'Video call'"></div>
    <div class="grid3">
      <div class="field"><label>Date</label><input name="session_date" type="date" required value="${esc(s.session_date || today())}" max="${today()}"></div>
      <div class="field"><label>Time</label><input name="session_time" type="time" value="${esc(s.session_time)}"></div>
      <div class="field"><label>Minutes</label><input name="duration_min" type="number" min="0" max="600" step="5" value="${esc(s.duration_min ?? 45)}"></div>
    </div>
    <div class="field"><label>Notes <span class="muted">(optional)</span></label><textarea name="notes" dir="auto" placeholder="Anything the founders should know">${esc(s.notes)}</textarea></div>`;
}
function wireTypePick(root) {
  root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
    root.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('on', x === b));
    root.querySelector('[name=session_type]').value = b.dataset.type;
    const loc = root.querySelector('[name=location]');
    if (b.dataset.type === 'Online' && !loc.value) loc.value = 'Video call';
  });
}
function editSessionModal(s, onDone) {
  modal(`<h2>Edit session</h2><form>${sessionFormHtml(s)}<div class="error"></div>
    <div class="actions"><button type="button" class="btn danger" data-del>Delete</button><span style="flex:1"></span><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Save</button></div></form>`,
  (m, close) => {
    const f = m.querySelector('form'); wireTypePick(f);
    f.onsubmit = async e => {
      e.preventDefault();
      try { await api(`/api/sessions/${s.id}`, { method: 'PUT', body: formData(f) }); close(); toast('Session updated'); onDone(); }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    };
    m.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Delete this session?')) return;
      await api(`/api/sessions/${s.id}`, { method: 'DELETE' }); close(); toast('Session deleted'); onDone();
    };
  });
}

function sessionRows(list, { showDoctor = true, editable = false } = {}) {
  if (!list.length) return `<div class="empty">No sessions yet.</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Date</th>${showDoctor ? '<th>Doctor</th>' : ''}<th>Patient</th><th>Type</th><th>Location</th><th>Min</th><th>Notes</th>${editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${list.map(s => `<tr>
      <td style="white-space:nowrap">${fmtDate(s.session_date)}<div class="muted small">${esc(s.session_time)}</div></td>
      ${showDoctor ? `<td><a href="#/doctors/${s.doctor_id}">${esc(s.doctor_name)}</a></td>` : ''}
      <td dir="auto" style="white-space:nowrap"><strong>${esc(s.patient_name)}</strong></td>
      <td>${s.session_type ? `<span class="pill ${typeClass(s.session_type)}">${esc(s.session_type)}</span>` : ''}</td>
      <td dir="auto">${esc(s.location)}</td>
      <td>${esc(s.duration_min ?? '')}</td>
      <td dir="auto" class="small">${esc(s.notes)}</td>
      ${editable ? `<td><button class="btn ghost sm" data-edit="${s.id}">Edit</button></td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- doctor portal ----------
async function doctorPortal(main) {
  const u = state.user;
  main.innerHTML = `
    <div class="head"><div><h1>Hi, ${esc(u.full_name.split(' ').slice(0, 2).join(' '))}</h1><p class="muted">Log every Nile Therapy session right after you finish it.</p></div></div>
    <div class="portal">
      <form class="card" id="new">
        <h2 style="margin-bottom:16px">Log a session</h2>
        ${sessionFormHtml()}
        <button class="btn block">Submit session</button>
        <div class="error"></div>
      </form>
      <section class="card"><div class="head" style="margin-bottom:10px"><h2>My sessions</h2><span class="muted small" id="count"></span></div><div id="mine"><div class="empty">Loading…</div></div></section>
    </div>`;
  const form = main.querySelector('#new'); wireTypePick(form);
  const load = async () => {
    const { sessions } = await api('/api/sessions');
    main.querySelector('#count').textContent = `${sessions.length} total`;
    main.querySelector('#mine').innerHTML = sessionRows(sessions, { showDoctor: false, editable: true });
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('.btn.block'); btn.disabled = true;
    try {
      await api('/api/sessions', { method: 'POST', body: formData(form) });
      toast('Session logged — thank you');
      const keep = form.querySelector('[name=session_type]').value;
      form.reset(); form.querySelector('[name=session_type]').value = keep;
      form.querySelector('[name=session_date]').value = today();
      form.querySelector('.error').textContent = '';
      load();
    } catch (err) { form.querySelector('.error').textContent = err.message; }
    btn.disabled = false;
  };
  load();
}

// ---------- admin: sessions ----------
async function sessionsPage(main) {
  const { doctors } = await api('/api/doctors');
  main.innerHTML = `
    <div class="head">
      <div><h1>Sessions</h1><p class="muted">Every session your doctors have logged.</p></div>
      <div style="display:flex;gap:8px"><button class="btn ghost" id="add">+ Add for a doctor</button><a class="btn" id="csv" href="/api/sessions.csv">Export to Excel (CSV)</a></div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <div class="field grow"><label>Search</label><input id="q" placeholder="Patient, place or note" dir="auto"></div>
      <div class="field"><label>Doctor</label><select id="doc"><option value="">All doctors</option>${doctors.map(d => `<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}</select></div>
      <div class="field"><label>From</label><input id="from" type="date"></div>
      <div class="field"><label>To</label><input id="to" type="date"></div>
      <div class="seg" role="group" aria-label="View"><button data-view="grouped">By doctor</button><button data-view="list">All in one list</button></div>
    </div>
    <div id="list"><div class="empty">Loading…</div></div>`;
  const f = id => main.querySelector('#' + id);
  const setView = () => main.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === state.sessionsView));
  setView();

  const load = async () => {
    const params = new URLSearchParams();
    if (f('q').value) params.set('q', f('q').value);
    if (f('doc').value) params.set('doctor_id', f('doc').value);
    if (f('from').value) params.set('from', f('from').value);
    if (f('to').value) params.set('to', f('to').value);
    f('csv').href = '/api/sessions.csv?' + params;
    const { sessions } = await api('/api/sessions?' + params);
    const month = today().slice(0, 7);
    const thisMonth = sessions.filter(s => s.session_date.startsWith(month)).length;
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    f('stats').innerHTML = [
      [sessions.length, 'Sessions (filtered)'],
      [thisMonth, 'This month'],
      [sessions.filter(s => s.session_date >= weekAgo).length, 'Last 7 days'],
      [new Set(sessions.map(s => s.doctor_id)).size + ' / ' + doctors.filter(d => d.active).length, 'Doctors active'],
    ].map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

    if (state.sessionsView === 'list') {
      f('list').innerHTML = `<div class="card" style="padding:6px 6px">${sessionRows(sessions, { editable: true })}</div>`;
    } else {
      const byDoc = new Map();
      for (const s of sessions) { if (!byDoc.has(s.doctor_id)) byDoc.set(s.doctor_id, []); byDoc.get(s.doctor_id).push(s); }
      f('list').innerHTML = byDoc.size ? [...byDoc.entries()].map(([id, list]) => `
        <section class="group card">
          <div class="group-head">
            <div style="display:flex;gap:12px;align-items:center"><div class="avatar">${esc(initials(list[0].doctor_name))}</div>
              <div><h3>${esc(list[0].doctor_name)}</h3><span class="muted small">@${esc(list[0].doctor_username)} · ${list.length} session${list.length === 1 ? '' : 's'}</span></div></div>
            <a class="btn ghost sm" href="#/doctors/${id}">Profile</a>
          </div>
          ${sessionRows(list, { showDoctor: false, editable: true })}
        </section>`).join('') : `<div class="card empty">No sessions match these filters.</div>`;
    }
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
  };
  let t; f('q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  ['doc', 'from', 'to'].forEach(id => f(id).onchange = load);
  main.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.sessionsView = b.dataset.view; setView(); load(); });
  f('add').onclick = () => modal(`<h2>Add a session for a doctor</h2><form>${sessionFormHtml({}, { doctors })}<div class="error"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Add session</button></div></form>`, (m, close) => {
    const form = m.querySelector('form'); wireTypePick(form);
    form.onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/sessions', { method: 'POST', body: formData(form) }); close(); toast('Session added'); load(); }
      catch (err) { form.querySelector('.error').textContent = err.message; }
    };
  });
  load();
}

// ---------- admin: doctors ----------
function doctorFormHtml(d = {}) {
  return `
    <div class="grid2">
      <div class="field"><label>Full name</label><input name="full_name" required dir="auto" value="${esc(d.full_name)}" placeholder="Dr. …"></div>
      ${d.id ? `<div class="field"><label>Username</label><input value="${esc(d.username)}" disabled></div>`
             : `<div class="field"><label>Username (for login)</label><input name="username" required pattern="[a-zA-Z0-9._\\-]{3,40}" placeholder="dr.firstname"></div>`}
    </div>
    <div class="grid2">
      <div class="field"><label>Title</label><input name="title" value="${esc(d.title || 'Physiotherapist')}"></div>
      <div class="field"><label>Specialty</label><input name="specialty" dir="auto" value="${esc(d.specialty)}" placeholder="e.g. Sports rehab"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Phone</label><input name="phone" value="${esc(d.phone)}" placeholder="01x xxxx xxxx"></div>
      <div class="field"><label>Area</label><input name="area" dir="auto" value="${esc(d.area)}" placeholder="Where they usually work"></div>
    </div>
    <div class="field"><label>About</label><textarea name="bio" dir="auto">${esc(d.bio)}</textarea></div>`;
}
function showCredentials(title, { username, password }) {
  modal(`<h2>${esc(title)}</h2>
    <p>Send these to the doctor privately. The password is shown only once — they can change it after logging in.</p>
    <div class="secret">Username: ${esc(username)}<br>Password: ${esc(password)}</div>
    <div class="actions"><button class="btn ghost" id="copy">Copy</button><button class="btn" data-close>Done</button></div>`, m => {
    m.querySelector('#copy').onclick = () => { navigator.clipboard?.writeText(`Nile Therapy portal\nUsername: ${username}\nPassword: ${password}`); toast('Copied'); };
  });
}

async function doctorsPage(main) {
  main.innerHTML = `<div class="head"><div><h1>Doctors</h1><p class="muted">Your team. Click a doctor to open their profile.</p></div><button class="btn" id="add">+ Add doctor</button></div><div id="grid" class="doc-grid"></div>`;
  const load = async () => {
    const { doctors } = await api('/api/doctors');
    main.querySelector('#grid').innerHTML = doctors.length ? doctors.map(d => `
      <button class="card doc" data-id="${d.id}">
        <div class="doc-top"><div class="avatar">${esc(initials(d.full_name))}</div>
          <div><h3 dir="auto">${esc(d.full_name)}</h3><div class="muted small" dir="auto">${esc(d.specialty || d.title)}</div></div></div>
        <div class="muted small" style="margin-bottom:12px">${esc(d.area || '—')} ${d.active ? '' : '<span class="pill off">Inactive</span>'}</div>
        <div class="doc-nums"><div><b>${d.stats.total}</b><span>sessions</span></div><div><b>${d.stats.this_month || 0}</b><span>this month</span></div><div><b>${d.stats.patients}</b><span>patients</span></div></div>
      </button>`).join('') : `<div class="card empty">No doctors yet. Add your first one.</div>`;
    main.querySelectorAll('[data-id]').forEach(b => b.onclick = () => location.hash = `#/doctors/${b.dataset.id}`);
  };
  main.querySelector('#add').onclick = () => modal(`<h2>Add a doctor</h2><form>${doctorFormHtml()}<div class="error"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Create account</button></div></form>`, (m, close) => {
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try { const r = await api('/api/doctors', { method: 'POST', body: formData(e.target) }); close(); load(); showCredentials('Doctor account created', r); }
      catch (err) { m.querySelector('.error').textContent = err.message; }
    };
  });
  load();
}

async function doctorProfile(main, id) {
  const load = async () => {
    const { doctor: d, sessions, patients } = await api(`/api/doctors/${id}`);
    main.innerHTML = `
      <div class="head"><div><a href="#/doctors" class="small">← All doctors</a><h1 dir="auto" style="margin-top:6px">${esc(d.full_name)}</h1></div>
        <div style="display:flex;gap:8px"><button class="btn ghost" id="reset">Reset password</button><button class="btn" id="edit">Edit profile</button></div></div>
      <div class="profile">
        <aside class="card">
          <div class="avatar lg">${esc(initials(d.full_name))}</div>
          <h2 style="margin-top:14px" dir="auto">${esc(d.full_name)}</h2>
          <div class="muted">${esc(d.title)} ${d.active ? '' : '<span class="pill off">Inactive</span>'}</div>
          <dl class="kv">
            <dt>Username</dt><dd>@${esc(d.username)}</dd>
            <dt>Specialty</dt><dd dir="auto">${esc(d.specialty || '—')}</dd>
            <dt>Area</dt><dd dir="auto">${esc(d.area || '—')}</dd>
            <dt>Phone</dt><dd>${esc(d.phone || '—')}</dd>
            <dt>Joined</dt><dd>${fmtDate(d.created_at.slice(0, 10))}</dd>
            <dt>Last session</dt><dd>${fmtDate(d.stats.last_session)}</dd>
          </dl>
          ${d.bio ? `<p dir="auto" style="margin-top:16px">${esc(d.bio)}</p>` : ''}
        </aside>
        <div>
          <div class="stats" style="grid-template-columns:repeat(3,1fr)">
            <div class="stat"><div class="n">${d.stats.total}</div><div class="l">Sessions done</div></div>
            <div class="stat"><div class="n">${d.stats.this_month || 0}</div><div class="l">This month</div></div>
            <div class="stat"><div class="n">${d.stats.patients}</div><div class="l">Patients</div></div>
          </div>
          <section class="card" style="margin-bottom:16px"><h3 style="margin-bottom:10px">Patients</h3>
            ${patients.length ? `<div class="chips">${patients.map(p => `<span class="chip" dir="auto">${esc(p.patient_name)} · ${p.sessions}</span>`).join('')}</div>` : '<span class="muted">No patients yet.</span>'}
          </section>
          <section class="card" style="padding:16px 8px"><h3 style="padding:0 12px 6px">Session history</h3>${sessionRows(sessions, { showDoctor: false, editable: true })}</section>
        </div>
      </div>`;
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
    main.querySelector('#edit').onclick = () => modal(`<h2>Edit profile</h2><form>${doctorFormHtml(d)}
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" name="active" ${d.active ? 'checked' : ''} style="width:auto"> Active (can log in)</label>
        <div class="error"></div><div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Save</button></div></form>`, (m, close) => {
      m.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const body = formData(e.target); body.active = e.target.active.checked;
        try { await api(`/api/doctors/${id}`, { method: 'PUT', body }); close(); toast('Profile saved'); load(); }
        catch (err) { m.querySelector('.error').textContent = err.message; }
      };
    });
    main.querySelector('#reset').onclick = async () => {
      if (!confirm(`Give ${d.full_name} a new password? Their old one will stop working.`)) return;
      showCredentials('New password', await api(`/api/doctors/${id}/reset-password`, { method: 'POST' }));
    };
  };
  main.innerHTML = '<div class="empty">Loading…</div>';
  try { await load(); } catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ---------- admin: private AI room ----------
function md(text) {
  // Small, safe markdown: escape first, then **bold**, `code`, bullet lists, paragraphs.
  const lines = esc(text).split('\n');
  let out = '', list = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${li[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line.trim()) out += `<p dir="auto">${line.replace(/^#+\s*/, '')}</p>`;
  }
  return out + (list ? '</ul>' : '');
}

async function chatPage(main) {
  const ai = state.ai;
  const first = state.user.full_name.replace(/^Dr\.?\s*/i, '').split(' ')[0];
  main.innerHTML = `
    <div class="head"><div><h1>My AI room</h1><p class="muted">Private to you, ${esc(first)}. The other founders can't see this chat or its memory.</p></div></div>
    <div class="chat-wrap">
      <section class="card chat">
        <div class="chat-head">
          <strong>Nile Therapy assistant</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="model" aria-label="Model">${Object.entries(ai.models).map(([k, v]) => `<option value="${k}" ${k === ai.default ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
            <button class="btn ghost sm" id="clear">New chat</button>
          </div>
        </div>
        ${ai.connected ? '' : `<div class="banner">AI not connected yet — chat, history and memory work, but replies are placeholders until the Anthropic API key is added.</div>`}
        <div class="msgs" id="msgs"></div>
        <form class="composer" id="send">
          <textarea id="input" rows="1" dir="auto" placeholder="Ask about sessions, doctors, plans… (Enter to send, Shift+Enter for a new line)"></textarea>
          <button class="btn">Send</button>
        </form>
      </section>
      <aside class="card memory">
        <h3>🧠 What it remembers</h3>
        <p class="muted small">Things the AI saved about you and your plans. It uses these in every chat. Remove anything that's wrong.</p>
        <div id="mem"></div>
      </aside>
    </div>`;
  const msgsEl = main.querySelector('#msgs'), input = main.querySelector('#input');
  const suggestions = ['Which doctors had the most sessions this month?', 'Summarize this week for me in 5 bullet points', 'Which doctors haven\'t logged anything in the last 7 days?', 'remember: I want a weekly report every Saturday'];

  const drawMessages = list => {
    msgsEl.innerHTML = list.length ? list.map(m => `<div class="msg ${m.role}">${m.role === 'user' ? md(m.content) : md(m.content)}</div>`).join('')
      : `<div class="welcome"><h2>Ahlan, ${esc(first)}</h2><p>I can see every session and doctor in the portal. Ask me anything about the business.</p>
         <div class="suggest">${suggestions.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div></div>`;
    msgsEl.querySelectorAll('.suggest button').forEach(b => b.onclick = () => { input.value = b.textContent; main.querySelector('#send').requestSubmit(); });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  const drawMemory = mem => {
    main.querySelector('#mem').innerHTML = mem.length ? mem.map(m => `<div class="mem-item"><span dir="auto">${esc(m.content)}</span><button title="Forget this" aria-label="Forget this" data-mem="${m.id}">×</button></div>`).join('')
      : '<p class="muted small">Nothing yet.</p>';
    main.querySelectorAll('[data-mem]').forEach(b => b.onclick = async () => { await api(`/api/memory/${b.dataset.mem}`, { method: 'DELETE' }); refresh(); });
  };
  let messages = [];
  const refresh = async () => { const r = await api('/api/chat'); messages = r.messages; drawMessages(messages); drawMemory(r.memory); };

  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); main.querySelector('#send').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; });
  main.querySelector('#send').onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = ''; input.style.height = 'auto';
    messages.push({ role: 'user', content: text }); drawMessages(messages);
    msgsEl.insertAdjacentHTML('beforeend', '<div class="msg assistant thinking">Thinking…</div>'); msgsEl.scrollTop = msgsEl.scrollHeight;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await api('/api/chat', { method: 'POST', body: { message: text, model: main.querySelector('#model').value } });
      if (r.saved_memory?.length) toast('Saved to memory');
      await refresh();
    } catch (err) { messages.pop(); drawMessages(messages); input.value = text; toast(err.message); }
    btn.disabled = false; input.focus();
  };
  main.querySelector('#clear').onclick = async () => {
    if (!confirm('Start a new chat? This clears the conversation, but keeps what the AI remembers about you.')) return;
    await api('/api/chat', { method: 'DELETE' }); refresh();
  };
  refresh();
}

boot();
