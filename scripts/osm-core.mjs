// Shared OpenStreetMap → Frontline Studio data processing.
// Used by scripts/build-data.mjs (Node) and inlined into index.html (the browser builds missing
// provinces itself), so both produce the same data. No imports: turf is passed in.
//
// Feature format: { k: kind, n: name, q: name variants for search, s: subtype, p: [lon,lat] point,
//                   g: MultiPolygon (absent for point-only villages), id: 'w123' | 'r123' | 'n123',
//                   pop?, ele?, adm? (municipal territory), b? (outlined by residential areas), pt? (point only) }

export const OSM_SIMPLIFY = 0.00004;   // ~4 m
export const OSM_BUILTUP_KM = 2;       // residential areas farther than this from a village are not attributed to it
export const OSM_PLACE = { city: 'Город', town: 'Город', village: 'Посёлок', hamlet: 'Деревня' };
export const OSM_MIL = { base: 'Военная база', barracks: 'Казармы', airfield: 'Военный аэродром', naval_base: 'Военно-морская база',
  training_area: 'Полигон', range: 'Стрельбище', danger_area: 'Опасная зона', checkpoint: 'Блокпост', bunker: 'Бункер', office: 'Военное учреждение' };

// Overpass queries for a bounding box "south,west,north,east". Bounding boxes (not map_to_area):
// area queries silently return nothing on mirrors without an areas database.
export function osmQueries(bb) {
  return {
    objects: `[out:json][timeout:600];(way["place"~"^(city|town|village|hamlet)$"](${bb});rel["place"~"^(city|town|village|hamlet)$"](${bb});rel["boundary"="administrative"]["admin_level"~"^(8|9)$"](${bb});way["landuse"="military"](${bb});rel["landuse"="military"](${bb});way["military"](${bb});rel["military"](${bb});way["aeroway"="aerodrome"](${bb});rel["aeroway"="aerodrome"](${bb}););out geom;`,
    nodes: `[out:json][timeout:300];(node["place"~"^(city|town|village|hamlet)$"](${bb});node["natural"~"^(peak|volcano)$"]["name"](${bb}););out;`,
    residential: `[out:json][timeout:600];(way["landuse"="residential"](${bb});rel["landuse"="residential"](${bb}););out geom;`,
  };
}

export const osmRound = c => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
const osmSame = (a, b) => a[0] === b[0] && a[1] === b[1];
export const osmNameOf = t => t['name:ru'] || t['name:en'] || t.name || '';
export const osmNamesOf = t => [...new Set(['name:ru', 'name:en', 'name', 'name:he', 'name:ar', 'int_name', 'alt_name'].map(k => t[k]).filter(Boolean).map(s => s.toLowerCase()))].join('|');

