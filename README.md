# Helfertool Kölnvention

Schicht-Anmeldung für Helfer:innen (Kölnvention e.V., Jonglage-Festival).
Ein Admin-Login, Anmeldung ohne Registrierung, QR-Code zum Aushängen.

## Lokal entwickeln
```bash
npm install
cp .env.example .env
node scripts/hash-password.mjs "test123"   # Hash in .env eintragen
npm test
node --env-file=.env src/server.js   # http://localhost:8080  (BASE_URL in .env auf http://localhost:8080 setzen)
```

## Auf dem Server deployen
```bash
git clone <REPO_URL> /opt/helfer-koelnvention
cd /opt/helfer-koelnvention
cp .env.example .env
# Passwort-Hash erzeugen und in .env eintragen:
docker run --rm -v "$PWD":/app -w /app node:24-slim node scripts/hash-password.mjs "DEIN-PASSWORT"
# SESSION_SECRET, ADMIN_USER, BASE_URL in .env setzen
docker compose up -d --build
```

nginx + TLS:
```bash
cp nginx/helfer.example.org.conf /etc/nginx/sites-available/helfer.example.org
ln -s /etc/nginx/sites-available/helfer.example.org /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d helfer.example.org
```

## Updaten
```bash
cd /opt/helfer-koelnvention
git pull
docker compose up -d --build
```

## Bedienung
- Admin: `https://helfer.example.org/admin` → einloggen → Schichten anlegen.
- QR-Code: im Admin unter „QR-Code" → ausdrucken/aushängen.
- Export: „CSV-Export" lädt alle Eintragungen.

### Bereiche & Schicht-Generator
Zuerst Bereiche unter `/admin/areas` anlegen (Name, Farbe, Sortierung), dann Schichten
unter `/admin/shifts/new` per Zeitfenster (Datum, von/bis, Slot-Länge, Kapazität) erzeugen.
Die öffentliche Seite `/` zeigt pro Bereich einen Stundenplan zum Anmelden; `/meine` zeigt
gerätebasiert (Cookie) die eigenen Anmeldungen zum Nachschauen und Abmelden.

### Branding / für andere Conventions nutzen
Unter `/admin/settings` (im Dashboard „Einstellungen") lassen sich ohne Code-Änderung anpassen:
Name der Seite (z.B. „Disco-Dienste"), Name der Con, Motto/Datum, Fußzeile, Akzentfarbe und
das Logo (Upload als PNG/JPG/GIF/WebP, max. 2 MB). Logo und Einstellungen liegen in der
SQLite-DB – eine andere Con kann das Repo also einfach klonen, `.env` anlegen,
`docker compose up -d --build` starten und alles Weitere im Admin-Bereich einstellen.

Die SQLite-DB liegt in `./data/app.db` (Docker-Volume) – für Backups einfach diese Datei sichern.
