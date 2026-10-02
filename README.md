# Helfertool

🇬🇧 [English version](README.en.md)

Schicht-Anmeldung für Helfer:innen auf Conventions und Festivals – ursprünglich gebaut für die
Kölnvention. Helfer:innen tragen sich ohne Registrierung per Handy ein (QR-Code zum Aushängen),
das Orga-Team plant Bereiche und Schichten im Admin-Bereich.

> **Wie dieses Tool entstanden ist:** Ich (Nikolai Kleinschmidt) habe Medieninformatik studiert –
> dieses Tool habe ich aber **nicht selbst programmiert**. Der komplette Code wurde mit
> [Claude](https://claude.ai) (KI-Assistent von Anthropic) geschrieben. Von mir kommen die Ideen,
> die Anforderungen, das Testen im echten Einsatz und der Betrieb. Damit es keine
> Missverständnisse gibt: Bitte nicht als handgeschriebenen Code von mir verstehen.

## Funktionen
- **Schichtplan** pro Bereich mit Suche (Schicht, Bereich, Name), Tagesauswahl und automatisch
  ausgeblendeten vergangenen Schichten (1 Stunde nach Schichtende)
- **Anmelden ohne Konto** – nur der Vorname ist Pflicht, Telefonnummer optional oder pro Schicht
  als Pflicht einstellbar
- **Meine Schichten**: eigene Anmeldungen auf dem Gerät ansehen und abmelden
- **Deutsch/Englisch** umschaltbar – Helferseiten und Admin-Bereich; Bereiche und Schichten
  optional mit englischem Text
- **Orga-Schichten** unter `/orga` mit vollem Namen und Telefonnummer
- **Schicht-Generator**: ein Zeitfenster wird automatisch in gleich lange Schichten geteilt
- **Accounts mit Rechten**: Hauptadmin plus Team-Accounts, die nur bestimmte Bereiche sehen
  oder nur bestimmte Dinge dürfen
- **Branding** ohne Code: Name, Logo, Motto, Fußzeile und Akzentfarbe im Admin-Bereich
- **Datenschutz**: Links zu Impressum und Datenschutzerklärung, Anmeldungen werden 14 Tage nach
  der letzten Schicht automatisch gelöscht
- **Tägliches Backup**, **CSV-Export**, **QR-Code**, **Zurücksetzen** für die nächste Con

## Was du brauchst
- Einen **Server mit Docker** (ein kleiner Mietserver/VPS für ein paar Euro im Monat reicht,
  ein Raspberry Pi geht auch) – ein normales Webhosting-Paket mit PHP reicht **nicht**, weil das
  Tool ein dauerhaft laufendes Programm ist.
- Eine **(Sub-)Domain**, die auf den Server zeigt, z.B. `helfer.meine-con.de`.
- Etwa 15 Minuten. Eine Datenbank-Software ist nicht nötig – alles liegt in einer Datei.

## Installation

### Variante A: mit automatischem HTTPS (empfohlen)
Für einen Server, auf dem sonst noch keine Webseite läuft. [Caddy](https://caddyserver.com) holt
das HTTPS-Zertifikat automatisch, ganz ohne nginx oder certbot.

1. Bei deinem Domain-Anbieter einen **A-Eintrag** (und ggf. AAAA) für die Domain auf die
   IP-Adresse des Servers setzen.
2. Auf dem Server einen Ordner anlegen und die drei Dateien aus
   [`deploy/caddy/`](deploy/caddy) hineinlegen:
   ```bash
   mkdir helfertool && cd helfertool
   base=https://raw.githubusercontent.com/nkleins/helfertool/main/deploy/caddy
   curl -fsSL -O $base/docker-compose.yml -O $base/Caddyfile
   curl -fsSL -o .env $base/.env.example
   ```
3. `.env` öffnen (z.B. `nano .env`) und eintragen:
   - `DOMAIN` – deine Domain, z.B. `helfer.meine-con.de`
   - `SESSION_SECRET` – ein langer zufälliger Text, z.B. aus `openssl rand -hex 32`
4. Starten:
   ```bash
   docker compose up -d
   ```
5. `https://<deine-domain>/admin` öffnen und mit **`admin` / `admin`** einloggen. Beim ersten
   Login muss sofort ein eigenes Passwort gesetzt werden.

**Updaten:** `docker compose pull && docker compose up -d`

### Variante B: fertiges Image hinter eigenem Webserver
Wenn auf dem Server schon nginx, Apache, Caddy o.ä. läuft. Einen Ordner mit zwei Dateien anlegen:

`docker-compose.yml`
```yaml
services:
  app:
    image: ghcr.io/nkleins/helfertool:latest
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./data:/data
```

`.env`
```
SESSION_SECRET=hier-einen-langen-zufaelligen-text-eintragen
BASE_URL=https://helfer.meine-con.de
```

Dann `docker compose up -d` und im vorhandenen Webserver eine Weiterleitung auf
`http://127.0.0.1:8080` einrichten (Beispiel für nginx: [`nginx/helfer.example.conf`](nginx/helfer.example.conf)).
**Updaten:** `docker compose pull && docker compose up -d`

### Variante C: aus dem Quellcode bauen
```bash
git clone https://github.com/nkleins/helfertool.git
cd helfertool
cp .env.example .env     # SESSION_SECRET und BASE_URL eintragen
docker compose up -d --build
```
Die App lauscht dann auf `127.0.0.1:<PORT>` (Standard 8080). **Updaten:**
`git pull && docker compose up -d --build`

Bei allen Varianten werden neue Datenbank-Spalten beim Start automatisch ergänzt – vorhandene
Daten bleiben bei Updates erhalten.

## Erste Schritte nach der Installation
1. **Einstellungen**: Name, Logo, Motto und Farbe festlegen; Links zu Impressum und
   Datenschutzerklärung eintragen.
2. **Bereiche** anlegen (Name, Farbe, Reihenfolge, optional Beschreibung und englischer Text).
3. **Schichten erzeugen**: Bereich, Datum, Von/Bis, Schichtlänge und Plätze wählen.
   Liegt „Bis" vor „Von", geht das Zeitfenster über Mitternacht.
4. Bei Bedarf unter **Benutzer** Accounts fürs Team anlegen.
5. **QR-Code** ausdrucken und aushängen – er führt auf den Schichtplan.

## Accounts & Rechte
- Der **Hauptadmin** darf alles, verwaltet unter „Benutzer" die anderen Accounts und kann
  alles zurücksetzen.
- **Team-Accounts** bekommen per Haken einzelne Rechte (Schichten, Helfer:innen eintragen,
  Bereiche, CSV-Export, Einstellungen ansehen/ändern) und sehen entweder alle oder nur
  ausgewählte Bereiche. Rechte lassen sich jederzeit ändern und gelten sofort.
- Jeder Account ändert sein Passwort unter „Passwort"; neue Accounts müssen das Start-Passwort
  beim ersten Login ändern.

## Datenschutz
- Das Tool speichert Vornamen bzw. Namen und – wenn angegeben – Telefonnummern der Helfer:innen.
  Auf den öffentlichen Seiten werden Namen gekürzt angezeigt („Anna S."), Telefonnummern nie.
- **Automatisches Löschen:** 14 Tage nach dem Ende der letzten Schicht werden alle Anmeldungen
  gelöscht. Das Dashboard zeigt vorher das genaue Datum an. Abschaltbar in den Einstellungen.
- **Impressum und Datenschutzerklärung** müsst ihr selbst bereitstellen (z.B. auf eurer
  Vereins-Webseite) und in den Einstellungen verlinken.
- Es werden keine Tracking- oder Werbe-Cookies verwendet; Cookies gibt es nur für die Sitzung,
  die gewählte Sprache und „Meine Schichten".

## Backup & Wiederherstellen
Alles – Schichten, Anmeldungen, Accounts, Einstellungen und Logo – liegt in **einer Datei**:
`data/app.db`.

- **Automatisch:** Einmal am Tag legt das Tool eine Kopie unter `data/backups/` ab. Es bleibt
  immer nur das neueste Backup (höchstens einen Tag alt) – für eine kurze Veranstaltung ist ein
  älterer Stand nicht sinnvoll.
- **Wiederherstellen:**
  ```bash
  docker compose down
  cp data/backups/app-<datum>.db data/app.db
  docker compose up -d
  ```
- Wer zusätzlich sichern will, kopiert einfach den Ordner `data/` an einen anderen Ort.

## Konfiguration (`.env`)
| Variable | Bedeutung |
|---|---|
| `SESSION_SECRET` | Pflicht. Langer zufälliger Text für Cookies. |
| `BASE_URL` | Pflicht (außer Variante A). Öffentliche Adresse; bestimmt den QR-Code und sichere Cookies bei `https`. |
| `DOMAIN` | Nur Variante A: deine Domain. |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Optional. Nur beim allerersten Start: legt den Hauptadmin mit diesen Daten an statt `admin`/`admin`. Hash erzeugen mit `node scripts/hash-password.mjs "PASSWORT"`. |
| `TIMEZONE` | Zeitzone der Veranstaltung, Standard `Europe/Berlin`. |
| `PORT`, `DB_PATH` | Standard `8080` und `/data/app.db`. |
| `BACKUP_DIR` | Ordner für das tägliche Backup, Standard `data/backups`; `off` schaltet es ab. |
| `SOURCE_URL` | Optional. Link zum Quellcode in der Fußzeile (für veränderte Versionen nach AGPL nötig). |

## Hilfe & Fehler
Das Tool wird **ohne Gewähr und ohne Support** bereitgestellt (siehe Lizenz). Fehler und Ideen
könnt ihr gern als [Issue](https://github.com/nkleins/helfertool/issues) melden – eine Antwort
ist aber nicht garantiert. Am besten fragt ihr in eurer Szene nach jemandem mit etwas
Server-Erfahrung; mit dieser Anleitung ist das Aufsetzen schnell erledigt.

## Lizenz
Copyright © 2026 Nikolai Kleinschmidt

Dieses Programm ist freie Software unter der **GNU Affero General Public License v3.0**
(oder einer späteren Version), siehe [`LICENSE`](LICENSE). Kurz gesagt: Jede:r darf das Tool
nutzen, verändern und weitergeben. Wer eine veränderte Version öffentlich betreibt, muss den
geänderten Quellcode ebenfalls unter der AGPL anbieten, z.B. über `SOURCE_URL` (Link in der
Fußzeile).

Wer das Tool betreibt, ist selbst für den Betrieb und die gespeicherten Daten verantwortlich.

## Unterstützen
Das Tool ist kostenlos und in meiner Freizeit entstanden. Wenn es eurer Con hilft, freue ich mich
über einen Kaffee: **[paypal.me/nkleins1](https://paypal.me/nkleins1)** ☕

## Entwicklung
```bash
npm install
cp .env.example .env               # BASE_URL=http://localhost:8080 setzen
npm test
node --env-file=.env src/server.js # http://localhost:8080
```
Aufbau: Fastify-Server (`src/server.js`), Routen in `src/routes/`, Datenbankzugriffe in
`src/repositories/`, Templates (Eta) in `src/views/`, alle Texte in `src/locales/` (`de.js`,
`en.js`), Backups und automatisches Löschen in `src/maintenance.js`. Bei jeder Änderung auf
`main` testet GitHub den Code und baut das Docker-Image `ghcr.io/nkleins/helfertool`.