export function osmDedupeRing(r) {
  const out = [];
  for (const c of r) if (!out.length || !osmSame(out[out.length - 1], c)) out.push(c);
  if (out.length && !osmSame(out[0], out[out.length - 1])) out.push(out[0]);
  return out;
}
export function osmAssembleRings(ways) {
  const rings = [], pool = ways.filter(w => w.length > 1).map(w => w.slice());
  while (pool.length) {
    let ring = pool.shift(), guard = 0;
    while (!osmSame(ring[0], ring[ring.length - 1]) && guard++ < 10000) {
      const end = ring[ring.length - 1], i = pool.findIndex(w => osmSame(w[0], end) || osmSame(w[w.length - 1], end));
      if (i < 0) break;
      const w = pool.splice(i, 1)[0];
      if (!osmSame(w[0], end)) w.reverse();
      ring = ring.concat(w.slice(1));
    }
    if (ring.length >= 4 && osmSame(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}
function osmCleanPolys(turf, polys, tolerance) {
  let f = turf.multiPolygon(polys);
  if (tolerance) f = turf.simplify(f, { tolerance, highQuality: false });
  const coords = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map(p => p.map(r => osmDedupeRing(r.map(osmRound))).filter(r => r.length >= 4)).filter(p => p.length);
  return coords.length ? { type: 'MultiPolygon', coordinates: coords } : null;
}
// Overpass `out geom` element → simplified MultiPolygon (null when it is not a closed area).
export function osmElementGeometry(turf, el) {
  const pts = g => g.map(p => [p.lon, p.lat]);
  let outer = [], inner = [];
  if (el.type === 'way') {
    if (!el.geometry) return null;
    const ring = pts(el.geometry);
    if (ring.length < 4 || !osmSame(ring[0], ring[ring.length - 1])) return null;
    outer = [ring];
  } else if (el.type === 'relation') {
    for (const m of el.members || []) if (m.type === 'way' && m.geometry) (m.role === 'inner' ? inner : outer).push(pts(m.geometry));
    outer = osmAssembleRings(outer); inner = osmAssembleRings(inner);
  } else return null;
  if (!outer.length) return null;
  const polys = outer.map(r => [r]);
  for (const h of inner) {
    const owner = polys.find(p => { try { return turf.booleanPointInPolygon(h[0], turf.polygon([p[0]])); } catch { return false; } });
    if (owner) owner.push(h);
  }
  try { return osmCleanPolys(turf, polys, OSM_SIMPLIFY); } catch { return null; }
}
export function osmClassify(t) {
  if (t.boundary === 'administrative') return { k: 'settlement', s: 'Муниципалитет' };
  if (t.place && OSM_PLACE[t.place]) return { k: 'settlement', s: OSM_PLACE[t.place] };
  if (t.aeroway === 'aerodrome') return { k: 'airfield', s: t['aerodrome:type'] === 'military' || t.military ? 'Военный аэродром' : 'Аэродром' };
  if (t.military === 'airfield') return { k: 'airfield', s: 'Военный аэродром' };
  if (t.landuse === 'military' || t.military) return { k: 'military', s: OSM_MIL[t.military] || 'Военная территория' };
  return null;
}

// Raw Overpass answers + the province boundary → features and counts.
export function osmBuildFeatures(turf, { boundary, objects, nodes, residential }) {
  const regionF = turf.feature(boundary);
  const inRegion = c => { try { return turf.booleanPointInPolygon(c, regionF); } catch { return false; } };
  const features = [];
  for (const el of objects.elements || []) {
    const t = el.tags || {}, c = osmClassify(t);
    if (!c) continue;
    const g = osmElementGeometry(turf, el);
    if (!g) continue;
    let p; try { p = turf.pointOnFeature(turf.feature(g)).geometry.coordinates; } catch { continue; }
    if (!inRegion(p)) continue;
    const f = { k: c.k, n: osmNameOf(t), q: osmNamesOf(t), s: c.s, p: osmRound(p), g, id: el.type[0] + el.id };
    if (t.population) f.pop = +String(t.population).replace(/\D/g, '') || undefined;
    if (t.boundary === 'administrative') f.adm = 1;
    features.push(f);
  }
  const inF = (c, f) => { try { return turf.booleanPointInPolygon(c, turf.feature(f.g)); } catch { return false; } };
  // Regional councils (one municipal polygon spanning many villages) are not settlements themselves.
  const settlements = features.filter(f => f.k === 'settlement');
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f.adm) continue;
    let inside = 0;
    for (const o of settlements) if (o !== f && inF(o.p, f) && ++inside >= 2) break;
    if (inside >= 2) features.splice(i, 1);
  }
  // Huge "military" areas containing villages (historic security zones, district-wide danger areas) are not bases.
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.k !== 'military') continue;
    const km2 = turf.area(turf.feature(f.g)) / 1e6;
    let inside = 0;
    if (km2 > 1) for (const o of settlements) if (inF(o.p, f) && ++inside >= 3) break;
    if (km2 > 100 || inside >= 3) features.splice(i, 1);
  }
  // A built-up outline inside a municipal territory is the same settlement (names often differ only by language).
  const municipal = features.filter(f => f.adm), cyr = /[а-яё]/i;
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.k !== 'settlement' || f.adm) continue;
    const m = municipal.find(m => inF(f.p, m));
    if (!m) continue;
    if (cyr.test(f.n) && !cyr.test(m.n)) m.n = f.n;
    m.q = [...new Set([...(m.q || '').split('|'), ...(f.q || '').split('|')].filter(Boolean))].join('|');
    features.splice(i, 1);
  }
  // Villages mapped only as a point get their real built-up area: residential landuse polygons (traced
  // from imagery) are attributed to the nearest such village within 2 km and merged. Nothing is
  // synthesised — a village without any mapped polygon stays a named point.
  const real = features.filter(f => f.k === 'settlement');
  const boxes = new Map(real.map(f => [f, turf.bbox(turf.feature(f.g))]));
  const inReal = c => real.some(f => { const b = boxes.get(f); return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3] && inF(c, f); });
  const nodeEls = (nodes.elements || []).filter(e => e.type === 'node' && inRegion([e.lon, e.lat]));
  const placeNodes = nodeEls.filter(e => e.tags?.place && OSM_PLACE[e.tags.place] && !inReal([e.lon, e.lat]));
  const groups = new Map(placeNodes.map(e => [e.id, []]));
  for (const el of (residential?.elements || [])) {
    const g = osmElementGeometry(turf, el);
    if (!g) continue;
    let p; try { p = turf.pointOnFeature(turf.feature(g)).geometry.coordinates; } catch { continue; }
    if (!inRegion(p) || inReal(p)) continue;
    let best = null, bestD = OSM_BUILTUP_KM;
    for (const e of placeNodes) { const d = turf.distance(p, [e.lon, e.lat]); if (d < bestD) { bestD = d; best = e; } }
    if (!best || real.some(f => turf.distance(p, f.p) < bestD)) continue;
    groups.get(best.id).push(g);
  }
  for (const e of placeNodes) {
    const f = { k: 'settlement', n: osmNameOf(e.tags), q: osmNamesOf(e.tags), s: OSM_PLACE[e.tags.place], p: osmRound([e.lon, e.lat]), id: 'n' + e.id };
    if (e.tags.population) f.pop = +String(e.tags.population).replace(/\D/g, '') || undefined;
    const parts = groups.get(e.id);
    if (parts.length) {
      let polys;
      try {
        const merged = parts.length === 1 ? turf.feature(parts[0]) : turf.union(turf.featureCollection(parts.map(g => turf.feature(g))));
        polys = merged.geometry.type === 'Polygon' ? [merged.geometry.coordinates] : merged.geometry.coordinates;
      } catch { polys = parts.flatMap(g => g.coordinates); }
      try { const g = osmCleanPolys(turf, polys, 0); if (g) { f.g = g; f.b = 1; } } catch {}
    }
    if (!f.g) f.pt = 1;
    features.push(f);
  }
  // Named peaks (points), highest first.
  features.push(...nodeEls.filter(e => /^(peak|volcano)$/.test(e.tags?.natural || ''))
    .map(e => ({ k: 'peak', n: osmNameOf(e.tags), q: osmNamesOf(e.tags), s: e.tags.natural === 'volcano' ? 'Вулкан' : 'Высота', p: osmRound([e.lon, e.lat]), ele: parseFloat(e.tags.ele) || null, id: 'n' + e.id }))
    .sort((a, b) => (b.ele || 0) - (a.ele || 0)).slice(0, 80));
  const counts = {};
  for (const f of features) counts[f.k] = (counts[f.k] || 0) + 1;
  counts.approx = features.filter(f => f.pt).length;
  counts.builtup = features.filter(f => f.b).length;
  return { features, counts };
}

// A plausibility check: an empty object answer for a province with many villages means a broken mirror.
export function osmLooksBroken(objects, nodes) {
  return !(objects.elements || []).length && (nodes.elements || []).filter(e => e.tags?.place).length > 20;
}
