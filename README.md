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

Die SQLite-DB liegt in `./data/app.db` (Docker-Volume) – für Backups einfach diese Datei sichern.
