// Open-Meteo (free, no key): geocode a venue city, then read the hourly forecast at kickoff.
import { cached, readDisk, writeDisk } from './cache.js';

const COUNTRY_ALIASES = {
  England: 'United Kingdom',
  Scotland: 'United Kingdom',
  Wales: 'United Kingdom',
  'Northern Ireland': 'United Kingdom',
  USA: 'United States',
  'U.S.A.': 'United States',
  US: 'United States',
  Holland: 'Netherlands',
  Turkiye: 'Turkey',
  Czechia: 'Czech Republic',
};

// WMO weather codes -> label + icon name (icons are drawn client-side).
const WMO = [
  [0, 'Clear', 'sun'], [1, 'Mostly clear', 'sun'], [2, 'Partly cloudy', 'cloud-sun'], [3, 'Overcast', 'cloud'],
  [45, 'Fog', 'fog'], [48, 'Rime fog', 'fog'],
  [51, 'Light drizzle', 'drizzle'], [53, 'Drizzle', 'drizzle'], [55, 'Heavy drizzle', 'rain'],
  [56, 'Freezing drizzle', 'rain'], [57, 'Freezing drizzle', 'rain'],
  [61, 'Light rain', 'drizzle'], [63, 'Rain', 'rain'], [65, 'Heavy rain', 'rain'],
  [66, 'Freezing rain', 'rain'], [67, 'Freezing rain', 'rain'],
  [71, 'Light snow', 'snow'], [73, 'Snow', 'snow'], [75, 'Heavy snow', 'snow'], [77, 'Snow grains', 'snow'],
  [80, 'Showers', 'drizzle'], [81, 'Showers', 'rain'], [82, 'Heavy showers', 'rain'],
  [85, 'Snow showers', 'snow'], [86, 'Snow showers', 'snow'],
  [95, 'Thunderstorm', 'storm'], [96, 'Thunderstorm w/ hail', 'storm'], [99, 'Thunderstorm w/ hail', 'storm'],
];
const WMO_MAP = new Map(WMO.map(([c, label, icon]) => [c, { label, icon }]));

let geoStore = null;
let geoDirty = false;
let flushTimer = null;

async function loadGeoStore() {
  if (!geoStore) {
    geoStore = await readDisk('geocode.json', {});
    for (const k of Object.keys(geoStore)) if (!geoStore[k]) delete geoStore[k];
  }
  return geoStore;
}

function scheduleFlush() {
  geoDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!geoDirty) return;
    geoDirty = false;
    try {
      await writeDisk('geocode.json', geoStore);
    } catch (e) {
      console.warn('geocode cache write failed', e.message);
    }
  }, 2000);
}

export async function geocode(city, country, state) {
  if (!city) return null;
  const wantCountry = COUNTRY_ALIASES[country] || country || null;
  const key = [city, state, wantCountry].filter(Boolean).join('|').toLowerCase();
  const store = await loadGeoStore();
  if (key in store) return store[key];

  const result = await cached(`geo:${key}`, 3600_000, async () => {
    // ESPN sometimes gives compound names ("Hamburg Norderstedt", "Saint-Denis Cedex").
    // Try the full name first, then progressively shorter prefixes.
    const words = city.split(/[\s,]+/).filter(Boolean);
    const candidates = [...new Set([city, ...words.map((_, i) => words.slice(0, words.length - i - 1).join(' ')).filter(Boolean)])];
    let results = [];
    for (const name of candidates) {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`geocode ${res.status}`);
      const json = await res.json();
      results = json.results || [];
      if (results.length) break;
    }
    if (!results.length) return null;
    const norm = (s) => (s || '').toLowerCase();
    let best = null;
    if (wantCountry) {
      const byCountry = results.filter(
        (r) => norm(r.country) === norm(wantCountry) || norm(r.country_code) === norm(wantCountry),
      );
      if (state) {
        best = byCountry.find(
          (r) => norm(r.admin1) === norm(state) || norm(r.admin1_code) === norm(state) || norm(r.admin1).startsWith(norm(state)),
        );
      }
      if (!best) best = byCountry[0] || null;
    }
    if (!best) best = results[0];
    return { lat: best.latitude, lon: best.longitude, name: best.name, country: best.country, admin1: best.admin1 || null };
  });
  if (result) {
    store[key] = result; // only persist hits; misses retry after the memory cache expires
    scheduleFlush();
  }
  return result;
}

async function hourlyForecast(lat, lon) {
  const la = lat.toFixed(2);
  const lo = lon.toFixed(2);
  return cached(`wx:${la},${lo}`, 30 * 60_000, async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m` +
      `&forecast_days=16&timezone=UTC&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`forecast ${res.status}`);
    return res.json();
  });
}

export function describeCode(code) {
  return WMO_MAP.get(code) || { label: 'Unknown', icon: 'thermo' };
}

// Weather at the venue around kickoff. Returns null when unavailable.
export async function venueWeather(venue, isoKickoff) {
  if (!venue) return null;
  if (venue.indoor === true) return { indoor: true };
  if (!venue.city) return null;
  try {
    const geo = await geocode(venue.city, venue.country, venue.state);
    if (!geo) return null;
    const fc = await hourlyForecast(geo.lat, geo.lon);
    const times = fc.hourly?.time || [];
    if (!times.length) return null;
    const target = new Date(isoKickoff).getTime();
    if (Number.isNaN(target)) return null;
    let idx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i] + 'Z').getTime() - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        idx = i;
      }
    }
    if (idx < 0 || bestDiff > 2 * 3600_000) return null; // beyond forecast horizon
    const h = fc.hourly;
    const code = h.weather_code?.[idx];
    const d = describeCode(code);
    return {
      indoor: false,
      tempF: h.temperature_2m?.[idx] ?? null,
      precipProb: h.precipitation_probability?.[idx] ?? null,
      precipIn: h.precipitation?.[idx] ?? null,
      windMph: h.wind_speed_10m?.[idx] ?? null,
      gustMph: h.wind_gusts_10m?.[idx] ?? null,
      code,
      label: d.label,
      icon: d.icon,
      place: [geo.name, geo.country === 'United States' ? geo.admin1 : null, geo.country].filter(Boolean).join(', '),
      time: times[idx] + 'Z',
      source: 'Open-Meteo',
    };
  } catch (e) {
    console.warn(`weather failed for ${venue.city}: ${e.message}`);
    return null;
  }
}
