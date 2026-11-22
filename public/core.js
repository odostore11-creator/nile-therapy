'use strict';
// Nile Therapy portal: shared setup, helpers, the data layer (Supabase) and small UI pieces.
// Load order (index.html): config, i18n, core, then the page files, and app.js last.
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
const today = () => new Date().toLocaleDateString('en-CA'); // local date, YYYY-MM-DD
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

async function callFunction(name, body, retried = false) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (!error) return data;
  if (error.context?.status === 401) {
    // The server no longer accepts this login (expired, or ended on the server). Renew it once and
    // retry; if that fails too, go back to the login page instead of leaving the user stuck.
    if (!retried && !(await sb.auth.refreshSession()).error) return callFunction(name, body, true);
    await sessionEnded();
    throw new Error(t('err.login'));
  }
  let msg = error.message;
  try { const j = await error.context.json(); msg = j.error || j.message || msg; } catch { /* not JSON */ }
  if (error.context?.status === 404) msg = t('err.fnMissing');
  throw new Error(friendly({ message: msg }));
}

/** Called when the server says the login is no longer valid: forget it here and show the login page. */
async function sessionEnded() {
  await sb.auth.signOut({ scope: 'local' }).catch(() => {});
  if (state.user) { state.user = null; location.hash = ''; render(); setTimeout(() => toast(t('err.login')), 50); }
}

async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  // Ask the server whether this login is still valid (it may have been ended on another device).
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); return null; }
  const me = check(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
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
/** Map links must be https; doctors must give one unless the session is online (the database checks this too). */
function checkMapLink(raw, type) {
  const url = String(raw || '').trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) throw new Error(t('err.mapLinkBad'));
  if (!url && state.user?.role === 'doctor' && type !== 'Online') throw new Error(t('err.mapLink'));
  return url;
}
/** A small "open in maps" link, only for https links. */
const mapLinkHtml = url => (/^https:\/\//i.test(url || '') ? ` <a class="map-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">🗺 ${t('form.openMap')}</a>` : '');

function sessionPayload(b) {
  const s = {
    patient_name: String(b.patient_name || '').trim(), location: String(b.location || '').trim(),
    session_date: b.session_date || '', session_time: b.session_time || null,
    session_type: b.session_type || '', notes: String(b.notes || '').trim(),
    duration_min: b.duration_min === '' || b.duration_min == null ? null : Math.max(0, Math.min(600, parseInt(b.duration_min, 10) || 0)),
  };
  if ('location_url' in b) s.location_url = checkMapLink(b.location_url, s.session_type);
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
  const cols = ['session_date', 'session_time', 'doctor_name', 'patient_name', 'session_type', 'location', 'location_url', 'duration_min', 'notes', 'created_at'];
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
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
  schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 13 6.5 5h11L20 13v6H4z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 17v-3M12 17v-6M15 17v-4"/></svg>',
};
// River waves in the logo's colors (light water, deep water, green bank).
const waves = `<svg class="waves" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true"><path d="M0 120c80-60 140 40 220-10s120-90 200-40 120 30 180-10v140H0Z" fill="#cfe4f1"/><path d="M0 150c90-40 150 30 240-5s130-60 210-20 100 20 150-5v80H0Z" fill="#93c4dc"/><path d="M0 172c90-30 160 22 250-4s140-44 220-14 90 14 130-2v48H0Z" fill="#0a78b4"/><path d="M0 70c100-60 160 60 260 0s140-70 220-30 90 20 120 0" fill="none" stroke="#9ccc84" stroke-width="3"/></svg>`;


// ---------- dialogs ----------
// A dialog on top of the page. Escape or a click outside closes only the top-most one;
// Tab stays inside it; focus goes back to where it was when it closes.
function modal(html, onMount, { onClose } = {}) {
  const before = document.activeElement;
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const onKey = e => {
    if ([...document.querySelectorAll('.modal-bg')].pop() !== bg) return; // only the top dialog reacts
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const items = [...bg.querySelectorAll('button, [href], input, select, textarea')].filter(el => !el.disabled && el.offsetParent);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  function close() {
    if (!bg.isConnected) return;
    bg.remove(); document.removeEventListener('keydown', onKey);
    if (before?.isConnected) before.focus();
    onClose?.();
  }
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  bg.querySelector('input, textarea, select, button')?.focus();
  onMount?.(bg.querySelector('.modal'), close);
}

// "Are you sure?" with a red confirm button, for anything that matters if pressed by accident.
// Resolves true only if the red button is pressed. Focus starts on "Go back", the safe choice.
function confirmAction({ title, message = '', confirm, danger = true }) {
  return new Promise(resolve => {
    let yes = false;
    modal(`<div class="confirm-box"><h2 dir="auto">${esc(title)}</h2>${message ? `<p class="muted" dir="auto">${esc(message)}</p>` : ''}
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.back')}</button>
      <button type="button" class="btn ${danger ? 'btn-red' : ''}" data-yes>${esc(confirm)}</button></div></div>`,
    (m, close) => { m.querySelector('[data-yes]').onclick = () => { yes = true; close(); }; },
    { onClose: () => resolve(yes) });
  });
}

