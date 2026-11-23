'use strict';
// Sessions: the shared session form and table, the doctor portal, and the founders' Sessions page.
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

// ---------- session form (shared by doctors and founders) ----------
// `fees`: founders' price/commission fields (saved to session_fees; doctors never see them).
function sessionFormHtml(s = {}, { doctors, future = false, fees = false } = {}) {
  const type = s.session_type || 'Home visit';
  return `
    ${doctors ? `<div class="field"><label>${t('form.doctor')}</label><select name="doctor_id" required><option value="">${t('form.choose')}</option>${doctors.filter(d => d.active).map(d => `<option value="${d.id}" ${s.doctor_id === d.id ? 'selected' : ''}>${esc(d.full_name)}</option>`).join('')}</select></div>` : ''}
    ${patientFieldHtml(s)}
    <div class="field"><label>${t('form.type')}</label>
      <input type="hidden" name="session_type" value="${esc(type)}">
      <div class="type-pick">${SESSION_TYPES.map(v => `<button type="button" data-type="${v}" class="${v === type ? 'on' : ''}" aria-pressed="${v === type}">${typeLabel(v)}</button>`).join('')}</div>
    </div>
    <div class="field"><label>${t('form.where')}</label><input name="location" dir="auto" required value="${esc(s.location)}" placeholder="${esc(t('form.where.ph'))}"></div>
    <div class="field map-link-field"><label>${t('form.mapLink')} <span class="muted map-link-opt">${t(state.user?.role === 'doctor' && type !== 'Online' ? 'form.mapLink.req' : 'form.optional')}</span></label>
      <div class="search-row"><input name="location_url" type="url" dir="ltr" inputmode="url" autocomplete="off" value="${esc(s.location_url)}" placeholder="https://maps.app.goo.gl/…">
        <button type="button" class="btn ghost here-btn" data-here>📍 ${t('form.useHere')}</button></div>
      <p class="muted small">${t('form.mapLink.help')}</p></div>
    <div class="grid3">
      <div class="field"><label>${t('form.date')}</label><input name="session_date" type="date" required value="${esc(s.session_date || today())}" ${future ? '' : `max="${today()}"`}></div>
      <div class="field"><label>${t('form.time')}</label><input name="session_time" type="time" value="${esc(s.session_time)}"></div>
      <div class="field"><label>${t('form.minutes')}</label><input name="duration_min" type="number" min="0" max="600" step="5" value="${esc(s.duration_min ?? 45)}"></div>
    </div>
    <div class="field"><label>${t('form.notes')} <span class="muted">${t('form.optional')}</span></label><textarea name="notes" dir="auto" placeholder="${esc(t('form.notes.ph'))}">${esc(s.notes)}</textarea></div>
    ${fees && isFounder() ? `<fieldset class="fee-box"><legend>🔒 ${t('fee.founderOnly')}</legend><div class="grid2">
      <div class="field"><label>${t('fee.price')}</label><input name="fee_price" type="number" min="0" max="1000000" step="1" inputmode="numeric" dir="ltr" value="${esc(s.price ?? '')}"></div>
      <div class="field"><label>${t('fee.commission')}</label><input name="fee_commission" type="number" min="0" max="1000000" step="1" inputmode="numeric" dir="ltr" value="${esc(s.commission ?? '')}"></div>
    </div></fieldset>` : ''}`;
}
const feeHtml = s => (isFounder() && (s.price != null || s.commission != null)
  ? `<span class="fee-tag" dir="auto" title="${esc(t('fee.founderOnly'))}">${s.price != null ? `${esc(t('fee.priceShort'))} <bdi>${s.price}</bdi>` : ''}${s.price != null && s.commission != null ? ' · ' : ''}${s.commission != null ? `${esc(t('fee.commissionShort'))} <bdi>${s.commission}</bdi>` : ''}</span>` : '');
