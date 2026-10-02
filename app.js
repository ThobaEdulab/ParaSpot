// ParaSpot v3 « Ciel » : interface issue de la maquette Claude Design, branchée sur scoring.js.
// 1. données et adaptateur  2. utilitaires et composants (maquette)  3. moteur carte, vent, ciel  4. événements et démarrage
import { fetchAll, analyzeSpot, profileFor, accessRange, toLocalDate, notificationText, agreement, MODELS, MODEL_KEYS, SECTORS } from "./scoring.js";
import { GEO, RAILS, BASEMAP, PLACES_ALL } from "./basemap.js";
import { VAPID_PUBLIC_KEY } from "./config.js";

/* =========================================================
   1. DONNÉES ET ADAPTATEUR (scoring.js -> contrat de la maquette)
   ========================================================= */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }
};

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const PROFILES = { soaring: { label: "Soaring" }, gonflage: { label: "Gonflage" }, treuil: { label: "Treuil" }, plaine: { label: "Thermique" } };
const LEVELS = { debutant: { label: "Débutant" }, intermediaire: { label: "Intermédiaire" }, confirme: { label: "Confirmé" } };
const VERDICTS = { top: { key: "top", label: "Top" }, ok: { key: "ok", label: "Jouable" }, limite: { key: "limite", label: "Limite" }, non: { key: "non", label: "Non" } };
const ORIENT_DEG = SECTORS;
const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };
const LEVEL_FFVL = { vert: { label: "Brevet initial", color: "#2e9d55" }, bleu: { label: "Brevet de pilote", color: "#2f6fd6" }, marron: { label: "Brevet de pilote confirmé", color: "#8a5a32" } };

/* Réglages : stockés sur l'appareil */
const settings = Object.assign(
  { level: "intermediaire", scoreMin: 55, firstDeparture: "07:00", lastTrain: "20:00", theme: "system", model: "arome", includeCar: true, includeTreuil: false, hidden: [], favs: [], favsAsked: false, kind: "tout", notifEnabled: false },
  store.get("fv-settings-v3", {})
);
const saveSettings = () => { const { notifEnabled, ...s } = settings; store.set("fv-settings-v3", s); };

const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const toHour = s => toMin(s) / 60;
const SKATE_KMH = 18;
const rideMinutes = km => Math.round((km || 0) / SKATE_KMH * 60);
const scoringSettings = () => ({ level: settings.level, minScore: settings.scoreMin, firstDeparture: toHour(settings.firstDeparture), lastTrainBack: toHour(settings.lastTrain), skateKmh: SKATE_KMH });
const travelMinutes = spot => accessRange(spot, scoringSettings()).travelMinutes;
const gaugeProfile = spot => profileFor(spot, scoringSettings());

let ALL_SPOTS = [];  // data/spots.json
let SPOTS = [];      // spots affichés (filtre voiture)
let STATIONS = [];
let DAYS = [];
let FORECAST = null; // [{ date, bySpot: { id: { hours, slots, lowSlots, sun, models, agree } } }]
let RAW = null;      // { at, results } mis en cache
let UPDATED_AT = null;
let usedModel = settings.model;

const localIso = d => `${toLocalDate(d)}T${new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(d)}`;
const longDate = iso => new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const nowHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

function prepareSpots(data) {
  ALL_SPOTS = data.spots.map(s => ({
    ...s, rules: s.rules || [], warnings: s.warnings || [], links: s.links || {}, stations: s.stations || [],
    access: { ...s.access, ride: s.access.ride || s.access.summary || "", rideKm: s.access.rideKm ?? 0, trainMinutes: s.access.trainMinutes ?? 0 }
  }));
  const st = { Rennes: { name: "Rennes", lat: 48.1035, lon: -1.6724 } };
  ALL_SPOTS.forEach(s => { if (s.access.mode === "train" && !st[s.access.station]) st[s.access.station] = { name: s.access.station, lat: s.access.stationLat, lon: s.access.stationLon }; });
  STATIONS = Object.values(st);
  applySpotFilter();
}
function applySpotFilter() {
  SPOTS = ALL_SPOTS.filter(s => (settings.includeCar || s.access.mode !== "voiture") && (settings.includeTreuil || s.profile !== "treuil") && !settings.hidden.includes(s.id));
}

function buildDays(results) {
  const today = toLocalDate(new Date()), tomorrow = toLocalDate(new Date(Date.now() + 864e5));
  const any = results[0].forecasts[Object.keys(results[0].forecasts)[0]];
  let dates = [...new Set(any.hours.map(h => h.date))].sort();
  const future = dates.filter(d => d >= today);
  if (future.length) dates = future;
  DAYS = dates.slice(0, 3).map(date => {
    const dt = new Date(date + "T12:00");
    const wd = dt.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
    const short = date === today ? "Aujourd'hui" : date === tomorrow ? "Demain" : `${wd.charAt(0).toUpperCase() + wd.slice(1)}. ${dt.getDate()}`;
    const word = date === today ? "aujourd'hui" : date === tomorrow ? "demain" : dt.toLocaleDateString("fr-FR", { weekday: "long" });
    const sun = any.days?.[date];
    return { date, short, word, long: longDate(date), sunrise: sun ? sun.sunrise.slice(11, 16) : "07:30", sunset: sun ? sun.sunset.slice(11, 16) : "19:30" };
  });
}

const roundHour = h => ({ ...h, wind: Math.round(h.wind), gust: Math.round(h.gust), dir: Math.round(h.dir) % 360, rain: Math.round(h.rain * 10) / 10 });
const bySlot = (a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start);

function buildForecast() {
  if (!RAW) { FORECAST = null; return; }
  const today = toLocalDate(new Date()), nowH = nowHour();
  const ss = { ...scoringSettings(), today, nowHour: nowH };
  const avail = Object.keys(RAW.results[0]?.forecasts || {});
  usedModel = avail.includes(settings.model) ? settings.model : avail[0];
  const stillOk = (spot, w) => w.date !== today || w.end > nowH + travelMinutes(spot) / 60;
  const pastFix = (d, h) => (d === today && h.hour < nowH ? { ...h, reachable: false, past: true } : h);
  const analyses = RAW.results.map(({ spot, forecasts, tide }) => {
    const fresh = ALL_SPOTS.find(s => s.id === spot.id) || spot;
    const byModel = {};
    avail.forEach(k => { if (forecasts[k]) byModel[k] = analyzeSpot(fresh, forecasts[k], ss, tide); });
    return { spot: fresh, a: byModel[usedModel], low: analyzeSpot(fresh, forecasts[usedModel], { ...ss, minScore: 40 }, tide), byModel, days: forecasts[usedModel].days };
  });
  FORECAST = DAYS.map(d => {
    const bySpot = {};
    analyses.forEach(({ spot, a, low, byModel, days }) => {
      const sun = days?.[d.date];
      const pick = an => an.hours.filter(h => h.date === d.date && h.hour >= 7 && h.hour <= 21).map(roundHour).map(h => pastFix(d.date, h));
      const models = {};
      Object.entries(byModel).forEach(([k, an]) => { models[k] = pick(an); });
      const hours = models[usedModel];
      bySpot[spot.id] = {
        hours, models,
        agree: hours.map((h, i) => agreement(Object.values(models).map(m => m[i]))),
        slots: a.windows.filter(w => w.date === d.date && stillOk(spot, w)).sort(bySlot),
        lowSlots: low.windows.filter(w => w.date === d.date && stillOk(spot, w)).sort(bySlot),
        sun: sun ? { sunrise: sun.sunrise.slice(11, 16), sunset: sun.sunset.slice(11, 16) } : null
      };
    });
    return { date: d.date, bySpot };
  });
}

/* =========================================================
   3. UTILITAIRES DE FORMAT
   ========================================================= */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const SECT8 = ["N","NE","E","SE","S","SW","W","NW"];
