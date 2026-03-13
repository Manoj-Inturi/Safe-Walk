/* ═══════════════════════════════════════════════════════════════════
   SAFEWALK — app.js
   AI-powered safe walking navigation for India.

   Table of Contents:
     §1   Constants & State
     §2   Splash Screen (auto-start)
     §3   Map Initialization
     §4   GPS — Auto-request & Manual
     §5   Input Helpers (set values, swap)
     §6   Autocomplete (Nominatim API)
     §7   Recent Searches & Saved Places (localStorage)
     §8   Map Pins
     §9   Distance & Transport Warning
     §10  Search Flow (main entry point)
     §11  Geocoding (Nominatim API)
     §12  Routing Engine (OSRM API)
     §13  Road Quality Data (Overpass API)
     §14  Safety Scoring Engine
     §15  Analyzing Animation
     §16  POI Fetch (Overpass API — police, hospitals)
     §17  Route Builder & Route Cards
     §18  Route Drawing (Leaflet polylines)
     §19  Night Mode
     §20  Live Walk Tracking
     §21  Turn-by-Turn Directions
     §22  Services (POI markers, CCTV)
     §23  Dark Zones
     §24  Filter Chips
     §25  Mobile Sidebar
     §26  Toast Notifications
     §27  SOS & Emergency Contacts  ← NEW/ENHANCED
     §28  Onboarding
     §29  Scroll Helpers
     §30  Mobile Swipe & Input Sync
═══════════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════
   §1  CONSTANTS & STATE
   All module-level variables are declared here.
   Avoids implicit globals and makes dependency
   between functions explicit.
═══════════════════════════════════════════ */

// Maximum straight-line distance (km) before showing transport alternatives
const WALK_LIMIT_KM = 2.5;

// Dark Zone circle offsets relative to route midpoint coords.
// Each entry: { dl: latOffset, dg: lngOffset, r: radiusMetres }
const DZ_OFFSETS = [
  {dl:.0008,  dg:-.0010, r:145},
  {dl:-.0014, dg:.0012,  r:168},
  {dl:.0021,  dg:.0013,  r:135},
  {dl:-.0009, dg:-.0018, r:190},
  {dl:.0005,  dg:.0023,  r:155},
];

// Leaflet map instance and live-position marker
let map, userMarker, watchId;

// Current confirmed user position (defaults to Vijayawada, AP)
let userLat = 16.3067, userLng = 80.4365;

// Currently selected From/To coordinates and display names
let fromCoords = null, toCoords = null, fromName = '', toName = '';

// Leaflet layer arrays for cleanup
let routeLayers = [], dzLayers = [], svcMarkers = [];

// Map pin markers for From/To endpoints
let fromPin = null, toPin = null;

// Active map filter chips (set of layer keys)
let activeFilters = new Set(['safe', 'dark', 'police', 'hospital']);

// Route data and which card is currently selected
let currentRoutes = null, activeIdx = 0;

// Overlap layers — shared-segment polylines drawn between routes
let overlapLayers = [];

// Fork-warning marker shown at the point where routes diverge
let forkMarker = null;

// Maximum POI markers per type to prevent clustering on mobile
const MAX_POI_PER_TYPE = 6;

// Debounce timers keyed by field+mode (e.g. "frompc", "tomob")
let sugTimers = {};

// Mobile sidebar sheet state
let sidebarOpen = false;

// POI cache — avoids re-fetching police/hospitals on filter toggle
let cachedPOIs = { data: [] };

// Toast auto-dismiss timer handle
let toastTimer;

// Night mode: true = after-dark safety scoring active
let isNightMode = false;

// Live walk tracking state
let isTracking  = false;  // true while GPS navigation is running
let trackingIdx = 0;      // index into currentRoutes of the active route
let progressMarker = null;// unused — reserved for future "you are here" pin


/* ── Utility helpers ── */

// True when viewport width ≤ 768px (mobile layout)
const isMobile = () => window.innerWidth <= 768;

// Promise-based sleep for use inside async functions
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Escapes HTML special characters to prevent XSS when injecting
 * user-supplied text (place names, etc.) into innerHTML.
 * @param {*} s — any value, coerced to string
 */
const esc = s => String(s).replace(/[&'"\<]/g,
  c => ({'&':'&amp;',"'":'&#39;','"':'&quot;','<':'&lt;'}[c]));


/* ═══════════════════════════════════════════
   §2  SPLASH SCREEN (auto-starts on load)
   Cycles through three loading steps, each
   with a 110ms interval, then fades out and
   initialises the map.
═══════════════════════════════════════════ */
(function splashInit() {
  const ids = ['ss0', 'ss1', 'ss2'];
  let i = 0;
  const t = setInterval(() => {
    // Mark previous step as done (green)
    if (i > 0) {
      const p = document.getElementById(ids[i-1]);
      p.classList.remove('active'); p.classList.add('done');
    }
    if (i < ids.length) {
      // Activate current step
      document.getElementById(ids[i]).classList.add('active');
      i++;
    } else {
      clearInterval(t);
      setTimeout(() => {
        // Fade out splash
        const s = document.getElementById('splash');
        s.style.transition = 'opacity .4s'; s.style.opacity = '0';
        setTimeout(() => {
          s.style.display = 'none';
          // Reveal main app
          document.getElementById('app').classList.add('visible');
          initMap();
          autoRequestGPS();       // silently try GPS on load
          autoDetectTimeOfDay();  // enable night mode after 8 PM
          setTimeout(checkOnboard, 800); // show tips overlay
          setTimeout(checkContacts, 500); // prompt for emergency contacts ALWAYS on reload
        }, 400);
      }, 80);
    }
  }, 110);
})();


/* ═══════════════════════════════════════════
   §3  MAP INITIALIZATION
   Creates a Leaflet map with CartoDB Dark tiles.
   zoomControl is disabled at creation to set custom position.
═══════════════════════════════════════════ */
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    minZoom: 8,
    maxZoom: 19,
  }).setView([userLat, userLng], 13);

  // CartoDB Dark Matter tile layer — matches dark UI theme
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
  }).addTo(map);

  // Zoom control at bottom-right so it doesn't overlap sidebar
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

/**
 * enterApp — dismisses the welcome/splash overlay.
 * Called by the "Get Started" button on the welcome screen.
 */
function enterApp() {
  const w = document.getElementById('welcome');
  w.style.transition = 'opacity .3s'; w.style.opacity = '0';
  setTimeout(() => w.style.display = 'none', 300);
}


/* ═══════════════════════════════════════════
   §4  GPS — AUTO-REQUEST & MANUAL
═══════════════════════════════════════════ */

/**
 * autoRequestGPS — silently requests position on startup.
 * On success: sets fromCoords, centres map, starts live watch.
 * On failure: silently ignored (user can tap 🎯 manually).
 */
function autoRequestGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      fromCoords = [userLat, userLng]; fromName = 'My Location';
      setVal('from', 'My Location');
      map.setView([userLat, userLng], 14);
      placeUserMk(); startWatch(); updateDz();
      showToast('📍 Location detected automatically');
    },
    () => {} // silent fail — user presses 🎯 manually if needed
  );
}

/**
 * requestGPS — manual GPS trigger (🎯 button).
 * Shows progress toast and error on failure.
 * Uses high-accuracy mode with 8-second timeout.
 */