// Patient name with suggestions from the patients list, plus optional phone and condition.
function patientFieldHtml(s = {}, { open = false } = {}) {
  return `<div class="field patient-field"><label for="pn-${s.id || 'new'}">${t('form.patient')}</label>
      <input type="hidden" name="patient_id" value="${esc(s.patient_id ?? '')}">
      <input id="pn-${s.id || 'new'}" name="patient_name" dir="auto" required autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" value="${esc(s.patient_name)}" placeholder="${esc(t('form.patient.ph'))}">
      <div class="search-results" data-presults role="listbox"></div>
      <details class="patient-more" ${open ? 'open' : ''}><summary>${t('patient.details')} <span class="muted small" data-pinfo></span></summary>
        <div class="grid2">
          <div class="field"><label>${t('patient.phone')} <span class="muted">${t('form.optional')}</span></label><input name="patient_phone" dir="ltr" inputmode="tel" autocomplete="off" placeholder="01x xxxx xxxx" disabled></div>
          <div class="field"><label>${t('patient.condition')} <span class="muted">${t('form.optional')}</span></label><input name="patient_condition" dir="auto" autocomplete="off" placeholder="${esc(t('patient.condition.ph'))}" disabled></div>
        </div></details>
    </div>`;
}
function wirePatientPicker(root) {
  const input = root.querySelector('[name=patient_name]'), idEl = root.querySelector('[name=patient_id]'), box = root.querySelector('[data-presults]');
  if (!input || !box) return;
  const phone = root.querySelector('[name=patient_phone]'), cond = root.querySelector('[name=patient_condition]'), info = root.querySelector('[data-pinfo]');
  const more = root.querySelector('.patient-more');
  let list = [], active = -1, shown = [];
  const fill = p => {
    phone.value = p?.phone || ''; cond.value = p?.condition || '';
    info.textContent = p ? [p.condition, p.phone].filter(Boolean).join(' · ') : '';
  };
  const close = () => { box.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const pick = p => { input.value = p.full_name; idEl.value = p.id; fill(p); close(); input.dispatchEvent(new Event('change', { bubbles: true })); };
  const draw = () => {
    const q = nameKey(input.value);
    if (!q) { close(); return; }
    shown = list.filter(p => nameKey(p.full_name).includes(q)).slice(0, 6);
    const exact = shown.some(p => nameKey(p.full_name) === q);
    box.innerHTML = shown.map((p, i) => `<button type="button" role="option" data-i="${i}" class="${i === active ? 'active' : ''}"><b dir="auto">${esc(p.full_name)}</b>${p.condition || p.phone ? ` <span class="muted small" dir="auto">${esc([p.condition, p.phone].filter(Boolean).join(' · '))}</span>` : ''}</button>`).join('')
      + (exact || !list.length ? '' : `<button type="button" class="new-patient" data-new>＋ ${esc(t('patient.new', { name: cleanName(input.value) }))}</button>`);
    input.setAttribute('aria-expanded', box.innerHTML ? 'true' : 'false');
    box.querySelectorAll('[data-i]').forEach(b => b.onmousedown = e => { e.preventDefault(); pick(shown[+b.dataset.i]); });
    const nb = box.querySelector('[data-new]');
    if (nb) nb.onmousedown = e => { e.preventDefault(); idEl.value = ''; fill(null); close(); more.open = true; phone.focus(); };
  };
  input.addEventListener('input', () => {
    const p = list.find(x => x.id == idEl.value);
    if (p && nameKey(p.full_name) !== nameKey(input.value)) { idEl.value = ''; fill(null); }
    active = -1; draw();
  });
  input.addEventListener('focus', draw);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', e => {
    if (!box.innerHTML) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(-1, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))); draw(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  root.addEventListener('draft-restored', () => fill(list.find(x => x.id == idEl.value) || null));
  const ready = () => { phone.disabled = false; cond.disabled = false; };
  listPatients().then(l => {
    list = l; ready();
    const p = list.find(x => x.id == idEl.value);
    if (p && !phone.value && !cond.value) fill(p);
  }).catch(ready);
}