const FR = { N:"N", NNE:"NNE", NE:"NE", ENE:"ENE", E:"E", ESE:"ESE", SE:"SE", SSE:"SSE", S:"S", SSW:"SSO", SW:"SO", WSW:"OSO", W:"O", WNW:"ONO", NW:"NO", NNW:"NNO" };
const FR_LONG = { N:"nord", NE:"nord-est", E:"est", SE:"sud-est", S:"sud", SW:"sud-ouest", W:"ouest", NW:"nord-ouest" };
function sectorCode(deg) { return SECT8[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; }
const frDir = code => FR[code] || code;
const fmtRange = (a, b) => `${a}h-${b}h`;
const fmtKm = km => `${String((km || 0).toFixed(1)).replace(".", ",")} km`;
function fmtDur(m) { if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`; }
function fmtClock(min) { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return `${h}h${String(m).padStart(2, "0")}`; }
const fmtHHMM = s => s.replace(":", "h");
const kindLabel = k => k === "vol" ? "Vol" : "Gonflage";
const accessIcon = s => s.access.mode === "train" ? I.train : s.access.mode === "voiture" ? I.car : I.skate;
const updatedLabel = iso => `Mis à jour à ${fmtHHMM(iso.slice(11, 16))}`;
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
const spotById = id => SPOTS.find(s => s.id === id);
/* =========================================================
   4. ICÔNES
   ========================================================= */
const I = {
  refresh: '<svg class="ic spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  train: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 19.5 7 22M15 19.5l2 2.5"/><circle cx="9.5" cy="13" r=".6"/><circle cx="14.5" cy="13" r=".6"/></svg>',
  skate: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h18"/><path d="M5 13l1.2-2.5h11.6L19 13"/><circle cx="8" cy="17" r="1.8"/><circle cx="16" cy="17" r="1.8"/></svg>',
  wave: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9c2 0 2-2 4.5-2S10 9 12 9s2.5-2 4.5-2S19 9 21 9M3 15c2 0 2-2 4.5-2s2.5 2 4.5 2 2.5-2 4.5-2 2.5 2 4.5 2"/></svg>',
  far: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  club: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15.5 14.3c3 0 5.5 2 5.5 5"/></svg>',
  close: '<svg class="ic ic--l" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  sunrise: '<svg class="ic ic--s" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18M7 19a5 5 0 0 1 10 0M12 4v6M9 7l3-3 3 3"/></svg>',
  sunset: '<svg class="ic ic--s" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18M7 19a5 5 0 0 1 10 0M12 4v6M9 7l3 3 3-3"/></svg>',
  drop: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  ext: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  alert: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>',
  info: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.3"/></svg>',
  bell: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20.5a2 2 0 0 0 4 0"/></svg>',
  offline: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.5-2.6M14.5 10.4A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4-2.7M10 5.2A15 15 0 0 1 22 9.5M12 20h.01"/></svg>',
  cloudx: '<svg class="ic ic--l" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/><path d="M10 11.5l4 4M14 11.5l-4 4"/></svg>',
  wind: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/></svg>',
  car: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM5 11h14"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/></svg>',
  model: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M9 14h6M12 11v6"/></svg>',
  pin: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  clock: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  calendar: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  sliders: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h9M19 6h1M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="16" cy="6" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="18" r="2.2"/></svg>',
  chevron: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  ground: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.5c3.5-5.5 13.5-5.5 17 0"/><path d="M5.5 12.2 12 18l6.5-5.8M3 21h18"/></svg>',
  sail: '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 9.2C5.5 4.6 18.5 4.6 21.5 9.2l-1.6 1.3C16.6 7.6 7.4 7.6 4.1 10.5z"/><path d="M4.6 10.6 11 18.4M19.4 10.6 13 18.4M9 8.1l2.3 10.1M15 8.1l-2.3 10.1" stroke="currentColor" stroke-width="1.1" fill="none"/><circle cx="12" cy="19.6" r="1.9"/></svg>'
};
/* Icône monochrome de la voile, réutilisée pour le badge de notification */
function sailSvg(size = 24, extra = "") {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" ${extra}><path d="M2.5 9.2C5.5 4.6 18.5 4.6 21.5 9.2l-1.6 1.3C16.6 7.6 7.4 7.6 4.1 10.5z"/><path d="M4.6 10.6 11 18.4M19.4 10.6 13 18.4M9 8.1l2.3 10.1M15 8.1l-2.3 10.1" stroke="currentColor" stroke-width="1.1" fill="none"/><circle cx="12" cy="19.6" r="1.9"/></svg>`;
}
const practiceLabel = s => s.profile === s.kind ? kindLabel(s.kind) : `${kindLabel(s.kind)} · ${PROFILES[s.profile].label}`;
const kindIcon = k => k === "vol" ? I.sail : I.ground;

/* =========================================================
   5. COMPOSANTS (une fonction de rendu par composant)
   Chaque fonction reçoit des objets du contrat et renvoie du HTML.
   ========================================================= */

/* COMPOSANT: verdict-icon / verdict-badge */
function renderVerdictIcon(key) {
  switch (key) {
    case "top": return '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.7-4.9 4.5 1.4 6.6L12 17l-6 3.4 1.4-6.6-4.9-4.5 6.6-.7z"/></svg>';
    case "ok": return '<svg class="ic" viewBox="0 0 24 24" style="stroke-width:3.4" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>';
    case "limite": return '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 2 .8 21.5h22.4L12 2zm-1.3 7h2.6v6.2h-2.6V9zm0 8.2h2.6v2.5h-2.6v-2.5z"/></svg>';
    default: return '<svg class="ic" viewBox="0 0 24 24" style="stroke-width:3.2" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M7.5 12h9"/></svg>';
  }
}
/* COMPOSANT: wind-arrow (la flèche indique où VA le vent, comme sur les cartes météo) */
function renderWindArrow(dir, size = 24) {
  const code = sectorCode(dir);
  return `<span class="wind-arrow" style="width:${size}px;height:${size}px" role="img" aria-label="Vent de ${FR_LONG[code]}"><svg viewBox="0 0 24 24" style="transform:rotate(${(dir + 180) % 360}deg)"><path d="M12 1.5 19.5 12.5H14.6V22.5H9.4V12.5H4.5Z"/></svg></span>`;
}

function spotSummary(hours, slot) {
  if (slot) return { verdict: slot.verdict, wind: slot.wind, gust: slot.gust, dir: ORIENT_DEG[slot.sector], at: null };
  const pool = hours.filter(h => h.reachable && h.isDay);
  if (!pool.length) { const ref = hours.find(h => h.hour === 14) || hours[hours.length - 1]; return { verdict: VERDICTS.non, wind: ref.wind, gust: ref.gust, dir: ref.dir, at: ref.hour }; }
  const best = pool.reduce((a, b) => (b.score > a.score ? b : a), pool[0]);
  const ref = best.score > 0 ? best : (pool.find(h => h.hour === 14) || best);
  return { verdict: best.score >= 30 ? VERDICTS.limite : VERDICTS.non, wind: ref.wind, gust: ref.gust, dir: ref.dir, at: ref.hour };
}
/* Recommandations générées (3 à 6 phrases courtes) */
function generateRecommendations(spot, hours, slot, dayIndex) {
  const r = [], day = DAYS[dayIndex], data = FORECAST[dayIndex].bySpot[spot.id];
  if (slot) {
    r.push(`Créneau conseillé ${fmtRange(slot.start, slot.end)}, vent de ${FR_LONG[slot.sector]} autour de ${slot.wind} km/h.`);
    const run = hours.filter(h => h.hour >= slot.start && h.hour < slot.end);
    const spread = slot.gust - slot.wind;
    r.push(spread <= 6 ? "Vent régulier, écart rafales faible." : spread <= 10 ? `Rafales jusqu'à ${slot.gust} km/h : reste vigilant aux bouffées.` : "Écart rafales important : sessions courtes et prudence.");
    const turn = angDiff(run[0].dir, run[run.length - 1].dir);
    if (turn >= 20) r.push(`Le vent tourne au ${FR_LONG[sectorCode(run[run.length - 1].dir)]} en fin de créneau : surveille l'orientation.`);
    else r.push("Direction stable sur tout le créneau.");
  } else {
    const best = hours.filter(h => h.reachable && h.isDay).sort((a, b) => b.score - a.score)[0];
    r.push(`Aucun créneau au-dessus de ton score minimum (${settings.scoreMin}) ${day.word}.`);
    if (best && best.reasons.length) r.push(`Meilleure heure : ${best.hour}h, mais ${best.reasons.join(", ").toLowerCase()}.`);
  }
  if (slot) {
    const ag = data.agree.filter((a, i) => hours[i].hour >= slot.start && hours[i].hour < slot.end);
    const bad = ag.filter(a => a.level === "faible").length, ok = ag.filter(a => a.level === "bon").length;
    if (ag.length && ag[0].level !== "inconnu") r.push(bad ? `Les modèles divergent sur ${bad} h du créneau : prévision fragile, compare AROME HD, ECMWF et GFS.` : ok === ag.length ? "AROME HD, ECMWF et GFS sont d'accord sur ce créneau." : "Accord partiel entre les modèles : surveille les balises.");
  }
  if (spot.tide) {
    const hw = hours.filter(h => h.tide).sort((a, b) => b.tide.ratio - a.tide.ratio)[0];
    r.push(hw ? `Marée la plus haute de la journée vers ${hw.hour}h (indicatif) : vérifie sur le SHOM que l'atterrissage reste dégagé.` : "Vérifie l'horaire des marées sur le SHOM si l'atterrissage est sur la plage.");
  }
  if (slot && spot.access.mode === "train") r.push(`Pars de Rennes vers ${fmtClock(slot.start * 60 - slot.travelMinutes - 10)} pour être prêt à ${slot.start}h (${fmtDur(slot.travelMinutes)} de trajet).`);
  if (slot && spot.access.mode === "local") r.push(`À ${fmtKm(spot.access.rideKm)} en skate : faisable sur une pause ou après le travail.`);
  if (slot && spot.access.mode === "voiture") r.push(`Pas de gare proche : voiture ou covoiturage club, environ ${fmtDur(spot.access.driveMinutes)} de route depuis Rennes.`);
  if (spot.clubOnly) r.push("Treuil uniquement pendant les sessions du club : vérifie le planning avant de partir.");
  if (settings.level === "debutant" && spot.profile === "soaring") r.push("Niveau débutant : soaring côtier à faire accompagné.");
  if (spot.kind === "gonflage") r.push("Vent prévu à 10 m : au sol, compte 20 à 30 % de moins.");
  r.push("Confirme avec une balise en temps réel (Spot Air, plus bas) avant de partir, puis sur place.");
  return r.slice(0, 7);
}

/* COMPOSANT: onboarding-ios (une étape illustrée) */
const ONB_STEPS = [
  { title: "Ouvrir dans Safari", text: "Ouvre ParaSpot dans Safari, puis touche le bouton Partager en bas de l'écran." },
  { title: "Sur l'écran d'accueil", text: "Fais défiler et choisis « Sur l'écran d'accueil », puis touche Ajouter en haut à droite." },
  { title: "Autoriser les notifications", text: "Ouvre l'app depuis sa nouvelle icône, active les alertes et touche Autoriser." }
];
function illPhone(inner) {
  return `<svg class="onb-ill" viewBox="0 0 160 290" aria-hidden="true">
    <rect class="i-body" x="2" y="2" width="156" height="286" rx="26"/>
    <rect class="i-screen" x="9" y="9" width="142" height="272" rx="20"/>${inner}</svg>`;
}
function illSail(x, y, s) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path class="i-white" d="M2.5 9.2C5.5 4.6 18.5 4.6 21.5 9.2l-1.6 1.3C16.6 7.6 7.4 7.6 4.1 10.5z"/><path d="M4.6 10.6 11 18.4M19.4 10.6 13 18.4M9 8.1l2.3 10.1M15 8.1l-2.3 10.1" style="stroke:#fff;stroke-width:1.1;fill:none"/><circle class="i-white" cx="12" cy="19.6" r="1.9"/></g>`;
}
function renderOnboardingIllustration(step) {
  if (step === 0) return illPhone(`
    <rect class="i-brand" x="20" y="30" width="120" height="62" rx="10"/>
    <rect class="i-white" x="29" y="41" width="58" height="7" rx="3" opacity=".85"/><rect class="i-white" x="29" y="55" width="44" height="14" rx="3"/>
    <rect class="i-mute" x="20" y="102" width="120" height="40" rx="8"/><rect class="i-mute" x="20" y="150" width="120" height="40" rx="8"/>
    <path class="i-mute" d="M9 232H151V261a20 20 0 0 1-20 20H29a20 20 0 0 1-20-20Z"/>
    <rect class="i-screen" x="20" y="238" width="120" height="15" rx="7.5"/><text class="i-txt2" x="80" y="248.5" text-anchor="middle">ParaSpot</text>
    <path class="i-line" d="M33 262l-5 5 5 5M51 262l5 5-5 5"/>
    <path d="M75 265v7h10v-7M80 269v-12M76.5 260.5 80 257l3.5 3.5" style="fill:none;stroke:#2f6fd6;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"/>
    <circle class="i-hl" cx="80" cy="265" r="13"/>
    <path class="i-line" d="M103 261h5a3 3 0 0 1 3 3v8M119 261h-5a3 3 0 0 0-3 3"/><rect class="i-line" x="126" y="261" width="10" height="10" rx="2"/>
    <rect class="i-hlfill" x="50" y="206" width="60" height="20" rx="10"/><text class="i-txt" x="80" y="219.5" text-anchor="middle" style="fill:var(--granite-ink)">Partager</text>
    <path class="i-hl" d="M80 228v8" style="stroke-width:2"/>`);
  if (step === 1) return illPhone(`
    <rect class="i-brand" x="20" y="30" width="120" height="50" rx="10" opacity=".35"/>
    <path class="i-mute" d="M9 112a14 14 0 0 1 14-14H137a14 14 0 0 1 14 14V261a20 20 0 0 1-20 20H29a20 20 0 0 1-20-20Z"/>
    <rect class="i-brand" x="20" y="110" width="24" height="24" rx="6"/>${illSail(23, 113, 0.75)}
    <text class="i-txt" x="50" y="120">ParaSpot</text><text class="i-txt2" x="50" y="131">Page web</text>
    <rect class="i-screen" x="18" y="146" width="124" height="96" rx="10"/>
    <text class="i-txt" x="26" y="166">Copier</text><rect class="i-line" x="126" y="158" width="9" height="11" rx="2"/>
    <path class="i-line" d="M18 178h124" style="stroke:var(--line);stroke-width:1"/>
    <text class="i-txt" x="26" y="198">Ajouter aux favoris</text><path class="i-line" d="M126 190l4.5 3.5L135 190v12h-9z"/>
    <path class="i-line" d="M18 210h124" style="stroke:var(--line);stroke-width:1"/>
    <rect class="i-hlfill" x="19" y="211" width="122" height="30" rx="8"/>
    <rect class="i-hl" x="17" y="209" width="126" height="34" rx="10"/>
    <text class="i-txt" x="24" y="230" style="fill:var(--granite-ink);font-size:8px">Sur l'écran d'accueil</text>
    <rect class="i-line" x="124" y="219" width="13" height="13" rx="3" style="stroke:var(--granite-ink)"/><path class="i-line" d="M130.5 222v7M127 225.5h7" style="stroke:var(--granite-ink)"/>`);
  return illPhone(`
    ${[[22, 36], [56, 36], [90, 36], [124, 36], [56, 86], [90, 86], [124, 86]].map(([x, y]) => `<rect class="i-mute" x="${x - 2}" y="${y}" width="26" height="26" rx="7"/>`).join("")}
    <rect class="i-brand" x="20" y="86" width="26" height="26" rx="7"/>${illSail(23, 89, 0.85)}
    <rect class="i-hl" x="16" y="82" width="34" height="34" rx="10"/>
    <text class="i-txt2" x="33" y="124" text-anchor="middle">ParaSpot</text>
    <rect class="i-screen" x="20" y="142" width="120" height="104" rx="14" style="stroke:var(--line-strong);stroke-width:1"/>
    <text class="i-txt" x="80" y="164" text-anchor="middle">« ParaSpot » souhaite</text>
    <text class="i-txt" x="80" y="176" text-anchor="middle">vous envoyer des</text>
    <text class="i-txt" x="80" y="188" text-anchor="middle">notifications</text>
    <text class="i-txt2" x="80" y="203" text-anchor="middle">Alertes, sons et pastilles</text>
    <path d="M20 214h120M80 214v32" style="stroke:var(--line);stroke-width:1"/>
    <text class="i-txt2" x="50" y="234" text-anchor="middle">Refuser</text>
    <text x="110" y="234" text-anchor="middle" style="fill:#2f6fd6;font:800 10px var(--font)">Autoriser</text>
    <rect class="i-hl" x="84" y="218" width="52" height="24" rx="8"/>`);
}
function renderOnboardingIos(step) {
  const s = ONB_STEPS[step];
  return `<div class="onb-step">
    <span class="onb-num">Étape ${step + 1} sur 3</span>
    ${renderOnboardingIllustration(step)}
    <h3 class="onb-title">${esc(s.title)}</h3>
    <p class="onb-text">${esc(s.text)}</p>
  </div>`;
}
/* ====
   6. NOTIFICATIONS
   ========================================================= */
/* Construit le contenu d'une notification à partir d'une liste de créneaux (contrat). */
function whenWord(date, refDate) {
  const i = DAYS.findIndex(d => d.date === date), r = DAYS.findIndex(d => d.date === refDate);
  if (i === r) return "aujourd'hui";
  if (i === r + 1) return "demain";
  return DAYS[i] ? DAYS[i].word : date;
}
function notifLine(sl, refDate) {
  const spot = spotById(sl.spotId);
  return `${kindLabel(sl.kind)} · ${sl.spotName} · ${whenWord(sl.date, refDate)} ${fmtRange(sl.start, sl.end)} · ${frDir(sl.sector)} ${sl.wind} km/h (raf. ${sl.gust})${spot && spot.clubOnly ? " · si session club" : ""}`;
}
function buildNotification(slots, refDate) {
  const MAX = 40;
  const sorted = [...slots].sort((a, b) => b.score - a.score);
  const first = sorted[0], w = capFirst(whenWord(first.date, refDate));
  let title;
  if (sorted.length === 1) {
    title = `${w} ${fmtRange(first.start, first.end)} : ${first.spotName}`;
    if (title.length > MAX) title = `${fmtRange(first.start, first.end)} : ${first.spotName}`;
    if (title.length > MAX) title = title.slice(0, MAX - 1) + "…";
  } else {
    const kinds = new Set(sorted.map(s => s.kind));
    title = `${w} : ${sorted.length} créneaux${kinds.size > 1 ? ", vol et gonflage" : kinds.has("vol") ? " de vol" : " de gonflage"}`;
  }
  let lines = sorted.slice(0, 3).map(s => notifLine(s, refDate));
  if (sorted.length > 3) lines = [...lines.slice(0, 2), `+ ${sorted.length - 2} autres créneaux`];
  return {
    title, lines,
    priority: sorted.length === 1 && first.verdict.key === "top" && first.kind === "vol" ? "haute" : "normale",
    action: { label: "Voir le créneau", spotId: first.spotId, date: first.date }
  };
}

/* COMPOSANT: notification-preview (iOS ou Android, clair ou sombre) */
function renderNotificationPreview(n, { os = "ios", when = "maintenant", expanded = false } = {}) {
  if (os === "ios") {
    return `<div><div class="np" role="group" aria-label="Notification ParaSpot : ${esc(n.title)}">
      <span class="np-icon">${sailSvg(24)}</span>
      <div class="np-head"><span class="np-app">ParaSpot${n.priority === "haute" ? ' · <span class="np-prio">Priorité haute</span>' : ""}</span><span class="np-when">${esc(when)}</span></div>
      <div class="np-title">${esc(n.title)}</div>
      <div class="np-body">${n.lines.map(l => `<span>${esc(l)}</span>`).join("")}</div>
    </div>${expanded ? `<div class="np-actions"><div><span>${esc(n.action.label)}</span>${I.chevron}</div><div><span>Ne plus m'alerter aujourd'hui</span></div></div>` : ""}</div>`;
  }
  return `<div class="na" role="group" aria-label="Notification ParaSpot : ${esc(n.title)}">
    <div class="na-head"><span class="na-badge">${sailSvg(14)}</span><span class="na-app">ParaSpot · ${esc(when)}</span>${n.priority === "haute" ? '<span class="na-prio">Priorité haute</span>' : ""}</div>
    <div class="na-title">${esc(n.title)}</div>
    <div class="na-body">${n.lines.map(l => `<span>${esc(l)}</span>`).join("")}</div>
    ${expanded ? `<div class="na-actions"><span>${esc(n.action.label)}</span><span>Plus tard</span></div>` : ""}
  </div>`;
}
/* =========================================================
   COMPOSANTS v2 « Ciel »
   Chaque fonction de rendu prend des objets du contrat (spot, heure, créneau) et renvoie du HTML/SVG.
   ========================================================= */
const RANK = { top: 3, ok: 2, limite: 1, non: 0 };
const ICON_GEAR = '<svg class="ic ic--l" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.3"/><circle cx="10" cy="17" r="2.3"/></svg>';
const ICON_PLAY = '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const ICON_PAUSE = '<svg class="ic ic--fill" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="5.5" width="4" height="13" rx="1"/></svg>';
const ICON_DOWN = '<svg class="ic ic--l" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/* ---------- Sélection des données ---------- */
/* Classement : score du meilleur créneau ; à score proche, train + skate passe devant la voiture, puis les sites hors club */
function rankScore(x) { return x.slots[0] ? x.slots[0].score - (x.spot.clubOnly ? 5 : 0) - (x.spot.access.mode === "voiture" ? 8 : 0) - (x.spot.limit ? 3 : 0) : -1; }
const STAR = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>';
function favBonus(x) { return settings.favs.includes(x.spot.id) ? 6 : 0; }
function kindOk(s, kind) { return kind === "tout" || (kind === "favoris" ? settings.favs.includes(s.id) : s.kind === kind); }
function spotsForDay(dayIndex, kind) {
  if (!FORECAST || !FORECAST[dayIndex]) return [];
  return SPOTS.filter(s => kindOk(s, kind)).map(spot => {
    const d = FORECAST[dayIndex].bySpot[spot.id];
    const maxScore = Math.max(0, ...d.hours.filter(h => h.reachable).map(h => h.score));
    return { spot, hours: d.hours, slots: d.slots, lowSlots: d.lowSlots, maxScore };
  }).sort((a, b) => rankScore(b) + favBonus(b) - rankScore(a) - favBonus(a) || b.maxScore - a.maxScore);
}
function bestVerdictOfDay(dayIndex, kind) {
  const items = spotsForDay(dayIndex, kind), w = items.filter(x => x.slots.length);
  if (w.length) return w.map(x => x.slots[0].verdict).sort((a, b) => RANK[b.key] - RANK[a.key])[0];
  return items.some(x => x.maxScore >= 40) ? VERDICTS.limite : VERDICTS.non;
}
function nextWindow(dayIndex, kind) {
  for (let j = dayIndex + 1; j < DAYS.length; j++) {
    const it = spotsForDay(j, kind).find(x => x.slots.length);
    if (it) return { slot: it.slots[0], dayIndex: j };
  }
  return null;
}
const hourOf = (spotId, dayIndex, h) => FORECAST[dayIndex].bySpot[spotId].hours.find(x => x.hour === h);

/* COMPOSANT: route (train puis skate) : listes [lat, lon] pour la carte */
const RENNES = [48.1035, -1.6724];
const RAIL_BY_STATION = { "Saint-Malo": RAILS.stmalo, "Saint-Brieuc": [...RAILS.brieuc, [48.5075, -2.766]] };
function routeLatLngs(spot) {
  if (spot.access.mode === "voiture") return { train: [], skate: [], car: [RENNES, [spot.lat, spot.lon]] };
  if (spot.access.mode !== "train") return { train: [], skate: [RENNES, [spot.lat, spot.lon]] };
  const st = STATIONS.find(s => s.name === spot.access.station) || { lat: spot.lat, lon: spot.lon };
  return { train: RAIL_BY_STATION[spot.access.station] || [RENNES, [st.lat, st.lon]], skate: [[st.lat, st.lon], [spot.lat, spot.lon]] };
}
/* COMPOSANT: map-marker (contenu HTML d'un marqueur Leaflet) */
function markerKey(h) { return h.reachable ? h.verdict.key : "off"; }
function renderMarker(spot, h, selected) {
  return `<div class="mk mk--${markerKey(h)} ${selected ? "is-sel" : ""} ${settings.favs.includes(spot.id) ? "is-fav" : ""}"><span class="mk-dot">${renderVerdictIcon(h.reachable ? h.verdict.key : "non")}</span><span class="mk-label">${esc(spot.name)}</span></div>`;
}
/* COMPOSANT: map-cluster (plusieurs spots proches quand on dézoome) */
function renderCluster(members, bestKey) {
  return `<div class="mk-cluster c--${bestKey}"><b class="num">${members.length}</b><small>spots</small></div>`;
}
/* COMPOSANT: day-switch */
function renderDays(dayIndex, kind) {
  const col = { top: "var(--top)", ok: "var(--ok)", limite: "var(--lim)", non: "var(--non)" };
  return DAYS.map((d, i) => { const v = bestVerdictOfDay(i, kind);
    return `<button type="button" data-action="day" data-day="${i}" aria-pressed="${i === dayIndex}" aria-label="${esc(d.short)}, meilleur verdict ${v.label}"><span class="vd" style="background:${col[v.key]}"></span>${esc(i === 0 ? "Auj." : d.short)}</button>`; }).join("");
}
/* COMPOSANT: kind-filter */
function renderKinds(kind) {
  const list = [["tout", "Tout", ""], ["gonflage", "Gonflage", I.ground], ["vol", "Vol", I.sail]];
  if (settings.favs.length || kind === "favoris") list.push(["favoris", "", STAR]);
  return list.map(([k, l, ic]) => `<button type="button" data-action="kind" data-kind="${k}" aria-pressed="${k === kind}" ${k === "favoris" ? 'class="k-fav" aria-label="Mes favoris"' : ""}>${ic}${l}</button>`).join("");
}

/* COMPOSANT: statement (Je pars ou pas ? Où ? À quelle heure ?) */
function verdictWord(slot) {
  if (!slot) return "Au sol.";
  if (slot.verdict.key === "top") return slot.kind === "vol" ? "Ça vole." : "Ça gonfle.";
  return "Jouable.";
}
function words(s) { return s.split(" ").map((w, i) => `<span class="w" style="animation-delay:${i * 90}ms">${esc(w)}</span>`).join(" "); }
function renderStatement({ day, slot, spot, next, offline, updatedAt, reason }) {
  const off = offline ? `<span class="pill-off">${I.offline}Hors connexion · prévisions de ${fmtHHMM(updatedAt.slice(11, 16))}</span>` : "";
  if (!slot) {
    return `<div class="statement anim">${off}
      <h1 class="st-word">${words("Au sol.")}</h1>
      <p class="st-line">Rien de favorable ${esc(day.word)}${reason ? ` : ${esc(reason)}` : "."}</p>
      ${next ? `<button type="button" class="st-cta" style="border:0;background:none;padding:0;min-height:var(--tap)" data-action="day" data-day="${next.dayIndex}">Prochaine fenêtre : ${esc(DAYS[next.dayIndex].short.toLowerCase())} ${fmtRange(next.slot.start, next.slot.end)} à ${esc(next.slot.spotName)} ${I.chevron}</button>` : `<p class="st-meta">Prochaine mise à jour à 7h.</p>`}
    </div>`;
  }
  return `<button type="button" class="statement anim" data-action="open" data-spot="${spot.id}" aria-label="${esc(verdictWord(slot))} ${esc(day.short)} ${fmtRange(slot.start, slot.end)} à ${esc(spot.name)}. Ouvrir le plan de vol.">${off}
    <span class="st-word">${words(verdictWord(slot))}</span>
    <span class="st-line"><em class="num">${fmtRange(slot.start, slot.end)}</em> à ${esc(spot.name)}</span>
    <span class="st-meta num"><span>${renderWindArrow(ORIENT_DEG[slot.sector], 18)}${frDir(slot.sector)} ${slot.wind} km/h</span><span>raf. ${slot.gust}</span><span>${accessIcon(spot)}${fmtDur(slot.travelMinutes)}</span><span class="st-cta">Plan de vol ${I.chevron}</span></span>
  </button>`;
}

/* COMPOSANT: spot-3-jours (le spot suivi sur aujourd'hui, demain et après-demain) */
function renderSpotDays(spot, fav) {
  const off = state.offline ? `<span class="pill-off">${I.offline}Hors connexion · prévisions de ${fmtHHMM(UPDATED_AT.slice(11, 16))}</span>` : "";
  const tiles = DAYS.map((day, i) => {
    const d = FORECAST[i].bySpot[spot.id], slot = d.slots[0], s = spotSummary(d.hours, slot);
    return `<button type="button" class="s3-day glass" data-action="day" data-day="${i}" aria-pressed="${i === state.day}" aria-label="${esc(day.short)} : ${s.verdict.label}, ${slot ? "créneau " + fmtRange(slot.start, slot.end) : "aucun créneau"}">
      <span class="s3-d">${esc(i === 0 ? "Auj." : day.short)}</span>
      <span class="s3-v s3-v--${s.verdict.key}">${renderVerdictIcon(s.verdict.key)}${s.verdict.label}</span>
      <b class="s3-slot num">${slot ? fmtRange(slot.start, slot.end) : "Aucun"}</b>
      <span class="s3-w num">${renderWindArrow(s.dir, 13)}${frDir(sectorCode(s.dir))} ${s.wind}<small> km/h</small></span>
      ${renderRibbon(d.hours, state.hour)}
    </button>`;
  }).join("");
  return `<div class="statement spot3 anim">${off}
    <div class="s3-head">
      <button type="button" class="s3-name" data-action="open" data-spot="${spot.id}" aria-label="${esc(spot.name)} : ouvrir le plan de vol"><span class="s3-title">${esc(spot.name)}</span><span class="s3-sub">${practiceLabel(spot)} · ${esc(spot.city)}</span><span class="st-cta">Plan de vol ${I.chevron}</span></button>
      <span class="s3-acts"><button type="button" class="s3-fav glass ${fav ? "is-on" : ""}" data-action="fav" data-spot="${spot.id}" aria-pressed="${fav}" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${STAR}</button><button type="button" class="s3-fav glass" data-action="close-spot" aria-label="Fermer les prévisions et revenir à la carte">${I.close}</button></span>
    </div>
    <div class="s3-days">${tiles}</div>
  </div>`;
}

/* COMPOSANT: spot-card */
function renderRibbon(hours, hour) {
  return `<div class="ribbon" aria-hidden="true">${hours.map(h => `<i class="rb--${h.reachable ? h.verdict.key : "off"}"></i>`).join("")}<span class="now" style="left:${((hour - 7 + 0.5) / 15 * 100).toFixed(2)}%"></span></div>`;
}
function renderCard(spot, hours, slot, selected, hour) {
  const s = spotSummary(hours, slot);
  return `<button type="button" class="card glass ${selected ? "is-sel" : ""}" data-action="card" data-spot="${spot.id}" aria-label="${esc(spot.name)}, ${s.verdict.label}, ${slot ? "créneau " + fmtRange(slot.start, slot.end) : "aucun créneau"}. ${selected ? "Ouvrir le détail." : "Centrer sur la carte."}">
    <span class="card-top"><span class="vbadge vbadge--${s.verdict.key}">${renderVerdictIcon(s.verdict.key)}${s.verdict.label}</span>
      <span class="chip num">${spot.access.mode === "local" ? I.skate + fmtKm(spot.access.rideKm) : accessIcon(spot) + fmtDur(travelMinutes(spot))}${spot.clubOnly ? " · club" : ""}${spot.limit ? " · +10 km" : ""}</span></span>
    <span><span class="card-name" style="display:block">${settings.favs.includes(spot.id) ? `<span class="card-star" aria-label="Favori">${STAR}</span>` : ""}${esc(spot.name)}</span><span class="card-sub" style="display:block">${practiceLabel(spot)} · ${esc(spot.city)}</span></span>
    <span class="card-mid">
      <span class="wind-big num">${renderWindArrow(s.dir, 30)}<span><b>${s.wind}</b><small>km/h · raf. ${s.gust} · ${frDir(sectorCode(s.dir))}</small></span></span>
      <span class="slot-big num">${slot ? `<b>${fmtRange(slot.start, slot.end)}</b><small>meilleur créneau</small>` : `<b style="font-size:15px">Aucun</b><small>créneau</small>`}</span>
    </span>
    ${renderRibbon(hours, hour)}
  </button>`;
}

/* COMPOSANT: time-scrubber */
function scrubGradient(hours) {
  const col = h => !h.reachable ? "var(--hair)" : { top: "var(--top)", ok: "var(--ok)", limite: "var(--lim)", non: "var(--non)" }[h.verdict.key];
  const stops = hours.map((h, i) => { const a = Math.max(0, (i - 0.5) / 14 * 100), b = Math.min(100, (i + 0.5) / 14 * 100);
    return `${col(h)} ${a.toFixed(2)}% calc(${b.toFixed(2)}% - 1px), transparent calc(${b.toFixed(2)}% - 1px) ${b.toFixed(2)}%`; });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
function renderScrub(spot, hours, hour, playing) {
  const h = hours.find(x => x.hour === hour);
  return `<button type="button" class="play" data-action="play" aria-label="${playing ? "Mettre en pause" : "Faire défiler la journée"}">${playing ? ICON_PAUSE : ICON_PLAY}</button>
    <div class="scrub-body glass">
      <div class="scrub-track" style="left:29px;right:29px;display:block;height:8px;border-radius:4px;background:${scrubGradient(hours)}"></div>
      <input type="range" id="hour" min="7" max="21" step="1" value="${hour}" aria-label="Heure, ${esc(spot.name)}" aria-valuetext="${hour}h, ${h.reachable ? h.verdict.label : h.past ? "heure passée" : "hors de portée"}, vent ${h.wind} km/h">
    </div>
    <div class="scrub-hour num" aria-hidden="true">${hour}h<small>${h.wind} km/h</small></div>`;
}

/* COMPOSANT: compass (rose des vents animée) */
function renderCompass(spot, hours, focus) {
  const c = 160, r1 = 58, r2 = 116;
  const pt = (r, deg) => { const a = deg * Math.PI / 180; return [+(c + r * Math.sin(a)).toFixed(2), +(c - r * Math.cos(a)).toFixed(2)]; };
  const wedge = o => { const a = ORIENT_DEG[o], hw = o.length === 3 ? 11.25 : 22.5;
    const [x1, y1] = pt(r2, a - hw), [x2, y2] = pt(r2, a + hw), [x3, y3] = pt(r1, a + hw), [x4, y4] = pt(r1, a - hw);
    return `<path class="cp-sector" pathLength="1" d="M${x1} ${y1}A${r2} ${r2} 0 0 1 ${x2} ${y2}L${x3} ${y3}A${r1} ${r1} 0 0 0 ${x4} ${y4}Z"/>`; };
  let ticks = "";
  for (let d = 0; d < 360; d += 22.5) { const m = d % 90 === 0, md = d % 45 === 0;
    const [x1, y1] = pt(m ? 119 : 122, d), [x2, y2] = pt(md ? 132 : 128, d);
    ticks += `<line class="cp-tick ${m ? "cp-tick--m" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
  const labels = SECT8.map(k => { const [x, y] = pt(146, ORIENT_DEG[k]); return `<text class="cp-lab ${k.length === 1 ? "cp-lab--m" : ""}" x="${x}" y="${y}">${frDir(k)}</text>`; }).join("");
  const dots = hours.filter(h => h.isDay && h.reachable).map(h => { const [x, y] = pt(124, h.dir); return `<circle class="cp-dot" cx="${x}" cy="${y}" r="3"/>`; }).join("");
  return `<figure style="margin:0">
    <svg class="compass" viewBox="0 0 320 320" role="img" aria-label="Rose des vents. Secteurs favorables : ${spot.orientations.map(frDir).join(", ")}. Vent à ${focus.hour}h : de ${FR_LONG[sectorCode(focus.dir)]}, ${focus.wind} km/h." id="compass">
      <circle class="cp-disc" cx="${c}" cy="${c}" r="136"/>
      <circle class="cp-ring" cx="${c}" cy="${c}" r="${r2}"/><circle class="cp-ring" cx="${c}" cy="${c}" r="${r1}"/>
      ${spot.orientations.map(wedge).join("")}${ticks}${dots}${labels}
      <g class="cp-rot" id="cp-rot" style="transform:rotate(${focus.dir}deg)">
        <line class="cp-shaft" x1="160" y1="30" x2="160" y2="88"/>
        <polygon class="cp-head" points="160,110 147,84 173,84"/>
        <g class="cp-tagg" id="cp-tagg" style="transform:rotate(${-focus.dir}deg)"><circle class="cp-tag" cx="160" cy="22" r="17"/><text class="cp-tagtxt" id="cp-tagtxt" x="160" y="22">${frDir(sectorCode(focus.dir))}</text></g>
      </g>
      <circle class="cp-center" cx="${c}" cy="${c}" r="46"/>
      <text class="cp-unit" x="${c}" y="${c - 20}" id="cp-h">À ${focus.hour}H</text>
      <text class="cp-speed num" x="${c}" y="${c + 11}" id="cp-v">${focus.wind}</text>
      <text class="cp-unit" x="${c}" y="${c + 28}">KM/H</text>
    </svg>
    <figcaption class="cp-legend"><span><i></i>Secteurs du site</span><span><b></b>Vent prévu, d'où il vient</span><span>Points : heure par heure</span></figcaption>
  </figure>`;
}
/* COMPOSANT: wind-gauge */
function gaugeModel(spot, h) {
  const p = { ...gaugeProfile(spot), label: PROFILES[spot.profile].label }, lv = LEVELS[settings.level], MAX = 50;
  const lo = p.idealMin, hi = p.idealMax, ceil = p.windMax;
  const pc = v => Math.max(0, Math.min(100, v / MAX * 100));
  const state = h.wind > ceil || h.gust > p.gustMax ? "Au-delà du plafond" : h.wind > hi ? "Au-dessus de l'idéal" : h.wind < lo ? "Sous l'idéal" : "Dans la plage idéale";
  return { p, lv, lo, hi, ceil, pc, state };
}
function renderGauge(spot, h) {
  const g = gaugeModel(spot, h);
  return `<div class="gauge" id="gauge">
    <div class="g-head"><b class="num" id="g-w">${h.wind}<small>km/h</small></b><span class="num" id="g-s">Rafales ${h.gust} km/h<br>${g.state}</span></div>
    <div class="g-track" aria-hidden="true">
      <div class="g-rail"></div>
      <div class="g-ideal" style="left:${g.pc(g.lo)}%;width:${g.pc(g.hi) - g.pc(g.lo)}%"></div>
      <span class="g-ideal-l num" style="left:${(g.pc(g.lo) + g.pc(g.hi)) / 2}%">Idéal ${g.lo}-${g.hi}</span>
      <div class="g-ceil" style="left:${g.pc(g.ceil)}%"></div><span class="g-ceil-l num" style="left:${g.pc(g.ceil)}%">Plafond ${g.ceil}</span>
      <div class="g-gspan" id="g-gspan" style="left:${g.pc(h.wind)}%;width:${g.pc(h.gust) - g.pc(h.wind)}%"></div>
      <div class="g-gust" id="g-gust" style="left:${g.pc(h.gust)}%"></div>
      <div class="g-mark" id="g-mark" style="left:${g.pc(h.wind)}%"></div>
    </div>
    <div class="g-axis num" aria-hidden="true">${[0, 10, 20, 30, 40, 50].map(v => `<span style="left:${g.pc(v)}%">${v}</span>`).join("")}</div>
    <p class="g-note">${g.p.label} : idéal ${g.lo}-${g.hi} km/h, plafond ${g.ceil} km/h, rafales ${g.p.gustMax} km/h maxi (niveau ${g.lv.label.toLowerCase()}). Barre corail : vent moyen à 10 m. Cadre : rafales${h.gustEstimated ? " (estimées, le modèle ne les fournit pas)" : ""}.</p>
  </div>`;
}
/* COMPOSANT: hour-chip */
function renderHourChip(h, pressed) {
  const code = sectorCode(h.dir), key = h.verdict.key;
  return `<button type="button" class="hc num ${h.reachable ? "" : "is-off"}" data-action="hour" data-hour="${h.hour}" aria-pressed="${pressed}" aria-label="${h.hour}h, vent de ${FR_LONG[code]} ${h.wind} km/h, rafales ${h.gust}, pluie ${h.rain} mm${h.tide ? ", marée " + h.tide.label.toLowerCase() : ""}, ${h.verdict.label}${h.reachable ? "" : h.past ? ", heure passée" : ", hors de portée"}">
    <span class="hc-h">${h.hour}h</span>${renderWindArrow(h.dir, 22)}<span class="hc-w">${h.wind}</span>
    <span class="hc-s">raf. ${h.gust}<br>${frDir(code)}<br>${String(h.rain).replace(".", ",")} mm${h.tide ? `<br>${h.tide.label}` : ""}</span>
    <span class="hc-v vf--${key}">${renderVerdictIcon(key)}</span>${h.reachable ? "" : `<span class="hc-s">${h.past ? "passée" : "hors portée"}</span>`}${h.filled ? '<span class="hc-s" title="Donnée du modèle de secours">secours</span>' : ""}
  </button>`;
}
/* COMPOSANT: trip-plan */
function renderTripPlan(spot, slot, hours, day, sun) {
  const ride = rideMinutes(spot.access.rideKm);
  const climb = spot.access.climbM != null ? ` · +${spot.access.climbM} m` : "";
  const first = hours.find(h => h.reachable && h.isDay) || hours[7];
  const start = (slot ? slot.start : first.hour) * 60;
  const steps = [];
  if (spot.access.mode === "train") {
    const tr = spot.access.trainMinutes, dep = start - tr - ride - 20;
    const leave = toMin(settings.lastTrain) - ride - 15;
    steps.push(["t", dep, "Rennes", `Train ${spot.access.train}`]);
    steps.push(["leg", null, `${fmtDur(tr)} de train`, ""]);
    steps.push(["t", dep + tr, `Gare de ${spot.access.station}`, `Skate ${fmtKm(spot.access.rideKm)} · ${fmtDur(ride)}${climb}`]);
    steps.push(["leg", null, `${spot.access.ride}`, ""]);
    steps.push(["t", dep + tr + ride, "Arrivée au site", "Préparation, 10 min"]);
    steps.push(["hl", start, slot ? `Créneau ${fmtRange(slot.start, slot.end)}` : "Première heure atteignable", slot ? `${frDir(slot.sector)} ${slot.wind} km/h, rafales ${slot.gust}` : "Aucun créneau au-dessus du score minimum"]);
    steps.push(["t", leave, "Quitter le site", "Retour en skate vers la gare"]);
    steps.push(["t", toMin(settings.lastTrain), "Dernier train conseillé", `Depuis ${spot.access.station}, horaires à vérifier`]);
  } else if (spot.access.mode === "voiture") {
    const drive = spot.access.driveMinutes, dep = start - drive - 20;
    steps.push(["t", dep, "Rennes", `Voiture ou covoiturage club, environ ${spot.access.driveKm} km`]);
    steps.push(["leg", null, `${fmtDur(drive)} de route (estimation)${spot.access.nearStation ? ` · gare la plus proche : ${spot.access.nearStation}` : ""}`, ""]);
    steps.push(["t", dep + drive, "Arrivée au site", "Préparation, 20 min"]);
    steps.push(["hl", start, slot ? `Créneau ${fmtRange(slot.start, slot.end)}` : "Première heure possible", slot ? `${frDir(slot.sector)} ${slot.wind} km/h, rafales ${slot.gust}` : "Aucun créneau au-dessus du score minimum"]);
    steps.push(["t", toMin(sun.sunset), "Coucher du soleil", `Retour vers Rennes : ${fmtDur(drive)}`]);
  } else {
    steps.push(["t", start - ride - 10, "Rennes, centre", `Skate ${fmtKm(spot.access.rideKm)} · ${fmtDur(ride)}${climb}`]);
    steps.push(["leg", null, spot.access.ride, ""]);
    steps.push(["hl", start, slot ? `Créneau ${fmtRange(slot.start, slot.end)}` : "Première heure possible", slot ? `${frDir(slot.sector)} ${slot.wind} km/h, rafales ${slot.gust}` : "Aucun créneau au-dessus du score minimum"]);
    steps.push(["t", toMin(sun.sunset), "Coucher du soleil", "Fin de séance"]);
  }
  return `<ol class="plan">${steps.map(([k, t, a, b]) => k === "leg"
    ? `<li class="leg"><span class="t"></span><span class="n"></span><span class="d"><small>${esc(a)}</small></span></li>`
    : `<li class="${k === "hl" ? "hl" : ""}"><span class="t num">${fmtClock(t)}</span><span class="n"><i></i></span><span class="d"><b>${esc(a)}</b><small>${esc(b)}</small></span></li>`).join("")}</ol>`;
}
/* COMPOSANT: detail */
function renderDetail(spot, dayIndex, hour) {
  const day = DAYS[dayIndex], d = FORECAST[dayIndex].bySpot[spot.id], slot = d.slots[0], sun = d.sun || day;
  const focus = d.hours.find(h => h.hour === hour) || d.hours[7];
  const s = spotSummary(d.hours, slot);
  const from = spot.access.mode === "train" ? STATIONS.find(x => x.name === spot.access.station) : STATIONS[0];
  const lk = (href, label, ic) => href ? `<a class="lk" href="${esc(href)}" target="_blank" rel="noopener">${ic}${label}</a>` : "";
  const conf = { haute: ["bonne", 3, "Orientations et règles issues de la fiche FFVL, de wikiparapente ou du club gestionnaire."], moyenne: ["moyenne", 2, "Orientations issues d'une base communautaire (ParaglidingEarth, spots.guru), accès estimé."], faible: ["faible", 1, "Fiche incomplète : à confirmer auprès des pilotes locaux."] }[spot.confidence] || ["inconnue", 0, ""];
  return `<div class="detail-in stagger">
    <div class="d-head">
      <div><h2 class="d-title" id="d-title">${esc(spot.name)}</h2>
        <p class="d-sub"><span>${kindIcon(spot.kind)}${practiceLabel(spot)} · ${esc(spot.city)}</span></p>
        <p class="d-sub num"><span>${I.calendar}${esc(capFirst(day.long))}</span><span>${I.sunrise}${fmtHHMM(sun.sunrise)}</span><span>${I.sunset}${fmtHHMM(sun.sunset)}</span><span>${I.model}${esc(MODELS[usedModel].label)}</span></p></div>
      <span class="d-acts"><button type="button" class="s3-fav glass ${settings.favs.includes(spot.id) ? "is-on" : ""}" data-action="fav" data-spot="${spot.id}" aria-pressed="${settings.favs.includes(spot.id)}" aria-label="Favori">${STAR}</button><button type="button" class="close" data-action="close-detail" aria-label="Fermer">${ICON_DOWN}</button></span>
    </div>
    <div class="d-verdict"><span class="vbadge vbadge--${s.verdict.key}">${renderVerdictIcon(s.verdict.key)}${s.verdict.label}</span><b class="num">${slot ? fmtRange(slot.start, slot.end) : "Pas de créneau"}</b></div>
    <section class="d-sec"><h3>Vent</h3><div class="instrument">${renderCompass(spot, d.hours, focus)}${renderGauge(spot, focus)}</div></section>
    <section class="d-sec"><h3>Heure par heure</h3><div class="hours" id="d-hours">${d.hours.map(h => renderHourChip(h, h.hour === focus.hour)).join("")}</div></section>
    <section class="d-sec"><h3>Modèles de prévision</h3>${renderModelCompare(spot, d, focus.hour)}</section>
    <section class="d-sec"><h3>Plan de vol</h3>${renderTripPlan(spot, slot, d.hours, day, sun)}</section>
    <section class="d-sec"><h3>Recommandations</h3><ul class="recos">${generateRecommendations(spot, d.hours, slot, dayIndex).map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
    <section class="d-sec"><h3>Règles et vigilance</h3><ul class="rules">${spot.rules.map(x => `<li>${I.info}<span>${esc(x)}</span></li>`).join("")}${spot.warnings.map(x => `<li class="warn">${I.alert}<span>${esc(x)}</span></li>`).join("")}</ul></section>
    <section class="d-sec"><h3>Fiche du site</h3>${renderSiteSheet(spot)}</section>
    <section class="d-sec"><h3>Spot Air</h3>${renderSpotAir(spot)}</section>
    <section class="d-sec"><h3>Liens</h3><div class="links">
      ${lk(spot.links.ffvl, "Fiche FFVL", I.info)}${lk(spot.links.spotair, "Spot Air", I.wind)}${lk(spot.links.club, "Club", I.club)}${lk(spot.links.doc, "Document du site", I.info)}
      ${lk(spot.links.webcam, "Webcam", I.ext)}${lk(spot.links.maree, "Hauteur d'eau", I.wave)}${lk(spot.links.meteo, "Prévision locale", I.wind)}
      ${lk("https://www.balisemeteo.com/", "Balises FFVL", I.wind)}${lk(`https://www.windy.com/?${spot.lat},${spot.lon},11`, "Windy", I.wind)}
      ${lk(spot.access.mode === "voiture" ? `https://www.google.com/maps/dir/?api=1&origin=48.1035,-1.6724&destination=${spot.lat},${spot.lon}&travelmode=driving` : `https://www.openstreetmap.org/directions?engine=fossgis_osrm_bike&route=${from.lat}%2C${from.lon}%3B${spot.lat}%2C${spot.lon}`, spot.access.mode === "voiture" ? "Itinéraire en voiture" : spot.access.mode === "train" ? "Itinéraire gare - site" : "Itinéraire depuis Rennes", accessIcon(spot))}
      ${spot.access.mode === "train" ? lk("https://www.sncf-connect.com/", "Horaires SNCF", I.train) : ""}${spot.tide ? lk("https://maree.shom.fr/", "Marées SHOM", I.wave) : ""}
    </div></section>
    <p class="reliab"><b>Fiabilité des données du site : ${conf[0]}</b><span class="meter" aria-hidden="true">${[1, 2, 3].map(n => `<i class="${n <= conf[1] ? "on" : ""}"></i>`).join("")}</span><br>${esc(conf[2])} Prévisions indicatives : vérifie les balises sur place avant de décoller.</p>
  </div>`;
}
/* COMPOSANT: panel (réglages) */
function renderPanel(s, notifState, onbStep, subJson) {
  const seg = (name, opts, val) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([k, l]) => `<button type="button" data-setting="${name}" data-value="${k}" aria-pressed="${k === val}">${l}</button>`).join("")}</div>`;
  const head = `<div class="d-head"><div><h2 class="p-title" id="p-title">${onbStep >= 0 ? "Notifications" : "Réglages"}</h2></div><button type="button" class="close" data-action="${onbStep >= 0 ? "onb-back" : "close-panel"}" aria-label="${onbStep >= 0 ? "Retour aux réglages" : "Fermer"}">${I.close}</button></div>`;
  if (state.favStep) return renderFavPicker(s);
  if (onbStep >= 0) return `<div class="panel-in">${head}
    <p class="hint">Sur iPhone, les notifications ne fonctionnent qu'une fois l'app ajoutée à l'écran d'accueil.</p>
    <div class="onb"><div class="onb-dots" aria-hidden="true">${[0, 1, 2].map(i => `<i class="${i <= onbStep ? "on" : ""}"></i>`).join("")}</div>${renderOnboardingIos(onbStep)}</div>
    <div class="btn-row">${onbStep > 0 ? `<button type="button" class="btn btn--ghost" data-action="onb-prev">Précédent</button>` : ""}${onbStep < 2 ? `<button type="button" class="btn btn--wing" data-action="onb-next">Suivant</button>` : `<button type="button" class="btn btn--wing" data-action="onb-done">C'est fait, activer</button>`}</div>
    <p class="hint" style="text-align:center">Sur Android, aucune installation n'est nécessaire : l'autorisation est demandée directement.</p></div>`;
  return `<div class="panel-in">${head}
    <div class="group"><div class="field"><span class="lbl">Niveau</span>${seg("level", Object.entries(LEVELS).map(([k, v]) => [k, v.label]), s.level)}<p class="hint">Ajuste la plage de vent idéale et le plafond de chaque site.</p></div>
      <div class="field"><span class="lbl">Modèle de prévision</span>${seg("model", MODEL_KEYS.map(k => [k, MODELS[k].label]), s.model)}<p class="hint">AROME HD (Météo-France, 1,5 km, 2 jours, comblé par AROME/ARPEGE au-delà), ECMWF IFS (9 km) ou GFS (NOAA). La fiche de chaque spot compare les trois.</p></div></div>
    <div class="group">
      <div class="field"><div class="row"><label class="lbl" for="set-score">Score minimum d'un créneau</label><output class="big-val num" id="out-score">${s.scoreMin}</output></div><input type="range" id="set-score" min="30" max="90" step="5" value="${s.scoreMin}" data-setting="scoreMin"></div>
      <div class="field"><div class="row"><label class="lbl" for="set-dep">Premier départ de Rennes</label><input type="time" id="set-dep" value="${s.firstDeparture}" data-setting="firstDeparture"></div></div>
      <div class="field"><div class="row"><label class="lbl" for="set-last">Dernier train retour</label><input type="time" id="set-last" value="${s.lastTrain}" data-setting="lastTrain"></div><p class="hint">Les heures hors de cette fenêtre sont grisées sur le ruban du temps.</p></div>
      <div class="field"><label class="check"><input type="checkbox" data-setting="includeCar" ${s.includeCar ? "checked" : ""}>Afficher aussi les sites sans gare proche (voiture, covoiturage club)</label>
        <label class="check"><input type="checkbox" data-setting="includeTreuil" ${s.includeTreuil ? "checked" : ""}>Afficher les terrains de treuil</label>
        <p class="hint">Treuils : ne se pratiquent qu'avec un club. Saint-Séglin et Massérac sont des terrains FFVL, Crocy et Martigny viennent de wikiparapente, Sougéal seulement de ParaglidingEarth : à confirmer auprès des clubs.</p></div>
      <div class="field"><div class="row"><span class="lbl">Spots favoris</span><span class="status ${s.favs.length ? "status--on" : "status--off"}">${s.favs.length || "Aucun"}</span></div><p class="hint">Tes favoris sont mis en avant (étoile) et le bouton étoile en bas de l'écran n'affiche qu'eux.</p><button type="button" class="btn btn--ghost" data-action="fav-open">${STAR}Choisir mes spots favoris</button></div>
      <div class="field"><span class="lbl">Mes spots</span><p class="hint">Décoche les spots que tu ne veux pas voir sur la carte ni dans les cartes.</p>${renderSpotPicker(s)}</div>
    </div>
    <div class="group">
      <div class="field"><div class="row"><span class="lbl">Alertes créneaux</span><span class="status ${s.notifEnabled ? "status--on" : "status--off"}">${s.notifEnabled ? "Actives" : "Inactives"}</span></div>
        <p class="hint">Envoyées par le robot GitHub à 7h (aujourd'hui et demain) et 18h30 (demain), si un créneau dépasse le score minimum réglé dans data/config.json.</p></div>
      <div class="field"><div class="btn-row">${s.notifEnabled ? "" : `<button type="button" class="btn btn--wing" data-action="onb-start">${I.bell}Activer</button>`}<button type="button" class="btn btn--ghost" data-action="test-notif">Tester une notification</button></div>${notifState ? `<p class="hint" role="status">${esc(notifState)}</p>` : ""}${subJson ? `<label class="lbl" for="sub-box" style="font-size:14px">Abonnement de cet appareil (secret GitHub WEB_PUSH_SUBSCRIPTION)</label><textarea id="sub-box" class="sub-box" readonly>${esc(subJson)}</textarea><button type="button" class="btn btn--ghost" data-action="copy-sub">Copier l'abonnement</button>` : ""}</div>
    </div>
    <div class="group"><div class="field"><span class="lbl">Apparence</span>${seg("theme", [["system", "Système"], ["light", "Clair"], ["dark", "Sombre"]], s.theme)}</div></div>
    <div class="group"><div class="field"><span class="lbl">Légende de la carte</span><div class="legend-in">${renderLegend()}</div><label class="check"><input type="checkbox" data-legend-toggle="1" ${s.legendHidden ? "" : "checked"}>Afficher la légende quand je déplace la carte</label></div></div>
    <div class="group"><div class="field"><span class="lbl">Installer sur le téléphone</span><p class="hint">Android (Chrome) : menu ⋮ puis « Installer l'application ». iPhone (Safari) : bouton Partager puis « Sur l'écran d'accueil ».</p>${installPrompt ? `<button type="button" class="btn btn--wing" data-action="install">Installer ParaSpot</button>` : ""}</div></div>
    <p class="hint">Prévisions Open-Meteo (AROME HD et AROME/ARPEGE Météo-France, ECMWF IFS, NOAA GFS ; CC BY 4.0), marées Open-Meteo Marine indicatives. Fiches : wikiparapente.fr, FFVL, ParaglidingEarth, spots.guru, clubs. Balises et carte : Spot Air. Fond de carte embarqué : Natural Earth. ${ALL_SPOTS.length} spots.</p>
  </div>`;
}

/* =========================================================
   MOTEUR : caméra, champ de vent, ciel
   ========================================================= */
const state = { subJson: "", kindInit: true, windOn: true, layer: "plan", day: 0, kind: ["tout","gonflage","vol","favoris"].includes(settings.kind) ? settings.kind : "tout", sel: null, pinned: false, favStep: false, hour: 14, playing: false, detail: false, panel: false, onbStep: -1, loading: false, offline: !navigator.onLine, notifState: "" };
const $ = s => document.querySelector(s);
const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* =========================================================
   CARTE (Leaflet) : tuiles OpenStreetMap stylées + fond vectoriel embarqué de secours,
   pincer pour zoomer, regroupement des spots proches, caméra qui vole vers la sélection.
   ========================================================= */
const LAYERS = ["plan", "detail", "relief"];
const LAYER_LABEL = { plan: "Plan", detail: "Détail", relief: "Relief" };
const TILES = {
  plan: null,
  detail: { light: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", dark: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", attr: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>, fond OpenStreetMap France', max: 19 },
  relief: { light: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", dark: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>, SRTM · style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', max: 17 }
};
/* Couleurs du fond vectoriel embarqué (lues selon le thème) */
function baseColors() {
  return isDark()
    ? { urban: "#2f4268", water: "#050e1d", river: "#2b5d94", rail: "#6b7f9c", road: "#465d80", roadCase: "#1a2944", mw: "#e0954a", mwCase: "#6b3f17", label: "#c9d6ea", halo: "#13213a" }
    : { urban: "#e9d6cf", water: "#bcd7ec", river: "#8dbbe0", rail: "#7d8898", road: "#ffffff", roadCase: "#c9bba8", mw: "#f4a640", mwCase: "#b86d1e", label: "#2d3b52", halo: "#f4f0e8" };
}
let baseLayer = null, labelsLayer = null;
function buildBasemap() {
  if (!map) return;
  if (baseLayer) map.removeLayer(baseLayer);
  const c = baseColors(), z = map.getZoom(), k = z < 7.5 ? 0.6 : z < 9 ? 0.85 : z < 11 ? 1.2 : z < 13 ? 1.7 : 2.3;
  const r = L.canvas({ pane: "base", padding: 0.4 }), g = L.layerGroup();
  const sw = l => l.map(([x, y]) => [y, x]);
  BASEMAP.urban.forEach(p => L.polygon(p.map(sw), { renderer: r, interactive: false, stroke: false, fillColor: c.urban, fillOpacity: z >= 11 ? 0.45 : 1 }).addTo(g));
  BASEMAP.lake.forEach(p => L.polygon(p.map(sw), { renderer: r, interactive: false, stroke: false, fillColor: c.water, fillOpacity: 1 }).addTo(g));
  const line = (arr, o) => L.polyline(arr.map(sw), { renderer: r, interactive: false, lineCap: "round", lineJoin: "round", ...o }).addTo(g);
  line(BASEMAP.river, { color: c.river, weight: 1.3 * k });
  line(BASEMAP.rail, { color: c.rail, weight: 1.1 * k, dashArray: `${4 * k} ${3 * k}` });
  line(BASEMAP.secondary, { color: c.roadCase, weight: 3.2 * k }); line(BASEMAP.secondary, { color: c.road, weight: 1.8 * k });
  line(BASEMAP.motorway, { color: c.mwCase, weight: 5 * k }); line(BASEMAP.motorway, { color: c.mw, weight: 3 * k });
  g.addTo(map); baseLayer = g;
}
function buildLabels() {
  if (labelsLayer) map.removeLayer(labelsLayer);
  labelsLayer = L.layerGroup();
  PLACES_ALL.forEach(([name, lat, lon, tier]) => L.marker([lat, lon], { pane: "labels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span class="plc plc--t${tier}"><i></i>${esc(name)}</span>`, iconSize: [0, 0] }) }).addTo(labelsLayer));
  labelsLayer.addTo(map);
}
function zoomClasses() {
  const z = map.getZoom(), m = $("#map");
  m.classList.toggle("z-hi", z >= 12); m.classList.toggle("z-lo", z < 10);
  m.dataset.tier = z < 7.75 ? "1" : z < 9.25 ? "2" : "3";
}
let map = null, tileLayer = null, markersLayer = null, routeLayer = null, markerObjs = {}, clusterObjs = [];
function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: false, minZoom: 6, maxZoom: 16, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 100, maxBounds: [[45.4, -6.8], [50.7, 2.8]], maxBoundsViscosity: 0.7, keyboard: true });
  const fb = map.createPane("fallback"); fb.style.zIndex = 150;
  map.createPane("base").style.zIndex = 160;
  const lp = map.createPane("labels"); lp.style.zIndex = 450; lp.style.pointerEvents = "none";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${GEO.W} ${GEO.H}`);
  svg.innerHTML = GEO.ripples.map(d => `<path class="fb-rip" d="${d}"/>`).join("") + `<path class="fb-land" d="${GEO.land}"/>`;
  L.svgOverlay(svg, [[GEO.b[0], GEO.b[1]], [GEO.b[2], GEO.b[3]]], { pane: "fallback", interactive: false }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  STATIONS.forEach(st => L.marker([st.lat, st.lon], { icon: L.divIcon({ className: "", html: `<div class="stn">${I.train}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false, keyboard: false }).addTo(map));
  markersLayer = L.layerGroup().addTo(map);
  map.on("zoomend", () => { renderMarkers(); zoomClasses(); buildBasemap(); });
  map.on("movestart", () => document.body.classList.add("is-moving"));
  /* Mode carte : dès que l'utilisateur manipule la carte, l'interface se replie pour laisser voir le fond */
  ["pointerdown", "wheel", "touchstart"].forEach(ev => $("#map").addEventListener(ev, () => setMapFocus(true), { passive: true }));
  map.on("moveend", () => document.body.classList.remove("is-moving"));
}
function setTiles() {
  if (!map) return;
  const t = TILES[state.layer], dark = isDark();
  if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
  buildBasemap(); $("#map").classList.toggle("has-tiles", !!t);
  document.querySelectorAll('[data-action="layer"]').forEach(b => { b.querySelector("span").textContent = LAYER_LABEL[state.layer]; b.setAttribute("aria-label", `Fond de carte : ${LAYER_LABEL[state.layer]}. Changer.`); });
  if (!t) { $("#attrib").innerHTML = 'Fond embarqué : <a href="https://www.naturalearthdata.com/">Natural Earth</a> (domaine public)'; return; }
  tileLayer = L.tileLayer(t[dark ? "dark" : "light"], { maxZoom: t.max, subdomains: "abc", detectRetina: false, className: dark ? (state.layer === "detail" ? "tiles-invert" : "tiles-dim") : "tiles-" + state.layer, crossOrigin: true }).addTo(map);
  $("#attrib").innerHTML = t.attr;
}
function viewPad() { return { paddingTopLeft: [28, $(".top").offsetHeight + 44], paddingBottomRight: [28, $(".dock").offsetHeight + 6] }; }
function flyTo(latlngs, maxZoom, instant) {
  if (!map) return;
  const b = L.latLngBounds(latlngs);
  if (reduce || instant) map.fitBounds(b, { ...viewPad(), maxZoom, animate: false });
  else map.flyToBounds(b, { ...viewPad(), maxZoom, duration: 1.15, easeLinearity: 0.2 });
}
function frameSpot(spot) { const r = routeLatLngs(spot); flyTo(r.skate.length ? r.skate : [[spot.lat, spot.lon]], spot.access.mode === "local" ? 13.5 : 13); }
/* Vue de départ : la Bretagne, Rennes au centre de la zone visible (cadre symétrique autour de Rennes) */
function homeView(instant) {
  if (!map) return;
  const dLon = 3.2, W = map.getSize().x, H = map.getSize().y;
  const z = map.getBoundsZoom(L.latLngBounds([[RENNES[0], RENNES[1] - dLon], [RENNES[0] + 0.01, RENNES[1] + dLon]]), false, L.point(16, 0));
  const top = $(".top").offsetHeight, dock = $(".dock").offsetHeight;
  const yTarget = top + 40 < H - dock - 40 ? (top + H - dock) / 2 : H / 2; // milieu de la zone de carte visible
  const c = map.unproject(map.project(RENNES, z).add([0, H / 2 - yTarget]), z);
  map.setView(c, z, { animate: !(reduce || instant), duration: 0.8 });
}
/* Spot choisi : on ne recadre que s'il est caché par l'interface, sans changer le zoom */
function revealSpot(spot) {
  if (!map) return;
  const pad = viewPad();
  map.panInside([spot.lat, spot.lon], { paddingTopLeft: pad.paddingTopLeft, paddingBottomRight: pad.paddingBottomRight, animate: !reduce });
}
function frameAll(instant) { flyTo([...items().map(x => [x.spot.lat, x.spot.lon]), RENNES], 11, instant); }
function renderRoute(spot) {
  if (!routeLayer) return;
  routeLayer.clearLayers();
  return; // tracé train / skate retiré (charge visuelle) : le trajet est détaillé dans le plan de vol
  const r = routeLatLngs(spot);
  if (r.train.length) { L.polyline(r.train, { className: "m-route-glow", interactive: false }).addTo(routeLayer); L.polyline(r.train, { className: "m-route-train", interactive: false }).addTo(routeLayer); }
  if (r.car) { L.polyline(r.car, { className: "m-route-glow", interactive: false }).addTo(routeLayer); L.polyline(r.car, { className: "m-route-car", interactive: false }).addTo(routeLayer); }
  if (r.skate.length) { L.polyline(r.skate, { className: "m-route-glow", interactive: false }).addTo(routeLayer); L.polyline(r.skate, { className: "m-route-skate", interactive: false }).addTo(routeLayer); }
}
/* Regroupe les spots trop proches à l'écran (le spot sélectionné reste toujours seul) */
function renderMarkers() {
  if (!map || !markersLayer) return;
  if (!FORECAST) { markersLayer.clearLayers(); return; }
  markersLayer.clearLayers(); markerObjs = {}; clusterObjs = [];
  const vis = SPOTS.filter(s => kindOk(s, state.kind));
  const groups = [];
  vis.forEach(s => {
    const p = map.latLngToLayerPoint([s.lat, s.lon]);
    const g = s.id === state.sel ? null : groups.find(g => !g.sel && g.p.distanceTo(p) < 48);
    if (g) g.m.push(s); else groups.push({ p, m: [s], sel: s.id === state.sel });
  });
  groups.forEach(g => {
    if (g.m.length === 1) {
      const s = g.m[0], h = hourOf(s.id, state.day, state.hour);
      const mk = L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", html: renderMarker(s, h, s.id === state.sel), iconSize: [44, 44], iconAnchor: [22, 22] }), title: s.name, alt: s.name, keyboard: true, zIndexOffset: s.id === state.sel ? 1000 : 0 });
      mk.on("click", () => pickSpot(s.id));
      mk.addTo(markersLayer); markerObjs[s.id] = mk;
    } else {
      const best = g.m.map(s => markerKey(hourOf(s.id, state.day, state.hour))).sort((a, b) => (RANK[b] ?? -1) - (RANK[a] ?? -1))[0];
      const lat = g.m.reduce((a, s) => a + s.lat, 0) / g.m.length, lon = g.m.reduce((a, s) => a + s.lon, 0) / g.m.length;
      const c = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: renderCluster(g.m, best), iconSize: [48, 48], iconAnchor: [24, 24] }), title: `${g.m.length} spots : ${g.m.map(s => s.name).join(", ")}`, keyboard: true });
      c.on("click", () => map.flyToBounds(L.latLngBounds(g.m.map(s => [s.lat, s.lon])), { ...viewPad(), maxZoom: 14, duration: 0.9 }));
      c.addTo(markersLayer); clusterObjs.push({ c, m: g.m });
    }
  });
}
/* Changement d'heure : on modifie les marqueurs en place pour que les couleurs s'animent */
function refreshMarkerStates() {
  Object.entries(markerObjs).forEach(([id, mk]) => {
    const el = mk.getElement && mk.getElement(); if (!el) return;
    const h = hourOf(id, state.day, state.hour), node = el.querySelector(".mk");
    node.className = `mk mk--${markerKey(h)} ${id === state.sel ? "is-sel" : ""} ${settings.favs.includes(id) ? "is-fav" : ""}`;
    node.querySelector(".mk-dot").innerHTML = renderVerdictIcon(h.reachable ? h.verdict.key : "non");
  });
  clusterObjs.forEach(({ c, m }) => {
    const el = c.getElement && c.getElement(); if (!el) return;
    const best = m.map(s => markerKey(hourOf(s.id, state.day, state.hour))).sort((a, b) => (RANK[b] ?? -1) - (RANK[a] ?? -1))[0];
    el.querySelector(".mk-cluster").className = `mk-cluster c--${best}`;
  });
}
function setMapFocus(on) {
  if (document.body.classList.contains("map-focus") === on) return;
  document.body.classList.toggle("map-focus", on);
  const b = $("#focus-btn"); if (b) { b.hidden = !on; }
}
function pickSpot(id) {
  setMapFocus(false);
  pinSpot(id); syncSelection(false);
  const c = $(`.card[data-spot="${id}"]`); if (c) c.scrollIntoView({ inline: "center", block: "nearest", behavior: reduce ? "instant" : "smooth" });
}