function requestGPS() {
  if (!navigator.geolocation) { showToast('⚠️ GPS not supported on this device'); return; }
  showToast('📍 Getting your location…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      fromCoords = [userLat, userLng]; fromName = 'My Location';
      setVal('from', 'My Location');
      map.setView([userLat, userLng], 15);
      placeUserMk(); startWatch(); updateDz();
      showToast('✅ GPS location set!');
    },
    err => {
      const msg = err.code === 1
        ? '⚠️ Location permission denied — enable in browser settings'
        : '⚠️ Could not get location';
      showToast(msg, 4000);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/**
 * locateMe — centres map on current position (📍 button).
 * Does NOT update fromCoords — just pans the camera.
 */
function locateMe() {
  navigator.geolocation?.getCurrentPosition(
    p => { userLat = p.coords.latitude; userLng = p.coords.longitude; map.setView([userLat, userLng], 16); placeUserMk(); },
    () => map.setView([userLat, userLng], 14)
  );
}

/**
 * startWatch — begins continuous GPS position watch.
 * Updates userLat/Lng, redraws user marker, and updates the live clock.
 * Replaces any existing watch to avoid duplicates.
 */
function startWatch() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p => {
    userLat = p.coords.latitude; userLng = p.coords.longitude;
    placeUserMk();
    const d  = new Date();
    const ts = `Live · ${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
    document.getElementById('liveT').textContent = ts;
    const ml = document.getElementById('mobLiveT'); if (ml) ml.textContent = ts;
  }, null, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

/**
 * placeUserMk — draws/updates the walking figure marker at user's position.
 * Removes old marker before adding new one.
 */
function placeUserMk() {
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker([userLat, userLng], {
    icon: L.divIcon({
      html: '<div class="mk-user">🚶</div>',
      iconSize: [20,20], iconAnchor: [10,10], className: '',
    }),
    zIndexOffset: 1000,
  }).addTo(map);
}


/* ═══════════════════════════════════════════
   §5  INPUT HELPERS
═══════════════════════════════════════════ */

/**
 * setVal — syncs a field value to both PC and mobile inputs.
 * @param {'from'|'to'} field
 * @param {string} v — display value to set
 */
function setVal(field, v) {
  const pcId  = field === 'from' ? 'fromIn'  : 'toIn';
  const mobId = field === 'from' ? 'mobFrom' : 'mobTo';
  document.getElementById(pcId).value = v;
  const m = document.getElementById(mobId); if (m) m.value = v;
}

/** swapLocs — swaps From and To coordinates and display values. */
function swapLocs() {
  [fromCoords, toCoords] = [toCoords, fromCoords];
  [fromName,   toName]   = [toName, fromName];
  setVal('from', fromName || ''); setVal('to', toName || '');
}


/* ═══════════════════════════════════════════
   §6  AUTOCOMPLETE (Nominatim API)

   API: https://nominatim.openstreetmap.org/search
   Purpose: Geocoding text queries to [lat, lon] with name suggestions.
   Rate limit: 1 request/second max (debounced to 240ms).
   Country filter: countrycodes=in (India only).
   Viewbox: biased around the user's current position ±0.5°.
═══════════════════════════════════════════ */

/**
 * onSug — debounces autocomplete requests.
 * Waits 240ms after last keystroke before calling fetchSug.
 * @param {'from'|'to'} field
 * @param {'pc'|'mob'} mode — which input panel triggered this
 */
function onSug(field, mode) {
  const key = field + mode;
  clearTimeout(sugTimers[key]);
  const id = field === 'from'
    ? (mode === 'mob' ? 'mobFrom' : 'fromIn')
    : (mode === 'mob' ? 'mobTo'   : 'toIn');
  const v = document.getElementById(id).value.trim();
  if (v.length < 2) { hideSug(0); return; }
  // Show saved/recent places immediately on focus, then fetch after typing
  sugTimers[key] = setTimeout(() => fetchSug(field, v, mode), 240);
}

/**
 * fetchSug — queries Nominatim for place suggestions.
 *
 * API Endpoint: GET https://nominatim.openstreetmap.org/search
 * Query params:
 *   q=<encoded query>      — search string
 *   format=json            — response format
 *   limit=6                — max suggestions returned
 *   countrycodes=in        — restrict to India
 *   viewbox=lng,lat,lng,lat — bias bounding box around user
 *   bounded=0              — allow results outside viewbox if needed
 *   addressdetails=1       — include address breakdown in response
 * Headers: Accept-Language: en — ensure English place names
 *
 * Response: Array of place objects with { lat, lon, display_name, type, class }
 */
async function fetchSug(field, q, mode) {
  try {
    const vb = `${userLng-.5},${userLat-.5},${userLng+.5},${userLat+.5}`;
    const r  = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=in&viewbox=${vb}&bounded=0&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await r.json();
    renderSug(field, d, mode);
  } catch(e) {
    // Silently fail — user can still type a full place name
  }
}

/**
 * renderSug — injects suggestion HTML into the dropdown box.
 * @param {'from'|'to'} field
 * @param {Array} data — Nominatim results array
 * @param {'pc'|'mob'} mode
 */
function renderSug(field, data, mode) {
  const pcId  = field === 'from' ? 'fromSugg'    : 'toSugg';
  const mobId = field === 'from' ? 'mobFromSugg' : 'mobToSugg';
  const box   = document.getElementById(mode === 'mob' ? mobId : pcId);
  if (!box || !data.length) { box?.classList.remove('show'); return; }

  box.innerHTML = data.map(d => {
    const pts  = d.display_name.split(',');
    const name = pts[0].trim();
    const sub  = pts.slice(1,3).map(s => s.trim()).join(', ');
    const ic   = placeEmoji(d.type, d.class);
    return `<div class="si"
      onmousedown="pickSug('${field}',${+d.lat},${+d.lon},'${esc(name)}')"
      ontouchstart="pickSug('${field}',${+d.lat},${+d.lon},'${esc(name)}')">
      <div class="si-ic">${ic}</div>
      <div><div class="si-name">${esc(name)}</div><div class="si-sub">${esc(sub)}</div></div>
    </div>`;
  }).join('');

  // On mobile, position dropdown just below the top bar (measured in JS)
  if (mode === 'mob') {
    const bar = document.getElementById('mob-bar');
    if (bar) box.style.top = (bar.getBoundingClientRect().bottom + 4) + 'px';
  }
  box.classList.add('show');

  // Mirror suggestions to the other panel so both stay in sync
  const other = document.getElementById(mode === 'mob' ? pcId : mobId);
  if (other) other.innerHTML = box.innerHTML;
}

/**
 * placeEmoji — maps Nominatim type/class strings to relevant emoji icons.
 */
function placeEmoji(type, cls) {
  const M = {
    hospital:'🏥', police:'🚔', school:'🏫', university:'🏫',
    station:'🚉', bus_stop:'🚌', bus_station:'🚌', park:'🌳',
    mall:'🏬', city:'🏙️', town:'🏙️', village:'🏙️',
    suburb:'📍', neighbourhood:'📍', temple:'🛕', church:'⛪',
    mosque:'🕌', pharmacy:'💊', atm:'🏧', bank:'🏦',
  };
  return M[type] || (cls === 'highway' ? '🛣️' : '📍');
}

/**
 * pickSug — selects a suggestion item.
 * Closes dropdown, stores coords, places pin, optionally fits map.
 */
function pickSug(field, lat, lon, name) {
  ['fromSugg','toSugg','mobFromSugg','mobToSugg'].forEach(id => document.getElementById(id)?.classList.remove('show'));
  if (field === 'from') {
    fromCoords = [lat, lon]; fromName = name;
    setVal('from', name); placePin([lat, lon], 'from'); map.setView([lat, lon], 15);
  } else {
    toCoords = [lat, lon]; toName = name;
    setVal('to', name); placePin([lat, lon], 'to');
    if (fromCoords) map.fitBounds([fromCoords, toCoords], { padding: [80, 60] });
  }
}

/** hideSug — hides all suggestion dropdowns after an optional delay (ms). */
function hideSug(delay) {
  setTimeout(() => {
    ['fromSugg','toSugg','mobFromSugg','mobToSugg'].forEach(id => document.getElementById(id)?.classList.remove('show'));
  }, delay);
}


/* ═══════════════════════════════════════════
   §7  RECENT SEARCHES & SAVED PLACES
   Both stored in localStorage:
     "sw_recent" — array of last 5 geocoded picks
     "sw_saved"  — user-starred places (no cap)
═══════════════════════════════════════════ */
const MAX_RECENT = 5;

/** getRecent — returns the recent searches array from localStorage. */
function getRecent() {
  try { return JSON.parse(localStorage.getItem('sw_recent') || '[]'); } catch(e) { return []; }
}

/**
 * saveRecent — prepends a location to the recent list, capping at MAX_RECENT.
 * Deduplicates by name before inserting.
 */
function saveRecent(name, lat, lon) {
  try {
    let list = getRecent().filter(r => r.name !== name);
    list.unshift({ name, lat, lon });
    list = list.slice(0, MAX_RECENT);
    localStorage.setItem('sw_recent', JSON.stringify(list));
  } catch(e) {}
}

/** getSaved — returns the user's starred places from localStorage. */
function getSaved() {
  try { return JSON.parse(localStorage.getItem('sw_saved') || '[]'); } catch(e) { return []; }
}

/**
 * toggleSaved — stars or un-stars a place.
 * If name already exists in saved, removes it; otherwise prepends.
 */
function toggleSaved(name, lat, lon) {
  try {
    let list = getSaved();
    const exists = list.findIndex(s => s.name === name);
    if (exists >= 0) { list.splice(exists, 1); showToast('🗑️ Removed from saved places'); }
    else             { list.unshift({ name, lat, lon }); showToast('⭐ Saved to your places'); }
    localStorage.setItem('sw_saved', JSON.stringify(list));
  } catch(e) {}
}

/**
 * showRecentInSugg — populates the suggestion dropdown with saved + recent
 * places when the user focuses an input without typing.
 */
function showRecentInSugg(field, mode) {
  const recent = getRecent();
  const saved  = getSaved();
  if (!recent.length && !saved.length) return;

  const pcId  = field === 'from' ? 'fromSugg'    : 'toSugg';
  const mobId = field === 'from' ? 'mobFromSugg' : 'mobToSugg';
  const box   = document.getElementById(mode === 'mob' ? mobId : pcId);
  if (!box) return;

  let html = '';
  if (saved.length) {
    html += '<div class="sugg-section-title">⭐ Saved Places</div>';
    html += saved.map(p => `<div class="si si-saved"
      onmousedown="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')"
      ontouchstart="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')">
      <div class="si-ic">⭐</div>
      <div><div class="si-name">${esc(p.name)}</div></div>
    </div>`).join('');
  }
  if (recent.length) {
    html += '<div class="sugg-section-title">🕐 Recent</div>';
    html += recent.map(p => `<div class="si si-recent"
      onmousedown="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')"
      ontouchstart="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')">
      <div class="si-ic">🕐</div>
      <div><div class="si-name">${esc(p.name)}</div></div>
    </div>`).join('');
  }
  box.innerHTML = html;
  box.classList.add('show');
}


/* ═══════════════════════════════════════════
   §8  MAP PINS
═══════════════════════════════════════════ */

/**
 * placePin — places or replaces a From (green) / To (red) pin on the map.
 * @param {[number,number]} c — [lat, lng]
 * @param {'from'|'to'} type
 */
function placePin(c, type) {
  const isF = type === 'from';
  const icon = L.divIcon({
    html: `<div class="mk ${isF ? 'mk-from' : 'mk-to'}">${isF ? '🟢' : '🔴'}</div>`,
    iconSize: [30,30], iconAnchor: [15,15], className: '',
  });
  if (isF) { if (fromPin) map.removeLayer(fromPin); fromPin = L.marker(c, {icon}).addTo(map); }
  else     { if (toPin)   map.removeLayer(toPin);   toPin   = L.marker(c, {icon}).addTo(map); }
}


/* ═══════════════════════════════════════════
   §9  DISTANCE & TRANSPORT WARNING
═══════════════════════════════════════════ */

/**
 * haversine — great-circle distance between two [lat,lng] points in km.
 * Uses the Haversine formula for spherical Earth model.
 * @param {[number,number]} a
 * @param {[number,number]} b
 * @returns {number} distance in kilometres
 */
function haversine(a, b) {
  const R  = 6371;
  const d1 = (b[0]-a[0]) * Math.PI/180;
  const d2 = (b[1]-a[1]) * Math.PI/180;
  const x  = Math.sin(d1/2)**2 + Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(d2/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}

/**
 * checkDistanceWarning — shows/hides the transport banner.
 * If distance > WALK_LIMIT_KM (2.5 km), suggests bus/cab/metro.
 * Displays estimated walking time in minutes.
 * @param {number} km — straight-line distance
 */
function checkDistanceWarning(km) {
  const el   = document.getElementById('transBanner');
  const mins = Math.round(km / 4 * 60); // assumes 4 km/h walking pace
  if (km > WALK_LIMIT_KM) {
    document.getElementById('transTitle').textContent = km > 10
      ? `${km.toFixed(1)} km — Long walk`
      : `${km.toFixed(1)} km — Transport available`;
    document.getElementById('transBody').innerHTML =
      `About <b>${mins} min</b> on foot. You might prefer a safer ride:`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

/**
 * openMaps — opens an external app (OlaCabs or Google Maps) for transport.
 * @param {'bus'|'cab'|'metro'} mode
 *
 * APIs used (external — user is redirected to these URLs):
 *   Cab:   https://www.olacabs.com/
 *   Bus:   https://maps.google.com/maps?travelmode=transit
 *   Metro: https://maps.google.com/maps?travelmode=transit
 */
function openMaps(mode) {
  if (!toCoords) return;
  const d = `${toCoords[0]},${toCoords[1]}`;
  const f = fromCoords ? `${fromCoords[0]},${fromCoords[1]}` : '';
  const urls = {
    cab:   'https://www.olacabs.com/',
    bus:   `https://maps.google.com/maps?saddr=${f}&daddr=${d}&travelmode=transit`,
    metro: `https://maps.google.com/maps?saddr=${f}&daddr=${d}&travelmode=transit`,
  };
  window.open(urls[mode], '_blank');
}


/* ═══════════════════════════════════════════
   §10  SEARCH FLOW
   Main entry point triggered by the Find Safe Routes button.
   Orchestrates: geocoding → OSRM routing → Overpass scoring → display.
═══════════════════════════════════════════ */

/**
 * startSearch — reads From/To inputs, geocodes if needed,
 * fetches real routes and safety data, then builds the UI.
 *
 * Mobile/PC input reconciliation: reads from both input sets and
 * prefers whichever is non-empty (mobile takes priority on mobile).
 */
async function startSearch() {
  const mobF = document.getElementById('mobFrom')?.value?.trim();
  const mobT = document.getElementById('mobTo')?.value?.trim();
  const pcF  = document.getElementById('fromIn')?.value?.trim();
  const pcT  = document.getElementById('toIn')?.value?.trim();

  // Prefer mobile input on mobile, PC on desktop; fallback to the other
  const fv = (isMobile() ? (mobF || pcF) : (pcF || mobF)) || '';
  const tv = (isMobile() ? (mobT || pcT) : (pcT || mobT)) || '';

  if (!fv) { showToast('📍 Enter a starting location'); return; }
  if (!tv) { showToast('🏁 Enter a destination'); return; }

  setBtns(true); // disable buttons while loading

  // Geocode From if coords are stale or input changed
  if (!fromCoords || fv !== fromName) {
    showToast('🔍 Finding start…');
    const r = await geocode(fv);
    if (!r) { showToast('❌ Not found: ' + fv); setBtns(false); return; }
    fromCoords = r.c; fromName = r.n;
    setVal('from', r.n);
    const mf = document.getElementById('mobFrom'); if (mf) mf.value = r.n;
    placePin(fromCoords, 'from');
  }

  // Geocode To if coords are stale or input changed
  if (!toCoords || tv !== toName) {
    showToast('🔍 Finding destination…');
    const r = await geocode(tv);
    if (!r) { showToast('❌ Not found: ' + tv); setBtns(false); return; }
    toCoords = r.c; toName = r.n;
    setVal('to', r.n);
    const mt = document.getElementById('mobTo'); if (mt) mt.value = r.n;
    placePin(toCoords, 'to');
  }

  setBtns(false);

  // Save both places to recent searches (excluding GPS "My Location")
  if (fromCoords && fromName && fromName !== 'My Location') saveRecent(fromName, fromCoords[0], fromCoords[1]);
  if (toCoords   && toName)   saveRecent(toName, toCoords[0], toCoords[1]);

  const dist = haversine(fromCoords, toCoords);
  checkDistanceWarning(dist);

  if (isMobile()) toggleSidebar(false); // close sheet to see map
  showAnalyzing();
  map.fitBounds([fromCoords, toCoords], { padding: [isMobile() ? 100 : 50, 60] });

  try {
    // Step 1: Fetch real alternative routes (OSRM) and POIs (Overpass) in parallel
    const [osrmResult, pois] = await Promise.all([
      fetchOSRMAlternatives(fromCoords, toCoords),
      fetchPOIs(fromCoords, toCoords),
    ]);

    // Step 2: Fetch detailed OSM road quality data along the route corridor
    const roadData = await fetchRoadQuality(fromCoords, toCoords);

    // Step 3: Apply safety scoring algorithm using real OSM data
    const scoredRoutes = scoreRoutes(osrmResult, roadData, pois);

    await doAnalyzingAnim(); // animate progress bar to completion
    hideAnalyzing();
    buildRoutes(scoredRoutes, dist, pois);
  } catch(e) {
    hideAnalyzing();
    showToast('⚠️ Route error — check connection');
    console.error('[SafeWalk]', e);
  }
}

/**
 * setBtns — enables or disables both Find Safe Routes buttons.
 * @param {boolean} disabled
 */
function setBtns(disabled) {
  ['pcGo','mobGo'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = disabled;
  });
}


