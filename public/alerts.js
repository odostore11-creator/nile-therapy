'use strict';
// Live alerts, checked every minute while someone is logged in (and right away when the tab comes back):
//  * Doctors: open patients they can take (their nearest doctor was full) → a notice on every page + a
//    count on "My map".
//  * Founders: patient requests nobody took within 2 hours (or outside every area) → a RED alert on every
//    page + a count on "Coverage map". The same list is under the map.
// A short pop-up (toast) appears when the number goes up. Shared helpers come from core.js / coverage.js.

const ALERT_EVERY_MS = 60 * 1000;
const alertState = { timer: 0, items: [], lastCount: null, forUser: null };

async function fetchAlerts() {
  if (!state.user) return [];
  if (state.user.role === 'doctor') return check(await sb.rpc('open_requests_for_me'));
  const open = check(await sb.from('patient_requests').select('id, patient_name, reason, opened_at, status, preferred_date').eq('status', 'open'));
  return open.filter(needsFounders);
}

function drawAlerts() {
  const slot = document.getElementById('alerts');
  const doctor = state.user?.role === 'doctor', items = alertState.items, n = items.length;
  // Count bubble on the menu item.
  const navKey = doctor ? 'requests' : 'coverage';
  document.querySelectorAll(`.nav[href="#/${navKey}"] .nav-badge, .tab[href="#/${navKey}"] .nav-badge`).forEach(b => b.remove());
  if (n) document.querySelectorAll(`.nav[href="#/${navKey}"], .tab[href="#/${navKey}"]`).forEach(a => a.insertAdjacentHTML('beforeend', `<span class="nav-badge ${doctor ? '' : 'red'}">${n}</span>`));
  if (!slot) return;
  const onPage = location.hash.startsWith(`#/${navKey}`);
  if (!n || onPage) { slot.innerHTML = ''; return; }
  const names = items.slice(0, 3).map(r => `<bdi>${esc(r.patient_name)}</bdi>`).join(' · ');
  slot.innerHTML = doctor
    ? `<a class="alert-bar info" href="#/requests" role="status"><span class="alert-ico" aria-hidden="true">🔔</span>
        <span><b>${t('alert.doctor', { n })}</b><br><span class="small">${names}${items[0]?.km != null ? ` · ${t('open.km', { km: items[0].km })}` : ''}</span></span>
        <span class="btn sm">${t('alert.doctorBtn')}</span></a>`
    : `<a class="alert-bar danger" href="#/coverage" role="alert"><span class="alert-ico" aria-hidden="true">⚠</span>
        <span><b>${t('alert.founders', { n })}</b><br><span class="small">${names}</span></span>
        <span class="btn sm btn-red">${t('alert.foundersBtn')}</span></a>`;
}

async function refreshAlerts() {
  if (!state.user) return;
  const who = state.user.id;
  let items;
  try { items = await fetchAlerts(); } catch { return; } // offline etc.: keep what we had
  if (state.user?.id !== who) return;
  const grew = alertState.lastCount !== null && items.length > alertState.lastCount;
  alertState.items = items; alertState.lastCount = items.length;
  drawAlerts();
  if (grew) toast(state.user.role === 'doctor' ? t('alert.doctorNew') : t('alert.foundersNew'));
}

function startAlerts() {
  if (alertState.forUser === state.user?.id && alertState.timer) { drawAlerts(); return; }
  stopAlerts();
  if (!state.user) return;
  alertState.forUser = state.user.id;
  refreshAlerts();
  alertState.timer = setInterval(refreshAlerts, ALERT_EVERY_MS);
}
function stopAlerts() {
  clearInterval(alertState.timer);
  Object.assign(alertState, { timer: 0, items: [], lastCount: null, forUser: null });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && alertState.timer) refreshAlerts(); });