/* Champ de vent : particules en espace écran, direction et force du spot sélectionné à l'heure choisie */
const wind = { dir: 315, speed: 18, target: { dir: 315, speed: 18 }, parts: [], ctx: null, w: 0, h: 0, dpr: 1, color: "11,27,51", alpha: .3, raf: 0 };
function windColors() {
  const cs = getComputedStyle(document.documentElement);
  wind.color = cs.getPropertyValue("--particle").trim() || "11,27,51";
  wind.alpha = parseFloat(cs.getPropertyValue("--particle-alpha")) || .3;
}
function windResize() {
  const cv = $("#wind"); wind.dpr = Math.min(2, devicePixelRatio || 1);
  wind.w = innerWidth; wind.h = innerHeight;
  cv.width = wind.w * wind.dpr; cv.height = wind.h * wind.dpr;
  wind.ctx = cv.getContext("2d"); wind.ctx.setTransform(wind.dpr, 0, 0, wind.dpr, 0, 0);
  const n = Math.round(Math.min(700, wind.w * wind.h / 1000));
  wind.parts = Array.from({ length: n }, () => spawn({}));
}
function spawn(p) { p.x = Math.random() * wind.w; p.y = Math.random() * wind.h; p.age = 0; p.life = 60 + Math.random() * 120; p.k = .7 + Math.random() * .6; return p; }
function setWindTarget(h) { wind.target = { dir: h.dir, speed: h.wind }; }
let tick = 0;
function windStep() {
  const t = wind.target, ctx = wind.ctx;
  let dd = ((t.dir - wind.dir + 540) % 360) - 180; wind.dir = (wind.dir + dd * 0.05 + 360) % 360;
  wind.speed += (t.speed - wind.speed) * 0.05;
  ctx.globalCompositeOperation = "destination-in"; ctx.fillStyle = "rgba(0,0,0,.90)"; ctx.fillRect(0, 0, wind.w, wind.h);
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = `rgba(${wind.color},${wind.alpha})`; ctx.lineWidth = 1.3; ctx.lineCap = "round";
  const to = (wind.dir + 180) * Math.PI / 180, base = 0.25 + wind.speed * 0.11;
  tick++;
  ctx.beginPath();
  for (const p of wind.parts) {
    const n = Math.sin(p.x * 0.006 + tick * 0.01) * Math.cos(p.y * 0.007 - tick * 0.008) * 0.45;
    const a = to + n, v = base * p.k * (1 + 0.25 * Math.sin(tick * 0.05 + p.k * 9));
    const nx = p.x + Math.sin(a) * v, ny = p.y - Math.cos(a) * v;
    ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny);
    p.x = nx; p.y = ny; p.age++;
    if (p.age > p.life || nx < -10 || ny < -10 || nx > wind.w + 10 || ny > wind.h + 10) spawn(p);
  }
  ctx.stroke();
}
function windLoop() { windStep(); wind.raf = requestAnimationFrame(windLoop); }
function windStart() {
  cancelAnimationFrame(wind.raf);
  if (reduce) { wind.dir = wind.target.dir; wind.speed = wind.target.speed; for (let i = 0; i < 24; i++) windStep(); return; }
  windLoop();
}
document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(wind.raf); else windStart(); });

