#!/usr/bin/env node
/**
 * Writes data/city-populations.json: the GeoNames population of each
 * country-state-city city, shaped { [alpha-2]: { [stateCode]: { [name]: n } } }.
 * build-locations.js turns populations into the max search radius of each city,
 * since the package itself has no city sizes.
 *
 * Run by hand after upgrading country-state-city, and commit the output:
 *   node scripts/fetch-city-populations.js
 * Needs network access and the `unzip` command.
 *
 * Population data © GeoNames (https://www.geonames.org), CC BY 4.0.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DUMP_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const out = path.resolve(__dirname, '..', 'data', 'city-populations.json');

// A named match may sit this far away: the two datasets place some city
// centres differently. An unnamed one must be practically the same point.
const NAMED_MATCH_KM = 25;
const UNNAMED_MATCH_KM = 1;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geonames-'));
  try {
    const zip = path.join(dir, 'cities500.zip');
    const response = await fetch(DUMP_URL);
    if (!response.ok) throw new Error(`${DUMP_URL}: HTTP ${response.status}`);
    fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const tsv = execFileSync('unzip', ['-p', zip, 'cities500.txt'], {
      maxBuffer: 1 << 30,
      encoding: 'utf8',
    });
    writePopulations(indexGeoNames(tsv));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * GeoNames places with a population, looked up by country and any name they
 * go by, or by country and grid cell for matching on position alone.
 */
function indexGeoNames(tsv) {
  const byName = new Map();
  const byCell = new Map();
  const push = (map, key, place) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(place);
  };
  for (const line of tsv.split('\n')) {
    const f = line.split('\t');
    if (f.length < 15) continue;
    const population = Number(f[14]);
    if (!population) continue;
    const place = { lat: Number(f[4]), lng: Number(f[5]), population };
    const names = new Set(
      [f[1], f[2], ...f[3].split(',')].filter(Boolean).map(normalise),
    );
    for (const name of names) push(byName, `${f[8]}|${name}`, place);
    push(byCell, `${f[8]}|${cell(place.lat)}|${cell(place.lng)}`, place);
  }
  return { byName, byCell };
}

// Cells are about 11 km on a side, so a 1 km match is always in one of the
// nine cells around a point.
const cell = (degrees) => Math.floor(degrees * 10);

function candidates({ byName, byCell }, country, name, point) {
  const named = (byName.get(`${country}|${normalise(name)}`) ?? []).map(
    (place) => ({ place, limit: NAMED_MATCH_KM }),
  );
  const nearby = [];
  for (const dLat of [-1, 0, 1]) {
    for (const dLng of [-1, 0, 1]) {
      const key = `${country}|${cell(point.lat) + dLat}|${cell(point.lng) + dLng}`;
      for (const place of byCell.get(key) ?? []) {
        nearby.push({ place, limit: UNNAMED_MATCH_KM });
      }
    }
  }
  return [...named, ...nearby];
}

function writePopulations(geoNames) {
  const source = require.resolve('country-state-city/lib/cjs/assets/city.json');
  const populations = {};
  let total = 0;
  let matched = 0;
  for (const [name, country, state, lat, lng] of JSON.parse(
    fs.readFileSync(source, 'utf8'),
  )) {
    total++;
    const point = { lat: Number(lat), lng: Number(lng) };
    let best;
    for (const { place, limit } of candidates(geoNames, country, name, point)) {
      const km = distanceKm(point, place);
      if (km <= limit && (!best || km < best.km)) best = { km, place };
    }
    if (!best) continue;
    matched++;
    const states = (populations[country] ??= {});
    (states[state] ??= {})[name] = best.place.population;
  }

  fs.writeFileSync(out, JSON.stringify(populations));
  console.log(
    `fetch-city-populations: matched ${matched} of ${total} cities, wrote ${path.relative(process.cwd(), out)}`,
  );
}

/** Lower case without accents, so "Kōfu" matches "Kofu". */
function normalise(name) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
