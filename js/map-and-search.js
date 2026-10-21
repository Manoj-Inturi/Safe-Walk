/* Map, GPS, search suggestions, and saved places */

// Initialize the map 🌍
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        minZoom: 8,
        maxZoom: 19
    }).setView([userLat, userLng], 13);

    L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        {
            maxZoom: 20,
            subdomains: 'abcd'
        }
    ).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

// Dismiss the welcome screen.
function enterApp() {
    const welcome = document.getElementById('welcome');

    welcome.style.transition = 'opacity .3s';
    welcome.style.opacity = '0';

    setTimeout(() => {
        welcome.style.display = 'none';
    }, 300);
}

// Request GPS quietly on startup.
function autoRequestGPS() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        pos => {
            userLat = pos.coords.latitude;
            userLng = pos.coords.longitude;

            fromCoords = [userLat, userLng];
            fromName = 'My Location';

            setVal('from', 'My Location');
            map.setView([userLat, userLng], 14);

            placeUserMk();
            startWatch();
            updateDz();

            showToast('📍 Location detected automatically');
        },
        () => {}
    );
}

// Get the current location manually.
function requestGPS() {
    if (!navigator.geolocation) {
        showToast('⚠️ GPS not supported on this device');
        return;
    }

    showToast('📍 Getting your location…');

    navigator.geolocation.getCurrentPosition(
        pos => {
            userLat = pos.coords.latitude;
            userLng = pos.coords.longitude;

            fromCoords = [userLat, userLng];
            fromName = 'My Location';

            setVal('from', 'My Location');
            map.setView([userLat, userLng], 15);

            placeUserMk();
            startWatch();
            updateDz();

            showToast('✅ GPS location set!');
        },
        err => {
            const msg = err.code === 1
                ? '⚠️ Location permission denied — enable in browser settings'
                : '⚠️ Could not get location';

            showToast(msg, 4000);
        },
        {
            enableHighAccuracy: true,
            timeout: 8000
        }
    );
}

// Center the map on the user.
function locateMe() {
    navigator.geolocation?.getCurrentPosition(
        pos => {
            userLat = pos.coords.latitude;
            userLng = pos.coords.longitude;

            map.setView([userLat, userLng], 16);
            placeUserMk();
        },
        () => map.setView([userLat, userLng], 14)
    );
}

// Keep the user's position updated.
function startWatch() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }

    watchId = navigator.geolocation.watchPosition(
        pos => {
            userLat = pos.coords.latitude;
            userLng = pos.coords.longitude;

            placeUserMk();

            const now = new Date();
            const time = `Live · ${
                now.getHours() % 12 || 12
            }:${String(now.getMinutes()).padStart(2, '0')} ${
                now.getHours() >= 12 ? 'PM' : 'AM'
            }`;

            document.getElementById('liveT').textContent = time;

            const mobileTime = document.getElementById('mobLiveT');

            if (mobileTime) {
                mobileTime.textContent = time;
            }
        },
        null,
        {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 10000
        }
    );
}

// Draw the walking marker 🚶
function placeUserMk() {
    if (userMarker) {
        map.removeLayer(userMarker);
    }

    userMarker = L.marker([userLat, userLng], {
        icon: L.divIcon({
            html: '<div class="mk-user">🚶</div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            className: ''
        }),
        zIndexOffset: 1000
    }).addTo(map);
}

// Sync desktop and mobile inputs.
function setVal(field, value) {
    const pcId = field === 'from' ? 'fromIn' : 'toIn';
    const mobileId = field === 'from' ? 'mobFrom' : 'mobTo';

    document.getElementById(pcId).value = value;

    const mobileInput = document.getElementById(mobileId);

    if (mobileInput) {
        mobileInput.value = value;
    }
}

// Swap the starting point and destination.
function swapLocs() {
    [fromCoords, toCoords] = [toCoords, fromCoords];
    [fromName, toName] = [toName, fromName];

    setVal('from', fromName || '');
    setVal('to', toName || '');
}

