# Kite-Checker

Zeigt auf einen Blick, ob heute an deinem Spot Kitewetter ist: Wind, Böen, Windrichtung zur Küste und Gezeiten.

Features:
- Urteil mit bestem Zeitfenster und „Nächste Chance“, wenn heute nichts geht
- Spot-Kompass: zeigt, aus welchen Richtungen der Wind am Spot gut/grenzwertig/ablandig ist
- Wassertemperatur, Luft (gefühlt), Wellen, Sonnenauf-/-untergang
- Neopren-Empfehlung nach Wassertemperatur
- Stunden antippen für Details (Gründe, Regen, Wolken, Tide steigt/fällt)
- Wochenübersicht mit Wettersymbol und Stunden-Leiste
- Spot-Leiste zum schnellen Wechseln, Katalog bekannter Nord-/Ostsee-Spots, „In meiner Nähe“
- Vorhersage teilen (WhatsApp & Co.) und Spots als Link an andere schicken
- Vorhersage-Sicherheit: Vergleich von 7 Wettermodellen (ICON, ECMWF, HARMONIE, AROME, UKMO, GFS)
- Live-Wind der nächsten DWD-Station (über Bright Sky)
- Winddiagramm mit Böen, Modell-Spanne und eigenem Windbereich
- Kalender & Logbuch: Sessions planen und eintragen, Statistik, Sicherung als Datei
- Spot-Radar: Karte ab deinem Wohnort mit Ampel für alle bekannten Spots, sortiert nach Bedingungen und Entfernung
- Ansichten Vorhersage / Spot-Radar / Logbuch über die Leiste unten, Tagesauswahl oben
- Optional: Gewicht für einen Schirmgrößen-Richtwert, Webcam-Link pro Spot
- Session-Einladung: geplante Session per Link an andere schicken, ein Tipp übernimmt sie in deren Kalender
- Logbuch-Auswertung „Deine besten Bedingungen“: Wind, Richtung und Tide deiner besten Sessions, mit Vorschlag für deinen Windbereich
- Offline-Start: Die App öffnet auch ohne Netz und zeigt die zuletzt geladene Vorhersage

## Wind-Alarm
Die GitHub Action `.github/workflows/wind-alarm.yml` läuft jeden Morgen (ca. 6:15 Uhr), prüft die Spots aus `alarm.json`
und schickt bei kitebaren Fenstern eine Push-Nachricht über [ntfy](https://ntfy.sh).
Abends gegen 19:15 Uhr kommt zusätzlich eine Vorschau, wenn **morgen** kitebar ist (abschaltbar mit `"evening": false` in `alarm.json`).
Die Zeiten gelten ganzjährig in deutscher Zeit (Sommer- und Winterzeit werden automatisch berücksichtigt).
In der ntfy-App das Thema aus `alarm.json` abonnieren. Testen: Actions → Wind-Alarm → Run workflow.
Standard-Spot: Norddeich (Kiteschule), Anfänger-Einstellungen 12–22 kn, Flut bevorzugt.

## Online stellen (GitHub Pages)
1. Auf github.com ein neues **öffentliches** Repo `kite-checker` anlegen.
2. „Add file → Upload files“ und alle Dateien aus diesem Ordner hochladen.
3. Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
4. Nach 1–2 Minuten läuft die App unter `https://<dein-name>.github.io/kite-checker/`.

## Aufs iPhone
Link in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Den Link einfach an deinen Bruder schicken; jeder hat seine eigenen Spots und Einstellungen.

Daten: Open-Meteo (kostenlos, kein API-Key). Vorhersage ohne Gewähr.
