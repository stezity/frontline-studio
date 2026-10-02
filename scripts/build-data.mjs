// Builds per-province OSM data for Frontline Studio.
//
// For every relation listed in regions.json it downloads, from OpenStreetMap (Overpass API):
//   - settlements: city/town/village/hamlet polygons and municipal boundaries (admin_level 8–9);
//     villages mapped only as a point get an approximate territory (Voronoi cell, max ~2.5 km);
//   - military areas (landuse=military, military=*), airfields (aeroway=aerodrome);
//   - named peaks.
// Output: data/regions/<id>.json and data/index.json (compact, simplified, coordinates rounded to ~1 m).
//
// Usage: node scripts/build-data.mjs            (all regions)
//        node scripts/build-data.mjs 318236     (only the given relation ids)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'FrontlineStudio-data-builder/1.0';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const SIMPLIFY = 0.00004;      // ~4 m
const APPROX_RADIUS_KM = 2.5;  // max size of an approximate village territory

const sleep = ms => new Promise(r => setTimeout(r, ms));
const round = c => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];

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

// --- geometry assembly from Overpass `out geom` ---------------------------------------------
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function assembleRings(ways) {
  const rings = [], pool = ways.filter(w => w.length > 1).map(w => w.slice());
  while (pool.length) {
    let ring = pool.shift(), guard = 0;
    while (!same(ring[0], ring.at(-1)) && guard++ < 10000) {
      const end = ring.at(-1), i = pool.findIndex(w => same(w[0], end) || same(w.at(-1), end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0];
      if (!same(w[0], end)) w.reverse();
      ring = ring.concat(w.slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring);
  }
  return rings;
}
const pts = g => g.map(p => [p.lon, p.lat]);
function elementGeometry(el) {
  let outer = [], inner = [];
  if (el.type === 'way') {
    if (!el.geometry) return null;
    const ring = pts(el.geometry);
    if (ring.length < 4 || !same(ring[0], ring.at(-1))) return null;
    outer = [ring];
  } else if (el.type === 'relation') {
    for (const m of el.members || []) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? inner : outer).push(pts(m.geometry));
    outer = assembleRings(outer); inner = assembleRings(inner);
  } else return null;
  if (!outer.length) return null;
  const polys = outer.map(r => [r]);
  for (const h of inner) {
    const owner = polys.find(p => { try { return turf.booleanPointInPolygon(h[0], turf.polygon([p[0]])); } catch { return false; } });
    if (owner) owner.push(h);
  }
  try {
    let f = turf.multiPolygon(polys);
    f = turf.simplify(f, { tolerance: SIMPLIFY, highQuality: false });
    const coords = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
      .map(p => p.map(r => dedupeRing(r.map(round))).filter(r => r.length >= 4)).filter(p => p.length);
    if (!coords.length) return null;
    return { type: 'MultiPolygon', coordinates: coords };
  } catch { return null; }
}
function dedupeRing(r) {
  const out = [];
  for (const c of r) if (!out.length || !same(out.at(-1), c)) out.push(c);
  if (out.length && !same(out[0], out.at(-1))) out.push(out[0]);
  return out;
}

// --- classification --------------------------------------------------------------------------
const nameOf = t => t['name:ru'] || t['name:en'] || t.name || '';
// All name variants (ru/en/local/he/ar), lowercased, for search in the app.
const namesOf = t => [...new Set(['name:ru', 'name:en', 'name', 'name:he', 'name:ar', 'int_name', 'alt_name'].map(k => t[k]).filter(Boolean).map(s => s.toLowerCase()))].join('|');
const PLACE = { city: 'Город', town: 'Город', village: 'Посёлок', hamlet: 'Деревня' };
const MIL = { base: 'Военная база', barracks: 'Казармы', airfield: 'Военный аэродром', naval_base: 'Военно-морская база',
  training_area: 'Полигон', range: 'Стрельбище', danger_area: 'Опасная зона', checkpoint: 'Блокпост', bunker: 'Бункер', office: 'Военное учреждение' };
function classify(t) {
  if (t.boundary === 'administrative') return { k: 'settlement', s: 'Муниципалитет' };
  if (t.place && PLACE[t.place]) return { k: 'settlement', s: PLACE[t.place] };
  if (t.aeroway === 'aerodrome') return { k: 'airfield', s: t['aerodrome:type'] === 'military' || t.military ? 'Военный аэродром' : 'Аэродром' };
  if (t.military === 'airfield') return { k: 'airfield', s: 'Военный аэродром' };
  if (t.landuse === 'military' || t.military) return { k: 'military', s: MIL[t.military] || 'Военная территория' };
  return null;
}

async function regionBoundary(id) {
  const d = await overpass(`[out:json][timeout:300];rel(${id});out geom;`);
  const el = d.elements.find(e => e.type === 'relation');
  if (!el) throw new Error('relation not found: ' + id);
  let g = elementGeometry(el);
  const simple = turf.simplify(turf.feature(g), { tolerance: 0.0003, highQuality: false }).geometry;
  return { name: nameOf(el.tags || {}), geometry: g, simple };
}

async function buildRegion(id) {
  console.log(`Region ${id}: boundary…`);
  const region = await regionBoundary(id);
  console.log(`  ${region.name}: objects…`);
  const area = `rel(${id});map_to_area->.a;`;
  const d = await overpass(`[out:json][timeout:600];${area}(
    way["place"~"^(city|town|village|hamlet)$"](area.a);
    rel["place"~"^(city|town|village|hamlet)$"](area.a);
    rel["boundary"="administrative"]["admin_level"~"^(8|9)$"](area.a);
    way["landuse"="military"](area.a);rel["landuse"="military"](area.a);
    way["military"](area.a);rel["military"](area.a);
    way["aeroway"="aerodrome"](area.a);rel["aeroway"="aerodrome"](area.a);
  );out geom;`);
  await sleep(3000);
  const nodes = await overpass(`[out:json][timeout:300];${area}(
    node["place"~"^(city|town|village|hamlet)$"](area.a);
    node["natural"~"^(peak|volcano)$"]["name"](area.a);
  );out;`);

  const features = [];
  for (const el of d.elements) {
    const t = el.tags || {}, c = classify(t);
    if (!c) continue;
    const g = elementGeometry(el);
    if (!g) continue;
    let p; try { p = turf.pointOnFeature(turf.feature(g)).geometry.coordinates; } catch { continue; }
    if (!turf.booleanPointInPolygon(p, turf.feature(region.geometry))) continue;
    const f = { k: c.k, n: nameOf(t), q: namesOf(t), s: c.s, p: round(p), g, id: el.type[0] + el.id };
    if (t.population) f.pop = +String(t.population).replace(/\D/g, '') || undefined;
    if (t.boundary === 'administrative') f.adm = 1;
    features.push(f);
  }

  // Regional councils (one municipal polygon spanning many villages) are not settlements themselves.
  const settlements = features.filter(f => f.k === 'settlement');
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f.adm) continue;
    let inside = 0;
    for (const o of settlements) if (o !== f && turf.booleanPointInPolygon(o.p, turf.feature(f.g)) && ++inside >= 2) break;
    if (inside >= 2) features.splice(i, 1);
  }
  // Huge "military" areas that contain villages (historic security zones, danger areas over whole
  // districts) are not bases — drop them so they do not hatch half the map.
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.k !== 'military') continue;
    const km2 = turf.area(turf.feature(f.g)) / 1e6;
    let inside = 0;
    if (km2 > 1) for (const o of settlements) if (turf.booleanPointInPolygon(o.p, turf.feature(f.g)) && ++inside >= 3) break;
    if (km2 > 100 || inside >= 3) features.splice(i, 1);
  }
  // A built-up outline lying inside a municipal territory is the same settlement (names often differ
  // only by language): keep the municipal territory.
  const municipal = features.filter(f => f.adm), cyr = /[а-яё]/i;
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.k !== 'settlement' || f.adm) continue;
    const m = municipal.find(m => turf.booleanPointInPolygon(f.p, turf.feature(m.g)));
    if (!m) continue;
    if (cyr.test(f.n) && !cyr.test(m.n)) m.n = f.n;
    m.q = [...new Set([...(m.q || '').split('|'), ...(f.q || '').split('|')].filter(Boolean))].join('|');
    features.splice(i, 1);
  }

  // Villages mapped only as a point: approximate territory = Voronoi cell, clipped to the region,
  // to a ~2.5 km radius and to land not already covered by a real settlement polygon.
  const real = features.filter(f => f.k === 'settlement');
  const placeNodes = nodes.elements.filter(e => e.type === 'node' && e.tags?.place && PLACE[e.tags.place])
    .filter(e => !real.some(f => { try { return turf.booleanPointInPolygon([e.lon, e.lat], turf.feature(f.g)); } catch { return false; } }));
  if (placeNodes.length) {
    const bbox = turf.bbox(turf.feature(region.geometry));
    const pointsFc = turf.featureCollection(placeNodes.map(e => turf.point([e.lon, e.lat], { tags: e.tags })));
    const cells = turf.voronoi(pointsFc, { bbox });
    const regionF = turf.feature(region.simple);
    cells.features.forEach((cell, i) => {
      if (!cell) return;
      const e = placeNodes[i];
      try {
        let shape = turf.intersect(turf.featureCollection([cell, regionF]));
        if (!shape) return;
        shape = turf.intersect(turf.featureCollection([shape, turf.circle([e.lon, e.lat], APPROX_RADIUS_KM, { steps: 24 })]));
        if (!shape) return;
        const sb = turf.bbox(shape);
        for (const f of real) {
          const fb = f.bb ??= turf.bbox(turf.feature(f.g));
          if (fb[0] > sb[2] || fb[2] < sb[0] || fb[1] > sb[3] || fb[3] < sb[1]) continue;
          shape = turf.difference(turf.featureCollection([shape, turf.feature(f.g)]));
          if (!shape) return;
        }
        shape = turf.simplify(shape, { tolerance: SIMPLIFY * 3 });
        const geom = shape.geometry, coords = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
          .map(p => p.map(r => dedupeRing(r.map(round))).filter(r => r.length >= 4)).filter(p => p.length);
        if (!coords.length) return;
        const f = { k: 'settlement', n: nameOf(e.tags), q: namesOf(e.tags), s: PLACE[e.tags.place], a: 1, p: round([e.lon, e.lat]), g: { type: 'MultiPolygon', coordinates: coords }, id: 'n' + e.id };
        if (e.tags.population) f.pop = +String(e.tags.population).replace(/\D/g, '') || undefined;
        features.push(f);
      } catch { /* skip broken cell */ }
    });
  }
  for (const f of real) delete f.bb;

  // Named peaks (points), highest first.
  const peaks = nodes.elements.filter(e => e.type === 'node' && /^(peak|volcano)$/.test(e.tags?.natural || ''))
    .map(e => ({ k: 'peak', n: nameOf(e.tags), q: namesOf(e.tags), s: e.tags.natural === 'volcano' ? 'Вулкан' : 'Высота', p: round([e.lon, e.lat]), ele: parseFloat(e.tags.ele) || null, id: 'n' + e.id }))
    .sort((a, b) => (b.ele || 0) - (a.ele || 0)).slice(0, 80);
  features.push(...peaks);

  const counts = {};
  for (const f of features) counts[f.k] = (counts[f.k] || 0) + 1;
  counts.approx = features.filter(f => f.a).length;
  const out = {
    id, name: region.name, updated: new Date().toISOString(),
    bbox: turf.bbox(turf.feature(region.geometry)).map(v => Math.round(v * 1e4) / 1e4),
    boundary: { type: region.simple.type, coordinates: region.simple.coordinates },
    counts, features,
  };
  await fs.writeFile(path.join(ROOT, 'data', 'regions', `${id}.json`), JSON.stringify(out));
  console.log(`  ✓ ${region.name}:`, JSON.stringify(counts));
  return { id, name: region.name, file: `regions/${id}.json`, bbox: out.bbox, counts, updated: out.updated };
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
    const entry = await buildRegion(r.id);
    index.regions = index.regions.filter(x => x.id !== r.id).concat(entry);
  } catch (e) { failed++; console.error(`  ✗ ${r.id} (${r.name || ''}): ${e.message}`); }
  await sleep(5000);
}
// Drop regions removed from regions.json.
const wanted = new Set(config.regions.map(r => r.id));
index.regions = index.regions.filter(x => wanted.has(x.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
index.updated = new Date().toISOString();
await fs.writeFile(indexPath, JSON.stringify(index, null, 1));
console.log(`Done: ${index.regions.length} regions, ${failed} failed.`);
if (failed) process.exitCode = 1;