// Debounce autocomplete requests.
function onSug(field, mode) {
    const key = field + mode;

    clearTimeout(sugTimers[key]);

    const id = field === 'from'
        ? (mode === 'mob' ? 'mobFrom' : 'fromIn')
        : (mode === 'mob' ? 'mobTo' : 'toIn');

    const value = document.getElementById(id).value.trim();

    if (value.length < 2) {
        hideSug(0);
        return;
    }

    sugTimers[key] = setTimeout(
        () => fetchSug(field, value, mode),
        240
    );
}

// Fetch location suggestions.
async function fetchSug(field, query, mode) {
    try {
        const viewbox =
            `${userLng - 0.5},${userLat - 0.5},` +
            `${userLng + 0.5},${userLat + 0.5}`;

        const url =
            'https://nominatim.openstreetmap.org/search' +
            `?q=${encodeURIComponent(query)}` +
            '&format=json&limit=6&countrycodes=in' +
            `&viewbox=${viewbox}&bounded=0&addressdetails=1`;

        const response = await fetch(url, {
            headers: { 'Accept-Language': 'en' }
        });

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const data = await response.json();

        renderSug(field, data, mode);
    } catch (error) {
        console.warn('Location suggestions failed:', error);
    }
}

// Render autocomplete suggestions.
function renderSug(field, data, mode) {
    const pcId = field === 'from' ? 'fromSugg' : 'toSugg';
    const mobileId = field === 'from'
        ? 'mobFromSugg'
        : 'mobToSugg';

    const box = document.getElementById(
        mode === 'mob' ? mobileId : pcId
    );

    if (!box || !data.length) {
        box?.classList.remove('show');
        return;
    }

    box.innerHTML = data.map(place => {
        const parts = place.display_name.split(',');
        const name = parts[0].trim();
        const subtitle = parts.slice(1, 3)
            .map(part => part.trim())
            .join(', ');

        const icon = placeEmoji(place.type, place.class);

        return `
            <div class="si"
                onmousedown="pickSug('${field}',${+place.lat},${+place.lon},'${esc(name)}')"
                ontouchstart="pickSug('${field}',${+place.lat},${+place.lon},'${esc(name)}')">
                <div class="si-ic">${icon}</div>
                <div>
                    <div class="si-name">${esc(name)}</div>
                    <div class="si-sub">${esc(subtitle)}</div>
                </div>
            </div>
        `;
    }).join('');

    if (mode === 'mob') {
        const bar = document.getElementById('mob-bar');

        if (bar) {
            box.style.top =
                `${bar.getBoundingClientRect().bottom + 4}px`;
        }
    }

    box.classList.add('show');

    const other = document.getElementById(
        mode === 'mob' ? pcId : mobileId
    );

    if (other) {
        other.innerHTML = box.innerHTML;
    }
}

// Pick an icon for each place type.
function placeEmoji(type, cls) {
    const icons = {
        hospital: '🏥',
        police: '🚔',
        school: '🏫',
        university: '🏫',
        station: '🚉',
        bus_stop: '🚌',
        bus_station: '🚌',
        park: '🌳',
        mall: '🏬',
        city: '🏙️',
        town: '🏙️',
        village: '🏙️',
        suburb: '📍',
        neighbourhood: '📍',
        temple: '🛕',
        church: '⛪',
        mosque: '🕌',
        pharmacy: '💊',
        atm: '🏧',
        bank: '🏦'
    };

    return icons[type] || (cls === 'highway' ? '🛣️' : '📍');
}

// Select a suggested location.
function pickSug(field, lat, lon, name) {
    [
        'fromSugg',
        'toSugg',
        'mobFromSugg',
        'mobToSugg'
    ].forEach(id => {
        document.getElementById(id)?.classList.remove('show');
    });

    if (field === 'from') {
        fromCoords = [lat, lon];
        fromName = name;

        setVal('from', name);
        placePin([lat, lon], 'from');
        map.setView([lat, lon], 15);
    } else {
        toCoords = [lat, lon];
        toName = name;

        setVal('to', name);
        placePin([lat, lon], 'to');

        if (fromCoords) {
            map.fitBounds([fromCoords, toCoords], {
                padding: [80, 60]
            });
        }
    }
}

