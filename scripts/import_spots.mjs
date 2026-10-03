// Import des sites de vol libre de France et des gares voyageurs.
// Lancé par .github/workflows/spots.yml (chaque semaine et à la demande).
// Sorties :
//   data/france.json : sites de décollage (FFVL en priorité, ParaglidingEarth en complément)
//   data/gares.json  : gares voyageurs SNCF [nom, lat, lon]
// Sources et licences :
//   - FFVL, liste des sites de pratique (data.gouv.fr), licence ODbL annoncée par la FFVL
//   - ParaglidingEarth (API publique)
//   - SNCF Open Data, gares de voyageurs (ODbL)
//   - geo.api.gouv.fr (commune et département de chaque site)
// Le script est volontairement tolérant : les formats exacts des sources peuvent changer.
// Il affiche dans le journal la structure reçue pour faciliter un ajustement.

import { writeFile, readFile } from "node:fs/promises";

const FFVL_URL = "https://data.ffvl.fr/json/sites.json";
const PGE_URL = (n, s, e, w) => `https://www.paraglidingearth.com/api/geojson/getBoundingBoxSites.php?north=${n}&south=${s}&east=${e}&west=${w}&limit=3000&style=detailled`;
const GARES_URL = "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/json?lang=fr&timezone=Europe%2FParis";
const GEO_URL = (lat, lon) => `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeDepartement&format=json`;

// France métropolitaine (Corse comprise)
const FR = { n: 51.2, s: 41.3, e: 9.7, w: -5.3 };
const inFrance = (lat, lon) => lat > FR.s && lat < FR.n && lon > FR.w && lon < FR.e;
const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "ParaSpot (application libre de prévisions parapente)", Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1500 * i);
    }
  }
}

