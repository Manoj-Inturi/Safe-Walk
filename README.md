# 🛡️ SafeWalk — AI Safety Navigation

> **"Safer is better than faster"**  
> AI-powered walking navigation for India. Scores routes by road type, street lighting, CCTV coverage, and proximity to police stations and hospitals.

---

## 📁 Project Files

```
safewalk/
├── index.html   — App shell, all UI panels & modals
├── style.css    — All styles, dark theme, animations
├── app.js       — All logic, APIs, routing, SOS, contacts
└── README.md    — This file
```

---

## 🚀 How to Run

**No build step. No server needed.**

1. Download all 3 files into the same folder
2. Open `index.html` in any modern browser
3. Allow location access when prompted

> Works offline for UI. Routing & map data require internet (OSRM + OpenStreetMap).

---

## 🔑 Key Features

| Feature | Detail |
|---|---|
| **Safety Scoring** | Routes scored 15–96% using road type, lighting, POI proximity, night penalty |
| **3 Route Types** | Safest 🟢 / Balanced ⚡ / Fastest 🔴 — all from real OSRM road data |
| **Live Navigation** | GPS tracking, turn-by-turn directions, progress bar |
| **Dark Zones** | Animated red circles mark poorly lit areas on the fastest route |
| **Emergency SOS** | One tap → SMS your contacts + dials 112 (India unified emergency) |
| **Night Mode** | Unlit roads penalised heavily after 8 PM (auto-detects time) |
| **Contact Overlay** | Prompts for 2 emergency numbers on every page load |
| **Filter Chips** | Toggle Safe Routes / Dark Zones / Police / Hospitals / CCTV on map |

---

## 📞 Emergency Contact System

The contact overlay appears **every time the page loads**. This is intentional — it keeps your contacts current.

### How it works
1. On load (2 s after splash), the overlay appears
2. Enter up to 2 Indian mobile numbers (10 digits, starts with 6–9)
3. Numbers are saved to `localStorage` key `sw_sos_contacts`
4. Press **SOS → Activate Full SOS** → SMS sent to both contacts + 112 dialled

### localStorage keys used
| Key | Value |
|---|---|
| `sw_sos_contacts` | `["+91XXXXXXXXXX", "+91XXXXXXXXXX"]` |

---

## 🗺️ APIs Used

| API | Purpose | Endpoint |
|---|---|---|
| **OSRM** | Walking routes + alternatives | `router.project-osrm.org/route/v1/foot/` |
| **OSRM Nearest** | Snap via-point to real road | `router.project-osrm.org/nearest/v1/foot/` |
| **Nominatim** | Geocoding + autocomplete | `nominatim.openstreetmap.org/search` |
| **Overpass API** | Road quality, lighting tags | `overpass-api.de/api/interpreter` |
| **Overpass API** | Police & hospital POIs | `overpass-api.de/api/interpreter` |
| **CartoDB** | Dark map tiles | `basemaps.cartocdn.com/dark_all/` |

All APIs are **free and open**. No API keys required.

---

## 🎨 Tech Stack

- **Leaflet 1.9.4** — map rendering and polylines
- **Syne + Plus Jakarta Sans** — typography (Google Fonts)
- **Vanilla JS (ES2020)** — no framework, no bundler
- **CSS custom properties** — full dark theme via `:root` vars

---

## 🧭 Safety Scoring Algorithm

Each route is scored out of 96 using 6 factors:

```
score = avgRoadScore         (based on OSM highway type)
      + litRatio × 12        (% of route with street lighting)
      + poiBonus             (+8 per police within 500m, +4 per hospital, max 20)
      + roadVariety          (distinct road names × 2, max 10)
      - lengthPenalty        (extra minutes vs fastest × 1.5, max 15)
      - nightPenalty         (if night mode: unlit% × 22)
```

Clamped to `[15, 96]`. A minimum 15-point spread is enforced between safest and least-safe route.

