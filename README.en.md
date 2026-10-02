# Helfertool

🇩🇪 [Deutsche Version](README.md)

Shift sign-up for volunteers at conventions and festivals – originally built for the
Kölnvention juggling convention in Cologne. Volunteers sign up on their phones without creating
an account (there is a QR code to put up), and the orga team plans areas and shifts in the admin
area.

> **How this tool was made:** I (Nikolai Kleinschmidt) studied media computer science – but I
> did **not write this tool myself**. All of the code was written with
> [Claude](https://claude.ai) (an AI assistant by Anthropic). The ideas, the requirements, the
> testing at a real event and running it are mine. To avoid any misunderstanding: please don't
> take this as code hand-written by me.

## Features
- **Shift plan** per area with search (shift, area, name), a day filter, and past shifts hidden
  automatically (1 hour after the shift ends)
- **Sign up without an account** – only a first name is required; the phone number is optional
  or can be made mandatory per shift
- **My shifts**: see and cancel your own sign-ups on your device
- **German/English** switch – for the volunteer pages and the admin area; areas and shifts can
  optionally have an English text
- **Orga shifts** under `/orga` with full names and phone numbers
- **Shift generator**: splits a time window into shifts of equal length automatically
- **Accounts with permissions**: a main admin plus team accounts that only see certain areas or
  may only do certain things
- **Branding** without code: name, logo, motto, footer and accent colour in the admin area
- **Privacy**: links to your legal notice and privacy policy; sign-ups are deleted automatically
  14 days after the last shift
- **Daily backup**, **CSV export**, **QR code**, **reset** for the next convention

## What you need
- A **server with Docker** (a small rented server/VPS for a few euros a month is enough, a
  Raspberry Pi works too). A normal web hosting package with PHP is **not** enough, because the
  tool is a program that has to keep running.
- A **(sub)domain** pointing to the server, e.g. `volunteers.my-con.org`.
- About 15 minutes. No database software is needed – everything is stored in a single file.

## Installation

### Option A: with automatic HTTPS (recommended)
For a server that doesn't host any other website yet. [Caddy](https://caddyserver.com) gets the
HTTPS certificate automatically – no nginx or certbot needed.

1. At your domain provider, create an **A record** (and an AAAA record if you use IPv6) pointing
   your domain to the server's IP address.
2. On the server, create a folder and put the three files from [`deploy/caddy/`](deploy/caddy)
   into it:
   ```bash
   mkdir helfertool && cd helfertool
   base=https://raw.githubusercontent.com/nkleins/helfertool/main/deploy/caddy
   curl -fsSL -O $base/docker-compose.yml -O $base/Caddyfile
   curl -fsSL -o .env $base/.env.example
   ```
3. Open `.env` (e.g. `nano .env`) and fill in:
   - `DOMAIN` – your domain, e.g. `volunteers.my-con.org`
   - `SESSION_SECRET` – a long random text, e.g. from `openssl rand -hex 32`
   - `TIMEZONE` – the time zone of your event, e.g. `Europe/London`
4. Start it:
   ```bash
   docker compose up -d
   ```
5. Open `https://<your-domain>/admin` and log in with **`admin` / `admin`**. You have to set
   your own password right away at the first login.

**Updating:** `docker compose pull && docker compose up -d`

### Option B: ready-made image behind your own web server
If nginx, Apache, Caddy or similar is already running on the server. Create a folder with two
files:

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
SESSION_SECRET=put-a-long-random-text-here
BASE_URL=https://volunteers.my-con.org
TIMEZONE=Europe/London
```

Then run `docker compose up -d` and set up your existing web server to forward requests to
`http://127.0.0.1:8080` (example for nginx: [`nginx/helfer.example.conf`](nginx/helfer.example.conf)).
**Updating:** `docker compose pull && docker compose up -d`

### Option C: build from source
```bash
git clone https://github.com/nkleins/helfertool.git
cd helfertool
cp .env.example .env     # fill in SESSION_SECRET and BASE_URL
docker compose up -d --build
```
The app then listens on `127.0.0.1:<PORT>` (default 8080). **Updating:**
`git pull && docker compose up -d --build`

With every option, new database columns are added automatically at startup – your existing data
is kept when you update.

## First steps after installing
1. Switch the admin area to English with the **EN** button in the top right corner if you like.
2. **Settings**: set the name, logo, motto and colour; add links to your legal notice and
   privacy policy.
3. Create **areas** (name, colour, order, optionally a description and an English text).
4. **Create shifts**: choose an area, date, from/to, shift length and number of places.
   If “To” is before “From”, the time window runs past midnight.
5. If needed, create accounts for your team under **Users**.
6. Print the **QR code** and put it up – it leads to the shift plan.

## Accounts & permissions
- The **main admin** can do everything, manages the other accounts under “Users” and can reset
  everything.
- **Team accounts** get individual permissions via checkboxes (shifts, adding volunteers, areas,
  CSV export, viewing/changing settings) and see either all areas or only selected ones.
  Permissions can be changed at any time and apply immediately.
- Every account can change its password under “Password”; new accounts have to change their
  initial password at the first login.

## Language
Volunteers and admins can switch between German and English with the button in the top right
corner; the choice is remembered on the device. Without a choice, the language of the browser
decides (German for German browsers, English otherwise). Texts you enter yourself (areas, shifts,
name, motto) are shown as entered – areas and shifts can optionally get an English text in the
“English (optional)” section.

## Privacy
- The tool stores first names or names and – if given – phone numbers of the volunteers. On the
  public pages, names are shortened (“Anna S.”) and phone numbers are never shown.
- **Automatic deletion:** all sign-ups are deleted 14 days after the end of the last shift. The
  dashboard shows the exact date in advance. This can be switched off in the settings.
- You have to provide your own **legal notice and privacy policy** (e.g. on your club website)
  and link them in the settings. Depending on your country, a legal notice may be required for
  public websites (in Germany: “Impressum”).
- No tracking or advertising cookies are used; cookies are only used for the session, the chosen
  language and “My shifts”.

## Backup & restore
Everything – shifts, sign-ups, accounts, settings and logo – is stored in **one file**:
`data/app.db`.

- **Automatic:** once a day the tool stores a copy in `data/backups/`. Only the newest backup is
  kept (at most one day old) – for a short event, an older state isn't useful.
- **Restore:**
  ```bash
  docker compose down
  cp data/backups/app-<date>.db data/app.db
  docker compose up -d
  ```
- For an extra backup, simply copy the `data/` folder somewhere else.

## Configuration (`.env`)
| Variable | Meaning |
|---|---|
| `SESSION_SECRET` | Required. A long random text for cookies. |
| `BASE_URL` | Required (except option A). The public address; used for the QR code and secure cookies with `https`. |
| `DOMAIN` | Option A only: your domain. |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH` | Optional. Only at the very first start: creates the main admin with these details instead of `admin`/`admin`. Create the hash with `node scripts/hash-password.mjs "PASSWORD"`. |
| `TIMEZONE` | Time zone of the event, default `Europe/Berlin`. |
| `PORT`, `DB_PATH` | Default `8080` and `/data/app.db`. |
| `BACKUP_DIR` | Folder for the daily backup, default `data/backups`; `off` disables it. |
| `SOURCE_URL` | Optional. Link to the source code in the footer (required for modified versions under the AGPL). |

## Help & bugs
The tool is provided **without warranty and without support** (see licence). You are welcome to
report bugs and ideas as an [issue](https://github.com/nkleins/helfertool/issues) – but an answer
isn't guaranteed. Your best bet is to ask around in your community for someone with a bit of
server experience; with this guide, setting it up is quick.

## Licence
Copyright © 2026 Nikolai Kleinschmidt

This program is free software under the **GNU Affero General Public License v3.0** (or any later
version), see [`LICENSE`](LICENSE). In short: everyone may use, modify and share the tool.
Anyone who runs a modified version publicly must also offer the modified source code under the
AGPL, e.g. via `SOURCE_URL` (link in the footer).

Whoever runs the tool is responsible for running it and for the data stored in it.

## Support the project
The tool is free and was made in my spare time. If it helps your convention, I'm happy about a
coffee: **[paypal.me/nkleins1](https://paypal.me/nkleins1)** ☕

## Development
```bash
npm install
cp .env.example .env               # set BASE_URL=http://localhost:8080
npm test
node --env-file=.env src/server.js # http://localhost:8080
```
Structure: Fastify server (`src/server.js`), routes in `src/routes/`, database access in
`src/repositories/`, templates (Eta) in `src/views/`, all texts in `src/locales/` (`de.js`,
`en.js`), backups and automatic deletion in `src/maintenance.js`. On every change to `main`,
GitHub tests the code and builds the Docker image `ghcr.io/nkleins/helfertool`.