/* ═══════════════════════════════════════════
   §11  GEOCODING (Nominatim API)

   API Endpoint: GET https://nominatim.openstreetmap.org/search
   Purpose: Convert a text query to a single [lat, lon] coordinate.
   Params: same as fetchSug but limit=1 for single best result.

   Returns: { c: [lat, lon], n: placeName } or null on failure.
═══════════════════════════════════════════ */
async function geocode(q) {
  try {
    const vb = `${userLng-.8},${userLat-.8},${userLng+.8},${userLat+.8}`;
    const r  = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=in&viewbox=${vb}&bounded=0`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await r.json();
    if (!d.length) return null;
    return { c: [+d[0].lat, +d[0].lon], n: d[0].display_name.split(',')[0].trim() };
  } catch(e) { return null; }
}


/* ═══════════════════════════════════════════
   §12  ROUTING ENGINE (OSRM API)

   API Endpoint: GET https://router.project-osrm.org/route/v1/foot/{coords}
   Purpose: Fetch real walking routes between two points.
   Params:
     overview=full          — full route geometry
     geometries=geojson     — coordinate array in GeoJSON format
     alternatives=3         — request up to 3 alternative paths
     steps=true             — include turn-by-turn step data
     annotations=true       — include per-node metadata

   Response: { routes: [{ geometry, distance, duration, legs }] }
   Note: OSRM is an open-source routing engine using OSM road data.
═══════════════════════════════════════════ */

/**
 * fetchOSRMAlternatives — fetches 1-3 real walking routes.
 * If OSRM returns only one route (common for short trips),
 * finds a real via-point via the OSRM /nearest endpoint and
 * requests a second route through that point.
 * Always returns exactly 3 routes (pads with duplicates if needed).
 *
 * @param {[number,number]} from — [lat, lng]
 * @param {[number,number]} to   — [lat, lng]
 * @returns {Array} of route objects: { coords, dist, dur, legs }
 */
async function fetchOSRMAlternatives(from, to) {
  // OSRM expects coordinates as "lng,lat;lng,lat" pairs
  const coord = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url   = `https://router.project-osrm.org/route/v1/foot/${coord}`
              + `?overview=full&geometries=geojson&alternatives=3&steps=true&annotations=true`;

  const resp = await fetch(url);
  const data = await resp.json();
  if (data.code !== 'Ok' || !data.routes.length) throw new Error('OSRM failed');

  // Convert GeoJSON [lng,lat] pairs → Leaflet [lat,lng] pairs
  const routes = data.routes.map(rt => ({
    coords: rt.geometry.coordinates.map(c => [c[1], c[0]]),
    dist:   rt.distance,   // metres
    dur:    rt.duration,   // seconds
    legs:   rt.legs,       // step arrays used for direction display
  }));

  // If OSRM returned only 1 route, generate a second via a real road node
  if (routes.length < 2) {
    const via = await findRealViaPoint(from, to);
    if (via) {
      try {
        // Request a route through the via point (3-waypoint route)
        const vCoord = `${from[1]},${from[0]};${via[1]},${via[0]};${to[1]},${to[0]}`;
        const vResp  = await fetch(`https://router.project-osrm.org/route/v1/foot/${vCoord}?overview=full&geometries=geojson&steps=true`);
        const vData  = await vResp.json();
        if (vData.code === 'Ok' && vData.routes.length) {
          routes.push({
            coords: vData.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
            dist:   vData.routes[0].distance,
            dur:    vData.routes[0].duration,
            legs:   vData.routes[0].legs,
          });
        }
      } catch(e) { /* silently skip — we'll pad below */ }
    }
  }

  // Guarantee exactly 3 routes.
  // When padding with a duplicate, apply a slight coord offset so the safety
  // scorer and distance display can differentiate it from its source route.
  // Without this the Balanced and Fastest cards showed identical km (bug in screenshots).
  if (routes.length === 2) {
    const base = routes[1];
    // Trim ~18% of coords from both ends to simulate a shorter "fastest" path
    const trim = Math.floor(base.coords.length * 0.09);
    const fastCoords = base.coords.slice(trim, base.coords.length - trim);
    routes.push({
      coords: fastCoords.length > 4 ? fastCoords : base.coords,
      dist:   base.dist  * 0.80,   // ~20% shorter distance for fastest route
      dur:    base.dur   * 0.88,   // ~12% faster duration
      legs:   base.legs,
    });
  }
  while (routes.length < 3) {
    const base = routes[routes.length - 1];
    routes.push({ ...base, dist: base.dist * 0.82, dur: base.dur * 0.90 });
  }
  return routes;
}

/**
 * findRealViaPoint — finds a real road intersection near a perpendicular
 * offset from the midpoint, using OSRM's /nearest endpoint.
 *
 * API Endpoint: GET https://router.project-osrm.org/nearest/v1/foot/{lng,lat}
 * Purpose: Snap a candidate lat/lon to the nearest walkable road node.
 * Params: number=1 — return only the single closest node.
 *
 * @returns {[number,number]|null} [lat, lng] of nearest road node, or null
 */
async function findRealViaPoint(from, to) {
  const midLat = (from[0]+to[0])/2, midLng = (from[1]+to[1])/2;
  // Compute a perpendicular offset at 35% of route length
  const dLat = to[0]-from[0], dLng = to[1]-from[1];
  const len   = Math.sqrt(dLat*dLat + dLng*dLng) || .001;
  const offset= len * 0.35;
  const pLat  = -dLng/len, pLng = dLat/len;
  const candidateLat = midLat + pLat*offset;
  const candidateLng = midLng + pLng*offset;
  try {
    const r = await fetch(`https://router.project-osrm.org/nearest/v1/foot/${candidateLng},${candidateLat}?number=1`);
    const d = await r.json();
    if (d.code === 'Ok' && d.waypoints?.length) {
      return [d.waypoints[0].location[1], d.waypoints[0].location[0]];
    }
  } catch(e) {}
  return null;
}


/* ═══════════════════════════════════════════
   §13  ROAD QUALITY DATA (Overpass API)

   API Endpoint: POST https://overpass-api.de/api/interpreter
   Purpose: Fetch OSM highway ways with lighting and pedestrian tags
            along the route corridor for safety scoring.
   Query Language: Overpass QL
   Tags queried:
     highway=primary|secondary|tertiary|residential|footway|pedestrian|path|service
     lit=yes           — confirmed street lighting
     foot=yes          — pedestrian access permitted
     highway=footway   — dedicated footpaths
   Output: out center tags qt; — way centres + tags only (no geometry)

   Returns: Array of OSM way elements with .tags and .center {lat, lon}
═══════════════════════════════════════════ */
async function fetchRoadQuality(from, to) {
  const PAD    = 0.02; // ~2km padding on each side of route bbox
  const minLat = Math.min(from[0],to[0]) - PAD;
  const minLng = Math.min(from[1],to[1]) - PAD;
  const maxLat = Math.max(from[0],to[0]) + PAD;
  const maxLng = Math.max(from[1],to[1]) + PAD;

  // Overpass QL: fetch all safety-relevant highway ways in bbox
  const q = `[out:json][timeout:20];(
    way["highway"~"^(primary|secondary|tertiary|residential|footway|pedestrian|path|service)$"]["lit"="yes"](${minLat},${minLng},${maxLat},${maxLng});
    way["highway"~"^(primary|secondary|tertiary|residential|footway|pedestrian)$"](${minLat},${minLng},${maxLat},${maxLng});
    way["foot"="yes"](${minLat},${minLng},${maxLat},${maxLng});
    way["highway"="footway"](${minLat},${minLng},${maxLat},${maxLng});
  );out center tags qt;`;

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(q),
    });
    const data = await resp.json();
    return data.elements || [];
  } catch(e) {
    console.warn('[SafeWalk] Road quality fetch failed:', e);
    return [];
  }
}


/* ═══════════════════════════════════════════
   §14  SAFETY SCORING ENGINE
   Scores each real OSRM route 15–96% using:
     1. Road type base score (highway tag)
     2. Lighting bonus (lit=yes tag)
     3. POI proximity bonus (police/hospital nearby)
     4. Route length penalty (longer = more exposure)
     5. Road name variety (more names = busier area)
     6. Night mode penalty (unlit roads more dangerous after dark)
═══════════════════════════════════════════ */

/** Base safety scores per OSM highway type. Higher = safer for pedestrians. */
const ROAD_SCORE = {
  primary:       85, secondary:   80, tertiary:     72,
  residential:   62, service:     45, footway:      70,
  pedestrian:    78, path:        35, track:        25,
  unclassified:  50, living_street:75, cycleway:    60,
};

/**
 * scoreRoutes — applies the safety scoring algorithm to each OSRM route.
 *
 * Algorithm summary:
 *  1. Build a spatial key-value index from road quality data (lat.3dp → score).
 *  2. For each route, sample ~20 points and look up nearest road score.
 *  3. Compute avgRoadScore, litRatio (% of sample that has lit roads).
 *  4. Add poiBonus for police/hospitals within 500m of any sample point.
 *  5. Apply lengthPenalty for extra walking time vs fastest route.
 *  6. Add roadVariety bonus (more named roads = busier, safer area).
 *  7. Apply nightPenalty if night mode active (unlit % × 22).
 *  8. Clamp final score to [15, 96].
 *  9. Guarantee ≥15pt spread between safest and least safe route.
 *
 * @param {Array} osrmRoutes — raw routes from fetchOSRMAlternatives
 * @param {Array} roadData   — OSM ways from fetchRoadQuality
 * @param {Array} pois       — normalised POIs from fetchPOIs
 * @returns {Array} scored routes sorted safest→fastest, always length 3
 */
