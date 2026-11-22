'use strict';
// Patients (founders): everyone the agency treats, with optional phone and condition (why they come),
// how many sessions they had, when, and with which doctors. Founders can edit, merge duplicates
// (same person typed twice) and remove a patient who has no sessions.
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

async function patientsPage(main) {
  main.innerHTML = `
    <div class="head"><div><h1>${t('pat.title')}</h1><p class="muted">${t('pat.sub')}</p></div></div>
    <div class="toolbar"><div class="field grow"><label for="pq">${t('pat.search')}</label><input id="pq" type="search" dir="auto" placeholder="${esc(t('pat.search.ph'))}"></div></div>
    <div id="plist">${skeleton('table')}</div>`;
  const $ = id => main.querySelector('#' + id);
  let patients = [], stats = new Map(), names = new Map();
  const draw = () => {
    const q = nameKey($('pq').value);
    const rows = patients
      .filter(p => !q || nameKey(p.full_name).includes(q) || nameKey(p.condition).includes(q) || String(p.phone || '').replace(/\s/g, '').includes(q.replace(/\s/g, '')))
      .map(p => ({ p, st: stats.get(p.id) || { sessions: 0, last_session: null, doctor_ids: [] } }))
      .sort((a, b) => (b.st.last_session || '').localeCompare(a.st.last_session || '') || a.p.full_name.localeCompare(b.p.full_name));
    $('plist').innerHTML = rows.length ? `<div class="card" style="padding:6px"><div class="table-wrap cards"><table>
      <thead><tr><th>${t('th.patient')}</th><th>${t('patient.condition')}</th><th>${t('patient.phone')}</th><th>${t('pat.sessions')}</th><th>${t('profile.last')}</th><th>${t('pat.doctors')}</th><th></th></tr></thead>
      <tbody>${rows.slice(0, 300).map(({ p, st }) => `<tr>
        <td class="c-patient" dir="auto"><strong>${esc(p.full_name)}</strong></td>
        <td class="c-notes small" dir="auto">${esc(p.condition || '—')}</td>
        <td class="c-phone">${p.phone ? `<a href="tel:${esc(p.phone)}" dir="ltr">${esc(p.phone)}</a>` : '<span class="muted">—</span>'}</td>
        <td class="c-min" data-unit="${esc(t('pat.sessions'))}">${st.sessions}</td>
        <td class="c-date">${st.last_session ? fmtDate(st.last_session) : '—'}</td>
        <td class="c-doctor small" dir="auto">${(st.doctor_ids || []).map(id => esc(names.get(id) || '')).filter(Boolean).join('، ')}</td>
        <td class="c-edit"><button type="button" class="btn ghost sm" data-p="${p.id}">${t('common.edit')}</button></td></tr>`).join('')}</tbody></table></div>
      ${rows.length > 300 ? `<p class="muted small" style="padding:8px">${t('pat.more', { n: rows.length - 300 })}</p>` : ''}</div>`
      : `<div class="card empty friendly"><span class="big" aria-hidden="true">🩺</span><p>${t(q ? 'sessions.noMatch' : 'pat.none')}</p></div>`;
    main.querySelectorAll('[data-p]').forEach(b => b.onclick = () => patientModal(patients.find(p => p.id == b.dataset.p), stats.get(+b.dataset.p), patients, load));
  };
  const load = async () => {
    try {
      const [list, st, docs] = await Promise.all([listPatients(true), sb.from('patient_stats').select('*').then(check), listDoctors()]);
      patients = list; stats = new Map(st.map(x => [x.patient_id, x])); names = new Map(docs.map(d => [d.id, d.full_name]));
    } catch (err) { $('plist').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
    draw();
  };
  let timer; $('pq').oninput = () => { clearTimeout(timer); timer = setTimeout(draw, 150); };
  load();
}

function patientModal(p, st, all, onDone) {
  const others = all.filter(x => x.id !== p.id);
  modal(`<h2 dir="auto">${esc(p.full_name)}</h2>
    <form>
      <div class="field"><label>${t('form.patient')}</label><input name="full_name" dir="auto" required value="${esc(p.full_name)}"></div>
      <div class="grid2">
        <div class="field"><label>${t('patient.phone')} <span class="muted">${t('form.optional')}</span></label><input name="phone" dir="ltr" inputmode="tel" value="${esc(p.phone)}" placeholder="01x xxxx xxxx"></div>
        <div class="field"><label>${t('patient.condition')} <span class="muted">${t('form.optional')}</span></label><input name="condition" dir="auto" value="${esc(p.condition)}" placeholder="${esc(t('patient.condition.ph'))}"></div>
      </div>
      <div class="field"><label>${t('form.notes')} <span class="muted">${t('form.optional')}</span></label><textarea name="notes" dir="auto">${esc(p.notes)}</textarea></div>
      <details class="merge-box"><summary>${t('pat.mergeQ')}</summary>
        <p class="muted small">${t('pat.mergeHelp')}</p>
        <div class="search-row"><select data-merge><option value="">${t('form.choose')}</option>${others.map(x => `<option value="${x.id}">${esc(x.full_name)}${x.phone ? ' · ' + esc(x.phone) : ''}</option>`).join('')}</select>
          <button type="button" class="btn ghost" data-domerge>${t('pat.merge')}</button></div>
      </details>
      <div class="error" role="alert"></div>
      <div class="actions">${st?.sessions ? '' : `<button type="button" class="btn danger" data-del>${t('common.delete')}</button>`}<span style="flex:1"></span>
        <button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div>
    </form>`, (m, close) => {
    const form = m.querySelector('form'), err = m.querySelector('.error');
    onSubmit(form, async () => {
      const b = formData(form);
      if (!cleanName(b.full_name)) throw new Error(t('err.patient'));
      check(await sb.from('patients').update({ full_name: cleanName(b.full_name), phone: b.phone.trim(), condition: b.condition.trim(), notes: b.notes.trim() }).eq('id', p.id).select('id'));
      patientCache.stale = true; close(); toast(t('pat.saved')); onDone();
    });
    m.querySelector('[data-domerge]').onclick = async () => {
      const dst = others.find(x => x.id == m.querySelector('[data-merge]').value);
      if (!dst) { err.textContent = t('pat.pickMerge'); return; }
      if (!await confirmAction({ title: t('pat.mergeConfirm', { a: p.full_name, b: dst.full_name }), message: t('pat.mergeMsg'), confirm: t('pat.merge') })) return;
      try { check(await sb.rpc('merge_patients', { src: p.id, dst: dst.id })); patientCache.stale = true; close(); toast(t('pat.merged')); onDone(); }
      catch (e) { err.textContent = e.message; }
    };
    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!await confirmAction({ title: t('pat.deleteQ', { name: p.full_name }), message: t('pat.deleteMsg'), confirm: t('common.delete') })) return;
      try { const rows = check(await sb.from('patients').delete().eq('id', p.id).select('id')); if (!rows.length) throw new Error(t('err.notAllowed')); patientCache.stale = true; close(); toast(t('pat.deleted')); onDone(); }
      catch (e) { err.textContent = e.message; }
    };
  });
}
