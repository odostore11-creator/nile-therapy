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
  // OpenStreetMap blocks tiles that don't say which site they're for, and the portal hides that by
  // default (meta referrer). 'origin' sends only the site address, never the page or any data.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, referrerPolicy: 'origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}
const toLatLngs = coords => coords.map(([lng, lat]) => [lat, lng]);
const pinIcon = (color, mark = '') => L.divIcon({ className: 'pin', html: `<span style="background:${color}">${mark}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

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
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=eg&accept-language=${LANG},${LANG === 'ar' ? 'en' : 'ar'}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { referrerPolicy: 'origin' }).catch(() => null); // Nominatim also requires knowing the site
  if (!r?.ok) throw new Error(t('map.searchFailed'));
  return (await r.json()).map(x => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
}

/** Coordinates typed or pasted directly: "30.06, 31.34", or a Google Maps link containing them. */
function coordsFromText(text) {
  const s = String(text || '');
  const m = s.match(/[@?&=](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/)
    || s.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return lat >= 21 && lat <= 32.5 && lng >= 24 && lng <= 37.5 ? { lat, lng } : null;
}

/**
 * Search as you type: suggestions appear after a short pause (OpenStreetMap allows about one search
 * per second, so we wait 0.7 s after the last key). Pasted coordinates / Maps links jump straight there.
 * Enter picks the first suggestion; arrow keys move through them.
 */
function wireAddressSearch(input, box, onPick) {
  let timer = 0, seq = 0, found = [], active = -1;
  const show = list => {
    found = list; active = -1;
    box.innerHTML = list.map((x, i) => `<button type="button" role="option" data-pick="${i}" dir="auto">${x.icon || '📍'} ${esc(x.name)}</button>`).join('');
    box.querySelectorAll('[data-pick]').forEach(b => b.onmousedown = e => { e.preventDefault(); pick(Number(b.dataset.pick)); });
  };
  const pick = i => { const x = found[i]; if (!x) return; box.innerHTML = ''; found = []; onPick(x); };
  const highlight = () => box.querySelectorAll('[data-pick]').forEach((b, i) => b.classList.toggle('active', i === active));
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const direct = coordsFromText(q);
    if (direct) return show([{ ...direct, name: t('req.useCoords', { lat: direct.lat.toFixed(5), lng: direct.lng.toFixed(5) }), icon: '🎯' }]);
    if (q.length < 3) { box.innerHTML = ''; found = []; return; }
    box.innerHTML = `<span class="muted small searching">${t('req.searching')}</span>`;
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const list = await geocode(q);
        if (mine !== seq) return; // a newer search started
        if (list.length) show(list); else box.innerHTML = `<span class="muted small">${t('req.noResults')}</span>`;
      } catch (err) { if (mine === seq) box.innerHTML = `<span class="error small">${esc(err.message)}</span>`; }
    }, 700);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (found.length) pick(active >= 0 ? active : 0); }
    else if (e.key === 'ArrowDown' && found.length) { e.preventDefault(); active = (active + 1) % found.length; highlight(); }
    else if (e.key === 'ArrowUp' && found.length) { e.preventDefault(); active = (active - 1 + found.length) % found.length; highlight(); }
    else if (e.key === 'Escape') { box.innerHTML = ''; found = []; }
  });
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
      <section class="card map-card"><div class="map-search"><input id="mapsearch" type="search" dir="auto" enterkeyhint="search" placeholder="${esc(t('cov.searchPlace'))}" aria-label="${esc(t('cov.searchPlace'))}"><div class="search-results" id="mapresults" role="listbox"></div></div><div class="drawbar" id="drawbar" hidden></div><div id="map" class="map" role="region" aria-label="${esc(t('cov.title'))}"></div>
        <div class="map-legend"><span><i class="check">✓</i>${t('cov.legend.done')}</span><span><i style="background:${REQ_COLORS.waiting}"></i>${t('cov.legend.waiting')}</span><span><i style="background:${REQ_COLORS.founders}"></i>${t('cov.legend.founders')}</span></div></section>
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
  wireAddressSearch($('mapsearch'), $('mapresults'), x => { map.setView([x.lat, x.lng], 15); $('mapsearch').blur(); });
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
      // Booked patients take their doctor's area color (with a ✓) and show the doctor's name, so it's clear whose they are.
      const docColor = st === 'done' && areas.find(a => a.doctor_id === r.assigned_doctor_id)?.color;
      const mk = L.marker([r.lat, r.lng], { icon: docColor ? pinIcon(docColor, '✓') : pinIcon(REQ_COLORS[st]) }).addTo(reqLayer)
        .bindPopup(`<b dir="auto">${esc(r.patient_name)}</b><br>${when}<br>${status}${r.address ? `<br><span dir="auto">${esc(r.address)}</span>` : ''}`);
      if (st === 'done') mk.bindTooltip(`<bdi>${esc(names.get(r.assigned_doctor_id) || '')}</bdi>`, { direction: 'top', offset: [0, -10] });
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

  // Drawing an area. Two ways (dots is the default):
  //  * Dots: click to add corners, drag corners to move them, tap a small "+" between two corners to add one there.
  //  * Lasso: hold and draw the outline freehand; it then turns into dots you can fine-tune.
  function startDrawing(d) {
    if (drawing) drawing.stop();
    const existing = areas.find(a => a.doctor_id === d.id);
    const pts = existing ? toLatLngs(existing.coords).map(p => L.latLng(p)) : [];
    let color = existing?.color || ['#e0583f', '#1a5fa8', '#5fa84a', '#487878', '#0a78b4', '#a63a26'][doctors.indexOf(d) % 6];
    const layer = L.layerGroup().addTo(map);
    const bar = $('drawbar'), box = map.getContainer();
    let mode = 'dots', trail = null, line = null;
    const redraw = () => {
      layer.clearLayers();
      if (pts.length > 1) L.polygon(pts, { color, weight: 2, fillOpacity: 0.2, dashArray: '5 5' }).addTo(layer);
      if (mode === 'dots') {
        pts.forEach((p, i) => L.marker(p, { draggable: true, icon: L.divIcon({ className: 'vertex', iconSize: [16, 16], iconAnchor: [8, 8] }) })
          .on('drag', e => { pts[i] = e.target.getLatLng(); layer.eachLayer(l => l instanceof L.Polygon && l.setLatLngs(pts)); })
          .on('dragend', redraw).addTo(layer));
        // "+" between corners (closing edge included) to add a corner exactly there.
        if (pts.length > 2) pts.forEach((p, i) => {
          const q = pts[(i + 1) % pts.length], mid = L.latLng((p.lat + q.lat) / 2, (p.lng + q.lng) / 2);
          L.marker(mid, { draggable: true, title: t('cov.addCorner'), icon: L.divIcon({ className: 'vertex-mid', html: '+', iconSize: [14, 14], iconAnchor: [7, 7] }) })
            .on('click', () => { pts.splice(i + 1, 0, mid); redraw(); })
            .on('dragend', e => { pts.splice(i + 1, 0, e.target.getLatLng()); redraw(); }).addTo(layer);
        });
      }
      bar.querySelector('[data-n]').textContent = t('cov.points', { n: pts.length });
      bar.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode); });
      bar.querySelector('[data-help]').textContent = t(mode === 'dots' ? 'cov.drawHelp' : 'cov.lassoHelp');
    };
    const setMode = m => {
      mode = m;
      box.classList.toggle('lasso', m === 'lasso');
      if (m === 'lasso') map.dragging.disable(); else map.dragging.enable();
      redraw();
    };
    const onClick = e => { if (mode !== 'dots') return; pts.push(e.latlng); redraw(); };
    // Lasso: follow the finger/mouse, keep a point every ~8px, then hand over to dots.
    const onDown = e => {
      if (mode !== 'lasso' || e.button > 0 || e.target.closest('.leaflet-control')) return;
      e.preventDefault(); box.setPointerCapture?.(e.pointerId);
      trail = [map.mouseEventToLatLng(e)];
      line = L.polyline(trail, { color, weight: 3 }).addTo(map);
    };
    const onMove = e => {
      if (!trail) return;
      const ll = map.mouseEventToLatLng(e), last = trail[trail.length - 1];
      if (map.latLngToContainerPoint(ll).distanceTo(map.latLngToContainerPoint(last)) < 8) return;
      trail.push(ll); line.setLatLngs(trail);
    };
    const onUp = () => {
      if (!trail) return;
      const got = trail; trail = null; map.removeLayer(line); line = null;
      if (got.length < 3) return toast(t('cov.needPoints'));
      const step = Math.ceil(got.length / 150); // keep it to about 150 corners
      pts.length = 0; got.filter((_, i) => i % step === 0).forEach(p => pts.push(p));
      setMode('dots'); toast(t('cov.lassoDone'));
    };
    box.addEventListener('pointerdown', onDown); box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp); box.addEventListener('pointercancel', onUp);
    bar.hidden = false;
    bar.innerHTML = `<p><b dir="auto">${esc(t('cov.drawing', { name: d.full_name }))}</b> <span data-help></span> <span class="muted small" data-n></span></p>
      <div class="drawbar-actions"><div class="seg" role="group" aria-label="${esc(t('cov.drawMode'))}"><button type="button" data-mode="dots">● ${t('cov.modeDots')}</button><button type="button" data-mode="lasso">✏️ ${t('cov.modeLasso')}</button></div><label class="color-pick">${t('cov.color')} <input type="color" value="${color}"></label>
      <button type="button" class="btn ghost sm" data-undo>${t('cov.undo')}</button><button type="button" class="btn ghost sm" data-clear>${t('cov.clear')}</button>
      <span style="flex:1"></span><button type="button" class="btn ghost sm" data-stop>${t('common.cancel')}</button><button type="button" class="btn sm" data-save>${t('cov.saveArea')}</button></div>`;
    bar.querySelector('input[type=color]').oninput = e => { color = e.target.value; redraw(); };
    bar.querySelector('[data-undo]').onclick = () => { pts.pop(); redraw(); };
    bar.querySelector('[data-clear]').onclick = () => { pts.length = 0; redraw(); };
    bar.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
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
    drawing = { stop() { map.off('click', onClick); map.dragging.enable(); box.classList.remove('lasso');
      box.removeEventListener('pointerdown', onDown); box.removeEventListener('pointermove', onMove); box.removeEventListener('pointerup', onUp); box.removeEventListener('pointercancel', onUp); map.removeLayer(layer); bar.hidden = true; bar.innerHTML = ''; map.getContainer().classList.remove('drawing'); drawing = null; drawAll(); } };
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
        <div class="search-box"><input name="location" dir="auto" type="search" enterkeyhint="search" placeholder="${esc(t('req.address.ph'))}"></div>
        <div class="search-results" data-results role="listbox"></div></div>
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
    wireAddressSearch(form.location, m.querySelector('[data-results]'), x => {
      setPin(x.lat, x.lng, 16);
      if (x.icon !== '🎯') form.location.value = x.name.split(',').slice(0, 3).join(',');
    });
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

// ---------- doctors: "My map" (own area, own booked patients, open patients to take) ----------
/** The doctor's upcoming booked patients that have a known spot: from patient requests (pin) or a map link with coordinates. */
async function myBookedPins() {
  const td = today();
  const [reqs, visits] = await Promise.all([
    sb.from('patient_requests').select('patient_name, lat, lng, preferred_date, preferred_time, appointment_id')
      .eq('assigned_doctor_id', state.user.id).in('status', ['assigned', 'claimed', 'founder_assigned']).gte('preferred_date', td).then(check),
    listAppointments({ from: td, doctorId: state.user.id, statuses: ['planned'] }),
  ]);
  const fromReq = new Set(reqs.map(r => r.appointment_id));
  const open = new Set(visits.map(a => a.id)); // only visits that are still planned
  return [
    ...reqs.filter(r => !r.appointment_id || open.has(r.appointment_id)).map(r => ({ name: r.patient_name, lat: r.lat, lng: r.lng, date: r.preferred_date, time: r.preferred_time })),
    ...visits.filter(a => !fromReq.has(a.id)).map(a => ({ ...coordsFromText(a.location_url), name: a.patient_name, date: a.appt_date, time: a.appt_time }))
      .filter(p => p.lat != null),
  ];
}

async function openPatientsPage(main) {
  main.innerHTML = `<div class="head"><div><h1>${t('open.title')}</h1><p class="muted">${t('open.sub', { limit: DAILY_LIMIT })}</p></div></div>
    <div class="card map-card"><div id="map" class="map small-map"></div>
      <div class="map-legend"><span><i class="check">✓</i>${t('open.legendMine')}</span><span><i style="background:${REQ_COLORS.waiting}"></i>${t('open.legendOpen')}</span></div></div>
    <h2 class="section-title">${t('open.listTitle')}</h2>
    <div id="list" class="open-list"><div class="empty">${t('common.loading')}</div></div>`;
  let list = [], myArea = null, mine = [];
  try {
    [list, myArea, mine] = await Promise.all([callRpc('open_requests_for_me', {}),
      sb.from('doctor_areas').select('coords, color').eq('doctor_id', state.user.id).maybeSingle().then(check), myBookedPins().catch(() => [])]);
  }
  catch (err) { main.querySelector('#list').innerHTML = `<div class="card empty">${esc(err.message)}</div>`; return; }
  main.querySelector('#list').innerHTML = list.length ? list.map(r => `
    <div class="card open-card">
      <div class="open-top"><b dir="auto">${esc(r.patient_name)}</b><span class="pill ${typeClass(r.session_type)}">${esc(typeLabel(r.session_type) || '—')}</span></div>
      <div>${fmtDay(r.preferred_date, { weekday: 'long', day: 'numeric', month: 'long' })}${r.preferred_time ? ' · ' + esc(r.preferred_time.slice(0, 5)) : ''}</div>
      ${r.address ? `<div class="muted small" dir="auto">${esc(r.address)}</div>` : ''}
      <div class="small">${mapLinkHtml(`https://www.google.com/maps?q=${(+r.lat).toFixed(6)},${(+r.lng).toFixed(6)}`)}</div>
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
  const myColor = myArea?.color || '#1a5fa8';
  main.querySelector('.map-legend i.check')?.style.setProperty('background', myColor);
  if (myArea) bounds.push(L.polygon(toLatLngs(myArea.coords), { color: myColor, weight: 2, fillOpacity: 0.15 }).bindTooltip(t('open.myArea')).addTo(map).getBounds());
  // My booked patients: my color + ✓, with the name (and day) always shown.
  mine.forEach(p => {
    const when = `${fmtDay(p.date, { weekday: 'short', day: 'numeric', month: 'short' })}${p.time ? ' ' + p.time.slice(0, 5) : ''}`;
    L.marker([p.lat, p.lng], { icon: pinIcon(myColor, '✓') }).addTo(map)
      .bindTooltip(`<bdi>${esc(p.name)}</bdi>`, { permanent: true, direction: 'top', offset: [0, -12], className: 'name-tip' })
      .bindPopup(`<b><bdi>${esc(p.name)}</bdi></b><br>${esc(when)}`);
    bounds.push(L.latLngBounds([[p.lat, p.lng]]));
  });
  list.forEach(r => { const mk = L.marker([r.lat, r.lng], { icon: pinIcon(REQ_COLORS.waiting) }).bindPopup(`<b dir="auto">${esc(r.patient_name)}</b>`).addTo(map); bounds.push(L.latLngBounds([mk.getLatLng()])); });
  if (bounds.length) map.fitBounds(bounds.reduce((b, x) => b.extend(x)), { padding: [30, 30], maxZoom: 14 });
}

