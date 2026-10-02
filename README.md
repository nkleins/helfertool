# Helfertool

Schicht-Anmeldung für Helfer:innen auf Conventions und Festivals – ursprünglich gebaut für die
Kölnvention. Helfer:innen tragen sich ohne Registrierung per Handy ein (QR-Code zum Aushängen),
das Orga-Team plant Bereiche und Schichten im Admin-Bereich.

## Funktionen
- **Schichtplan** pro Bereich mit Suche (Schicht, Bereich, Name), Tagesauswahl und automatisch
  ausgeblendeten vergangenen Schichten (1 Stunde nach Schichtende)
- **Meine Schichten**: eigene Anmeldungen auf dem Gerät ansehen und abmelden
- **Deutsch/Englisch** umschaltbar; Bereiche und Schichten optional mit englischem Text
- **Orga-Schichten** unter `/orga` mit vollem Namen und Telefonnummer
- **Schicht-Generator**: ein Zeitfenster wird automatisch in gleich lange Schichten geteilt
- **Accounts mit Rechten**: Hauptadmin plus Team-Accounts, die nur bestimmte Bereiche sehen
  oder nur bestimmte Dinge dürfen
- **Branding** ohne Code: Name, Logo, Motto, Fußzeile und Akzentfarbe im Admin-Bereich
- **CSV-Export**, **QR-Code**, **Zurücksetzen** für die nächste Con

## Installation (Docker)
```bash
git clone <REPO_URL> /opt/helfertool
cd /opt/helfertool
cp .env.example .env
# In .env setzen: SESSION_SECRET (zufälliger String) und BASE_URL (öffentliche Adresse)
docker compose up -d --build
```
Danach unter `<BASE_URL>/admin` mit **`admin` / `admin`** einloggen – beim ersten Login muss
sofort ein eigenes Passwort gesetzt werden. Alles Weitere (Name, Logo, Bereiche, Accounts)
wird im Admin-Bereich eingestellt.

Die App lauscht auf `127.0.0.1:<PORT>` (Standard 8080, einstellbar über `PORT` in der `.env`). Für HTTPS einen Reverse-Proxy davorsetzen; eine
Beispielkonfiguration für nginx liegt in `nginx/` (Domain und Port anpassen, dann
`certbot --nginx -d <domain>`).

### Updaten
```bash
cd /opt/helfertool && git pull && docker compose up -d --build
```
Neue Datenbank-Spalten werden beim Start automatisch ergänzt, vorhandene Daten bleiben erhalten.

### Backup
Alles – Schichten, Anmeldungen, Accounts, Einstellungen und Logo – liegt in einer SQLite-Datei:
`./data/app.db`. Für ein Backup diese Datei sichern.

## Konfiguration (`.env`)
| Variable | Bedeutung |
|---|---|
| `SESSION_SECRET` | Pflicht. Zufälliger String für Cookies. |
| `BASE_URL` | Pflicht. Öffentliche Adresse (bestimmt QR-Code und sichere Cookies bei `https`). |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Optional. Nur beim allerersten Start: legt den Hauptadmin mit diesen Daten an statt `admin`/`admin`. Hash erzeugen mit `node scripts/hash-password.mjs "PASSWORT"`. |
| `TIMEZONE` | Zeitzone der Veranstaltung, Standard `Europe/Berlin`. |
| `PORT`, `DB_PATH` | Standard `8080` und `/data/app.db`. |
| `SOURCE_URL` | Optional. Link zum Quellcode in der Fußzeile (für veränderte Versionen nach AGPL nötig). |

## Accounts & Rechte
- Der **Hauptadmin** darf alles, verwaltet unter „Benutzer" die anderen Accounts und kann
  alles zurücksetzen.
- **Team-Accounts** bekommen per Haken einzelne Rechte (Schichten, Helfer:innen eintragen,
  Bereiche, CSV-Export, Einstellungen ansehen/ändern) und sehen entweder alle oder nur
  ausgewählte Bereiche. Rechte lassen sich jederzeit ändern und gelten sofort.
- Jeder Account ändert sein Passwort unter „Passwort"; neue Accounts müssen das Start-Passwort
  beim ersten Login ändern.

## Bedienung in Kürze
1. **Einstellungen**: Name, Logo, Motto und Farbe festlegen.
2. **Bereiche** anlegen (Name, Farbe, Reihenfolge, optional Beschreibung und englischer Text).
3. **Schichten erzeugen**: Bereich, Datum, Von/Bis, Schichtlänge und Plätze wählen.
   Liegt „Bis" vor „Von", geht das Zeitfenster über Mitternacht.
4. **QR-Code** ausdrucken und aushängen – er führt auf den Schichtplan.

## Lizenz
Copyright © 2026 Nikolai Kleinschmidt

Dieses Programm ist freie Software unter der **GNU Affero General Public License v3.0**
(oder einer späteren Version), siehe [`LICENSE`](LICENSE). Kurz gesagt: Jede:r darf das Tool
nutzen, verändern und weitergeben. Wer eine veränderte Version öffentlich betreibt, muss den
geänderten Quellcode ebenfalls unter der AGPL anbieten, z.B. über `SOURCE_URL` (Link in der
Fußzeile).

Das Tool wird **ohne Gewähr und ohne Support** bereitgestellt. Wer es betreibt, ist selbst für
den Betrieb und die gespeicherten Daten (Namen, Telefonnummern) verantwortlich.

## Entwicklung
```bash
npm install
cp .env.example .env               # BASE_URL=http://localhost:8080 setzen
npm test
node --env-file=.env src/server.js # http://localhost:8080
```
Aufbau: Fastify-Server (`src/server.js`), Routen in `src/routes/`, Datenbankzugriffe in
`src/repositories/`, Templates (Eta) in `src/views/`, Texte der Helferseiten in `src/i18n.js`.
