import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { Eta } from 'eta';
import { createDb } from './db.js';
import { getSettings, getLogo, getLogoVersion } from './repositories/settings.js';
import { ensureOwner, getUser } from './repositories/users.js';
import { translator, pickLang } from './i18n.js';
import { loadConfig } from './config.js';
import { getSession, createSession } from './auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, 'views');
const publicDir = path.join(__dirname, '..', 'public');
const DEFAULT_LOGO = 'Logo_weiss-1_2.png';
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
// Statische Dateien brauchen keine Session (spart pro Seitenaufruf DB-Zeilen).
const NO_SESSION = /^\/(assets\/|styles\.css|logo|favicon\.ico)/;

export function buildApp(config, db) {
  const app = Fastify({ logger: false });
  ensureOwner(db, config);
  const eta = new Eta({ views: viewsDir, cache: true });

  app.register(formbody);
  app.register(cookie, { secret: config.sessionSecret });
  app.register(rateLimit, { global: false });
  app.register(multipart, { limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 20 } });
  app.register(fastifyStatic, {
    root: path.join(publicDir, 'assets'),
    prefix: '/assets/',
  });

  app.get('/styles.css', (req, reply) => {
    reply.type('text/css').sendFile('styles.css', publicDir);
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('render', (view, data) => {
    const brand = getSettings(db);
    const logoVersion = getLogoVersion(db);
    brand.logoUrl = logoVersion ? `/logo?v=${encodeURIComponent(logoVersion)}` : '/logo';
    const lang = data.lang ?? 'de';
    const t = translator(lang);
    const body = eta.render(view, { ...data, brand, lang, t });
    return eta.render('layout', { ...data, brand, lang, t, body });
  });

  // Ältere Browser fragen ohne <link rel="icon"> direkt nach /favicon.ico.
  app.get('/favicon.ico', (req, reply) => reply.redirect('/logo'));

  // Hochgeladenes Logo aus der DB, sonst das mitgelieferte Standard-Logo.
  app.get('/logo', (req, reply) => {
    const logo = getLogo(db);
    if (!logo) return reply.sendFile(DEFAULT_LOGO, path.join(publicDir, 'assets'));
    reply.header('Content-Type', logo.mime)
      .header('Cache-Control', 'public, max-age=300')
      .header('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(logo.data));
  });

  // Session-Middleware: sorgt dafür, dass jede Anfrage eine Session hat.
  app.addHook('onRequest', async (req, reply) => {
    if (NO_SESSION.test(req.url)) return;
    let sid = req.cookies?.sid;
    let session = sid ? getSession(db, sid) : undefined;
    if (!session) {
      const created = createSession(db, { isAdmin: false });
      sid = created.id;
      session = getSession(db, sid);
      reply.setCookie('sid', sid, {
        httpOnly: true, sameSite: 'lax', secure: config.secureCookie, path: '/',
      });
    }
    req.session = session;
    req.lang = pickLang(req);
    // Eingeloggt = Admin-Session mit existierendem Account (gelöschte Accounts fliegen raus).
    req.user = session.is_admin === 1 && session.user_id ? getUser(db, session.user_id) : undefined;
    req.isAdmin = Boolean(req.user);
  });

  app.setErrorHandler((err, req, reply) => {
    console.error(err);
    const code = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(code).type('text/html')
      .send('<!doctype html><meta charset="utf-8"><h1>Fehler</h1><p>Es ist ein Fehler aufgetreten. Bitte später erneut versuchen.</p>');
  });

  registerPublicRoutes(app);
  registerAdminRoutes(app);
  return app;
}

export function requireCsrf(req, reply) {
  const token = req.body?.csrf;
  if (!token || token !== req.session.csrf) {
    reply.code(403).send('Ungültiges CSRF-Token.');
    return false;
  }
  return true;
}

export function rateLimiter(app, opts) {
  let check;
  return async (req, reply) => {
    if (!check) check = app.createRateLimit(opts);
    const limit = await check(req);
    if (!limit.isAllowed && limit.isExceeded) {
      reply.code(429).send('Zu viele Anfragen. Bitte einen Moment warten und erneut versuchen.');
      return false;
    }
    return true;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig(process.env);
  const db = createDb(config.dbPath);
  const app = buildApp(config, db);
  app.listen({ host: '0.0.0.0', port: config.port })
    .then(() => console.log(`Helfertool läuft auf Port ${config.port}`))
    .catch((err) => { console.error(err); process.exit(1); });
}
