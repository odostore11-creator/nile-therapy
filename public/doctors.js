'use strict';
// Doctors: the founders' doctor list, doctor profile, add doctor, reset password.
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

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
    main.querySelector('#grid').innerHTML ||= skeleton('cards', 4);
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
    const form = m.querySelector('form');
    onSubmit(form, async () => {
      const r = await callFunction('admin-doctors', { action: 'create', ...formData(form) });
      close(); load(); showCredentials(t('doctors.created'), r);
    });
  });
  load();
}

async function doctorProfile(main, id) {
  let allHistory = false;
  const load = async () => {
    const { doctor: d, sessions, patients } = await getDoctor(id, allHistory ? null : addDays(today(), -180));
    main.innerHTML = `
      <div class="head"><div><a href="#/doctors" class="small">${t('profile.back')}</a><h1 dir="auto" style="margin-top:6px">${esc(d.full_name)}</h1></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="remind">${t('remind.profileBtn')}</button><button class="btn ghost" id="reset">${t('profile.reset')}</button><button class="btn" id="edit">${t('profile.edit')}</button></div></div>
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
          <section class="card" style="padding:16px 8px"><h3 style="padding:0 12px 6px">${t('profile.history')} <span class="muted small">${allHistory ? '' : t('profile.last6')}</span></h3>${sessionRows(sessions, { showDoctor: false, editable: true })}
            ${allHistory ? '' : `<button type="button" class="btn ghost block" id="allhist" style="margin-top:10px">${t('profile.showAll')}</button>`}</section>
        </div>
      </div>`;
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSessionModal(sessions.find(s => s.id == b.dataset.edit), load));
    const ah = main.querySelector('#allhist'); if (ah) ah.onclick = () => { allHistory = true; ah.disabled = true; load(); };
    main.querySelector('#edit').onclick = () => modal(`<h2>${t('profile.edit')}</h2><form>${doctorFormHtml(d)}
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><input type="checkbox" name="active" ${d.active ? 'checked' : ''} style="width:auto"> ${t('profile.active')}</label>
        <div class="error" role="alert"></div><div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div></form>`, (m, close) => {
      const form = m.querySelector('form');
      onSubmit(form, async () => {
        const body = formData(form); body.active = form.active.checked;
        const turningOff = d.active && !body.active;
        let upcoming = [];
        if (turningOff) {
          upcoming = await listAppointments({ from: today(), doctorId: id, statuses: ['planned'] });
          const msg = t('confirm.deactivateMsg') + (upcoming.length ? ' ' + t('confirm.deactivateVisits', { n: upcoming.length }) : '');
          if (!await confirmAction({ title: t('confirm.deactivate', { name: d.full_name }), message: msg, confirm: t('confirm.deactivateBtn') })) return;
        }
        await updateDoctor(id, body); close(); toast(t('profile.saved')); load();
        if (upcoming.length) reassignVisitsModal(d, upcoming, load);
      });
    });
    main.querySelector('#remind').onclick = () => remindDoctor(d, d.stats.last_session ? daysBetween(d.stats.last_session, today()) : null);
    main.querySelector('#reset').onclick = async () => {
      if (!await confirmAction({ title: t('confirm.reset', { name: d.full_name }), message: t('confirm.resetMsg'), confirm: t('profile.reset') })) return;
      try { showCredentials(t('profile.newPw'), await callFunction('admin-doctors', { action: 'reset_password', doctor_id: id })); }
      catch (err) { toast(err.message); }
    };
  };
  main.innerHTML = skeleton('page');
  try { await load(); } catch (e) { main.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}


// After a doctor is turned off: move their upcoming visits to other doctors (all at once or one by one).
async function reassignVisitsModal(d, visits, onDone) {
  let doctors;
  try { doctors = (await listDoctors()).filter(x => x.active && x.id !== d.id); } catch (err) { toast(err.message); return; }
  const opts = doctors.map(x => `<option value="${x.id}">${esc(x.full_name)}</option>`).join('');
  modal(`<h2 dir="auto">${esc(t('reassign.title', { n: visits.length, name: d.full_name }))}</h2><p class="muted">${t('reassign.help')}</p>
    <form>
      <div class="field"><label>${t('reassign.all')}</label><select data-all><option value="">${t('form.choose')}</option>${opts}</select></div>
      <div class="reassign-list">${visits.map(a => `<div class="reassign-row">
        <span><b>${fmtDay(a.appt_date, { weekday: 'short', day: 'numeric', month: 'short' })}</b> ${esc(a.appt_time || '')} · <bdi>${esc(a.patient_name)}</bdi></span>
        <select name="v${a.id}" aria-label="${esc(a.patient_name)}"><option value="">${t('reassign.keep')}</option>${opts}</select></div>`).join('')}</div>
      <div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('reassign.later')}</button><button class="btn">${t('reassign.save')}</button></div>
    </form>`, (m, close) => {
    const form = m.querySelector('form');
    m.querySelector('[data-all]').onchange = e => form.querySelectorAll('.reassign-row select').forEach(x => { x.value = e.target.value; });
    onSubmit(form, async () => {
      let n = 0;
      for (const a of visits) {
        const to = form.elements['v' + a.id].value; if (!to) continue;
        check(await sb.from('appointments').update({ doctor_id: to }).eq('id', a.id).select('id')); n++;
      }
      close(); toast(t('reassign.done', { n })); onDone();
    });
  });
}
