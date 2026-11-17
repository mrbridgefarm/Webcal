import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { caldavRouter } from './routes/caldav.js';

if (process.env.ALLOW_INSECURE_TLS === 'true') {
  console.warn('[SIKKERHED] ADVARSEL: ALLOW_INSECURE_TLS=true er aktiveret. TLS-certifikater valideres ikke!');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Skjul Express server-fingeraftryk og stol på første reverse proxy (Pangolin / Traefik / Nginx)
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Sikkerhedsheaders på alle HTTP-svar (OWASP best practices)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  );
  next();
});

// Stram CORS: Kun samme origin i produktion (plus lokal Vite dev-server i development)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return callback(null, true);
      }
      if (process.env.ALLOWED_ORIGIN && origin === process.env.ALLOWED_ORIGIN) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  })
);

app.use(express.json({ limit: '5mb' }));

// Healthcheck endpoint til Docker (x86_64 & ARM64)
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'dav-sync-cal',
    arch: process.arch,
    platform: process.platform,
    hasDefaultCaldavUrl: Boolean(process.env.DEFAULT_CALDAV_URL),
    timestamp: new Date().toISOString()
  });
});

// CalDAV Proxy API
app.use('/api/caldav', caldavRouter);

// I produktion (Docker) serves den byggede Vue 3 PWA fra /app/public
const publicDir = path.resolve(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  // Undgå at browseren cacher index.html eller Service Worker ved opdateringer
  app.use((req, res, next) => {
    if (
      req.path === '/' ||
      req.path === '/index.html' ||
      req.path === '/sw.js' ||
      req.path === '/registerSW.js' ||
      req.path === '/manifest.webmanifest'
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  app.use(express.static(publicDir));

  // SPA fallback for alle ikke-API ruter
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[DAV-Sync Cal] Server kører på http://0.0.0.0:${PORT} (arch: ${process.arch}, env: ${process.env.NODE_ENV || 'development'})`
  );
});
