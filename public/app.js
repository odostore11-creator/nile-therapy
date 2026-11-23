'use strict';
// Nile Therapy portal: routing, login page, the page frame (sidebar) and start-up.
// Loaded last; the pages it shows live in sessions.js, doctors.js, schedule.js, dashboard.js and chat.js.

// ---------- routing ----------
function route() { return (location.hash.replace(/^#\/?/, '') || '').split('/'); }
window.addEventListener('hashchange', render);

async function boot() {
  try { state.user = await loadMe(); } catch { state.user = null; }
  sb.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT' && state.user) { state.user = null; location.hash = ''; render(); }
  });
  render();
}

function render() {
  document.querySelectorAll('.modal-bg').forEach(m => m.remove());
  if (!state.user) { stopAlerts(); return renderLogin(); }
  const [page, arg] = route();
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
  if (page === 'chat') return shell('chat', chatPage);
  return shell('overview', overviewPage);
}

// ---------- login ----------
function renderLogin() {
  const admin = state.loginRole === 'admin';
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
        <div class="role-switch" role="tablist">
          <button type="button" role="tab" aria-selected="${admin}" class="${admin ? 'on' : ''}" data-role="admin">${t('role.founder')}</button>
          <button type="button" role="tab" aria-selected="${!admin}" class="${!admin ? 'on' : ''}" data-role="doctor">${t('role.doctor')}</button>
        </div>
        <div class="field"><label for="u">${t('login.username')}</label><input id="u" name="username" dir="ltr" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus placeholder="${esc(t(admin ? 'login.ph.admin' : 'login.ph.doctor'))}"></div>
        <div class="field"><label for="p">${t('login.password')}</label><input id="p" name="password" dir="ltr" type="password" autocomplete="current-password" required></div>
        <button class="btn block" type="submit">${t(admin ? 'login.go.admin' : 'login.go.doctor')}</button>
        <div class="error" id="err" role="alert"></div>
      </form>
    </section>
  </div>`;
  wireLangButtons();
  $app.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { state.loginRole = b.dataset.role; renderLogin(); });
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
      if (me.role !== state.loginRole) { // picked the wrong tab: don't let them in
        await sb.auth.signOut({ scope: 'local' });
        throw new Error(t(me.role === 'admin' ? 'login.wrongTabFounder' : 'login.wrongTabDoctor'));
      }
      state.user = me;
      location.hash = me.role === 'admin' ? '#/overview' : '#/log';
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
    ? [{ items: [I('overview', t('nav.overview'), icons.overview)] },
       { key: 'work', label: t('navg.work'), icon: icons.sessions, items: [I('sessions', t('nav.sessions'), icons.sessions), I('schedule', t('nav.schedule'), icons.schedule), I('calendar', t('nav.calendar'), icons.calendar)] },
       { key: 'team', label: t('navg.team'), icon: icons.doctors, items: [I('doctors', t('nav.doctors'), icons.doctors), I('patients', t('nav.patients'), icons.patients), I('coverage', t('nav.coverage'), icons.map)] },
       { key: 'records', label: t('navg.records'), icon: icons.report, items: [I('report', t('nav.report'), icons.report), I('history', t('nav.history'), icons.history)] },
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
      <div class="me">
        <strong dir="auto">${esc(u.full_name)}</strong><span class="muted" dir="auto">${esc(u.title || t(u.role === 'admin' ? 'role.founder' : 'role.doctor'))}</span>
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
  startAlerts(); // keeps checking every minute; redraws the alert/badge right away on each page
  wireInstall();
  wireLangButtons();
  document.getElementById('out').onclick = async () => {
    if (!await confirmAction({ title: t('confirm.logout'), confirm: t('me.logout') })) return;
    state.user = null; location.hash = ''; await sb.auth.signOut({ scope: 'local' }); render(); // only this device
  };
  document.getElementById('pw').onclick = passwordModal;
  const pageEl = document.getElementById('main');
  pageEl.classList.add('page-in');
  renderPage(pageEl);
  flushOutbox(); // anything saved while offline goes out now
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

function passwordModal() {
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
