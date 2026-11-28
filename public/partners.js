'use strict';
// Partners: doctors, hospitals and clinics that refer patients to Nile Therapy.
//  * Partner accounts (role 'partner', Partner tab on the login page) get their own small portal:
//    send a patient (optional PDF), a report of the patients they sent, and their profile.
//  * Founders: "Partners" page (add / reset password / turn off) and "Referred patients" page, where they assign
//    a doctor by hand (RPC assign_referral) and can book the first visit. Nothing is assigned automatically.
//  * The tech team can add partners from its own page (Partners tab).
// Tables: partner_profiles, referrals; RPCs my_referrals (partner report), assign_referral; bucket referral-files.

const GOVS = [
  ['Cairo', 'القاهرة'], ['Giza', 'الجيزة'], ['Alexandria', 'الإسكندرية'], ['Qalyubia', 'القليوبية'], ['Sharqia', 'الشرقية'], ['Dakahlia', 'الدقهلية'],
  ['Gharbia', 'الغربية'], ['Monufia', 'المنوفية'], ['Beheira', 'البحيرة'], ['Kafr El Sheikh', 'كفر الشيخ'], ['Damietta', 'دمياط'], ['Port Said', 'بورسعيد'],
  ['Ismailia', 'الإسماعيلية'], ['Suez', 'السويس'], ['Fayoum', 'الفيوم'], ['Beni Suef', 'بني سويف'], ['Minya', 'المنيا'], ['Assiut', 'أسيوط'],
  ['Sohag', 'سوهاج'], ['Qena', 'قنا'], ['Luxor', 'الأقصر'], ['Aswan', 'أسوان'], ['Red Sea', 'البحر الأحمر'], ['New Valley', 'الوادي الجديد'],
  ['Matrouh', 'مطروح'], ['North Sinai', 'شمال سيناء'], ['South Sinai', 'جنوب سيناء'],
];
const govName = g => { const x = GOVS.find(([e]) => e === g); return x ? (LANG === 'ar' ? x[1] : x[0]) : (g || ''); };
const govOptions = (sel = '') => `<option value="">${t('ref.pickGov')}</option>` + GOVS.map(([e, a]) => `<option value="${e}" ${e === sel ? 'selected' : ''}>${LANG === 'ar' ? a : e}</option>`).join('');
const PARTNER_KINDS = ['doctor', 'hospital', 'clinic', 'other'];
const URGENCY = ['urgent', 'this_week', 'flexible'];
const isPartner = () => state.user?.role === 'partner';
const REF_PDF_MAX = 10 * 1024 * 1024;

// ---------- data ----------
async function pdfLink(path) {
  const { data, error } = await sb.storage.from('referral-files').createSignedUrl(path, 600);
  if (error) throw new Error(friendly(error));
  return data.signedUrl;
}
async function openPdf(path) {
  const w = window.open('', '_blank'); // open first (pop-up blockers), then point it at the file
  try { const url = await pdfLink(path); if (w) w.location = url; else location.href = url; }
  catch (x) { w?.close(); toast(x.message); }
}
async function sendReferral(form) {
  const b = formData(form);
  const name = String(b.patient_name || '').trim(), condition = String(b.condition || '').trim();
  if (!name) throw new Error(t('ref.err.name'));
  if (!condition) throw new Error(t('ref.err.condition'));
  const age = String(b.age || '').trim() === '' ? null : parseInt(b.age, 10);
  if (age !== null && !(age >= 0 && age <= 120)) throw new Error(t('ref.err.age'));
  const file = form.pdf.files[0] || null;
  if (file && (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name))) throw new Error(t('ref.err.pdfType'));
  if (file && file.size > REF_PDF_MAX) throw new Error(t('ref.err.pdfSize'));
  let path = null;
  if (file) {
    path = `${state.user.id}/${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}.pdf`;
    const { error } = await sb.storage.from('referral-files').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error(t('ref.err.upload'));
  }
  const { error } = await sb.from('referrals').insert({
    patient_name: name, phone: String(b.phone || '').trim(), age, gender: b.gender || '',
    governorate: b.governorate || '', address: String(b.address || '').trim(), condition,
    urgency: URGENCY.includes(b.urgency) ? b.urgency : 'flexible', preferred_start: b.preferred_start || null,
    notes: String(b.notes || '').trim(), pdf_path: path, pdf_name: file ? file.name.slice(0, 200) : '',
  });
  if (error) {
    if (path) await sb.storage.from('referral-files').remove([path]).catch(() => {}); // don't leave an orphan file
    throw new Error(friendly(error));
  }
}

