#!/usr/bin/env node
/**
 * Splits country-state-city's 8 MB city.json into one small file per country
 * under data/cities/<alpha-2>.json, shaped { [stateCode]: [[name, lat, lng]] }.
 *
 * Loading city.json in the API process costs about 180 MB of RSS, enough to
 * fail the health check, so LocationsService reads only the country it is
 * asked for. Runs on postinstall; the output is gitignored.
 */
const fs = require('fs');
const path = require('path');

const source = require.resolve('country-state-city/lib/cjs/assets/city.json');
const outDir = path.resolve(__dirname, '..', 'data', 'cities');

const byCountry = {};
for (const [name, country, state, lat, lng] of JSON.parse(
  fs.readFileSync(source, 'utf8'),
)) {
  const states = (byCountry[country] ??= {});
  (states[state] ??= []).push([name, lat, lng]);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const [country, states] of Object.entries(byCountry)) {
  fs.writeFileSync(
    path.join(outDir, `${country}.json`),
    JSON.stringify(states),
  );
}

console.log(
  `split-cities: wrote ${Object.keys(byCountry).length} files to ${path.relative(process.cwd(), outDir)}`,
);
