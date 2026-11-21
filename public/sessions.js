'use strict';
// Sessions: the shared session form and table, the doctor portal, and the founders' Sessions page.
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

// ---------- session form (shared by doctors and founders) ----------
function sessionFormHtml(s = {}, { doctors, future = false } = {}) {
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
      <div class="field"><label>${t('form.date')}</label><input name="session_date" type="date" required value="${esc(s.session_date || today())}" ${future ? '' : `max="${today()}"`}></div>
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
      try {
        const b = formData(f); sessionPayload(b); // check the form before asking
        if (!await confirmAction({ title: t('confirm.saveSession'), confirm: t('confirm.saveBtn') })) return;
        await updateSession(s.id, b); close(); toast(t('edit.updated')); onDone();
      }
      catch (err) { f.querySelector('.error').textContent = err.message; }
    };
    m.querySelector('[data-del]').onclick = async () => {
      if (!await confirmAction({ title: t('confirm.deleteSession'), message: t('confirm.deleteSessionMsg'), confirm: t('confirm.deleteSessionBtn') })) return;
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
    main.querySelector('#mine').innerHTML = sessions.length ? sessionRows(sessions, { showDoctor: false, editable: true })
      : `<div class="empty friendly"><span class="big" aria-hidden="true">📝</span><p>${t('portal.empty')}</p></div>`;
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

