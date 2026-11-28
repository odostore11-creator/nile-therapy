'use strict';
// Founder Overview (home page) and the printable Monthly report.
// Charts are plain HTML/CSS bars: one hue for single series; session types use the logo's
// coral / river blue / leaf green (checked for color-blind separation), always with labels.
// Uses helpers from app.js and schedule.js at call time.

const TYPE_ORDER = ['Home visit', 'Online', 'Clinic'];
const fmtNum = n => Number(n).toLocaleString(locale(), { maximumFractionDigits: 1 });
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const isOnline = s => s.session_type === 'Online' || /video|فيديو|zoom|online/i.test(s.location);
const inRange = (list, from, to, key = 'session_date') => list.filter(s => s[key] >= from && s[key] <= to);
const monthStartOf = d => d.slice(0, 8) + '01';
const shiftMonth = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthEnd = ym => addDays(shiftMonth(ym, 1) + '-01', -1);

function delta(now, before, label = t('ov.vsBefore')) {
  if (!before && !now) return '';
  if (!before) return `<span class="delta up">▲ ${t('ov.new')}</span>`;
  const d = Math.round(((now - before) / before) * 100);
  if (d === 0) return `<span class="delta">= ${t('ov.same')}</span>`;
  return `<span class="delta ${d > 0 ? 'up' : 'down'}" title="${esc(label)}">${d > 0 ? '▲' : '▼'} <bdi dir="ltr">${Math.abs(d)}%</bdi> <span class="delta-label">${label}</span></span>`;
}
const kpi = (n, label, extra = '') => `<div class="stat"><div class="n">${n}</div><div class="l">${label}</div>${extra ? `<div class="kpi-extra">${extra}</div>` : ''}</div>`;

// Vertical bars over time. Up to 14 bars every bar shows its number; with more (daily charts) only the latest and the
// highest do, so the numbers don't crowd. Every bar has a tooltip.
function columnChart(points, caption) {
  const max = Math.max(1, ...points.map(p => p.value));
  const top = points.reduce((a, p, i) => (p.value > points[a].value ? i : a), 0);
  const all = points.length <= 14;
  return `<figure class="colchart-wrap">
    <div class="colchart" role="img" aria-label="${esc(caption)}">${points.map((p, i) => `
      <div class="col ${p.current ? 'current' : ''}" title="${esc(p.title)}">
        <span class="v">${(all && p.value) || i === points.length - 1 || i === top ? fmtNum(p.value) : ''}</span>
        <span class="bar" style="height:${Math.max(p.value ? 3 : 0, (p.value / max) * 100)}%"></span>
        <span class="x ${points.length > 6 && i % 3 && i !== points.length - 1 ? 'skip-phone' : ''}">${points.length > 14 && i % 5 && i !== points.length - 1 ? '' : esc(p.label)}</span>
      </div>`).join('')}</div>
    <details class="as-table"><summary>${t('ov.showNumbers')}</summary>
      <table><tbody>${points.map(p => `<tr><td>${esc(p.title.split(':')[0])}</td><td>${fmtNum(p.value)}</td></tr>`).join('')}</tbody></table>
    </details>
  </figure>`;
}

