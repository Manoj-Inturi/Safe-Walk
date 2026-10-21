'use strict';

// SafeWalk's brain 🧠
const SW_CONFIG = Object.freeze({
    WALK_LIMIT_KM: 2.5,
    MAX_POI_PER_TYPE: 6,

    // Home sweet home 🏠
    DEFAULT_LOCATION: Object.freeze({
        lat: 16.3067,
        lng: 80.4365
    }),

    STORAGE_KEYS: {
        SOS_CONTACTS: 'sw_sos_contacts'
    },

    API: {
        NOMINATIM: 'https://nominatim.openstreetmap.org',
        OSRM: 'https://router.project-osrm.org',
        OVERPASS: 'https://overpass-api.de/api/interpreter'
    }
});

// The app's brain 🧠
const SW_STATE = {
    map: null,
    currentLocation: null,
    selectedRoute: null,
    routes: [],
    isTracking: false
};

// No NaN nonsense 💀
function isValidNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// Earth coordinates only 🌍
function isValidCoordinates(lat, lng) {
    return (
        isValidNumber(lat) &&
        isValidNumber(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
    );
}

// JSON, don't betray us.
function safeParseJSON(value, fallback = null) {
    if (typeof value !== 'string') return fallback;

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

// Read saved data safely.
function readStorageJSON(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : safeParseJSON(value, fallback);
    } catch (error) {
        console.warn('Storage read failed:', error);
        return fallback;
    }
}

// Save data. No memory loss.
function writeStorageJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn('Storage write failed:', error);
        return false;
    }
}

// Keep numbers in their lane.
function clamp(value, min, max) {
    if (!isValidNumber(value)) {
        throw new TypeError('Value must be a finite number.');
    }

    if (min > max) {
        throw new RangeError('Minimum cannot exceed maximum.');
    }

    return Math.min(Math.max(value, min), max);
}

// Nobody walks 0.004 km, bro.
function formatDistance(distanceKm) {
    if (!isValidNumber(distanceKm) || distanceKm < 0) {
        return 'Distance unavailable';
    }

    if (distanceKm < 1) {
        return `${Math.round(distanceKm * 1000)} m`;
    }

    return `${distanceKm.toFixed(1)} km`;
}