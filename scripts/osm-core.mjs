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

// Areas where current OSM data is not usable for the map and an older snapshot is used instead.
// Gaza Strip: since 2023 editors delete or retag destroyed towns (Rafah became landuse=brownfield,
// municipal boundaries of Beit Hanoun, Abasan, Khuza'a disappear), so the Strip and its governorates
// (wiki.openstreetmap.org/wiki/Gaza_Strip/Region) are built from OSM as of the end of 2021.
// districts: also city districts (admin_level=10), refugee camps and quarters (place=suburb…), and
// villages inside a town's municipality, as point or outline "districts" (f.dist).
// ru: Russian names for places OSM names only in Arabic/English/Hebrew (keys: any OSM name, lowercase).
export const OSM_SNAPSHOTS = [
  { name: 'Сектор Газа', date: '2021-12-31T00:00:00Z', districts: true, bbox: [34.2, 31.2, 34.58, 31.6],
    ids: [1473938, 4731200, 3935814, 4731198, 4731199, 4731201],
    ru: {
      'bani suheila': 'Бани-Сухейла', 'abasan al-kabira': 'Абасан-эль-Кабира', "'abasan al-saghira": 'Абасан-эс-Сагира',
      'abasan al-saghira': 'Абасан-эс-Сагира', "khuza'a": 'Хузаа', 'al-qarara': 'Эль-Карара', 'nuseirat': 'Нусейрат',
      'bureij': 'Эль-Бурейдж', 'al-maghazi': 'Эль-Магази', 'al maghazi': 'Эль-Магази', 'a-zawayda': 'Эз-Завайда',
      'az-zawayda': 'Эз-Завайда', 'wadi a-salqa': 'Вади-эс-Салка', 'al-musaddar': 'Эль-Мусаддар', 'juhor a-dik': 'Джухор-эд-Дик',
      'al-mughraqa': 'Эль-Муграка', 'a-zahra': 'Эз-Захра', 'al-zahra': 'Эз-Захра', 'az-zahra': 'Эз-Захра',
      'um a-nasser': 'Умм-эн-Наср', 'al-nasr': 'Эн-Наср', 'shokat a-sufi': 'Шокат-эс-Суфи', 'al-fukhari': 'Эль-Фухари',
      // Gaza City districts; Shuja'iyya is split into the al-Jadida and Turkman quarters
      'zeitun': 'Зейтун', 'tuffah': 'Туффах', 'ejdaida': 'Шуджаия (Эль-Джадида)', 'east ejdaida': 'Шуджаия (Восточная Джадида)',
      'تركمان': 'Шуджаия (Туркман)', 'east turkman': 'Шуджаия (Восточный Туркман)', 'old city': 'Старый город',
      'tal al hawa': 'Тель-эль-Хава', 'sabra': 'Сабра', 'daraj': 'Эд-Дарадж', 'south remal': 'Южный Рималь',
      'north remal': 'Северный Рималь', 'awda city': 'Мадинат-эль-Авда', 'sheikh radwan': 'Шейх-Радван',
      'sheikh redwan': 'Шейх-Радван', 'al nasser': 'Эн-Наср (Газа)', 'sheikh ejilin': 'Шейх-Иджлин',
      // refugee camps and quarters
      'beach camp': 'Лагерь Шати', 'ash-shati refugee camp': 'Лагерь Шати', 'jabalia camp': 'Лагерь Джабалия',
      'bureij refugee camp': 'Лагерь Эль-Бурейдж', 'deir al-balah refugee camp': 'Лагерь Дейр-эль-Балах',
      'rafah refugee camp': 'Лагерь Рафах', 'brazil refugee camp': 'Лагерь Бразилия', 'tall as-sultan': 'Тель-эс-Султан',
      'saknat az zarqa': 'Сакнат-эз-Зарка', 'as salam': 'Эс-Салам', 'block o': 'Блок O', 'block k': 'Блок K', 'block j': 'Блок J',
      'barahmey block': 'Блок Барахме', 'hamad town': 'Хамад', 'حي الشيخ ناصر': 'Шейх-Насер',
      'the swedish village': 'Шведская деревня', 'sudia village': 'Саудовский квартал', 'al nada': 'Эн-Нада',
    } },
];
// The snapshot area a province belongs to: by relation id, or when the province lies inside it.
export function osmAreaFor(id, bbox) {
  for (const a of OSM_SNAPSHOTS) {
    if (a.ids.includes(+id)) return a;
    if (bbox && bbox[0] >= a.bbox[0] && bbox[1] >= a.bbox[1] && bbox[2] <= a.bbox[2] && bbox[3] <= a.bbox[3]) return a;
  }
  return null;
}
export const osmDateFor = (id, bbox) => osmAreaFor(id, bbox)?.date || null;
export const osmDateLabel = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : '';

