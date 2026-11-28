'use strict';
// Running the business: who uses the portal, one inbox for new patients, money, and tools for the technical team.
//  * trackVisit(): one row per person per page per day (RPC track_visit) — powers "last active" and usage totals.
//  * Browser errors are reported automatically (RPC log_client_error, rate-limited) and listed for the tech team.
//  * Founders: #/activity (doctors' use of the portal), #/inbox (website requests + partner referrals waiting), #/money
//    (month totals, default prices, the technical team's commission). Tech team: Errors / Usage / Commission tabs.
// Tables/RPCs: migration 20261126020000 (activity_days, client_errors, fee_defaults, tech_commission, tech_payouts).

// ---------- activity tracking ----------
const trackSeen = new Map();
function trackVisit(page) {
  if (!state.user || !/^[a-z0-9_-]{1,40}$/.test(page)) return;
  const key = state.user.id + '|' + page, now = Date.now();
  if (now - (trackSeen.get(key) || 0) < 10 * 60e3) return; // one count per page per 10 minutes is plenty
  trackSeen.set(key, now);
  sb.rpc('track_visit', { p_page: page }).then(() => {}, () => {});
}

// ---------- browser errors -> the tech team ----------
const errSent = new Set();
function reportError(message, detail = '') {
  try {
    const msg = String(message || '').trim();
    if (!state.user || !msg || errSent.size >= 10 || errSent.has(msg)) return;
    if (/ResizeObserver loop|^Script error\.?$/i.test(msg)) return; // browser noise, not our bugs
    errSent.add(msg);
    sb.rpc('log_client_error', { p_page: (location.hash || '#/').slice(0, 60), p_message: msg.slice(0, 300), p_detail: String(detail || '').slice(0, 2000),
      p_ua: navigator.userAgent.slice(0, 200), p_version: (typeof APP_VERSION !== 'undefined' && APP_VERSION) || '' }).then(() => {}, () => {});
  } catch { /* never let error reporting cause errors */ }
}
window.addEventListener('error', e => reportError(e.message, [e.filename && `${e.filename}:${e.lineno}:${e.colno}`, e.error?.stack].filter(Boolean).join('\n')));
window.addEventListener('unhandledrejection', e => reportError(e.reason?.message || String(e.reason), e.reason?.stack || ''));

// ---------- small helpers ----------
const egp = n => `${fmtNum(Math.round(Number(n) || 0))} ${t('money.egp')}`;
function ago(ts) {
  if (!ts) return t('act.never');
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60000));
  if (mins < 60) return t('ago.min', { n: Math.max(1, mins) });
  const h = Math.round(mins / 60); if (h < 24) return t('ago.h', { n: h });
  return t('ago.d', { n: Math.round(h / 24) });
}
const opsMonthStart = ym => ym + '-01';
const opsMonthEnd = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const opsShiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthName = ym => new Date(ym + '-01T00:00:00Z').toLocaleDateString(locale(), { timeZone: 'UTC', month: 'long', year: 'numeric' });

