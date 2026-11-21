'use strict';
// Nile Therapy portal — single-page app, no framework.
// Data lives in Supabase. Who can see/change what is enforced by Row Level Security in the
// database (supabase/migrations), not by this file. Admin actions and the AI run in Edge Functions.
// All interface text is in i18n.js (English + Arabic); use t('key') here, never hard-coded words.

const $app = document.getElementById('app');
const CFG = window.NILE_CONFIG;
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
const SESSION_TYPES = ['Home visit', 'Clinic', 'Online']; // stored in English, shown translated
const state = { user: null, ai: { default: 'claude-sonnet-5-5', connected: null }, loginRole: 'admin', sessionsView: 'grouped' };

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = name => String(name || '?').replace(/^(Dr\.?|د\.)\s*/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(LANG === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const typeClass = v => /home/i.test(v) ? 'home' : /online/i.test(v) ? 'online' : '';
const typeLabel = v => (SESSION_TYPES.includes(v) ? t('type.' + v) : v);
const langButton = (cls = '') => `<button type="button" class="lang-btn ${cls}" data-lang title="${esc(t('lang.switchLabel'))}" lang="${LANG === 'ar' ? 'en' : 'ar'}">${t('lang.switch')}</button>`;
function wireLangButtons() {
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); render(); });
}

// ---------- data layer (Supabase) ----------
function friendly(e) {
  const m = e?.message || String(e);
  if (/JWT expired|not authenticated|invalid claim|session.*missing/i.test(m)) return t('err.login');
  if (/row-level security|permission denied/i.test(m)) return t('err.notAllowed');
  if (/violates check constraint/i.test(m)) return t('err.invalid');
  if (/Failed to fetch|NetworkError/i.test(m)) return t('err.network');
  return trServer(m);
}
function check({ data, error }) { if (error) throw new Error(friendly(error)); return data; }
const loginEmail = username => `${String(username || '').trim().toLowerCase()}@${CFG.loginEmailDomain}`;

async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  let msg = error.message;
  try { const j = await error.context.json(); msg = j.error || j.message || msg; } catch { /* not JSON */ }
  if (error.context?.status === 404) msg = t('err.fnMissing');
  throw new Error(friendly({ message: msg }));
}

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const me = check(await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
  if (!me || !me.active) { await sb.auth.signOut(); return null; }
  return me;
}

