// Robot de notifications ParaSpot - lancé par GitHub Actions (voir .github/workflows/check.yml).
// 1. récupère les prévisions Open-Meteo pour tous les spots
// 2. calcule les créneaux favorables
// 3. envoie une notification via ntfy et/ou Web Push
import { readFile, writeFile } from "node:fs/promises";
import { fetchAll, analyzeSpot, notificationText, toLocalDate, meanForecast, MODEL_KEYS } from "../scoring.js";

const root = new URL("../", import.meta.url);
const spotsData = JSON.parse(await readFile(new URL("data/spots.json", root), "utf8"));
const config = JSON.parse(await readFile(new URL("data/config.json", root), "utf8"));

const env = process.env;
const mode = env.RUN_MODE || (new Date().getUTCHours() < 12 ? "morning" : "evening");
const now = new Date();
const today = toLocalDate(now);
const tomorrow = toLocalDate(new Date(now.getTime() + 86400000));
const targetDays = mode === "morning" ? [today, tomorrow] : [tomorrow];

// Spots ajoutés à la main (data/mes-spots.json, exporté depuis l'app) et spots validés de la communauté (data/communaute.json)
const optJson = async (f) => { try { return JSON.parse(await readFile(new URL(f, root), "utf8")); } catch { return null; } };
const HOME = config.home || { lat: 48.1035, lon: -1.6724 };
const ALL8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const km = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
function fromCustom(c) {
  const d = km(HOME, c), kind = c.profile === "gonflage" ? "gonflage" : "vol";
  const access = d * 1.25 <= (config.softKm ?? 10)
    ? { mode: "local", rideKm: Math.round(d * 12.5) / 10 }
    : { mode: "voiture", driveKm: Math.round(d * 1.3), driveMinutes: Math.round(d * 1.3 / 75 * 60 + 10) };
  return { id: c.id, name: c.name, city: c.city || "", lat: c.lat, lon: c.lon, kind, profile: c.profile || "plaine", orientations: kind === "gonflage" || !c.orientations?.length ? ALL8 : c.orientations, tide: !!c.tide, access, rules: [], warnings: [], links: {}, stations: [] };
}
const extra = [...((await optJson("data/mes-spots.json"))?.spots || []), ...((await optJson("data/communaute.json"))?.spots || [])]
  .filter((c) => c && c.id && Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.name)
  .filter((c) => !spotsData.spots.some((s) => s.id === c.id))
  .map(fromCustom);
if (extra.length) console.log(`${extra.length} spot(s) ajouté(s) à la main ou de la communauté pris en compte.`);

const spots = [...spotsData.spots, ...extra].filter(
  (s) => (!config.onlySpots?.length || config.onlySpots.includes(s.id)) && !config.excludeSpots.includes(s.id) && config.notify[s.kind] !== false && (config.includeCar !== false || s.access.mode !== "voiture") && (config.includeTreuil === true || s.profile !== "treuil")
);

// Mode test hors-ligne : MOCK=chemin/vers/reponses.json (format renvoyé par fetchAll)
let results;
if (env.MOCK) {
  const mock = JSON.parse(await readFile(env.MOCK, "utf8"));
  results = spots.map((s, i) => ({ spot: s, forecast: mock[i % mock.length].forecast, tide: {} }));
} else {
  // Un seul modèle pour le robot (moins d'appels) : réglable dans data/config.json ("model": arome | ecmwf | gfs)
  // "moyenne" : on récupère les trois modèles et on calcule leur moyenne heure par heure
  if (config.model === "moyenne") {
    results = (await fetchAll(spots, fetch, { models: MODEL_KEYS, primary: "arome" })).map((r) => ({ ...r, forecast: meanForecast(r.forecasts) || r.forecast }));
  } else results = await fetchAll(spots, fetch, { models: [config.model || "arome"] });
}

const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now));
const windows = results
  .flatMap(({ spot, forecast, tide }) => analyzeSpot(spot, forecast, { ...config, today, nowHour }, tide).windows)
  .filter((w) => targetDays.includes(w.date))
  // le matin, on ignore les créneaux d'aujourd'hui déjà inaccessibles
  .filter((w) => !(w.date === today && w.end <= Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now))));

// Un seul créneau par spot (le meilleur) pour garder la notification lisible
const bestBySpot = Object.values(
  windows.reduce((acc, w) => {
    if (!acc[w.spotId] || w.score > acc[w.spotId].score) acc[w.spotId] = w;
    return acc;
  }, {})
);

const msg = notificationText(bestBySpot, now, config.notify.maxItems ?? 3);
await writeFile(new URL("last-run.json", root), JSON.stringify({ runAt: now.toISOString(), mode, windows: bestBySpot }, null, 2));

if (!msg) {
  console.log(`[${mode}] Aucun créneau favorable pour ${targetDays.join(", ")}. Pas de notification.`);
  process.exit(0);
}

const url = `${(env.APP_URL || "").replace(/\/$/, "")}/?spot=${msg.spotId}&date=${msg.date}`;
console.log(`[${mode}] ${msg.title}\n${msg.body}\n-> ${url}`);
if (env.DRY_RUN) process.exit(0);

// --- ntfy (recommandé : le plus simple, marche sur Android et iOS via l'app ntfy) ---
if (env.NTFY_TOPIC) {
  const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  // Publication JSON : gère les accents dans le titre sans encodage particulier
  const res = await fetch(server, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(env.NTFY_TOKEN ? { Authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
    body: JSON.stringify({
      topic: env.NTFY_TOPIC,
      title: msg.title,
      message: msg.body,
      priority: msg.priority === "high" ? 4 : 3,
      tags: ["parachute"],
      ...(env.APP_URL ? { click: url, actions: [{ action: "view", label: "Voir le créneau", url }] } : {})
    })
  });
  console.log(`ntfy: ${res.status}`);
}

// --- Web Push vers la PWA installée (Android Chrome, iOS 16.4+ depuis l'écran d'accueil) ---
if (env.WEB_PUSH_SUBSCRIPTION && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:contact@example.com", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  let subs = JSON.parse(env.WEB_PUSH_SUBSCRIPTION);
  if (!Array.isArray(subs)) subs = [subs];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title: msg.title, body: msg.body, url, tag: msg.tag }), { TTL: 6 * 3600 });
      console.log("web-push: envoyé");
    } catch (e) {
      console.error(`web-push: échec ${e.statusCode || ""} ${e.body || e.message}`);
    }
  }
}