// ---------- founders: how doctors use the portal ----------
async function activityPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('act.title')}</h1><p class="muted">${t('act.sub')}</p></div></div><div id="act">${skeleton('table', 4)}</div>`;
  let rows;
  try { rows = check(await sb.rpc('doctor_activity')); } catch (x) { main.querySelector('#act').innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
  const flags = d => {
    const f = [];
    const seenDays = d.last_seen ? (Date.now() - new Date(d.last_seen)) / 864e5 : null;
    if (!d.last_seen && !d.last_sign_in) f.push(['red', t('act.f.never')]);
    else if (seenDays === null || seenDays > 7) f.push(['amber', t('act.f.quiet')]);
    if (Number(d.open_visits) > 0) f.push(['amber', t('act.f.open', { n: d.open_visits })]);
    if (Number(d.late_30d) > 0) f.push(['amber', t('act.f.late', { n: d.late_30d })]);
    return f;
  };
  const daysSince = d => d.last_session ? Math.round((Date.now() - new Date(d.last_session + 'T00:00:00')) / 864e5) : '';
  const list = rows.filter(d => d.active), off = rows.filter(d => !d.active);
  const ok = list.filter(d => !flags(d).length).length;
  main.querySelector('#act').innerHTML = !rows.length ? `<div class="card empty">${t('doctors.none')}</div>` : `
    <div class="stats">${kpi(list.length, t('act.k.doctors'))}${kpi(ok, t('act.k.ok'))}${kpi(list.length - ok, t('act.k.attention'))}${kpi(list.filter(d => d.last_seen && Date.now() - new Date(d.last_seen) < 864e5).length, t('act.k.today'))}</div>
    <div class="card"><div class="table-wrap cards"><table>
      <thead><tr><th>${t('th.doctor')}</th><th>${t('act.th.seen')}</th><th>${t('act.th.days')}</th><th>${t('act.th.sessions')}</th><th>${t('act.th.delay')}</th><th>${t('act.th.flags')}</th><th></th></tr></thead>
      <tbody>${list.map(d => `<tr>
        <td class="c-main"><b dir="auto">${esc(d.full_name)}</b></td>
        <td data-l="${esc(t('act.th.seen'))}">${ago(d.last_seen || d.last_sign_in)}</td>
        <td data-l="${esc(t('act.th.days'))}"><bdi dir="ltr">${d.active_days_30d} / 30</bdi></td>
        <td data-l="${esc(t('act.th.sessions'))}">${t('act.sessions', { w: d.sessions_7d, m: d.sessions_30d })}</td>
        <td data-l="${esc(t('act.th.delay'))}">${d.avg_delay_days == null ? '—' : t('act.delay', { n: d.avg_delay_days })}</td>
        <td data-l="${esc(t('act.th.flags'))}">${flags(d).map(([c, l]) => `<span class="act-flag ${c}">${esc(l)}</span>`).join(' ') || `<span class="act-flag ok">${t('act.f.ok')}</span>`}</td>
        <td><button type="button" class="btn ghost sm" data-remind="${d.id}">${t('act.remind')}</button></td></tr>`).join('')}</tbody></table></div></div>
    ${off.length ? `<p class="muted small" style="margin-top:12px">${t('act.off', { n: off.length })}</p>` : ''}
    <p class="muted small">${t('act.note')}</p>`;
  main.querySelectorAll('[data-remind]').forEach(b => b.onclick = () => { const d = rows.find(x => x.id === b.dataset.remind); remindDoctor(d, daysSince(d)); });
}

// ---------- founders: one inbox for every new patient ----------
async function inboxItems() {
  const [reqs, refs] = await Promise.all([
    sb.from('patient_requests').select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(200).then(check),
    listReferrals().then(all => all.filter(r => r.status === 'new')),
  ]);
  const items = [
    ...reqs.map(r => ({ kind: 'req', r, at: r.opened_at || r.created_at, urgent: needsFounders(r) })),
    ...refs.map(r => ({ kind: 'ref', r, at: r.created_at, urgent: true })),
  ];
  return items.sort((a, b) => (b.urgent - a.urgent) || (new Date(a.at) - new Date(b.at)));
}
async function inboxPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('inbox.title')}</h1><p class="muted">${t('inbox.sub')}</p></div><a class="btn ghost" href="#/coverage">${t('inbox.map')}</a></div><div id="inbox">${skeleton('list', 3)}</div>`;
  const box = main.querySelector('#inbox');
  const load = async () => {
    let items;
    try { items = await inboxItems(); } catch (x) { box.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
    const urgent = items.filter(i => i.urgent), waiting = items.filter(i => !i.urgent);
    const card = ({ kind, r, at }) => {
      const src = kind === 'ref' ? `<span class="src src-partner">${t('inbox.src.partner')}: <bdi>${esc(r.partner?.full_name || '')}</bdi></span>`
        : `<span class="src ${r.source === 'website' ? 'src-web' : 'src-manual'}">${t(r.source === 'website' ? 'inbox.src.web' : 'inbox.src.manual')}</span>`;
      const why = kind === 'req' ? (needsFounders(r) ? t({ out_of_area: 'req.st.outOfArea', visit_cancelled: 'req.st.visitCancelled', no_location: 'req.st.noLocation', no_area: 'req.st.noArea' }[r.reason] || 'req.st.overdue') : t('req.st.waiting', { n: minutesLeft(r) })) : t('inbox.newReferral');
      const place = [kind === 'ref' ? govName(r.governorate) : (r.governorate || ''), r.address].filter(Boolean).join(' · ');
      return `<article class="card inbox-card" data-kind="${kind}" data-id="${r.id}">
        <div class="ib-top">${src}<span class="muted small">${t('inbox.waited', { t: ago(at) })}</span></div>
        <h3 dir="auto">${esc(r.patient_name)}</h3>
        <p class="ib-why">${esc(why)}</p>
        ${place ? `<p class="muted small" dir="auto">📍 ${esc(place)}</p>` : ''}
        ${r.condition ? `<p class="small" dir="auto">🩺 ${esc(r.condition)}</p>` : ''}
        ${r.phone ? `<p class="small"><a href="tel:${esc(r.phone)}" dir="ltr">${esc(r.phone)}</a>${waNumber(r.phone) ? ` · <a href="https://wa.me/${waNumber(r.phone)}" target="_blank" rel="noopener">${t('req.whatsapp')}</a>` : ''}</p>` : ''}
        ${r.email ? `<p class="small"><a href="mailto:${esc(r.email)}" dir="ltr">${esc(r.email)}</a></p>` : ''}
        <div class="row ib-actions"><button type="button" class="btn sm" data-assign>${t('inbox.assign')}</button>
          ${kind === 'ref' && r.pdf_path ? `<button type="button" class="btn ghost sm" data-pdf>📄 ${t('ref.openPdf')}</button>` : ''}
          ${kind === 'ref' ? `<button type="button" class="btn ghost sm" data-decline>${t('ref.decline')}</button>` : `<button type="button" class="btn ghost sm" data-cancel>${t('inbox.cancel')}</button>`}</div>
      </article>`;
    };
    box.innerHTML = !items.length ? `<div class="card empty">✓ ${t('inbox.empty')}</div>` : `
      ${urgent.length ? `<h2 class="ib-h">${t('inbox.urgent', { n: urgent.length })}</h2><div class="inbox-grid">${urgent.map(card).join('')}</div>` : ''}
      ${waiting.length ? `<h2 class="ib-h muted">${t('inbox.waiting', { n: waiting.length })}</h2><p class="muted small">${t('inbox.waitingHelp')}</p><div class="inbox-grid">${waiting.map(card).join('')}</div>` : ''}`;
    let doctors = null, areas = null;
    const needDoctors = async () => {
      if (!doctors) [doctors, areas] = await Promise.all([listDoctors(), listAreas()]);
    };
    box.querySelectorAll('.inbox-card').forEach(c => {
      const it = items.find(i => i.kind === c.dataset.kind && String(i.r.id) === c.dataset.id), r = it.r;
      c.querySelector('[data-assign]').onclick = async () => {
        if (it.kind === 'ref') return assignReferralModal(r, load);
        try { await needDoctors(); assignModal(r, doctors, areas, load); } catch (x) { toast(x.message); }
      };
      c.querySelector('[data-pdf]')?.addEventListener('click', () => openPdf(r.pdf_path));
      c.querySelector('[data-decline]')?.addEventListener('click', () => setReferralStatus(r, 'declined', load));
      c.querySelector('[data-cancel]')?.addEventListener('click', async () => {
        if (!await confirmAction({ title: t('inbox.cancelQ', { name: r.patient_name }), message: t('inbox.cancelMsg'), confirm: t('inbox.cancel') })) return;
        try { await callRpc('cancel_patient_request', { req_id: r.id }); toast(t('inbox.cancelled')); load(); } catch (x) { toast(x.message); }
      });
    });
  };
  load();
}
// Red count on "Inbox": requests that need a founder + new partner referrals.
async function refreshInboxBadge() {
  if (!isFounder()) return;
  let n = 0;
  try {
    const [reqs, refs] = await Promise.all([
      sb.from('patient_requests').select('id, status, reason, opened_at, created_at').eq('status', 'open').then(check),
      sb.from('referrals').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ]);
    n = reqs.filter(needsFounders).length + (refs.count || 0);
  } catch { return; }
  document.querySelectorAll('.nav[href="#/inbox"] .nav-badge').forEach(b => b.remove());
  if (n) document.querySelectorAll('.nav[href="#/inbox"]').forEach(a => a.insertAdjacentHTML('beforeend', `<span class="nav-badge red">${n}</span>`));
}