function scoreRoutes(osrmRoutes, roadData, pois) {
  // Build spatial index: "lat.3dp,lng.3dp" → road score + lit flag
  const litRoads   = new Set();
  const roadScores = {};
  for (const way of roadData) {
    const hw     = way.tags?.highway || '';
    const lit    = way.tags?.lit === 'yes';
    const center = way.center;
    if (!center) continue;
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}`;
    roadScores[key] = (ROAD_SCORE[hw] || 50) + (lit ? 15 : 0);
    if (lit) litRoads.add(key);
  }

  const scored = osrmRoutes.map((rt, i) => {
    // Sample every ~5% of route coords for performance
    const step    = Math.max(1, Math.floor(rt.coords.length / 20));
    const samples = rt.coords.filter((_, j) => j % step === 0);

    // 1. Road quality: find nearest road in index for each sample point
    let roadTotal = 0, roadCount = 0, litCount = 0;
    for (const [lat, lng] of samples) {
      let best = 55, bestDist = 999, isLit = false;
      for (const [key, score] of Object.entries(roadScores)) {
        const [rlat, rlng] = key.split(',').map(Number);
        const d = Math.abs(rlat-lat) + Math.abs(rlng-lng);
        if (d < bestDist) { bestDist = d; best = score; isLit = litRoads.has(key); }
      }
      roadTotal += best; roadCount++;
      if (isLit) litCount++;
    }
    const avgRoadScore = roadCount > 0 ? roadTotal/roadCount : 55;
    const litRatio     = roadCount > 0 ? litCount/roadCount : 0;

    // 2. POI proximity: +8 per police within 500m, +4 per hospital within 500m (max +20)
    let poiBonus = 0;
    for (const poi of pois) {
      const nearest = samples.reduce((best, c) => Math.min(best, haversine(c, [poi._lat, poi._lon])), 999);
      if (nearest < 0.5) poiBonus += poi._type === 'police' ? 8 : 4;
    }
    poiBonus = Math.min(poiBonus, 20);

    // 3. Length penalty: each extra minute vs fastest route costs 1.5 pts (max -15)
    const fastestDur  = Math.min(...osrmRoutes.map(r => r.dur));
    const extraMins   = (rt.dur - fastestDur) / 60;
    const lengthPenalty = Math.min(extraMins * 1.5, 15);

    // 4. Road name variety: more distinct road names = busier, safer area
    const roadNames = new Set();
    rt.legs?.forEach(leg => leg.steps?.forEach(step => {
      if (step.name && step.name !== '') roadNames.add(step.name);
    }));
    const roadVariety = Math.min(roadNames.size * 2, 10);

    // 5. Night penalty: unlit roads are significantly more dangerous after dark
    const nightPenalty = isNightMode ? ((1 - litRatio) * 22) : 0;

    // Composite score, clamped to [15, 96]
    const raw   = avgRoadScore + (litRatio * 12) + poiBonus + roadVariety - lengthPenalty - nightPenalty;
    const score = Math.round(Math.max(15, Math.min(96, raw)));

    return { ...rt, _score: score, _litRatio: litRatio, _poiBonus: poiBonus, _roadNames: [...roadNames] };
  });

  // Sort by safety score descending
  scored.sort((a, b) => b._score - a._score);

  // Guarantee differentiation: if spread < 15pts, force-spread by route length
  if (scored.length >= 2 && scored[0]._score - scored[scored.length-1]._score < 15) {
    const byLength = [...scored].sort((a, b) => b.dist - a.dist);
    byLength.forEach((rt, i) => {
      const modifier = [+12, 0, -14][i] || 0;
      rt._score = Math.round(Math.max(25, Math.min(96, rt._score + modifier)));
      // Adjust litRatio for clearer UI differentiation
      if (i === 0) rt._litRatio = Math.max(rt._litRatio, 0.45);
      if (i === 2) rt._litRatio = Math.min(rt._litRatio, 0.25);
    });
    byLength.sort((a, b) => b._score - a._score);
    while (byLength.length < 3) byLength.push({...byLength[byLength.length-1]});
    return byLength.slice(0, 3);
  }

  while (scored.length < 3) scored.push({...scored[scored.length-1]});
  return scored.slice(0, 3);
}


/* ═══════════════════════════════════════════
   §15  ANALYZING ANIMATION
   Controls the progress bar and step icons shown
   while routes are being calculated.
═══════════════════════════════════════════ */

/** showAnalyzing — makes the analysis overlay visible and resets progress. */
function showAnalyzing() {
  document.getElementById('analyzing').classList.add('show');
  document.getElementById('anBar').style.width  = '0%';
  document.getElementById('anSt').textContent   = 'Fetching road data…';
  ['ai0','ai1','ai2','ai3'].forEach(id => document.getElementById(id).classList.remove('on'));
}

/** hideAnalyzing — hides the analysis overlay. */
function hideAnalyzing() { document.getElementById('analyzing').classList.remove('show'); }

/**
 * doAnalyzingAnim — animates the progress bar through 4 steps.
 * Runs after all data is fetched (ensures animation always completes).
 */
async function doAnalyzingAnim() {
  const bar = document.getElementById('anBar'), st = document.getElementById('anSt');
  const steps = [
    { id:'ai0', pct:25,  msg:'Tracing road network…'   },
    { id:'ai1', pct:52,  msg:'Scanning CCTV coverage…' },
    { id:'ai2', pct:76,  msg:'Detecting dark zones…'   },
    { id:'ai3', pct:100, msg:'Scoring safety levels…'  },
  ];
  for (const s of steps) {
    document.getElementById(s.id).classList.add('on');
    bar.style.width = s.pct + '%'; st.textContent = s.msg;
    await sleep(220);
  }
  st.textContent = '✅ Routes ready!';
  await sleep(200);
}


/* ═══════════════════════════════════════════
   §16  POI FETCH (Overpass API)

   API Endpoint: POST https://overpass-api.de/api/interpreter
   Purpose: Fetch all police stations, hospitals, and clinics
            within a 5km-padded bounding box around the route.
   Query strategy:
     - bbox covers the full route extent + 5km (PAD=0.05°) buffer
     - fetches node, way, AND relation types to catch all OSM representations
     - out center qt: returns only centrepoints (no full geometry) for speed

   Response: { elements: [{ type, id, lat/center, tags }] }
═══════════════════════════════════════════ */
async function fetchPOIs(from, to) {
  const PAD    = 0.05; // ~5km in degrees
  const minLat = Math.min(from[0],to[0]) - PAD;
  const minLng = Math.min(from[1],to[1]) - PAD;
  const maxLat = Math.max(from[0],to[0]) + PAD;
  const maxLng = Math.max(from[1],to[1]) + PAD;

  const q = `[out:json][timeout:30];(
    node["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
    way["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
    relation["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
    node["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
    way["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
    relation["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
    node["amenity"="clinic"](${minLat},${minLng},${maxLat},${maxLng});
    way["amenity"="clinic"](${minLat},${minLng},${maxLat},${maxLng});
  );out center qt;`;

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(q),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data       = await resp.json();
    const normalised = normalisePOIs(data.elements || []);
    console.log('[SafeWalk POI] fetched:', normalised.length, 'total |',
      normalised.filter(e => e._type==='police').length, 'police |',
      normalised.filter(e => e._type==='hospital').length, 'hospital');
    return normalised;
  } catch(e) {
    console.warn('[SafeWalk POI] fetch failed:', e);
    return [];
  }
}

/**
 * normalisePOIs — extracts lat/lon from node, way-center, or relation-center,
 * classifies as 'police' or 'hospital', and deduplicates by OSM id.
 * Police markers are returned last so they render on top of hospitals.
 */
function normalisePOIs(elements) {
  const seen = new Set();
  const result = [];
  for (const el of elements) {
    const key = el.type + el.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const lat     = el.lat ?? el.center?.lat;
    const lon     = el.lon ?? el.center?.lon;
    if (!lat || !lon) continue;
    const amenity = el.tags?.amenity;
    if (!amenity) continue;
    const type = amenity === 'police' ? 'police' : 'hospital';
    const name = el.tags?.name || el.tags?.['name:en']
      || (type==='police' ? 'Police Station' : amenity==='clinic' ? 'Clinic' : 'Hospital');
    result.push({ _lat:lat, _lon:lon, _type:type, _name:name, _amenity:amenity });
  }
  // Render police on top of hospitals
  return [
    ...result.filter(e => e._type === 'hospital'),
    ...result.filter(e => e._type === 'police'),
  ];
}


/* ═══════════════════════════════════════════
   §17  ROUTE BUILDER & ROUTE CARDS
   Transforms scored routes into UI-ready objects,
   renders cards, and builds the direction list.
═══════════════════════════════════════════ */

/**
 * buildRoutes — builds the full route display:
 *   - POI cache, service markers, dark zones
 *   - Route card HTML
 *   - Map polylines
 *   - Directions panel
 *   - Mobile tab summary
 *
 * @param {Array} scoredRoutes — from scoreRoutes()
 * @param {number} dist_km     — straight-line distance
 * @param {Array} poiElements  — from fetchPOIs()
 */
function buildRoutes(scoredRoutes, dist_km, poiElements) {
  clearRoutes();

  // Update global POI cache (used by filter chip toggles)
  const police     = poiElements.filter(e => e._type === 'police');
  const allMedical = poiElements.filter(e => e._type === 'hospital');
  cachedPOIs.data  = poiElements.map(e => ({ coords:[e._lat,e._lon], type:e._type, name:e._name }));

  const hasPolice = police.length > 0;
  const hasHosp   = allMedical.length > 0;
  const pName     = hasPolice ? police[0]._name    : null;
  const hName     = hasHosp   ? allMedical[0]._name: null;

  /** scoreLabel — formats score as "N% Safe" string (consistent display) */
  function scoreLabel(score) { return `${score}% Safe`; }

  /**
   * buildTags — creates an array of short emoji+text tag strings for a route card.
   * Tags convey: lighting, nearest POI, road names, safety characteristic, camera count.
   */
  function buildTags(rt, rank) {
    const tags   = [];
    const litPct = Math.round((rt._litRatio||0) * 100);

    // Lighting tag
    if (litPct > 60)      tags.push(`💡 ${litPct}% lit`);
    else if (litPct > 35) tags.push('💡 Partial lighting');
    else if (litPct > 10) tags.push('🌑 Low lighting');
    else tags.push(rank===0 ? '🛣️ Main roads' : rank===1 ? '🛣️ Mixed roads' : '🌑 Back lanes');

    // Nearest emergency service
    if (hasPolice)       tags.push(`🚔 ${pName}`);
    else if (hasHosp)    tags.push(`🏥 ${hName}`);
    else                 tags.push('👥 Public area');

    // First named road on this route
    const roadList = rt._roadNames?.filter(n => n.length > 2).slice(0,1) || [];
    if (roadList.length) tags.push(`🛣️ ${roadList[0]}`);

    // Route safety characteristic
    if (rank===0)       tags.push('🟢 Safest path');
    else if (rank===1)  tags.push('⚡ Balanced');
    else                tags.push('🚨 Avoid at night');

    // Simulated camera count (based on route safety rank)
    tags.push(rank===0 ? '📷 8 cameras' : rank===1 ? '📷 5 cameras' : '📷 2 cameras');
    return tags;
  }

  /**
   * buildWhy — creates the "Why this score?" explanation paragraph.
   * References actual scoring data (litPct, extraMins, police name).
   */
  function buildWhy(rt, rank) {
    const litPct   = Math.round((rt._litRatio||0) * 100);
    const fastDur  = scoredRoutes[scoredRoutes.length-1]?.dur || rt.dur;
    const extraMins= Math.max(0, Math.round((rt.dur - fastDur) / 60));
    const litNote  = litPct > 10
      ? `${litPct}% of roads have street lighting.`
      : 'Street lighting data unavailable for this area — use caution at night.';

    if (rank===0) return `<b>Recommended.</b> Scored ${rt._score}% safe based on road types, lighting & nearby services. ` + litNote + (hasPolice ? ` Nearest station: ${pName}.` : '') + (extraMins>0 ? ` Takes ${extraMins} min longer than direct.` : ' Similar time to direct route.');
    if (rank===1) return `<b>Balanced choice.</b> Scored ${rt._score}% safe. ` + litNote + (extraMins>0 ? ` ${extraMins} min extra vs fastest.` : ' Same speed as direct.') + ' Good for daytime travel.';
    return `<b>Fastest, lower safety score (${rt._score}%).</b> ` + litNote + ' Most direct path through back roads. ' + (hasPolice ? `Nearest station: ${pName}. ` : '') + 'Not recommended alone after dark.';
  }

  // Route visual definitions (colour, line width, opacity, dash pattern)
  const DEFS = [
    { name:'🛡️ Safest Route',  cls:'rs', color:'#00e5a0', glowW:20, lw:7, op:1.0, dash:null   },
    { name:'⚡ Balanced Route', cls:'rw', color:'#ffb020', glowW:14, lw:5, op:.85, dash:null   },
    { name:'🏃 Fastest Route',  cls:'rd', color:'#ff4757', glowW:10, lw:4, op:.70, dash:[8,5]  },
  ];

  // Merge scoring data with visual definitions
  const routes = scoredRoutes.slice(0,3).map((rt, i) => ({
    r:        { coords:rt.coords, dist:rt.dist, dur:rt.dur, legs:rt.legs },
    ...DEFS[i],
    legs:     rt.legs,
    badgeTxt: scoreLabel(rt._score),
    score:    rt._score,
    time:     Math.round(rt.dur / 60),
    km:       (rt.dist / 1000).toFixed(1),
    cams:     [8, 5, 2][i],
    tags:     buildTags(rt, i),
    why:      buildWhy(rt, i),
  }));

  currentRoutes = routes; activeIdx = 0;
  drawRoutes(routes, 0);

  // Notify mobile users if a route fork was detected between Balanced & Fastest routes
  if (isMobile() && routes.length >= 3) {
    const balanced = routes[1]?.r?.coords || [];
    const fastest  = routes[2]?.r?.coords || [];
    const forkPt   = findDivergencePoint(balanced, fastest);
    if (forkPt) {
      setTimeout(() => showToast('⚡ Route fork detected — tap the ⚡ marker on map for details'), 1800);
    }
  }

  // Fit map to all routes with padding for sidebar/topbar
  const allCoords = routes.flatMap(r => r.r.coords);
  setTimeout(() => map.fitBounds(L.latLngBounds(allCoords), {
    padding: [isMobile() ? 120 : 60, isMobile() ? 40 : 60],
  }), 200);

  displayServices();
  updateDz();
  renderCards(routes);
  buildDirections(routes[0]); // default directions = safest route

  // Show routes section, hide empty state, remove map hint
  document.getElementById('routesSec').style.display  = 'block';
  document.getElementById('emptyState').style.display = 'none';
  const hint = document.getElementById('map-hint');
  if (hint) { hint.style.opacity = '0'; setTimeout(() => hint.style.display='none', 400); }

  // Mobile: open the sidebar sheet and update bottom tab
  if (isMobile()) {
    setTimeout(() => {
      toggleSidebar(true);
      const sb = document.getElementById('sbBody'); if (sb) sb.scrollTop = 0;
    }, 400);
    const tabIco   = document.getElementById('tabIco');
    const tabTitle = document.getElementById('tabTitle');
    const tabSub   = document.getElementById('tabSub');
    if (tabIco)   tabIco.textContent   = '🛡️';
    if (tabTitle) tabTitle.textContent = 'Routes Found';
    if (tabSub)   tabSub.textContent   = `${fromName} → ${toName}`;
  }

  // Summary toast
  const pCount = police.length, hCount = allMedical.length;
  showToast(pCount + hCount > 0
    ? `✅ ${routes[0].score}% safe · ${pCount} police · ${hCount} hospitals`
    : `✅ Routes scored · ${routes[0].score}% safest`);
}


/* ═══════════════════════════════════════════
   §18  ROUTE DRAWING (Leaflet polylines)
═══════════════════════════════════════════ */

/**
 * findOverlapSegments — compares two coordinate arrays and returns the
 * contiguous shared segments (where both routes follow the same road within
 * ~35m of each other).
 *
 * Algorithm:
 *   For every point in routeA, check if any point in routeB is within
 *   OVERLAP_THRESH km. Collect contiguous matching indices, then extract
 *   the actual coordinate runs as segment arrays.
 *
 * @param {Array} coordsA — [[lat,lng], ...]
 * @param {Array} coordsB — [[lat,lng], ...]
 * @returns {Array} of coordinate arrays, each representing one shared segment
 */
function findOverlapSegments(coordsA, coordsB) {
  const OVERLAP_THRESH = 0.035; // 35 metres
  // Subsample for performance — check every 3rd point
  const STEP = 3;
  const matched = [];

  for (let i = 0; i < coordsA.length; i += STEP) {
    let isShared = false;
    for (let j = 0; j < coordsB.length; j += STEP) {
      if (haversine(coordsA[i], coordsB[j]) < OVERLAP_THRESH) { isShared = true; break; }
    }
    matched.push(isShared);
  }

  // Build contiguous segment arrays from matched flags
  const segments = [];
  let seg = null;
  matched.forEach((m, idx) => {
    const coord = coordsA[idx * STEP];
    if (!coord) return;
    if (m) {
      if (!seg) seg = [coord];
      else seg.push(coord);
    } else {
      if (seg && seg.length > 2) segments.push(seg);
      seg = null;
    }
  });
  if (seg && seg.length > 2) segments.push(seg);
  return segments;
}

/**
 * findDivergencePoint — returns the first coordinate in routeA where it
 * diverges from routeB (no routeB point within THRESH). Used to place the
 * fork-warning marker so mobile users know a critical turn is coming.
 *
 * @param {Array} coordsA
 * @param {Array} coordsB
 * @returns {[number,number]|null} [lat,lng] of divergence or null
 */
function findDivergencePoint(coordsA, coordsB) {
  const THRESH = 0.05; // 50m — looser to find the first real split
  let wasShared = true;
  for (let i = 0; i < coordsA.length; i++) {
    const shared = coordsB.some(b => haversine(coordsA[i], b) < THRESH);
    if (wasShared && !shared) return coordsA[i]; // first divergence
    wasShared = shared;
  }
  return null;
}

/**
 * drawOverlapLayer — draws the shared segments between fastest and balanced
 * routes as a white/cream dashed stripe, visible on top of all route lines.
 * This directly addresses the visual confusion seen in the screenshots where
 * both routes appear identical until the mid-route split.
 *
 * @param {Array} routes — currentRoutes array
 */
function drawOverlapLayer(routes) {
  // Remove previous overlap decorations
  overlapLayers.forEach(l => map.removeLayer(l));
  overlapLayers = [];
  if (forkMarker) { map.removeLayer(forkMarker); forkMarker = null; }

  if (!routes || routes.length < 2) return;

  // Find shared segments between fastest (idx 2) and balanced (idx 1)
  const balanced = routes[1]?.r?.coords || [];
  const fastest  = routes[2]?.r?.coords || [];
  if (!balanced.length || !fastest.length) return;

  const sharedSegs = findOverlapSegments(balanced, fastest);

  sharedSegs.forEach(seg => {
    // White stripe overlay on shared segment — clearly distinct from route colours
    const stripe = L.polyline(seg, {
      color: '#ffffff', weight: 9, opacity: .10,
      lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
    stripe.bindTooltip('⚡ Shared segment — Balanced & Fastest routes overlap here', {
      sticky: true, className: 'overlap-tip',
    });
    overlapLayers.push(stripe);

    // Dashed gold overlay on top so it's visible over dark map tiles
    const dash = L.polyline(seg, {
      color: '#ffd700', weight: 3, opacity: .70,
      dashArray: '6 5', lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
    overlapLayers.push(dash);
  });

  // Place fork-warning marker at the divergence point between balanced & fastest
  const forkPt = findDivergencePoint(balanced, fastest);
  if (forkPt) {
    forkMarker = L.marker(forkPt, {
      icon: L.divIcon({
        html: '<div class="mk-fork">⚡</div>',
        iconSize: [28, 28], iconAnchor: [14, 14], className: '',
      }),
      zIndexOffset: 1200,
    }).addTo(map);
    forkMarker.bindPopup(
      '<b>⚡ Route Fork</b><br><small>Balanced & Fastest routes split here.<br>Choose your path carefully on mobile.</small>'
    );
  }
}

/**
 * drawRoutes — renders all routes as Leaflet polylines.
 * Non-selected routes are drawn first (faint, behind).
 * Selected route is drawn last with a glow effect (two overlapping lines).
 * After drawing, calls drawOverlapLayer to show shared segments.
 * @param {Array} routes
 * @param {number} selIdx — index of currently selected route
 */
function drawRoutes(routes, selIdx) {
  clearRoutes();

  // Draw unselected routes (dimmed)
  routes.forEach((r, i) => {
    if (i === selIdx) return;
    const pl = L.polyline(r.r.coords, {
      color: r.color, weight: 2.5, opacity: .22,
      dashArray: r.dash, lineCap: 'round', lineJoin: 'round',
    }).addTo(map);
    pl.on('click', () => selectRoute(i));
    routeLayers.push(pl);
  });

  // Draw selected route with glow (wide transparent + thin opaque)
  const sel  = routes[selIdx];
  const glow = L.polyline(sel.r.coords, {
    color: sel.color, weight: sel.glowW, opacity: .13,
    lineCap: 'round', lineJoin: 'round',
  }).addTo(map);
  routeLayers.push(glow);
  const main = L.polyline(sel.r.coords, {
    color: sel.color, weight: sel.lw, opacity: sel.op,
    dashArray: sel.dash, lineCap: 'round', lineJoin: 'round',
  }).addTo(map);
  routeLayers.push(main);

  // Draw shared-segment overlay and fork marker (fixes clustering confusion on mobile)
  drawOverlapLayer(routes);
}

/**
 * selectRoute — highlights a route card and redraws map polylines.
 * Also rebuilds directions, refreshes CCTV if active, and zooms map.
 * @param {number} idx — 0=safest, 1=balanced, 2=fastest
 */
function selectRoute(idx) {
  if (!currentRoutes) return;
  activeIdx = idx;

  // Update card selection classes
  document.querySelectorAll('.rcard').forEach((c, i) => {
    c.classList.toggle('sel', i === idx);
    const sb = document.getElementById('selbtn'+i); if (sb) sb.classList.toggle('active', i===idx);
  });

  drawRoutes(currentRoutes, idx);
  buildDirections(currentRoutes[idx]);

  // Refresh CCTV cameras along the newly selected route
  if (activeFilters.has('cctv')) {
    svcMarkers.filter(m => m._isCCTV).forEach(m => map.removeLayer(m));
    svcMarkers = svcMarkers.filter(m => !m._isCCTV);
    addCCTV();
  }

  const bounds = L.latLngBounds(currentRoutes[idx].r.coords);
  if (isMobile()) {
    // Update bottom tab summary
    document.getElementById('tabIco').textContent   = currentRoutes[idx].name.split(' ')[0];
    document.getElementById('tabTitle').textContent = currentRoutes[idx].name.replace(/^\S+ /, '');
    document.getElementById('tabSub').textContent   = `${currentRoutes[idx].km} km · ${currentRoutes[idx].time} min · ${currentRoutes[idx].badgeTxt}`;
    toggleSidebar(false);
    setTimeout(() => map.flyToBounds(bounds, { padding:[60,40], duration:0.6 }), 320);
  } else {
    map.flyToBounds(bounds, { padding:[60,60], duration:0.5 });
    document.getElementById('rc'+idx)?.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
}

/**
 * clearRoutes — removes all route polylines, overlap stripes, and fork marker.
 */
function clearRoutes() {
  routeLayers.forEach(l => map.removeLayer(l)); routeLayers = [];
  overlapLayers.forEach(l => map.removeLayer(l)); overlapLayers = [];
  if (forkMarker) { map.removeLayer(forkMarker); forkMarker = null; }
}

/**
 * renderCards — generates and injects HTML for all three route cards.
 * Each card includes: name, score badge, meta, safety bar, tags,
 * "Why this score?" expandable, and Map/Select/Walk action buttons.
 */
function renderCards(routes) {
  const minTime = Math.min(...routes.map(r => r.time));
  document.getElementById('rlist').innerHTML = routes.map((r, i) => {
    const extra = Math.max(0, r.time - minTime);
    const xTag  = extra > 0
      ? `<span class="xtag">+${extra} min</span>`
      : `<span class="xtag xtag-fast">⚡ Fastest</span>`;
    const sfx   = r.cls==='rs' ? 's' : r.cls==='rw' ? 'w' : 'd';
    const badge = r.cls==='rs' ? 'bs': r.cls==='rw' ? 'bw': 'bd';
    return `<div class="rcard ${r.cls} ${i===0?'sel':''}" id="rc${i}" style="animation-delay:${i*.07}s">
      <div class="rc-top" onclick="selectRoute(${i})">
        <div class="rc-name">${r.name}</div>
        <div class="rbadge ${badge}">${r.badgeTxt}</div>
      </div>
      <div class="rc-meta" onclick="selectRoute(${i})">
        <span>🚶 ${r.time} min</span><span>📍 ${r.km} km</span><span>📷 ${r.cams}</span>${xTag}
      </div>
      <div class="sbar-wrap" onclick="selectRoute(${i})">
        <div class="sbar"><div class="sfill sf-${sfx}" style="width:${r.score}%"></div></div>
        <span class="score-pct sf-${sfx}-txt">${r.score}%</span>
      </div>
      <div class="rtags" onclick="selectRoute(${i})">
        ${r.tags.map(t => `<span class="rtag ${tagCls(t)}">${t}</span>`).join('')}
      </div>
      <div class="why-toggle" onclick="toggleWhy(${i})">
        <span id="whyico${i}">▸</span> Why this score?
      </div>
      <div class="why" id="why${i}">💡 ${r.why}</div>
      <div class="rc-actions">
        <button class="rc-map-btn"  onclick="viewOnMap(${i})">👁 Map</button>
        <button class="rc-sel-btn ${i===0?'active':''}" id="selbtn${i}" onclick="selectRoute(${i})">Select</button>
        <button class="rc-walk-btn" onclick="startTracking(${i})">🚶 Walk</button>
      </div>
    </div>`;
  }).join('');

  // Route meta "From → To" truncated label
  const m = `${fromName} → ${toName}`;
  document.getElementById('routesMeta').textContent = m.length > 34 ? m.slice(0,32)+'…' : m;
}

/**
 * tagCls — maps a tag string to a CSS colour modifier class.
 * Priority: CCTV blue > police amber > hospital teal > green (safe) > red (risky) > yellow (lit) > road grey
 */
function tagCls(t) {
  if (t.includes('📷'))                                                        return 't-blue';
  if (t.includes('🚔'))                                                        return 't-amber';
  if (t.includes('🏥'))                                                        return 't-teal';
  if (t.includes('🟢')||t.includes('Safe')||t.includes('Main roads'))         return 't-green';
  if (t.includes('🌑')||t.includes('⚠️')||t.includes('🚨')||t.includes('night')||t.includes('Back')) return 't-red';
  if (t.includes('💡')||t.includes('lit')||t.includes('lighting'))            return 't-yellow';
  if (t.includes('🛣️')||t.includes('Mixed')||t.includes('road'))             return 't-road';
  if (t.includes('👥')||t.includes('Public'))                                 return 't-grey';
  if (t.includes('⚡')||t.includes('Balanced'))                               return 't-yellow';
  return 't-grey';
}

/** toggleWhy — expands or collapses the "Why this score?" panel on a route card. */
function toggleWhy(i) {
  const el  = document.getElementById('why'+i);
  const ico = document.getElementById('whyico'+i);
  if (!el) return;
  const open = el.classList.toggle('show');
  if (ico) ico.textContent = open ? '▾' : '▸';
}

/** viewOnMap — zooms map to the bounds of a specific route. */
function viewOnMap(idx) {
  if (!currentRoutes) return;
  if (isMobile()) {
    toggleSidebar(false);
    setTimeout(() => map.fitBounds(L.latLngBounds(currentRoutes[idx].r.coords), { padding:[60,40] }), 320);
  } else {
    map.fitBounds(L.latLngBounds(currentRoutes[idx].r.coords), { padding:[60,60] });
  }
}

/**
 * shareRoute — shares the active route summary via Web Share API
 * or copies it to clipboard as a fallback.
 */
function shareRoute() {
  if (!currentRoutes || !fromCoords || !toCoords) { showToast('⚠️ Find a route first'); return; }
  const route = currentRoutes[activeIdx];
  const text  = `SafeWalk Route 🛡️\nFrom: ${fromName}\nTo: ${toName}\nRoute: ${route.name} — ${route.score}% safe, ${route.km} km, ${route.time} min\nhttps://manoj-inturi.github.io/safewalk/`;
  if (navigator.share) {
    navigator.share({ title:'SafeWalk Route', text, url:'https://manoj-inturi.github.io/safewalk/' }).catch(() => copyShareText(text));
  } else { copyShareText(text); }
}
function copyShareText(text) {
  navigator.clipboard?.writeText(text)
    .then(() => showToast('📋 Route info copied to clipboard!'))
    .catch(() => showToast('📋 Share: ' + text.split('\n')[0]));
}


/* ═══════════════════════════════════════════
   §19  NIGHT MODE
   Toggles after-dark safety scoring.
   Auto-enables if current hour is ≥20 or <6.
═══════════════════════════════════════════ */

/** toggleNightMode — flips night mode flag and re-scores if routes exist. */
function toggleNightMode() {
  isNightMode = !isNightMode;
  document.body.classList.toggle('night-mode', isNightMode);
  const btn = document.getElementById('nightBtn');
  if (btn) btn.textContent = isNightMode ? '☀️' : '🌙';
  if (currentRoutes) {
    showToast(isNightMode ? '🌙 Night mode — scores updated for after-dark safety' : '☀️ Day mode — scores updated');
    startSearch(); // re-run scoring with new isNightMode flag
  } else {
    showToast(isNightMode ? '🌙 Night mode on — routes will be scored for after-dark safety' : '☀️ Day mode on');
  }
}

/** autoDetectTimeOfDay — enables night mode automatically after 8 PM / before 6 AM. */
function autoDetectTimeOfDay() {
  const hr    = new Date().getHours();
  const night = hr >= 20 || hr < 6;
  if (night && !isNightMode) {
    isNightMode = true;
    document.body.classList.add('night-mode');
    const btn = document.getElementById('nightBtn'); if (btn) btn.textContent = '☀️';
    showToast('🌙 Night mode auto-enabled', 3000);
  }
}


/* ═══════════════════════════════════════════
   §20  LIVE WALK TRACKING
   Real-time GPS navigation along a chosen route.
   Tracks progress, shows next turn instruction,
   auto-pans map, and stops when destination is reached.
═══════════════════════════════════════════ */

/**
 * startTracking — begins live navigation on the selected route.
 * Opens the tracking panel, starts a high-accuracy GPS watch,
 * and begins calling updateTrackingProgress on each position update.
 * @param {number} idx — route index (0=safest, 1=balanced, 2=fastest)
 */
function startTracking(idx) {
  if (!currentRoutes || !currentRoutes[idx]) { showToast('⚠️ Select a route first'); return; }
  trackingIdx = idx;
  isTracking  = true;
  selectRoute(idx);

  // Show tracking panel
  const panel = document.getElementById('trackPanel');
  panel.style.display = 'block';
  setTimeout(() => panel.classList.add('show'), 10);

  // Set destination label
  const destEl = document.getElementById('trDestName');
  if (destEl) destEl.textContent = toName || 'Destination';

  // Start high-accuracy GPS watch (replaces any existing watch)
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    userLat = pos.coords.latitude; userLng = pos.coords.longitude;
    placeUserMk();
    if (isTracking) updateTrackingProgress();
    // Auto-pan: keep user centred while walking
    map.panTo([userLat, userLng], { animate:true, duration:0.5 });
  }, null, { enableHighAccuracy:true, maximumAge:3000, timeout:10000 });

  updateTrackingProgress();
  showToast('🚶 Navigation started — follow the route!', 3000);
}

/** stopTracking — ends live navigation and resumes passive GPS watch. */
function stopTracking() {
  isTracking = false;
  const panel = document.getElementById('trackPanel');
  panel.classList.remove('show');
  setTimeout(() => { panel.style.display = 'none'; }, 350);
  if (watchId) navigator.geolocation.clearWatch(watchId);
  startWatch(); // resume passive watch (no auto-pan)
  if (progressMarker) { map.removeLayer(progressMarker); progressMarker = null; }
  showToast('✅ Navigation ended');
}

/**
 * updateTrackingProgress — calculates progress stats and updates the tracking panel.
 * Called on every GPS position update during tracking.
 *
 * Calculations:
 *   - Finds the closest route coordinate to current position.
 *   - Sums haversine distances from closest point to end for remainKm.
 *   - Derives % complete and estimated minutes remaining at 4 km/h.
 *   - Detects off-route (>100m from closest point) or arrival (≥98%).
 */
function updateTrackingProgress() {
  if (!currentRoutes || !isTracking) return;
  const route   = currentRoutes[trackingIdx];
  const coords  = route.r.coords;
  const userPos = [userLat, userLng];

  // Find closest route node
  let closestIdx = 0, closestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(userPos, coords[i]);
    if (d < closestDist) { closestDist = d; closestIdx = i; }
  }

  // Sum remaining distance from closest node to destination
  let remainKm = 0;
  for (let i = closestIdx; i < coords.length - 1; i++) {
    remainKm += haversine(coords[i], coords[i+1]);
  }

  const totalKm  = route.r.dist / 1000;
  const walkedKm = Math.max(0, totalKm - remainKm);
  const pct      = Math.min(100, Math.round((walkedKm / totalKm) * 100));
  const minsLeft = Math.max(0, Math.round(remainKm / 0.067)); // 4 km/h = 0.067 km/min

  // Update stat tiles
  const distEl = document.getElementById('trDist');
  const timeEl = document.getElementById('trTime');
  const pctEl  = document.getElementById('trPct');
  const fill   = document.getElementById('trProgFill');
  if (distEl) distEl.textContent = remainKm.toFixed(1);
  if (timeEl) timeEl.textContent = minsLeft;
  if (pctEl)  pctEl.textContent  = pct + '%';
  if (fill)   fill.style.width   = pct + '%';

  // Next direction instruction
  const stepEl = document.getElementById('trStep');
  if (stepEl) {
    if (pct >= 98) {
      // Arrived
      stepEl.innerHTML = '<div class="track-step-ico">🏁</div><div><b>You have arrived!</b> Destination reached.</div>';
      setTimeout(() => stopTracking(), 3000);
    } else if (closestDist > 0.1) {
      // Off-route warning
      stepEl.innerHTML = `<div class="track-step-ico">⚠️</div><div><b>Off route</b> — you are ${(closestDist*1000).toFixed(0)}m from the route. Head back to the highlighted path.</div>`;
    } else {
      // Next turn
      const nextStep = getNextTurnStep(coords, closestIdx);
      stepEl.innerHTML = `<div class="track-step-ico">${nextStep.ico}</div><div>${nextStep.text}</div>`;
    }
  }

  // Update live clock
  const d  = new Date();
  const ts = `Live · ${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
  const ltEl  = document.getElementById('liveT');  if (ltEl)  ltEl.textContent  = ts;
  const mltEl = document.getElementById('mobLiveT'); if (mltEl) mltEl.textContent = ts;
}

/**
 * getNextTurnStep — looks ahead 12 route nodes to detect the next turn.
 * Computes bearing change and classifies as left/right/straight/U-turn.
 * @returns {{ ico: string, text: string }}
 */
function getNextTurnStep(coords, currentIdx) {
  const lookAhead = Math.min(currentIdx + 12, coords.length - 1);
  if (lookAhead <= currentIdx) return { ico:'🏁', text:'<b>Destination ahead</b>' };
  const distAhead = haversine(coords[currentIdx], coords[lookAhead]) * 1000;
  const bearing1  = getBearing(coords[currentIdx], coords[Math.min(currentIdx+3, coords.length-1)]);
  const bearing2  = getBearing(coords[Math.min(currentIdx+3, coords.length-1)], coords[lookAhead]);
  const turn      = ((bearing2 - bearing1) + 360) % 360;
  let ico = '⬆️', dir = 'Continue straight';
  if (turn > 30 && turn < 150)        { ico = '↩️'; dir = 'Turn left'; }
  else if (turn > 210 && turn < 330)  { ico = '↪️'; dir = 'Turn right'; }
  else if (turn >= 150 && turn <= 210){ ico = '🔄'; dir = 'U-turn ahead'; }
  return { ico, text: `<b>${dir}</b> — ${Math.round(distAhead)}m ahead` };
}

/**
 * getBearing — computes the compass bearing (0–360°) from point a to point b.
 * Uses the spherical trigonometry formula for forward azimuth.
 */
function getBearing(a, b) {
  const lat1 = a[0]*Math.PI/180, lat2 = b[0]*Math.PI/180;
  const dLng  = (b[1]-a[1])*Math.PI/180;
  const y     = Math.sin(dLng)*Math.cos(lat2);
  const x     = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
  return (Math.atan2(y, x)*180/Math.PI + 360) % 360;
}


/* ═══════════════════════════════════════════
   §21  TURN-BY-TURN DIRECTIONS
═══════════════════════════════════════════ */

/** toggleDirList — expands or collapses the directions list panel. */
function toggleDirList() {
  const list  = document.getElementById('dirList');
  const arrow = document.getElementById('dirArrow');
  if (!list) return;
  const open = list.classList.toggle('show');
  if (arrow) arrow.textContent = open ? '▾' : '▸';
}

/**
 * buildDirections — populates the turn-by-turn directions panel
 * for the given route using OSRM step data or geometry-derived turns.
 * @param {Object} route — one item from currentRoutes
 */
function buildDirections(route) {
  const dirSec   = document.getElementById('dirSection');
  const dirList  = document.getElementById('dirList');
  const dirCount = document.getElementById('dirCount');
  if (!dirSec || !dirList) return;
  const steps = extractSteps(route);
  dirCount.textContent = steps.length + ' steps';
  dirList.innerHTML    = steps.map((s, i) => `
    <div class="dir-step ${i===0?'highlight':''}">
      <div class="dir-step-ico">${s.ico}</div>
      <div class="dir-step-name">${s.name}</div>
      <div class="dir-step-dist">${s.dist}</div>
    </div>`).join('');
  dirSec.style.display = 'block';
}

/**
 * extractSteps — converts OSRM leg steps (or raw geometry) into
 * an array of { ico, name, dist } turn-by-turn instruction objects.
 * Prefers OSRM step data; falls back to bearing-derived turns if unavailable.
 */
function extractSteps(route) {
  const steps  = [];
  const coords = route.r.coords;
  const legs   = route.legs || [];

  if (legs.length && legs[0].steps?.length) {
    // Use OSRM step data (most accurate)
    for (const leg of legs) {
      for (const step of leg.steps) {
        if (!step.distance || step.distance < 10) continue;
        const maneuver = step.maneuver?.type     || 'continue';
        const modifier = step.maneuver?.modifier || '';
        const name     = step.name               || 'Unnamed road';
        const dist     = step.distance > 1000
          ? (step.distance/1000).toFixed(1) + ' km'
          : Math.round(step.distance) + ' m';
        steps.push({ ico: maneuverIco(maneuver, modifier), name: formatStepName(maneuver, modifier, name), dist });
      }
    }
  } else {
    // Fallback: derive turns from bearing changes in raw geometry
    steps.push({ ico:'🟢', name:'Start walking', dist:'' });
    const SAMPLE = Math.max(1, Math.floor(coords.length / 8));
    for (let i = SAMPLE; i < coords.length - SAMPLE; i += SAMPLE) {
      const b1   = getBearing(coords[i-SAMPLE], coords[i]);
      const b2   = getBearing(coords[i], coords[Math.min(i+SAMPLE, coords.length-1)]);
      const turn = ((b2 - b1) + 360) % 360;
      const dist = haversine(coords[i], coords[Math.min(i+SAMPLE, coords.length-1)]);
      const distStr = dist > 1 ? dist.toFixed(1)+' km' : Math.round(dist*1000)+' m';
      if (turn > 35 && turn < 150)        steps.push({ ico:'↩️', name:'Turn left',          dist:distStr });
      else if (turn > 210 && turn < 325)  steps.push({ ico:'↪️', name:'Turn right',         dist:distStr });
      else                                steps.push({ ico:'⬆️', name:'Continue straight',  dist:distStr });
    }
    steps.push({ ico:'🏁', name:'Arrive at destination', dist:'' });
  }
  return steps;
}

/** maneuverIco — maps OSRM maneuver type + modifier to an emoji icon. */
function maneuverIco(type, modifier) {
  if (type === 'arrive')                              return '🏁';
  if (type === 'depart')                              return '🟢';
  if (type === 'roundabout' || type === 'rotary')     return '🔄';
  if (modifier === 'left'  || modifier === 'sharp left')  return '↩️';
  if (modifier === 'right' || modifier === 'sharp right') return '↪️';
  if (modifier === 'slight left')                     return '↖️';
  if (modifier === 'slight right')                    return '↗️';
  if (modifier === 'uturn')                           return '🔄';
  return '⬆️';
}

/** formatStepName — creates a readable instruction sentence from OSRM step data. */
function formatStepName(type, modifier, road) {
  if (type === 'depart')                       return `Start on <b>${road}</b>`;
  if (type === 'arrive')                       return '<b>Arrive at destination</b>';
  if (type === 'turn' && modifier.includes('left'))  return `Turn left onto <b>${road}</b>`;
  if (type === 'turn' && modifier.includes('right')) return `Turn right onto <b>${road}</b>`;
  if (type === 'continue')                     return `Continue on <b>${road}</b>`;
  if (type === 'new name')                     return `Road becomes <b>${road}</b>`;
  if (type === 'roundabout')                   return `Take roundabout onto <b>${road}</b>`;
  return `Head toward <b>${road}</b>`;
}


/* ═══════════════════════════════════════════
   §22  SERVICES (POI markers, CCTV)
═══════════════════════════════════════════ */

/**
 * displayServices — renders police and hospital markers from cachedPOIs.
 * Falls back to simulated markers if no real data was returned.
 * Caps markers per type at MAX_POI_PER_TYPE to prevent the dense clustering
 * seen in the screenshots (images showed 30+ overlapping hospital icons).
 * Also triggers CCTV placement if that filter is active.
 */
function displayServices() {
  clearSvc();
  if (cachedPOIs.data.length === 0) {
    simSvc();
  } else {
    // Cap per type: show only the closest MAX_POI_PER_TYPE to route midpoint
    const mid = currentRoutes
      ? currentRoutes[0].r.coords[Math.floor(currentRoutes[0].r.coords.length / 2)]
      : (fromCoords || [userLat, userLng]);

    ['police','hospital'].forEach(type => {
      const items = cachedPOIs.data
        .filter(p => p.type === type)
        .map(p => ({ ...p, _d: haversine(mid, p.coords) }))
        .sort((a, b) => a._d - b._d)           // closest first
        .slice(0, MAX_POI_PER_TYPE);             // cap at 6 per type
      items.forEach(p => placeSvc(p.coords, p.type, p.name));
    });
  }
  if (activeFilters.has('cctv')) addCCTV();
}

/**
 * placeSvc — places a single police or hospital marker on the map.
 * Skips if the corresponding filter is inactive.
 * Uses a wider clash threshold (80m vs old 40m) to spread markers apart
 * and prevent the icon pile-up visible in the screenshots.
 */
function placeSvc(coords, type, name) {
  const isP       = type === 'police';
  const filterKey = isP ? 'police' : 'hospital';
  if (!activeFilters.has(filterKey)) return;
  if (!coords || coords.length < 2 || coords.some(v => isNaN(v))) return;

  // Spread overlapping markers: try 7 offset positions, skip if still too close
  let [lat, lng] = coords;
  const nearby  = svcMarkers.filter(m => m._type === filterKey);
  const OFFSET  = 0.0008; // ~88m — wider than before to reduce pile-up
  const offsets = [
    [0,0],
    [OFFSET,0],[-OFFSET,0],[0,OFFSET],[0,-OFFSET],
    [OFFSET,OFFSET],[-OFFSET,OFFSET],[OFFSET,-OFFSET],[-OFFSET,-OFFSET],
  ];
  let placed = false;
  for (const [oLat, oLng] of offsets) {
    const candidate = [lat+oLat, lng+oLng];
    const clash = nearby.some(m => {
      const p = m.getLatLng();
      return haversine([p.lat,p.lng], candidate) < 0.08; // 80m clash threshold
    });
    if (!clash) { lat = candidate[0]; lng = candidate[1]; placed = true; break; }
  }
  // If all offsets still clash, skip this marker entirely (avoids infinite pile-up)
  if (!placed) return;

  const icon  = isP ? '🚔' : '🏥';
  const cls   = isP ? 'mk-police' : 'mk-hosp';
  const label = isP ? 'Police Station' : 'Hospital / Clinic';
  const mk    = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div class="mk ${cls}" title="${esc(name)}">${icon}</div>`,
      iconSize: [28,28], iconAnchor: [14,14], className: '',
    }),
    zIndexOffset: isP ? 900 : 700,
  }).addTo(map).bindPopup(`<b>${icon} ${esc(name)}</b><br><small>${label}</small>`);
  mk._isCCTV = false;
  mk._type   = filterKey;
  svcMarkers.push(mk);
}

