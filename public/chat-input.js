'use strict';
// Files and voice for the AI room.
// Files: uploaded to the founder's own private folder in Supabase Storage (only they can read it),
// then the AI function reads them. Voice: the browser's own speech-to-text (Chrome, Edge, Safari),
// which writes into the message box; nothing is sent until the founder presses Send.
// Shared helpers come from core.js; all interface text from i18n.js (use t('key')).

const CHAT_FILE_LIMITS = { image: 5, other: 10 }; // MB (the AI accepts images up to 5 MB)
const CHAT_TYPES_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', md: 'text/markdown' };
const CHAT_ACCEPT = Object.keys(CHAT_TYPES_BY_EXT).map(e => '.' + e).join(',');
const MAX_FILES_PER_MESSAGE = 5;

const fileType = f => (Object.values(CHAT_TYPES_BY_EXT).includes(f.type) ? f.type : CHAT_TYPES_BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || '');
const fileIcon = type => (type.startsWith('image/') ? '🖼️' : type === 'application/pdf' ? '📄' : '📝');
const fmtSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Checks a picked file; returns an error message, or '' if it's fine. */
function checkChatFile(f) {
  const type = fileType(f);
  if (!type) return t('files.badType', { name: f.name });
  const max = type.startsWith('image/') ? CHAT_FILE_LIMITS.image : CHAT_FILE_LIMITS.other;
  if (f.size > max * 1048576) return t('files.tooBig', { name: f.name, max });
  return '';
}

async function uploadChatFiles(files) {
  const out = [];
  for (const f of files) {
    const type = fileType(f);
    const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file';
    const path = `${state.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const { error } = await sb.storage.from('chat-files').upload(path, f, { contentType: type, upsert: false });
    if (error) { await removeChatFiles(out.map(a => a.path)); throw new Error(t('files.uploadFailed', { name: f.name })); }
    out.push({ path, name: f.name.slice(0, 200), type, size: f.size });
  }
  return out;
}
async function removeChatFiles(paths) { if (paths.length) await sb.storage.from('chat-files').remove(paths); }
async function removeAllChatFiles() {
  const { data } = await sb.storage.from('chat-files').list(state.user.id, { limit: 1000 });
  await removeChatFiles((data || []).map(o => `${state.user.id}/${o.name}`));
}
async function openChatFile(path) {
  const { data, error } = await sb.storage.from('chat-files').createSignedUrl(path, 300);
  if (error) return toast(t('files.openFailed'));
  window.open(data.signedUrl, '_blank', 'noopener');
}

/** Files shown inside a sent message: image thumbnails, chips for the rest. Click opens the file. */
function attachmentsHtml(list = []) {
  if (!list.length) return '';
  return `<div class="msg-files">${list.map(a => a.path && a.type.startsWith('image/')
    ? `<button type="button" class="msg-thumb" data-open="${esc(a.path)}" title="${esc(a.name)}"><img data-path="${esc(a.path)}" alt="${esc(a.name)}"></button>`
    : `<button type="button" class="file-chip" ${a.path ? `data-open="${esc(a.path)}"` : 'disabled'} title="${esc(a.name)}"><span aria-hidden="true">${fileIcon(a.type)}</span><span class="fname" dir="auto">${esc(a.name)}</span></button>`).join('')}</div>`;
}
/** After drawing messages: load image thumbnails (short-lived private links) and wire clicks. */
async function wireAttachments(root) {
  root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openChatFile(b.dataset.open));
  const imgs = [...root.querySelectorAll('img[data-path]')];
  if (!imgs.length) return;
  const { data } = await sb.storage.from('chat-files').createSignedUrls(imgs.map(i => i.dataset.path), 3600);
  (data || []).forEach((d, i) => { if (d.signedUrl) imgs[i].src = d.signedUrl; });
}

// ---------- voice dictation ----------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
function dictationLang() {
  let v = null;
  try { v = localStorage.getItem('nt_dict_lang'); } catch { /* storage blocked */ }
  return v === 'ar-EG' || v === 'en-US' ? v : (LANG === 'ar' ? 'ar-EG' : 'en-US');
}
/** Wires the mic button (and its language switch) to fill the message box as you speak. */
function setupDictation(micBtn, langBtn, input) {
  if (!SpeechRec) { micBtn.hidden = true; langBtn.hidden = true; return () => {}; }
  let rec = null, lang = dictationLang();
  const showLang = () => { langBtn.textContent = lang === 'ar-EG' ? 'ع' : 'EN'; langBtn.title = t(lang === 'ar-EG' ? 'voice.langAr' : 'voice.langEn'); };
  showLang();
  langBtn.onclick = () => {
    lang = lang === 'ar-EG' ? 'en-US' : 'ar-EG';
    try { localStorage.setItem('nt_dict_lang', lang); } catch { /* fine */ }
    showLang();
    if (rec) { rec.stop(); }
  };
  const setOn = on => { micBtn.classList.toggle('listening', on); micBtn.setAttribute('aria-pressed', on); micBtn.title = t(on ? 'voice.stop' : 'voice.start'); input.placeholder = on ? t('voice.listening') : t('chat.input.ph'); };
  micBtn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SpeechRec();
    rec.lang = lang; rec.interimResults = true; rec.continuous = true;
    const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      input.value = base + finalText + interim;
      input.dispatchEvent(new Event('input'));
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast(t('voice.denied'));
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast(t('voice.error'));
    };
    rec.onend = () => { rec = null; setOn(false); input.focus(); };
    try { rec.start(); setOn(true); } catch { rec = null; toast(t('voice.error')); }
  };
  micBtn.setAttribute('aria-pressed', 'false'); micBtn.title = t('voice.start');
  return () => { if (rec) rec.stop(); }; // stop listening (used when sending)
}
