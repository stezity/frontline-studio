// Builds per-province OSM data for Frontline Studio into data/ (GitHub Action and local use).
// The processing itself lives in osm-core.mjs and is shared with the app, which builds provinces
// that are missing here directly in the browser.
//
// Usage: node scripts/build-data.mjs            (all regions from regions.json)
//        node scripts/build-data.mjs 318236     (only the given relation ids)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';
import { osmQueries, osmBuildFeatures, osmElementGeometry, osmNameOf, osmLooksBroken, osmAreaFor, osmDateLabel } from './osm-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'FrontlineStudio-data-builder/1.0';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const round4 = v => Math.round(v * 1e4) / 1e4;

async function overpass(query) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          signal: AbortSignal.timeout(400_000),
        });
        const text = await r.text();
        if (!r.ok) { last = new Error(`${url}: HTTP ${r.status}`); continue; }
        const json = JSON.parse(text);
        if (json.remark && /error|timed out/i.test(json.remark) && !json.elements?.length) { last = new Error(`${url}: ${json.remark}`); continue; }
        return json;
      } catch (e) { last = new Error(`${url}: ${e.message}`); }
    }
    console.warn('  Overpass busy, retrying…', last?.message);
    await sleep(15_000 * (attempt + 1));
  }
  throw last;
}

async function buildRegion(id, cfg = {}) {
  console.log(`Region ${id}: boundary…`);
  const rel = (await overpass(`[out:json][timeout:300];rel(${id});out geom;`)).elements.find(e => e.type === 'relation');
  if (!rel) throw new Error('relation not found');
  const boundary = osmElementGeometry(turf, rel);
  if (!boundary) throw new Error('relation has no closed boundary');
  const name = osmNameOf(rel.tags || {});
  const bbox = turf.bbox(turf.feature(boundary)), [w, s, e, n] = bbox;
  // regions.json may pin a date; otherwise known areas (osm-core OSM_SNAPSHOTS) use their snapshot
  const area = cfg.date === 'current' ? null : osmAreaFor(id, bbox), date = cfg.date === 'current' ? null : cfg.date || area?.date || null;
  const q = osmQueries([s, w, n, e].map(v => v.toFixed(5)).join(','), { date, districts: !!area?.districts });
  console.log(`  ${name}: objects${date ? ' (OSM на ' + osmDateLabel(date) + ')' : ''}…`);
  const objects = await overpass(q.objects);
  await sleep(3000);
  const nodes = await overpass(q.nodes);
  if (osmLooksBroken(objects, nodes)) throw new Error('пустой ответ на запрос объектов — вероятно, сбой зеркала Overpass');
  await sleep(3000);
  const residential = await overpass(q.residential);
  const { features, counts } = osmBuildFeatures(turf, { boundary, objects, nodes, residential, area });
  const simple = turf.simplify(turf.feature(boundary), { tolerance: 0.0003, highQuality: false }).geometry;
  const out = {
    id, name, updated: new Date().toISOString(), ...(date ? { snapshot: date } : {}),
    bbox: turf.bbox(turf.feature(boundary)).map(round4),
    boundary: { type: simple.type, coordinates: simple.coordinates },
    counts, features,
  };
  const file = path.join(ROOT, 'data', 'regions', `${id}.json`);
  let prev = null;
  try { prev = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  // A sudden collapse (half the military objects or settlement outlines gone) is almost always a broken
  // Overpass response rather than a real change in OSM: keep the previous data and report it.
  // (only when comparing like with like: switching a province to a dated snapshot changes everything)
  if (prev?.counts && (prev.snapshot || null) === date) {
    const real = c => (c.settlement || 0) - (c.approx || 0);
    for (const [label, before, now] of [['военных объектов', prev.counts.military || 0, counts.military || 0],
      ['аэродромов', prev.counts.airfield || 0, counts.airfield || 0], ['контуров поселений', real(prev.counts), real(counts)]])
      if (before >= 5 && now < before * 0.5) throw new Error(`подозрительное падение: ${label} ${before} → ${now}; оставлены прежние данные`);
  }
  // Keep the previous file (and its timestamp) when nothing changed, so scheduled runs do not commit noise.
  if (prev) {
    const strip = d => JSON.stringify({ ...d, updated: undefined });
    if (strip(prev) === strip(out)) out.updated = prev.updated;
  }
  await fs.writeFile(file, JSON.stringify(out));
  console.log(`  ✓ ${name}:`, JSON.stringify(counts));
  return { id, name, file: `regions/${id}.json`, bbox: out.bbox, counts, updated: out.updated, ...(date ? { snapshot: date } : {}) };
}

const config = JSON.parse(await fs.readFile(path.join(ROOT, 'regions.json'), 'utf8'));
const only = process.argv.slice(2).map(Number).filter(Boolean);
const indexPath = path.join(ROOT, 'data', 'index.json');
let index = { regions: [] };
try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch {}
await fs.mkdir(path.join(ROOT, 'data', 'regions'), { recursive: true });

let failed = 0;
for (const r of config.regions) {
  if (only.length && !only.includes(r.id)) continue;
  try {
    const entry = await buildRegion(r.id, r);
    index.regions = index.regions.filter(x => x.id !== r.id).concat(entry);
  } catch (e) { failed++; console.error(`  ✗ ${r.id} (${r.name || ''}): ${e.message}`); }
  await sleep(5000);
}
const wanted = new Set(config.regions.map(r => r.id));
index.regions = index.regions.filter(x => wanted.has(x.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
index.updated = index.regions.reduce((m, r) => (r.updated > m ? r.updated : m), '');
await fs.writeFile(indexPath, JSON.stringify(index, null, 1));
console.log(`Done: ${index.regions.length} regions, ${failed} failed.`);
if (failed) process.exitCode = 1;