/* Teinte du ciel selon l'heure (aube, plein jour, lumière rasante, crépuscule) */
const SKY = {
  light: [[7, [255, 186, 140, .34], [255, 226, 200, .16]], [10, [255, 255, 255, 0], [255, 255, 255, 0]], [16, [255, 255, 255, 0], [255, 255, 255, 0]], [18, [255, 196, 140, .26], [255, 214, 180, .12]], [19.5, [255, 140, 100, .26], [150, 140, 210, .18]], [21, [60, 70, 140, .34], [30, 40, 100, .34]]],
  dark: [[7, [255, 130, 80, .20], [255, 170, 120, .06]], [10, [80, 140, 255, .08], [0, 0, 0, 0]], [16, [80, 140, 255, .08], [0, 0, 0, 0]], [18.5, [255, 150, 90, .16], [255, 110, 80, .06]], [21, [0, 0, 0, 0], [0, 0, 0, 0]]]
};
function isDark() { return settings.theme === "dark" || (settings.theme === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); }
function skyAt(h) {
  const k = SKY[isDark() ? "dark" : "light"];
  let i = k.findIndex(e => e[0] >= h); if (i <= 0) i = Math.max(1, i === -1 ? k.length - 1 : 1);
  const [h0, a0, b0] = k[i - 1], [h1, a1, b1] = k[i], f = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
  const mix = (x, y) => x.map((v, j) => j < 3 ? Math.round(v + (y[j] - v) * f) : +(v + (y[j] - v) * f).toFixed(3));
  const rgba = c => `rgba(${c.join(",")})`;
  return [rgba(mix(a0, a1)), rgba(mix(b0, b1))];
}
function applySky() { const [a, b] = skyAt(state.hour); const s = $("#sky").style; s.setProperty("--sky-a", a); s.setProperty("--sky-b", b); }