/* ---------- Outils tolérants au format ---------- */
function findList(x, depth = 0) {
  if (Array.isArray(x)) return x;
  if (!x || typeof x !== "object" || depth > 3) return null;
  if (Array.isArray(x.features)) return x.features;
  for (const v of Object.values(x)) { const l = findList(v, depth + 1); if (l && l.length) return l; }
  // objet indexé par identifiant : { "123": {...}, "124": {...} }
  const vals = Object.values(x);
  if (vals.length > 20 && vals.every(v => v && typeof v === "object")) return vals;
  return null;
}
function flat(o) {
  // aplatit un niveau : properties, geometry, fields…
  const out = {};
  const add = (obj, prefix = "") => Object.entries(obj || {}).forEach(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && prefix.split(".").length < 3) add(v, prefix + k + ".");
    else out[(prefix + k).toLowerCase()] = v;
  });
  add(o);
  if (Array.isArray(o?.geometry?.coordinates)) { out["geo.lon"] = o.geometry.coordinates[0]; out["geo.lat"] = o.geometry.coordinates[1]; }
  return out;
}
function pick(f, names) {
  for (const n of names) {
    const keys = Object.keys(f).filter(k => k === n || k.endsWith("." + n));
    for (const k of keys) if (f[k] !== null && f[k] !== undefined && f[k] !== "") return f[k];
  }
  return undefined;
}
const num = v => { const x = typeof v === "string" ? parseFloat(v.replace(",", ".")) : v; return Number.isFinite(x) ? x : NaN; };
function coords(f) {
  let lat = num(pick(f, ["geo.lat", "lat", "latitude", "y", "lat_deco", "latitude_deco"]));
  let lon = num(pick(f, ["geo.lon", "lon", "lng", "longitude", "x", "lon_deco", "longitude_deco"]));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const c = pick(f, ["coordinates", "coord", "geo_point_2d", "position"]);
    if (Array.isArray(c) && c.length >= 2) { lon = num(c[0]); lat = num(c[1]); if (Math.abs(lon) > 20 && Math.abs(lat) < 20) [lat, lon] = [lon, lat]; }
  }
  return Number.isFinite(lat) && Number.isFinite(lon) ? [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5] : null;
}
function orientations(f) {
  const set = new Set();
  // 1. drapeaux par direction (N: 1, NE: 0…)
  DIRS.forEach(d => { const v = f[d.toLowerCase()] ?? f["properties." + d.toLowerCase()]; if (v === 1 || v === "1" || v === true || v === 2 || v === "2") set.add(d); });
  // 2. texte libre ("N, NNE", "NO-O", "Nord-Ouest")
  if (!set.size) {
    const t = pick(f, ["orientation", "orientations", "orientation_vent", "orientation_deco", "vent", "wind", "directions"]);
    const txt = Array.isArray(t) ? t.join(" ") : String(t ?? "");
    txt.toUpperCase()
      .replace(/NORD[\s-]*EST/g, "NE").replace(/NORD[\s-]*OUEST/g, "NW").replace(/SUD[\s-]*EST/g, "SE").replace(/SUD[\s-]*OUEST/g, "SW")
      .replace(/NORD/g, "N").replace(/SUD/g, "S").replace(/EST/g, "E").replace(/OUEST/g, "O")
      .split(/[^A-Z]+/).filter(Boolean)
      .map(w => w.replace(/O/g, "W"))
      .forEach(w => { if (DIRS.includes(w)) set.add(w); });
  }
  return DIRS.filter(d => set.has(d));
}
function km(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

/* ---------- FFVL ---------- */
async function ffvl() {
  let data;
  try { data = await getJson(FFVL_URL); } catch (e) { console.log(`FFVL : téléchargement impossible (${e.message}).`); return []; }
  const list = findList(data) || [];
  console.log(`FFVL : ${list.length} entrées reçues.`);
  if (list[0]) console.log("FFVL, exemple de fiche :", JSON.stringify(list[0]).slice(0, 900));
  const out = []; let noCoord = 0, notTakeoff = 0, noOrient = 0, notPara = 0;
  for (const raw of list) {
    const f = flat(raw);
    const c = coords(f); if (!c || !inFrance(...c)) { noCoord++; continue; }
    const all = Object.values(f).filter(v => typeof v === "string").join(" ").toLowerCase();
    const type = String(pick(f, ["type", "type_site", "nature", "categorie", "sous_type", "type_terrain"]) ?? "").toLowerCase();
    if (/atterr/.test(type) && !/d[ée]co/.test(type)) { notTakeoff++; continue; }
    const practice = String(pick(f, ["pratiques", "pratique", "activites", "activite", "disciplines"]) ?? "").toLowerCase();
    if (practice && /delta|cerf/.test(practice) && !/parapente|para/.test(practice)) { notPara++; continue; }
    const o = orientations(f); if (!o.length) { noOrient++; continue; }
    const name = String(pick(f, ["nom", "name", "toponyme", "libelle", "titre", "site", "nom_site"]) ?? "").trim();
    if (!name) { noCoord++; continue; }
    const id = pick(f, ["suid", "id", "id_terrain", "terrain_id", "uid", "numero"]);
    const alt = num(pick(f, ["altitude", "alt", "altitude_deco", "takeoff_altitude"]));
    const soaring = /soaring|bord de mer|falaise|dune/.test(all);
    out.push({ id: `ffvl-${id ?? out.length}`, n: name, lat: c[0], lon: c[1], o, p: soaring ? "soaring" : "plaine", alt: Number.isFinite(alt) ? Math.round(alt) : null, src: "ffvl", ffvl: id ?? null, treuil: /treuil/.test(all) || undefined });
  }
  console.log(`FFVL : ${out.length} décollages gardés (sans coordonnées ${noCoord}, atterrissages ${notTakeoff}, delta seul ${notPara}, sans orientation ${noOrient}).`);
  return out;
}

/* ---------- ParaglidingEarth ---------- */
async function pge() {
  const tiles = [];
  const latSteps = [FR.s, 44.5, 47.5, FR.n], lonSteps = [FR.w, 2.2, FR.e];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) tiles.push({ s: latSteps[i], n: latSteps[i + 1], w: lonSteps[j], e: lonSteps[j + 1] });
  const out = [];
  for (const t of tiles) {
    let data;
    try { data = await getJson(PGE_URL(t.n, t.s, t.e, t.w)); } catch (e) { console.log(`ParaglidingEarth : zone ignorée (${e.message}).`); continue; }
    const list = findList(data) || [];
    for (const raw of list) {
      const f = flat(raw);
      const c = coords(f); if (!c || !inFrance(...c)) continue;
      const cc = String(pick(f, ["countrycode", "country"]) ?? "fr").toLowerCase();
      if (cc && cc !== "fr" && cc !== "france") continue;
      const para = pick(f, ["paragliding"]);
      if (para === 0 || para === "0") continue;
      const place = String(pick(f, ["place"]) ?? "").toLowerCase();
      if (place && /landing/.test(place) && !/takeoff/.test(place)) continue;
      const o = orientations(f); if (!o.length) continue;
      const name = String(pick(f, ["name", "nom"]) ?? "").trim(); if (!name) continue;
      const id = pick(f, ["pge_site_id", "id", "site_id"]) ?? raw.id;
      const alt = num(pick(f, ["takeoff_altitude", "altitude"]));
      const soar = pick(f, ["soaring"]);
      const winch = pick(f, ["winch"]);
      out.push({ id: `pge-${id ?? `${c[0]}_${c[1]}`}`, n: name, lat: c[0], lon: c[1], o, p: soar === 1 || soar === "1" ? "soaring" : "plaine", alt: Number.isFinite(alt) ? Math.round(alt) : null, src: "pge", pge: id ?? null, treuil: winch === 1 || winch === "1" || undefined });
    }
    await sleep(800);
  }
  console.log(`ParaglidingEarth : ${out.length} décollages en France.`);
  return out;
}