// Horizontal ranked bars with the value written at the end.
function barList(rows, empty) {
  if (!rows.length) return `<p class="muted small">${empty}</p>`;
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="barlist">${rows.map(r => `
    <div class="bl-row" title="${esc(r.label)}: ${fmtNum(r.value)}">
      <span class="bl-label" dir="auto">${r.href ? `<a href="${r.href}">${esc(r.label)}</a>` : esc(r.label)}</span>
      <span class="bl-track"><span class="bl-bar" style="width:${(r.value / max) * 100}%"></span></span>
      <span class="bl-v">${fmtNum(r.value)}</span>
    </div>`).join('')}</div>`;
}

// One 100% bar split by session type, plus a legend with counts and percentages.
function typeSplit(sessions) {
  const total = sessions.length;
  if (!total) return `<p class="muted small">${t('ov.noData')}</p>`;
  const counts = TYPE_ORDER.map(k => [k, sessions.filter(s => s.session_type === k).length]);
  const other = total - counts.reduce((a, [, n]) => a + n, 0);
  if (other) counts.push(['', other]);
  return `<div class="stack" role="img" aria-label="${esc(counts.map(([k, n]) => `${k ? typeLabel(k) : t('ov.other')} ${n}`).join(', '))}">
      ${counts.filter(([, n]) => n).map(([k, n]) => `<span class="seg-${typeClass(k) || (k ? 'clinic' : 'other')}" style="flex-grow:${n}" title="${esc(k ? typeLabel(k) : t('ov.other'))}: ${n}"></span>`).join('')}
    </div>
    <ul class="legend">${counts.map(([k, n]) => `<li><i class="sw seg-${typeClass(k) || (k ? 'clinic' : 'other')}"></i>${esc(k ? typeLabel(k) : t('ov.other'))}<b>${n}</b><span class="muted"><bdi dir="ltr">${pctOf(n, total)}%</bdi></span></li>`).join('')}</ul>`;
}

function topAreas(sessions, n = 5) {
  const by = new Map();
  for (const s of sessions) if (!isOnline(s) && s.location) by.set(s.location, (by.get(s.location) || 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));
}

// ---------- Overview ----------
async function overviewPage(main) {
  main.innerHTML = skeleton('page');
  const td = today(), wk = weekStart(td), ms = monthStartOf(td), lastMs = shiftMonth(td.slice(0, 7), -1) + '-01';
  const from12 = addDays(wk, -7 * 11);
  let doctors, sessions, upcoming, unclosed;
  try {
    [doctors, sessions, upcoming, unclosed] = await Promise.all([
      listDoctors(), listSessions({ from: from12 < lastMs ? from12 : lastMs }),
      listAppointments({ from: td, to: addDays(td, 6), statuses: ['planned'] }),
      listAppointments({ from: addDays(td, -30), to: addDays(td, -1), statuses: ['planned'] }),
    ]);
  } catch (err) { main.innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }

  const dayIdx = daysBetween(wk, td);
  const thisWeek = inRange(sessions, wk, td), lastWeekSoFar = inRange(sessions, addDays(wk, -7), addDays(wk, -7 + dayIdx));
  const thisMonth = inRange(sessions, ms, td);
  const lastMonthSoFar = inRange(sessions, lastMs, [addDays(lastMs, daysBetween(ms, td)), monthEnd(lastMs.slice(0, 7))].sort()[0]);
  const active = doctors.filter(d => d.active);
  const activeThisWeek = new Set(thisWeek.map(s => s.doctor_id));

  const weeks = Array.from({ length: 12 }, (_, i) => {
    const s = addDays(from12, i * 7), e = addDays(s, 6), v = inRange(sessions, s, e).length;
    return { value: v, current: s === wk, label: fmtDay(s, { day: 'numeric', month: 'short' }),
      title: `${t('ov.weekOf', { d: fmtDay(s, { day: 'numeric', month: 'short' }) })}: ${v}` };
  });
  const perDoctor = active.map(d => ({ label: d.full_name, value: thisMonth.filter(s => s.doctor_id === d.id).length, href: `#/doctors/${d.id}` }))
    .sort((a, b) => b.value - a.value);
  const quiet = active.map(d => ({ d, days: d.stats.last_session ? daysBetween(d.stats.last_session, td) : null }))
    .filter(x => x.days === null || x.days >= 7).sort((a, b) => (b.days ?? 1e9) - (a.days ?? 1e9));

  const first = state.user.full_name.replace(/^(Dr\.?|د\.)\s*/i, '').split(' ')[0];
  const nothingYet = !doctors.some(d => d.stats.total > 0) && !upcoming.length;
  main.innerHTML = `
    <div class="head">
      <div><h1>${t('ov.title')}</h1><p class="muted" dir="auto">${esc(t('ov.hello', { name: first }))} · ${fmtDay(td, { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost" href="#/schedule">${t('ov.toSchedule')}</a><a class="btn" href="#/report">${t('ov.toReport')}</a></div>
    </div>
    ${nothingYet ? firstDayCard(doctors.length) : ''}
    ${unclosed.length ? `<section class="card closing-card"><div class="card-head"><h2>⚠ ${t('ov.unclosed', { n: unclosed.length })}</h2></div>
      <p class="muted small">${t('ov.unclosedHelp')}</p>
      <div class="table-wrap cards"><table><tbody>${unclosed.slice(0, 8).map(a => `<tr>
        <td class="c-date" style="white-space:nowrap">${fmtDay(a.appt_date, { weekday: 'short', day: 'numeric', month: 'short' })}<span class="muted small c-time">${esc(a.appt_time)}</span></td>
        <td class="c-doctor" dir="auto">${esc(a.doctor_name)}</td><td class="c-patient" dir="auto"><strong>${esc(a.patient_name)}</strong></td>
        <td class="c-edit"><button type="button" class="btn ghost sm" data-visit="${a.id}">${t('common.open')}</button></td></tr>`).join('')}</tbody></table></div>
      ${unclosed.length > 8 ? `<p class="muted small">${t('ov.more', { n: unclosed.length - 8 })}</p>` : ''}</section>` : ''}
    <div class="stats">
      ${kpi(thisWeek.length, t('ov.kpi.week'), delta(thisWeek.length, lastWeekSoFar.length))}
      ${kpi(thisMonth.length, t('ov.kpi.month'), delta(thisMonth.length, lastMonthSoFar.length))}
      ${kpi(`<bdi dir="ltr">${activeThisWeek.size} / ${active.length}</bdi>`, t('ov.kpi.active'))}
      ${kpi(upcoming.length, t('ov.kpi.upcoming'))}
    </div>
    <div class="ov-grid">
      <section class="card ov-wide"><h2 class="card-title">${t('ov.weekly')}</h2><p class="muted small">${t('ov.weeklySub')}</p>${columnChart(weeks, t('ov.weekly'))}</section>
      <section class="card"><h2 class="card-title">${t('ov.attention')}</h2><p class="muted small">${t('ov.attentionSub')}</p>
        ${quiet.length ? `<ul class="alerts">${quiet.map(({ d, days }) => `<li><span class="alert-icon" aria-hidden="true">⚠</span><span><a href="#/doctors/${d.id}" dir="auto">${esc(d.full_name)}</a><br><span class="muted small">${days === null ? t('ov.never') : t('ov.daysAgo', { n: days })}</span></span>
          <button type="button" class="btn ghost sm" data-remind="${d.id}" data-days="${days ?? ''}">${t('remind.btn')}</button></li>`).join('')}</ul>`
          : active.length ? `<p class="ok-line">✓ ${t('ov.allActive')}</p>` : `<p class="muted small">${t('ov.noData')}</p>`}
      </section>
      <section class="card"><h2 class="card-title">${t('ov.byDoctor')}</h2><p class="muted small">${t('ov.thisMonthSub')}</p>${barList(perDoctor, t('ov.noData'))}</section>
      <section class="card"><h2 class="card-title">${t('ov.types')}</h2><p class="muted small">${t('ov.thisMonthSub')}</p>${typeSplit(thisMonth)}
        <h3 class="sub-title">${t('ov.areas')}</h3>${barList(topAreas(thisMonth), t('ov.noData'))}</section>
      <section class="card ov-wide"><h2 class="card-title">${t('ov.coming')}</h2>
        ${upcoming.length ? `<div class="table-wrap cards"><table><thead><tr><th>${t('th.date')}</th><th>${t('th.doctor')}</th><th>${t('th.patient')}</th><th>${t('th.type')}</th><th>${t('th.location')}</th></tr></thead><tbody>
          ${upcoming.slice(0, 12).map(a => `<tr><td class="c-date" style="white-space:nowrap">${fmtDay(a.appt_date, { weekday: 'short', day: 'numeric', month: 'short' })}<span class="muted small c-time">${esc(a.appt_time)}</span></td>
            <td class="c-doctor" dir="auto">${esc(a.doctor_name)}</td><td class="c-patient" dir="auto"><strong>${esc(a.patient_name)}</strong></td>
            <td class="c-type">${a.session_type ? `<span class="pill ${typeClass(a.session_type)}">${esc(typeLabel(a.session_type))}</span>` : ''}</td><td class="c-loc"><bdi>${esc(a.location)}</bdi></td></tr>`).join('')}
          </tbody></table></div>${upcoming.length > 12 ? `<p class="muted small">${t('ov.more', { n: upcoming.length - 12 })}</p>` : ''}`
          : `<p class="muted small">${t('ov.nothingBooked')} <a href="#/schedule">${t('ov.toSchedule')}</a></p>`}
      </section>
    </div>`;
  wireReminders(main, doctors);
  main.querySelectorAll('[data-visit]').forEach(b => b.onclick = () => visitModal(unclosed.find(a => a.id == b.dataset.visit), () => overviewPage(main), doctors));
}