/* =========================================================
   ASSEMBLAGE
   ========================================================= */
function items() { return spotsForDay(state.day, state.kind); }
function selItem() { return items().find(x => x.spot.id === state.sel) || items()[0]; }
function pickDefault() {
  const it = items(), best = it.find(x => x.slots.length) || it[0];
  if (!best) { state.sel = null; return; }
  state.sel = best.spot.id;
  const firstOk = best.hours.find(h => h.reachable && h.isDay);
  state.hour = best.slots[0] ? best.slots[0].start : (firstOk ? Math.max(firstOk.hour, Math.min(14, 21)) : 14);
}
function renderTop() {
  if (!FORECAST) return renderWaiting();
  $("#days").innerHTML = renderDays(state.day, state.kind);
  document.body.classList.toggle("is-pinned", !!(state.pinned && state.sel));
  if (state.pinned && state.sel) {
    const spot = spotById(state.sel), fav = settings.favs.includes(spot.id);
    $("#eyebrow").innerHTML = `<p class="st-eyebrow"><span class="live"></span>Spot suivi · 3 jours</p>
      <button type="button" class="upd glass" data-action="unpin" aria-label="Revenir à la vue d'ensemble de tous les spots">Tous les spots</button>`;
    $("#statement").innerHTML = renderSpotDays(spot, fav);
    return;
  }
  const it = items(), best = it.find(x => x.slots.length);
  let reason = "";
  if (!best) {
    const cnt = {}; it.forEach(x => x.hours.filter(h => h.reachable && h.isDay).forEach(h => h.reasons.forEach(r => cnt[r] = (cnt[r] || 0) + 1)));
    reason = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0].toLowerCase()).join(" et ");
  }
  $("#statement").innerHTML = renderStatement({ day: DAYS[state.day], slot: best && best.slots[0], spot: best && best.spot, next: best ? null : nextWindow(state.day, state.kind), offline: state.offline, updatedAt: UPDATED_AT, reason });
  $("#eyebrow").innerHTML = `<p class="st-eyebrow"><span class="live"></span>${esc(DAYS[state.day].short)} · meilleure fenêtre</p>
    <button type="button" class="upd glass ${state.loading ? "is-loading" : ""}" data-action="refresh" aria-label="Actualiser les prévisions, mises à jour à ${fmtHHMM(UPDATED_AT.slice(11, 16))}">${state.loading ? "En cours" : fmtHHMM(UPDATED_AT.slice(11, 16))}${I.refresh}</button>`;
}
function renderDock() {
  $("#kinds").innerHTML = renderKinds(state.kind);
  const it = items(), n = it.reduce((a, x) => a + x.slots.length, 0);
  $("#carousel").setAttribute("aria-label", `${it.length} spots, ${n} créneau${n > 1 ? "x" : ""}, du meilleur au moins bon`);
  $("#carousel").innerHTML = it.map(x => renderCard(x.spot, x.hours, x.slots[0], x.spot.id === state.sel, state.hour)).join("");
  renderScrubOnly();
}
function renderScrubOnly() {
  const x = selItem(); if (!x) { $("#scrub").innerHTML = ""; return; }
  $("#scrub").innerHTML = renderScrub(x.spot, x.hours, state.hour, state.playing);
}
/* Suivre un spot : il reste sélectionné quand on change de jour, le haut de l'écran montre ses 3 jours */
function pinSpot(id) {
  state.sel = id; state.pinned = true;
  const d = FORECAST[state.day].bySpot[id], sl = d && d.slots[0];
  if (sl) state.hour = Math.max(7, Math.min(21, sl.start));
  renderTop(); refreshCards();
}
function unpin() { state.pinned = false; pickDefault(); renderAll(false); }
function refreshCards() { document.querySelectorAll(".card").forEach(c => c.classList.toggle("is-sel", c.dataset.spot === state.sel)); }
function syncSelection(fly = false) {
  const x = selItem(); if (!x) return; state.sel = x.spot.id;
  document.querySelectorAll(".card").forEach(c => c.classList.toggle("is-sel", c.dataset.spot === state.sel));
  renderRoute(x.spot);
  renderMarkers(); renderScrubOnly();
  setWindTarget(hourOf(x.spot.id, state.day, state.hour));
  if (fly) revealSpot(x.spot);
}
function setHour(h, fromDetail) {
  state.hour = h;
  document.querySelectorAll(".ribbon .now").forEach(n => n.style.left = ((h - 7 + 0.5) / 15 * 100).toFixed(2) + "%");
  refreshMarkerStates(); applySky();
  const x = selItem(); if (!x) return;
  setWindTarget(hourOf(x.spot.id, state.day, h));
  const inp = $("#hour"); if (inp && +inp.value !== h) inp.value = h;
  const hr = x.hours.find(q => q.hour === h);
  const lab = $(".scrub-hour"); if (lab) lab.innerHTML = `${h}h<small>${hr.wind} km/h</small>`;
  if (state.detail) { updateDetailHour(h); updateModelCompareHour(h); }
}
function renderAll(fly = false) {
  renderTop(); renderDock(); syncSelection(fly); applySky();
  requestAnimationFrame(() => { const c = $(`.card[data-spot="${state.sel}"]`); if (c) c.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" }); });
}

/* Détail : s'ouvre depuis le rectangle de la carte (clip-path) */
function openDetail(spotId) {
  if (state.sel !== spotId || !state.pinned) { state.sel = spotId; state.pinned = true; renderTop(); refreshCards(); }
  syncSelection(false);
  const el = $("#detail"), card = $(`.card[data-spot="${spotId}"]`) || $("#statement");
  const r = card.getBoundingClientRect();
  el.style.setProperty("--clip", `${r.top}px ${innerWidth - r.right}px ${innerHeight - r.bottom}px ${r.left}px`);
  el.innerHTML = renderDetail(spotById(spotId), state.day, state.hour);
  history.replaceState(null, "", `?spot=${spotId}&date=${DAYS[state.day].date}`);
  el.scrollTop = 0; void el.offsetWidth;
  el.classList.add("is-open"); state.detail = true;
  setTimeout(() => el.focus(), 50);
  const p = el.querySelector('.hc[aria-pressed="true"]'); if (p) { const sc = $("#d-hours"); sc.scrollLeft = p.offsetLeft - 16; }
}
function closeDetail() { $("#detail").classList.remove("is-open"); state.detail = false; history.replaceState(null, "", location.pathname); const c = $(`.card[data-spot="${state.sel}"]`); if (c) c.focus({ preventScroll: true }); }
function updateDetailHour(h) {
  const spot = spotById(state.sel), d = FORECAST[state.day].bySpot[spot.id], f = d.hours.find(x => x.hour === h), g = gaugeModel(spot, f);
  const rot = $("#cp-rot"); if (!rot) return;
  rot.style.transform = `rotate(${f.dir}deg)`; $("#cp-tagg").style.transform = `rotate(${-f.dir}deg)`;
  $("#cp-tagtxt").textContent = frDir(sectorCode(f.dir)); $("#cp-v").textContent = f.wind; $("#cp-h").textContent = `À ${h}H`;
  $("#g-w").innerHTML = `${f.wind}<small>km/h</small>`; $("#g-s").innerHTML = `Rafales ${f.gust} km/h<br>${g.state}`;
  $("#g-mark").style.left = g.pc(f.wind) + "%"; $("#g-gust").style.left = g.pc(f.gust) + "%";
  Object.assign($("#g-gspan").style, { left: g.pc(f.wind) + "%", width: (g.pc(f.gust) - g.pc(f.wind)) + "%" });
  document.querySelectorAll("#d-hours .hc").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.hour === h)));
}

