// ParaSpot - moteur de prévision partagé (navigateur + Node 20).
// Aucune dépendance. Toutes les vitesses sont en km/h, les angles en degrés.

export const SECTORS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
export const SECTOR_FR = { N: "N", NNE: "NNE", NE: "NE", ENE: "ENE", E: "E", ESE: "ESE", SE: "SE", SSE: "SSE", S: "S", SSW: "SSO", SW: "SO", WSW: "OSO", W: "O", WNW: "ONO", NW: "NO", NNW: "NNO" };
const SECT8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

// Modèles de prévision proposés (Open-Meteo). AROME HD n'a ni rafales ni horizon au-delà de ~42 h :
// les trous sont comblés par « Météo-France seamless » (AROME puis ARPEGE) et signalés.
export const MODELS = {
  arome: { id: "meteofrance_arome_france_hd", fallback: "meteofrance_seamless", label: "AROME HD", res: "1,5 km", source: "Météo-France" },
  ecmwf: { id: "ecmwf_ifs", alt: "ecmwf_ifs025", label: "ECMWF", res: "9 km", source: "ECMWF IFS" },
  gfs: { id: "gfs_seamless", label: "GFS", res: "13 à 25 km", source: "NOAA GFS" }
};
export const MODEL_KEYS = Object.keys(MODELS);

// Profils de pratique. Les seuils sont des valeurs prudentes et modifiables dans data/config.json
// ("profiles") ou dans les réglages de l'app.
export const DEFAULT_PROFILES = {
  gonflage: { label: "Gonflage", windMin: 8, idealMin: 12, idealMax: 22, windMax: 28, gustMax: 32, gustSpreadMax: 12, minHours: 1, anyDirection: true },
  soaring: { label: "Soaring côtier", windMin: 14, idealMin: 18, idealMax: 27, windMax: 32, gustMax: 36, gustSpreadMax: 12, minHours: 2, anyDirection: false },
  plaine: { label: "Thermique / pente", windMin: 3, idealMin: 6, idealMax: 18, windMax: 22, gustMax: 28, gustSpreadMax: 10, minHours: 2, anyDirection: false },
  treuil: { label: "Treuil", windMin: 0, idealMin: 4, idealMax: 20, windMax: 25, gustMax: 30, gustSpreadMax: 10, minHours: 2, anyDirection: false }
};

// Ajustement selon le niveau du pilote (km/h ajoutés aux plafonds de vent).
export const LEVEL_SHIFT = { debutant: -4, intermediaire: 0, confirme: 4 };

export function profileFor(spot, settings = {}) {
  const base = { ...DEFAULT_PROFILES[spot.profile], ...(settings.profiles?.[spot.profile] || {}) };
  const shift = LEVEL_SHIFT[settings.level || "intermediaire"] ?? 0;
  return { ...base, idealMax: base.idealMax + shift, windMax: base.windMax + shift, gustMax: base.gustMax + shift };
}