### Road base scores (OSM highway tag)
| Tag | Score |
|---|---|
| `primary` | 85 |
| `secondary` | 80 |
| `pedestrian` | 78 |
| `tertiary` | 72 |
| `footway` | 70 |
| `residential` | 62 |
| `cycleway` | 60 |
| `unclassified` | 50 |
| `service` | 45 |
| `path` | 35 |
| `track` | 25 |

---

## 📱 SOS Flow

```
User taps SOS button
        ↓
SOS modal appears
        ↓
"Activate Full SOS" → triggerFullSOS()
        ↓
  ┌─────────────────────────────────────┐
  │  For each contact in sw_sos_contacts │
  │  → Opens SMS app with pre-filled    │
  │    Google Maps location link        │
  └─────────────────────────────────────┘
        ↓ (after 1.2s)
  Dials tel:112 (India emergency)
```

> SMS uses the native `sms:NUMBER?body=MESSAGE` URI scheme. The user must tap Send in their SMS app. No third-party SMS API is needed.

---

## 🗂️ Code Structure (app.js)

| Section | Contents |
|---|---|
| §1 Constants & State | All global vars, map instance, route layers |
| §2 Splash | Auto-init loading animation |
| §3 Map Init | Leaflet setup, CartoDB dark tiles |
| §4 GPS | Auto-request + manual locate |
| §5 Input Helpers | Set values, swap from/to |
| §6 Autocomplete | Nominatim debounced suggestions (240ms) |
| §7 Recent Searches | localStorage saved places |
| §8 Map Pins | From/To endpoint markers |
| §9 Distance & Transport | Walk limit check, transport banner |
| §10 Search Flow | Main entry point, orchestrates all fetches |
| §11 Geocoding | Nominatim single-result geocode |
| §12 Routing Engine | OSRM alternatives fetch |
| §13 Road Quality | Overpass highway/lighting query |
| §14 Safety Scoring | scoreRoutes() — the core algorithm |
| §15 Analyzing Animation | Progress bar during calculation |
| §16 POI Fetch | Overpass police/hospital query |
| §17 Route Builder | Transforms scored routes → UI objects |
| §18 Route Drawing | Leaflet polylines, glow, selection |
| §19 Night Mode | Toggle + auto-detect after 8 PM |
| §20 Live Walk Tracking | GPS watch, progress updates |
| §21 Turn-by-Turn | Direction step builder |
| §22 Services | POI marker placement + CCTV |
| §23 Dark Zones | Animated circles on risky areas |
| §24 Filter Chips | Map layer toggles |
| §25 Mobile Sidebar | Sheet open/close, swipe to dismiss |
| §26 Toast | Notification system |
| §27 SOS & Contacts | Overlay, validation, triggerFullSOS |
| §28 Onboarding | First-run tutorial overlay |
| §29 Scroll Helpers | Filter row drag-scroll + dot indicators |
| §30 Input Sync | PC ↔ Mobile field sync |

---

## ⚙️ Configuration

All tuneable constants are at the top of `app.js`:

```js
const WALK_LIMIT_KM = 2.5;   // show transport warning beyond this distance
const MAX_POI_PER_TYPE = 6;  // max police/hospital markers shown on map
```

Default map center (if GPS denied):
```js
let userLat = 16.3067, userLng = 80.4365;  // Vijayawada, Andhra Pradesh
```

---

## 🔒 Privacy

- No data is sent to any server by this app
- Location is used only on-device for routing API calls
- Emergency contacts stored locally in `localStorage` only
- No analytics, no tracking, no cookies

---

## 🇮🇳 India-Specific Details

- Geocoding is restricted to `countrycodes=in` (Nominatim)
- Emergency number: **112** (India unified — covers Police 100, Fire 101, Ambulance 102)
- Contact validation: 10-digit numbers starting with **6, 7, 8, or 9**
- Phone prefix: **+91**

---

*Built with OpenStreetMap data © OpenStreetMap contributors*