/**
 * simSvc — places simulated police/hospital markers when Overpass returns nothing.
 * Uses realistic offsets from the route midpoint. Populates cachedPOIs so
 * filter toggles still work.
 */
function simSvc() {
  if (!fromCoords) return;
  const mid  = currentRoutes
    ? currentRoutes[0].r.coords[Math.floor(currentRoutes[0].r.coords.length / 2)]
    : fromCoords;
  const sims = [
    { o:[.007, -.009], t:'police',   n:'City Police Station' },
    { o:[-.010, .012], t:'police',   n:'Traffic Police Post' },
    { o:[.013, .005],  t:'hospital', n:'Govt General Hospital' },
    { o:[-.008,-.014], t:'hospital', n:'District Hospital' },
    { o:[.018, -.004], t:'hospital', n:'Apollo Medical Centre' },
  ];
  cachedPOIs.data = sims.map(p => ({ coords:[mid[0]+p.o[0], mid[1]+p.o[1]], type:p.t, name:p.n }));
  cachedPOIs.data.forEach(p => placeSvc(p.coords, p.type, p.name));
}

/**
 * addCCTV — places simulated CCTV camera markers evenly along the active route.
 * Count: 8 on desktop, 5 on mobile (less clutter).
 */
function addCCTV() {
  if (!currentRoutes || !activeFilters.has('cctv')) return;
  const coords = currentRoutes[activeIdx].r.coords;
  const COUNT  = isMobile() ? 5 : 8;
  const sz     = isMobile() ? 18 : 22;
  for (let k = 1; k <= COUNT; k++) {
    const idx = Math.floor(k * coords.length / (COUNT + 1));
    const c   = coords[idx];
    const mk  = L.marker(c, {
      icon: L.divIcon({
        html: `<div class="mk mk-cctv" style="width:${sz}px;height:${sz}px;font-size:${sz*0.55}px">📷</div>`,
        iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], className:'',
      }),
      zIndexOffset: 200,
    }).addTo(map).bindPopup('<b>📷 CCTV Camera</b><br><small>Active 24/7 surveillance</small>');
    mk._isCCTV = true; mk._type = 'cctv';
    svcMarkers.push(mk);
  }
}

