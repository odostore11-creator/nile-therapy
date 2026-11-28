'use strict';
// Nile Therapy portal: routing, login page, the page frame (sidebar) and start-up.
// Loaded last; the pages it shows live in sessions.js, doctors.js, schedule.js, dashboard.js and chat.js.

// ---------- routing ----------
function route() { return (location.hash.replace(/^#\/?/, '') || '').split('/'); }
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); }); // a new page starts at the top

async function boot() {
  try { state.user = await loadMe(); } catch { state.user = null; }
  sb.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && state.user) { state.user = null; location.hash = ''; render(); }
  });
  render();
}

function render() {
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  if (!state.user) { stopAlerts(); stopLive(); return renderLogin(); }
  const [page, arg] = route();
  if (state.user.role === 'tech') { stopAlerts(); return techShell(); } // technical team: its own small page
  if (state.user.role === 'partner') { stopAlerts(); return partnerShell(); } // referring doctors/hospitals
  if (state.user.role === 'doctor') {
    if (page === 'schedule') return shell('schedule', schedulePage);
    if (page === 'requests') return shell('requests', openPatientsPage);
    return shell('log', doctorPortal);
  }
  if (page === 'coverage') return shell('coverage', coveragePage);
  if (page === 'doctors' && arg) return shell('doctors', el => doctorProfile(el, arg));
  if (page === 'doctors') return shell('doctors', doctorsPage);
  if (page === 'sessions') return shell('sessions', sessionsPage);
  if (page === 'patients') return shell('patients', patientsPage);
  if (page === 'schedule') return shell('schedule', schedulePage);
  if (page === 'report') return shell('report', el => reportPage(el, arg));
  if (page === 'history') return shell('history', historyPage);
  if (page === 'calendar') return shell('calendar', calendarPage);
  if (page === 'partners') return shell('partners', partnersPage);
  if (page === 'inbox') return shell('inbox', inboxPage);
  if (page === 'activity') return shell('activity', activityPage);
  if (page === 'money') return shell('money', moneyPage);
  if (page === 'referrals') return shell('referrals', referralsPage);
  if (page === 'chat') return shell('chat', chatPage);
  return shell('overview', overviewPage);
}

// ---------- login ----------
// One sign-in form for everyone (founders, doctors, partners, the technical team): the account decides where it goes.
function renderLogin() {
  $app.innerHTML = `
  <div class="login">
    <section class="login-art">
      <img class="login-logo" src="logo-full.png" alt="Nile Therapy" width="280" height="272">
      <div>
        <h1>${t('login.tagline')}</h1>
        <p>${t('login.intro')}</p>
      </div>
      <p class="small">${t('login.internal')}</p>
      ${waves}
    </section>
    <section class="login-form">
      ${langButton('corner')}
      <form class="login-card" id="login">
        <h2>${t('login.title')}</h2>
        <p class="muted">${t('login.help')}</p>
        <div class="field"><label for="u">${t('login.username')}</label><input id="u" name="username" dir="ltr" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus placeholder="${esc(t('login.ph.doctor'))}"></div>
        <div class="field"><label for="p">${t('login.password')}</label><input id="p" name="password" dir="ltr" type="password" autocomplete="current-password" required></div>
        <button class="btn block" type="submit">${t('login.go')}</button>
        <div class="error" id="err" role="alert"></div>
      </form>
    </section>
  </div>`;
  wireLangButtons();
  document.getElementById('login').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const b = formData(e.target);
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(b.username), password: String(b.password || '') });
      if (error) throw new Error(/invalid login credentials/i.test(error.message) ? t('err.wrongLogin')
        : /rate limit|too many/i.test(error.message) ? t('err.tooMany') : friendly(error));
      const me = await loadMe();
      if (!me) throw new Error(t('err.accountOff'));
      state.user = me;
      location.hash = me.role === 'admin' ? '#/overview' : me.role === 'tech' ? '' : me.role === 'partner' ? '#/send' : '#/log';
      render();
    } catch (err) { document.getElementById('err').textContent = err.message; btn.disabled = false; }
  };
}

