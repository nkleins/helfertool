# Schichtplan-Redesign — Design

**Datum:** 2026-08-27
**Projekt:** helfer-koelnvention (Helfer:innen-Schichtplan Kölnvention, 25.–27.09.26)
**Stack:** Fastify 5, node:sqlite, Eta, serverseitig gerendert. Kein Client-Framework.

## Kontext & Problem

Die bestehende App funktioniert, ist aber in der Praxis unbrauchbar:

1. **Schicht-Anlegen ist zu mühsam** — jede Schicht wird einzeln komplett von Hand erstellt
   (Bereich als Freitext, Titel, Start, Ende, Kapazität).
2. **Bereiche sind nur Freitext** — kein echtes Konzept, tippfehleranfällig, nicht filterbar.
3. **Öffentliche Seite ist im dunklen Design schwer lesbar** — belegte Schichten werden auf
   55 % Deckkraft ausgegraut und verschwinden fast.
4. **Kein Nachschauen** — Helfer können nicht sehen, wofür/wann sie eingetragen sind.
5. **Kein Wechseln zwischen Bereichen** auf der öffentlichen Seite.

## Ziele

- Bereiche (Küche, Firespace, Springer, Essenssaal …) als eigenes Konzept, im Admin verwaltbar.
- Schichten werden **generiert** statt einzeln getippt: Bereich + Zeitraum + Schichtlänge + Plätze.
- Öffentliche Seite = **der Schichtplan selbst**: Bereichs-Tabs, pro Bereich ein scrollbarer
  vertikaler Stundenplan, gut lesbar in dunkel, freie Schichten dezent hervorgehoben.
- Namen der Eingetragenen öffentlich sichtbar als **„Vorname N."** → jeder kann von jedem Gerät
  nachschauen, wer wann eingetragen ist.
- **Mobil zuerst** — fast alle Zugriffe (Anlegen, Eintragen, Nachschauen) laufen über Handy/QR.
- Admin-Fortschrittsübersicht pro Bereich.
- Helfer können sich selbst abmelden — aber nur für Schichten, die auf ihrem Gerät (Cookie)
  gespeichert sind; sonst Hinweis „an einen Admin wenden".

## Nicht-Ziele (bewusst weggelassen)

- „Fast voll"-Markierung (Idee C) — verworfen.
- Doppelbuchungs-Warnung (Idee D) — verworfen.
- Klassischer Login/Account für Helfer — es bleibt beim offenen, öffentlichen Plan.
- 2D-Rasterkalender (Zeit × alle Bereiche nebeneinander) — auf Mobil unlesbar; verworfen
  zugunsten der Tab-+-vertikaler-Stundenplan-Lösung.
- Hell/Dunkel-Umschalter — Design bleibt dunkel, aber aufgeräumt und lesbar.

## Datenmodell

### Neue Tabelle `areas`
```sql
CREATE TABLE areas (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#888888',  -- Hex, für Tab-/Blockfarbe
  sort_order INTEGER NOT NULL DEFAULT 0
);
```

### Tabelle `shifts` (geändert)
- Neu: `area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE`.
- `title` wird **optional** (`TEXT`, darf NULL/leer sein).
- Die alte Freitext-Spalte `area` entfällt.

```sql
CREATE TABLE shifts (
  id         INTEGER PRIMARY KEY,
  area_id    INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  title      TEXT,
  starts_at  TEXT NOT NULL,   -- ISO 'YYYY-MM-DDTHH:MM'
  ends_at    TEXT NOT NULL,
  capacity   INTEGER NOT NULL,
  notes      TEXT
);
CREATE INDEX idx_shifts_area ON shifts(area_id);
```

### Tabelle `signups` (geändert)
- Neu: `device_token TEXT` — zufälliges Token aus dem Helfer-Cookie, für „Meine Schichten"
  und Selbst-Abmelden. NULL erlaubt (z. B. vom Admin eingetragene Anmeldungen).

```sql
ALTER TABLE signups ADD COLUMN device_token TEXT;
CREATE INDEX idx_signups_token ON signups(device_token);
```

### Migration
Beim Schema-Init (idempotent, `IF NOT EXISTS` + Feature-Detection):
1. `areas` anlegen falls nicht vorhanden.
2. Falls die alte `shifts`-Tabelle noch eine `area`-Textspalte hat: für jeden distinct
   `area`-Text einen `areas`-Eintrag erzeugen, `shifts` in ein neues Schema mit `area_id`
   überführen (Backfill per Name-Match), alte Tabelle ersetzen.
3. `device_token`-Spalte zu `signups` ergänzen, falls nicht vorhanden.

Da vor dem Event vermutlich keine echten Daten existieren, muss die Migration nur sauber
durchlaufen, nicht große Datenmengen bewältigen — aber sie darf bestehende Testdaten nicht
zerstören.

## Name-Anzeige

