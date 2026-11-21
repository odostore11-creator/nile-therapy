'use strict';
// Each founder's private AI room, including the Confirm / Cancel cards for AI actions.
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

// ---------- admin: private AI room ----------
function md(text) {
  // Small, safe markdown: escape first, then **bold**, `code`, bullet lists, paragraphs.
  const lines = esc(text).split('\n');
  let out = '', list = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { out += '<ul dir="auto">'; list = true; } out += `<li>${li[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (line.trim()) out += `<p dir="auto">${line.replace(/^#+\s*/, '')}</p>`;
  }
  return out + (list ? '</ul>' : '');
}

// A change the AI prepared. Nothing happens until the founder presses Confirm.
function actionCard(a) {
  const p = a.payload || {}, after = p.after || {}, before = p.before || {};
  const show = (k, v) => {
    if (v === null || v === undefined || v === '') return '—';
    if (k === 'session_type') return esc(typeLabel(v));
    if (k === 'active') return t(v ? 'act.on' : 'act.off');
    if (k === 'status') return t('sched.status.' + v);
    if (/_date$/.test(k)) return fmtDate(v);
    return esc(v);
  };
  const ORDER = ['doctor_name', 'patient_name', 'session_date', 'appt_date', 'session_time', 'appt_time', 'session_type', 'location',
    'duration_min', 'status', 'full_name', 'title', 'specialty', 'phone', 'area', 'bio', 'active', 'notes'];
  const rank = k => (ORDER.includes(k) ? ORDER.indexOf(k) : 99);
  const rows = Object.keys(after).filter(k => k !== 'doctor_id').sort((a, b) => rank(a) - rank(b)).map(k => `<tr><th>${t('field.' + k)}</th><td dir="auto">${
    k in before ? `<s>${show(k, before[k])}</s> → ` : ''}<b>${show(k, after[k])}</b></td></tr>`).join('');
  const foot = a.status === 'pending'
    ? `<div class="act-buttons"><button type="button" class="btn sm" data-act="confirm" data-id="${a.id}">${t('act.confirm')}</button><button type="button" class="btn ghost sm" data-act="reject" data-id="${a.id}">${t('common.cancel')}</button></div>`
    : `<p class="act-status ${a.status}">${a.status === 'done' ? '✓ ' + t('act.done') : a.status === 'cancelled' ? '✕ ' + t('act.cancelled') : '⚠ ' + t('act.failed') + (a.result ? `: ${esc(trServer(a.result))}` : '')}</p>`;
  return `<div class="act-card ${a.status}"><div class="act-title">${t('act.' + a.kind)}${p.target_label ? ` · <span dir="auto">${esc(p.target_label)}</span>` : ''}</div>
    <table class="act-table"><tbody>${rows}</tbody></table>${foot}</div>`;
}

async function chatPage(main) {
  const ai = state.ai;
  const first = state.user.full_name.replace(/^(Dr\.?|د\.)\s*/i, '').split(' ')[0];
  main.innerHTML = `
    <div class="head"><div><h1>${t('chat.title')}</h1><p class="muted">${esc(t('chat.sub', { name: first }))}</p></div></div>
    <div class="chat-wrap">
      <section class="card chat">
        <div class="chat-head">
          <strong>${t('chat.assistant')}</strong>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="model" aria-label="${esc(t('chat.model'))}">${MODELS.map(k => `<option value="${k}" ${k === ai.default ? 'selected' : ''}>${esc(t('model.' + k))}</option>`).join('')}</select>
            <button class="btn ghost sm" id="clear">${t('chat.new')}</button>
          </div>
        </div>
        <div class="banner" id="aibanner" hidden></div>
        <div class="msgs" id="msgs" aria-live="polite"></div>
        <form class="composer" id="send">
          <textarea id="input" rows="1" dir="auto" aria-label="${esc(t('chat.send'))}" placeholder="${esc(t('chat.input.ph'))}"></textarea>
          <button class="btn">${t('chat.send')}</button>
        </form>
      </section>
      <aside class="card memory">
        <h3>🧠 ${t('chat.memory')}</h3>
        <p class="muted small">${t('chat.memory.sub')}</p>
        <div id="mem"></div>
      </aside>
    </div>`;
  const msgsEl = main.querySelector('#msgs'), input = main.querySelector('#input');
  const suggestions = t('chat.suggest');

  let actions = [];
  const drawMessages = list => {
    const forMsg = id => actions.filter(a => a.message_id === id).map(actionCard).join('');
    const loose = actions.filter(a => a.status === 'pending' && !list.some(m => m.id === a.message_id)).map(actionCard).join('');
    msgsEl.innerHTML = list.length || loose ? list.map(m => `<div class="msg ${m.role}">${md(m.content)}</div>${m.id ? forMsg(m.id) : ''}`).join('') + loose
      : `<div class="welcome"><h2>${esc(t('chat.welcome', { name: first }))}</h2><p>${t('chat.welcome.sub')}</p>
         <div class="suggest">${suggestions.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div></div>`;
    msgsEl.querySelectorAll('.suggest button').forEach(b => b.onclick = () => { input.value = b.textContent; main.querySelector('#send').requestSubmit(); });
    msgsEl.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      const card = b.closest('.act-card'); card.querySelectorAll('button').forEach(x => x.disabled = true);
      try {
        const r = await callFunction('ai-chat', { action: b.dataset.act, id: Number(b.dataset.id) });
        toast(r.status === 'done' ? t('act.doneToast') : r.status === 'failed' ? `${t('act.failed')}: ${trServer(r.result || '')}` : t('act.cancelledToast'));
      } catch (err) { toast(err.message); }
      refresh();
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  };
  const drawMemory = mem => {
    main.querySelector('#mem').innerHTML = mem.length ? mem.map(m => `<div class="mem-item"><span dir="auto">${esc(m.content)}</span><button title="${esc(t('chat.forget'))}" aria-label="${esc(t('chat.forget'))}" data-mem="${m.id}">×</button></div>`).join('')
      : `<p class="muted small">${t('chat.nothing')}</p>`;
    main.querySelectorAll('[data-mem]').forEach(b => b.onclick = async () => {
      if (!await confirmAction({ title: t('confirm.forget'), message: b.previousElementSibling.textContent, confirm: t('chat.forget') })) return;
      try { check(await sb.from('founder_memory').delete().eq('id', b.dataset.mem).eq('founder_id', state.user.id)); refresh(); }
      catch (err) { toast(err.message); }
    });
  };
  const banner = text => { const el = main.querySelector('#aibanner'); el.hidden = !text; el.textContent = text || ''; };
  const showAiStatus = () => banner(state.ai.connected === false ? t('chat.off') : state.ai.connected === 'missing' ? t('chat.missing') : '');
  let messages = [];
  const refresh = async () => {
    const [msgs, mem, acts] = await Promise.all([
      sb.from('chat_messages').select('id, role, content, model, created_at').eq('founder_id', state.user.id).order('id'),
      sb.from('founder_memory').select('id, content, created_at').eq('founder_id', state.user.id).order('id', { ascending: false }),
      sb.from('ai_actions').select('*').eq('founder_id', state.user.id).order('id').limit(300),
    ]);
    actions = check(acts); messages = check(msgs); drawMessages(messages); drawMemory(check(mem));
  };
  callFunction('ai-chat', { action: 'status' })
    .then(r => { state.ai.connected = !!r.connected; })
    .catch(() => { state.ai.connected = 'missing'; })
    .finally(showAiStatus);

  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); main.querySelector('#send').requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; });
  main.querySelector('#send').onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = ''; input.style.height = 'auto';
    messages.push({ role: 'user', content: text }); drawMessages(messages);
    msgsEl.insertAdjacentHTML('beforeend', `<div class="msg assistant thinking">${t('chat.thinking')}</div>`); msgsEl.scrollTop = msgsEl.scrollHeight;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const r = await callFunction('ai-chat', { action: 'send', message: text, model: main.querySelector('#model').value });
      if (r.saved_memory?.length) toast(t('chat.savedMem'));
      if (typeof r.connected === 'boolean' && r.connected !== state.ai.connected) { state.ai.connected = r.connected; showAiStatus(); }
      await refresh();
    } catch (err) { messages.pop(); drawMessages(messages); input.value = text; toast(err.message); }
    btn.disabled = false; input.focus();
  };
  main.querySelector('#clear').onclick = async () => {
    if (!await confirmAction({ title: t('confirm.newChat'), message: t('confirm.newChatMsg'), confirm: t('chat.new') })) return;
    try { check(await sb.from('chat_messages').delete().eq('founder_id', state.user.id)); refresh(); }
    catch (err) { toast(err.message); }
  };
  refresh().catch(err => { msgsEl.innerHTML = `<div class="empty">${esc(err.message)}</div>`; });
}