const normalizeSession = s => ({
  ...s,
  session_time: s.session_time ? s.session_time.slice(0, 5) : '',
  doctor_name: s.doctor?.full_name || '',
  doctor_username: s.doctor?.username || '',
});
async function listSessions({ doctorId, from, to, q } = {}) {
  const term = String(q || '').replace(/["\\,()]/g, ' ').trim().slice(0, 100);
  const out = [];
  for (let start = 0; ; start += 1000) { // Supabase returns at most 1000 rows per request
    let query = sb.from('sessions').select('*, doctor:profiles!sessions_doctor_id_fkey(full_name, username)')
      .order('session_date', { ascending: false })
      .order('session_time', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(start, start + 999);
    if (doctorId) query = query.eq('doctor_id', doctorId);
    if (from) query = query.gte('session_date', from);
    if (to) query = query.lte('session_date', to);
    if (term) query = query.or(['patient_name', 'location', 'notes'].map(c => `${c}.ilike."%${term}%"`).join(','));
    const rows = check(await query);
    out.push(...rows.map(normalizeSession));
    if (rows.length < 1000) return out;
  }
}
function sessionPayload(b) {
  const s = {
    patient_name: String(b.patient_name || '').trim(), location: String(b.location || '').trim(),
    session_date: b.session_date || '', session_time: b.session_time || null,
    session_type: b.session_type || '', notes: String(b.notes || '').trim(),
    duration_min: b.duration_min === '' || b.duration_min == null ? null : Math.max(0, Math.min(600, parseInt(b.duration_min, 10) || 0)),
  };
  if (!s.patient_name) throw new Error(t('err.patient'));
  if (!s.location) throw new Error(t('err.location'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.session_date)) throw new Error(t('err.date'));
  return s;
}
async function addSession(b, doctorId) {
  if (!doctorId) throw new Error(t('err.pickDoctor'));
  check(await sb.from('sessions').insert({ ...sessionPayload(b), doctor_id: doctorId }));
}
async function updateSession(id, b) {
  const rows = check(await sb.from('sessions').update(sessionPayload(b)).eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}
async function deleteSession(id) {
  const rows = check(await sb.from('sessions').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}

const statsFor = s => ({ total: s?.total ?? 0, this_month: s?.this_month ?? 0, patients: s?.patients ?? 0, last_session: s?.last_session ?? null });
async function listDoctors() {
  const [docs, stats] = await Promise.all([
    sb.from('profiles').select('*').eq('role', 'doctor').order('active', { ascending: false }).order('full_name'),
    sb.from('doctor_stats').select('*'),
  ]);
  const byId = new Map(check(stats).map(s => [s.doctor_id, s]));
  return check(docs).map(d => ({ ...d, stats: statsFor(byId.get(d.id)) }));
}
async function getDoctor(id) {
  const [doc, stats, sessions] = await Promise.all([
    sb.from('profiles').select('*').eq('id', id).eq('role', 'doctor').maybeSingle(),
    sb.from('doctor_stats').select('*').eq('doctor_id', id).maybeSingle(),
    listSessions({ doctorId: id }),
  ]);
  const d = check(doc);
  if (!d) throw new Error(t('err.noDoctor'));
  const byPatient = new Map();
  for (const s of sessions) {
    const p = byPatient.get(s.patient_name) || { patient_name: s.patient_name, sessions: 0, last: '' };
    p.sessions++; if (s.session_date > p.last) p.last = s.session_date;
    byPatient.set(s.patient_name, p);
  }
  const patients = [...byPatient.values()].sort((a, b) => b.last.localeCompare(a.last));
  return { doctor: { ...d, stats: statsFor(check(stats)) }, sessions, patients };
}
async function updateDoctor(id, b) {
  const rows = check(await sb.from('profiles').update({
    full_name: String(b.full_name || '').trim(), title: String(b.title || '').trim(), specialty: String(b.specialty || '').trim(),
    phone: String(b.phone || '').trim(), area: String(b.area || '').trim(), bio: String(b.bio || '').trim(), active: !!b.active,
  }).eq('id', id).eq('role', 'doctor').select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  const risky = /^[=+\-@]/.test(s); // stop Excel from running formulas
  return /[",\n\r]/.test(s) || risky ? `"${(risky ? "'" : '') + s.replace(/"/g, '""')}"` : s;
}
async function downloadCsv(filters) {
  const rows = await listSessions(filters);
  const cols = ['session_date', 'session_time', 'doctor_name', 'patient_name', 'session_type', 'location', 'duration_min', 'notes', 'created_at'];
  const csv = '\uFEFF' + [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `nile-therapy-sessions-${today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

const icons = {
  sessions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  doctors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01" stroke-width="2.6" stroke-linecap="round"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};
// River waves in the logo's colors (light water, deep water, green bank).
const waves = `<svg class="waves" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120c80-60 140 40 220-10s120-90 200-40 120 30 180-10v140H0Z" fill="#cfe4f1"/><path d="M0 150c90-40 150 30 240-5s130-60 210-20 100 20 150-5v80H0Z" fill="#93c4dc"/><path d="M0 172c90-30 160 22 250-4s140-44 220-14 90 14 130-2v48H0Z" fill="#0a78b4"/><path d="M0 70c100-60 160 60 260 0s140-70 220-30 90 20 120 0" fill="none" stroke="#9ccc84" stroke-width="3"/></svg>`;

// ---------- routing ----------
function route() { return (location.hash.replace(/^#\/?/, '') || '').split('/'); }
window.addEventListener('hashchange', render);

async function boot() {
  try { state.user = await loadMe(); } catch { state.user = null; }
  sb.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && state.user) { state.user = null; location.hash = ''; render(); }
  });
  render();
}

function render() {
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  if (!state.user) return renderLogin();
  const [page, arg] = route();
  if (state.user.role === 'doctor') return shell('log', doctorPortal);
  if (page === 'doctors' && arg) return shell('doctors', el => doctorProfile(el, arg));
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
      <img class="login-logo" src="logo-full.png" alt="Nile Therapy" width="280" height="238">
      <div>
        <h1>${t('login.tagline')}</h1>
        <p>${t('login.intro')}</p>
      </div>
      <p class="small">${t('login.internal')}</p>
      ${waves}
    </section>
    <section class="login-form">
      ${langButton('corner')}
      <form class="login-card" id="login">
        <h2>${t('login.title')}</h2>
        <p class="muted">${t('login.help')}</p>
        <div class="role-switch" role="tablist">
          <button type="button" role="tab" aria-selected="${admin}" class="${admin ? 'on' : ''}" data-role="admin">${t('role.founder')}</button>
          <button type="button" role="tab" aria-selected="${!admin}" class="${!admin ? 'on' : ''}" data-role="doctor">${t('role.doctor')}</button>
        </div>
        <div class="field"><label for="u">${t('login.username')}</label><input id="u" name="username" dir="ltr" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus placeholder="${esc(t(admin ? 'login.ph.admin' : 'login.ph.doctor'))}"></div>
        <div class="field"><label for="p">${t('login.password')}</label><input id="p" name="password" dir="ltr" type="password" autocomplete="current-password" required></div>
        <button class="btn block" type="submit">${t(admin ? 'login.go.admin' : 'login.go.doctor')}</button>
        <div class="error" id="err" role="alert"></div>
      </form>
    </section>
  </div>`;
  wireLangButtons();
  $app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { state.loginRole = b.dataset.role; renderLogin(); });
  document.getElementById('login').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const b = formData(e.target);
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(b.username), password: String(b.password || '') });
      if (error) throw new Error(/invalid login credentials/i.test(error.message) ? t('err.wrongLogin')
        : /rate limit|too many/i.test(error.message) ? t('err.tooMany') : friendly(error));
      const me = await loadMe();
      if (!me) throw new Error(t('err.accountOff'));
      if (me.role !== state.loginRole) toast(t(me.role === 'admin' ? 'login.asFounder' : 'login.asDoctor'));
      state.user = me;
      location.hash = me.role === 'admin' ? '#/sessions' : '#/log';
      render();
    } catch (err) { document.getElementById('err').textContent = err.message; btn.disabled = false; }
  };
}

// ---------- layout ----------
function shell(active, renderPage) {
  const u = state.user;
  const nav = u.role === 'admin'
    ? [['sessions', t('nav.sessions'), icons.sessions], ['doctors', t('nav.doctors'), icons.doctors], ['chat', t('nav.chat'), icons.chat]]
    : [['log', t('nav.log'), icons.log]];
  $app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <div class="brand"><span class="brand-mark"><img src="logo-mark.png" alt="" width="40" height="40"></span> Nile Therapy</div>
      <nav class="nav-list">${nav.map(([k, label, ic]) => `<a class="nav ${active === k ? 'on' : ''}" href="#/${k}" ${active === k ? 'aria-current="page"' : ''}>${ic}${label}</a>`).join('')}</nav>
      <div class="spacer"></div>
      <div class="me">
        <strong dir="auto">${esc(u.full_name)}</strong><span class="muted" dir="auto">${esc(u.title || t(u.role === 'admin' ? 'role.founder' : 'role.doctor'))}</span>
        <div class="row"><button id="pw">${t('me.password')}</button><button id="out">${t('me.logout')}</button>${langButton()}</div>
      </div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  wireLangButtons();
  document.getElementById('out').onclick = async () => { state.user = null; location.hash = ''; await sb.auth.signOut(); render(); };
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
  modal(`<h2>${t('pw.title')}</h2>
    <form id="pwf">
      <div class="field"><label>${t('pw.current')}</label><input name="current" dir="ltr" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>${t('pw.new')}</label><input name="next" dir="ltr" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="error" id="pwerr" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div>
    </form>`, (m, close) => {
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try {
        const b = formData(e.target);
        if (String(b.next || '').length < 8) throw new Error(t('err.pwShort'));
        // Supabase doesn't ask for the old password, so check it ourselves first.
        const { error: wrong } = await sb.auth.signInWithPassword({ email: loginEmail(state.user.username), password: String(b.current || '') });
        if (wrong) throw new Error(t('err.pwWrong'));
        const { error } = await sb.auth.updateUser({ password: String(b.next) });
        if (error) throw new Error(friendly(error));
        await sb.auth.signOut({ scope: 'others' }); // log out other devices, like v0.1
        close(); toast(t('pw.done'));
      }
      catch (err) { m.querySelector('#pwerr').textContent = err.message; }
    };
  });
}

// ---------- session form (shared by doctors and founders) ----------
function sessionFormHtml(s = {}, { doctors } = {}) {
  const type = s.session_type || 'Home visit';
  return `
    ${doctors ? `<div class="field"><label>${t('form.doctor')}</label><select name="doctor_id" required><option value="">${t('form.choose')}</option>${doctors.filter(d => d.active).map(d => `<option value="${d.id}" ${s.doctor_id === d.id ? 'selected' : ''}>${esc(d.full_name)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>${t('form.patient')}</label><input name="patient_name" dir="auto" required value="${esc(s.patient_name)}" placeholder="${esc(t('form.patient.ph'))}"></div>
    <div class="field"><label>${t('form.type')}</label>
      <input type="hidden" name="session_type" value="${esc(type)}">
      <div class="type-pick">${SESSION_TYPES.map(v => `<button type="button" data-type="${v}" class="${v === type ? 'on' : ''}" aria-pressed="${v === type}">${typeLabel(v)}</button>`).join('')}</div>
    </div>
    <div class="field"><label>${t('form.where')}</label><input name="location" dir="auto" required value="${esc(s.location)}" placeholder="${esc(t('form.where.ph'))}"></div>
    <div class="grid3">
      <div class="field"><label>${t('form.date')}</label><input name="session_date" type="date" required value="${esc(s.session_date || today())}" max="${today()}"></div>
      <div class="field"><label>${t('form.time')}</label><input name="session_time" type="time" value="${esc(s.session_time)}"></div>
      <div class="field"><label>${t('form.minutes')}</label><input name="duration_min" type="number" min="0" max="600" step="5" value="${esc(s.duration_min ?? 45)}"></div>
    </div>
    <div class="field"><label>${t('form.notes')} <span class="muted">${t('form.optional')}</span></label><textarea name="notes" dir="auto" placeholder="${esc(t('form.notes.ph'))}">${esc(s.notes)}</textarea></div>`;
}
function wireTypePick(root) {
  root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
    root.querySelectorAll('[data-type]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    root.querySelector('[name=session_type]').value = b.dataset.type;
    const loc = root.querySelector('[name=location]');
    if (b.dataset.type === 'Online' && !loc.value) loc.value = t('form.videoCall');
  });
}
function editSessionModal(s, onDone) {
  modal(`<h2>${t('edit.title')}</h2><form>${sessionFormHtml(s)}<div class="error" role="alert"></div>
    <div class="actions"><button type="button" class="btn danger" data-del>${t('common.delete')}</button><span style="flex:1"></span><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div></form>`,
  (m, close) => {
    const f = m.querySelector('form'); wireTypePick(f);
    f.onsubmit = async e => {
      e.preventDefault();
      try { await updateSession(s.id, formData(f)); close(); toast(t('edit.updated')); onDone(); }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    };
    m.querySelector('[data-del]').onclick = async () => {
      if (!confirm(t('edit.confirmDelete'))) return;
      try { await deleteSession(s.id); close(); toast(t('edit.deleted')); onDone(); }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    };
  });
}

function sessionRows(list, { showDoctor = true, editable = false } = {}) {
  if (!list.length) return `<div class="empty">${t('table.empty')}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>${t('th.date')}</th>${showDoctor ? `<th>${t('th.doctor')}</th>` : ''}<th>${t('th.patient')}</th><th>${t('th.type')}</th><th>${t('th.location')}</th><th>${t('th.min')}</th><th>${t('th.notes')}</th>${editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${list.map(s => `<tr>
      <td style="white-space:nowrap">${fmtDate(s.session_date)}<div class="muted small">${esc(s.session_time)}</div></td>
      ${showDoctor ? `<td><a href="#/doctors/${s.doctor_id}" dir="auto">${esc(s.doctor_name)}</a></td>` : ''}
      <td dir="auto" style="white-space:nowrap"><strong>${esc(s.patient_name)}</strong></td>
      <td>${s.session_type ? `<span class="pill ${typeClass(s.session_type)}">${esc(typeLabel(s.session_type))}</span>` : ''}</td>
      <td dir="auto">${esc(s.location)}</td>
      <td>${esc(s.duration_min ?? '')}</td>
      <td dir="auto" class="small">${esc(s.notes)}</td>
      ${editable ? `<td><button class="btn ghost sm" data-edit="${s.id}">${t('common.edit')}</button></td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- doctor portal ----------
async function doctorPortal(main) {
  const u = state.user;
  main.innerHTML = `
    <div class="head"><div><h1 dir="auto">${esc(t('portal.hi', { name: u.full_name.split(' ').slice(0, 2).join(' ') }))}</h1><p class="muted">${t('portal.sub')}</p></div></div>
    <div class="portal">
      <form class="card" id="new">
        <h2 style="margin-bottom:16px">${t('portal.log')}</h2>
        ${sessionFormHtml()}
        <button class="btn block">${t('portal.submit')}</button>
        <div class="error" role="alert"></div>
      </form>
      <section class="card"><div class="head" style="margin-bottom:10px"><h2>${t('portal.mine')}</h2><span class="muted small" id="count"></span></div><div id="mine"><div class="empty">${t('common.loading')}</div></div></section>
    </div>`;
  const form = main.querySelector('#new'); wireTypePick(form);
  const load = async () => {
    const sessions = await listSessions({ doctorId: u.id });
    main.querySelector('#count').textContent = t('portal.total', { n: sessions.length });
    main.querySelector('#mine').innerHTML = sessionRows(sessions, { showDoctor: false, editable: true });
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('.btn.block'); btn.disabled = true;
    try {
      await addSession(formData(form), u.id);
      toast(t('portal.thanks'));
      const keep = form.querySelector('[name=session_type]').value;
      form.reset(); form.querySelector('[name=session_type]').value = keep;
      form.querySelector('[name=session_date]').value = today();
      form.querySelector('.error').textContent = '';
      load();
    } catch (err) { form.querySelector('.error').textContent = err.message; }
    btn.disabled = false;
  };
  load().catch(err => { main.querySelector('#mine').innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

// ---------- admin: sessions ----------
async function sessionsPage(main) {
  let doctors;
  try { doctors = await listDoctors(); }
  catch (err) { main.innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
  main.innerHTML = `
    <div class="head">
      <div><h1>${t('sessions.title')}</h1><p class="muted">${t('sessions.sub')}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="add">${t('sessions.add')}</button><button class="btn" id="csv">${t('sessions.csv')}</button></div>
    </div>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <div class="field grow"><label for="q">${t('sessions.search')}</label><input id="q" placeholder="${esc(t('sessions.search.ph'))}" dir="auto"></div>
      <div class="field"><label for="doc">${t('form.doctor')}</label><select id="doc"><option value="">${t('sessions.allDoctors')}</option>${doctors.map(d => `<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}</select></div>
      <div class="field"><label for="from">${t('sessions.from')}</label><input id="from" type="date"></div>
      <div class="field"><label for="to">${t('sessions.to')}</label><input id="to" type="date"></div>
      <div class="seg" role="group" aria-label="${esc(t('sessions.view'))}"><button data-view="grouped">${t('sessions.byDoctor')}</button><button data-view="list">${t('sessions.oneList')}</button></div>
    </div>
    <div id="list"><div class="empty">${t('common.loading')}</div></div>`;
  const f = id => main.querySelector('#' + id);
  const setView = () => main.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('on', b.dataset.view === state.sessionsView); b.setAttribute('aria-pressed', b.dataset.view === state.sessionsView); });
  setView();

  const filters = () => ({ q: f('q').value, doctorId: f('doc').value || null, from: f('from').value, to: f('to').value });
  f('csv').onclick = async () => {
    f('csv').disabled = true;
    try { await downloadCsv(filters()); } catch (err) { toast(err.message); }
    f('csv').disabled = false;
  };
  let loadNo = 0;
  const load = async () => {
    const mine = ++loadNo; // ignore slow, out-of-date responses while typing
    let sessions;
    try { sessions = await listSessions(filters()); }
    catch (err) { f('list').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    if (mine !== loadNo) return;
    const month = today().slice(0, 7);
    const thisMonth = sessions.filter(s => s.session_date.startsWith(month)).length;
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    f('stats').innerHTML = [
      [sessions.length, t('sessions.stat.filtered')],
      [thisMonth, t('sessions.stat.month')],
      [sessions.filter(s => s.session_date >= weekAgo).length, t('sessions.stat.week')],
      [`<bdi dir="ltr">${new Set(sessions.map(s => s.doctor_id)).size} / ${doctors.filter(d => d.active).length}</bdi>`, t('sessions.stat.active')],
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
              <div><h3 dir="auto">${esc(list[0].doctor_name)}</h3><span class="muted small"><bdi dir="ltr">@${esc(list[0].doctor_username)}</bdi> · ${t('sessions.count', list.length)}</span></div></div>
            <a class="btn ghost sm" href="#/doctors/${id}">${t('sessions.profile')}</a>
          </div>
          ${sessionRows(list, { showDoctor: false, editable: true })}
        </section>`).join('') : `<div class="card empty">${t('sessions.noMatch')}</div>`;
    }
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
  };
  let timer; f('q').oninput = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  ['doc', 'from', 'to'].forEach(id => f(id).onchange = load);
  main.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.sessionsView = b.dataset.view; setView(); load(); });
  f('add').onclick = () => modal(`<h2>${t('sessions.addTitle')}</h2><form>${sessionFormHtml({}, { doctors })}<div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('sessions.addBtn')}</button></div></form>`, (m, close) => {
    const form = m.querySelector('form'); wireTypePick(form);
    form.onsubmit = async e => {
      e.preventDefault();
      try { const b = formData(form); await addSession(b, b.doctor_id); close(); toast(t('sessions.added')); load(); }
      catch (err) { form.querySelector('.error').textContent = err.message; }
    };
  });
  load();
}

// ---------- admin: doctors ----------
function doctorFormHtml(d = {}) {
  return `
    <div class="grid2">
      <div class="field"><label>${t('doc.fullName')}</label><input name="full_name" required dir="auto" value="${esc(d.full_name)}" placeholder="${esc(t('doc.fullName.ph'))}"></div>
      ${d.id ? `<div class="field"><label>${t('doc.username')}</label><input value="${esc(d.username)}" dir="ltr" disabled></div>`
             : `<div class="field"><label>${t('doc.usernameNew')}</label><input name="username" dir="ltr" autocapitalize="none" spellcheck="false" required pattern="[a-zA-Z0-9._\\-]{3,40}" placeholder="dr.firstname"></div>`}
    </div>
    <div class="grid2">
      <div class="field"><label>${t('doc.title')}</label><input name="title" dir="auto" value="${esc(d.id ? d.title : t('doc.titleDefault'))}"></div>
      <div class="field"><label>${t('doc.specialty')}</label><input name="specialty" dir="auto" value="${esc(d.specialty)}" placeholder="${esc(t('doc.specialty.ph'))}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>${t('doc.phone')}</label><input name="phone" dir="ltr" value="${esc(d.phone)}" placeholder="01x xxxx xxxx"></div>
      <div class="field"><label>${t('doc.area')}</label><input name="area" dir="auto" value="${esc(d.area)}" placeholder="${esc(t('doc.area.ph'))}"></div>
    </div>
    <div class="field"><label>${t('doc.about')}</label><textarea name="bio" dir="auto">${esc(d.bio)}</textarea></div>`;
}
function showCredentials(title, { username, password }) {
  modal(`<h2>${esc(title)}</h2>
    <p>${t('creds.intro')}</p>
    <div class="secret" dir="ltr">${esc(t('creds.username'))}: ${esc(username)}<br>${esc(t('creds.password'))}: ${esc(password)}</div>
    <div class="actions"><button class="btn ghost" id="copy">${t('common.copy')}</button><button class="btn" data-close>${t('common.done')}</button></div>`, m => {
    m.querySelector('#copy').onclick = () => { navigator.clipboard?.writeText(`${t('creds.portal')}\n${t('creds.username')}: ${username}\n${t('creds.password')}: ${password}`); toast(t('common.copied')); };
  });
}

async function doctorsPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('doctors.title')}</h1><p class="muted">${t('doctors.sub')}</p></div><button class="btn" id="add">${t('doctors.add')}</button></div><div id="grid" class="doc-grid"></div>`;
  const load = async () => {
    let doctors;
    try { doctors = await listDoctors(); }
    catch (err) { main.querySelector('#grid').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    main.querySelector('#grid').innerHTML = doctors.length ? doctors.map(d => `
      <button class="card doc" data-id="${d.id}">
        <div class="doc-top"><div class="avatar">${esc(initials(d.full_name))}</div>
          <div><h3 dir="auto">${esc(d.full_name)}</h3><div class="muted small" dir="auto">${esc(d.specialty || d.title)}</div></div></div>
        <div class="muted small" style="margin-bottom:12px"><span dir="auto">${esc(d.area || '—')}</span> ${d.active ? '' : `<span class="pill off">${t('doctors.inactive')}</span>`}</div>
        <div class="doc-nums"><div><b>${d.stats.total}</b><span>${t('doctors.n.sessions')}</span></div><div><b>${d.stats.this_month || 0}</b><span>${t('doctors.n.month')}</span></div><div><b>${d.stats.patients}</b><span>${t('doctors.n.patients')}</span></div></div>
      </button>`).join('') : `<div class="card empty">${t('doctors.none')}</div>`;
    main.querySelectorAll('[data-id]').forEach(b => b.onclick = () => location.hash = `#/doctors/${b.dataset.id}`);
  };
  main.querySelector('#add').onclick = () => modal(`<h2>${t('doctors.addTitle')}</h2><form>${doctorFormHtml()}<div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('doctors.create')}</button></div></form>`, (m, close) => {
    m.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      try {
        const r = await callFunction('admin-doctors', { action: 'create', ...formData(e.target) });
        close(); load(); showCredentials(t('doctors.created'), r);
      }
      catch (err) { m.querySelector('.error').textContent = err.message; }
    };
  });
  load();
}

async function doctorProfile(main, id) {
  const load = async () => {
    const { doctor: d, sessions, patients } = await getDoctor(id);
    main.innerHTML = `
      <div class="head"><div><a href="#/doctors" class="small">${t('profile.back')}</a><h1 dir="auto" style="margin-top:6px">${esc(d.full_name)}</h1></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="reset">${t('profile.reset')}</button><button class="btn" id="edit">${t('profile.edit')}</button></div></div>
      <div class="profile">
        <aside class="card">
          <div class="avatar lg">${esc(initials(d.full_name))}</div>
          <h2 style="margin-top:14px" dir="auto">${esc(d.full_name)}</h2>
          <div class="muted"><span dir="auto">${esc(d.title)}</span> ${d.active ? '' : `<span class="pill off">${t('doctors.inactive')}</span>`}</div>
          <dl class="kv">
            <dt>${t('doc.username')}</dt><dd><bdi dir="ltr">@${esc(d.username)}</bdi></dd>
            <dt>${t('doc.specialty')}</dt><dd dir="auto">${esc(d.specialty || '—')}</dd>
            <dt>${t('doc.area')}</dt><dd dir="auto">${esc(d.area || '—')}</dd>
            <dt>${t('doc.phone')}</dt><dd><bdi dir="ltr">${esc(d.phone || '—')}</bdi></dd>
            <dt>${t('profile.joined')}</dt><dd>${fmtDate(d.created_at.slice(0, 10))}</dd>
            <dt>${t('profile.last')}</dt><dd>${fmtDate(d.stats.last_session)}</dd>
          </dl>
          ${d.bio ? `<p dir="auto" style="margin-top:16px">${esc(d.bio)}</p>` : ''}
        </aside>
        <div>
          <div class="stats" style="grid-template-columns:repeat(3,1fr)">
            <div class="stat"><div class="n">${d.stats.total}</div><div class="l">${t('profile.done')}</div></div>
            <div class="stat"><div class="n">${d.stats.this_month || 0}</div><div class="l">${t('sessions.stat.month')}</div></div>
            <div class="stat"><div class="n">${d.stats.patients}</div><div class="l">${t('profile.patients')}</div></div>
          </div>
          <section class="card" style="margin-bottom:16px"><h3 style="margin-bottom:10px">${t('profile.patients')}</h3>
            ${patients.length ? `<div class="chips">${patients.map(p => `<span class="chip"><bdi>${esc(p.patient_name)}</bdi> · ${p.sessions}</span>`).join('')}</div>` : `<span class="muted">${t('profile.noPatients')}</span>`}
          </section>
          <section class="card" style="padding:16px 8px"><h3 style="padding:0 12px 6px">${t('profile.history')}</h3>${sessionRows(sessions, { showDoctor: false, editable: true })}</section>
        </div>
      </div>`;
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
    main.querySelector('#edit').onclick = () => modal(`<h2>${t('profile.edit')}</h2><form>${doctorFormHtml(d)}
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" name="active" ${d.active ? 'checked' : ''} style="width:auto"> ${t('profile.active')}</label>
        <div class="error" role="alert"></div><div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div></form>`, (m, close) => {
      m.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const body = formData(e.target); body.active = e.target.active.checked;
        try { await updateDoctor(id, body); close(); toast(t('profile.saved')); load(); }
        catch (err) { m.querySelector('.error').textContent = err.message; }
      };
    });
    main.querySelector('#reset').onclick = async () => {
      if (!confirm(t('profile.confirmReset', { name: d.full_name }))) return;
      try { showCredentials(t('profile.newPw'), await callFunction('admin-doctors', { action: 'reset_password', doctor_id: id })); }
      catch (err) { toast(err.message); }
    };
  };
  main.innerHTML = `<div class="empty">${t('common.loading')}</div>`;
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
    if (li) { if (!list) { out += '<ul dir="auto">'; list = true; } out += `<li>${li[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line.trim()) out += `<p dir="auto">${line.replace(/^#+\s*/, '')}</p>`;
  }
  return out + (list ? '</ul>' : '');
}

async function chatPage(main) {
  const ai = state.ai;
  const first = state.user.full_name.replace(/^(Dr\.?|د\.)\s*/i, '').split(' ')[0];
  main.innerHTML = `
    <div class="head"><div><h1>${t('chat.title')}</h1><p class="muted">${esc(t('chat.sub', { name: first }))}</p></div></div>
    <div class="chat-wrap">
      <section class="card chat">
        <div class="chat-head">
          <strong>${t('chat.assistant')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="model" aria-label="${esc(t('chat.model'))}">${MODELS.map(k => `<option value="${k}" ${k === ai.default ? 'selected' : ''}>${esc(t('model.' + k))}</option>`).join('')}</select>
            <button class="btn ghost sm" id="clear">${t('chat.new')}</button>
          </div>
        </div>
        <div class="banner" id="aibanner" hidden></div>
        <div class="msgs" id="msgs" aria-live="polite"></div>
        <form class="composer" id="send">
          <textarea id="input" rows="1" dir="auto" aria-label="${esc(t('chat.send'))}" placeholder="${esc(t('chat.input.ph'))}"></textarea>
          <button class="btn">${t('chat.send')}</button>
        </form>
      </section>
      <aside class="card memory">
        <h3>🧠 ${t('chat.memory')}</h3>
        <p class="muted small">${t('chat.memory.sub')}</p>
        <div id="mem"></div>
      </aside>
    </div>`;
  const msgsEl = main.querySelector('#msgs'), input = main.querySelector('#input');
  const suggestions = t('chat.suggest');

  const drawMessages = list => {
    msgsEl.innerHTML = list.length ? list.map(m => `<div class="msg ${m.role}">${md(m.content)}</div>`).join('')
      : `<div class="welcome"><h2>${esc(t('chat.welcome', { name: first }))}</h2><p>${t('chat.welcome.sub')}</p>
         <div class="suggest">${suggestions.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div></div>`;
    msgsEl.querySelectorAll('.suggest button').forEach(b => b.onclick = () => { input.value = b.textContent; main.querySelector('#send').requestSubmit(); });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  const drawMemory = mem => {
    main.querySelector('#mem').innerHTML = mem.length ? mem.map(m => `<div class="mem-item"><span dir="auto">${esc(m.content)}</span><button title="${esc(t('chat.forget'))}" aria-label="${esc(t('chat.forget'))}" data-mem="${m.id}">×</button></div>`).join('')
      : `<p class="muted small">${t('chat.nothing')}</p>`;
    main.querySelectorAll('[data-mem]').forEach(b => b.onclick = async () => {
      try { check(await sb.from('founder_memory').delete().eq('id', b.dataset.mem).eq('founder_id', state.user.id)); refresh(); }
      catch (err) { toast(err.message); }
    });
  };
  const banner = text => { const el = main.querySelector('#aibanner'); el.hidden = !text; el.textContent = text || ''; };
  const showAiStatus = () => banner(state.ai.connected === false ? t('chat.off') : state.ai.connected === 'missing' ? t('chat.missing') : '');
  let messages = [];
  const refresh = async () => {
    const [msgs, mem] = await Promise.all([
      sb.from('chat_messages').select('id, role, content, model, created_at').eq('founder_id', state.user.id).order('id'),
      sb.from('founder_memory').select('id, content, created_at').eq('founder_id', state.user.id).order('id', { ascending: false }),
    ]);
    messages = check(msgs); drawMessages(messages); drawMemory(check(mem));
  };
  callFunction('ai-chat', { action: 'status' })
    .then(r => { state.ai.connected = !!r.connected; })
    .catch(() => { state.ai.connected = 'missing'; })
    .finally(showAiStatus);

  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); main.querySelector('#send').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; });
  main.querySelector('#send').onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = ''; input.style.height = 'auto';
    messages.push({ role: 'user', content: text }); drawMessages(messages);
    msgsEl.insertAdjacentHTML('beforeend', `<div class="msg assistant thinking">${t('chat.thinking')}</div>`); msgsEl.scrollTop = msgsEl.scrollHeight;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await callFunction('ai-chat', { action: 'send', message: text, model: main.querySelector('#model').value });
      if (r.saved_memory?.length) toast(t('chat.savedMem'));
      if (typeof r.connected === 'boolean' && r.connected !== state.ai.connected) { state.ai.connected = r.connected; showAiStatus(); }
      await refresh();
    } catch (err) { messages.pop(); drawMessages(messages); input.value = text; toast(err.message); }
    btn.disabled = false; input.focus();
  };
  main.querySelector('#clear').onclick = async () => {
    if (!confirm(t('chat.confirmNew'))) return;
    try { check(await sb.from('chat_messages').delete().eq('founder_id', state.user.id)); refresh(); }
    catch (err) { toast(err.message); }
  };
  refresh().catch(err => { msgsEl.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

boot();