// ---------- founders: money ----------
async function moneyPage(main) {
  state.moneyMonth ??= today().slice(0, 7);
  const ym = state.moneyMonth, prev = opsShiftMonth(ym, -1);
  main.innerHTML = `<div class="head"><div><h1>${t('money.title')}</h1><p class="muted">${t('money.sub')}</p></div>
    <div class="seg month-nav"><button type="button" data-m="-1" aria-label="${esc(t('money.prev'))}">‹</button><button type="button" disabled>${esc(monthName(ym))}</button><button type="button" data-m="1" aria-label="${esc(t('money.next'))}">›</button></div></div>
    <div id="m-month">${skeleton('page')}</div>
    <h2 class="m-h">${t('money.defaultsTitle')}</h2><p class="muted small">${t('money.defaultsSub')}</p><div id="m-defaults" class="card">${skeleton('list', 1)}</div>
    <h2 class="m-h">${t('money.techTitle')}</h2><p class="muted small">${t('money.techSub')}</p><div id="m-tech" class="card">${skeleton('list', 1)}</div>`;
  main.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { state.moneyMonth = opsShiftMonth(ym, Number(b.dataset.m)); moneyPage(main); });
  let doctors = [];
  try { doctors = await listTreaters(); } catch { /* names fall back to '?' */ }
  const name = id => doctors.find(d => d.id === id)?.full_name || '?';

  // This month
  (async () => {
    const el = main.querySelector('#m-month');
    try {
      const [cur, old] = await Promise.all([listSessions({ from: opsMonthStart(ym), to: opsMonthEnd(ym) }), listSessions({ from: opsMonthStart(prev), to: opsMonthEnd(prev) })]);
      const sum = (l, k) => l.reduce((a, s) => a + (Number(s[k]) || 0), 0);
      const noPrice = cur.filter(s => s.price == null).length;
      const byDoc = new Map();
      cur.forEach(s => { const x = byDoc.get(s.doctor_id) || { n: 0, price: 0, com: 0 }; x.n++; x.price += Number(s.price) || 0; x.com += Number(s.commission) || 0; byDoc.set(s.doctor_id, x); });
      el.innerHTML = `<div class="stats">
          ${kpi(fmtNum(cur.length), t('money.k.sessions'), delta(cur.length, old.length))}
          ${kpi(egp(sum(cur, 'price')), t('money.k.revenue'), delta(sum(cur, 'price'), sum(old, 'price')))}
          ${kpi(egp(sum(cur, 'commission')), t('money.k.commission'), delta(sum(cur, 'commission'), sum(old, 'commission')))}
          ${kpi(fmtNum(noPrice), t('money.k.noPrice'), noPrice ? `<a href="#/sessions">${t('money.fixPrices')}</a>` : '')}</div>
        ${byDoc.size ? `<div class="card"><div class="table-wrap cards"><table><thead><tr><th>${t('th.doctor')}</th><th>${t('money.th.sessions')}</th><th>${t('money.th.revenue')}</th><th>${t('money.th.commission')}</th></tr></thead>
          <tbody>${[...byDoc].sort((a, b) => b[1].price - a[1].price).map(([id, x]) => `<tr><td class="c-main"><b dir="auto">${esc(name(id))}</b></td>
            <td data-l="${esc(t('money.th.sessions'))}">${fmtNum(x.n)}</td><td data-l="${esc(t('money.th.revenue'))}">${egp(x.price)}</td><td data-l="${esc(t('money.th.commission'))}">${egp(x.com)}</td></tr>`).join('')}</tbody></table></div></div>`
          : `<div class="card empty">${t('money.none')}</div>`}`;
    } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; }
  })();

  // Default prices
  const drawDefaults = async () => {
    const el = main.querySelector('#m-defaults');
    let rows;
    try { rows = check(await sb.from('fee_defaults').select('*')); } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
    const g = rows.find(r => !r.doctor_id) || {}, per = rows.filter(r => r.doctor_id);
    const free = doctors.filter(d => d.active && !per.some(p => p.doctor_id === d.id));
    el.innerHTML = `<form class="fee-row" data-global>
        <b>${t('money.everyone')}</b>
        <label>${t('fee.price')}<input name="price" type="number" min="0" inputmode="numeric" value="${g.price ?? ''}"></label>
        <label>${t('fee.commission')}<input name="commission" type="number" min="0" inputmode="numeric" value="${g.commission ?? ''}"></label>
        <button class="btn sm">${t('common.save')}</button></form>
      ${per.map(p => `<form class="fee-row" data-doc="${p.doctor_id}">
        <b dir="auto">${esc(name(p.doctor_id))}</b>
        <label>${t('fee.price')}<input name="price" type="number" min="0" inputmode="numeric" value="${p.price ?? ''}"></label>
        <label>${t('fee.commission')}<input name="commission" type="number" min="0" inputmode="numeric" value="${p.commission ?? ''}"></label>
        <button class="btn sm">${t('common.save')}</button><button type="button" class="btn ghost sm" data-remove>${t('common.delete')}</button></form>`).join('')}
      ${free.length ? `<div class="fee-add"><select data-add><option value="">${t('money.addDoctor')}</option>${free.map(d => `<option value="${d.id}">${esc(d.full_name)}</option>`).join('')}</select></div>` : ''}
      <p class="error" role="alert"></p>`;
    const err = el.querySelector('.error');
    const num = v => { const s = String(v ?? '').trim(); if (!s) return null; const n = Number(s); if (!Number.isInteger(n) || n < 0 || n > 1000000) throw new Error(t('err.fee')); return n; };
    el.querySelectorAll('form').forEach(f => onSubmit(f, async () => {
      err.textContent = '';
      const b = formData(f), doc = f.dataset.doc || null, existing = rows.find(r => (r.doctor_id || null) === doc);
      const vals = { price: num(b.price), commission: num(b.commission) };
      if (existing) check(await sb.from('fee_defaults').update(vals).eq('id', existing.id).select('id'));
      else check(await sb.from('fee_defaults').insert({ ...vals, doctor_id: doc }).select('id'));
      toast(t('money.saved')); drawDefaults();
    }));
    el.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
      const f = b.closest('form'), row = rows.find(r => r.doctor_id === f.dataset.doc);
      try { check(await sb.from('fee_defaults').delete().eq('id', row.id)); drawDefaults(); } catch (x) { err.textContent = x.message; }
    });
    el.querySelector('[data-add]')?.addEventListener('change', async e => {
      if (!e.target.value) return;
      try { check(await sb.from('fee_defaults').insert({ doctor_id: e.target.value, price: g.price ?? null, commission: g.commission ?? null }).select('id')); drawDefaults(); } catch (x) { err.textContent = x.message; }
    });
  };
  drawDefaults();

  // The technical team's commission
  const drawTech = async () => {
    const el = main.querySelector('#m-tech');
    let cfg, rows = [];
    try { cfg = check(await sb.from('tech_commission').select('*').maybeSingle()); if (cfg) rows = check(await sb.rpc('tech_commission_statement')); }
    catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
    el.innerHTML = `<form class="fee-row" id="tc-form">
        <label>${t('money.rate')}<input name="rate" type="number" min="0" max="20" step="0.5" inputmode="decimal" value="${cfg?.rate ?? ''}" required></label>
        <label>${t('money.start')}<input name="start_date" type="date" value="${cfg?.start_date ?? ''}" required></label>
        <label>${t('money.months')}<input name="months" type="number" min="1" max="60" value="${cfg?.months ?? 6}" required></label>
        <button class="btn sm">${t('common.save')}</button></form>
      ${cfg ? statementHtml(rows, true) : `<p class="muted small">${t('money.techNotSet')}</p>`}
      <p class="error" role="alert"></p>`;
    onSubmit(el.querySelector('#tc-form'), async () => {
      const b = formData(el.querySelector('#tc-form'));
      const rate = Number(b.rate), months = parseInt(b.months, 10);
      if (!(rate >= 0 && rate <= 20)) throw new Error(t('money.rateErr'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) throw new Error(t('err.date'));
      check(await sb.from('tech_commission').upsert({ id: 1, rate, start_date: b.start_date, months }).select('id'));
      toast(t('money.saved')); drawTech();
    });
    el.querySelectorAll('[data-pay]').forEach(btn => btn.onclick = async () => {
      const r = rows.find(x => x.month === btn.dataset.pay);
      if (!await confirmAction({ title: t('money.payQ', { m: monthName(r.month.slice(0, 7)), amount: egp(r.amount) }), confirm: t('money.markPaid'), danger: false })) return;
      try { check(await sb.from('tech_payouts').insert({ month: r.month, commission_base: Number(r.commission_base), rate: Number(r.rate), amount: Number(r.amount) }).select('month')); drawTech(); }
      catch (x) { toast(x.message); }
    });
    el.querySelectorAll('[data-unpay]').forEach(btn => btn.onclick = async () => {
      if (!await confirmAction({ title: t('money.unpayQ'), confirm: t('money.unpay') })) return;
      try { check(await sb.from('tech_payouts').delete().eq('month', btn.dataset.unpay)); drawTech(); } catch (x) { toast(x.message); }
    });
  };
  drawTech();
}