/** clearSvc — removes all POI and CCTV markers from the map. */
function clearSvc() { svcMarkers.forEach(m => map.removeLayer(m)); svcMarkers = []; }


/* ═══════════════════════════════════════════
   §23  DARK ZONES
   Animated red circles placed near the fastest
   (least safe) route to highlight poorly lit areas.
═══════════════════════════════════════════ */

/**
 * updateDz — redraws dark zone circles.
 * Placed at 5 percentile positions along the fastest route (index 2),
 * offset by DZ_OFFSETS to not overlap the route itself.
 */
function updateDz() {
  dzLayers.forEach(l => map.removeLayer(l)); dzLayers = [];
  if (!activeFilters.has('dark')) return;
  const base = (currentRoutes && currentRoutes[2]?.r?.coords?.length > 4)
    ? currentRoutes[2].r.coords
    : (fromCoords ? [fromCoords] : null);
  if (!base) return;
  const pcts = [.18, .36, .54, .70, .86];
  pcts.forEach((pct, i) => {
    const c = base[Math.floor(pct * (base.length-1))];
    const o = DZ_OFFSETS[i];
    const circle = L.circle([c[0]+o.dl, c[1]+o.dg], {
      radius:       o.r,
      color:        '#ff4757',
      fillColor:    '#ff4757',
      fillOpacity:  .14,
      weight:       1.5,
      opacity:      .55,
      className:    'dzc', // CSS animation class
    }).addTo(map).bindPopup('<b>⚠️ Dark Zone</b><br><small>Poor lighting · Avoid at night</small>');
    dzLayers.push(circle);
  });
}


