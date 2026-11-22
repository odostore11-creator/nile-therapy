'use strict';
// Change history (founders only): every add / edit / delete of a session, visit or doctor profile,
// recorded automatically by the database. Anything deleted can be put back with "Restore".
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

const HIDDEN_FIELDS = ['id', 'created_at', 'updated_at', 'created_by', 'session_id', 'doctor_id', 'role', 'username'];
const SESSION_FIELDS = ['doctor_id', 'patient_id', 'patient_name', 'location', 'location_url', 'session_date', 'session_time', 'session_type', 'duration_min', 'notes'];
const VISIT_FIELDS = ['doctor_id', 'patient_id', 'patient_name', 'location', 'location_url', 'session_type', 'appt_date', 'appt_time', 'duration_min', 'notes', 'status'];
// Only these fields are listed in "what changed" (the rest are internal).
const SHOWN_FIELDS = ['patient_name', 'location', 'location_url', 'session_date', 'session_time', 'session_type', 'duration_min', 'notes', 'appt_date', 'appt_time',
  'status', 'doctor_id', 'assigned_doctor_id', 'full_name', 'title', 'specialty', 'phone', 'area', 'bio', 'active', 'condition', 'preferred_date', 'preferred_time', 'address', 'color'];
// A deleted row counts as restored if the same thing was added again afterwards.
const sameThing = (a, b) => ['doctor_id', 'patient_name', 'session_date', 'session_time', 'appt_date', 'appt_time'].every(k => (a?.[k] ?? null) === (b?.[k] ?? null));

async function listChanges({ deletedOnly } = {}) {
  let q = sb.from('change_log').select('*').order('id', { ascending: false }).limit(300);
  if (deletedOnly) q = q.eq('action', 'delete');
  return check(await q);
}

function historyValue(k, v, names) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'doctor_id' || k === 'assigned_doctor_id') return esc(names.get(v) || '?');
  if (k === 'location_url') return `<span dir="ltr">${esc(String(v).slice(0, 40))}${String(v).length > 40 ? '…' : ''}</span>`;
  if (k === 'color') return `<i class="swatch" style="background:${esc(v)}"></i>`;
  if (k === 'session_type') return esc(typeLabel(v));
  if (k === 'active') return t(v ? 'act.on' : 'act.off');
  if (k === 'status') return esc(t('sched.status.' + v) === 'sched.status.' + v ? t('req.status.' + v) : t('sched.status.' + v));
  if (/_date$/.test(k)) return fmtDate(v);
  if (/_time$/.test(k)) return esc(String(v).slice(0, 5));
  return esc(v);
}

function changeSummary(c, names) {
  const row = c.new_data || c.old_data || {};
  if (c.table_name === 'profiles' || c.table_name === 'patients') return `<span dir="auto">${esc(row.full_name)}</span>`;
  if (c.table_name === 'doctor_areas') return `<span dir="auto">${esc(names.get(row.doctor_id) || '')}</span>`;
  if (c.table_name === 'patient_requests') return `<span dir="auto">${esc(row.patient_name)}</span> · ${fmtDate(row.preferred_date)}`;
  const date = row.session_date || row.appt_date;
  return `<span dir="auto">${esc(row.patient_name)}</span> · ${fmtDate(date)} · <span dir="auto">${esc(names.get(row.doctor_id) || '')}</span>`;
}

function changeDetails(c, names) {
  if (c.action !== 'update') return '';
  const o = c.old_data || {}, n = c.new_data || {};
  if (c.table_name === 'doctor_areas') return JSON.stringify(o.coords) !== JSON.stringify(n.coords) ? `<ul class="hist-diff"><li>${t('hist.areaShape')}</li></ul>` : '';
  const keys = Object.keys(n).filter(k => SHOWN_FIELDS.includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]));
  if (!keys.length) return '';
  return `<ul class="hist-diff">${keys.map(k => `<li><span class="muted">${t(k === 'doctor_id' || k === 'assigned_doctor_id' ? 'field.doctor_name' : 'field.' + k)}:</span> <s>${historyValue(k, o[k], names)}</s> → <b>${historyValue(k, n[k], names)}</b></li>`).join('')}</ul>`;
}

