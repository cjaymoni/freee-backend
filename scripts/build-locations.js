#!/usr/bin/env node
/**
 * Builds the data LocationsService serves, from the country-state-city
 * package and data/city-populations.json:
 *
 * - data/cities/<alpha-2>.json, shaped { [stateCode]: [[name, lat, lng, km]] }.
 *   Loading the package's 8 MB city.json in the API process costs about
 *   180 MB of RSS, enough to fail the health check, so the service reads only
 *   the country it is asked for.
 * - data/regions.json, shaped { [alpha-2]: { lat, lng, km, states: {
 *   [stateCode]: { lat, lng, km } } } }.
 *
 * km is the max search radius around lat/lng: for a city, an estimate of its
 * extent from its population; for a state or country, the smallest radius
 * (from a few candidate centres) that covers nearly all of its cities, and
 * for a state never less than half the distance to the nearest other state.
 *
 * Runs on postinstall; the output is gitignored.
 */
const fs = require('fs');
const path = require('path');
const Country = require('country-state-city/lib/cjs/country').default;
const State = require('country-state-city/lib/cjs/state').default;

const dataDir = path.resolve(__dirname, '..', 'data');
const citiesDir = path.join(dataDir, 'cities');
const populations = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'city-populations.json'), 'utf8'),
);

// A typical urban density; a city's radius is that of a disc holding its
// population at this density, so 2M people get about 16 km.
const PEOPLE_PER_KM2 = 2500;
const MIN_CITY_KM = 3;
const MAX_CITY_KM = 50;
// Cities GeoNames has no population for are mostly small towns.
const UNKNOWN_CITY_KM = 5;
// Regions cover this share of their cities, so overseas territories (British
// cities in the Caribbean, French ones in the Indian Ocean) and the odd
// misplaced city do not stretch the radius across an ocean.
const COVERED_SHARE = 0.98;
// The dataset lists only a city or two for some states, so a state is at
// least half as wide as the gap to the nearest other state.
const MIN_STATE_KM = 10;
const MAX_STATE_FLOOR_KM = 250;
// A city-less state centroid this many country radii out is a geocoding error.
const OUTLIER_FACTOR = 3;
// Places with nothing to measure, such as a lone state or a tiny territory.
const FALLBACK_KM = 50;
const HALF_EARTH_KM = 20016;

function cityRadiusKm(population) {
  if (!population) return UNKNOWN_CITY_KM;
  const km = Math.sqrt(population / (Math.PI * PEOPLE_PER_KM2));
  return clamp(Math.ceil(km), MIN_CITY_KM, MAX_CITY_KM);
}

/** Group city.json into country -> state -> [name, lat, lng, km] rows. */
function readCities() {
  const source = require.resolve('country-state-city/lib/cjs/assets/city.json');
  const byCountry = {};
  for (const [name, country, state, lat, lng] of JSON.parse(
    fs.readFileSync(source, 'utf8'),
  )) {
    const km = cityRadiusKm(populations[country]?.[state]?.[name]);
    const states = (byCountry[country] ??= {});
    (states[state] ??= []).push([name, lat, lng, km]);
  }
  return byCountry;
}

function buildRegions(citiesByCountry) {
  const regions = {};
  for (const country of Country.getAllCountries()) {
    const cities = citiesByCountry[country.isoCode] ?? {};
    const states = State.getStatesOfCountry(country.isoCode);

    // Centres measured from cities first: the package misplaces some state
    // centroids by whole continents (Fiji's Ba province sits in Oklahoma).
    const stateRegions = {};
    for (const state of states) {
      const members = (cities[state.isoCode] ?? []).map(toCircle);
      stateRegions[state.isoCode] = members.length
        ? enclose(members, toPoint(state))
        : { ...(toPoint(state) ?? { lat: null, lng: null }), km: 0 };
    }
    for (const [code, region] of Object.entries(stateRegions)) {
      region.km = Math.max(region.km, stateFloorKm(code, stateRegions));
    }

    const cityCircles = Object.values(cities).flat().map(toCircle);
    const centroid = toPoint(country);
    let region;
    if (cityCircles.length) {
      region = enclose(cityCircles, centroid);
      // A state with no cities to check its centroid against is trusted
      // unless it lies far outside the country; the slack keeps outlying
      // islands such as Fiji's Rotuma.
      for (const state of states) {
        const stateRegion = stateRegions[state.isoCode];
        if (
          !cities[state.isoCode]?.length &&
          stateRegion.lat !== null &&
          distanceKm(region, stateRegion) > region.km * OUTLIER_FACTOR
        ) {
          stateRegions[state.isoCode] = { lat: null, lng: null, km: null };
        }
      }
    } else {
      const stateCircles = Object.values(stateRegions).filter(
        (stateRegion) => stateRegion.lat !== null,
      );
      region = stateCircles.length
        ? enclose(stateCircles, centroid)
        : { ...(centroid ?? { lat: null, lng: null }), km: FALLBACK_KM };
    }
    regions[country.isoCode] = { ...region, states: stateRegions };
  }
  return regions;
}

/**
 * Picks the centre whose radius covering COVERED_SHARE of the member circles
 * is smallest: the package's centroid when it has one, or the middle of the
 * members' bounding box, measured both ways round so places across the
 * antimeridian get a sensible centre.
 */
function enclose(members, centroid) {
  const lats = members.map((m) => m.lat);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const candidates = [centroid].filter(Boolean);
  for (const shift of [0, 360]) {
    const lngs = members.map((m) => (m.lng + shift) % 360);
    let midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    if (midLng > 180) midLng -= 360;
    candidates.push({ lat: round(midLat), lng: round(midLng) });
  }

  const covered = Math.ceil(members.length * COVERED_SHARE) - 1;
  let best;
  for (const centre of candidates) {
    const reach = members
      .map((m) => distanceKm(centre, m) + m.km)
      .sort((a, b) => a - b);
    if (!best || reach[covered] < best.km) {
      best = { ...centre, km: reach[covered] };
    }
  }
  return { ...best, km: Math.min(Math.ceil(best.km), HALF_EARTH_KM) };
}

/** Half the distance from a state to the nearest other state of its country. */
function stateFloorKm(code, stateRegions) {
  const self = stateRegions[code];
  if (self.lat === null) return FALLBACK_KM;
  const others = Object.entries(stateRegions)
    .filter(([other, region]) => other !== code && region.lat !== null)
    .map(([, region]) => distanceKm(self, region));
  if (!others.length) return FALLBACK_KM;
  return clamp(
    Math.ceil(Math.min(...others) / 2),
    MIN_STATE_KM,
    MAX_STATE_FLOOR_KM,
  );
}

const toCircle = ([, lat, lng, km]) => ({ lat: +lat, lng: +lng, km });

function toPoint({ latitude, longitude }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return latitude && longitude && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round = (n) => Math.round(n * 1e5) / 1e5;

const citiesByCountry = readCities();
fs.rmSync(citiesDir, { recursive: true, force: true });
fs.mkdirSync(citiesDir, { recursive: true });
for (const [country, states] of Object.entries(citiesByCountry)) {
  fs.writeFileSync(
    path.join(citiesDir, `${country}.json`),
    JSON.stringify(states),
  );
}
fs.writeFileSync(
  path.join(dataDir, 'regions.json'),
  JSON.stringify(buildRegions(citiesByCountry)),
);

console.log(
  `build-locations: wrote ${Object.keys(citiesByCountry).length} city files and regions.json to ${path.relative(process.cwd(), dataDir)}`,
);