/* Réglages */
function openPanel() { state.panel = true; renderPanelOnly(); $("#panel").classList.add("is-open"); setTimeout(() => $("#panel").focus(), 50); }
function renderPanelOnly() { $("#panel").innerHTML = renderPanel(settings, state.notifState, state.onbStep, state.subJson); }
function closePanel() { if (state.favStep && !settings.favsAsked) { settings.favsAsked = true; saveSettings(); } state.panel = false; state.onbStep = -1; state.favStep = false; $("#panel").classList.remove("is-open"); }
function applyTheme() {
  if (settings.theme === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", settings.theme);
  windColors(); applySky(); setTiles();
}

/* Lecture automatique de la journée */
let playTimer = null;
function togglePlay(force) {
  state.playing = force ?? !state.playing;
  clearInterval(playTimer);
  if (state.playing) playTimer = setInterval(() => setHour(state.hour >= 21 ? 7 : state.hour + 1), 700);
  const b = $(".play"); if (b) { b.innerHTML = state.playing ? ICON_PAUSE : ICON_PLAY; b.setAttribute("aria-label", state.playing ? "Mettre en pause" : "Faire défiler la journée"); }
}

/* Notification de test : même calcul que le robot */
let toastTimer = null;
async function testNotification() {
  const order = [1, 0, 2].filter(i => i < DAYS.length);
  const pool = order.map(i => spotsForDay(i, "tout").filter(x => x.slots.length).map(x => x.slots[0])).find(a => a.length) || [];
  const m = notificationText(pool, new Date());
  if (!m) { state.notifState = "Aucun créneau sur 3 jours : aucune notification ne serait envoyée."; renderPanelOnly(); return; }
  const n = { title: m.title, lines: m.lines, priority: m.priority === "high" ? "haute" : "normale", action: { label: "Voir le créneau", spotId: m.spotId, date: m.date } };
  $("#toast").innerHTML = `<button type="button" data-action="toast-open" data-spot="${n.action.spotId}" data-day="${DAYS.findIndex(d => d.date === n.action.date)}" aria-label="Notification de test : ${esc(n.title)}. Voir le créneau.">${renderNotificationPreview(n, { os: "ios", when: "maintenant" })}</button><button type="button" class="toast-x" data-action="toast-close" aria-label="Fermer la notification">${I.close}</button>`;
  $("#toast").classList.add("is-on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("#toast").classList.remove("is-on"), 6000);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(n.title, { body: n.lines.join("\n"), tag: "fv-test", icon: "icons/icon-192.png", badge: "icons/badge-96.png", data: { url: `./?spot=${n.action.spotId}&date=${n.action.date}` } });
    }
  } catch (e) { /* aperçu seulement */ }
  state.notifState = "Aperçu affiché en haut de l'écran. Touche-le pour ouvrir le créneau.";
  renderPanelOnly();
}

