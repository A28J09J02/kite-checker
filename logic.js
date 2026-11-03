// Kite-Checker – Bewertungslogik (ohne DOM, auch in Node testbar)
(function (root) {
  "use strict";

  const THUNDER = new Set([95, 96, 99]);
  const FOG = new Set([45, 48]);

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

  // WMO-Wettercode → Symbol + Text
  function weatherInfo(code, isDay) {
    if (code == null) return { icon: "cloud", label: "–" };
    if (THUNDER.has(code)) return { icon: "storm", label: "Gewitter" };
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return { icon: "snow", label: "Schnee" };
    if (code >= 80 && code <= 82) return { icon: "rain", label: "Schauer" };
    if (code >= 61 && code <= 67) return { icon: "rain", label: "Regen" };
    if (code >= 51 && code <= 57) return { icon: "drizzle", label: "Niesel" };
    if (FOG.has(code)) return { icon: "fog", label: "Nebel" };
    if (code === 3) return { icon: "cloud", label: "Bedeckt" };
    if (code === 1 || code === 2) return { icon: isDay === false ? "moon-cloud" : "sun-cloud", label: code === 1 ? "Überwiegend klar" : "Wolkig" };
    return { icon: isDay === false ? "moon" : "sun", label: "Klar" };
  }

  // Neopren-Empfehlung nach Wassertemperatur (und gefühlter Lufttemperatur)
  function wetsuit(water, feelsLike) {
    if (water == null) return null;
    let r;
    if (water >= 24) r = { suit: "Lycra / Boardshorts", extra: [], level: 0 };
    else if (water >= 21) r = { suit: "Shorty 2 mm", extra: [], level: 1 };
    else if (water >= 18) r = { suit: "3/2 mm", extra: [], level: 2 };
    else if (water >= 15) r = { suit: "4/3 mm", extra: [], level: 3 };
    else if (water >= 12) r = { suit: "5/4 mm", extra: ["Schuhe"], level: 4 };
    else if (water >= 9) r = { suit: "5/4 mm", extra: ["Schuhe", "Haube"], level: 5 };
    else r = { suit: "6/5 mm", extra: ["Schuhe", "Haube", "Handschuhe"], level: 6 };
    if (feelsLike != null && feelsLike < 5 && !r.extra.includes("Handschuhe") && water < 15) r.extra.push("Handschuhe");
    r.text = r.suit + (r.extra.length ? " + " + r.extra.join(", ") : "");
    return r;
  }

  // Luftlinie in km
  function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
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

  // Steigt oder fällt das Wasser gerade?
  function tideTrend(time, tides) {
    const next = tides.find(t => t.time > time);
    if (!next) return null;
    return { rising: next.type === "HW", next };
  }

  // Bewertet eine einzelne Stunde. Ergebnis: status good|ok|bad|night, Gründe
  function rateHour(h, s, tides) {
    const reasons = [];
    let level = 0; // 0 gut, 1 grenzwertig, 2 nicht kitebar
    const bump = (l, text) => { reasons.push({ level: l, text }); if (l > level) level = l; };

    if (!h.isDay) return { status: "night", level: 3, reasons: [{ level: 3, text: "Dunkel" }], rel: windRelation(h.dir, s.seaDir) };

    // Sicherheit zuerst
    if (THUNDER.has(h.code)) bump(2, "Gewitter");
    const rel = windRelation(h.dir, s.seaDir);
    if (rel.level === 2) bump(2, "Ablandiger Wind – treibt dich raus");
    else if (rel.level === 1) bump(1, "Wind parallel zur Küste");
    if (FOG.has(h.code)) bump(1, "Nebel – schlechte Sicht");

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

    // Starker Regen
    if (h.rain != null && h.rain >= 3) bump(1, "Starker Regen");

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

  // Erstes kommendes Fenster ab `fromMs` über alle Tage
  function nextWindow(days, fromMs) {
    for (const d of days) {
      const hs = d.hours.filter(h => h.isDay && h.time + 3600e3 > fromMs);
      const w = bestWindow(hs);
      if (w) return { day: d.day, ...w };
    }
    return null;
  }

  // Baut aus den rohen API-Antworten die Stundenliste
  function buildHours(weather, marine) {
    const W = weather.hourly;
    const toMs = (iso, offset) => Date.parse(iso + "Z") - offset * 1000;
    const off = weather.utc_offset_seconds || 0;
    const M = (marine && marine.hourly) || {};
    const pick = key => {
      const m = new Map();
      if (M.time && M[key]) M.time.forEach((t, i) => m.set(t, M[key][i]));
      return t => (m.has(t) && m.get(t) != null ? m.get(t) : null);
    };
    const seaAt = pick("sea_level_height_msl"), sstAt = pick("sea_surface_temperature");
    const waveAt = pick("wave_height"), periodAt = pick("wave_period");
    const col = (k, i, d) => (W[k] && W[k][i] != null ? W[k][i] : d);
    return W.time.map((t, i) => ({
      iso: t,
      time: toMs(t, off),
      day: t.slice(0, 10),
      hour: +t.slice(11, 13),
      wind: W.wind_speed_10m[i],
      gust: W.wind_gusts_10m[i],
      dir: W.wind_direction_10m[i],
      temp: col("temperature_2m", i, null),
      feels: col("apparent_temperature", i, null),
      rain: col("precipitation", i, 0),
      cloud: col("cloud_cover", i, null),
      code: col("weather_code", i, 0),
      isDay: W.is_day ? !!W.is_day[i] : true,
      sea: seaAt(t),
      sst: sstAt(t),
      wave: waveAt(t),
      period: periodAt(t),
    })).filter(h => h.wind != null && h.dir != null);
  }

  // Wettermodelle für den Vergleich (Open-Meteo)
  const MODELS = [
    { key: "icon_seamless", label: "ICON (DWD)" },
    { key: "ecmwf_ifs025", label: "ECMWF" },
    { key: "knmi_seamless", label: "HARMONIE (KNMI)" },
    { key: "dmi_seamless", label: "HARMONIE (DMI)" },
    { key: "meteofrance_seamless", label: "AROME (Météo-France)" },
    { key: "ukmo_seamless", label: "UKMO (UK)" },
    { key: "gfs_seamless", label: "GFS (USA)" },
  ];

  // Hängt die Modellwerte an die Stunden: h.models, h.mMin, h.mMax
  function attachModels(hours, mm) {
    if (!mm || !mm.hourly || !mm.hourly.time) return 0;
    const idx = new Map(mm.hourly.time.map((t, i) => [t, i]));
    let used = 0;
    for (const h of hours) {
      const i = idx.get(h.iso);
      if (i == null) continue;
      const list = [];
      for (const m of MODELS) {
        const w = mm.hourly["wind_speed_10m_" + m.key], d = mm.hourly["wind_direction_10m_" + m.key];
        if (w && w[i] != null) list.push({ key: m.key, label: m.label, wind: w[i], dir: d ? d[i] : null });
      }
      if (list.length >= 2) {
        h.models = list;
        h.mMin = Math.min(...list.map(x => x.wind));
        h.mMax = Math.max(...list.map(x => x.wind));
        used = Math.max(used, list.length);
      }
    }
    return used;
  }

  // Wie einig sind sich die Modelle in einem Zeitraum? Wind-Spanne + Richtungsstreuung
  function confidence(hours) {
    const hs = hours.filter(h => h.models);
    if (!hs.length) return null;
    const spread = hs.reduce((a, h) => a + (h.mMax - h.mMin), 0) / hs.length;
    const dirSpread = hs.reduce((a, h) => {
      const ds = h.models.filter(m => m.dir != null).map(m => angleDiff(m.dir, h.dir));
      return a + (ds.length ? Math.max(...ds) : 0);
    }, 0) / hs.length;
    const lo = Math.min(...hs.map(h => h.mMin)), hi = Math.max(...hs.map(h => h.mMax));
    let level = 0;
    if (spread > 9 || dirSpread > 70) level = 2;
    else if (spread > 5 || dirSpread > 40) level = 1;
    return { level, label: ["hoch", "mittel", "niedrig"][level], spread, dirSpread, lo, hi, n: hs[0].models.length };
  }

  // Grober Richtwert für die Schirmgröße (Faustformel: 2,2 × Gewicht ÷ Wind in kn)
  function kiteSize(weightKg, windKn) {
    if (!weightKg || !windKn || windKn < 6) return null;
    const s = 2.2 * weightKg / windKn;
    return Math.min(17, Math.max(5, Math.round(s)));
  }

  // Bekannte Spots als Startpunkt. seaDir = Richtung, in der vom Strand aus das Meer liegt (grob).
  const CATALOG = [
    { name: "Norddeich", region: "Ostfriesland", lat: 53.6365, lon: 7.1405, seaDir: 337.5, tideMode: "bevorzugt" },
    { name: "Norderney Nordstrand", region: "Ostfriesische Inseln", lat: 53.7135, lon: 7.2000, seaDir: 0, tideMode: "egal" },
    { name: "Dornumersiel", region: "Ostfriesland", lat: 53.6820, lon: 7.4870, seaDir: 0, tideMode: "bevorzugt" },
    { name: "Hooksiel", region: "Jadebusen", lat: 53.6420, lon: 8.0880, seaDir: 90, tideMode: "bevorzugt" },
    { name: "Cuxhaven-Duhnen", region: "Elbmündung", lat: 53.8850, lon: 8.6380, seaDir: 315, tideMode: "bevorzugt" },
    { name: "St. Peter-Ording", region: "Nordfriesland", lat: 54.3150, lon: 8.5930, seaDir: 270, tideMode: "bevorzugt" },
    { name: "Sylt Westerland", region: "Nordfriesland", lat: 54.9060, lon: 8.2960, seaDir: 270, tideMode: "egal" },
    { name: "Rømø Lakolk", region: "Dänemark", lat: 55.1450, lon: 8.4880, seaDir: 270, tideMode: "bevorzugt" },
    { name: "Heiligenhafen", region: "Ostsee", lat: 54.3830, lon: 10.9750, seaDir: 0, tideMode: "egal" },
    { name: "Fehmarn Gold", region: "Ostsee", lat: 54.4330, lon: 11.0830, seaDir: 202.5, tideMode: "egal" },
    { name: "Fehmarn Grüner Brink", region: "Ostsee", lat: 54.5300, lon: 11.1500, seaDir: 0, tideMode: "egal" },
    { name: "Wustrow (Fischland)", region: "Ostsee", lat: 54.3480, lon: 12.3750, seaDir: 315, tideMode: "egal" },
    { name: "Zandvoort", region: "Niederlande", lat: 52.3730, lon: 4.5270, seaDir: 270, tideMode: "egal" },
  ];

  const api = { angleDiff, windRelation, compass, beaufort, weatherInfo, wetsuit, distanceKm, findTides, hoursToNearestHW, tideTrend, rateHour, windows, bestWindow, nextWindow, buildHours, MODELS, attachModels, confidence, kiteSize, CATALOG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KiteLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