// What the partner sees for each patient.
function partnerStatus(r) {
  if (r.status === 'new') return ['received', t('ref.ps.received')];
  if (r.status === 'declined') return ['declined', t('ref.ps.declined')];
  if (r.status === 'closed') return ['done', t('ref.ps.done')];
  return Number(r.sessions) > 0 ? ['treat', t('ref.ps.treatment')] : ['assigned', t('ref.ps.assigned')];
}
const refPill = ([cls, label]) => `<span class="ref-st ref-${cls}">${esc(label)}</span>`;

// ---------- partner portal ----------
function partnerShell() {
  const [page] = route();
  const tab = ['send', 'mine', 'profile'].includes(page) ? page : 'send';
  $app.innerHTML = `<div class="tech-shell partner-shell">
    <header class="tech-bar">
      <div class="brand"><span class="brand-mark"><img src="logo-mark.png" alt="" width="34" height="34"></span><span><b>Nile Therapy</b><small dir="auto">${esc(state.user.full_name)} · ${t('role.partner')}</small></span></div>
      <div class="row">${langButton()}<button type="button" class="btn ghost" id="pw">${t('me.password')}</button><button type="button" class="btn ghost" id="out">${t('me.logout')}</button></div>
    </header>
    <nav class="p-tabs" aria-label="${esc(t('nav.menu'))}">${['send', 'mine', 'profile'].map(k => `<a href="#/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${t('ref.tab.' + k)}</a>`).join('')}</nav>
    <main class="tech-main" id="main"></main>
  </div>`;
  wireLangButtons();
  document.getElementById('pw').onclick = passwordModal;
  document.getElementById('out').onclick = async () => {
    if (!await confirmAction({ title: t('confirm.logout'), confirm: t('me.logout') })) return;
    state.user = null; location.hash = ''; await sb.auth.signOut({ scope: 'local' }); render();
  };
  const main = document.getElementById('main');
  const draw = { send: partnerSendPage, mine: partnerReportPage, profile: partnerProfilePage }[tab];
  setLivePage('p-' + tab, draw, main);
  trackVisit('p-' + tab);
  startLive();
  draw(main);
}

function partnerSendPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('ref.sendTitle')}</h1><p class="muted">${t('ref.sendSub')}</p></div></div>
  <form class="card ref-form" id="ref-form" novalidate>
    <fieldset><legend>${t('ref.sec.patient')}</legend>
      <div class="grid2">
        <div class="field"><label for="rf-name">${t('ref.f.name')} *</label><input id="rf-name" name="patient_name" required maxlength="120" dir="auto" autocomplete="off"></div>
        <div class="field"><label for="rf-phone">${t('ref.f.phone')}</label><input id="rf-phone" name="phone" type="tel" inputmode="tel" maxlength="40" dir="ltr" placeholder="01x xxxx xxxx"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="rf-age">${t('ref.f.age')}</label><input id="rf-age" name="age" type="number" min="0" max="120" inputmode="numeric"></div>
        <div class="field"><label for="rf-gender">${t('ref.f.gender')}</label><select id="rf-gender" name="gender"><option value="">—</option><option value="male">${t('ref.g.male')}</option><option value="female">${t('ref.g.female')}</option></select></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="rf-gov">${t('ref.f.gov')}</label><select id="rf-gov" name="governorate">${govOptions()}</select></div>
        <div class="field"><label for="rf-addr">${t('ref.f.address')}</label><input id="rf-addr" name="address" maxlength="300" dir="auto" placeholder="${esc(t('ref.f.address.ph'))}"></div>
      </div>
    </fieldset>
    <fieldset><legend>${t('ref.sec.case')}</legend>
      <div class="field"><label for="rf-cond">${t('ref.f.condition')} *</label><textarea id="rf-cond" name="condition" rows="3" maxlength="2000" required dir="auto" placeholder="${esc(t('ref.f.condition.ph'))}"></textarea></div>
      <div class="grid2">
        <div class="field"><label for="rf-urg">${t('ref.f.urgency')}</label><select id="rf-urg" name="urgency">${URGENCY.map(u => `<option value="${u}" ${u === 'flexible' ? 'selected' : ''}>${t('ref.u.' + u)}</option>`).join('')}</select></div>
        <div class="field"><label for="rf-start">${t('ref.f.start')} <span class="muted">${t('form.optional')}</span></label><input id="rf-start" name="preferred_start" type="date" min="${today()}"></div>
      </div>
      <div class="field"><label for="rf-pdf">${t('ref.f.pdf')} <span class="muted">${t('form.optional')}</span></label><input id="rf-pdf" name="pdf" type="file" accept="application/pdf,.pdf"><p class="muted small">${t('ref.f.pdf.hint')}</p></div>
      <div class="field"><label for="rf-notes">${t('ref.f.notes')} <span class="muted">${t('form.optional')}</span></label><textarea id="rf-notes" name="notes" rows="2" maxlength="2000" dir="auto"></textarea></div>
    </fieldset>
    <p class="error" role="alert"></p>
    <div class="actions"><button class="btn">${t('ref.send')}</button></div>
  </form>`;
  const form = main.querySelector('#ref-form');
  wireDraft(form, 'referral', { skip: ['pdf'] });
  onSubmit(form, async () => {
    await sendReferral(form);
    clearDraft?.('referral');
    form.reset(); live.dirty = false;
    toast(t('ref.sent'));
    location.hash = '#/mine';
  });
}