async function restoreChange(c) {
  const o = { ...(c.old_data || {}) };
  if (o.patient_id && !(await listPatients(true)).some(p => p.id === o.patient_id)) delete o.patient_id;
  const pick = keys => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
  if (c.table_name === 'sessions') check(await sb.from('sessions').insert(pick(SESSION_FIELDS)));
  else if (c.table_name === 'appointments') check(await sb.from('appointments').insert(pick(VISIT_FIELDS)));
}

async function historyPage(main) {
  state.histDeleted ??= false;
  main.innerHTML = `
    <div class="head">
      <div><h1>${t('hist.title')}</h1><p class="muted">${t('hist.sub')}</p></div>
      <div class="seg" role="group" aria-label="${esc(t('hist.title'))}"><button type="button" data-f="all">${t('hist.all')}</button><button type="button" data-f="deleted">${t('hist.deletedOnly')}</button></div>
    </div>
    <div id="hist">${skeleton('table', 6)}</div>`;
  const setF = () => main.querySelectorAll('[data-f]').forEach(b => { const on = (b.dataset.f === 'deleted') === state.histDeleted; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  setF();
  const load = async () => {
    let changes, people;
    try {
      [changes, people] = await Promise.all([listChanges({ deletedOnly: state.histDeleted }), sb.from('profiles').select('id, full_name')]);
    } catch (err) { main.querySelector('#hist').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    const names = new Map(check(people).map(p => [p.id, p.full_name]));
    const restored = new Set(); // deletions already put back (now, or earlier: the same thing was added again later)
    changes.forEach((c, i) => { if (c.action === 'delete' && changes.slice(0, i).some(x => x.action === 'insert' && x.table_name === c.table_name && sameThing(x.new_data, c.old_data))) restored.add(c.id); });
    const box = main.querySelector('#hist');
    if (!changes.length) { box.innerHTML = `<div class="card empty">${t(state.histDeleted ? 'hist.noDeleted' : 'hist.none')}</div>`; return; }
    box.innerHTML = `<div class="card hist-list">${changes.map(c => `
      <div class="hist-row ${c.action}">
        <div class="hist-when"><b>${fmtDate(c.created_at.slice(0, 10))}</b><span class="muted small">${new Date(c.created_at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="hist-what">
          <div><span class="hist-tag ${c.action}">${t('hist.' + c.action)}</span> ${t('hist.table.' + c.table_name)} · ${changeSummary(c, names)}</div>
          <div class="muted small">${t('hist.by', { name: esc(c.actor_id ? names.get(c.actor_id) || '?' : t('hist.system')) })}</div>
          ${changeDetails(c, names)}
        </div>
        ${c.action === 'delete' && ['sessions', 'appointments'].includes(c.table_name)
          ? (restored.has(c.id) ? `<span class="muted small">✓ ${t('hist.restored')}</span>` : `<button type="button" class="btn ghost sm" data-restore="${c.id}">${t('hist.restore')}</button>`)
          : '<span></span>'}
      </div>`).join('')}</div>`;
    box.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
      const c = changes.find(x => x.id == b.dataset.restore);
      if (restored.has(c.id)) return;
      if (!await confirmAction({ title: t('hist.restoreQ'), message: t('hist.restoreMsg'), confirm: t('hist.restore'), danger: false })) return;
      b.disabled = true;
      try { await restoreChange(c); restored.add(c.id); b.textContent = '✓ ' + t('hist.restored'); toast(t('hist.restored')); }
      catch (err) { b.disabled = false; toast(err.message); }
    });
  };
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.histDeleted = b.dataset.f === 'deleted'; setF(); load(); });
  load();
}