// ---------- layout ----------
function shell(active, renderPage) {
  const u = state.user;
  // Founders' menu: a few top items plus collapsible groups (the group holding the open page is
  // always open; other groups remember open/closed on this device). Doctors keep a short flat list.
  const I = (k, label, ic) => [k, label, ic];
  const groups = u.role === 'admin'
    ? [{ items: [I('overview', t('nav.overview'), icons.overview), I('inbox', t('nav.inbox'), icons.inbox)] },
       { key: 'work', label: t('navg.work'), icon: icons.sessions, items: [I('sessions', t('nav.sessions'), icons.sessions), I('schedule', t('nav.schedule'), icons.schedule), I('calendar', t('nav.calendar'), icons.calendar)] },
       { key: 'team', label: t('navg.team'), icon: icons.doctors, items: [I('doctors', t('nav.doctors'), icons.doctors), I('activity', t('nav.activity'), icons.activity), I('patients', t('nav.patients'), icons.patients), I('referrals', t('nav.referrals'), icons.inbox), I('partners', t('nav.partners'), icons.partners), I('coverage', t('nav.coverage'), icons.map)] },
       { key: 'records', label: t('navg.records'), icon: icons.report, items: [I('report', t('nav.report'), icons.report), I('money', t('nav.money'), icons.money), I('history', t('nav.history'), icons.history)] },
       { items: [I('chat', t('nav.chat'), icons.chat)] }]
    : [{ items: [I('log', t('nav.today'), icons.today), I('schedule', t('nav.mySchedule'), icons.schedule), I('requests', t('nav.openPatients'), icons.map)] }];
  const nav = groups.flatMap(g => g.items);
  const navLink = ([k, label, ic]) => `<a class="nav ${active === k ? 'on' : ''}" href="#/${k}" ${active === k ? 'aria-current="page"' : ''}>${ic}<span>${label}</span></a>`;
  const groupOpen = g => g.items.some(i => i[0] === active) || (() => { try { return localStorage.getItem('nt_navg_' + g.key) === '1'; } catch { return false; } })();
  const navHtml = groups.map(g => !g.key ? g.items.map(navLink).join('')
    : `<details class="nav-group" data-g="${g.key}" ${groupOpen(g) ? 'open' : ''}><summary class="nav nav-sum">${g.icon}<span>${esc(g.label)}</span><span class="chev" aria-hidden="true"></span></summary>
        <div class="nav-sub">${g.items.map(navLink).join('')}</div></details>`).join('');
  $app.innerHTML = `
  <div class="shell ${u.role === 'doctor' ? 'doc-shell' : ''}">
    <aside class="side">
      <div class="side-top">
        <div class="brand"><span class="brand-mark"><img src="logo-mark.png" alt="" width="40" height="40"></span> <span class="brand-name">Nile Therapy</span></div>
        <span class="m-title">${esc((nav.find(n => n[0] === active) || nav[0])[1])}</span>
        <button type="button" class="menu-btn" id="menu" aria-expanded="false" aria-controls="sidemenu" aria-label="${esc(t('nav.menu'))}">☰</button>
      </div>
      <div class="side-menu" id="sidemenu">
      <nav class="nav-list">${navHtml}</nav>
      <div class="spacer"></div>
      ${techTeamHtml()}
      <div class="me">
        <div class="me-top">${avatarHtml(u, 'sm')}<span><strong dir="auto">${esc(u.full_name)}</strong><span class="muted" dir="auto">${esc(u.title || t(u.role === 'admin' ? 'role.founder' : 'role.doctor'))}</span></span></div>
        <div class="row"><button id="pw">${t('me.password')}</button><button id="out">${t('me.logout')}</button>${langButton()}<button id="install" hidden>${t('install.btn')}</button></div>
      </div>
      </div>
    </aside>
    <main class="main"><div id="alerts"></div><div id="tip"></div><div id="main"></div></main>
    ${u.role === 'doctor' ? `<nav class="tabbar" aria-label="${esc(t('nav.menu'))}">${nav.map(([k, label, ic]) => `<a class="tab ${active === k ? 'on' : ''}" href="#/${k}" ${active === k ? 'aria-current="page"' : ''}>${ic}<span>${label}</span></a>`).join('')}</nav>` : ''}
  </div>`;
  const side = $app.querySelector('.side'), menuBtn = document.getElementById('menu');
  $app.querySelectorAll('.nav-group').forEach(g => g.addEventListener('toggle', () => { try { localStorage.setItem('nt_navg_' + g.dataset.g, g.open ? '1' : '0'); } catch { /* fine */ } }));
  menuBtn.onclick = () => { const open = side.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', open); menuBtn.textContent = open ? '✕' : '☰'; };
  showInstallTip();
  document.getElementById('tech-note')?.addEventListener('click', techNotesModal);
  $app.querySelector('.tech-team')?.addEventListener('toggle', e => { try { localStorage.setItem('nt_tech_open', e.target.open ? '1' : '0'); } catch { /* fine */ } });
  startAlerts(); // keeps checking every minute; redraws the alert/badge right away on each page
  refreshReferralBadge();
  refreshInboxBadge();
  trackVisit(active);
  wireInstall();
  wireLangButtons();
  document.getElementById('out').onclick = async () => {
    if (!await confirmAction({ title: t('confirm.logout'), confirm: t('me.logout') })) return;
    state.user = null; location.hash = ''; await sb.auth.signOut({ scope: 'local' }); render(); // only this device
  };
  document.getElementById('pw').onclick = u.role === 'doctor' ? askForPasswordModal : passwordModal;
  const pageEl = document.getElementById('main');
  pageEl.classList.add('page-in');
  setLivePage(active, renderPage, pageEl); // live updates redraw this page when something changes
  startLive();
  renderPage(pageEl);
  flushOutbox(); // anything saved while offline goes out now
}


// ---------- technical team (side menu) ----------
// Who built and runs the portal, with WhatsApp and call buttons for help. Shown to founders and doctors.
const TECH_TEAM = [
  { name: { en: 'Omar Khaled', ar: 'عمر خالد' }, role: 'tech.role.dev', phone: '01556059711' },
  { name: { en: 'Omar Sameh', ar: 'عمر سامح' }, role: 'tech.role.ops', phone: '01095204422' },
];
const intlPhone = p => '20' + String(p).replace(/\D/g, '').replace(/^0/, ''); // 01x… -> 201x…
function techTeamHtml() {
  let open = false;
  try { open = localStorage.getItem('nt_tech_open') === '1'; } catch { /* storage blocked */ }
  const msg = encodeURIComponent(t('tech.waMsg'));
  return `<details class="tech-team" ${open ? 'open' : ''}>
    <summary><span class="tech-faces" aria-hidden="true">${TECH_TEAM.map(m => `<i>${esc(initials(m.name[LANG] || m.name.en))}</i>`).join('')}</span>
      <span class="tech-head"><b>${t('tech.title')}</b><span>${t('tech.sub')}</span></span><span class="chev" aria-hidden="true"></span></summary>
    <p class="tech-intro">${t('tech.intro')}</p>
    ${TECH_TEAM.map(m => {
      const name = m.name[LANG] || m.name.en, num = intlPhone(m.phone);
      return `<div class="tech-person"><span class="tech-av" aria-hidden="true">${esc(initials(name))}</span>
        <span class="tech-who"><b dir="auto">${esc(name)}</b><span>${t(m.role)}</span></span>
        <span class="tech-btns">
          <a class="tech-btn wa" href="https://wa.me/${num}?text=${msg}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t('tech.wa', { name }))}" title="${esc(t('tech.wa', { name }))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2.1.7 2.8.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg></a>
          <a class="tech-btn call" href="tel:+${num}" aria-label="${esc(t('tech.call', { name }))}" title="${esc(t('tech.call', { name }))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg></a>
        </span></div>`;
    }).join('')}
    ${isFounder() ? `<button type="button" class="tech-note-btn" id="tech-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>${t('notes.open')}</button>` : ''}
  </details>`;
}

// ---------- "Add to home screen" ----------
// Android/desktop Chrome offer an install prompt we can trigger from a button; iPhone needs
// the Share menu, so phones get a one-time tip that can be dismissed.
let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installPrompt = e;
  const b = document.getElementById('install'); if (b) b.hidden = false;
});
function wireInstall() {
  const b = document.getElementById('install'); if (!b) return;
  b.hidden = !installPrompt || isInstalled();
  b.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt(); await installPrompt.userChoice.catch(() => null);
    installPrompt = null; b.hidden = true;
  };
}
function showInstallTip() {
  const slot = document.getElementById('tip');
  let dismissed = false;
  try { dismissed = localStorage.getItem('nt_install_tip') === 'no'; } catch { /* storage blocked */ }
  const phone = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
  if (!slot || dismissed || !phone || isInstalled()) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  slot.innerHTML = `<div class="tip-card"><img src="icon-192.png" alt="" width="40" height="40">
    <p><b>${t('install.title')}</b><br>${t(ios ? 'install.ios' : 'install.android')}</p>
    <button type="button" class="tip-close" aria-label="${esc(t('install.dismiss'))}" title="${esc(t('install.dismiss'))}">×</button></div>`;
  slot.querySelector('.tip-close').onclick = () => { try { localStorage.setItem('nt_install_tip', 'no'); } catch { /* fine */ } slot.innerHTML = ''; };
}

function askForPasswordModal() {
  modal(`<h2>${t('pw.title')}</h2><p>${t('pw.askFounders')}</p>
    <div class="actions"><button class="btn" data-close>${t('common.done')}</button></div>`);
}
function passwordModal() {
  if (state.user?.role === 'doctor') return askForPasswordModal();
  modal(`<h2>${t('pw.title')}</h2>
    <form id="pwf">
      <div class="field"><label>${t('pw.current')}</label><input name="current" dir="ltr" type="password" required autocomplete="current-password"></div>
      <div class="field"><label>${t('pw.new')}</label><input name="next" dir="ltr" type="password" minlength="8" required autocomplete="new-password"></div>
      <div class="error" id="pwerr" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('common.save')}</button></div>
    </form>`, (m, close) => {
    const pwForm = m.querySelector('form');
    onSubmit(pwForm, async () => {
      {
        const b = formData(pwForm);
        if (String(b.next || '').length < 8) throw new Error(t('err.pwShort'));
        if (!await confirmAction({ title: t('confirm.password'), message: t('confirm.passwordMsg'), confirm: t('pw.title') })) return;
        // Supabase doesn't ask for the old password, so check it ourselves first.
        const { error: wrong } = await sb.auth.signInWithPassword({ email: loginEmail(state.user.username), password: String(b.current || '') });
        if (wrong) throw new Error(t('err.pwWrong'));
        const { error } = await sb.auth.updateUser({ password: String(b.next) });
        if (error) throw new Error(friendly(error));
        await sb.auth.signOut({ scope: 'others' }); // log out other devices, like v0.1
        close(); toast(t('pw.done'));
      }
    });
  });
}


boot();