async function partnerReportPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('ref.mineTitle')}</h1><p class="muted">${t('ref.mineSub')}</p></div><a class="btn" href="#/send">${t('ref.tab.send')}</a></div>
    <div id="ref-kpis"></div><div id="ref-list">${skeleton('list', 3)}</div>`;
  let rows;
  try { rows = check(await sb.rpc('my_referrals')); }
  catch (x) { main.querySelector('#ref-list').innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
  const n = s => rows.filter(r => partnerStatus(r)[0] === s).length;
  main.querySelector('#ref-kpis').innerHTML = rows.length ? `<div class="ref-kpis">
    <div class="card"><b>${rows.length}</b><span>${t('ref.k.total')}</span></div>
    <div class="card"><b>${n('received') + n('assigned')}</b><span>${t('ref.k.waiting')}</span></div>
    <div class="card"><b>${n('treat')}</b><span>${t('ref.k.treatment')}</span></div>
    <div class="card"><b>${rows.reduce((a, r) => a + Number(r.sessions || 0), 0)}</b><span>${t('ref.k.sessions')}</span></div></div>` : '';
  const list = main.querySelector('#ref-list');
  list.innerHTML = rows.length ? rows.map(r => `<article class="card ref-card">
      <div class="ref-top"><h3 dir="auto">${esc(r.patient_name)}</h3>${refPill(partnerStatus(r))}</div>
      <p class="muted small">${t('ref.sentOn', { d: fmtDate(String(r.created_at).slice(0, 10)) })}${r.age != null ? ` · ${t('ref.ageN', { n: r.age })}` : ''}${r.governorate ? ` · ${esc(govName(r.governorate))}` : ''}</p>
      <p class="ref-cond" dir="auto">${esc(r.condition)}</p>
      <dl class="ref-facts">
        <div><dt>${t('ref.doctor')}</dt><dd dir="auto">${r.doctor_name ? esc(r.doctor_name) : '—'}</dd></div>
        <div><dt>${t('ref.sessions')}</dt><dd>${Number(r.sessions || 0)}</dd></div>
        <div><dt>${t('ref.lastSession')}</dt><dd>${r.last_session ? fmtDate(r.last_session) : '—'}</dd></div>
      </dl>
      ${r.pdf_path ? `<button type="button" class="link" data-pdf="${esc(r.pdf_path)}">📄 ${esc(r.pdf_name || t('ref.pdf'))}</button>` : ''}
    </article>`).join('') : `<div class="card empty">${t('ref.noneMine')}</div>`;
  list.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => openPdf(b.dataset.pdf));
}

async function partnerProfilePage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('ref.profileTitle')}</h1><p class="muted">${t('ref.profileSub')}</p></div></div><div id="pp">${skeleton('cards', 1)}</div>`;
  let p;
  try { p = check(await sb.from('partner_profiles').select('*').eq('id', state.user.id).maybeSingle()) || { id: state.user.id }; }
  catch (x) { main.querySelector('#pp').innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
  main.querySelector('#pp').innerHTML = `<form class="card ref-form" id="pp-form">
    <div class="grid2">
      <div class="field"><label>${t('pt.f.name')}</label><input value="${esc(state.user.full_name)}" disabled dir="auto"></div>
      <div class="field"><label>${t('doc.username')}</label><input value="${esc(state.user.username)}" disabled dir="ltr"></div>
    </div>
    ${partnerFieldsHtml(p)}
    <p class="error" role="alert"></p>
    <div class="actions"><button class="btn">${t('common.save')}</button></div>
  </form>`;
  const form = main.querySelector('#pp-form');
  onSubmit(form, async () => {
    const rows = check(await sb.from('partner_profiles').update(partnerFieldsPayload(formData(form))).eq('id', state.user.id).select('id'));
    if (!rows.length) throw new Error(t('err.notAllowed'));
    live.dirty = false; toast(t('ref.saved'));
  });
}

