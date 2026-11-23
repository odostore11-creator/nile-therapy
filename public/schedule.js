'use strict';
// Shared schedule of upcoming visits. Founders see and book for everyone; doctors see and book
// only their own (enforced by Row Level Security). "Mark done" turns a visit into a logged session.
// Uses helpers from app.js (sb, t, esc, check, modal, sessionFormHtml, ...) at call time.

// ---------- date helpers (YYYY-MM-DD strings, Egypt weeks start on Saturday) ----------
const toUTC = s => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => new Date(toUTC(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const weekStart = s => addDays(s, -((toUTC(s).getUTCDay() + 1) % 7)); // Saturday on or before s
const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
const locale = () => (LANG === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');
const fmtDay = (s, opts) => toUTC(s).toLocaleDateString(locale(), { timeZone: 'UTC', ...opts });

// ---------- data ----------
const normalizeAppt = a => ({
  ...a,
  appt_time: a.appt_time ? a.appt_time.slice(0, 5) : '',
  doctor_name: a.doctor?.full_name || '',
  doctor_username: a.doctor?.username || '',
});
async function listAppointments({ from, to, doctorId, statuses } = {}) {
  let q = sb.from('appointments').select('*, doctor:profiles!appointments_doctor_id_fkey(full_name, username)')
    .order('appt_date').order('appt_time', { ascending: true, nullsFirst: true }).limit(2000);
  if (from) q = q.gte('appt_date', from);
  if (to) q = q.lte('appt_date', to);
  if (doctorId) q = q.eq('doctor_id', doctorId);
  if (statuses) q = q.in('status', statuses);
  return check(await q).map(normalizeAppt);
}
// The visit form reuses the session form, so its fields are named session_date / session_time.
function apptPayload(b) {
  const p = {
    patient_name: String(b.patient_name || '').trim(), location: String(b.location || '').trim(),
    session_type: b.session_type || '', notes: String(b.notes || '').trim(),
    appt_date: b.session_date || '', appt_time: b.session_time || null,
    duration_min: b.duration_min === '' || b.duration_min == null ? null : Math.max(0, Math.min(600, parseInt(b.duration_min, 10) || 0)),
  };
  if ('location_url' in b) p.location_url = checkMapLink(b.location_url, p.session_type);
  if (!p.patient_name) throw new Error(t('err.patient'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.appt_date)) throw new Error(t('err.date'));
  return p;
}
async function saveAppointment(id, b, doctorId) {
  const p = apptPayload(b);
  p.patient_name = cleanName(p.patient_name);
  p.patient_id = await ensurePatient(b);
  if (doctorId) p.doctor_id = doctorId;
  if (id) {
    const rows = check(await sb.from('appointments').update(p).eq('id', id).select('id'));
    if (!rows.length) throw new Error(t('err.notAllowed'));
  } else {
    if (!doctorId) throw new Error(t('err.pickDoctor'));
    check(await sb.from('appointments').insert(p));
  }
}
async function setApptStatus(id, status) {
  const rows = check(await sb.from('appointments').update({ status }).eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}
async function deleteAppointment(id) {
  const rows = check(await sb.from('appointments').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}
async function completeAppointment(a, b) {
  const s = sessionPayload(b);
  check(await sb.rpc('complete_appointment', {
    appt_id: a.id, p_patient_name: s.patient_name, p_location: s.location, p_session_date: s.session_date,
    p_session_time: s.session_time, p_session_type: s.session_type, p_duration_min: s.duration_min, p_notes: s.notes, p_location_url: s.location_url || '',
  }));
}

// ---------- modals ----------
function bookVisitModal(onDone, { doctors, appt } = {}) {
  const founder = state.user.role === 'admin';
  const values = appt ? { ...appt, session_date: appt.appt_date, session_time: appt.appt_time } : { session_date: today(), duration_min: 45 };
  modal(`<h2>${t(appt ? 'sched.editTitle' : 'sched.bookTitle')}</h2><form>${sessionFormHtml(values, { doctors: founder ? doctors : null, future: true })}
      <div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t(appt ? 'common.save' : 'sched.bookBtn')}</button></div></form>`, (m, close) => {
    const form = m.querySelector('form'); wireTypePick(form);
    if (!appt) wireDraft(form, 'book');
    // How busy is this doctor that day? (5-a-day rule, and a clash with another visit's time.)
    const note = document.createElement('div'); note.className = 'load-note'; note.setAttribute('aria-live', 'polite');
    form.querySelector('.grid3').after(note);
    let seq = 0;
    const mins = v => { const [h, mm] = String(v).split(':').map(Number); return h * 60 + (mm || 0); };
    const checkLoad = async () => {
      const doc = founder ? form.elements.doctor_id?.value : (appt?.doctor_id || state.user.id), day = form.elements.session_date.value, time = form.elements.session_time.value;
      if (!doc || !day) { note.innerHTML = ''; note.className = 'load-note'; return; }
      const my = ++seq;
      let ap, ss;
      try { [ap, ss] = await Promise.all([listAppointments({ from: day, to: day, doctorId: doc, statuses: ['planned', 'done'] }), listSessions({ from: day, to: day, doctorId: doc })]); }
      catch { return; }
      if (my !== seq) return;
      const others = ap.filter(a => a.id !== appt?.id);
      const linked = new Set(ap.map(a => a.session_id).filter(Boolean));
      const n = others.length + ss.filter(x => !linked.has(x.id)).length;
      const clash = time && others.find(a => a.status === 'planned' && a.appt_time && Math.abs(mins(a.appt_time) - mins(time)) < (a.duration_min || 45));
      const full = n >= DAILY_LIMIT;
      note.className = 'load-note' + (full || clash ? ' warn' : n ? '' : ' free');
      note.innerHTML = `<b>${t('book.load', { n, limit: DAILY_LIMIT })}</b>${full ? ` · ${t('book.full')}` : ''}
        ${clash ? `<br>⚠ ${t('book.clash', { time: esc(clash.appt_time), name: esc(clash.patient_name) })}` : ''}
        ${others.length ? `<div class="small">${others.map(a => `${esc(a.appt_time || '—')} <bdi>${esc(a.patient_name)}</bdi>`).join(' · ')}</div>` : ''}`;
    };
    ['doctor_id', 'session_date', 'session_time'].forEach(k => form.elements[k]?.addEventListener('change', checkLoad));
    checkLoad();
    onSubmit(form, async () => {
      const b = formData(form);
      await saveAppointment(appt?.id, b, founder ? b.doctor_id : (appt ? null : state.user.id));
      if (!appt) clearDraft('book');
      close(); toast(t(appt ? 'sched.saved' : 'sched.booked')); onDone();
    });
  });
}

function markDoneModal(a, onDone) {
  const values = { ...a, session_date: a.appt_date > today() ? today() : a.appt_date, session_time: a.appt_time, duration_min: a.duration_min ?? 45 };
  modal(`<h2>${t('sched.doneTitle')}</h2><p class="muted">${t('sched.doneHelp')}</p><form>${sessionFormHtml(values)}
      <div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('sched.doneBtn')}</button></div></form>`, (m, close) => {
    const form = m.querySelector('form'); wireTypePick(form); wireDraft(form, 'done-' + a.id);
    onSubmit(form, async () => {
      const b = formData(form);
      sessionPayload(b);
      try { await completeAppointment(a, b); toast(t('sched.logged')); }
      catch (e) {
        if (!isNetworkError(e)) throw e;
        queueOutbox({ kind: 'complete', apptId: a.id, data: b, label: a.patient_name });
        toast(t('outbox.queued'));
      }
      clearDraft('done-' + a.id); close(); onDone();
    });
  });
}

function visitModal(a, onDone, doctors) {
  const founder = state.user.role === 'admin';
  const open = a.status === 'planned';
  modal(`<h2 dir="auto">${esc(a.patient_name)}</h2>
    <p>${statusBadge(a.status)}</p>
    <dl class="kv">
      ${founder ? `<dt>${t('form.doctor')}</dt><dd dir="auto">${esc(a.doctor_name)}</dd>` : ''}
      <dt>${t('form.date')}</dt><dd>${fmtDay(a.appt_date, { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
      <dt>${t('form.time')}</dt><dd>${esc(a.appt_time || '—')}</dd>
      <dt>${t('form.type')}</dt><dd>${esc(typeLabel(a.session_type) || '—')}</dd>
      <dt>${t('th.location')}</dt><dd dir="auto">${esc(a.location || '—')}${mapLinkHtml(a.location_url)}</dd>
      <dt>${t('form.minutes')}</dt><dd>${esc(a.duration_min ?? '—')}</dd>
      <dt data-pc hidden>${t('patient.condition')}</dt><dd data-pc hidden dir="auto"></dd>
      <dt data-pp hidden>${t('patient.phone')}</dt><dd data-pp hidden></dd>
      ${a.notes ? `<dt>${t('form.notes')}</dt><dd dir="auto">${esc(a.notes)}</dd>` : ''}
    </dl>
    <div class="error" role="alert"></div>
    <div class="actions">
      ${founder ? `<button type="button" class="btn danger" data-del>${t('common.delete')}</button>` : ''}
      ${open ? `<button type="button" class="btn ghost" data-cancel>${t('sched.cancelVisit')}</button>` : ''}
      ${a.status === 'cancelled' ? `<button type="button" class="btn ghost" data-reopen>${t('sched.reopen')}</button>` : ''}
      <span style="flex:1"></span>
      ${open ? `<button type="button" class="btn ghost" data-edit>${t('common.edit')}</button><button type="button" class="btn" data-done>${t('sched.markDone')}</button>`
             : `<button type="button" class="btn" data-close>${t('common.done')}</button>`}
    </div>`, (m, close) => {
    const err = m.querySelector('.error');
    if (a.patient_id) listPatients().then(list => {
      const p = list.find(x => x.id === a.patient_id); if (!p) return;
      if (p.condition) { m.querySelectorAll('[data-pc]').forEach(x => x.hidden = false); m.querySelector('dd[data-pc]').textContent = p.condition; }
      if (p.phone) { m.querySelectorAll('[data-pp]').forEach(x => x.hidden = false); m.querySelector('dd[data-pp]').innerHTML = `<a href="tel:${esc(p.phone)}" dir="ltr">${esc(p.phone)}</a>`; }
    }).catch(() => {});
    const act = (sel, fn) => { const b = m.querySelector(sel); if (b) b.onclick = async () => { try { await fn(); } catch (e) { err.textContent = e.message; } }; };
    act('[data-edit]', () => { close(); bookVisitModal(onDone, { doctors, appt: a }); });
    act('[data-done]', () => { close(); markDoneModal(a, onDone); });
    act('[data-cancel]', async () => {
      if (!await confirmAction({ title: t('confirm.cancelVisit'), message: t('confirm.cancelVisitMsg'), confirm: t('sched.cancelVisit') })) return;
      await setApptStatus(a.id, 'cancelled'); close(); toast(t('sched.cancelled')); onDone();
    });
    act('[data-reopen]', async () => { await setApptStatus(a.id, 'planned'); close(); onDone(); });
    act('[data-del]', async () => {
      if (!await confirmAction({ title: t('confirm.deleteVisit'), message: t('confirm.deleteVisitMsg'), confirm: t('confirm.deleteVisitBtn') })) return;
      await deleteAppointment(a.id); close(); toast(t('sched.deleted')); onDone();
    });
  });
}

const statusBadge = s => `<span class="status ${s}">${s === 'done' ? '✓ ' : s === 'cancelled' ? '✕ ' : '● '}${t('sched.status.' + s)}</span>`;

/** A session that was logged directly (not from a booked visit). Clicking it opens the session to edit. */
function loggedCard(s, showDoctor) {
  return `<button type="button" class="appt logged" data-logged="${s.id}">
    <span class="appt-time">${esc(s.session_time || t('sched.anyTime'))}</span>
    <strong dir="auto">${esc(s.patient_name)}</strong>
    ${showDoctor ? `<span class="small muted" dir="auto">${esc(s.doctor_name)}</span>` : ''}
    <span class="appt-meta">${s.session_type ? `<span class="pill ${typeClass(s.session_type)}">${esc(typeLabel(s.session_type))}</span>` : ''}<span class="status logged">✓ ${t('sched.status.logged')}</span></span>
  </button>`;
}
function apptCard(a, showDoctor) {
  return `<button type="button" class="appt ${a.status}" data-appt="${a.id}">
    <span class="appt-time">${esc(a.appt_time || t('sched.anyTime'))}</span>
    <strong dir="auto">${esc(a.patient_name)}</strong>
    ${showDoctor ? `<span class="small muted" dir="auto">${esc(a.doctor_name)}</span>` : ''}
    <span class="appt-meta">${a.session_type ? `<span class="pill ${typeClass(a.session_type)}">${esc(typeLabel(a.session_type))}</span>` : ''}${a.status !== 'planned' ? statusBadge(a.status) : ''}</span>
  </button>`;
}

// ---------- the page ----------
async function schedulePage(main) {
  const founder = state.user.role === 'admin';
  let doctors = [];
  if (founder) {
    try { doctors = await listDoctors(); } catch (err) { main.innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
  }
  state.schedWeek ||= weekStart(today());
  main.innerHTML = `
    <div class="head">
      <div><h1>${t(founder ? 'sched.title' : 'sched.myTitle')}</h1><p class="muted">${t(founder ? 'sched.sub' : 'sched.mySub')}</p></div>
      ${founder ? `<button class="btn" id="book">${t('sched.book')}</button>` : ''}
    </div>
    <div class="toolbar sched-bar">
      <div class="seg" role="group" aria-label="${esc(t('sched.week'))}">
        <button type="button" id="prev" aria-label="${esc(t('sched.prev'))}">${LANG === 'ar' ? '›' : '‹'}</button>
        <button type="button" id="thisweek">${t('sched.thisWeek')}</button>
        <button type="button" id="next" aria-label="${esc(t('sched.next'))}">${LANG === 'ar' ? '‹' : '›'}</button>
      </div>
      <strong id="range" class="sched-range"></strong>
      <span style="flex:1"></span>
      ${founder ? `<div class="field"><label for="sdoc">${t('form.doctor')}</label><select id="sdoc"><option value="">${t('sessions.allDoctors')}</option>${doctors.filter(d => d.active).map(d => `<option value="${d.id}" ${state.schedDoctor === d.id ? 'selected' : ''}>${esc(d.full_name)}</option>`).join('')}</select></div>` : ''}
      <label class="check"><input type="checkbox" id="showcx" ${state.schedShowCancelled ? 'checked' : ''}> ${t('sched.showCancelled')}</label>
    </div>
    <div id="weeknote"></div>
    <div id="week" class="week ${state.schedShowPast ? '' : 'hide-past'}">${skeleton('cards', 3)}</div>`;
  const $ = id => main.querySelector('#' + id);
  let list = [], logged = [];
  const load = async () => {
    const from = state.schedWeek, to = addDays(from, 6), who = founder ? state.schedDoctor : state.user.id;
    $('range').textContent = `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    try {
      [list, logged] = await Promise.all([
        listAppointments({ from, to, doctorId: who, statuses: state.schedShowCancelled ? null : ['planned', 'done'] }),
        listSessions({ from, to, doctorId: who }),
      ]);
    } catch (err) { $('week').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    // Logged sessions show too, except the ones already shown as a "done" visit.
    const fromVisits = new Set(list.map(a => a.session_id).filter(Boolean));
    logged = logged.filter(s => !fromVisits.has(s.id));
    const td = today();
    $('weeknote').innerHTML = list.some(a => a.status !== 'cancelled') || logged.length ? '' : `<p class="empty-note">${t('sched.emptyWeek')} ${founder ? `<button type="button" class="link" id="book2">${t('sched.book')}</button>` : ''}</p>`;
    $('book2')?.addEventListener('click', () => bookVisitModal(load, { doctors }));
    const pastDays = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter(d => d < td).length;
    if (pastDays && pastDays < 7 && !state.schedShowPast) {
      $('weeknote').insertAdjacentHTML('beforeend', `<button type="button" class="btn ghost sm phone-only past-toggle" id="showpast">${t('sched.showEarlier', { n: pastDays })}</button>`);
      $('showpast').onclick = () => { state.schedShowPast = true; $('week').classList.remove('hide-past'); $('showpast').remove(); };
    }
    $('week').classList.toggle('hide-past', !state.schedShowPast && pastDays < 7);
    $('week').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(from, i);
      const items = [...list.filter(a => a.appt_date === day).map(a => ({ time: a.appt_time, html: apptCard(a, founder) })),
        ...logged.filter(s => s.session_date === day).map(s => ({ time: s.session_time, html: loggedCard(s, founder) }))]
        .sort((x, y) => (x.time || '').localeCompare(y.time || ''));
      return `<section class="day ${day === td ? 'today' : ''} ${day < td ? 'past' : ''}" aria-label="${esc(fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' }))}">
        <header><span>${fmtDay(day, { weekday: 'short' })}</span><b>${fmtDay(day, { day: 'numeric' })}</b>${day === td ? `<em>${t('sched.today')}</em>` : ''}</header>
        <div class="day-items">${items.length ? items.map(x => x.html).join('') : '<span class="day-empty">—</span>'}</div>
      </section>`;
    }).join('');
    main.querySelectorAll('[data-appt]').forEach(b => b.onclick = () => visitModal(list.find(a => a.id == b.dataset.appt), load, doctors));
    main.querySelectorAll('[data-logged]').forEach(b => b.onclick = () => editSessionModal(logged.find(s => s.id == b.dataset.logged), load));
  };
  $('prev').onclick = () => { state.schedWeek = addDays(state.schedWeek, -7); load(); };
  $('next').onclick = () => { state.schedWeek = addDays(state.schedWeek, 7); load(); };
  $('thisweek').onclick = () => { state.schedWeek = weekStart(today()); load(); };
  if (founder) $('sdoc').onchange = e => { state.schedDoctor = e.target.value || null; load(); };
  $('showcx').onchange = e => { state.schedShowCancelled = e.target.checked; load(); };
  if (founder) $('book').onclick = () => bookVisitModal(load, { doctors });
  load();
}