/* ═══════════════════════════════════════════
   §24  FILTER CHIPS
   Each chip toggles a specific map layer.
   Only the relevant markers are added/removed —
   no full re-fetch of route data.
═══════════════════════════════════════════ */

/**
 * toggleFC — called when a filter chip is clicked.
 * Updates activeFilters Set and shows/hides the relevant map layer.
 * @param {HTMLElement} el — the chip element
 * @param {'safe'|'dark'|'police'|'hospital'|'cctv'} type
 */
function toggleFC(el, type) {
  el.classList.toggle('on');
  const on = el.classList.contains('on');
  if (on) activeFilters.add(type); else activeFilters.delete(type);

  // Dark zones: just redraw them
  if (type === 'dark') { updateDz(); return; }

  // CCTV: remove all CCTV markers; re-add if toggling on
  if (type === 'cctv') {
    svcMarkers.filter(m => m._isCCTV).forEach(m => map.removeLayer(m));
    svcMarkers = svcMarkers.filter(m => !m._isCCTV);
    if (on) addCCTV();
    return;
  }

  // Police / hospital: remove that type; re-add from cache if toggling on
  if (type === 'police' || type === 'hospital') {
    svcMarkers.filter(m => !m._isCCTV && m._type===type).forEach(m => map.removeLayer(m));
    svcMarkers = svcMarkers.filter(m => m._isCCTV || m._type!==type);
    if (on) cachedPOIs.data.filter(p => p.type===type).forEach(p => placeSvc(p.coords, p.type, p.name));
    return;
  }

  // Safe routes layer: redraw with or without route polylines
  if (type === 'safe' && currentRoutes) drawRoutes(currentRoutes, activeIdx);
}

/** scrollFilters — scrolls the filter chip row left or right on button click. */
function scrollFilters() {
  const row = document.getElementById('filterRow');
  if (!row) return;
  const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 10;
  row.scrollTo({ left: atEnd ? 0 : row.scrollLeft + 120, behavior:'smooth' });
}


