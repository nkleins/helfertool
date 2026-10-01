export function loadConfig(env = process.env) {
  const required = ['SESSION_SECRET', 'BASE_URL'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Fehlende ENV-Variablen: ${missing.join(', ')}`);
  const baseUrl = env.BASE_URL;
  return {
    adminUser: env.ADMIN_USER,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET,
    baseUrl,
    port: Number.parseInt(env.PORT ?? '8080', 10),
    dbPath: env.DB_PATH ?? '/data/app.db',
    secureCookie: baseUrl.startsWith('https'),
    timeZone: env.TIMEZONE ?? 'Europe/Berlin',
  };
}
