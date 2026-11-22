'use strict';
// Coverage map: each doctor's area (drawn on the map), patient requests, and who takes them.
// The ASSIGNING rules live in the database (supabase/migrations/*coverage*): nearest doctor with
// fewer than 5 visits that day gets the visit; otherwise it's open to every doctor with room; after
// 2 hours (or if the patient is outside every area) it needs a founder.
// Map: Leaflet + OpenStreetMap, loaded only when a map page opens. Address search: OpenStreetMap
// Nominatim (the typed address is sent to it). Shared helpers come from core.js; text from i18n.js.

const LEAFLET = {
  js: { src: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', integrity: 'sha384-NElt3Op+9NBMCYaef5HxeJmU4Xeard/Lku8ek6hoPTvYkQPh3zLIrJP7KiRocsxO' },
  css: { href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css', integrity: 'sha384-c6Rcwz4e4CITMbu/NBmnNS8yN2sC3cUElMEMfP3vqqKFp7GOYaaBBCqmaWBjmkjb' },
};
const DAILY_LIMIT = 5, OPEN_MINUTES = 120; // must match private.daily_limit() / private.open_window() in the database
const REQ_COLORS = { done: '#2f6b2a', waiting: '#c98a12', founders: '#b3372a', cancelled: '#8a97a5' };
let leafletLoading = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletLoading ||= new Promise((resolve, reject) => {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: LEAFLET.css.href, integrity: LEAFLET.css.integrity, crossOrigin: 'anonymous' });
    const js = Object.assign(document.createElement('script'), { src: LEAFLET.js.src, integrity: LEAFLET.js.integrity, crossOrigin: 'anonymous' });
    js.onload = () => resolve();
    js.onerror = () => { leafletLoading = null; reject(new Error(t('map.loadFailed'))); };
    document.head.append(css, js);
  });
  return leafletLoading;
}
function makeMap(el, { center = [30.06, 31.3], zoom = 10 } = {}) {
  const map = L.map(el, { scrollWheelZoom: true }).setView(center, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}
const toLatLngs = coords => coords.map(([lng, lat]) => [lat, lng]);
const pinIcon = color => L.divIcon({ className: 'pin', html: `<span style="background:${color}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

// ---------- data ----------
const listAreas = async () => check(await sb.from('doctor_areas').select('doctor_id, coords, color'));
async function saveArea(doctorId, latlngs, color) {
  const coords = latlngs.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)]);
  const updated = check(await sb.from('doctor_areas').update({ coords, color }).eq('doctor_id', doctorId).select('doctor_id'));
  if (!updated.length) check(await sb.from('doctor_areas').insert({ doctor_id: doctorId, coords, color }));
}
const deleteArea = async doctorId => check(await sb.from('doctor_areas').delete().eq('doctor_id', doctorId));
const listRequests = async () => check(await sb.from('patient_requests').select('*').order('id', { ascending: false }).limit(300));
const callRpc = async (fn, args) => check(await sb.rpc(fn, args));

const minutesLeft = r => Math.max(0, OPEN_MINUTES - Math.floor((Date.now() - Date.parse(r.opened_at)) / 60000));
const needsFounders = r => r.status === 'open' && (r.reason === 'out_of_area' || minutesLeft(r) === 0);
const requestState = r => (r.status === 'cancelled' ? 'cancelled' : r.status !== 'open' ? 'done' : needsFounders(r) ? 'founders' : 'waiting');

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=eg&accept-language=${LANG}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url).catch(() => null);
  if (!r?.ok) throw new Error(t('map.searchFailed'));
  return (await r.json()).map(x => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
}
function kmBetween(a, b) { // straight-line distance, good enough for sorting
  const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const areaMiddle = coords => [coords.reduce((s, p) => s + p[1], 0) / coords.length, coords.reduce((s, p) => s + p[0], 0) / coords.length];

function requestSummary(r, names) {
  const when = `${fmtDay(r.preferred_date, { weekday: 'short', day: 'numeric', month: 'short' })}${r.preferred_time ? ' · ' + esc(r.preferred_time.slice(0, 5)) : ''}`;
  const st = requestState(r);
  const status = st === 'done' ? `✓ ${t('req.st.' + r.status, { name: `<bdi>${esc(names.get(r.assigned_doctor_id) || '?')}</bdi>` })}`
    : st === 'founders' ? `⚠ ${t(r.reason === 'out_of_area' ? 'req.st.outOfArea' : 'req.st.overdue')}`
    : st === 'waiting' ? `⏳ ${t('req.st.waiting', { n: minutesLeft(r) })}` : `✕ ${t('req.st.cancelled')}`;
  return { when, status, st };
}

// ---------- founders: the Coverage map page ----------
async function coveragePage(main) {
  state.covTab ||= 'founders';
  main.innerHTML = `
    <div class="head">
      <div><h1>${t('cov.title')}</h1><p class="muted">${t('cov.sub')}</p></div>
      <button class="btn" id="newreq">${t('cov.newRequest')}</button>
    </div>
    <div class="cov-grid">
      <section class="card map-card"><div class="drawbar" id="drawbar" hidden></div><div id="map" class="map" role="region" aria-label="${esc(t('cov.title'))}"></div>
        <div class="map-legend"><span><i style="background:${REQ_COLORS.done}"></i>${t('cov.legend.done')}</span><span><i style="background:${REQ_COLORS.waiting}"></i>${t('cov.legend.waiting')}</span><span><i style="background:${REQ_COLORS.founders}"></i>${t('cov.legend.founders')}</span></div></section>
      <aside class="card cov-side"><h2 class="card-title">${t('cov.areas')}</h2><p class="muted small">${t('cov.areasSub')}</p><div id="doclist"></div></aside>
    </div>
    <section class="card cov-requests">
      <div class="seg" role="group" aria-label="${esc(t('cov.requests'))}">
        <button type="button" data-tab="founders">${t('cov.tab.founders')} <b id="cnt-founders"></b></button>
        <button type="button" data-tab="waiting">${t('cov.tab.waiting')} <b id="cnt-waiting"></b></button>
        <button type="button" data-tab="done">${t('cov.tab.done')}</button>
      </div>
      <div id="reqlist"><div class="empty">${t('common.loading')}</div></div>
    </section>`;
  const $ = id => main.querySelector('#' + id);
  try { await loadLeaflet(); } catch (err) { $('map').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const map = makeMap($('map'));
  const areaLayer = L.layerGroup().addTo(map), reqLayer = L.layerGroup().addTo(map);
  let doctors = [], areas = [], requests = [], names = new Map(), drawing = null;

  const drawAll = () => {
    areaLayer.clearLayers(); reqLayer.clearLayers();
    const bounds = [];
    for (const a of areas) {
      const d = doctors.find(x => x.id === a.doctor_id); if (!d) continue;
      const poly = L.polygon(toLatLngs(a.coords), { color: a.color, weight: 2, fillOpacity: d.active ? 0.14 : 0.04, dashArray: d.active ? null : '6 6' })
        .bindTooltip(esc(d.full_name), { sticky: true }).addTo(areaLayer);
      bounds.push(poly.getBounds());
    }
    for (const r of requests.filter(x => x.status !== 'cancelled')) {
      const { when, status, st } = requestSummary(r, names);
      L.marker([r.lat, r.lng], { icon: pinIcon(REQ_COLORS[st]) }).addTo(reqLayer)
        .bindPopup(`<b dir="auto">${esc(r.patient_name)}</b><br>${when}<br>${status}${r.address ? `<br><span dir="auto">${esc(r.address)}</span>` : ''}`);
    }
    if (bounds.length && !drawing) map.fitBounds(bounds.reduce((b, x) => b.extend(x)), { padding: [20, 20], maxZoom: 12 });
  };

  const drawDoctors = () => {
    $('doclist').innerHTML = doctors.filter(d => d.active).map(d => {
      const a = areas.find(x => x.doctor_id === d.id);
      return `<div class="doc-area"><i class="swatch" style="background:${a ? a.color : '#cfd8e2'}"></i>
        <span><b dir="auto">${esc(d.full_name)}</b><br><span class="muted small">${t(a ? 'cov.hasArea' : 'cov.noArea')}</span></span>
        <button type="button" class="btn ghost sm" data-draw="${d.id}">${t(a ? 'cov.editArea' : 'cov.drawArea')}</button>
        ${a ? `<button type="button" class="icon-x" data-unarea="${d.id}" title="${esc(t('cov.removeArea'))}" aria-label="${esc(t('cov.removeArea'))}">×</button>` : ''}</div>`;
    }).join('') || `<p class="muted small">${t('doctors.none')}</p>`;
    main.querySelectorAll('[data-draw]').forEach(b => b.onclick = () => startDrawing(doctors.find(d => d.id === b.dataset.draw)));
    main.querySelectorAll('[data-unarea]').forEach(b => b.onclick = async () => {
      const d = doctors.find(x => x.id === b.dataset.unarea);
      if (!await confirmAction({ title: t('cov.removeAreaQ', { name: d.full_name }), message: t('cov.removeAreaMsg'), confirm: t('cov.removeArea') })) return;
      try { await deleteArea(d.id); toast(t('cov.areaRemoved')); await load(); } catch (err) { toast(err.message); }
    });
  };

  const drawList = () => {
    const groups = { founders: requests.filter(r => requestState(r) === 'founders'), waiting: requests.filter(r => requestState(r) === 'waiting'),
      done: requests.filter(r => requestState(r) === 'done').slice(0, 40) };
    $('cnt-founders').textContent = groups.founders.length || ''; $('cnt-waiting').textContent = groups.waiting.length || '';
    main.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === state.covTab; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const list = groups[state.covTab];
    $('reqlist').innerHTML = list.length ? list.map(r => {
      const { when, status, st } = requestSummary(r, names);
      return `<div class="req-row ${st}"><div><b dir="auto">${esc(r.patient_name)}</b> <span class="muted small">${when}</span>
          <div class="small">${status}${r.nearest_km != null && st !== 'done' ? ` · ${t('req.nearest', { name: `<bdi>${esc(names.get(r.nearest_doctor_id) || '?')}</bdi>`, km: r.nearest_km })}` : ''}</div>
          ${r.address ? `<div class="muted small" dir="auto">${esc(r.address)}</div>` : ''}${r.phone ? `<div class="muted small"><bdi dir="ltr">${esc(r.phone)}</bdi></div>` : ''}</div>
        <div class="req-actions"><button type="button" class="btn ghost sm" data-show="${r.id}">${t('cov.showOnMap')}</button>
          ${st === 'founders' || st === 'waiting' ? `<button type="button" class="btn sm" data-assign="${r.id}">${t('cov.assign')}</button><button type="button" class="btn danger sm" data-cancelreq="${r.id}">${t('common.cancel')}</button>` : ''}</div></div>`;
    }).join('') : `<div class="empty">${t('cov.empty.' + state.covTab)}</div>`;
    main.querySelectorAll('[data-show]').forEach(b => b.onclick = () => { const r = requests.find(x => x.id == b.dataset.show); map.setView([r.lat, r.lng], 14); $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    main.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => assignModal(requests.find(x => x.id == b.dataset.assign), doctors, areas, load));
    main.querySelectorAll('[data-cancelreq]').forEach(b => b.onclick = async () => {
      if (!await confirmAction({ title: t('cov.cancelReqQ'), confirm: t('cov.cancelReq') })) return;
      try { await callRpc('cancel_patient_request', { req_id: Number(b.dataset.cancelreq) }); toast(t('cov.cancelled')); await load(); } catch (err) { toast(err.message); }
    });
  };

  // Drawing an area: click to add corners, drag corners to move them.
  function startDrawing(d) {
    if (drawing) drawing.stop();
    const existing = areas.find(a => a.doctor_id === d.id);
    const pts = existing ? toLatLngs(existing.coords).map(p => L.latLng(p)) : [];
    let color = existing?.color || ['#e0583f', '#1a5fa8', '#5fa84a', '#487878', '#0a78b4', '#a63a26'][doctors.indexOf(d) % 6];
    const layer = L.layerGroup().addTo(map);
    const bar = $('drawbar');
    const redraw = () => {
      layer.clearLayers();
      if (pts.length > 1) L.polygon(pts, { color, weight: 2, fillOpacity: 0.2, dashArray: '5 5' }).addTo(layer);
      pts.forEach((p, i) => L.marker(p, { draggable: true, icon: L.divIcon({ className: 'vertex', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .on('drag', e => { pts[i] = e.target.getLatLng(); layer.eachLayer(l => l instanceof L.Polygon && l.setLatLngs(pts)); })
        .on('dragend', redraw).addTo(layer));
      bar.querySelector('[data-n]').textContent = t('cov.points', { n: pts.length });
    };
    const onClick = e => { pts.push(e.latlng); redraw(); };
    bar.hidden = false;
    bar.innerHTML = `<p><b dir="auto">${esc(t('cov.drawing', { name: d.full_name }))}</b> ${t('cov.drawHelp')} <span class="muted small" data-n></span></p>
      <div class="drawbar-actions"><label class="color-pick">${t('cov.color')} <input type="color" value="${color}"></label>
      <button type="button" class="btn ghost sm" data-undo>${t('cov.undo')}</button><button type="button" class="btn ghost sm" data-clear>${t('cov.clear')}</button>
      <span style="flex:1"></span><button type="button" class="btn ghost sm" data-stop>${t('common.cancel')}</button><button type="button" class="btn sm" data-save>${t('cov.saveArea')}</button></div>`;
    bar.querySelector('input[type=color]').oninput = e => { color = e.target.value; redraw(); };
    bar.querySelector('[data-undo]').onclick = () => { pts.pop(); redraw(); };
    bar.querySelector('[data-clear]').onclick = () => { pts.length = 0; redraw(); };
    bar.querySelector('[data-stop]').onclick = () => drawing.stop();
    bar.querySelector('[data-save]').onclick = async () => {
      if (pts.length < 3) return toast(t('cov.needPoints'));
      if (!await confirmAction({ title: t('cov.saveAreaQ', { name: d.full_name }), confirm: t('cov.saveArea'), danger: false })) return;
      try { await saveArea(d.id, pts, color); drawing.stop(); toast(t('cov.areaSaved')); await load(); } catch (err) { toast(err.message); }
    };
    map.on('click', onClick);
    map.getContainer().classList.add('drawing');
    areaLayer.eachLayer(l => l.setStyle?.({ opacity: 0.35, fillOpacity: 0.05 }));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    drawing = { stop() { map.off('click', onClick); map.removeLayer(layer); bar.hidden = true; bar.innerHTML = ''; map.getContainer().classList.remove('drawing'); drawing = null; drawAll(); } };
    redraw();
    bar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function load() {
    try { [doctors, areas, requests] = await Promise.all([listDoctors(), listAreas(), listRequests()]); }
    catch (err) { $('reqlist').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
    names = new Map(doctors.map(d => [d.id, d.full_name]));
    drawAll(); drawDoctors(); drawList();
  }
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.covTab = b.dataset.tab; drawList(); });
  $('newreq').onclick = () => newRequestModal(load);
  await load();
}

// ---------- founders: a new patient request ----------
function newRequestModal(onDone) {
  modal(`<h2>${t('req.newTitle')}</h2><p class="muted small">${t('req.newHelp')}</p><form>
      <div class="grid2">
        <div class="field"><label>${t('form.patient')}</label><input name="patient_name" dir="auto" required placeholder="${esc(t('form.patient.ph'))}"></div>
        <div class="field"><label>${t('doc.phone')}</label><input name="phone" dir="ltr" placeholder="01x xxxx xxxx"></div>
      </div>
      <div class="field"><label>${t('req.address')}</label>
        <div class="search-row"><input name="location" dir="auto" placeholder="${esc(t('req.address.ph'))}"><button type="button" class="btn ghost" data-find>${t('req.find')}</button></div>
        <div class="search-results" data-results></div></div>
      <div class="mini-map" data-map></div><p class="muted small" data-pin>${t('req.pinHelp')}</p>
      <div class="grid3">
        <div class="field"><label>${t('form.date')}</label><input name="preferred_date" type="date" required value="${today()}" min="${today()}"></div>
        <div class="field"><label>${t('form.time')}</label><input name="preferred_time" type="time"></div>
        <div class="field"><label>${t('form.minutes')}</label><input name="duration_min" type="number" min="0" max="600" step="5" value="45"></div>
      </div>
      <div class="field"><label>${t('form.type')}</label><input type="hidden" name="session_type" value="Home visit">
        <div class="type-pick">${SESSION_TYPES.map(v => `<button type="button" data-type="${v}" class="${v === 'Home visit' ? 'on' : ''}">${typeLabel(v)}</button>`).join('')}</div></div>
      <div class="field"><label>${t('form.notes')} <span class="muted">${t('form.optional')}</span></label><textarea name="notes" dir="auto"></textarea></div>
      <div class="error" role="alert"></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button><button class="btn">${t('req.submit')}</button></div>
    </form>`, async (m, close) => {
    const form = m.querySelector('form'); wireTypePick(form);
    let pin = null, marker = null;
    await loadLeaflet().catch(err => { m.querySelector('[data-map]').textContent = err.message; });
    if (!window.L) return;
    const map = makeMap(m.querySelector('[data-map]'), { zoom: 9 });
    const setPin = (lat, lng, zoom) => {
      pin = { lat, lng };
      if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng], { draggable: true, icon: pinIcon('#1a5fa8') }).addTo(map).on('dragend', e => { const p = e.target.getLatLng(); pin = { lat: p.lat, lng: p.lng }; });
      if (zoom) map.setView([lat, lng], zoom);
      m.querySelector('[data-pin]').textContent = t('req.pinSet');
    };
    map.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
    const results = m.querySelector('[data-results]');
    const find = async () => {
      const q = form.location.value.trim(); if (!q) return;
      results.innerHTML = `<span class="muted small">${t('common.loading')}</span>`;
      try {
        const found = await geocode(q);
        results.innerHTML = found.length ? found.map((x, i) => `<button type="button" data-pick="${i}" dir="auto">${esc(x.name)}</button>`).join('') : `<span class="muted small">${t('req.noResults')}</span>`;
        results.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const x = found[b.dataset.pick]; setPin(x.lat, x.lng, 15); results.innerHTML = ''; });
      } catch (err) { results.innerHTML = `<span class="error small">${esc(err.message)}</span>`; }
    };
    m.querySelector('[data-find]').onclick = find;
    form.location.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    form.onsubmit = async e => {
      e.preventDefault();
      const b = formData(form), err = form.querySelector('.error');
      if (!pin) { err.textContent = t('req.needPin'); return; }
      try {
        const res = await callRpc('create_patient_request', { p: { patient_name: b.patient_name, phone: b.phone, address: b.location, lat: pin.lat, lng: pin.lng,
          preferred_date: b.preferred_date, preferred_time: b.preferred_time, duration_min: b.duration_min, session_type: b.session_type, notes: b.notes } });
        close(); await onDone(); requestResultModal(res);
      } catch (x) { err.textContent = x.message; }
    };
  });
}

async function requestResultModal(res) {
  const doctors = await listDoctors().catch(() => []);
  const name = doctors.find(d => d.id === res.doctor_id)?.full_name || '';
  const key = res.status === 'assigned' ? (Number(res.nearest_km) > 0 ? 'req.res.assignedNear' : 'req.res.assigned')
    : res.reason === 'nearest_full' ? 'req.res.full' : res.reason === 'out_of_area' ? 'req.res.outOfArea' : 'req.res.noArea';
  modal(`<div class="confirm-box"><h2>${t(res.status === 'assigned' ? 'req.res.titleOk' : 'req.res.titleOpen')}</h2>
    <p dir="auto">${esc(t(key, { name, km: res.nearest_km ?? '', limit: DAILY_LIMIT }))}</p>
    <div class="actions"><button type="button" class="btn" data-close>${t('common.done')}</button></div></div>`);
}

// ---------- founders: assign a request by hand (may go over the daily limit) ----------
async function assignModal(r, doctors, areas, onDone) {
  let appts = [], sess = [];
  try { [appts, sess] = await Promise.all([listAppointments({ from: r.preferred_date, to: r.preferred_date, statuses: ['planned', 'done'] }),
    listSessions({ from: r.preferred_date, to: r.preferred_date })]); } catch { /* counts just show 0 */ }
  const linked = new Set(appts.map(a => a.session_id).filter(Boolean));
  const load = id => appts.filter(a => a.doctor_id === id).length + sess.filter(s => s.doctor_id === id && !linked.has(s.id)).length;
  const rows = doctors.filter(d => d.active).map(d => {
    const a = areas.find(x => x.doctor_id === d.id);
    return { d, n: load(d.id), km: a ? kmBetween([r.lat, r.lng], areaMiddle(a.coords)) : null };
  }).sort((x, y) => (x.km ?? 1e9) - (y.km ?? 1e9));
  modal(`<h2>${t('cov.assignTitle', { name: r.patient_name })}</h2>
    <p class="muted small">${t('cov.assignHelp', { date: fmtDay(r.preferred_date, { weekday: 'long', day: 'numeric', month: 'long' }), limit: DAILY_LIMIT })}</p>
    <div class="assign-list">${rows.map(({ d, n, km }) => `<button type="button" class="assign-row ${n >= DAILY_LIMIT ? 'full' : ''}" data-doc="${d.id}">
      <b dir="auto">${esc(d.full_name)}</b><span class="small muted">${km != null ? t('cov.kmAway', { km: Math.round(km) }) : t('cov.noArea')}</span>
      <span class="load ${n >= DAILY_LIMIT ? 'full' : ''}"><bdi dir="ltr">${n} / ${DAILY_LIMIT}</bdi></span></button>`).join('')}</div>
    <div class="error" role="alert"></div><div class="actions"><button type="button" class="btn ghost" data-close>${t('common.cancel')}</button></div>`, (m, close) => {
    m.querySelectorAll('[data-doc]').forEach(b => b.onclick = async () => {
      const row = rows.find(x => x.d.id === b.dataset.doc);
      const over = row.n >= DAILY_LIMIT;
      if (!await confirmAction({ title: t('cov.assignQ', { patient: r.patient_name, name: row.d.full_name }), message: over ? t('cov.overLimit', { n: row.n }) : '',
        confirm: t('cov.assign'), danger: over })) return;
      try { await callRpc('assign_patient_request', { req_id: r.id, doc: row.d.id }); close(); toast(t('cov.assigned')); await onDone(); }
      catch (err) { m.querySelector('.error').textContent = err.message; }
    });
  });
}

// ---------- doctors: open patients they can take ----------
async function openPatientsPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('open.title')}</h1><p class="muted">${t('open.sub', { limit: DAILY_LIMIT })}</p></div></div>
    <div class="card map-card"><div id="map" class="map small-map"></div></div><div id="list" class="open-list"><div class="empty">${t('common.loading')}</div></div>`;
  let list = [], myArea = null;
  try { [list, myArea] = await Promise.all([callRpc('open_requests_for_me', {}), sb.from('doctor_areas').select('coords, color').eq('doctor_id', state.user.id).maybeSingle().then(check)]); }
  catch (err) { main.querySelector('#list').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
  main.querySelector('#list').innerHTML = list.length ? list.map(r => `
    <div class="card open-card">
      <div class="open-top"><b dir="auto">${esc(r.patient_name)}</b><span class="pill ${typeClass(r.session_type)}">${esc(typeLabel(r.session_type) || '—')}</span></div>
      <div>${fmtDay(r.preferred_date, { weekday: 'long', day: 'numeric', month: 'long' })}${r.preferred_time ? ' · ' + esc(r.preferred_time.slice(0, 5)) : ''}</div>
      ${r.address ? `<div class="muted small" dir="auto">${esc(r.address)}</div>` : ''}
      <div class="small">${r.km == null ? t('open.noArea') : Number(r.km) === 0 ? `📍 ${t('open.inside')}` : `📍 ${t('open.km', { km: r.km })}`}
        · <span class="muted">⏳ ${t('open.left', { n: minutesLeft(r) })}</span></div>
      <button type="button" class="btn block" data-take="${r.id}">${t('open.take')}</button>
    </div>`).join('') : `<div class="card empty friendly"><span class="big" aria-hidden="true">🙌</span><p>${t('open.none')}</p></div>`;
  main.querySelectorAll('[data-take]').forEach(b => b.onclick = async () => {
    const r = list.find(x => x.id == b.dataset.take);
    if (!await confirmAction({ title: t('open.takeQ', { name: r.patient_name }), message: t('open.takeMsg'), confirm: t('open.take'), danger: false })) return;
    b.disabled = true;
    try { await callRpc('claim_patient_request', { req_id: r.id }); toast(t('open.taken')); location.hash = '#/schedule'; }
    catch (err) { toast(err.message); openPatientsPage(main); }
  });
  try { await loadLeaflet(); } catch { main.querySelector('.map-card').hidden = true; return; }
  const map = makeMap(main.querySelector('#map'));
  const bounds = [];
  if (myArea) bounds.push(L.polygon(toLatLngs(myArea.coords), { color: myArea.color, weight: 2, fillOpacity: 0.15 }).bindTooltip(t('open.myArea')).addTo(map).getBounds());
  list.forEach(r => { const mk = L.marker([r.lat, r.lng], { icon: pinIcon(REQ_COLORS.waiting) }).bindPopup(`<b dir="auto">${esc(r.patient_name)}</b>`).addTo(map); bounds.push(L.latLngBounds([mk.getLatLng()])); });
  if (bounds.length) map.fitBounds(bounds.reduce((b, x) => b.extend(x)), { padding: [24, 24], maxZoom: 13 });
}

// ---------- Overview: patients waiting for a founder ----------
async function foundersAttention() {
  try {
    const open = check(await sb.from('patient_requests').select('id, patient_name, reason, opened_at, status').eq('status', 'open'));
    return open.filter(needsFounders);
  } catch { return []; }
}
