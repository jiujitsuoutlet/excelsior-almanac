// GeoNames cities500 -> almanac D1 `places`, for deriving a US state from an
// event's coordinates (founder ruling, 2026-09-20).
//
// Same source file, same admin1 mapping and the SAME stable geoname_id keys
// as the app's own gazetteer import (excelsior-master,
// scripts/import-geonames-places.mjs). That is the point: a state this crawl
// derives is a state the app's own places table would name for the same
// point, because both sides are the same rows from one file, not two
// independently-built lists that happen to agree today. cities500 is
// GeoNames, CC BY 4.0.
//
// Idempotent: INSERT OR REPLACE on geoname_id, so re-running with the same
// or a newer dump updates rows instead of duplicating them.
//
//   node scripts/import-places-d1.mjs --target=staging [--limit=N] [--dry-run]
//
// Writes a .sql file and applies it with `wrangler d1 execute --file`, which
// is the only path that can load twenty thousand rows in one go without
// twenty thousand round trips.

import fs from 'node:fs';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const TARGET = args.target;
if (TARGET !== 'staging' && TARGET !== 'production') {
  console.error('Usage: --target=staging|production required');
  process.exit(1);
}
const DB_NAME = TARGET === 'staging' ? 'almanac-staging' : 'almanac';
const DRY_RUN = Boolean(args['dry-run']);
const LIMIT = args.limit ? Number(args.limit) : Infinity;

const SCRATCH = process.env.SCRATCH
  || '/private/tmp/claude-501/-Users-jessietillman-jjo-excelsior-master/7cb003ff-bf7d-4fa1-b2e7-877f9e83106f/scratchpad';
const CITIES_PATH = args.cities || `${SCRATCH}/cities500.txt`;
const ADMIN1_PATH = args.admin1 || `${SCRATCH}/admin1CodesASCII.txt`;
const OUT_PATH = args.out || `${SCRATCH}/places-d1.sql`;

function loadAdmin1Codes() {
  const codes = new Set();
  for (const line of fs.readFileSync(ADMIN1_PATH, 'utf8').split('\n')) {
    const [code] = line.split('\t');
    if (code && code.startsWith('US.')) codes.add(code.slice(3));
  }
  return codes;
}

const lit = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

async function main() {
  const admin1 = loadAdmin1Codes();
  const rl = readline.createInterface({ input: fs.createReadStream(CITIES_PATH), crlfDelay: Infinity });
  const rows = [];
  for await (const line of rl) {
    if (rows.length >= LIMIT) break;
    const f = line.split('\t');
    // cities500 column order: geonameid, name, asciiname, alternatenames,
    // latitude, longitude, feature class, feature code, country code, cc2,
    // admin1 code, ...
    const [geonameId, name, asciiName, , lat, lon, , , country, , admin1Code] = f;
    if (country !== 'US') continue;
    if (!admin1.has(admin1Code)) continue;
    const city = (asciiName || name || '').trim();
    const population = Number(f[14]);
    if (!city || !lat || !lon) continue;
    rows.push({
      geoname_id: Number(geonameId),
      city,
      state: admin1Code.toUpperCase(),
      lat: Number(lat),
      lon: Number(lon),
      population: Number.isFinite(population) ? population : null,
    });
  }

  const sql = rows
    .map((r) => `INSERT OR REPLACE INTO places (geoname_id, city, state, country, lat, lon, population) VALUES (${r.geoname_id}, ${lit(r.city)}, ${lit(r.state)}, 'US', ${r.lat}, ${r.lon}, ${r.population ?? 'null'});`)
    .join('\n');
  fs.writeFileSync(OUT_PATH, `${sql}\n`);
  console.log(`${rows.length} US places -> ${OUT_PATH}`);
  if (DRY_RUN) {
    console.log('--dry-run: not applied');
    return;
  }
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, ...(TARGET === 'staging' ? ['--env', 'staging'] : []), '--remote', '--config', 'scout/wrangler.toml', '--file', OUT_PATH], { stdio: 'inherit' });
}

await main();