// Shown on the Overview until anything has been logged or booked.
function firstDayCard(doctorCount) {
  const step = (n, done, href, title, sub) => `<li class="${done ? 'done' : ''}"><span class="step-n">${done ? '✓' : n}</span>
    <span><a href="${href}"><b>${t(title)}</b></a><br><span class="muted small">${t(sub)}</span></span></li>`;
  return `<section class="card first-day">
    <h2>${t('first.title')}</h2><p class="muted">${t('first.sub')}</p>
    <ol class="steps">
      ${step(1, doctorCount > 0, '#/doctors', 'first.step1', 'first.step1sub')}
      ${step(2, false, '#/schedule', 'first.step2', 'first.step2sub')}
      ${step(3, false, '#/sessions', 'first.step3', 'first.step3sub')}
    </ol></section>`;
}

// ---------- reminding a doctor (opens WhatsApp with a ready message; nothing is sent automatically) ----------
function waNumber(phone) {
  let d = String(phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = '20' + d.slice(1); // Egyptian mobile 01xxxxxxxxx -> 201xxxxxxxxx
  return /^\d{8,15}$/.test(d) ? d : null;
}
function remindDoctor(d, days) {
  const name = String(d.full_name || '').replace(/^(Dr\.?|د\.)\s*/i, '').split(' ')[0];
  const text = days === null || days === '' ? t('remind.never', { name }) : t('remind.days', { name, n: days });
  const num = waNumber(d.phone);
  if (num) { window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); return; }
  navigator.clipboard?.writeText(text);
  toast(t('remind.copied'));
}
function wireReminders(root, doctors) {
  root.querySelectorAll('[data-remind]').forEach(b => b.onclick = () =>
    remindDoctor(doctors.find(d => d.id === b.dataset.remind), b.dataset.days === '' ? null : Number(b.dataset.days)));
}

