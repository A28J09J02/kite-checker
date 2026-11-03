// Kite-Checker – Bewertungslogik (ohne DOM, auch in Node testbar)
(function (root) {
  "use strict";

  const THUNDER = new Set([95, 96, 99]);

  // Kleinster Winkelabstand zweier Richtungen in Grad (0..180)
  function angleDiff(a, b) {
    const d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
  }

  // Wind kommt aus `windFrom`, das Meer liegt in Richtung `seaDir`.
  // Kommt der Wind aus Richtung Meer, drückt er aufs Land (auflandig).
  function windRelation(windFrom, seaDir) {
    const d = angleDiff(windFrom, seaDir);
    if (d <= 30) return { key: "on", label: "auflandig", level: 0 };
    if (d <= 70) return { key: "sideon", label: "schräg auflandig", level: 0 };
    if (d <= 100) return { key: "side", label: "sideshore", level: 1 };
    return { key: "off", label: "ablandig", level: 2 };
  }

  const COMPASS = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function compass(deg) {
    return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  }

  function beaufort(kn) {
    const lim = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
    let b = 0;
    while (b < lim.length && kn >= lim[b]) b++;
    return b;
  }

  // Hochwasser = lokale Maxima der Wasserstandskurve
  function findTides(times, levels) {
    const out = [];
    for (let i = 1; i < levels.length - 1; i++) {
      const a = levels[i - 1], b = levels[i], c = levels[i + 1];
      if (a == null || b == null || c == null) continue;
      if (b > a && b >= c) out.push({ type: "HW", time: times[i], level: b });
      else if (b < a && b <= c) out.push({ type: "NW", time: times[i], level: b });
    }
    // Dicht beieinander liegende gleiche Extrema (Plateaus) zusammenfassen
    const merged = [];
    for (const t of out) {
      const last = merged[merged.length - 1];
      if (last && last.type === t.type && (t.time - last.time) < 3 * 3600e3) {
        if ((t.type === "HW" && t.level > last.level) || (t.type === "NW" && t.level < last.level)) merged[merged.length - 1] = t;
      } else merged.push(t);
    }
    return merged;
  }

  function hoursToNearestHW(time, tides) {
    let best = Infinity;
    for (const t of tides) if (t.type === "HW") best = Math.min(best, Math.abs(time - t.time) / 3600e3);
    return best;
  }

  // Bewertet eine einzelne Stunde. Ergebnis: status good|ok|bad|night, Gründe
  function rateHour(h, s, tides) {
    const reasons = [];
    let level = 0; // 0 gut, 1 grenzwertig, 2 nicht kitebar
    const bump = (l, text) => { reasons.push({ level: l, text }); if (l > level) level = l; };

    if (!h.isDay) return { status: "night", level: 3, reasons: [{ level: 3, text: "Dunkel" }] };

    // Sicherheit zuerst
    if (THUNDER.has(h.code)) bump(2, "Gewitter");
    const rel = windRelation(h.dir, s.seaDir);
    if (rel.level === 2) bump(2, "Ablandiger Wind – treibt dich raus");
    else if (rel.level === 1) bump(1, "Wind parallel zur Küste");

    // Windstärke
    if (h.wind < s.minWind - 3) bump(2, "Zu wenig Wind");
    else if (h.wind < s.minWind) bump(1, "Knapp zu wenig Wind");
    if (h.wind > s.maxWind + 3) bump(2, "Zu viel Wind für Anfänger");
    else if (h.wind > s.maxWind) bump(1, "Viel Wind");

    // Böen
    if (h.gust > s.maxGust + 3) bump(2, "Starke Böen");
    else if (h.gust > s.maxGust) bump(1, "Böig");
    const spread = h.gust - h.wind;
    if (spread > 12) bump(2, `Sehr böig (+${Math.round(spread)} kn)`);
    else if (spread > 9) bump(1, `Böig (+${Math.round(spread)} kn)`);

    // Gezeiten
    if (s.tideMode !== "egal" && tides && tides.length) {
      const dh = hoursToNearestHW(h.time, tides);
      if (dh > s.tideWindow + 1) bump(s.tideMode === "pflicht" ? 2 : 1, "Weit weg von Hochwasser");
      else if (dh > s.tideWindow) bump(1, "Rand des Flut-Fensters");
      h.hwDist = dh;
    }

    if (!reasons.length) reasons.push({ level: 0, text: rel.label + ", Wind passt" });
    return { status: ["good", "ok", "bad"][level], level, reasons, rel };
  }

  // Zusammenhängende Zeitfenster gleicher Mindestqualität
  function windows(hours, maxLevel, minLen) {
    const out = [];
    let cur = null;
    for (const h of hours) {
      if (h.rating.level <= maxLevel) {
        if (!cur) cur = { start: h.time, end: h.time + 3600e3, hours: [] };
        cur.end = h.time + 3600e3;
        cur.hours.push(h);
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out.filter(w => w.hours.length >= minLen);
  }

  function bestWindow(dayHours) {
    const good = windows(dayHours, 0, 1).sort((a, b) => b.hours.length - a.hours.length);
    if (good.length) return { quality: "good", ...good[0] };
    const ok = windows(dayHours, 1, 1).sort((a, b) => b.hours.length - a.hours.length);
    if (ok.length) return { quality: "ok", ...ok[0] };
    return null;
  }

  // Baut aus den rohen API-Antworten die Stundenliste
  function buildHours(weather, marine) {
    const W = weather.hourly;
    const toMs = (iso, offset) => Date.parse(iso + "Z") - offset * 1000;
    const off = weather.utc_offset_seconds || 0;
    const levelByTime = new Map();
    if (marine && marine.hourly && marine.hourly.sea_level_height_msl) {
      marine.hourly.time.forEach((t, i) => levelByTime.set(t, marine.hourly.sea_level_height_msl[i]));
    }
    return W.time.map((t, i) => ({
      iso: t,
      time: toMs(t, off),
      day: t.slice(0, 10),
      hour: +t.slice(11, 13),
      wind: W.wind_speed_10m[i],
      gust: W.wind_gusts_10m[i],
      dir: W.wind_direction_10m[i],
      temp: W.temperature_2m ? W.temperature_2m[i] : null,
      rain: W.precipitation ? W.precipitation[i] : 0,
      code: W.weather_code ? W.weather_code[i] : 0,
      isDay: W.is_day ? !!W.is_day[i] : true,
      sea: levelByTime.has(t) ? levelByTime.get(t) : null,
    })).filter(h => h.wind != null && h.dir != null);
  }

  const api = { angleDiff, windRelation, compass, beaufort, findTides, rateHour, windows, bestWindow, buildHours, hoursToNearestHW };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KiteLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