// Month-by-month statement of the technical team's commission (founders can mark months paid).
function statementHtml(rows, founder) {
  if (!rows.length) return `<p class="muted small">${t('money.noMonths')}</p>`;
  const total = rows.reduce((a, r) => a + Number(r.amount), 0), paid = rows.reduce((a, r) => a + (r.paid_at ? Number(r.paid_amount) : 0), 0);
  return `<div class="stats small-stats">${kpi(egp(total), t('money.k.earned'))}${kpi(egp(paid), t('money.k.paid'))}${kpi(egp(Math.max(0, total - paid)), t('money.k.due'))}</div>
    <div class="table-wrap cards"><table><thead><tr><th>${t('money.th.month')}</th><th>${t('money.th.sessions')}</th><th>${t('money.th.base')}</th><th>${t('money.th.share')}</th><th>${t('money.th.status')}</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="c-main"><b>${esc(monthName(r.month.slice(0, 7)))}</b></td>
      <td data-l="${esc(t('money.th.sessions'))}">${fmtNum(r.sessions)}</td><td data-l="${esc(t('money.th.base'))}">${egp(r.commission_base)}</td>
      <td data-l="${esc(t('money.th.share'))}"><b>${egp(r.amount)}</b> <span class="muted small">(${fmtNum(r.rate)}%)</span></td>
      <td data-l="${esc(t('money.th.status'))}">${r.paid_at ? `<span class="act-flag ok">${t('money.paidOn', { d: fmtDate(String(r.paid_at).slice(0, 10)) })}${Number(r.paid_amount) !== Number(r.amount) ? ` · ${egp(r.paid_amount)}` : ''}</span>${founder ? ` <button type="button" class="link small" data-unpay="${r.month}">${t('money.unpay')}</button>` : ''}`
        : founder ? `<button type="button" class="btn sm" data-pay="${r.month}">${t('money.markPaid')}</button>` : `<span class="act-flag amber">${t('money.unpaid')}</span>`}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- technical team tabs ----------
async function techErrorsPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('errs.title')}</h1><p class="muted">${t('errs.sub')}</p></div><button type="button" class="btn ghost" id="err-clear">${t('errs.clear')}</button></div><div id="errs">${skeleton('list', 3)}</div>`;
  const el = main.querySelector('#errs');
  let rows;
  try { rows = check(await sb.from('client_errors').select('*').order('created_at', { ascending: false }).limit(200)); } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
  const day = rows.filter(r => Date.now() - new Date(r.created_at) < 864e5).length;
  el.innerHTML = !rows.length ? `<div class="card empty">✓ ${t('errs.none')}</div>` : `<div class="stats small-stats">${kpi(day, t('errs.k.day'))}${kpi(rows.length, t('errs.k.shown'))}${kpi(new Set(rows.map(r => r.message)).size, t('errs.k.kinds'))}</div>
    ${rows.map(r => `<details class="card err-item"><summary><span class="err-msg" dir="ltr">${esc(r.message)}</span>
        <span class="muted small">${ago(r.created_at)} · ${esc(t('role.' + (r.role === 'admin' ? 'founder' : r.role || 'doctor')))} · <bdi dir="ltr">${esc(r.page || '#/')}</bdi>${r.app_version ? ` · v${esc(r.app_version)}` : ''}</span></summary>
      <pre dir="ltr">${esc(r.detail || '—')}</pre><p class="muted small" dir="ltr">${esc(r.ua)}</p></details>`).join('')}`;
  main.querySelector('#err-clear').onclick = async () => {
    if (!rows.length || !await confirmAction({ title: t('errs.clearQ'), confirm: t('errs.clear') })) return;
    try { check(await sb.from('client_errors').delete().lte('created_at', new Date().toISOString())); techErrorsPage(main); } catch (x) { toast(x.message); }
  };
}