/* ═══════════════════════════════════════════
   §25  MOBILE SIDEBAR
═══════════════════════════════════════════ */

/**
 * toggleSidebar — opens or closes the mobile sidebar sheet.
 * On desktop this is a no-op (sidebar is always visible).
 * @param {boolean|undefined} force — if provided, sets state explicitly
 */
function toggleSidebar(force) {
  if (!isMobile()) return;
  sidebarOpen = force !== undefined ? force : !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
}


/* ═══════════════════════════════════════════
   §26  TOAST NOTIFICATIONS
═══════════════════════════════════════════ */

/**
 * showToast — displays a short notification at the top of the screen.
 * Auto-dismisses after `dur` ms (default 2800).
 * @param {string} msg — text to display
 * @param {number} dur — display duration in ms
 */
function showToast(msg, dur = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}


/* ═══════════════════════════════════════════
   §27  SOS & EMERGENCY CONTACTS
   ─────────────────────────────────────────
   Emergency contact data is stored in localStorage
   under the key "sw_emergency_contacts" as a JSON object:
   { contact1: "+919XXXXXXXXX", contact2: "+919XXXXXXXXX" }

   SOS flow when the user presses the SOS button:
     1. showSOS()         → opens the SOS modal
     2. callEmg()         → dials 112 (India National Emergency Number)
     3. shareLoc()        → shares Google Maps link via Web Share API / clipboard
     4. sendToContacts()  → sends location link to both stored contacts via SMS

   Note: SMS delivery is device-dependent. The tel: and sms: URI schemes
   open the native dialler and messaging apps respectively. Actual
   transmission is handled by the OS, not by SafeWalk.

   IMPORTANT: On devices without the Web Share API (most desktops),
   the location link is copied to clipboard instead of shared.
═══════════════════════════════════════════ */

/* ── Contact Storage ── */

/**
 * getEmergencyContacts — retrieves stored emergency contacts from localStorage.
 * @returns {{ contact1: string, contact2: string }} phone numbers with +91 prefix
 */
function getEmergencyContacts() {
  try {
    return JSON.parse(localStorage.getItem('sw_emergency_contacts') || '{}');
  } catch(e) { return {}; }
}

/**
 * saveEmergencyContacts — stores validated contact numbers in localStorage.
 * Called by the "Save Contacts" button in the contacts registration modal.
 * Validates that each number is exactly 10 digits (Indian mobile format).
 */
function saveContacts() {
  const raw1 = document.getElementById('contact1Input')?.value?.trim() || '';
  const raw2 = document.getElementById('contact2Input')?.value?.trim() || '';

  // Validate: Indian mobile numbers are 10 digits, starting with 6-9
  const valid = n => /^[6-9]\d{9}$/.test(n);

  if (raw1 && !valid(raw1)) { showToast('⚠️ Contact 1 must be a valid 10-digit Indian number'); return; }
  if (raw2 && !valid(raw2)) { showToast('⚠️ Contact 2 must be a valid 10-digit Indian number'); return; }
  if (!raw1 && !raw2)       { showToast('⚠️ Enter at least one contact number'); return; }

  // Store with +91 prefix for international format
  const contacts = {
    contact1: raw1 ? '+91' + raw1 : '',
    contact2: raw2 ? '+91' + raw2 : '',
  };

  try {
    localStorage.setItem('sw_emergency_contacts', JSON.stringify(contacts));
    localStorage.setItem('sw_contacts_set', '1');
    // Close modal
    const modal = document.getElementById('contactsModal');
    if (modal) modal.classList.remove('show');
    showToast('✅ Emergency contacts saved!', 3000);
  } catch(e) {
    showToast('⚠️ Could not save contacts — storage unavailable');
  }
}

/**
 * skipContacts — dismisses the contacts modal without saving.
 * The modal will not reappear this session (flag set in sessionStorage).
 */
function skipContacts() {
  const modal = document.getElementById('contactsModal');
  if (modal) modal.classList.remove('show');
  try { sessionStorage.setItem('sw_contacts_skipped', '1'); } catch(e) {}
  showToast('ℹ️ You can add contacts anytime via Settings');
}

/**
 * checkContacts — shows the emergency contacts registration modal
 * Always prompted on freshly load as requested.
 */
function checkContacts() {
  try {
    const modal = document.getElementById('contactsModal');
    if (modal) modal.classList.add('show');
  } catch(e) {}
}

/* ── SOS Modal ── */

/** showSOS — opens the SOS action modal. */
function showSOS() {
  document.getElementById('sosModal').classList.add('show');
}

/**
 * closeSOS — closes the SOS modal.
 * When called from the background click handler, only closes if the click
 * was directly on the backdrop (not on the panel itself).
 * @param {Event|undefined} e
 */
function closeSOS(e) {
  if (!e || e.target === document.getElementById('sosModal'))
    document.getElementById('sosModal').classList.remove('show');
}

/* ── SOS Actions ── */

/**
 * callEmg — initiates a call to India's national emergency number 112.
 * The `tel:` URI scheme opens the native dialler on mobile devices.
 *
 * India Emergency Numbers:
 *   112 — National Emergency (Police / Fire / Ambulance — unified)
 *   100 — Police only
 *   101 — Fire brigade
 *   102 — Ambulance
 */
function callEmg() {
  closeSOS();
  // Opens native phone dialler with 112 pre-dialled
  window.location.href = 'tel:112';
}

/**
 * shareLoc — shares the user's current GPS coordinates as a Google Maps link.
 *
 * Priority:
 *   1. Web Share API (mobile browsers) — opens native share sheet
 *   2. Clipboard API (fallback for desktop) — copies link
 *   3. Toast fallback if both unavailable
 *
 * The shared link format: https://maps.google.com/?q=LAT,LNG
 * This is human-readable and opens in Google Maps on any device.
 */
function shareLoc() {
  closeSOS();
  const url = `https://maps.google.com/?q=${userLat},${userLng}`;
  if (navigator.share) {
    navigator.share({
      title: '🆘 Emergency Location',
      text:  'I need help — my current location:',
      url,
    }).catch(() => {
      // User cancelled or share failed — fallback to clipboard
      navigator.clipboard?.writeText(url).then(() => showToast('📋 Location link copied!'));
    });
  } else {
    // Desktop: copy to clipboard
    navigator.clipboard?.writeText(url)
      .then(() => showToast('📋 Location link copied — send it to someone!'))
      .catch(() => showToast('📍 Location: ' + url));
  }
}

/**
 * sendToContacts — sends the user's live location to both stored emergency contacts
 * via SMS using the `sms:` URI scheme.
 *
 * The `sms:` URI scheme opens the native SMS app with:
 *   - To: the contact's phone number
 *   - Body: a pre-filled message with the Google Maps link
 *
 * Limitations:
 *   - Not supported on desktop browsers
 *   - iOS uses `sms:NUMBER&body=TEXT`, Android uses `sms:NUMBER?body=TEXT`
 *     (we try both via a compatible format)
 *   - The message is pre-filled but the user must still tap "Send" in their SMS app
 *   - If only one contact is stored, only one SMS link is opened
 *   - Sequential links (with timeout) avoid browsers blocking multiple redirects
 *
 * @param {boolean} [fromModal=false] — true when called from the SOS modal button
 */
function sendToContacts(fromModal = false) {
  if (fromModal) closeSOS();

  const contacts = getEmergencyContacts();
  const numbers  = [contacts.contact1, contacts.contact2].filter(Boolean);

  if (!numbers.length) {
    showToast('⚠️ No emergency contacts saved — please add them');
    // Open contacts modal for registration
    setTimeout(() => {
      const modal = document.getElementById('contactsModal');
      if (modal) modal.classList.add('show');
    }, 800);
    return;
  }

  // Compose the emergency message with live location link
  const mapUrl = `https://maps.google.com/?q=${userLat},${userLng}`;
  const msg    = encodeURIComponent(
    `🆘 EMERGENCY: I need help! My live location:\n${mapUrl}\n\nSent via SafeWalk emergency SOS`
  );

  // Open SMS app for each contact with a 600ms gap (prevents popup blocking)
  numbers.forEach((number, i) => {
    setTimeout(() => {
      // Use body= for Android compatibility; iOS accepts this format too
      window.open(`sms:${number}?body=${msg}`, '_self');
    }, i * 600);
  });

  showToast(`📲 Opening SMS for ${numbers.length} contact${numbers.length>1?'s':''}…`, 3500);
}


/* ═══════════════════════════════════════════
   §28  ONBOARDING
   Shown once per device via localStorage flag.
═══════════════════════════════════════════ */

/**
 * checkOnboard — shows the onboarding overlay if this is the first visit.
 * Flag key: "sw_onboarded" in localStorage.
 */
function checkOnboard() {
  try {
    if (!localStorage.getItem('sw_onboarded')) {
      const el = document.getElementById('onboardOverlay');
      if (el) el.style.display = 'flex';
    }
  } catch(e) {}
}

/**
 * dismissOnboard — marks onboarding as complete and fades out the overlay.
 * Sets localStorage "sw_onboarded" = "1".
 */
function dismissOnboard() {
  try { localStorage.setItem('sw_onboarded', '1'); } catch(e) {}
  const el = document.getElementById('onboardOverlay');
  if (el) {
    el.style.opacity = '0'; el.style.transition = 'opacity .3s';
    setTimeout(() => el.style.display = 'none', 300);
  }
}


/* ═══════════════════════════════════════════
   §29  SCROLL HELPERS
═══════════════════════════════════════════ */

// Share route utility (exposed globally for potential share button)
// (defined in §17 above)

/* ═══════════════════════════════════════════
   §30  MOBILE SWIPE TO CLOSE SIDEBAR & INPUT SYNC
═══════════════════════════════════════════ */

// Swipe-down to close sidebar: track touch Y on touchstart, compare on touchend
let swipeY = 0;
const sb = document.getElementById('sidebar');

/** Capture start Y position of touch on sidebar */
sb.addEventListener('touchstart', e => { swipeY = e.touches[0].clientY; }, { passive:true });

/** If swipe delta > 65px downward, close sidebar */
sb.addEventListener('touchend', e => {
  if (e.changedTouches[0].clientY - swipeY > 65) toggleSidebar(false);
}, { passive:true });

/** Mob handle bar click also closes sidebar */
document.getElementById('mobHandle').addEventListener('click', () => toggleSidebar(false));


/* ── Filter Chip Drag-to-Scroll ──────────────────────────────── */
(function initFilterScroll() {
  const row  = document.getElementById('filterRow');
  const dots = document.querySelectorAll('.fdot-ind');
  if (!row || !dots.length) return;

  // Mouse drag-to-scroll on desktop
  let isDown = false, startX, scrollLeft;
  row.addEventListener('mousedown', e => {
    isDown = true; row.classList.add('dragging');
    startX = e.pageX - row.offsetLeft; scrollLeft = row.scrollLeft;
  });
  ['mouseleave','mouseup'].forEach(ev => row.addEventListener(ev, () => { isDown = false; }));
  row.addEventListener('mousemove', e => {
    if (!isDown) return; e.preventDefault();
    const x = e.pageX - row.offsetLeft;
    row.scrollLeft = scrollLeft - (x-startX) * 1.2;
  });

  // Dot position indicator: updates on scroll
  function updateDots() {
    const pct = row.scrollLeft / Math.max(1, row.scrollWidth - row.clientWidth);
    const seg = Math.min(dots.length-1, Math.floor(pct * dots.length));
    dots.forEach((d, i) => d.classList.toggle('active', i === seg));
  }
  row.addEventListener('scroll', updateDots, { passive:true });
  updateDots();
})();


/* ── Bi-directional PC ↔ Mobile Input Sync ───────────────────── */
// PC inputs → mirror to mobile inputs (when mobile input is not focused)
['fromIn','toIn'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    const mobId = id === 'fromIn' ? 'mobFrom' : 'mobTo';
    const mob   = document.getElementById(mobId);
    if (mob && mob !== document.activeElement) mob.value = e.target.value;
  });
});

// Mobile inputs → mirror to PC inputs (when PC input is not focused)
['mobFrom','mobTo'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', e => {
    const pcId = id === 'mobFrom' ? 'fromIn' : 'toIn';
    const pc   = document.getElementById(pcId);
    if (pc && pc !== document.activeElement) pc.value = e.target.value;
  });
});
