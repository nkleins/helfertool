import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { Eta } from 'eta';
import { createDb } from './db.js';
import { loadConfig } from './config.js';
import { getSession, createSession } from './auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, 'views');
const publicDir = path.join(__dirname, '..', 'public');

export function buildApp(config, db) {
  const app = Fastify({ logger: false });
  const eta = new Eta({ views: viewsDir, cache: true });

  app.register(formbody);
  app.register(cookie, { secret: config.sessionSecret });
  app.register(rateLimit, { global: false });
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
    const body = eta.render(view, data);
    return eta.render('layout', { ...data, body });
  });

  // Session-Middleware: sorgt dafür, dass jede Anfrage eine Session hat.
  app.addHook('onRequest', async (req, reply) => {
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
    req.isAdmin = session.is_admin === 1;
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