async function techUsagePage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('use.title')}</h1><p class="muted">${t('use.sub')}</p></div></div><div id="use">${skeleton('page')}</div>`;
  const el = main.querySelector('#use');
  let rows;
  try { rows = check(await sb.rpc('usage_summary', { p_days: 14 })); } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
  if (!rows.length) { el.innerHTML = `<div class="card empty">${t('use.none')}</div>`; return; }
  const roles = ['admin', 'doctor', 'partner', 'tech'];
  const roleName = r => t('role.' + (r === 'admin' ? 'founder' : r));
  const days = [...new Set(rows.map(r => r.day))].sort();
  // people per day per role = max of distinct people across that role's pages (a person counts once even on several pages)
  const perDay = days.map(d => ({ d, by: Object.fromEntries(roles.map(ro => [ro, Math.max(0, ...rows.filter(x => x.day === d && x.role === ro).map(x => Number(x.people)))])) }));
  const pages = new Map();
  rows.forEach(r => { const k = r.page; const x = pages.get(k) || { hits: 0, roles: new Set() }; x.hits += Number(r.hits); x.roles.add(r.role); pages.set(k, x); });
  const top = [...pages].sort((a, b) => b[1].hits - a[1].hits).slice(0, 12), maxHits = Math.max(1, ...top.map(p => p[1].hits));
  el.innerHTML = `<div class="card"><h2 class="m-h">${t('use.perDay')}</h2><div class="table-wrap"><table><thead><tr><th>${t('use.day')}</th>${roles.map(r => `<th>${roleName(r)}</th>`).join('')}</tr></thead>
      <tbody>${perDay.reverse().map(x => `<tr><td>${fmtDate(x.d)}</td>${roles.map(r => `<td>${x.by[r] || '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:14px"><h2 class="m-h">${t('use.pages')}</h2>
      ${top.map(([p, x]) => `<div class="use-bar"><span dir="ltr">${esc(p)}</span><span class="use-track"><i style="width:${Math.round(x.hits / maxHits * 100)}%"></i></span><b>${fmtNum(x.hits)}</b></div>`).join('')}</div>`;
}

async function techCommissionPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('money.techTitle')}</h1><p class="muted">${t('money.techMine')}</p></div></div><div id="tc" class="card">${skeleton('list', 2)}</div>`;
  const el = main.querySelector('#tc');
  try {
    const cfg = check(await sb.from('tech_commission').select('*').maybeSingle());
    if (!cfg) { el.innerHTML = `<p class="muted">${t('money.techNotSetTech')}</p>`; return; }
    const rows = check(await sb.rpc('tech_commission_statement'));
    el.innerHTML = `<p>${t('money.techTerms', { rate: fmtNum(cfg.rate), start: fmtDate(cfg.start_date), n: cfg.months })}</p>${statementHtml(rows, false)}`;
  } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; }
}

// ---------- tech team (and founders' data rules allow it): email alerts through Resend ----------
// Settings live in email_settings (one row); notify-email sends, email_log records what went out (no patient data).
const splitEmails = v => [...new Set(String(v || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];
async function techEmailsPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('mail.title')}</h1><p class="muted">${t('mail.sub')}</p></div></div><div id="mail">${skeleton('page')}</div>`;
  const el = main.querySelector('#mail');
  let s, log;
  try {
    s = check(await sb.from('email_settings').select('*').eq('id', 1).maybeSingle());
    log = check(await sb.from('email_log').select('*').order('created_at', { ascending: false }).limit(30));
  } catch (x) { el.innerHTML = `<p class="error">${esc(x.message)}</p>`; return; }
  if (!s) { el.innerHTML = `<p class="error">${t('mail.missing')}</p>`; return; }
  const list = a => esc((a || []).join('\n'));
  const field = (k, help) => `<label>${t('mail.' + k)}<textarea name="${k}" rows="2" dir="ltr" placeholder="name@example.com">${list(s[k])}</textarea><small class="muted">${t(help)}</small></label>`;
  el.innerHTML = `<form class="card mail-form" id="mail-form">
      <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> <b>${t('mail.enabled')}</b></label>
      <label>${t('mail.from')}<input name="from_address" dir="ltr" maxlength="200" value="${esc(s.from_address)}"><small class="muted">${t('mail.fromHelp')}</small></label>
      ${field('bookings_to', 'mail.bookingsHelp')}${field('weekly_to', 'mail.weeklyHelp')}${field('tech_to', 'mail.techHelp')}
      <p class="error" role="alert"></p>
      <div class="actions"><button type="button" class="btn ghost" id="mail-test">${t('mail.test')}</button><button class="btn">${t('common.save')}</button></div>
    </form>
    <details class="card mail-help"><summary><b>${t('mail.howTitle')}</b></summary><ol>${[t('mail.how1'), t('mail.how2'), t('mail.how3'), t('mail.how4'), t('mail.how5')].map(x => `<li>${x}</li>`).join('')}</ol></details>
    <div class="card" style="margin-top:14px"><h2 class="m-h">${t('mail.log')}</h2>
      ${log.length ? `<div class="table-wrap"><table><thead><tr><th>${t('mail.when')}</th><th>${t('mail.kind')}</th><th>${t('mail.status')}</th><th>${t('mail.to')}</th></tr></thead><tbody>
        ${log.map(r => `<tr><td>${ago(r.created_at)}</td><td>${t('mail.k.' + r.kind)}</td>
          <td><span class="mail-st mail-${r.status}">${t('mail.st.' + r.status)}</span>${r.error ? `<div class="muted small" dir="ltr">${esc(r.error)}</div>` : ''}</td><td>${r.recipients || '—'}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="empty">${t('mail.none')}</p>`}</div>`;
  const form = el.querySelector('#mail-form');
  const read = () => {
    const b = { enabled: form.enabled.checked, from_address: form.from_address.value.trim() };
    for (const k of ['bookings_to', 'weekly_to', 'tech_to']) {
      b[k] = splitEmails(form[k].value);
      const bad = b[k].find(x => !/^[^@\s<>,;"]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(x));
      if (bad) throw new Error(t('mail.bad') + ' ' + bad);
      if (b[k].length > 10) throw new Error(t('mail.tooMany'));
    }
    return b;
  };
  onSubmit(form, async () => {
    check(await sb.from('email_settings').update(read()).eq('id', 1).select('id'));
    toast(t('mail.saved'));
  });
  el.querySelector('#mail-test').onclick = async e => {
    const btn = e.currentTarget, errEl = form.querySelector('.error');
    errEl.textContent = ''; btn.disabled = true;
    try {
      check(await sb.from('email_settings').update(read()).eq('id', 1).select('id')); // test what is on screen
      const r = await callFunction('notify-email', { action: 'test' });
      toast(t('mail.testSent', { n: r.recipients }));
      techEmailsPage(main);
    } catch (x) { errEl.textContent = x.message; }
    btn.disabled = false;
  };
}