// Shared by the partner's own profile and the "add partner" form.
function partnerFieldsHtml(p = {}) {
  return `<div class="grid2">
      <div class="field"><label>${t('pt.f.kind')}</label><select name="kind">${PARTNER_KINDS.map(k => `<option value="${k}" ${k === (p.kind || 'doctor') ? 'selected' : ''}>${t('pt.k.' + k)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('pt.f.org')}</label><input name="organization" maxlength="160" dir="auto" value="${esc(p.organization)}" placeholder="${esc(t('pt.f.org.ph'))}"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>${t('pt.f.contact')}</label><input name="contact_person" maxlength="120" dir="auto" value="${esc(p.contact_person)}"></div>
      <div class="field"><label>${t('pt.f.phone')}</label><input name="phone" type="tel" maxlength="40" dir="ltr" value="${esc(p.phone)}" placeholder="01x xxxx xxxx"></div>
    </div>
    <div class="grid2">
      <div class="field"><label>${t('pt.f.email')}</label><input name="email" type="email" maxlength="160" dir="ltr" value="${esc(p.email)}"></div>
      <div class="field"><label>${t('ref.f.gov')}</label><select name="governorate">${govOptions(p.governorate)}</select></div>
    </div>
    <div class="field"><label>${t('ref.f.address')}</label><input name="address" maxlength="300" dir="auto" value="${esc(p.address)}"></div>
    <div class="field"><label>${t('pt.f.notes')}</label><textarea name="notes" rows="2" maxlength="1000" dir="auto">${esc(p.notes)}</textarea></div>`;
}
const partnerFieldsPayload = b => ({
  kind: PARTNER_KINDS.includes(b.kind) ? b.kind : 'doctor', organization: String(b.organization || '').trim(),
  contact_person: String(b.contact_person || '').trim(), phone: String(b.phone || '').trim(), email: String(b.email || '').trim(),
  governorate: b.governorate || '', address: String(b.address || '').trim(), notes: String(b.notes || '').trim(),
});

// ---------- partners list (founders page + tech team tab) ----------
async function listPartners() {
  const [people, details] = await Promise.all([
    sb.from('profiles').select('id, username, full_name, phone, active, created_at').eq('role', 'partner').order('full_name'),
    sb.from('partner_profiles').select('*'),
  ]).then(rs => rs.map(check));
  let counts = {};
  if (isFounder()) {
    const refs = check(await sb.from('referrals').select('partner_id, status'));
    refs.forEach(r => { (counts[r.partner_id] ??= { all: 0, open: 0 }).all++; if (r.status === 'new') counts[r.partner_id].open++; });
  }
  return people.map(p => ({ ...p, d: details.find(d => d.id === p.id) || {}, n: counts[p.id] || { all: 0, open: 0 } }));
}

function addPartnerModal(onDone) {
  modal(`<h2>${t('pt.addTitle')}</h2><form>
      <div class="grid2">
        <div class="field"><label>${t('pt.f.name')} *</label><input name="full_name" required maxlength="120" dir="auto" placeholder="${esc(t('pt.f.name.ph'))}"></div>
        <div class="field"><label>${t('doc.usernameNew')} *</label><input name="username" dir="ltr" autocapitalize="none" spellcheck="false" required pattern="[a-zA-Z0-9._\\-]{3,40}" placeholder="hospital.name"></div>
      </div>
      ${partnerFieldsHtml()}
      <div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('pt.create')}</button></div></form>`, (m, close) => {
    const form = m.querySelector('form');
    onSubmit(form, async () => {
      const b = formData(form);
      const r = await callFunction('admin-doctors', { action: 'create_partner', username: b.username, full_name: b.full_name, ...partnerFieldsPayload(b) });
      close(); onDone?.(); showCredentials(t('pt.created'), r, t('pt.credsIntro'));
    });
  });
}

async function partnersPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('pt.title')}</h1><p class="muted">${t('pt.sub')}</p></div><button class="btn" id="add-partner">${t('pt.add')}</button></div>
    <div id="pt-list">${skeleton('cards', 3)}</div>`;
  const load = async () => {
    const el = main.querySelector('#pt-list');
    let list;
    try { list = await listPartners(); } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
    el.innerHTML = list.length ? `<div class="doc-grid">${list.map(p => `<article class="card pt-card ${p.active ? '' : 'off'}">
        <div class="doc-top"><div class="avatar">${esc(initials(p.full_name))}</div>
          <div><h3 dir="auto">${esc(p.full_name)}</h3><div class="muted small">${t('pt.k.' + (p.d.kind || 'doctor'))}${p.d.organization ? ` · <bdi>${esc(p.d.organization)}</bdi>` : ''}</div></div></div>
        <p class="muted small"><span dir="ltr">@${esc(p.username)}</span>${p.d.phone ? ` · <span dir="ltr">${esc(p.d.phone)}</span>` : ''}${p.d.governorate ? ` · ${esc(govName(p.d.governorate))}` : ''} ${p.active ? '' : `<span class="pill off">${t('doctors.inactive')}</span>`}</p>
        ${isFounder() ? `<div class="doc-nums"><div><b>${p.n.all}</b><span>${t('pt.n.sent')}</span></div><div><b>${p.n.open}</b><span>${t('pt.n.new')}</span></div></div>` : ''}
        <div class="row pt-actions"><button type="button" class="btn ghost sm" data-reset="${p.id}">${t('profile.reset')}</button>
          ${isFounder() ? `<button type="button" class="btn ghost sm" data-toggle="${p.id}" data-on="${p.active ? 1 : 0}">${t(p.active ? 'pt.turnOff' : 'pt.turnOn')}</button>` : ''}</div>
      </article>`).join('')}</div>` : `<div class="card empty">${t('pt.none')}</div>`;
    el.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
      if (!await confirmAction({ title: t('pt.resetQ'), message: t('pt.resetMsg'), confirm: t('profile.reset') })) return;
      try { showCredentials(t('profile.newPw'), await callFunction('admin-doctors', { action: 'reset_partner_password', partner_id: b.dataset.reset }), t('pt.credsIntro')); }
      catch (x) { toast(x.message); }
    });
    el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const on = b.dataset.on === '1';
      if (on && !await confirmAction({ title: t('pt.offQ'), message: t('pt.offMsg'), confirm: t('pt.turnOff') })) return;
      try {
        const rows = check(await sb.from('profiles').update({ active: !on }).eq('id', b.dataset.toggle).eq('role', 'partner').select('id'));
        if (!rows.length) throw new Error(t('err.notAllowed'));
        load();
      } catch (x) { toast(x.message); }
    });
  };
  main.querySelector('#add-partner').onclick = () => addPartnerModal(load);
  load();
}

