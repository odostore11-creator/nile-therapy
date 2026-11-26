'use strict';
// Notes to the technical team: founders send requests from the Technical team card; the team reads and
// answers them on its own small page (the 'tech' account, which logs in from either login tab).
// Table tech_notes; RLS: founders insert/read (and withdraw their own until work starts), tech reads and
// updates status + reply only.

const NOTE_STATUSES = ['new', 'in_progress', 'done'];
const isTech = () => state.user?.role === 'tech';
const fmtWhen = ts => new Date(ts).toLocaleString(LANG === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

async function listTechNotes() {
  return check(await sb.from('tech_notes').select('id, body, status, reply, created_at, updated_at, author_id, author:profiles!tech_notes_author_id_fkey(full_name)').order('created_at', { ascending: false }).limit(200));
}
async function sendTechNote(body) {
  const text = String(body || '').trim();
  if (!text) throw new Error(t('notes.err.empty'));
  if (text.length > 2000) throw new Error(t('notes.err.long'));
  check(await sb.from('tech_notes').insert({ body: text }).select('id'));
}
async function withdrawTechNote(id) {
  const rows = check(await sb.from('tech_notes').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('notes.err.started'));
}
async function updateTechNote(id, patch) {
  const rows = check(await sb.from('tech_notes').update(patch).eq('id', id).select('id'));
  if (!rows.length) throw new Error(t('notes.err.save'));
}

const noteStatusPill = s => `<span class="tn-st tn-${s}">${t('notes.st.' + s)}</span>`;

// ---------- founders: "Send us a note" (from the Technical team card) ----------
function techNotesModal() {
  modal(`<h2>${t('notes.title')}</h2><p class="muted">${t('notes.sub')}</p>
    <form id="tn-form" class="tn-form">
      <textarea id="tn-body" aria-label="${esc(t('notes.placeholder'))}" name="body" rows="4" maxlength="2000" dir="auto" placeholder="${esc(t('notes.placeholder'))}" required></textarea>
      <p class="error" role="alert"></p>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.close')}</button><button class="btn">${t('notes.send')}</button></div>
    </form>
    <h3 class="tn-list-h">${t('notes.list')}</h3>
    <div id="tn-list" class="tn-list">${skeleton('list', 3)}</div>`, async m => {
    const listEl = m.querySelector('#tn-list');
    const load = async () => {
      try {
        const notes = await listTechNotes();
        listEl.innerHTML = notes.length ? notes.map(n => `<article class="tn-item">
          <div class="tn-meta">${noteStatusPill(n.status)}<span class="muted" dir="auto">${esc(n.author?.full_name || '')} · ${fmtWhen(n.created_at)}</span>
            ${n.status === 'new' && n.author_id === state.user.id ? `<button type="button" class="link tn-withdraw" data-id="${n.id}">${t('notes.withdraw')}</button>` : ''}</div>
          <p class="tn-body" dir="auto">${esc(n.body)}</p>
          ${n.reply ? `<p class="tn-reply" dir="auto"><b>${t('notes.replyFrom')}</b> ${esc(n.reply)}</p>` : ''}
        </article>`).join('') : `<p class="empty">${t('notes.none')}</p>`;
        listEl.querySelectorAll('.tn-withdraw').forEach(b => b.onclick = async () => {
          if (!await confirmAction({ title: t('notes.withdrawQ'), confirm: t('notes.withdraw') })) return;
          try { await withdrawTechNote(b.dataset.id); toast(t('notes.withdrawn')); load(); } catch (x) { toast(x.message); }
        });
      } catch (x) { listEl.innerHTML = `<p class="error">${esc(x.message)}</p>`; }
    };
    const onLive = e => { if (!listEl.isConnected) return document.removeEventListener('nt-live', onLive); if (e.detail.table === 'tech_notes') load(); };
    document.addEventListener('nt-live', onLive); // new replies show up while the box is open
    const form = m.querySelector('#tn-form');
    onSubmit(form, async () => {
      await sendTechNote(form.body.value);
      form.reset(); toast(t('notes.sent')); load();
    });
    load();
  });
}

// ---------- technical team: its own small page ----------
const techTab = () => (['partners', 'errors', 'usage', 'commission'].includes(route()[0]) ? route()[0] : '');
function techShell() {
  $app.innerHTML = `<div class="tech-shell">
    <header class="tech-bar">
      <div class="brand"><span class="brand-mark"><img src="logo-mark.png" alt="" width="34" height="34"></span><span><b>Nile Therapy</b><small>${t('notes.techArea')}</small></span></div>
      <div class="row">${langButton()}<button type="button" class="btn ghost" id="pw">${t('me.password')}</button><button type="button" class="btn ghost" id="out">${t('me.logout')}</button></div>
    </header>
    <nav class="p-tabs" aria-label="${esc(t('nav.menu'))}">${[['', t('notes.techTitle')], ['partners', t('nav.partners')], ['errors', t('tabs.errors')], ['usage', t('tabs.usage')], ['commission', t('tabs.commission')]].map(([k, l]) => `<a href="#/${k}" class="${k === techTab() ? 'on' : ''}" ${k === techTab() ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <main class="tech-main" id="main"></main>
  </div>`;
  wireLangButtons();
  document.getElementById('pw').onclick = passwordModal;
  document.getElementById('out').onclick = async () => {
    if (!await confirmAction({ title: t('confirm.logout'), confirm: t('me.logout') })) return;
    state.user = null; location.hash = ''; await sb.auth.signOut({ scope: 'local' }); render();
  };
  const main = document.getElementById('main');
  const draw = { partners: partnersPage, errors: techErrorsPage, usage: techUsagePage, commission: techCommissionPage }[techTab()] || techNotesPage;
  setLivePage('tech-' + (techTab() || 'notes'), draw, main);
  trackVisit('tech-' + (techTab() || 'notes'));
  startLive();
  draw(main);
}

async function techNotesPage(main) {
  state.tnFilter ??= 'open';
  main.innerHTML = `<div class="head">
      <div><h1>${t('notes.techTitle')}</h1><p class="muted">${t('notes.techSub')}</p></div>
      <div class="seg" role="group" aria-label="${esc(t('notes.techTitle'))}">${['open', 'done', 'all'].map(f => `<button type="button" data-f="${f}">${t('notes.f.' + f)}</button>`).join('')}<button type="button" id="tn-refresh" title="${esc(t('notes.refresh'))}" aria-label="${esc(t('notes.refresh'))}">↻</button></div>
    </div>
    <div id="tn-board">${skeleton('list', 4)}</div>`;
  const setF = () => main.querySelectorAll('[data-f]').forEach(b => { const on = b.dataset.f === state.tnFilter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  setF();
  const board = main.querySelector('#tn-board');
  const load = async () => {
    try {
      const all = await listTechNotes();
      const notes = all.filter(n => state.tnFilter === 'all' || (state.tnFilter === 'done' ? n.status === 'done' : n.status !== 'done'));
      const openCount = all.filter(n => n.status === 'new').length;
      document.title = (openCount ? `(${openCount}) ` : '') + 'Nile Therapy';
      board.innerHTML = notes.length ? notes.map(n => `<form class="card tn-card" data-id="${n.id}">
          <div class="tn-meta">${noteStatusPill(n.status)}<b dir="auto">${esc(n.author?.full_name || '')}</b><span class="muted">${fmtWhen(n.created_at)}</span></div>
          <p class="tn-body" dir="auto">${esc(n.body)}</p>
          <div class="tn-edit">
            <label>${t('notes.status')}<select name="status">${NOTE_STATUSES.map(s => `<option value="${s}" ${s === n.status ? 'selected' : ''}>${t('notes.st.' + s)}</option>`).join('')}</select></label>
            <label class="tn-reply-f">${t('notes.reply')}<textarea name="reply" rows="2" maxlength="2000" dir="auto" placeholder="${esc(t('notes.replyHint'))}">${esc(n.reply)}</textarea></label>
          </div>
          <p class="error" role="alert"></p>
          <div class="actions"><button class="btn">${t('notes.save')}</button></div>
        </form>`).join('') : `<p class="empty">${t(state.tnFilter === 'done' ? 'notes.noneDone' : 'notes.noneOpen')}</p>`;
      board.querySelectorAll('.tn-card').forEach(f => onSubmit(f, async () => {
        const b = formData(f);
        await updateTechNote(f.dataset.id, { status: b.status, reply: String(b.reply || '').trim() });
        toast(t('notes.saved')); load();
      }));
    } catch (x) { board.innerHTML = `<p class="error">${esc(x.message)}</p>`; }
  };
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.tnFilter = b.dataset.f; setF(); load(); });
  main.querySelector('#tn-refresh').onclick = load;
  load();
}