// Hide suggestion dropdowns.
function hideSug(delay) {
    setTimeout(() => {
        [
            'fromSugg',
            'toSugg',
            'mobFromSugg',
            'mobToSugg'
        ].forEach(id => {
            document.getElementById(id)?.classList.remove('show');
        });
    }, delay);
}

// Keep the last five searches.
const MAX_RECENT = 5;

function getRecent() {
    try {
        return JSON.parse(localStorage.getItem('sw_recent') || '[]');
    } catch {
        return [];
    }
}

// Save a recent location.
function saveRecent(name, lat, lon) {
    try {
        let list = getRecent().filter(place => place.name !== name);

        list.unshift({ name, lat, lon });
        list = list.slice(0, MAX_RECENT);

        localStorage.setItem('sw_recent', JSON.stringify(list));
    } catch (error) {
        console.warn('Could not save recent location:', error);
    }
}

// Get saved places.
function getSaved() {
    try {
        return JSON.parse(localStorage.getItem('sw_saved') || '[]');
    } catch {
        return [];
    }
}

// Toggle a saved place ⭐
function toggleSaved(name, lat, lon) {
    try {
        const list = getSaved();
        const index = list.findIndex(place => place.name === name);

        if (index >= 0) {
            list.splice(index, 1);
            showToast('🗑️ Removed from saved places');
        } else {
            list.unshift({ name, lat, lon });
            showToast('⭐ Saved to your places');
        }

        localStorage.setItem('sw_saved', JSON.stringify(list));
    } catch (error) {
        console.warn('Could not update saved places:', error);
    }
}

// Show saved and recent places.
function showRecentInSugg(field, mode) {
    const recent = getRecent();
    const saved = getSaved();

    if (!recent.length && !saved.length) return;

    const pcId = field === 'from' ? 'fromSugg' : 'toSugg';
    const mobileId = field === 'from'
        ? 'mobFromSugg'
        : 'mobToSugg';

    const box = document.getElementById(
        mode === 'mob' ? mobileId : pcId
    );

    if (!box) return;

    let html = '';

    if (saved.length) {
        html += '<div class="sugg-section-title">⭐ Saved Places</div>';

        html += saved.map(place => `
            <div class="si si-saved"
                onmousedown="pickSug('${field}',${place.lat},${place.lon},'${esc(place.name)}')"
                ontouchstart="pickSug('${field}',${place.lat},${place.lon},'${esc(place.name)}')">
                <div class="si-ic">⭐</div>
                <div><div class="si-name">${esc(place.name)}</div></div>
            </div>
        `).join('');
    }

    if (recent.length) {
        html += '<div class="sugg-section-title">🕐 Recent</div>';

        html += recent.map(place => `
            <div class="si si-recent"
                onmousedown="pickSug('${field}',${place.lat},${place.lon},'${esc(place.name)}')"
                ontouchstart="pickSug('${field}',${place.lat},${place.lon},'${esc(place.name)}')">
                <div class="si-ic">🕐</div>
                <div><div class="si-name">${esc(place.name)}</div></div>
            </div>
        `).join('');
    }

    box.innerHTML = html;
    box.classList.add('show');
}

// Add a start or destination pin 📍
function placePin(coords, type) {
    const isFrom = type === 'from';

    const icon = L.divIcon({
        html: `<div class="mk ${isFrom ? 'mk-from' : 'mk-to'}">${isFrom ? '🟢' : '🔴'}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        className: ''
    });

    if (isFrom) {
        if (fromPin) map.removeLayer(fromPin);
        fromPin = L.marker(coords, { icon }).addTo(map);
    } else {
        if (toPin) map.removeLayer(toPin);
        toPin = L.marker(coords, { icon }).addTo(map);
    }
}