// ---------- Monthly report ----------
async function reportPage(main, arg) {
  const td = today();
  const ym = /^\d{4}-\d{2}$/.test(arg || '') ? arg : td.slice(0, 7);
  const start = ym + '-01', end = monthEnd(ym), prev = shiftMonth(ym, -1);
  main.innerHTML = skeleton('page');
  let doctors, all, firsts;
  try {
    [doctors, all, firsts] = await Promise.all([listDoctors(), listSessions({ from: prev + '-01', to: end }),
      sb.rpc('patient_first_seen', { p_from: start, p_to: end }).then(check)]);
  }
  catch (err) { main.innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }

  const m = inRange(all, start, end);
  // For the current (unfinished) month, compare with last month up to the same day.
  const partial = ym === td.slice(0, 7);
  const pEnd = partial ? [addDays(prev + '-01', daysBetween(start, td)), monthEnd(prev)].sort()[0] : monthEnd(prev);
  const p = inRange(all, prev + '-01', pEnd);
  // Same patient key as the database: the patient's id, or the cleaned-up name for old rows.
  const pkey = s => (s.patient_id ? 'p' + s.patient_id : 'n' + nameKey(s.patient_name));
  const firstSeen = new Map(firsts.map(x => [x.patient_key, x.first_date]));
  const nameOf = new Map(m.map(s => [pkey(s), s.patient_name]));
  const patients = new Set(m.map(pkey));
  const newPatients = [...patients].filter(k => firstSeen.get(k) >= start).map(k => nameOf.get(k));
  const hours = m.reduce((a, s) => a + (s.duration_min || 0), 0) / 60;
  const rows = doctors.map(d => {
    const ds = m.filter(s => s.doctor_id === d.id);
    return { d, n: ds.length, patients: new Set(ds.map(pkey)).size, hours: ds.reduce((a, s) => a + (s.duration_min || 0), 0) / 60,
      types: TYPE_ORDER.map(k => ds.filter(s => s.session_type === k).length), last: ds.reduce((a, s) => (s.session_date > a ? s.session_date : a), '') };
  }).filter(r => r.n || r.d.active).sort((a, b) => b.n - a.n);
  const days = Array.from({ length: daysBetween(start, end) + 1 }, (_, i) => {
    const day = addDays(start, i), v = m.filter(s => s.session_date === day).length;
    return { value: v, current: day === td, label: String(i + 1), title: `${fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${v}` };
  });
  const monthName = toUTC(start).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });

  main.innerHTML = `
    <div class="head no-print">
      <div><h1>${t('rep.title')}</h1><p class="muted">${t('rep.sub')}</p></div>
      <div class="rep-tools">
        <div class="field"><label for="month">${t('rep.month')}</label><input id="month" type="month" value="${ym}" max="${td.slice(0, 7)}"></div>
        <button class="btn ghost" id="csv">${t('rep.csv')}</button><button class="btn" id="print">${t('rep.print')}</button>
      </div>
    </div>
    <article class="report card">
      <header class="rep-head"><img src="logo-full.png" alt="Nile Therapy" width="120" height="117"><div><h2>${t('rep.heading', { month: monthName })}</h2>
        <p class="muted small">${t('rep.generated', { date: fmtDay(td, { day: 'numeric', month: 'long', year: 'numeric' }), name: state.user.full_name })}</p></div></header>
      <div class="stats rep-kpis">
        ${kpi(m.length, t('rep.sessions'), delta(m.length, p.length, partial ? t('ov.vsBefore') : t('rep.vsPrev')))}
        ${kpi(patients.size, t('rep.patients'))}
        ${kpi(newPatients.length, t('rep.newPatients'))}
        ${kpi(fmtNum(hours), t('rep.hours'))}
        ${kpi(`<bdi dir="ltr">${rows.filter(r => r.n).length} / ${doctors.filter(d => d.active).length}</bdi>`, t('rep.activeDoctors'))}
      </div>
      ${m.length ? '' : `<p class="empty-note">${t('rep.empty', { month: esc(monthName) })}</p>`}
      <h3 class="rep-section">${t('rep.byDoctor')}</h3>
      <div class="table-wrap"><table class="rep-table"><thead><tr><th>${t('th.doctor')}</th><th>${t('rep.sessions')}</th><th>${t('rep.patients')}</th><th>${t('rep.hours')}</th>
        ${TYPE_ORDER.map(k => `<th>${esc(typeLabel(k))}</th>`).join('')}<th>${t('profile.last')}</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td dir="auto">${esc(r.d.full_name)}${r.d.active ? '' : ` <span class="pill off">${t('doctors.inactive')}</span>`}</td><td><b>${r.n}</b></td><td>${r.patients}</td><td>${fmtNum(r.hours)}</td>
          ${r.types.map(n => `<td>${n}</td>`).join('')}<td style="white-space:nowrap">${r.last ? fmtDate(r.last) : '—'}</td></tr>`).join('')}
        <tr class="total"><td>${t('rep.total')}</td><td><b>${m.length}</b></td><td>${patients.size}</td><td>${fmtNum(hours)}</td>
          ${TYPE_ORDER.map(k => `<td>${m.filter(s => s.session_type === k).length}</td>`).join('')}<td></td></tr>
      </tbody></table></div>
      <div class="rep-cols">
        <section><h3 class="rep-section">${t('ov.types')}</h3>${typeSplit(m)}</section>
        <section><h3 class="rep-section">${t('ov.areas')}</h3>${barList(topAreas(m, 6), t('ov.noData'))}</section>
      </div>
      <h3 class="rep-section">${t('rep.daily')}</h3>${columnChart(days, t('rep.daily'))}
      ${newPatients.length ? `<h3 class="rep-section">${t('rep.newList')}</h3><div class="chips">${newPatients.map(n => `<span class="chip"><bdi>${esc(n)}</bdi></span>`).join('')}</div>` : ''}
    </article>`;

  main.querySelector('#month').onchange = e => { if (e.target.value) location.hash = `#/report/${e.target.value}`; };
  main.querySelector('#print').onclick = () => window.print();
  main.querySelector('#csv').onclick = () => {
    const head = [t('th.doctor'), t('rep.sessions'), t('rep.patients'), t('rep.hours'), ...TYPE_ORDER.map(typeLabel), t('profile.last')];
    const lines = [[t('rep.heading', { month: monthName })], [], head,
      ...rows.map(r => [r.d.full_name, r.n, r.patients, r.hours.toFixed(1), ...r.types, r.last]),
      [t('rep.total'), m.length, patients.size, hours.toFixed(1), ...TYPE_ORDER.map(k => m.filter(s => s.session_type === k).length), ''],
      [], [t('rep.allSessions')],
      ['session_date', 'session_time', 'doctor_name', 'patient_name', 'session_type', 'location', 'location_url', 'duration_min', 'notes'],
      ...m.map(s => [s.session_date, s.session_time, s.doctor_name, s.patient_name, s.session_type, s.location, s.location_url || '', s.duration_min ?? '', s.notes])];
    const csv = '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `nile-therapy-report-${ym}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}