/* ---------- Gares ---------- */
async function gares() {
  let data;
  try { data = await getJson(GARES_URL); } catch (e) { console.log(`Gares : téléchargement impossible (${e.message}).`); return null; }
  const list = findList(data) || [];
  if (list[0]) console.log("Gares, exemple :", JSON.stringify(list[0]).slice(0, 500));
  const seen = new Map();
  for (const raw of list) {
    const f = flat(raw);
    const c = coords(f); if (!c || !inFrance(...c)) continue;
    const name = String(pick(f, ["nom", "libelle", "name", "alias_libelle_noncontraint", "nom_gare"]) ?? "").trim(); if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, [name, c[0], c[1]]);
  }
  const out = [...seen.values()];
  console.log(`Gares : ${out.length} gares voyageurs.`);
  return out;
}

/* ---------- Commune et département ---------- */
async function addCommunes(spots, previous) {
  const prev = new Map((previous || []).map(s => [s.id, s]));
  let asked = 0;
  const todo = spots.filter(s => { const p = prev.get(s.id); if (p && p.c && p.lat === s.lat && p.lon === s.lon) { s.c = p.c; s.d = p.d; return false; } return true; });
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const r = await getJson(GEO_URL(s.lat, s.lon), 2);
        if (Array.isArray(r) && r[0]) { s.c = r[0].nom; s.d = r[0].codeDepartement; }
      } catch { /* commune facultative */ }
      asked++;
      await sleep(60);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`Communes : ${asked} recherches, ${spots.filter(s => s.d).length} sites situés.`);
}

/* ---------- Assemblage ---------- */
const [f1, f2, g] = [await ffvl(), await pge(), await gares()];
let curated = [];
try { curated = JSON.parse(await readFile("data/spots.json", "utf8")).spots; } catch { /* facultatif */ }
let previous = null;
try { previous = JSON.parse(await readFile("data/france.json", "utf8")).spots; } catch { /* premier import */ }

const merged = [...f1];
for (const s of f2) {
  if (merged.some(m => km([m.lat, m.lon], [s.lat, s.lon]) < 0.4)) continue; // déjà présent côté FFVL
  merged.push(s);
}
// retire les sites déjà décrits à la main dans data/spots.json
const final = merged.filter(s => !curated.some(c => (c.ffvlId && s.ffvl && String(c.ffvlId) === String(s.ffvl)) || km([c.lat, c.lon], [s.lat, s.lon]) < 0.4));
final.forEach(s => { if (!s.treuil) delete s.treuil; if (s.ffvl == null) delete s.ffvl; if (s.pge == null) delete s.pge; if (s.alt == null) delete s.alt; });
await addCommunes(final, previous);

if (final.length < 50 && previous && previous.length > 50) {
  console.log(`Seulement ${final.length} sites : import probablement cassé, on garde la liste précédente (${previous.length}).`);
} else {
  await writeFile("data/france.json", JSON.stringify({
    version: new Date().toISOString().slice(0, 10),
    note: "Sites importés automatiquement. FFVL (ODbL) et ParaglidingEarth. Orientations et accès à vérifier sur la fiche du site avant chaque vol.",
    spots: final
  }));
  console.log(`data/france.json : ${final.length} sites (${final.filter(s => s.src === "ffvl").length} FFVL, ${final.filter(s => s.src === "pge").length} ParaglidingEarth).`);
}
if (g && g.length > 500) { await writeFile("data/gares.json", JSON.stringify(g)); console.log(`data/gares.json : ${g.length} gares.`); }
else console.log("Gares : liste incomplète, fichier précédent conservé.");
