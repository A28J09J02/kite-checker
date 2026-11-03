// Wind-Alarm: prüft die Vorhersage für die Spots aus alarm.json und schickt bei
// kitebaren Fenstern eine Push-Nachricht über ntfy.sh. Läuft als GitHub Action.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const L = require("./logic.js");
const cfg = JSON.parse(await readFile(new URL("./alarm.json", import.meta.url), "utf8"));
const FORCE = String(process.env.FORCE || "").toLowerCase() === "true";
const DRY = String(process.env.DRY_RUN || "").toLowerCase() === "true";

const getJson = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} für ${url}`);
  return r.json();
};

async function marineFor(s) {
  const rad = s.seaDir * Math.PI / 180;
  for (const k of [0, 0.04, 0.08, 0.15]) {
    const lat = (s.lat + Math.cos(rad) * k).toFixed(4), lon = (s.lon + Math.sin(rad) * k * 1.6).toFixed(4);
    try {
      const m = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=sea_level_height_msl,sea_surface_temperature&timezone=Europe%2FBerlin&forecast_days=7`);
      if ((m.hourly?.sea_level_height_msl || []).filter(v => v != null).length > 24) return m;
    } catch { /* nächster Punkt */ }
  }
  return null;
}

const berlin = ms => new Date(ms).toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).replace(/\D/g, "");
const dayLabel = (iso, today) => {
  const d = new Date(iso + "T12:00:00Z");
  const diff = Math.round((d - new Date(today + "T12:00:00Z")) / 864e5);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
};

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const lines = [];
let anyGood = false;

for (const s of cfg.spots) {
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&wind_speed_unit=kn&timezone=Europe%2FBerlin&forecast_days=7`;
  const [weather, marine, models] = await Promise.all([
    getJson(base + "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation,weather_code,is_day"),
    marineFor(s),
    getJson(base + "&hourly=wind_speed_10m,wind_direction_10m&models=" + L.MODELS.map(m => m.key).join(",")).catch(() => null),
  ]);
  const hours = L.buildHours(weather, marine);
  L.attachModels(hours, models);
  const sea = hours.filter(h => h.sea != null);
  const tides = L.findTides(sea.map(h => h.time), sea.map(h => h.sea));
  hours.forEach(h => { h.rating = L.rateHour(h, s, tides); });

  const now = Date.now();
  const days = [...new Set(hours.map(h => h.day))].filter(d => d >= today).slice(0, cfg.days || 3);
  for (const day of days) {
    const hs = hours.filter(h => h.day === day && h.isDay && h.time + 3600e3 > now);
    const w = L.bestWindow(hs);
    if (!w || (w.quality === "ok" && !cfg.notifyOk)) continue;
    if (w.quality === "good") anyGood = true;
    const ws = w.hours.map(h => h.wind);
    const cf = L.confidence(w.hours);
    const hw = tides.filter(t => t.type === "HW" && t.time >= w.start - 3 * 3600e3 && t.time <= w.end + 3 * 3600e3).map(t => "HW " + new Date(t.time).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }));
    lines.push(`${w.quality === "good" ? "✅" : "🟡"} ${s.name} · ${dayLabel(day, today)} ${berlin(w.start)}–${berlin(w.end)} Uhr: ` +
      `${Math.round(Math.min(...ws)) === Math.round(Math.max(...ws)) ? Math.round(ws[0]) : Math.round(Math.min(...ws)) + "–" + Math.round(Math.max(...ws))} kn aus ${L.compass(w.hours[0].dir)} (${w.hours[0].rating.rel.label})` +
      (hw.length ? ` · ${hw.join(", ")}` : "") + (cf ? ` · Sicherheit ${cf.label}` : ""));
  }
}

if (!lines.length && !FORCE) {
  console.log("Kein kitebares Fenster – keine Nachricht.");
  process.exit(0);
}

const msg = {
  topic: cfg.topic,
  title: lines.length ? (anyGood ? "🪁 Kitewetter in Sicht!" : "🪁 Vielleicht Kitewetter") : "🪁 Kite-Checker Test",
  message: lines.length ? lines.join("\n") : "Der Wind-Alarm funktioniert. In den nächsten Tagen ist leider nichts kitebar.",
  tags: ["kite"],
  click: cfg.url,
};
console.log(JSON.stringify(msg, null, 2));
if (DRY) process.exit(0);

const res = await fetch("https://ntfy.sh/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
console.log("ntfy:", res.status);
if (!res.ok) process.exit(1);