/* ---------- Événements ---------- */
document.addEventListener("click", e => {
  const seg = e.target.closest("[data-setting][data-value]");
  if (seg) { settings[seg.dataset.setting] = seg.dataset.value; saveSettings(); if (seg.dataset.setting === "theme") applyTheme(); if (["level", "model"].includes(seg.dataset.setting)) { buildForecast(); if (seg.dataset.setting === "model") pickDefault(); renderAll(false); updateModelButton(); } renderPanelOnly(); return; }
  const el = e.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action;
  if (a === "day") {
    setMapFocus(false); state.day = +el.dataset.day; togglePlay(false);
    if (state.pinned && state.sel) { const sl = FORECAST[state.day].bySpot[state.sel].slots[0]; if (sl) state.hour = Math.max(7, Math.min(21, sl.start)); }
    else pickDefault();
    renderAll(false);
  }
  else if (a === "kind") { setMapFocus(false); state.kind = el.dataset.kind; settings.kind = state.kind; saveSettings(); if (!items().some(x => x.spot.id === state.sel)) { state.pinned = false; pickDefault(); } renderAll(false); }
  else if (a === "card") { if (el.dataset.spot === state.sel && state.pinned) openDetail(el.dataset.spot); else { pinSpot(el.dataset.spot); syncSelection(true); el.scrollIntoView({ inline: "center", block: "nearest", behavior: reduce ? "instant" : "smooth" }); } }
  else if (a === "unpin") unpin();
  else if (a === "close-spot") { unpin(); setMapFocus(true); }
  else if (a === "info-close") hideInfo();
  else if (a === "legend-close") { settings.legendHidden = true; saveSettings(); document.body.classList.add("no-legend"); }
  else if (a === "toast-close") { $("#toast").classList.remove("is-on"); }
  else if (a === "fav-open") openFavPicker();
  else if (a === "fav-done") finishFavs(false);
  else if (a === "fav-skip") finishFavs(true);
  else if (a === "fav") {
    const id = el.dataset.spot;
    settings.favs = settings.favs.includes(id) ? settings.favs.filter(x => x !== id) : [...settings.favs, id]; saveSettings();
    if (state.kind === "favoris" && !settings.favs.length) { state.kind = "tout"; settings.kind = "tout"; saveSettings(); }
    renderAll(false);
    if (state.detail) { const b = $("#detail [data-action='fav']"); if (b) { const on = settings.favs.includes(id); b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); } }
  }
  else if (a === "layer") { state.layer = LAYERS[(LAYERS.indexOf(state.layer) + 1) % LAYERS.length]; setTiles(); }
  else if (a === "model") { settings.model = MODEL_KEYS[(MODEL_KEYS.indexOf(settings.model) + 1) % MODEL_KEYS.length]; saveSettings(); buildForecast(); if (!state.detail && !state.pinned) pickDefault(); renderAll(false); updateModelButton(); showInfo(`Modèle : ${MODELS[settings.model].label}`, MODEL_INFO[settings.model]); if (state.detail) openDetail(state.sel); }
  else if (a === "copy-sub") { navigator.clipboard?.writeText(state.subJson).then(() => { state.notifState = "Abonnement copié."; renderPanelOnly(); }).catch(() => {}); }
  else if (a === "install") { installPrompt?.prompt(); installPrompt = null; renderPanelOnly(); }
  else if (a === "overview") { frameAll(); }
  else if (a === "unfocus") { setMapFocus(false); }
  else if (a === "wind") { state.windOn = !state.windOn; document.body.classList.toggle("no-wind", !state.windOn); el.setAttribute("aria-pressed", String(!state.windOn)); }
  else if (a === "open") openDetail(el.dataset.spot);
  else if (a === "close-detail") closeDetail();
  else if (a === "hour") setHour(+el.dataset.hour);
  else if (a === "play") togglePlay();
  else if (a === "home") { setMapFocus(false); state.pinned = false; pickDefault(); renderAll(false); homeView(); }
  else if (a === "refresh") refresh(true);
  else if (a === "open-panel") openPanel();
  else if (a === "close-panel") closePanel();
  else if (a === "onb-start") { if (isIOS && !isStandalone()) { state.onbStep = 0; renderPanelOnly(); } else enablePush(); }
  else if (a === "onb-back") { state.onbStep = -1; renderPanelOnly(); }
  else if (a === "onb-next") { state.onbStep = Math.min(2, state.onbStep + 1); renderPanelOnly(); }
  else if (a === "onb-prev") { state.onbStep = Math.max(0, state.onbStep - 1); renderPanelOnly(); }
  else if (a === "onb-done") { state.onbStep = -1; if (isStandalone() || !isIOS) enablePush(); else { state.notifState = "Ajoute l'app à l'écran d'accueil, ouvre-la depuis sa nouvelle icône, puis touche à nouveau « Activer »."; renderPanelOnly(); } }
  else if (a === "test-notif") testNotification();
  else if (a === "toast-open") { $("#toast").classList.remove("is-on"); closePanel(); state.day = Math.max(0, +el.dataset.day); state.sel = el.dataset.spot; state.pinned = true; renderAll(false); openDetail(el.dataset.spot); }
});
document.addEventListener("input", e => {
  if (e.target.id === "hour") { togglePlay(false); setHour(+e.target.value); }
  if (e.target.id === "set-score") $("#out-score").textContent = e.target.value;
});
document.addEventListener("change", e => {
  if (e.target.dataset.legendToggle) { settings.legendHidden = !e.target.checked; saveSettings(); document.body.classList.toggle("no-legend", settings.legendHidden); return; }
  if (e.target.dataset.favToggle) {
    const id = e.target.dataset.favToggle;
    settings.favs = e.target.checked ? [...new Set([...settings.favs, id])] : settings.favs.filter(x => x !== id);
    saveSettings();
    const c = $("#fav-count"); if (c) c.textContent = `${settings.favs.length} favori${settings.favs.length > 1 ? "s" : ""}`;
    return;
  }
  if (e.target.dataset.spotToggle) {
    const id = e.target.dataset.spotToggle;
    settings.hidden = e.target.checked ? settings.hidden.filter(x => x !== id) : [...new Set([...settings.hidden, id])];
    saveSettings(); applySpotFilter(); if (!items().some(x => x.spot.id === state.sel)) pickDefault(); renderAll(false); return;
  }
  if (e.target.dataset.regionToggle) {
    const ids = e.target.dataset.regionToggle.split(",");
    settings.hidden = e.target.checked ? settings.hidden.filter(x => !ids.includes(x)) : [...new Set([...settings.hidden, ...ids])];
    saveSettings(); applySpotFilter(); if (!items().some(x => x.spot.id === state.sel)) pickDefault(); renderAll(false); renderPanelOnly(); return;
  }
  const k = e.target.dataset.setting; if (!k) return;
  if (e.target.type === "checkbox") settings[k] = e.target.checked;
  else if (k === "scoreMin") settings[k] = +e.target.value;
  else if (e.target.value) settings[k] = e.target.value;
  saveSettings();
  if (["includeCar", "includeTreuil"].includes(k)) { applySpotFilter(); if (!items().some(x => x.spot.id === state.sel)) pickDefault(); }
  if (["scoreMin", "firstDeparture", "lastTrain", "includeCar", "includeTreuil"].includes(k)) { buildForecast(); renderAll(false); renderPanelOnly(); }
});
document.addEventListener("keydown", e => { if (e.key === "Tab") document.body.classList.add("kbd"); });
document.addEventListener("pointerdown", () => document.body.classList.remove("kbd"));
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (state.panel) closePanel(); else if (state.detail) closeDetail(); } });
/* Le carrousel pilote la carte : la carte centrée devient la sélection */
let scrollT = null, userScroll = false;
["touchstart", "pointerdown", "wheel"].forEach(ev => $("#carousel").addEventListener(ev, () => { userScroll = true; }, { passive: true }));
$("#carousel").addEventListener("scroll", () => {
  if (!userScroll || document.body.classList.contains("map-focus")) return; // défilement provoqué par l'app : on ne change pas la sélection
  clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    userScroll = false;
    const mid = innerWidth / 2; let best = null, dist = 1e9;
    document.querySelectorAll(".card").forEach(c => { const r = c.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - mid); if (d < dist) { dist = d; best = c; } });
    if (best && best.dataset.spot !== state.sel) { if (state.pinned) pinSpot(best.dataset.spot); else { state.sel = best.dataset.spot; refreshCards(); } syncSelection(false); }
  }, 140);
}, { passive: true });
addEventListener("resize", () => { windResize(); if (map) map.invalidateSize(); });
addEventListener("offline", () => { state.offline = true; renderTop(); });
addEventListener("online", () => { state.offline = false; refresh(false); });
if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { windColors(); applySky(); setTiles(); });


/* =========================================================
   AJOUTS : comparaison des modèles, fiche du site, Spot Air
   ========================================================= */
