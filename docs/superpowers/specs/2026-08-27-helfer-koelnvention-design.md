# Helfertool Kölnvention – Design / Spec

**Datum:** 2026-08-27
**Projekt:** Schicht-Anmeldung für Helfer:innen, Kölnvention e.V. (Jonglage-Festival, ~300 Personen, 25.–27.09.26)
**Domain:** https://helfer.example.org
**Repo:** `F:\Code Projekte\helfer-koelnvention`

## 1. Ziel & Rahmen

Ein schlankes, self-contained Web-Tool, mit dem sich Helfer:innen ohne Account
für vorab angelegte Schichten eintragen. Ein einziger Admin verwaltet Schichten
und Eintragungen über ein Backend. Deployment auf dem Zielserver bewusst minimal:
`git pull` + `docker compose up -d` (+ nginx/TLS).

Nicht-Ziele (bewusst weggelassen, YAGNI):
- Keine Helfer-Accounts / Registrierung
- Keine Selbstverwaltung durch Helfer (Storno/Änderung nur durch Admin)
- Kein E-Mail-/SMTP-Versand
- Keine Mehrbenutzer-Adminverwaltung (genau ein Admin)
- Keine Bezahlung, kein Ticketing (das läuft separat)

## 2. Architektur

Ein einzelner Node-Container + SQLite-Datei im Volume. Server-rendered HTML,
kein separates Frontend-Build, keine SPA.

```
Helfer (Handy) ──QR──▶ nginx (TLS, helfer.example.org) ──▶ Node :8080 ──▶ SQLite (Volume)
Admin (Browser) ─────▶ nginx ─────────────────────────▶ /admin (Login) ─▶ SQLite
```

**Stack:**
- Node 22+ (LTS), Fastify als HTTP-Server
- Eingebautes `node:sqlite` (KEINE nativen Build-Abhängigkeiten → umgeht MSVC-/
  postinstall-Probleme der lokalen Windows-Dev-Umgebung)
- Templating: server-rendered HTML über einen kleinen Template-Ansatz
  (z.B. eta oder pure Template-Literals) – Entscheidung im Plan
- Sessions: serverseitig in SQLite, Cookie mit `httpOnly`/`secure`/`sameSite=lax`
- Passwort-Hashing: `scrypt` aus Node `crypto` (kein natives bcrypt nötig)
- QR-Code: Generierung serverseitig (Library, pure JS)

## 3. Datenmodell (SQLite)

```
shifts (
  id          INTEGER PRIMARY KEY,
  area        TEXT NOT NULL,          -- Bereich, z.B. "Bar", "Auf-/Abbau", "Einlass"
  title       TEXT NOT NULL,          -- z.B. "Bar Freitagabend"
  starts_at   TEXT NOT NULL,          -- ISO 8601
  ends_at     TEXT NOT NULL,          -- ISO 8601
  capacity    INTEGER NOT NULL,       -- Anzahl Plätze
  notes       TEXT                    -- optionale Beschreibung
)

signups (
  id          INTEGER PRIMARY KEY,
  shift_id    INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,          -- einziges Pflichtfeld beim Helfer
  phone       TEXT,                   -- optional (freiwillig)
  note        TEXT,                   -- optional
  created_at  TEXT NOT NULL           -- ISO 8601
)

sessions (
  id          TEXT PRIMARY KEY,       -- zufälliges Token
  expires_at  TEXT NOT NULL
)
```

- **Freie Plätze** = `capacity − COUNT(signups WHERE shift_id = ?)`
- Admin selbst hat **keinen** DB-Table: ein User via ENV
  (`ADMIN_USER`, `ADMIN_PASSWORD_HASH`)
- Migrationen: idempotentes `CREATE TABLE IF NOT EXISTS` beim Start (Schema-Init).

## 4. Oberflächen

### 4.1 Öffentlich (kein Login)

- `GET /` — Liste aller Schichten, gruppiert nach Bereich und/oder Tag,
  mit Anzeige „X von Y Plätzen frei". Ausgebuchte Schichten sind als
  „ausgebucht" markiert und nicht wählbar.
- Anmeldeformular (auf `/` oder `/shift/:id`):
  - **Name** (Pflicht)
  - **Telefon** (optional — niemand wird gezwungen, die Nummer anzugeben)
  - **Notiz** (optional)
  - Mehrere Schichten in einem Vorgang wählbar (Checkbox-Liste) ODER pro
    Schicht ein Eintragen-Button — Detail im Plan; Default: Mehrfachauswahl.
- `POST /signup` — validiert serverseitig, prüft Kapazität in einer Transaktion,
  legt Eintragung(en) an.
- Bestätigungsseite: „Danke, du bist eingetragen." Kein weiterer Self-Service.

### 4.2 Admin (`/admin`, genau ein Login)

- `GET /admin/login` + `POST /admin/login` — Login (User + Passwort gegen
  ENV-Hash), Rate-Limited. Danach Session-Cookie.
