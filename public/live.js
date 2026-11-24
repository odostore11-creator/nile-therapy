'use strict';
// Live portal: (1) listens for changes in the database (Supabase Realtime) and redraws the open page within
// a second; (2) switches open tabs to a newly published version. It never throws away something being typed:
// if a dialog is open or a field on the page was touched, a small "New updates · Show" bar appears instead.
// Realtime applies RLS, so everyone only hears about rows they can already read (tables: migration 20261124020000).

const LIVE_TABLES = ['sessions', 'appointments', 'patients', 'patient_requests', 'doctor_areas', 'founder_events', 'session_fees', 'tech_notes', 'profiles', 'change_log', 'referrals', 'partner_profiles'];
// Pages with a map editor or the AI room are never redrawn under the user; they get the bar.
const LIVE_BAR_ONLY = new Set(['coverage', 'requests', 'chat']);
const live = { ch: null, timer: null, pending: false, page: null, dirty: false };

// shell() / techShell() tell us which page is open and how to draw it again.
function setLivePage(key, draw, el) { live.page = { key, draw, el }; live.dirty = false; hideLiveBar(); }

function startLive() {
  if (live.ch || !state.user) return;
  live.ch = sb.channel('nt-live');
  LIVE_TABLES.forEach(table => live.ch.on('postgres_changes', { event: '*', schema: 'public', table }, onLiveChange));
  live.ch.subscribe();
}
function stopLive() {
  if (live.ch) { sb.removeChannel(live.ch); live.ch = null; }
  clearTimeout(live.timer); live.page = null; hideLiveBar();
}

function onLiveChange(p) {
  document.dispatchEvent(new CustomEvent('nt-live', { detail: p })); // open dialogs (e.g. the notes box) refresh themselves
  liveToast(p);
  clearTimeout(live.timer);
  live.timer = setTimeout(liveRefresh, 700); // several changes in a row = one redraw
}

function liveToast(p) {
  if (p.table === 'referrals') {
    if (isFounder() && p.eventType === 'INSERT') toast(t('live.refNew'));
    else if (isPartner() && p.eventType === 'UPDATE') toast(t('live.refUpdated'));
    return;
  }
  if (p.table !== 'tech_notes') return;
  if (isTech() && p.eventType === 'INSERT') toast(t('live.noteNew'));
  else if (isFounder() && p.eventType === 'UPDATE' && p.new?.author_id === state.user.id) toast(t('live.noteUpdated'));
}

const userBusy = () => !!document.querySelector('.modal-bg') || live.dirty
  || (document.activeElement?.closest?.('#main') && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));

function liveRefresh() {
  if (typeof refreshAlerts === 'function' && !isTech() && !isPartner()) refreshAlerts();
  refreshReferralBadge();
  const pg = live.page;
  if (!pg || !pg.el.isConnected) return;
  if (document.hidden) { live.pending = true; return; }
  if (LIVE_BAR_ONLY.has(pg.key) || userBusy()) return showLiveBar('updates');
  redrawLivePage();
}

function redrawLivePage() {
  const pg = live.page; if (!pg || !pg.el.isConnected) return;
  hideLiveBar(); live.dirty = false; live.pending = false;
  const y = window.scrollY;
  pg.el.style.minHeight = pg.el.offsetHeight + 'px'; // no jump while the page reloads its data
  pg.el.classList.remove('page-in');
  pg.draw(pg.el);
  [0, 120, 350, 800].forEach(ms => setTimeout(() => window.scrollTo(0, y), ms));
  setTimeout(() => { pg.el.style.minHeight = ''; }, 1500);
}

// Typing or picking anything on the page counts as "busy" until the page is redrawn.
document.addEventListener('input', e => { if (e.target.closest?.('#main')) live.dirty = true; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (live.pending) liveRefresh();
  checkVersion();
});

function showLiveBar(kind) {
  let bar = document.getElementById('live-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'live-bar'; bar.className = 'live-bar'; bar.setAttribute('role', 'status');
    document.body.appendChild(bar);
  }
  const update = kind === 'version';
  bar.dataset.kind = kind;
  bar.innerHTML = `<span>${t(update ? 'live.newVersion' : 'live.updates')}</span><button type="button">${t(update ? 'live.reload' : 'live.show')}</button>`;
  bar.querySelector('button').onclick = () => update ? location.reload() : redrawLivePage();
}
function hideLiveBar() {
  const bar = document.getElementById('live-bar');
  if (bar && bar.dataset.kind !== 'version') bar.remove();
}

// ---------- new versions ----------
// Each deploy stamps ?v=<commit> on the script links; if the published page has a newer stamp, reload
// (or offer to, when someone is in the middle of something). Local previews use ?v=dev and are skipped.
const APP_VERSION = (document.currentScript?.getAttribute('src').match(/v=(\w+)/) || [])[1];
let versionChecked = 0;
async function checkVersion() {
  if (!APP_VERSION || APP_VERSION === 'dev' || Date.now() - versionChecked < 60e3) return;
  versionChecked = Date.now();
  try {
    const html = await (await fetch('./?nt=' + Date.now(), { cache: 'no-store' })).text();
    const v = (html.match(/live\.js\?v=(\w+)/) || [])[1];
    if (!v || v === APP_VERSION) return;
    if (!state.user || !userBusy()) location.reload();
    else showLiveBar('version');
  } catch { /* offline: try again later */ }
}
setInterval(checkVersion, 5 * 60e3);
window.addEventListener('focus', checkVersion);