function modelSummary(d, hour) {
  const i = d.hours.findIndex(h => h.hour === hour);
  if (i < 0) return "";
  const parts = MODEL_KEYS.filter(k => d.models[k]).map(k => [k, d.models[k]]).map(([k, hs]) => hs[i].missing ? `${MODELS[k].label} : pas de donnée` : `${MODELS[k].label} ${hs[i].wind} km/h ${frDir(sectorCode(hs[i].dir))}`);
  const a = d.agree[i];
  return `À ${hour}h : ${parts.join(" · ")}. <b>${esc(a.label)}</b>${a.level !== "inconnu" ? ` (écart ${a.windSpread} km/h, ${a.dirSpread}°)` : ""}.`;
}
function renderModelCompare(spot, d, focusHour) {
  const keys = MODEL_KEYS.filter(k => d.models[k]);
  if (keys.length < 2) return `<p class="hint">Un seul modèle a répondu pour l'instant : la comparaison s'affichera à la prochaine mise à jour.</p>`;
  const head = `<div class="mc-row mc-head"><span class="mc-lab"></span>${d.hours.map(h => `<span class="mc-h num ${h.hour === focusHour ? "is-focus" : ""}" data-h="${h.hour}">${h.hour}h</span>`).join("")}</div>`;
  const rows = keys.map(k => `<div class="mc-row ${k === usedModel ? "is-used" : ""}"><span class="mc-lab">${esc(MODELS[k].label)}<small>${esc(MODELS[k].res)}</small></span>${d.models[k].map(h =>
    `<button type="button" class="mc-c mcv--${h.missing ? "none" : h.verdict.key} ${h.hour === focusHour ? "is-focus" : ""} ${h.filled ? "is-filled" : ""}" data-action="hour" data-hour="${h.hour}" data-h="${h.hour}" aria-label="${esc(MODELS[k].label)} ${h.hour}h : ${h.missing ? "pas de donnée" : `${h.wind} km/h de ${FR_LONG[sectorCode(h.dir)]}, ${h.verdict.label}`}">${h.missing ? "-" : `${renderWindArrow(h.dir, 14)}<b class="num">${h.wind}</b>`}</button>`).join("")}</div>`).join("");
  const agree = `<div class="mc-row mc-agree"><span class="mc-lab">Accord</span>${d.agree.map((a, i) => `<span class="mc-a mc-a--${a.level} ${d.hours[i].hour === focusHour ? "is-focus" : ""}" data-h="${d.hours[i].hour}" title="${esc(a.label)}"></span>`).join("")}</div>`;
  return `<div class="mc" id="mc" role="group" aria-label="Comparaison des modèles heure par heure">${head}${rows}${agree}</div>
    <p class="mc-sum" id="mc-sum">${modelSummary(d, focusHour)}</p>
    <p class="hint">Le score et les créneaux utilisent ${esc(MODELS[usedModel].label)} (changer avec le bouton modèle en bas de l'écran). Cases claires : AROME HD comblé par AROME/ARPEGE au-delà de son horizon. Pastilles : vert = modèles d'accord, orange = partiel, rouge = désaccord.</p>`;
}
function updateModelCompareHour(h) {
  const d = FORECAST?.[state.day]?.bySpot[state.sel];
  if (!d || !$("#mc")) return;
  document.querySelectorAll("#mc [data-h]").forEach(el => el.classList.toggle("is-focus", +el.dataset.h === h));
  $("#mc-sum").innerHTML = modelSummary(d, h);
}
const SPOTAIR_PROVIDERS = ["ffvl", "pioupiou", "romma"];
function stationLink(s) {
  const [p, id] = s.split("/");
  if (p === "holfuy") return { label: `Holfuy ${id}`, url: `https://holfuy.com/fr/weather/${id}` };
  if (p === "pioupiou") return { label: `OpenWindMap ${id}`, url: `https://www.openwindmap.org/windbird-${id}` };
  if (p === "ffvl") return { label: `Balise FFVL ${id}`, url: `https://www.balisemeteo.com/balise.php?idBalise=${id}` };
  return { label: s, url: `https://www.spotair.mobi/wind/${s}` };
}
function renderSiteSheet(spot) {
  const lv = spot.levelFfvl && LEVEL_FFVL[spot.levelFfvl];
  const acc = spot.access.mode === "train" ? `Train ${fmtDur(spot.access.trainMinutes)} jusqu'à ${esc(spot.access.station)}, puis ${fmtKm(spot.access.rideKm)} en skate${spot.limit ? " (au-delà de 10 km)" : ""}`
    : spot.access.mode === "voiture" ? `Voiture, environ ${spot.access.driveKm} km et ${fmtDur(spot.access.driveMinutes)} depuis Rennes${spot.access.nearStation ? ` (gare la plus proche : ${esc(spot.access.nearStation)})` : ""}`
    : `${fmtKm(spot.access.rideKm)} depuis le centre de Rennes`;
  const st = spot.stations.map(stationLink);
  const row = (k, v) => v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : "";
  return `<p class="site-desc">${esc(spot.description)}</p>
  <dl class="site">
    ${row("Pratique", `${kindIcon(spot.kind)} ${practiceLabel(spot)}`)}
    ${row("Orientations", spot.orientations.length >= 8 ? "Toutes (terrain plat)" : `<span class="dirs">${spot.orientations.map(o => `<span class="dir">${frDir(o)}</span>`).join("")}</span>`)}
    ${row("Dénivelé", spot.elevation ? `${spot.elevation} m` : "")}
    ${row("Niveau FFVL", lv ? `<span class="lvl" style="--c:${lv.color}"></span>${lv.label}` : "")}
    ${row("Niveau conseillé", spot.level ? esc(spot.level) : "")}
    ${row("Décollage", `<a href="https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lon}" target="_blank" rel="noopener" class="num">${spot.lat.toFixed(4)}, ${spot.lon.toFixed(4)}</a>`)}
    ${row("Atterrissage", spot.landing ? esc(spot.landing) : "")}
    ${row("Marée", spot.tide ? "Site côtier : atterrissage plage selon la hauteur d'eau" : "")}
    ${row("Accès", acc)}
    ${row("Balises", st.length ? st.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(" · ") : "")}
    ${row("Sources", spot.sources?.length ? esc(spot.sources.join(", ")) : "")}
  </dl>`;
}
function renderSpotAir(spot) {
  const map = `https://www.spotair.mobi/widget/map?lat=${spot.lat}&lng=${spot.lon}&zoom=13&layers=spotpg,wind`;
  const ids = spot.stations.filter(s => SPOTAIR_PROVIDERS.includes(s.split("/")[0]));
  const list = ids.length ? `https://www.spotair.mobi/widget/wind/list?stations=${ids.join(",")}&mode=free_flight&unit=kmh&dark=${isDark()}` : null;
  const open = `https://www.spotair.mobi?lat=${spot.lat}&lng=${spot.lon}&zoom=12&layers=spotpg,wind`;
  return `<div class="sa">
    ${navigator.onLine ? `<iframe class="sa-map" loading="lazy" src="${esc(map)}" title="Carte Spot Air : décollages et balises autour du site"></iframe>
      ${list ? `<iframe class="sa-wind" loading="lazy" style="height:${80 * ids.length + 30}px" src="${esc(list)}" title="Balises de vent en temps réel"></iframe>` : ""}`
      : `<p class="hint">Hors connexion : la carte et les balises Spot Air s'afficheront au retour du réseau.</p>`}
    <div class="links">${spot.links.spotair ? `<a class="lk" href="${esc(spot.links.spotair)}" target="_blank" rel="noopener">${I.ext}Fiche Spot Air du site</a>` : ""}<a class="lk" href="${esc(open)}" target="_blank" rel="noopener">${I.pin}Carte Spot Air</a></div>
    <p class="hint">Carte, décollages FFVL et balises en temps réel : Spot Air (spotair.mobi).${ids.length ? "" : " Pas de balise identifiée pour ce site : la carte montre les balises proches."}</p>
  </div>`;
}
function renderSpotPicker(s) {
  const groups = byDept(ALL_SPOTS.filter(x => (s.includeCar || x.access.mode !== "voiture") && (s.includeTreuil || x.profile !== "treuil")));
  return `<div class="picker">${groups.map(([r, list]) => {
    const on = list.filter(x => !s.hidden.includes(x.id)).length;
    return `<details class="pk-reg"><summary><label class="check" onclick="event.stopPropagation()"><input type="checkbox" data-region-toggle="${esc(list.map(x => x.id).join(","))}" ${on ? "checked" : ""}>${esc(r)}</label><span class="pk-n">${on}/${list.length}</span></summary>
      ${list.map(x => `<label class="check pk-spot"><input type="checkbox" data-spot-toggle="${x.id}" ${s.hidden.includes(x.id) ? "" : "checked"}>${kindIcon(x.kind)}${esc(x.name)}</label>`).join("")}</details>`;
  }).join("")}</div>`;
}
/* Départements : Bretagne d'abord, puis Pays de la Loire et Normandie */
const DEPTS = [["35", "Ille-et-Vilaine"], ["22", "Côtes-d'Armor"], ["29", "Finistère"], ["56", "Morbihan"], ["44", "Loire-Atlantique"], ["53", "Mayenne"], ["49", "Maine-et-Loire"], ["85", "Vendée"], ["50", "Manche"], ["14", "Calvados"], ["61", "Orne"], ["27", "Eure"], ["76", "Seine-Maritime"]];
function deptOf(spot) { const m = /\((\d{2})\)/.exec(spot.city || ""); return m ? m[1] : /Rennes/.test(spot.city || spot.region || "") ? "35" : "??"; }
function byDept(list) {
  const g = {};
  list.forEach(x => (g[deptOf(x)] ||= []).push(x));
  const order = DEPTS.map(d => d[0]);
  return Object.keys(g).sort((x, y) => (order.indexOf(x) + 1 || 99) - (order.indexOf(y) + 1 || 99) || x.localeCompare(y))
    .map(k => { const d = DEPTS.find(e => e[0] === k); return [d ? `${d[1]} (${k})` : "Autres", g[k].sort((p, q) => p.name.localeCompare(q.name, "fr"))]; });
}
/* COMPOSANT: choix des spots favoris (premier lancement et réglages) */
function renderFavPicker(s) {
  const groups = byDept(ALL_SPOTS.filter(x => !s.hidden.includes(x.id) && (s.includeTreuil || x.profile !== "treuil" || s.favs.includes(x.id))));
  const first = !s.favsAsked;
  return `<div class="panel-in">
    <div class="d-head"><div><h2 class="p-title" id="p-title">${first ? "Bienvenue sur ParaSpot" : "Mes spots favoris"}</h2></div>${first ? "" : `<button type="button" class="close" data-action="fav-done" aria-label="Valider et revenir aux réglages">${I.close}</button>`}</div>
    <p class="hint" style="font-size:15px">${first ? "Quels sont tes spots préférés ? " : ""}Coche-les : ils seront mis en avant dans l'app, et le bouton ${STAR} en bas de l'écran permet de passer de tes favoris à tous les spots. Tu pourras les changer dans les Réglages.</p>
    <p class="fav-count" id="fav-count">${s.favs.length} favori${s.favs.length > 1 ? "s" : ""}</p>
    <div class="picker">${groups.map(([r, list]) => {
      const n = list.filter(x => s.favs.includes(x.id)).length;
      return `<details class="pk-reg" ${n || r.includes("(35)") ? "open" : ""}><summary><span class="pk-r">${esc(r)}</span><span class="pk-n">${n ? `${n} ★` : list.length}</span></summary>
        ${list.map(x => `<label class="check pk-spot pk-fav"><input type="checkbox" data-fav-toggle="${x.id}" ${s.favs.includes(x.id) ? "checked" : ""}>${kindIcon(x.kind)}<span>${esc(x.name)}<small>${esc(x.city.replace(/\s*\(\d{2}\)/, ""))}${x.region && x.region !== "Rennes" ? " · " + esc(x.region) : ""}</small></span></label>`).join("")}</details>`;
    }).join("")}</div>
    <div class="btn-row fav-actions"><button type="button" class="btn btn--wing" data-action="fav-done">${first ? "C'est parti" : "Valider"}</button>${first ? `<button type="button" class="btn btn--ghost" data-action="fav-skip">Plus tard</button>` : ""}</div>
  </div>`;
}
function openFavPicker() { state.favStep = true; state.panel = true; renderPanelOnly(); $("#panel").classList.add("is-open"); $("#panel").scrollTop = 0; setTimeout(() => $("#panel").focus(), 50); }
function finishFavs(skip) {
  const first = !settings.favsAsked;
  settings.favsAsked = true; state.favStep = false;
  if (!skip && settings.favs.length && first) { state.kind = "favoris"; settings.kind = "favoris"; }
  if (state.kind === "favoris" && !settings.favs.length) { state.kind = "tout"; settings.kind = "tout"; }
  saveSettings();
  if (first) closePanel(); else renderPanelOnly();
  if (!state.pinned) pickDefault();
  if (FORECAST) renderAll(false);
}
function renderLegend() {
  const it = (cls, ic, txt) => `<span class="lg"><span class="mk ${cls}" style="width:30px;height:30px"><span class="mk-dot" style="animation:none">${ic}</span></span>${txt}</span>`;
  return `${it("mk--top", renderVerdictIcon("top"), "Top")}${it("mk--ok", renderVerdictIcon("ok"), "Jouable")}${it("mk--limite", renderVerdictIcon("limite"), "Limite")}${it("mk--non", renderVerdictIcon("non"), "Non (vent ou pluie)")}${it("mk--off", renderVerdictIcon("non"), "Pas atteignable à cette heure")}${it("mk--ok is-fav", renderVerdictIcon("ok"), "Spot favori (cercle doré)")}
    <span class="lg"><span class="mk-cluster c--top" style="width:30px;height:30px;border-width:3px;animation:none"><b style="font-size:12px">3</b></span>Plusieurs spots : touche pour zoomer</span>
    <span class="lg"><span class="stn">${I.train}</span>Gare</span>`;
}
const MODEL_INFO = {
  arome: "Météo-France, maille de 1,5 km : le plus précis ici, surtout pour les brises côtières et le relief. Couvre environ 2 jours ; au-delà, AROME/ARPEGE prend le relais (cases « secours »).",
  ecmwf: "Centre européen, maille de 9 km, jusqu'à 15 jours. Très fiable sur la situation générale, moins fin pour les effets locaux (côte, brise).",
  gfs: "NOAA (États-Unis), maille de 13 à 25 km, jusqu'à 16 jours. Le plus grossier des trois : à prendre comme troisième avis."
};
let infoTimer = null;
function showInfo(title, text) {
  const el = $("#info");
  el.innerHTML = `<div class="info-in glass"><div><b>${esc(title)}</b><p>${esc(text)}</p></div><button type="button" class="info-x" data-action="info-close" aria-label="Fermer">${I.close}</button></div>`;
  el.classList.add("is-on"); clearTimeout(infoTimer); infoTimer = setTimeout(hideInfo, 9000);
}
function hideInfo() { clearTimeout(infoTimer); $("#info").classList.remove("is-on"); }
function updateModelButton() {
  document.querySelectorAll('[data-action="model"]').forEach(b => { b.querySelector("span").textContent = { arome: "AROME", ecmwf: "ECMWF", gfs: "GFS" }[settings.model]; b.setAttribute("aria-label", `Modèle de prévision : ${MODELS[settings.model].label}. Changer.`); });
}

/* =========================================================
   PRÉVISIONS : chargement, cache compact, états vides
   ========================================================= */
const COLS = ["wind", "gust", "dir", "rain", "rainProb", "code", "cloud", "temp", "cape"];
const FLAGS = ["isDay", "missing", "filled", "gustEstimated"];
function packForecast(f) {
  const o = { days: f.days, time: f.hours.map(h => h.time) };
  COLS.forEach(k => { o[k] = f.hours.map(h => h[k] == null ? null : Math.round(h[k] * 10) / 10); });
  FLAGS.forEach(k => { o[k] = f.hours.map(h => (h[k] ? 1 : 0)).join(""); });
  return o;
}
function unpackForecast(o) {
  return { days: o.days, hours: o.time.map((t, i) => {
    const h = { time: t, date: t.slice(0, 10), hour: Number(t.slice(11, 13)) };
    COLS.forEach(k => { h[k] = o[k][i]; });
    FLAGS.forEach(k => { h[k] = o[k][i] === "1"; });
    return h;
  }) };
}
function saveCache() {
  try {
    const packed = { at: RAW.at, results: RAW.results.map(r => ({ id: r.spot.id, tide: r.tide, forecasts: Object.fromEntries(Object.entries(r.forecasts).map(([k, f]) => [k, packForecast(f)])) })) };
    localStorage.setItem("fv-cache-v3", JSON.stringify(packed));
  } catch { /* cache trop gros ou stockage indisponible : le service worker garde les réponses */ }
}
function loadCache() {
  const p = store.get("fv-cache-v3", null);
  if (!p?.results?.length) return null;
  const results = p.results.map(r => ({ spot: ALL_SPOTS.find(s => s.id === r.id), tide: r.tide || {}, forecasts: Object.fromEntries(Object.entries(r.forecasts).map(([k, f]) => [k, unpackForecast(f)])) })).filter(r => r.spot);
  return results.length ? { at: p.at, results } : null;
}
function setupFromRaw() {
  buildDays(RAW.results);
  UPDATED_AT = localIso(new Date(RAW.at));
  state.day = Math.min(state.day, DAYS.length - 1);
  buildForecast();
}
function renderWaiting() {
  $("#days").innerHTML = "";
  $("#eyebrow").innerHTML = `<p class="st-eyebrow"><span class="live"></span>Prévisions</p>`;
  $("#statement").innerHTML = state.error
    ? `<div class="statement anim"><h1 class="st-word">${words("Pas de ciel.")}</h1><p class="st-line">${navigator.onLine ? "Le serveur météo ne répond pas : réessaie dans quelques minutes." : "Pas de connexion et aucune prévision enregistrée sur cet appareil."}</p><button type="button" class="st-cta" style="border:0;background:none;padding:0;min-height:var(--tap)" data-action="refresh">Réessayer ${I.chevron}</button></div>`
    : `<div class="statement anim"><h1 class="st-word">${words("Lecture du ciel…")}</h1><p class="st-line">AROME HD, ECMWF et GFS pour ${ALL_SPOTS.length || ""} spots.</p></div>`;
  $("#carousel").innerHTML = ""; $("#scrub").innerHTML = ""; $("#kinds").innerHTML = renderKinds(state.kind);
}
let refreshing = false;
async function refresh(manual) {
  if (refreshing) return;
  if (!manual && RAW && Date.now() - RAW.at < 30 * 60e3) return; // cache de 30 min : ménage le quota Open-Meteo
  refreshing = true; state.loading = true;
  if (FORECAST) renderTop(); else renderWaiting();
  if (manual || !FORECAST) { document.body.classList.add("is-busy"); $("#loader").classList.add("is-on"); }
  try {
    const results = await fetchAll(ALL_SPOTS, fetch, { models: MODEL_KEYS, primary: settings.model });
    RAW = { at: Date.now(), results };
    saveCache();
    state.error = false; state.offline = false;
    setupFromRaw();
  } catch (e) {
    state.error = true; state.offline = !navigator.onLine;
    console.warn("Prévisions indisponibles", e);
  }
  refreshing = false; state.loading = false;
  document.body.classList.remove("is-busy"); $("#loader").classList.remove("is-on");
  if (FORECAST) { if (!items().some(x => x.spot.id === state.sel)) pickDefault(); renderAll(false); } else renderWaiting();
}

/* =========================================================
   NOTIFICATIONS ET INSTALLATION
   ========================================================= */
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let installPrompt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; if (state.panel) renderPanelOnly(); });
const b64ToUint8 = b64 => { const pad = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
async function enablePush() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    state.notifState = isIOS ? "Sur iPhone, ajoute d'abord l'app à l'écran d'accueil puis ouvre-la depuis son icône." : "Ce navigateur ne gère pas les notifications : utilise l'app ntfy (voir le guide d'installation).";
    return renderPanelOnly();
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { state.notifState = "Autorisation refusée. Tu peux la réactiver dans les réglages du téléphone."; return renderPanelOnly(); }
  settings.notifEnabled = true;
  if (!VAPID_PUBLIC_KEY || !("PushManager" in window)) {
    state.notifState = "Notifications autorisées. Pour recevoir les alertes du robot : app ntfy, ou clé VAPID dans config.js (voir docs/INSTALLATION.md).";
    return renderPanelOnly();
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY) });
    state.subJson = JSON.stringify(sub);
    try { await navigator.clipboard.writeText(state.subJson); } catch { /* copie manuelle */ }
    state.notifState = "Abonnement créé et copié : colle-le dans le secret GitHub WEB_PUSH_SUBSCRIPTION.";
  } catch (e) { state.notifState = `Abonnement impossible : ${e.message}`; }
  renderPanelOnly();
}

/* =========================================================
   DÉMARRAGE
   ========================================================= */
function afterData() {
  pickDefault();
  renderTop(); renderDock(); applySky();
  homeView(true); renderMarkers();
  const h = hourOf(state.sel, state.day, state.hour); if (h) { setWindTarget(h); wind.dir = wind.target.dir; wind.speed = wind.target.speed; }
  setTimeout(() => { syncSelection(false); const c = $(`.card[data-spot="${state.sel}"]`); if (c) c.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" }); }, reduce ? 0 : 900);
}
function openFromUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get("kind") && ["tout", "gonflage", "vol", "favoris"].includes(p.get("kind"))) { state.kind = p.get("kind"); pickDefault(); renderAll(false); }
  if (p.get("date")) { const i = DAYS.findIndex(d => d.date === p.get("date")); if (i >= 0) { state.day = i; pickDefault(); renderAll(false); } }
  if (p.get("spot") && SPOTS.some(s => s.id === p.get("spot"))) { state.sel = p.get("spot"); const sl = FORECAST[state.day].bySpot[state.sel].slots[0]; if (sl) state.hour = Math.max(7, Math.min(21, sl.start)); openDetail(state.sel); }
  if (p.get("view") === "map") setMapFocus(true);
}
async function init() {
  document.querySelector(".logo").innerHTML = '<img src="icons/icon.svg" alt="" width="44" height="44">';
  document.querySelector('[data-action="open-panel"]').innerHTML = ICON_GEAR;
  $(".glider").innerHTML = sailSvg(56);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then(async reg => {
      const sub = await reg.pushManager?.getSubscription?.();
      if (sub) { state.subJson = JSON.stringify(sub); settings.notifEnabled = true; }
    }).catch(() => {});
  }
  if ("Notification" in window && Notification.permission === "granted") settings.notifEnabled = true;
  windColors(); windResize();
  initMap(); map.setView(RENNES, 7); homeView(true); buildLabels(); zoomClasses();
  $("#legend").innerHTML = renderLegend() + `<button type="button" class="info-x legend-x" data-action="legend-close" aria-label="Masquer la légende (elle reste dans les Réglages)">${I.close}</button>`;
  if (settings.legendHidden) document.body.classList.add("no-legend");
  applyTheme(); updateModelButton();
  windStart();
  try { prepareSpots(await (await fetch("data/spots.json")).json()); } catch { state.error = true; renderWaiting(); return; }
  STATIONS.forEach(st => L.marker([st.lat, st.lon], { icon: L.divIcon({ className: "", html: `<div class="stn">${I.train}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false, keyboard: false, title: "Gare de " + st.name }).addTo(map));
  const cached = loadCache();
  if (cached) { RAW = cached; setupFromRaw(); afterData(); openFromUrl(); }
  if (!settings.favsAsked && !new URLSearchParams(location.search).get("spot")) openFavPicker();
  else renderWaiting();
  const had = !!FORECAST;
  await refresh(!cached);
  if (!had && FORECAST) { afterData(); openFromUrl(); }
}
init();