// Overpass queries for a bounding box "south,west,north,east". Bounding boxes (not map_to_area):
// area queries silently return nothing on mirrors without an areas database.
// date: ISO timestamp for an attic query (OSM as it was at that moment), null for current data;
// districts: also city districts, camps and quarters.
export function osmQueries(bb, { date = null, districts = false } = {}) {
  const at = date ? `[date:"${date}"]` : '';
  const objects = `way["place"~"^(city|town|village|hamlet)$"](${bb});rel["place"~"^(city|town|village|hamlet)$"](${bb});rel["boundary"="administrative"]["admin_level"~"^(8|9${districts ? '|10' : ''})$"](${bb});way["landuse"="military"](${bb});rel["landuse"="military"](${bb});way["military"](${bb});rel["military"](${bb});way["aeroway"="aerodrome"](${bb});rel["aeroway"="aerodrome"](${bb});way["landuse"="brownfield"]["name"](${bb});rel["landuse"="brownfield"]["name"](${bb});`;
  const nodes = `node["place"~"^(city|town|village|hamlet${districts ? '|suburb|quarter|neighbourhood' : ''})$"](${bb});node["natural"~"^(peak|volcano)$"]["name"](${bb});node["historic"="ruins"]["abandoned"="yes"]["name"](${bb});`;
  return {
    objects: `[out:json][timeout:600]${at};(${objects});out geom;`,
    nodes: `[out:json][timeout:300]${at};(${nodes});out;`,
    residential: `[out:json][timeout:600]${at};(way["landuse"="residential"](${bb});rel["landuse"="residential"](${bb}););out geom;`,
    // objects + nodes in a single request (one Overpass slot instead of two); split with osmSplit()
    main: `[out:json][timeout:600]${at};(${objects}${nodes});out geom;`,
  };
}
export function osmSplit(all) {
  const els = all.elements || [];
  return { objects: { elements: els.filter(e => e.type !== 'node') }, nodes: { elements: els.filter(e => e.type === 'node') } };
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
const OSM_CAMP = /camp|مخيم|مخيّم|معسكر|מחנה/i;
export const osmDistrictKind = t => OSM_CAMP.test(osmNamesOf(t) + '|' + (t['name:fr'] || '')) ? 'Лагерь беженцев' : 'Район';
export function osmClassify(t) {
  if (t.boundary === 'administrative')
    return t.admin_level === '10' ? { k: 'settlement', s: osmDistrictKind(t), district: true } : { k: 'settlement', s: 'Муниципалитет' };
  if (t.place && OSM_PLACE[t.place]) return { k: 'settlement', s: OSM_PLACE[t.place] };
  if (t.aeroway === 'aerodrome') return { k: 'airfield', s: t['aerodrome:type'] === 'military' || t.military ? 'Военный аэродром' : 'Аэродром' };
  if (t.military === 'airfield') return { k: 'airfield', s: 'Военный аэродром' };
  if (t.landuse === 'military' || t.military) return { k: 'military', s: OSM_MIL[t.military] || 'Военная территория' };
  if (t.landuse === 'brownfield' && t.name) return { k: 'settlement', s: OSM_RUIN, brownfield: true };
  return null;
}
// A destroyed town: OSM editors drop its place=* tag and mark the point as ruins. Historic abandonments
// (villages of 1948, settlements evacuated in 2005) keep abandoned:place=* and are left out.
export const OSM_RUIN = 'Разрушенный населённый пункт';
export const osmIsRuin = t => !!t && t.historic === 'ruins' && t.abandoned === 'yes' && !t.place && !t['abandoned:place'] && !!t.name;

// Raw Overpass answers + the province boundary → features and counts.
// area: the snapshot area (osmAreaFor) — Russian names and districts.
export function osmBuildFeatures(turf, { boundary, objects, nodes, residential, area = null }) {
  const ru = t => {
    if (!area?.ru || !t) return null;
    for (const k of ['name:en', 'name', 'name:fr', 'alt_name', 'name:ar']) { const v = t[k] && area.ru[String(t[k]).toLowerCase()]; if (v) return v; }
    return null;
  };
  const nameOf = t => ru(t) || osmNameOf(t);
  const namesOf = t => { const r = ru(t); return r ? [...new Set([r.toLowerCase(), ...osmNamesOf(t).split('|')])].join('|') : osmNamesOf(t); };
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
    const f = { k: c.k, n: nameOf(t), q: namesOf(t), s: c.s, p: osmRound(p), g, id: el.type[0] + el.id };
    if (t.population) f.pop = +String(t.population).replace(/\D/g, '') || undefined;
    if (c.district) f.dist = 1;
    else if (t.boundary === 'administrative') f.adm = 1;
    if (c.brownfield) f.bf = 1;
    features.push(f);
  }
  const inF = (c, f) => { try { return turf.booleanPointInPolygon(c, turf.feature(f.g)); } catch { return false; } };
  const ruinNodes = (nodes.elements || []).filter(e => e.type === 'node' && osmIsRuin(e.tags));
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f.bf) continue;
    const names = new Set((f.q || '').split('|'));
    const town = ruinNodes.find(e => inF([e.lon, e.lat], f) && osmNamesOf(e.tags).split('|').some(n => names.has(n)));
    // destroyed towns are retagged as large named brownfields (Rafah, 2024): keep those, or smaller ones
    // that contain a ruined town of the same name; small named lots (single buildings) are dropped
    if (!town && turf.area(turf.feature(f.g)) < 1e6) { features.splice(i, 1); continue; }
    delete f.bf; f.ruin = 1;
    if (town) { f.n = nameOf(town.tags); f.q = [...new Set([...names, ...namesOf(town.tags).split('|')])].join('|'); }
  }
  // Regional councils (one municipal polygon spanning many villages) are not settlements themselves.
  // A town's own municipality is kept even with small places inside it (Rafah contains the Swedish and
  // Saudi villages; snapshot areas): a city, town or village of the same name lies within it. That place point also
  // gives the territory its Russian name and population.
  const settlements = features.filter(f => f.k === 'settlement' && !f.dist);
  const placeEls = (nodes.elements || []).filter(e => e.type === 'node' && OSM_PLACE[e.tags?.place]);
  const ownTown = f => {
    const names = new Set((f.q || '').split('|').filter(Boolean));
    return placeEls.find(e => namesOf(e.tags).split('|').some(n => names.has(n)) && inF([e.lon, e.lat], f));
  };
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (!f.adm) continue;
    let inside = 0;
    for (const o of settlements) if (o !== f && inF(o.p, f) && ++inside >= 2) break;
    const town = ownTown(f);
    if (inside >= 2 && !(town && area?.districts)) { features.splice(i, 1); continue; }
    if (!town) continue;
    if (/[а-яё]/i.test(nameOf(town.tags)) && !/[а-яё]/i.test(f.n)) f.n = nameOf(town.tags);
    f.q = [...new Set([...(f.q || '').split('|'), ...namesOf(town.tags).split('|')].filter(Boolean))].join('|');
    if (!f.pop && town.tags.population) f.pop = +String(town.tags.population).replace(/\D/g, '') || undefined;
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
  // With districts, a differently named place inside a town (Rafah's Swedish village) stays as its district.
  const municipal = features.filter(f => f.adm), cyr = /[а-яё]/i;
  for (let i = features.length - 1; i >= 0; i--) {
    const f = features[i];
    if (f.k !== 'settlement' || f.adm || f.dist) continue;
    const m = municipal.find(m => inF(f.p, m));
    if (!m) continue;
    if (area?.districts && !(f.q || '').split('|').some(n => n && (m.q || '').split('|').includes(n))) { f.dist = 1; continue; }
    if (cyr.test(f.n) && !cyr.test(m.n)) m.n = f.n;
    m.q = [...new Set([...(m.q || '').split('|'), ...(f.q || '').split('|')].filter(Boolean))].join('|');
    features.splice(i, 1);
  }
  // Villages mapped only as a point get their real built-up area: residential landuse polygons (traced
  // from imagery) are attributed to the nearest such village within 2 km and merged. Nothing is
  // synthesised — a village without any mapped polygon stays a named point.
  const real = features.filter(f => f.k === 'settlement' && !f.dist);
  const boxes = new Map(real.map(f => [f, turf.bbox(turf.feature(f.g))]));
  const inReal = c => real.some(f => { const b = boxes.get(f); return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3] && inF(c, f); });
  const nodeEls = (nodes.elements || []).filter(e => e.type === 'node' && inRegion([e.lon, e.lat]));
  const placeNodes = nodeEls.filter(e => ((e.tags?.place && OSM_PLACE[e.tags.place]) || osmIsRuin(e.tags)) && !inReal([e.lon, e.lat]));
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
    const f = { k: 'settlement', n: nameOf(e.tags), q: namesOf(e.tags), s: OSM_PLACE[e.tags.place] || OSM_RUIN, p: osmRound([e.lon, e.lat]), id: 'n' + e.id };
    if (!OSM_PLACE[e.tags.place]) f.ruin = 1;
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
  // Districts (snapshot areas): quarters and refugee camps mapped as points, and villages inside a town's
  // municipality, become point districts; a place already outlined under the same name is skipped.
  if (area?.districts) {
    const outlined = features.filter(f => f.k === 'settlement' && f.g);
    for (const e of nodeEls) {
      const t = e.tags || {}, c = [e.lon, e.lat];
      const quarter = /^(suburb|quarter|neighbourhood)$/.test(t.place || '');
      if (!t.name || !(quarter || (OSM_PLACE[t.place] && inReal(c)))) continue;
      const names = new Set(namesOf(t).split('|'));
      // same name and inside the outline or next to it (points are often placed just off the polygon)
      if (outlined.some(f => (f.q || '').split('|').some(n => names.has(n)) && (inF(c, f) || turf.distance(c, f.p) < 1.5))) continue;
      if (features.some(f => f.dist && f.pt && f.n === nameOf(t))) continue;
      features.push({ k: 'settlement', n: nameOf(t), q: namesOf(t), s: quarter ? osmDistrictKind(t) : OSM_PLACE[t.place], p: osmRound(c), id: 'n' + e.id, dist: 1, pt: 1 });
    }
  }
  // Named peaks (points), highest first.
  features.push(...nodeEls.filter(e => /^(peak|volcano)$/.test(e.tags?.natural || ''))
    .map(e => ({ k: 'peak', n: nameOf(e.tags), q: namesOf(e.tags), s: e.tags.natural === 'volcano' ? 'Вулкан' : 'Высота', p: osmRound([e.lon, e.lat]), ele: parseFloat(e.tags.ele) || null, id: 'n' + e.id }))
    .sort((a, b) => (b.ele || 0) - (a.ele || 0)).slice(0, 80));
  const counts = {};
  for (const f of features) { const k = f.dist ? 'district' : f.k; counts[k] = (counts[k] || 0) + 1; }
  counts.approx = features.filter(f => f.pt && !f.dist).length;
  counts.builtup = features.filter(f => f.b).length;
  counts.ruins = features.filter(f => f.ruin).length;
  return { features, counts };
}

// A plausibility check: an empty object answer for a province with many villages means a broken mirror.
export function osmLooksBroken(objects, nodes) {
  return !(objects.elements || []).length && (nodes.elements || []).filter(e => e.tags?.place).length > 20;
}