- Eingabe bleibt **ein** Feld „Name" (Label: „Vorname (Nachname optional)").
- Öffentliche Anzeige wird abgeleitet: erstes Wort = Vorname; wenn ≥ 2 Wörter, dann
  `Vorname + " " + Initial(letztes Wort) + "."` → z. B. „Kolja K.".
- Voller Name bleibt in der DB und im CSV-Export (nur Admin).
- Reine Anzeigefunktion `displayName(fullName)` in einem kleinen Modul, testbar.

## Öffentliche Seite (`GET /`)

**Aufbau (mobil zuerst):**
- Kopf wie bisher (Logo, Motto).
- **Bereichs-Tabs**: eine horizontale, bei Bedarf scrollbare Leiste mit je einem Tab pro Bereich,
  farbcodiert (`area.color`). Der aktive Bereich ist hervorgehoben.
- **Vertikaler Stundenplan** des aktiven Bereichs: Schichten chronologisch untereinander, jede als
  Block mit Uhrzeit (`HH:MM–HH:MM`), optionalem Titel, Platz-Status („2 / 3 frei") und der Liste
  der Eingetragenen („Kolja K.", „Anna M." …).
  - **Freie Schichten**: dezenter Akzent-Rand/-Punkt in der Bereichsfarbe, gut lesbar.
  - **Volle Schichten**: klar als „Voll" markiert (Badge), aber **voll lesbar** — kein Ausgrauen.
  - Bei freien Plätzen: kompaktes Inline-Eintragen (Name, Telefon optional, Notiz optional).

**Tab-Verhalten:** Alle Bereiche werden serverseitig gerendert; das Umschalten passiert per
leichtem JS (Sichtbarkeit umschalten) — **ohne Reload**. No-JS-Fallback: ohne JS sind alle
Bereiche sichtbar (untereinander), sodass die Seite auch ohne Script voll funktioniert.
Der zuletzt gewählte Tab wird per `localStorage` gemerkt (rein kosmetisch, in try/catch).

**Eintragen (`POST /signup`):**
- Wie bisher, plus: setzt ein `helper_token`-Cookie (httpOnly=false, damit „Meine Schichten"
  gerätelokal funktioniert; SameSite=Lax), falls noch keins da ist, und speichert es als
  `device_token` am Signup.
- CSRF-Schutz und Rate-Limit bleiben unverändert.
- Nach Erfolg zurück auf den Plan (mit Anker zum Bereich) statt einer separaten Danke-Seite —
  oder Danke-Seite beibehalten mit „zurück zum Plan". (Danke-Seite bleibt, einfacher.)

### „Meine Schichten"
- Abschnitt/Ansicht (z. B. `GET /meine`), die alle Signups mit `device_token == Cookie` zeigt:
  Bereich, Titel, Zeit — chronologisch.
- Pro Eintrag ein **Abmelden**-Button (`POST /signup/:id/cancel`), der serverseitig prüft, dass
  das `device_token` des Signups mit dem Cookie übereinstimmt. Nur dann wird gelöscht.
- Signups **ohne** passendes Cookie (anderes Gerät, vom Admin eingetragen) sind hier nicht
  abmeldbar → Hinweistext „Zum Abmelden bitte an einen Admin wenden."
- Wenn kein Cookie/keine Einträge: freundlicher Leerzustand.

## Admin — Bereiche verwalten (`/admin/areas`)

- Liste aller Bereiche (Name, Farbe, Reihenfolge, Anzahl Schichten).
- Anlegen: Name, Farbe (Farbwähler), optional Sortierung.
- Umbenennen / Farbe ändern / löschen (Löschen entfernt via `ON DELETE CASCADE` auch die
  Schichten des Bereichs → Bestätigung im UI).
- CSRF wie überall.

## Admin — Schicht-Generator (`/admin/shifts/new`)

Ein Formular ersetzt das manuelle Einzel-Anlegen:

| Feld            | Typ                                   |
|-----------------|---------------------------------------|
| Bereich         | Dropdown (aus `areas`)                |
| Titel           | Text, **optional**                    |
| Datum           | `date`                                |
| Von / Bis       | zwei `time`-Felder                    |
| Schichtlänge    | Auswahl 30 / 60 / 90 / 120 min        |
| Plätze/Schicht  | Zahl ≥ 1                              |
| Notiz           | Text, optional (an alle Schichten)    |

- **Vorschau vor dem Speichern:** Serverseitig (oder leichtes JS) berechnet, wie viele Schichten
  entstehen: „Erzeugt 8 Schichten à 60 min (10:00–18:00), je 3 Plätze." Ein am Ende
  verbleibender Rest, der kürzer als die Schichtlänge ist, wird **übersprungen** und im
  Vorschautext genannt.
- **Bestätigen** (`POST /admin/shifts/generate`) legt alle Schichten in einer Transaktion an,
  jede mit `starts_at`/`ends_at` aus Datum + fortlaufendem Zeitfenster.
- Validierung: Bereich existiert, Bis > Von, Länge ∈ {30,60,90,120}, Plätze ≥ 1, mindestens
  eine ganze Schicht passt ins Fenster.
- Einzelne Schicht nachträglich bearbeiten/löschen bleibt möglich (bestehende Edit-Route,
  angepasst auf `area_id` + optionalen Titel).

## Admin — Dashboard (`/admin`)

- Schichten **gruppiert nach Bereich, dann nach Tag**, chronologisch.
- **Fortschrittsübersicht** pro Bereich (Idee A): z. B. „Küche — 70 % belegt (14/20 Plätze),
  4 Schichten mit Lücken" mit einfachem Balken. Auf einen Blick sichtbar, wo Helfer fehlen.
- Pro Schicht: Füllstand, Link zur Detailansicht (Eingetragene sehen/entfernen/verschieben,
  wie bisher).
- **Bulk-Löschen**: einen ganzen Tag eines Bereichs auf einmal löschen (mit Bestätigung), da
  der Generator viele Schichten erzeugt.
- CSV-Export (voller Name, Bereich, Zeit) und QR-Code bleiben erhalten.

## Optik / Frontend

- Dunkles, **aufgeräumtes** Design (kein Ausgrauen mehr, klarer Kontrast).
- **Mobil zuerst**: große Touch-Ziele, Tabs horizontal scrollbar, Stundenplan-Blöcke
  fingerfreundlich, Formulare einspaltig.
- Bereichsfarben als sparsame Akzente (Tab-Unterstrich, Block-Randpunkt), nicht als Flächen,
  damit die Lesbarkeit im Dunkeln hoch bleibt.
- Der Zine-Charakter (Logo, Motto) darf bleiben, aber Fließtext/Tabellen werden klar lesbar
  (ausreichender Kontrast, keine reine Courier-Pflicht für Datenlisten).

## Sicherheit / Bestehendes

- CSRF-Token, Rate-Limiting, Admin-Session/Cookies, Passwort-Hashing: **unverändert** übernehmen.
- Alle neuen POST-Routen nutzen `requireCsrf` (+ `requireAdmin` im Adminbereich).
- Das Helfer-`helper_token`-Cookie enthält nur ein zufälliges Token, keine personenbezogenen
  Daten, und dient ausschließlich der gerätelokalen „Meine Schichten"-Funktion.

## Architektur / Dateien

Bestehende Struktur beibehalten und erweitern:
- `src/db.js` — Schema um `areas`, `shifts.area_id`, `signups.device_token`; Migration.
- `src/repositories/areas.js` — **neu**: CRUD für Bereiche.
- `src/repositories/shifts.js` — auf `area_id` + optionalen Titel umstellen; `listShifts` joint
  Bereich; neue `generateShifts(db, {...})` für die Batch-Erzeugung; `deleteShiftsByAreaDay`.
- `src/repositories/signups.js` — `device_token` speichern; `listByToken`,
  `cancelOwnSignup(db, id, token)`.
- `src/display.js` — **neu**: `displayName(fullName)` (+ ggf. Zeit-Formatierung).
- `src/validate.js` — `validateAreaInput`, `validateGenerateInput`; `validateShiftInput`
  auf `area_id`/optionalen Titel anpassen.
- `src/routes/public.js` — Tabs-Daten, `/meine`, `/signup/:id/cancel`, Cookie-Handling.
- `src/routes/admin.js` — Bereichs-CRUD, Generator, Dashboard-Übersicht, Bulk-Delete.
- `src/views/*.eta` — `public-list` (Tabs + Stundenplan), `meine`, `admin-areas`,
  `admin-generate` (statt `admin-shift-form` für Neu), `admin-dashboard` (Übersicht).
- `public/styles.css` — mobil-zuerst, aufgeräumt, Bereichsfarben.

## Tests

Bestehende Test-Suite (`node --test`) erweitern:
- `areas`-Repository: CRUD.
- `generateShifts`: korrekte Anzahl/Zeiten bei 30/60/90/120, Rest-Überspringen, Grenzfälle
  (Fenster < Schichtlänge → 0 Schichten + Fehler).
- `displayName`: „Kolja Kleinschmidt" → „Kolja K."; „Kolja" → „Kolja"; leere/mehrteilige Namen.
- `cancelOwnSignup`: nur bei passendem Token; fremdes/fehlendes Token → kein Löschen.
- Public-Routen: Tabs-Rendering, Eintragen setzt Cookie, `/meine` filtert nach Cookie.
- Admin-Routen: Generator-Endpoint, Bulk-Delete, Fortschrittsdaten.
- Migration: alter `area`-Text wird korrekt zu `areas`/`area_id`.

## Offene Kleinigkeiten (im Plan zu entscheiden)

- Danke-Seite vs. direkter Rücksprung zum Plan — Vorschlag: Danke-Seite behalten.
- Genaues Farbschema/Token-Werte für das dunkle Design — im Implementierungsschritt festlegen.