// ---------- founders: referred patients ----------
async function listReferrals() {
  return check(await sb.from('referrals').select('*, partner:profiles!referrals_partner_id_fkey(full_name), doctor:profiles!referrals_assigned_doctor_id_fkey(full_name)').order('created_at', { ascending: false }).limit(500));
}

function founderRefStatus(r) {
  return { new: ['received', t('ref.fs.new')], assigned: ['assigned', t('ref.fs.assigned')], closed: ['done', t('ref.fs.closed')], declined: ['declined', t('ref.fs.declined')] }[r.status];
}

async function referralsPage(main) {
  state.refFilter ??= 'new';
  main.innerHTML = `<div class="head">
      <div><h1>${t('ref.fTitle')}</h1><p class="muted">${t('ref.fSub')}</p></div>
      <div class="seg" role="group" aria-label="${esc(t('ref.fTitle'))}">${['new', 'assigned', 'all'].map(f => `<button type="button" data-f="${f}">${t('ref.filter.' + f)}</button>`).join('')}</div>
    </div><div id="ref-board">${skeleton('list', 3)}</div>`;
  const setF = () => main.querySelectorAll('[data-f]').forEach(b => { const on = b.dataset.f === state.refFilter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  setF();
  const board = main.querySelector('#ref-board');
  const load = async () => {
    let all;
    try { all = await listReferrals(); } catch (x) { board.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
    const rows = all.filter(r => state.refFilter === 'all' || r.status === state.refFilter);
    board.innerHTML = rows.length ? rows.map(r => `<article class="card ref-card" data-id="${r.id}">
        <div class="ref-top"><h3 dir="auto">${esc(r.patient_name)}</h3>${refPill(founderRefStatus(r))}${r.urgency === 'urgent' ? `<span class="ref-st ref-urgent">${t('ref.u.urgent')}</span>` : ''}</div>
        <p class="muted small">${t('ref.from')} <b dir="auto">${esc(r.partner?.full_name || '—')}</b> · ${fmtDate(String(r.created_at).slice(0, 10))}</p>
        <dl class="ref-facts wide">
          ${r.phone ? `<div><dt>${t('ref.f.phone')}</dt><dd dir="ltr"><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd></div>` : ''}
          ${r.age != null || r.gender ? `<div><dt>${t('ref.f.age')} / ${t('ref.f.gender')}</dt><dd>${r.age ?? '—'} · ${r.gender ? t('ref.g.' + r.gender) : '—'}</dd></div>` : ''}
          ${r.governorate || r.address ? `<div><dt>${t('ref.f.address')}</dt><dd dir="auto">${esc([govName(r.governorate), r.address].filter(Boolean).join(' · '))}</dd></div>` : ''}
          <div><dt>${t('ref.f.urgency')}</dt><dd>${t('ref.u.' + r.urgency)}${r.preferred_start ? ` · ${fmtDate(r.preferred_start)}` : ''}</dd></div>
          ${r.doctor ? `<div><dt>${t('ref.doctor')}</dt><dd dir="auto">${esc(r.doctor.full_name)}</dd></div>` : ''}
        </dl>
        <p class="ref-cond" dir="auto"><b>${t('ref.f.condition')}:</b> ${esc(r.condition)}</p>
        ${r.notes ? `<p class="ref-notes" dir="auto"><b>${t('ref.f.notes')}:</b> ${esc(r.notes)}</p>` : ''}
        ${r.founder_note ? `<p class="muted small" dir="auto">${t('ref.fNote')}: ${esc(r.founder_note)}</p>` : ''}
        <div class="row ref-actions">
          ${r.pdf_path ? `<button type="button" class="btn ghost sm" data-pdf="${esc(r.pdf_path)}">📄 ${t('ref.openPdf')}</button>` : ''}
          ${r.status === 'new' || r.status === 'assigned' ? `<button type="button" class="btn sm" data-assign="${r.id}">${t(r.status === 'new' ? 'ref.assign' : 'ref.reassign')}</button>` : ''}
          ${r.status === 'assigned' ? `<button type="button" class="btn ghost sm" data-close-ref="${r.id}">${t('ref.markDone')}</button>` : ''}
          ${r.status === 'new' ? `<button type="button" class="btn ghost sm" data-decline="${r.id}">${t('ref.decline')}</button>` : ''}
          ${r.status === 'closed' || r.status === 'declined' ? `<button type="button" class="btn ghost sm" data-reopen="${r.id}">${t('ref.reopen')}</button>` : ''}
        </div>
      </article>`).join('') : `<div class="card empty">${t(state.refFilter === 'new' ? 'ref.noneNew' : 'ref.none')}</div>`;
    const byId = id => all.find(r => String(r.id) === String(id));
    board.querySelectorAll('[data-pdf]').forEach(b => b.onclick = () => openPdf(b.dataset.pdf));
    board.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => assignReferralModal(byId(b.dataset.assign), load));
    board.querySelectorAll('[data-close-ref]').forEach(b => b.onclick = () => setReferralStatus(byId(b.dataset.closeRef), 'closed', load));
    board.querySelectorAll('[data-decline]').forEach(b => b.onclick = () => setReferralStatus(byId(b.dataset.decline), 'declined', load));
    board.querySelectorAll('[data-reopen]').forEach(b => b.onclick = () => setReferralStatus(byId(b.dataset.reopen), 'reopen', load));
  };
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.refFilter = b.dataset.f; setF(); load(); });
  load();
}

