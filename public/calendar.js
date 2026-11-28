'use strict';
// Founders' calendar (#/calendar): each founder has their own calendar of sessions they do
// themselves, meetings, reminders and anything else. Founders can look at each other's
// calendars (entries marked "only me" stay hidden); only the owner can change an entry.
// The database enforces this (RLS on founder_events). Weeks start on Saturday, like the schedule.

const EVENT_KINDS = ['session', 'meeting', 'reminder', 'other'];
const KIND_ICON = { session: '🩺', meeting: '👥', reminder: '⏰', other: '📌' };
const cal = { month: null, day: null, who: 'me' }; // who: 'me' | 'all' | a founder id

// ---------- data ----------
const normalizeEvent = e => ({
  ...e,
  start_time: e.start_time ? e.start_time.slice(0, 5) : '',
  end_time: e.end_time ? e.end_time.slice(0, 5) : '',
  owner_name: e.owner?.full_name || '',
  mine: e.owner_id === state.user?.id,
});
async function listEvents(from, to) {
  const rows = check(await sb.from('founder_events')
    .select('*, owner:profiles!founder_events_owner_id_fkey(full_name)')
    .gte('event_date', from).lte('event_date', to)
    .order('event_date').order('start_time', { ascending: true, nullsFirst: true }).order('id').limit(3000));
  return rows.map(normalizeEvent);
}
async function listFounders() {
  return check(await sb.from('profiles').select('id, full_name').eq('role', 'admin').eq('active', true).order('full_name'));
}
function eventPayload(b) {
  const kind = EVENT_KINDS.includes(b.kind) ? b.kind : 'other';
  const p = {
    kind, title: String(b.title || '').trim().slice(0, 200),
    event_date: b.event_date || '', start_time: b.start_time || null, end_time: b.end_time || null,
    location: String(b.location || '').trim().slice(0, 300), notes: String(b.notes || '').trim().slice(0, 4000),
    private: b.private === 'on', done: b.done === 'on',
    patient_name: kind === 'session' ? cleanName(b.patient_name) : '',
    price: kind === 'session' ? feeNum(b.price) : null,
  };
  const url = String(b.location_url || '').trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) throw new Error(t('err.mapLinkBad'));
  p.location_url = url;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.event_date)) throw new Error(t('err.date'));
  if (kind === 'session' && !p.patient_name) throw new Error(t('err.patient'));
  if (kind !== 'session' && !p.title) throw new Error(t('cal.err.title'));
  if (p.start_time && p.end_time && p.end_time < p.start_time) throw new Error(t('cal.err.end'));
  if (!p.start_time) p.end_time = null;
  return p;
}
async function saveEvent(id, b) {
  const p = eventPayload(b);
  p.patient_id = p.kind === 'session' ? await ensurePatient(b) : null;
  if (id) {
    const rows = check(await sb.from('founder_events').update(p).eq('id', id).select('id'));
    if (!rows.length) throw new Error(t('err.notAllowed'));
    return 1;
  }
  // Repeat: the same entry every week or month, up to a year ahead.
  const times = b.repeat === 'weekly' || b.repeat === 'monthly' ? Math.max(1, Math.min(52, parseInt(b.repeat_n, 10) || 1)) : 1;
  const rows = Array.from({ length: times }, (_, i) => ({ ...p, event_date: b.repeat === 'monthly' ? addMonths(p.event_date, i) : addDays(p.event_date, 7 * i) }));
  check(await sb.from('founder_events').insert(rows));
  return rows.length;
}
async function setEventDone(id, done) {
  const rows = check(await sb.from('founder_events').update({ done }).eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}
async function deleteEvent(id) {
  const rows = check(await sb.from('founder_events').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('err.notAllowed'));
}

// ---------- date helpers ----------
function addMonths(s, n) { // same day next month(s); the 31st becomes the month's last day
  const [y, m, d] = s.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
const monthStart = s => s.slice(0, 8) + '01';
const timeRange = e => e.start_time ? `${e.start_time}${e.end_time ? '–' + e.end_time : ''}` : t('cal.allDay');
const eventTitle = e => (e.kind === 'session' ? [e.patient_name, e.title].filter(Boolean).join(' · ') : e.title) || t('cal.kind.' + e.kind);

// ---------- the form ----------
function eventFormHtml(e = {}, isNew = true) {
  const kind = e.kind || 'meeting';
  return `
    <input type="hidden" name="kind" value="${esc(kind)}">
    <div class="field"><label>${t('cal.kind')}</label>
      <div class="type-pick kind-pick">${EVENT_KINDS.map(k => `<button type="button" data-kind="${k}" class="k-${k} ${k === kind ? 'on' : ''}" aria-pressed="${k === kind}">${KIND_ICON[k]} ${t('cal.kind.' + k)}</button>`).join('')}</div></div>
    <div class="ev-session">${patientFieldHtml({ id: 'ev' + (e.id || ''), patient_name: e.patient_name, patient_id: e.patient_id })}</div>
    <div class="field"><label data-title-label>${t('cal.title')}</label><input name="title" dir="auto" maxlength="200" value="${esc(e.title)}" placeholder="${esc(t('cal.title.ph'))}"></div>
    <div class="grid3">
      <div class="field"><label>${t('form.date')}</label><input name="event_date" type="date" required value="${esc(e.event_date || cal.day || today())}"></div>
      <div class="field"><label>${t('cal.from')} <span class="muted">${t('form.optional')}</span></label><input name="start_time" type="time" value="${esc(e.start_time)}"></div>
      <div class="field"><label>${t('cal.to')} <span class="muted">${t('form.optional')}</span></label><input name="end_time" type="time" value="${esc(e.end_time)}"></div>
    </div>
    <div class="ev-place">
      <div class="field"><label>${t('form.where')} <span class="muted">${t('form.optional')}</span></label><input name="location" dir="auto" maxlength="300" value="${esc(e.location)}" placeholder="${esc(t('cal.where.ph'))}"></div>
      <div class="field"><label>${t('form.mapLink')} <span class="muted">${t('form.optional')}</span></label>
        <div class="search-row"><input name="location_url" type="url" dir="ltr" inputmode="url" autocomplete="off" value="${esc(e.location_url)}" placeholder="https://maps.app.goo.gl/…">
        <button type="button" class="btn ghost here-btn" data-here>${icon('pin')} ${t('form.useHere')}</button></div></div>
    </div>
    <div class="field ev-price"><label>${t('fee.price')} <span class="muted">${t('form.optional')}</span></label><input name="price" type="number" min="0" max="1000000" step="1" inputmode="numeric" dir="ltr" value="${esc(e.price ?? '')}"></div>
    <div class="field"><label>${t('form.notes')} <span class="muted">${t('form.optional')}</span></label><textarea name="notes" dir="auto" maxlength="4000">${esc(e.notes)}</textarea></div>
    ${isNew ? `<div class="grid2">
      <div class="field"><label>${t('cal.repeat')}</label><select name="repeat"><option value="">${t('cal.repeat.no')}</option><option value="weekly">${t('cal.repeat.weekly')}</option><option value="monthly">${t('cal.repeat.monthly')}</option></select></div>
      <div class="field" data-repeat-n hidden><label>${t('cal.repeat.times')}</label><input name="repeat_n" type="number" min="2" max="52" value="4"></div>
    </div>` : ''}
    <label class="check"><input type="checkbox" name="private" ${e.private ? 'checked' : ''}> ${t('cal.private')}</label>
    ${isNew ? '' : `<label class="check"><input type="checkbox" name="done" ${e.done ? 'checked' : ''}> ${t('cal.done')}</label>`}`;
}
function wireEventForm(f) {
  const setKind = k => {
    f.elements.kind.value = k;
    f.querySelectorAll('[data-kind]').forEach(b => { const on = b.dataset.kind === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const session = k === 'session';
    // Hidden fields are disabled so "required" doesn't block saving a meeting or reminder.
    f.querySelector('.ev-session').hidden = !session;
    f.querySelectorAll('.ev-session input').forEach(i => { if (i.type !== 'hidden') i.disabled = !session; });
    f.querySelector('.ev-price').hidden = !session;
    f.querySelector('.ev-place').hidden = k === 'reminder';
    f.querySelector('[data-title-label]').innerHTML = esc(t('cal.title')) + (session ? ` <span class="muted">${t('form.optional')}</span>` : '');
    f.elements.title.placeholder = t(session ? 'cal.title.sessionPh' : 'cal.title.ph');
  };
  f.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => setKind(b.dataset.kind));
  wirePatientPicker(f);
  wireMapLink(f);
  setKind(f.elements.kind.value);
  const rep = f.elements.repeat;
  if (rep) rep.onchange = () => { f.querySelector('[data-repeat-n]').hidden = !rep.value; };
}
function eventModal(e, onDone) {
  const isNew = !e?.id;
  if (!isNew && !e.mine) return eventViewModal(e);
  modal(`<h2>${t(isNew ? 'cal.addTitle' : 'cal.editTitle')}</h2><form class="ev-form">${eventFormHtml(e || {}, isNew)}<div class="error" role="alert"></div>
    <div class="actions">${isNew ? '' : `<button type="button" class="btn danger" data-del>${t('common.delete')}</button><span style="flex:1"></span>`}
      <button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div></form>`, (m, close) => {
    const f = m.querySelector('form'); wireEventForm(f);
    onSubmit(f, async () => {
      const n = await saveEvent(e?.id, formData(f));
      close(); toast(isNew ? t('cal.added', { n }) : t('cal.saved')); onDone();
    });
    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!await confirmAction({ title: t('cal.deleteQ'), message: eventTitle(e), confirm: t('common.delete') })) return;
      try { await deleteEvent(e.id); close(); toast(t('cal.deleted')); onDone(); }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    };
  });
}
// Someone else's entry: read only.
function eventViewModal(e) {
  modal(`<h2 dir="auto">${KIND_ICON[e.kind]} ${esc(eventTitle(e))}</h2>
    <dl class="kv">
      <dt>${t('cal.owner')}</dt><dd dir="auto">${esc(e.owner_name)}</dd>
      <dt>${t('cal.kind')}</dt><dd>${t('cal.kind.' + e.kind)}</dd>
      <dt>${t('form.date')}</dt><dd>${fmtDay(e.event_date, { weekday: 'long', day: 'numeric', month: 'long' })} · <bdi>${esc(timeRange(e))}</bdi></dd>
      ${e.location ? `<dt>${t('form.where')}</dt><dd dir="auto">${esc(e.location)}${mapLinkHtml(e.location_url)}</dd>` : ''}
      ${e.notes ? `<dt>${t('form.notes')}</dt><dd dir="auto">${esc(e.notes)}</dd>` : ''}
    </dl>
    <p class="muted small">${t('cal.readOnly')}</p>
    <div class="actions"><button type="button" class="btn" data-close>${t('common.close')}</button></div>`);
}

// ---------- the page ----------
async function calendarPage(main) {
  cal.day ||= today();
  cal.month ||= monthStart(cal.day);
  let founders = [];
  main.innerHTML = `
    <div class="head"><div><h1>${t('cal.title.page')}</h1><p class="muted">${t('cal.sub')}</p></div>
      <button class="btn" id="add">＋ ${t('cal.add')}</button></div>
    <div id="overdue"></div>
    <div class="cal-bar">
      <div class="cal-nav"><button type="button" class="btn ghost sm" id="prev" aria-label="${esc(t('cal.prev'))}">${LANG === 'ar' ? '›' : '‹'}</button>
        <h2 id="mlabel" aria-live="polite"></h2>
        <button type="button" class="btn ghost sm" id="next" aria-label="${esc(t('cal.next'))}">${LANG === 'ar' ? '‹' : '›'}</button>
        <button type="button" class="btn ghost sm" id="today">${t('cal.today')}</button></div>
      <div class="seg" role="group" aria-label="${esc(t('cal.whose'))}" id="who"></div>
    </div>
    <div class="cal-layout">
      <section class="card cal-card"><div class="cal-grid" id="grid">${skeleton('cards', 1)}</div>
        <div class="cal-legend">${EVENT_KINDS.map(k => `<span><i class="dot k-${k}"></i>${t('cal.kind.' + k)}</span>`).join('')}</div></section>
      <section class="card cal-day" id="daypanel"></section>
    </div>`;
  const $ = id => main.querySelector('#' + id);
  let events = [];

  const drawWho = () => {
    const opts = [['me', t('cal.mine')], ...founders.filter(f => f.id !== state.user.id).map(f => [f.id, f.full_name.replace(/^د\.\s*/, '')]), ['all', t('cal.all')]];
    $('who').innerHTML = opts.map(([v, l]) => `<button type="button" data-who="${esc(v)}" class="${cal.who === v ? 'on' : ''}" aria-pressed="${cal.who === v}" dir="auto">${esc(l)}</button>`).join('');
    $('who').querySelectorAll('[data-who]').forEach(b => b.onclick = () => { cal.who = b.dataset.who; drawWho(); draw(); });
  };
  const shown = () => events.filter(e => cal.who === 'all' || (cal.who === 'me' ? e.mine : e.owner_id === cal.who));
  const initialsOf = e => (cal.who === 'all' && !e.mine ? `<b class="who-tag">${esc(initials(e.owner_name))}</b>` : '');

  const draw = () => {
    const list = shown();
    const byDay = new Map();
    for (const e of list) { if (!byDay.has(e.event_date)) byDay.set(e.event_date, []); byDay.get(e.event_date).push(e); }
    $('mlabel').textContent = toUTC(cal.month).toLocaleDateString(locale(), { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const start = weekStart(cal.month), td = today(), m = cal.month.slice(0, 7);
    const weeks = Math.ceil((daysBetween(start, cal.month) + new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()) / 7);
    const heads = Array.from({ length: 7 }, (_, i) => `<div class="cal-wd">${fmtDay(addDays(start, i), { weekday: 'short' })}</div>`).join('');
    const cells = Array.from({ length: weeks * 7 }, (_, i) => {
      const d = addDays(start, i), items = byDay.get(d) || [];
      const cls = ['cal-cell', d.slice(0, 7) !== m && 'out', d === td && 'is-today', d === cal.day && 'sel', d < td && 'past'].filter(Boolean).join(' ');
      return `<div class="${cls}" data-day="${d}" role="button" tabindex="0" aria-label="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${items.length ? ' · ' + items.length : ''}">
        <span class="cal-num">${+d.slice(8)}</span>
        <div class="cal-items">${items.slice(0, 3).map(e => `<button type="button" class="cal-chip k-${e.kind} ${e.done ? 'done' : ''}" data-ev="${e.id}">${initialsOf(e)}${e.start_time ? `<bdi class="t" dir="ltr">${esc(e.start_time)}</bdi>` : ''}<bdi dir="auto">${esc(eventTitle(e))}</bdi></button>`).join('')}
          ${items.length > 3 ? `<span class="cal-more">${t('cal.more', { n: items.length - 3 })}</span>` : ''}</div>
        <div class="cal-dots" aria-hidden="true">${items.slice(0, 4).map(e => `<i class="dot k-${e.kind}"></i>`).join('')}</div>
      </div>`;
    }).join('');
    $('grid').innerHTML = heads + cells;
    $('grid').querySelectorAll('[data-day]').forEach(c => {
      c.onclick = ev => { if (ev.target.closest('[data-ev]')) return; cal.day = c.dataset.day; draw(); };
      c.ondblclick = ev => { if (!ev.target.closest('[data-ev]')) eventModal({ event_date: c.dataset.day }, load); };
      c.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); cal.day = c.dataset.day; draw(); } };
    });
    $('grid').querySelectorAll('[data-ev]').forEach(b => b.onclick = () => eventModal(list.find(e => e.id == b.dataset.ev), load));
    drawDay(byDay.get(cal.day) || []);
    drawOverdue();
  };
  const drawDay = items => {
    $('daypanel').innerHTML = `<div class="card-head"><h2>${fmtDay(cal.day, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <button type="button" class="btn sm" data-addday>＋ ${t('cal.addShort')}</button></div>
      ${items.length ? items.map(e => `<div class="ev-row k-${e.kind} ${e.done ? 'done' : ''}">
          <div class="ev-time"><bdi>${esc(timeRange(e))}</bdi></div>
          <div class="ev-main"><b dir="auto">${KIND_ICON[e.kind]} ${esc(eventTitle(e))}</b>
            <span class="muted small" dir="auto">${[!e.mine && e.owner_name, e.location, e.private && '🔒 ' + t('cal.privateShort')].filter(Boolean).map(esc).join(' · ')}${mapLinkHtml(e.location_url)}</span>
            ${e.notes ? `<span class="small ev-notes" dir="auto">${esc(e.notes)}</span>` : ''}</div>
          <div class="ev-actions">${e.mine ? `<label class="check sm" title="${esc(t('cal.done'))}"><input type="checkbox" data-done="${e.id}" ${e.done ? 'checked' : ''}> ${t('cal.doneShort')}</label>` : ''}
            <button type="button" class="btn ghost sm" data-ev="${e.id}">${t(e.mine ? 'common.edit' : 'cal.view')}</button></div>
        </div>`).join('')
        : `<div class="empty friendly small-empty"><span class="big" aria-hidden="true">🗓️</span><p>${t('cal.dayEmpty')}</p></div>`}`;
    $('daypanel').querySelector('[data-addday]').onclick = () => eventModal({ event_date: cal.day }, load);
    $('daypanel').querySelectorAll('[data-ev]').forEach(b => b.onclick = () => eventModal(events.find(e => e.id == b.dataset.ev), load));
    $('daypanel').querySelectorAll('[data-done]').forEach(c => c.onchange = async () => {
      try { await setEventDone(+c.dataset.done, c.checked); const e = events.find(x => x.id == c.dataset.done); if (e) e.done = c.checked; draw(); }
      catch (err) { c.checked = !c.checked; toast(err.message); }
    });
  };
  // My reminders from earlier days that aren't ticked off yet.
  let overdue = [];
  const drawOverdue = () => {
    $('overdue').innerHTML = overdue.length ? `<div class="alert-bar warn" role="status"><span aria-hidden="true">⏰</span>
      <span>${t('cal.overdue', { n: overdue.length })}: ${overdue.slice(0, 3).map(e => `<button type="button" class="link" data-od="${e.id}" dir="auto">${esc(eventTitle(e))}</button>`).join(', ')}</span></div>` : '';
    $('overdue').querySelectorAll('[data-od]').forEach(b => b.onclick = () => { const e = overdue.find(x => x.id == b.dataset.od); cal.day = e.event_date; cal.month = monthStart(e.event_date); load(); });
  };
  let loadNo = 0;
  async function load() {
    const mine = ++loadNo;
    const from = weekStart(cal.month), to = addDays(from, 6 * 7);
    try {
      const [ev, od] = await Promise.all([listEvents(from, to),
        sb.from('founder_events').select('*').eq('owner_id', state.user.id).eq('done', false).eq('kind', 'reminder').lt('event_date', today()).order('event_date').limit(20)]);
      if (mine !== loadNo) return;
      events = ev; overdue = check(od).map(normalizeEvent);
      draw();
    } catch (err) { $('grid').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  }
  const go = n => { cal.month = addMonths(cal.month, n); if (cal.day.slice(0, 7) !== cal.month.slice(0, 7)) cal.day = cal.month; load(); };
  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  $('today').onclick = () => { cal.day = today(); cal.month = monthStart(cal.day); load(); };
  $('add').onclick = () => eventModal({ event_date: cal.day }, load);
  drawWho();
  listFounders().then(f => { founders = f; drawWho(); }).catch(() => {});
  load();
}