function wireTypePick(root) {
  root.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
    root.querySelectorAll('[data-type]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    root.querySelector('[name=session_type]').value = b.dataset.type;
    const loc = root.querySelector('[name=location]');
    if (b.dataset.type === 'Online' && !loc.value) loc.value = t('form.videoCall');
    const opt = root.querySelector('.map-link-opt'); // online sessions don't need a map link
    if (opt && state.user?.role === 'doctor') opt.textContent = t(b.dataset.type === 'Online' ? 'form.optional' : 'form.mapLink.req');
  });
  wireMapLink(root);
  wirePatientPicker(root);
}
// "Use my location": asks the phone/computer for its position and fills in a Google Maps link.
function wireMapLink(root) {
  const btn = root.querySelector('[data-here]'); if (!btn) return;
  if (!navigator.geolocation) { btn.hidden = true; return; }
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = t('form.locating');
    navigator.geolocation.getCurrentPosition(p => {
      root.querySelector('[name=location_url]').value = `https://www.google.com/maps?q=${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)}`;
      btn.disabled = false; btn.textContent = '📍 ' + t('form.useHere'); toast(t('form.located'));
    }, err => {
      btn.disabled = false; btn.textContent = '📍 ' + t('form.useHere');
      toast(t(err.code === 1 ? 'form.locDenied' : 'form.locFailed'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
}
function editSessionModal(s, onDone) {
  modal(`<h2>${t('edit.title')}</h2><form>${sessionFormHtml(s, { fees: true })}<div class="error" role="alert"></div>
    <div class="actions"><button type="button" class="btn danger" data-del>${t('common.delete')}</button><span style="flex:1"></span><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div></form>`,
  (m, close) => {
    const f = m.querySelector('form'); wireTypePick(f);
    onSubmit(f, async () => { await updateSession(s.id, formData(f)); close(); toast(t('edit.updated')); onDone(); });
    m.querySelector('[data-del]').onclick = async () => {
      if (!await confirmAction({ title: t('confirm.deleteSession'), message: t('confirm.deleteSessionMsg'), confirm: t('confirm.deleteSessionBtn') })) return;
      try { await deleteSession(s.id); close(); toast(t('edit.deleted')); onDone(); }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    };
  });
}

function sessionRows(list, { showDoctor = true, editable = false } = {}) {
  if (!list.length) return `<div class="empty">${t('table.empty')}</div>`;
  return `<div class="table-wrap cards"><table>
    <thead><tr><th>${t('th.date')}</th>${showDoctor ? `<th>${t('th.doctor')}</th>` : ''}<th>${t('th.patient')}</th><th>${t('th.type')}</th><th>${t('th.location')}</th><th>${t('th.min')}</th><th>${t('th.notes')}</th>${editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${list.map(s => `<tr>
      <td class="c-date" style="white-space:nowrap">${fmtDate(s.session_date)}<span class="muted small c-time">${esc(s.session_time)}</span></td>
      ${showDoctor ? `<td class="c-doctor"><a href="#/doctors/${s.doctor_id}" dir="auto">${esc(s.doctor_name)}</a></td>` : ''}
      <td class="c-patient" dir="auto" style="white-space:nowrap"><strong>${esc(s.patient_name)}</strong></td>
      <td class="c-type">${s.session_type ? `<span class="pill ${typeClass(s.session_type)}">${esc(typeLabel(s.session_type))}</span>` : ''}</td>
      <td class="c-loc"><bdi>${esc(s.location)}</bdi>${mapLinkHtml(s.location_url)}</td>
      <td class="c-min" data-unit="${esc(t('th.min'))}">${esc(s.duration_min ?? '')}</td>
      <td class="c-notes small" dir="auto">${esc(s.notes)}${feeHtml(s)}</td>
      ${editable ? `<td class="c-edit"><button class="btn ghost sm" data-edit="${s.id}">${t('common.edit')}</button></td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- doctor home: "Today" ----------
// What a doctor needs during the day: visits still to close, today's visits with a one-tap
// "Mark done", the next few days, a form to log any other session, and their recent sessions.
function visitRow(a, { showDate = false } = {}) {
  const planned = a.status === 'planned';
  return `<div class="visit-row ${a.status}">
    <div class="vr-time">${showDate ? `<b>${fmtDay(a.appt_date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>` : ''}<span>${esc(a.appt_time || t('sched.anyTime'))}</span></div>
    <div class="vr-main"><b dir="auto">${esc(a.patient_name)}</b>
      <span class="muted small" dir="auto">${a.session_type ? esc(typeLabel(a.session_type)) + ' · ' : ''}${esc(a.location || '')}${mapLinkHtml(a.location_url)}</span></div>
    <div class="vr-actions">${planned ? `<button type="button" class="btn sm" data-done="${a.id}">✓ ${t('sched.markDone')}</button>` : statusBadge(a.status)}
      <button type="button" class="btn ghost sm" data-open="${a.id}" aria-label="${esc(t('today.details'))}" title="${esc(t('today.details'))}">⋯</button></div>
  </div>`;
}

async function doctorPortal(main) {
  const u = state.user, td = today();
  main.innerHTML = `
    <div class="head"><div><h1 dir="auto">${esc(t('portal.hi', { name: u.full_name.split(' ').slice(0, 2).join(' ') }))}</h1>
      <p class="muted">${fmtDay(td, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div></div>
    <div id="outbox"></div>
    <div id="closing"></div>
    <section class="card today-card">
      <div class="card-head"><h2>${t('today.visits')}</h2><a href="#/schedule" class="small">${t('today.fullSchedule')}</a></div>
      <div id="todaylist">${skeleton('cards', 2)}</div>
      <div id="soon"></div>
    </section>
    <div class="portal">
      <form class="card" id="new">
        <h2>${t('portal.log')}</h2><p class="muted small" style="margin:4px 0 14px">${t('today.logHelp')}</p>
        ${sessionFormHtml()}
        <div class="error" role="alert"></div>
        <button class="btn block">${t('portal.submit')}</button>
      </form>
      <section class="card"><div class="head" style="margin-bottom:10px"><h2>${t('portal.mine')}</h2><span class="muted small" id="count"></span></div>
        <div id="mine">${skeleton('table')}</div>
        <button type="button" class="btn ghost block" id="older" hidden>${t('today.older')}</button></section>
    </div>`;
  drawOutbox();
  const $ = id => main.querySelector('#' + id);
  const form = $('new'); wireTypePick(form); wireDraft(form, 'log');
  let allSessions = false;

  const loadVisits = async () => {
    let visits;
    try { visits = await listAppointments({ from: addDays(td, -30), to: addDays(td, 3), doctorId: u.id, statuses: ['planned', 'done'] }); }
    catch (err) { $('todaylist').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    const open = visits.filter(a => a.status === 'planned' && a.appt_date < td);
    const now = visits.filter(a => a.appt_date === td);
    const soon = visits.filter(a => a.status === 'planned' && a.appt_date > td);
    $('closing').innerHTML = open.length ? `<section class="card closing-card"><div class="card-head"><h2>⚠ ${t('today.closing', { n: open.length })}</h2></div>
      <p class="muted small">${t('today.closingHelp')}</p>${open.map(a => visitRow(a, { showDate: true })).join('')}</section>` : '';
    $('todaylist').innerHTML = now.length ? now.map(a => visitRow(a)).join('')
      : `<div class="empty friendly small-empty"><span class="big" aria-hidden="true">☀️</span><p>${t('today.none')}</p></div>`;
    $('soon').innerHTML = soon.length ? `<h3 class="sub-title">${t('today.soon')}</h3>${soon.map(a => visitRow(a, { showDate: true })).join('')}` : '';
    main.querySelectorAll('[data-done]').forEach(b => b.onclick = () => markDoneModal(visits.find(a => a.id == b.dataset.done), refresh));
    main.querySelectorAll('[data-open]').forEach(b => b.onclick = () => visitModal(visits.find(a => a.id == b.dataset.open), refresh));
  };
  const loadSessions = async () => {
    const sessions = await listSessions({ doctorId: u.id, from: allSessions ? null : addDays(td, -30) });
    $('count').textContent = t(allSessions ? 'portal.total' : 'today.last30', { n: sessions.length });
    $('older').hidden = allSessions;
    $('mine').innerHTML = sessions.length ? sessionRows(sessions, { showDoctor: false, editable: true })
      : `<div class="empty friendly"><span class="big" aria-hidden="true">📝</span><p>${t('portal.empty')}</p></div>`;
    main.querySelectorAll('#mine [data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(x => x.id == b.dataset.edit), refresh));
  };
  const refresh = () => { loadVisits(); loadSessions().catch(err => { $('mine').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }); };
  $('older').onclick = () => { allSessions = true; $('mine').innerHTML = skeleton('table'); loadSessions(); };

  onSubmit(form, async () => {
    const b = formData(form);
    sessionPayload(b); // check the form first (shows what's missing)
    b.client_ref = newRef();
    try {
      const r = await addSession(b, u.id);
      toast(t(r.linkedVisit ? 'portal.thanksLinked' : 'portal.thanks'));
    } catch (e) {
      if (!(e.network || isNetworkError(e))) throw e;
      queueOutbox({ kind: 'session', data: b, doctorId: u.id }); // no connection: keep it and send it later
      toast(t('outbox.queued'));
    }
    clearDraft('log');
    const keep = form.querySelector('[name=session_type]').value;
    form.reset(); form.querySelector('[name=session_type]').value = keep;
    form.querySelector('[name=session_date]').value = today();
    form.querySelector('.draft-note')?.remove();
    refresh();
  });
  const onSent = () => { if (main.isConnected && $('mine')) refresh(); else window.removeEventListener('outbox-sent', onSent); };
  window.addEventListener('outbox-sent', onSent);
  refresh();
  flushOutbox();
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
      <div class="field"><label for="from">${t('sessions.from')}</label><input id="from" type="date" value="${today().slice(0, 8)}01"></div>
      <div class="field"><label for="to">${t('sessions.to')}</label><input id="to" type="date"></div>
      <div class="seg" role="group" aria-label="${esc(t('sessions.view'))}"><button data-view="grouped">${t('sessions.byDoctor')}</button><button data-view="list">${t('sessions.oneList')}</button></div>
    </div>
    <p class="muted small range-hint" id="rangehint">${t('sessions.monthHint')} <button type="button" class="link" id="alltime">${t('sessions.allTime')}</button></p>
    <div id="list">${skeleton('table')}</div>`;
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
  ['doc', 'from', 'to'].forEach(id => f(id).onchange = () => { f('rangehint').hidden = true; load(); });
  f('alltime').onclick = () => { f('from').value = ''; f('rangehint').hidden = true; load(); };
  main.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.sessionsView = b.dataset.view; setView(); load(); });
  f('add').onclick = () => modal(`<h2>${t('sessions.addTitle')}</h2><form>${sessionFormHtml({}, { doctors, fees: true })}<div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('sessions.addBtn')}</button></div></form>`, (m, close) => {
    const form = m.querySelector('form'); wireTypePick(form); wireDraft(form, 'add-session');
    onSubmit(form, async () => {
      const b = formData(form); b.client_ref = newRef();
      const r = await addSession(b, b.doctor_id);
      clearDraft('add-session'); close(); toast(t(r.linkedVisit ? 'sessions.addedLinked' : 'sessions.added')); load();
    });
  });
  load();
}