async function setReferralStatus(r, to, done) {
  if (to === 'declined') {
    modal(`<h2>${t('ref.declineQ')}</h2><form><div class="field"><label>${t('ref.declineWhy')} <span class="muted">${t('form.optional')}</span></label><textarea name="why" rows="2" maxlength="1000" dir="auto"></textarea></div>
      <p class="muted small">${t('ref.declineNote')}</p><div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.back')}</button><button class="btn btn-red">${t('ref.decline')}</button></div></form>`, (m, close) => {
      const form = m.querySelector('form');
      onSubmit(form, async () => {
        const rows = check(await sb.from('referrals').update({ status: 'declined', founder_note: String(form.why.value || '').trim() }).eq('id', r.id).select('id'));
        if (!rows.length) throw new Error(t('err.notAllowed'));
        close(); toast(t('ref.declined')); done();
      });
    });
    return;
  }
  if (to === 'closed' && !await confirmAction({ title: t('ref.doneQ'), message: t('ref.doneMsg'), confirm: t('ref.markDone'), danger: false })) return;
  const status = to === 'reopen' ? (r.assigned_doctor_id ? 'assigned' : 'new') : to;
  try {
    const rows = check(await sb.from('referrals').update({ status }).eq('id', r.id).select('id'));
    if (!rows.length) throw new Error(t('err.notAllowed'));
    done();
  } catch (x) { toast(x.message); }
}