- `GET /admin` — Dashboard: alle Schichten mit Belegung (belegt/frei).
- Schichten:
  - Anlegen/Bearbeiten/Löschen (Bereich, Titel, Start/Ende, Kapazität, Notiz)
  - Löschen einer Schicht entfernt zugehörige Eintragungen (CASCADE) — mit
    Bestätigungs-Dialog.
- Eintragungen je Schicht:
  - Liste aller Helfer:innen (Name, Telefon falls vorhanden, Notiz, Zeitpunkt)
  - Helfer manuell hinzufügen / entfernen / in andere Schicht verschieben
- `GET /admin/export.csv` — CSV-Export aller Schichten + Eintragungen.
- `GET /admin/qr` — QR-Code-Seite: QR zu `${BASE_URL}/` zum Ausdrucken/Teilen,
  plus Download (PNG/SVG).
- `POST /admin/logout`.

## 5. Branding / Design

Kölnvention e.V., Punk/DIY-Ästhetik: Schwarz-Weiß, kräftige Kontraste,
Ransom-Note-/Schablonen-Typo-Akzente, Motto „Juggling's not dead",
Termin 25.–27.09.26. Mobil-first (Helfer scannen mit dem Handy).

- Logos liegen unter `public/assets/` (bereits vorhanden):
  - `Logo_schwarz.png` — Vereinslogo Kölnvention e.V. (schwarz, für helle Flächen)
  - `Logo_weiss-1_2.png` — Vereinslogo (weiß, für dunkle Flächen)
  - `Kolnvention_Sticker_263.png` — Motto-Sticker „Juggling's not dead", 25.–27.09.26
- Templates binden Logos mit Text-Fallback ein (funktioniert auch, wenn eine
  Datei fehlt). Weiß/Schwarz-Variante je nach Hintergrund.
- Punk-Optik primär per CSS (Schriften, harte Kanten, leicht rotierte Elemente,
  Tape-/Schnipsel-Look), Logos als Kopfgrafik.
- Sprache: komplett Deutsch.

## 6. Sicherheit & Robustheit

- Admin-Passwort nur als Hash (`scrypt`) in `.env`, nie im Repo.
  Hilfsscript `scripts/hash-password.mjs` erzeugt den Hash.
- Session-Cookie `httpOnly`, `secure`, `sameSite=lax`; Session-Ablauf in DB.
- Rate-Limiting auf `POST /admin/login` und `POST /signup` (Spam-Schutz beim
  offenen Formular).
- CSRF-Token auf allen POST-Formularen.
- Serverseitige Input-Validierung (Längen, Pflichtfelder, Kapazität > 0,
  Ende > Start).
- Kapazitäts-Handling in Transaktion: gleichzeitiges Buchen darf `capacity`
  nie überschreiten (kein Overbooking).

## 7. Tests (TDD)

Kern-Logik test-getrieben, insbesondere:
- Kapazitäts-/Buchungslogik: keine Überbuchung, „ausgebucht"-Zustand korrekt.
- Validierung der Eingaben (Name Pflicht, Telefon optional, Zeit-Logik).
- Session-/Login-Handling (falsches Passwort abgelehnt, Session läuft ab).
- CSV-Export enthält alle Felder korrekt.

## 8. Deployment

Ziel: `git pull` + `docker compose` (+ nginx/TLS).

Repo-Inhalt (deploy-relevant):
- `Dockerfile` — Node 22 slim, `npm ci`, App-Start.
- `docker-compose.yml` — ein Service `app`, Port `127.0.0.1:8080:8080`,
  Volume `./data:/data` für die SQLite-DB, `env_file: .env`, `restart: unless-stopped`.
- `.env.example` — `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`,
  `BASE_URL=https://helfer.example.org`, `PORT=8080`.
- `.gitignore` — ignoriert `.env`, `data/`, `node_modules/`.
- `nginx/helfer.example.org.conf` — Beispiel-Serverblock (Reverse Proxy auf
  127.0.0.1:8080, Let's-Encrypt-/certbot-Hinweise).
- `scripts/hash-password.mjs` — Passwort-Hash erzeugen.
- `README.md` — Schritt-für-Schritt für den Server.

**Server-Ablauf (erstmalig):**
1. `git clone <repo>` nach z.B. `/opt/helfer-koelnvention`
2. `cp .env.example .env`, Werte setzen; Passwort-Hash via
   `node scripts/hash-password.mjs` (oder im Container) erzeugen
3. `docker compose up -d`
4. nginx-Serverblock einbinden, `certbot` für TLS auf `helfer.example.org`
5. Logos nach `public/assets/` legen (oder im Repo pflegen)

**Updates später:** `git pull && docker compose up -d --build`

## 9. Offene Detailentscheidungen (im Umsetzungsplan zu klären)

- Template-Engine (eta vs. Template-Literals)
- QR-Code-Library
- Mehrfachauswahl vs. Einzel-Buttons beim Eintragen
- Gruppierung der Schichtenliste (nach Tag, nach Bereich, oder beides)
- (Logos sind im Repo unter `public/assets/` eingecheckt.)