export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function degToSector(deg) {
  return SECT8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Facteur d'orientation : 1 = dans le secteur du site, 0.55 = jusqu'à 22,5° en dehors, 0 = travers/arrière.
// Un secteur à 2 lettres (NE) couvre ±22,5°, un secteur à 3 lettres (NNE) ±11,25°.
export function directionFactor(spot, dir, profile) {
  if (profile.anyDirection) {
    const pref = (spot.preferred || []).some((s) => angleDiff(dir, SECTORS[s]) <= 30);
    return pref || !(spot.preferred || []).length ? 1 : 0.9;
  }
  if (!spot.orientations?.length) return 0;
  const excess = Math.min(...spot.orientations.map((s) => angleDiff(dir, SECTORS[s]) - (s.length === 3 ? 11.25 : 22.5)));
  if (excess <= 0) return 1;
  if (excess <= 22.5) return 0.55;
  return 0;
}

function speedFactor(w, p) {
  if (w < p.windMin || w > p.windMax) return 0;
  if (w >= p.idealMin && w <= p.idealMax) return 1;
  if (w < p.idealMin) return 0.5 + 0.5 * (w - p.windMin) / Math.max(1, p.idealMin - p.windMin);
  return 1 - 0.6 * (w - p.idealMax) / Math.max(1, p.windMax - p.idealMax);
}

function gustFactor(w, g, p) {
  if (g > p.gustMax) return 0;
  const spread = Math.max(0, g - w);
  if (spread > p.gustSpreadMax) return 0.2;
  const half = p.gustSpreadMax / 2;
  return spread <= half ? 1 : 1 - 0.5 * (spread - half) / half;
}

// Évalue une heure. Retourne { score 0-100, reasons[] } : les raisons alimentent les recommandations.
export function scoreHour(spot, h, profile) {
  const reasons = [];
  if (h.missing) return { score: 0, reasons: ["Pas de donnée pour ce modèle"] };
  if (!h.isDay) return { score: 0, reasons: ["Nuit"] };
  if ([95, 96, 99].includes(h.code)) return { score: 0, reasons: ["Orage prévu"] };
  if ([45, 48].includes(h.code) && spot.kind === "vol") return { score: 0, reasons: ["Brouillard"] };
  if (h.rain > 0.1) return { score: 0, reasons: ["Pluie : aile mouillée"] };

  const df = directionFactor(spot, h.dir, profile);
  if (df === 0) reasons.push(`Vent ${SECTOR_FR[degToSector(h.dir)]} hors secteur du site`);
  else if (df < 1) reasons.push("Vent un peu de travers");

  const sf = speedFactor(h.wind, profile);
  if (h.wind < profile.windMin) reasons.push("Vent trop faible");
  else if (h.wind > profile.windMax) reasons.push("Vent trop fort");
  else if (h.wind > profile.idealMax) reasons.push("Vent soutenu");

  const gf = gustFactor(h.wind, h.gust, profile);
  if (h.gust > profile.gustMax) reasons.push(`Rafales ${Math.round(h.gust)} km/h`);
  else if (h.gust - h.wind > profile.gustSpreadMax) reasons.push("Vent très irrégulier");

  let rf = 1;
  if ((h.rainProb ?? 0) >= 60) { rf = 0.5; reasons.push("Risque d'averse"); }
  else if ((h.rainProb ?? 0) >= 35) rf = 0.8;

  let cf = 1;
  if (spot.kind === "vol" && (h.cape ?? 0) > 800) { cf = 0.7; reasons.push("Atmosphère instable"); }

  return { score: Math.round(100 * df * sf * gf * rf * cf), reasons };
}

export function verdict(score) {
  if (score >= 75) return { key: "top", label: "Top" };
  if (score >= 55) return { key: "ok", label: "Jouable" };
  if (score >= 30) return { key: "limite", label: "Limite" };
  return { key: "non", label: "Non" };
}

// Convertit la réponse Open-Meteo (une position) en tableau d'heures normalisées.
// fb = réponse d'un modèle de secours (même grille horaire) pour combler les trous.
export function normalizeForecast(om, fb = null) {
  const H = om.hourly || {}, F = fb?.hourly || {};
  const daily = om.daily?.time?.length ? om.daily : fb?.daily;
  const days = {};
  (daily?.time || []).forEach((d, i) => { days[d] = { sunrise: daily.sunrise[i], sunset: daily.sunset[i] }; });
  const pick = (k, i) => (H[k]?.[i] ?? null);
  const pickFb = (k, i) => (F[k]?.[i] ?? null);
  const time = H.time || F.time || [];
  return {
    days,
    hours: time.map((t, i) => {
      let wind = pick("wind_speed_10m", i), dir = pick("wind_direction_10m", i), filled = false;
      if (wind == null || dir == null) { wind = pickFb("wind_speed_10m", i); dir = pickFb("wind_direction_10m", i); filled = wind != null; }
      let gust = pick("wind_gusts_10m", i);
      let gustEstimated = false;
      if (gust == null) gust = pickFb("wind_gusts_10m", i);
      if (gust == null && wind != null) { gust = wind * 1.35; gustEstimated = true; }
      const d = days[t.slice(0, 10)];
      const isDayRaw = pick("is_day", i) ?? pickFb("is_day", i);
      const isDay = isDayRaw != null ? isDayRaw === 1 : (d ? t >= d.sunrise.slice(0, 13) && t < d.sunset.slice(0, 13) : true);
      return {
        time: t, // heure locale Europe/Paris, format "2026-10-01T14:00"
        date: t.slice(0, 10),
        hour: Number(t.slice(11, 13)),
        missing: wind == null,
        filled, gustEstimated,
        wind: wind ?? 0,
        gust: gust ?? 0,
        dir: dir ?? 0,
        rain: pick("precipitation", i) ?? pickFb("precipitation", i) ?? 0,
        rainProb: pick("precipitation_probability", i) ?? pickFb("precipitation_probability", i),
        code: pick("weather_code", i) ?? pickFb("weather_code", i) ?? 0,
        cloud: pick("cloud_cover", i) ?? pickFb("cloud_cover", i),
        temp: pick("temperature_2m", i) ?? pickFb("temperature_2m", i),
        cape: pick("cape", i) ?? pickFb("cape", i) ?? 0,
        isDay
      };
    })
  };
}

// Moyenne des modèles (AROME HD, ECMWF, GFS) heure par heure : vent et rafales moyens,
// direction moyenne pondérée par la force du vent, pluie moyenne, temps le plus défavorable (orage, brouillard).
export function meanForecast(forecasts) {
  const list = Object.values(forecasts || {}).filter((f) => f?.hours?.length);
  if (list.length < 2) return null;
  const byTime = new Map();
  list.forEach((f) => f.hours.forEach((h) => { if (!byTime.has(h.time)) byTime.set(h.time, []); byTime.get(h.time).push(h); }));
  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const days = list.find((f) => f.days && Object.keys(f.days).length)?.days || {};
  const hours = [...byTime.keys()].sort().map((t) => {
    const all = byTime.get(t), hs = all.filter((h) => !h.missing);
    const base = all[0];
    if (!hs.length) return { ...base, missing: true, models: 0 };
    let sx = 0, sy = 0;
    hs.forEach((h) => { const r = (h.dir * Math.PI) / 180, w = Math.max(h.wind, 1); sx += Math.sin(r) * w; sy += Math.cos(r) * w; });
    const dir = ((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360;
    const num = (k) => avg(hs.map((h) => h[k]).filter((v) => v != null));
    return {
      time: t, date: base.date, hour: base.hour, missing: false, filled: hs.some((h) => h.filled), gustEstimated: hs.some((h) => h.gustEstimated),
      wind: num("wind"), gust: num("gust"), dir, rain: num("rain") ?? 0, rainProb: num("rainProb"),
      code: Math.max(...hs.map((h) => h.code || 0)), cloud: num("cloud"), temp: num("temp"), cape: num("cape") ?? 0,
      isDay: hs.filter((h) => h.isDay).length >= hs.length / 2, models: hs.length
    };
  });
  return { days, hours, mean: true };
}

// Accord entre modèles à une heure donnée : écart de vent (km/h) et de direction (degrés).
export function agreement(hours) {
  const hs = hours.filter((h) => h && !h.missing);
  if (hs.length < 2) return { level: "inconnu", label: "Un seul modèle", windSpread: 0, dirSpread: 0 };
  const winds = hs.map((h) => h.wind);
  const windSpread = Math.max(...winds) - Math.min(...winds);
  let dirSpread = 0;
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) dirSpread = Math.max(dirSpread, angleDiff(hs[i].dir, hs[j].dir));
  const level = windSpread <= 6 && dirSpread <= 30 ? "bon" : windSpread <= 12 && dirSpread <= 60 ? "moyen" : "faible";
  return { level, label: { bon: "Modèles d'accord", moyen: "Accord partiel", faible: "Modèles en désaccord" }[level], windSpread: Math.round(windSpread), dirSpread: Math.round(dirSpread) };
}

// Marée indicative (Open-Meteo Marine, sea_level_height_msl). Retourne un état par heure.
export function tideStates(marine) {
  if (!marine?.hourly?.sea_level_height_msl) return {};
  const { time, sea_level_height_msl: lvl } = marine.hourly;
  const byDay = {};
  time.forEach((t, i) => { (byDay[t.slice(0, 10)] ||= []).push(lvl[i]); });
  const out = {};
  time.forEach((t, i) => {
    const arr = byDay[t.slice(0, 10)].filter((v) => v != null);
    const min = Math.min(...arr), max = Math.max(...arr);
    const ratio = max > min ? (lvl[i] - min) / (max - min) : 0.5;
    const next = lvl[i + 1] ?? lvl[i];
    out[t] = { level: lvl[i], ratio, trend: next > lvl[i] ? "montante" : "descendante", label: ratio > 0.75 ? "Haute" : ratio < 0.25 ? "Basse" : "Mi-marée" };
  });
  // Basses et pleines mers : creux et bosses de la courbe horaire, affinés à la minute (parabole sur 3 points)
  const ext = (sign) => {
    const res = [];
    for (let i = 1; i < lvl.length - 1; i++) {
      const a = lvl[i - 1], b = lvl[i], c = lvl[i + 1];
      if (a == null || b == null || c == null) continue;
      if (sign * (b - a) <= 0 && sign * (c - b) > 0) {
        const den = a - 2 * b + c, off = den ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0;
        const idx = i + off, base = time[i], mins = Math.round(off * 60);
        const d = new Date(`${base}:00Z`); d.setUTCMinutes(d.getUTCMinutes() + mins);
        res.push({ idx, time: d.toISOString().slice(0, 16), level: Math.round((b - (a - c) * off / 4) * 100) / 100 });
      }
    }
    return res;
  };
  const lows = ext(1), highs = ext(-1);
  time.forEach((t, i) => {
    if (!out[t]) return;
    const nl = lows.reduce((m, l) => Math.abs(l.idx - i) < Math.abs(m) ? l.idx - i : m, Infinity);
    out[t].fromLow = Number.isFinite(nl) ? Math.round(Math.abs(nl) * 10) / 10 : null; // heures jusqu'à la basse mer la plus proche
  });
  out._lows = lows.map(({ time: t, level }) => ({ time: t, level }));
  out._highs = highs.map(({ time: t, level }) => ({ time: t, level }));
  return out;
}

// Plage horaire accessible en train : arrivée au plus tôt / départ au plus tard.
export function accessRange(spot, settings = {}) {
  const firstDeparture = settings.firstDeparture ?? 7; // heure de départ de Rennes
  const lastTrainBack = settings.lastTrainBack ?? 20;  // dernier train retour
  const ride = spot.access?.rideKm ? (spot.access.rideKm / (settings.skateKmh ?? 18)) * 60 : 0;
  const mode = spot.access?.mode;
  if (mode === "voiture") {
    const drive = spot.access.driveMinutes ?? 120;
    return { from: firstDeparture + drive / 60, to: 24, travelMinutes: Math.round(drive) };
  }
  const isTrain = mode === "train";
  const travel = isTrain ? (spot.access.trainMinutes ?? 0) + ride + 10 : ride + 5;
  if (!isTrain) return { from: 0, to: 24, travelMinutes: Math.round(travel) };
  return { from: firstDeparture + travel / 60, to: lastTrainBack - (ride + 10) / 60, travelMinutes: Math.round(travel) };
}

// Analyse complète d'un spot : heures notées + créneaux.
export function analyzeSpot(spot, forecast, settings = {}, tide = {}) {
  const profile = profileFor(spot, settings);
  const range = accessRange(spot, settings);
  const hours = forecast.hours.map((h) => {
    const r = scoreHour(spot, h, profile);
    // aujourd'hui : on ne peut plus arriver avant « maintenant + trajet »
    const tooLate = settings.today && h.date === settings.today && h.hour < Math.ceil((settings.nowHour ?? 0) + range.travelMinutes / 60);
    const reachable = !tooLate && h.hour >= Math.ceil(range.from) && h.hour + 1 <= Math.floor(range.to);
    const t = tide[h.time];
    if (spot.tide && t?.label === "Haute") r.reasons.push("Marée haute : plage d'atterrissage réduite");
    // règle locale : vol autorisé seulement autour de la basse mer (ex. Pointe du Roselier : 3 h avant et après)
    const around = spot.tideRule?.aroundLow;
    if (around && t?.fromLow != null && t.fromLow > around) { r.score = 0; r.reasons.push(`Hors créneau de marée (vol seulement ${around} h avant et après la basse mer)`); }
    return { ...h, ...r, reachable, tide: t || null, verdict: verdict(r.score) };
  });
  const minScore = settings.minScore ?? 55;
  const windows = [];
  let cur = null;
  for (const h of hours) {
    const good = h.score >= minScore && h.reachable;
    if (good && cur && cur.date === h.date && h.hour === cur.end) {
      cur.hours.push(h); cur.end = h.hour + 1;
    } else if (good) {
      cur = { date: h.date, start: h.hour, end: h.hour + 1, hours: [h] };
      windows.push(cur);
    } else cur = null;
  }
  const valid = windows
    .filter((w) => w.hours.length >= profile.minHours)
    .map((w) => summarizeWindow(spot, w, range));
  return { spot, profile, range, hours, windows: valid };
}

function summarizeWindow(spot, w, range) {
  const avg = (k) => w.hours.reduce((s, h) => s + h[k], 0) / w.hours.length;
  const sin = w.hours.reduce((s, h) => s + Math.sin(h.dir * Math.PI / 180), 0);
  const cos = w.hours.reduce((s, h) => s + Math.cos(h.dir * Math.PI / 180), 0);
  const dir = (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360;
  const score = Math.round(avg("score"));
  return {
    spotId: spot.id, spotName: spot.name, kind: spot.kind, clubOnly: !!spot.clubOnly, access: spot.access?.mode || "local", limit: !!spot.limit,
    date: w.date, start: w.start, end: w.end, hours: w.hours.length,
    wind: Math.round(avg("wind")), gust: Math.round(Math.max(...w.hours.map((h) => h.gust))),
    dir: Math.round(dir), sector: degToSector(dir), score, verdict: verdict(score),
    travelMinutes: range.travelMinutes
  };
}

// Recommandations textuelles pour l'écran détail.
export function recommendations(spot, analysis, now = new Date()) {
  const recs = [];
  const p = analysis.profile;
  const best = [...analysis.windows].sort((a, b) => b.score - a.score)[0];
  if (best) recs.push(`Meilleur créneau : ${dayLabel(best.date, now)} ${best.start}h-${best.end}h, ${SECTOR_FR[best.sector]} ${best.wind} km/h (rafales ${best.gust}).`);
  else recs.push("Aucun créneau favorable sur 3 jours.");
  if (spot.kind === "gonflage") recs.push(`Plage idéale pour le gonflage : ${p.idealMin}-${p.idealMax} km/h. Vent mesuré à 10 m : au sol il est 20 à 30 % plus faible.`);
  if (spot.kind === "vol") recs.push(`Soaring : vent régulier ${p.idealMin}-${p.idealMax} km/h, bien face à la pente (${spot.orientations.map((o) => SECTOR_FR[o]).join(", ")}).`);
  if (spot.tide) recs.push("Vérifier l'horaire des marées (SHOM) si l'atterrissage est sur la plage.");
  if (spot.clubOnly) recs.push("Treuil : uniquement pendant une session encadrée par un club.");
  if (spot.access?.mode === "train") recs.push(`Trajet porte à porte estimé : ${Math.round(analysis.range.travelMinutes / 6) / 10} h. Vérifier les horaires sur SNCF Connect.`);
  recs.push("Contrôler la balise la plus proche (OpenWindMap / Holfuy) avant de partir et sur place.");
  return recs;
}

export function dayLabel(date, now = new Date()) {
  const today = toLocalDate(now);
  const tomorrow = toLocalDate(new Date(now.getTime() + 86400000));
  if (date === today) return "aujourd'hui";
  if (date === tomorrow) return "demain";
  return new Date(date + "T12:00").toLocaleDateString("fr-FR", { weekday: "long" });
}

export function toLocalDate(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const HOURLY = "temperature_2m,precipitation,precipitation_probability,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,is_day";

// Coordonnées dédoublonnées (les parcs rennais sont proches) pour limiter le nombre d'appels.
function uniquePoints(spots) {
  const keyOf = (s) => `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
  const points = [], index = {};
  spots.forEach((s) => { const k = keyOf(s); if (!(k in index)) { index[k] = points.length; points.push(s); } });
  return { points, at: (s) => index[keyOf(s)] };
}

// URL Open-Meteo multi-positions pour un modèle donné (identifiant Open-Meteo).
export function forecastUrl(points, modelId) {
  const q = new URLSearchParams({
    latitude: points.map((s) => s.lat).join(","),
    longitude: points.map((s) => s.lon).join(","),
    hourly: HOURLY,
    daily: "sunrise,sunset",
    timezone: "Europe/Paris",
    forecast_days: "3",
    wind_speed_unit: "kmh"
  });
  if (modelId) q.set("models", modelId);
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export function marineUrl(points) {
  const q = new URLSearchParams({
    latitude: points.map((s) => s.lat).join(","),
    longitude: points.map((s) => s.lon).join(","),
    hourly: "sea_level_height_msl",
    timezone: "Europe/Paris",
    past_days: "1",
    forecast_days: "4"
  });
  return `https://marine-api.open-meteo.com/v1/marine?${q}`;
}

async function getJson(fetchFn, url) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();
  return Array.isArray(d) ? d : [d];
}

// Récupère les prévisions de plusieurs modèles + marées.
// Retour : [{ spot, forecasts: { arome, ecmwf, gfs }, forecast (modèle principal), tide }]
export async function fetchAll(spots, fetchFn = fetch, { models = MODEL_KEYS, primary = models[0] } = {}) {
  const { points, at } = uniquePoints(spots);
  const raw = {};
  await Promise.all(models.map(async (key) => {
    const m = MODELS[key];
    try {
      const main = await getJson(fetchFn, forecastUrl(points, m.id)).catch(async (e) => {
        if (m.alt) return getJson(fetchFn, forecastUrl(points, m.alt));
        throw e;
      });
      const fb = m.fallback ? await getJson(fetchFn, forecastUrl(points, m.fallback)).catch(() => null) : null;
      raw[key] = points.map((_, i) => normalizeForecast(main[i], fb?.[i]));
    } catch (e) {
      if (key === primary) {
        // dernier recours pour le modèle principal : modèle automatique d'Open-Meteo
        const best = await getJson(fetchFn, forecastUrl(points, null));
        raw[key] = points.map((_, i) => normalizeForecast(best[i]));
      }
    }
  }));
  if (!Object.keys(raw).length) throw new Error("Prévisions indisponibles");
  const tideSpots = spots.filter((s) => s.tide);
  const tides = {};
  if (tideSpots.length) {
    try {
      const tp = uniquePoints(tideSpots);
      const marine = await getJson(fetchFn, marineUrl(tp.points));
      tideSpots.forEach((s) => { tides[s.id] = tideStates(marine[tp.at(s)]); });
    } catch { /* marées facultatives */ }
  }
  const first = raw[primary] ? primary : Object.keys(raw)[0];
  return spots.map((s) => {
    const forecasts = {};
    Object.keys(raw).forEach((k) => { forecasts[k] = raw[k][at(s)]; });
    return { spot: s, forecasts, forecast: forecasts[first], tide: tides[s.id] || {} };
  });
}

// Notification (règles de la maquette Claude Design) :
// titre de 40 caractères max (quand + où), 3 lignes max (une par créneau),
// priorité haute seulement pour un unique créneau de vol « Top ».
export function notificationText(windows, now = new Date(), max = 3) {
  const MAX = 40;
  // On garde le meilleur gonflage (les spots rennais ont la même météo) + les meilleurs vols.
  const byScore = [...windows].sort((a, b) => rank(b) - rank(a));
  const gonf = byScore.filter((w) => w.kind === "gonflage").slice(0, 1);
  const vols = byScore.filter((w) => w.kind === "vol");
  const sorted = [...vols, ...gonf].sort((a, b) => rank(b) - rank(a));
  if (!sorted.length) return null;
  const first = sorted[0];
  const when = cap(dayLabel(first.date, now));
  let title;
  if (sorted.length === 1) {
    title = `${when} ${first.start}h-${first.end}h : ${first.spotName}`;
    if (title.length > MAX) title = `${first.start}h-${first.end}h : ${first.spotName}`;
    if (title.length > MAX) title = title.slice(0, MAX - 1) + "…";
  } else {
    const kinds = new Set(sorted.map((w) => w.kind));
    title = `${when} : ${sorted.length} créneaux${kinds.size > 1 ? ", vol et gonflage" : kinds.has("vol") ? " de vol" : " de gonflage"}`;
  }
  const line = (w) => `${w.kind === "vol" ? "Vol" : "Gonflage"} · ${w.spotName} · ${dayLabel(w.date, now)} ${w.start}h-${w.end}h · ${SECTOR_FR[w.sector]} ${w.wind} km/h (raf. ${w.gust})${w.clubOnly ? " · si session club" : ""}`;
  let lines = sorted.slice(0, max).map(line);
  if (sorted.length > max) lines = [...lines.slice(0, max - 1), `+ ${sorted.length - (max - 1)} autres créneaux`];
  const priority = sorted.length === 1 && first.verdict.key === "top" && first.kind === "vol" ? "high" : "default";
  return { title, body: lines.join("\n"), lines, priority, spotId: first.spotId, date: first.date, tag: `fv-${first.date}` };
}

// Même classement que l'app : à score proche, train + skate avant la voiture, puis hors club.
export const rank = (w) => w.score - (w.clubOnly ? 5 : 0) - (w.access === "voiture" ? 8 : 0) - (w.limit ? 3 : 0);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