async function assignReferralModal(r, done) {
  let doctors;
  try { doctors = (await listTreaters()).filter(d => d.active); } catch (x) { return toast(x.message); } // founders included, last
  modal(`<h2>${t('ref.assignTitle')}</h2><p class="muted" dir="auto">${esc(r.patient_name)}${r.governorate ? ` · ${esc(govName(r.governorate))}` : ''}</p>
    <form>
      <div class="field"><label>${t('ref.pickDoctor')} *</label><select name="doctor" required><option value="">—</option>${doctors.map(d => `<option value="${d.id}" ${d.id === r.assigned_doctor_id ? 'selected' : ''}>${esc(whoLabel(d))}${d.area ? ` · ${esc(d.area)}` : ''}</option>`).join('')}</select></div>
      <fieldset class="ref-visit"><legend>${t('ref.firstVisit')} <span class="muted">${t('form.optional')}</span></legend>
        <div class="grid2">
          <div class="field"><label>${t('form.date')}</label><input name="date" type="date" min="${today()}" value="${r.preferred_start && r.preferred_start >= today() ? r.preferred_start : ''}"></div>
          <div class="field"><label>${t('form.time')}</label><input name="time" type="time"></div>
        </div>
        <p class="muted small">${t('ref.visitHint')}</p>
      </fieldset>
      <div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('ref.assign')}</button></div>
    </form>`, (m, close) => {
    const form = m.querySelector('form');
    onSubmit(form, async () => {
      const b = formData(form);
      if (!b.doctor) throw new Error(t('err.pickDoctor'));
      const patientId = check(await sb.rpc('assign_referral', { p_id: r.id, p_doctor: b.doctor }));
      if (b.date) {
        check(await sb.from('appointments').insert({
          doctor_id: b.doctor, patient_id: patientId, patient_name: r.patient_name, session_type: 'Home visit',
          location: [govName(r.governorate), r.address].filter(Boolean).join(' · ').slice(0, 200), appt_date: b.date, appt_time: b.time || null,
          notes: t('ref.visitNote', { p: r.partner?.full_name || '' }).slice(0, 500),
        }));
      }
      close(); toast(t(b.date ? 'ref.assignedBooked' : 'ref.assignedOk')); done();
    });
  });
}

// Red count of new referred patients on the founders' menu.
async function refreshReferralBadge() {
  if (!isFounder()) return;
  let n = 0;
  try { const { count } = await sb.from('referrals').select('id', { count: 'exact', head: true }).eq('status', 'new'); n = count || 0; } catch { return; }
  document.querySelectorAll('.nav[href="#/referrals"] .nav-badge').forEach(b => b.remove());
  if (n) document.querySelectorAll('.nav[href="#/referrals"]').forEach(a => a.insertAdjacentHTML('beforeend', `<span class="nav-badge red">${n}</span>`));
  syncGroupBadges();
}
