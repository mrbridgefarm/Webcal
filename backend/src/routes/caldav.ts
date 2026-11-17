import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import {
  CalDavCredentials,
  fetchCalendars,
  fetchAllEvents,
  saveCalDavEvent,
  deleteCalDavEvent,
  updateEventRsvp,
  normalizeMailcowUrl,
  createCalDavCalendar,
  deleteCalDavCalendar
} from '../services/davClient.js';
import {
  CalendarEventDTO,
  AttendeeDTO,
  parseIcsToEvents,
  buildCalendarExportIcs,
  normalizeDanishText
} from '../services/icalMapper.js';
import {
  listSharesForUser,
  createShareLink,
  deleteShareLink,
  resolveShareToken,
  encryptJson,
  decryptJson
} from '../services/shareStore.js';

export const caldavRouter = Router();

const SESSION_COOKIE_NAME = 'dav_sync_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dage

interface EncryptedCookieSession {
  serverUrl: string;
  username: string;
  password: string;
  exp: number;
}

// Simpel in-memory rate limiter mod brute-force på login og offentlige delingslinks
function createRateLimiter(maxHits: number, windowMs: number, errorMessage: string) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || record.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    record.count += 1;
    if (record.count > maxHits) {
      res.status(429).json({ ok: false, error: errorMessage });
      return;
    }

    // Periodisk oprydning hvis mappet vokser
    if (hits.size > 5000) {
      for (const [k, v] of hits.entries()) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }
    next();
  };
}

const loginLimiter = createRateLimiter(
  15,
  15 * 60 * 1000,
  'For mange loginforsøg. Vent venligst et par minutter og prøv igen.'
);
const publicShareLimiter = createRateLimiter(
  60,
  60 * 1000,
  'For mange forespørgsler. Prøv igen om et øjeblik.'
);

function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      result[key] = decodeURIComponent(val);
    }
  }
  return result;
}

function getSessionFromCookie(req: Request): EncryptedCookieSession | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const parsed = decryptJson<EncryptedCookieSession>(rawToken);
  if (!parsed || !parsed.username || !parsed.password || !parsed.serverUrl) {
    return null;
  }
  if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) {
    return null;
  }
  return parsed;
}

function setSessionCookie(req: Request, res: Response, creds: CalDavCredentials) {
  const payload: EncryptedCookieSession = {
    serverUrl: creds.serverUrl,
    username: creds.username,
    password: creds.password,
    exp: Date.now() + SESSION_TTL_MS
  };
  const encrypted = encryptJson(payload);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  res.cookie(SESSION_COOKIE_NAME, encrypted, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/api/caldav'
  });
}

function clearSessionCookie(req: Request, res: Response) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/api/caldav'
  });
}

function safeDecodeHeader(val?: string): string {
  if (!val) return '';
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

function extractCredentials(req: Request): CalDavCredentials {
  // 1. Foretræk den AES-256-GCM krypterede HttpOnly session-cookie
  const cookieSession = getSessionFromCookie(req);
  if (cookieSession) {
    return {
      serverUrl: cookieSession.serverUrl,
      username: cookieSession.username,
      password: cookieSession.password
    };
  }

  // 2. Fallback til direkte login-kald eller API-headers
  const headerServer = safeDecodeHeader(req.headers['x-caldav-server'] as string | undefined);
  const headerUser = safeDecodeHeader(req.headers['x-caldav-user'] as string | undefined);
  const headerPass = safeDecodeHeader(req.headers['x-caldav-password'] as string | undefined);

  const serverUrl =
    req.body?.serverUrl ||
    headerServer ||
    process.env.DEFAULT_CALDAV_URL ||
    '';
  const username = req.body?.username || headerUser || '';
  const password = req.body?.password || headerPass || '';

  if (!serverUrl || !username || !password) {
    throw new Error('Ikke logget ind. Log venligst ind igen.');
  }

  return { serverUrl, username, password };
}

/**
 * GET /api/caldav/config
 * Fortæller kun om DEFAULT_CALDAV_URL er sat i .env (afslører ALDRIG selve server-adressen).
 */
caldavRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    hasDefaultServer: Boolean(process.env.DEFAULT_CALDAV_URL && process.env.DEFAULT_CALDAV_URL.trim())
  });
});

/**
 * GET /api/caldav/session
 * Returnerer aktiv krypteret session (kun brugernavn, ALDRIG adgangskode eller server-URL fra .env).
 */
caldavRouter.get('/session', (req: Request, res: Response) => {
  const cookieSession = getSessionFromCookie(req);
  if (!cookieSession) {
    res.json({ ok: true, authenticated: false });
    return;
  }
  res.json({
    ok: true,
    authenticated: true,
    username: cookieSession.username
  });
});

/**
 * POST /api/caldav/login
 * Validerer brugerens login mod Mailcow/SOGo og sætter en AES-256-GCM krypteret HttpOnly cookie.
 */
caldavRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const serverUrl = String(req.body?.serverUrl || process.env.DEFAULT_CALDAV_URL || '').trim();
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!serverUrl || !username || !password) {
      res.status(400).json({ ok: false, error: 'Manglende login-oplysninger.' });
      return;
    }

    const normalizedUrl = normalizeMailcowUrl(serverUrl);
    const creds: CalDavCredentials = { serverUrl: normalizedUrl, username, password };
    const calendars = await fetchCalendars(creds);

    setSessionCookie(req, res, creds);

    res.json({
      ok: true,
      username: creds.username,
      calendars
    });
  } catch (err: any) {
    console.error('CalDAV login fejl:', err?.message || err);
    res.status(401).json({
      ok: false,
      error: err?.message || 'Kunne ikke logge ind på Mailcow/SOGo CalDAV-serveren.'
    });
  }
});

/**
 * POST /api/caldav/logout
 * Sletter den krypterede HttpOnly session-cookie.
 */
caldavRouter.post('/logout', (req: Request, res: Response) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/**
 * POST /api/caldav/sync
 * Henter alle kalendere og tilhørende begivenheder fra Mailcow/SOGo.
 */
caldavRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const timeRange = req.body?.timeRange as { start: string; end: string } | undefined;

    const calendars = await fetchCalendars(creds);
    const events = await fetchAllEvents(creds, calendars, timeRange);

    res.json({
      ok: true,
      calendars,
      events,
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('CalDAV sync fejl:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Synkronisering med CalDAV-serveren mislykkedes.'
    });
  }
});

/**
 * POST /api/caldav/events
 * Opretter eller opdaterer en begivenhed på Mailcow/SOGo.
 */
caldavRouter.post('/events', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const event = req.body?.event as CalendarEventDTO | undefined;
    if (!event || !event.calendarId || !event.title) {
      res.status(400).json({ ok: false, error: 'Ugyldige begivenhedsdata.' });
      return;
    }

    const saved = await saveCalDavEvent(creds, event);
    res.json({ ok: true, event: saved });
  } catch (err: any) {
    console.error('Fejl ved gem af CalDAV event:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke gemme begivenheden på CalDAV-serveren.'
    });
  }
});

/**
 * DELETE /api/caldav/events
 * Sletter en begivenhed på Mailcow/SOGo.
 */
caldavRouter.delete('/events', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const caldavUrl = (req.body?.caldavUrl || req.query?.caldavUrl) as string | undefined;
    const etag = (req.body?.etag || req.query?.etag) as string | undefined;

    if (!caldavUrl) {
      res.status(400).json({ ok: false, error: 'caldavUrl mangler.' });
      return;
    }

    await deleteCalDavEvent(creds, caldavUrl, etag);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Fejl ved sletning af CalDAV event:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke slette begivenheden på CalDAV-serveren.'
    });
  }
});

/**
 * POST /api/caldav/calendars
 * Opretter en ny kalender på Mailcow/SOGo (MKCALENDAR) eller tilføjer et eksisterende kalenderlink.
 */
caldavRouter.post('/calendars', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#2563eb');
    const calendarUrl = req.body?.calendarUrl ? String(req.body.calendarUrl).trim() : undefined;

    if (!name && !calendarUrl) {
      res.status(400).json({ ok: false, error: 'Kalendernavn eller kalender-URL mangler.' });
      return;
    }
    const calendar = await createCalDavCalendar(creds, name || 'SOGo Kalender', color, calendarUrl);
    res.json({ ok: true, calendar });
  } catch (err: any) {
    console.error('Fejl ved oprettelse/tilføjelse af kalender:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke oprette eller tilføje kalenderen.' });
  }
});

/**
 * DELETE /api/caldav/calendars
 * Sletter en egen kalender på Mailcow/SOGo.
 */
caldavRouter.delete('/calendars', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const calendarUrl = String(req.body?.calendarUrl || '');
    if (!calendarUrl) {
      res.status(400).json({ ok: false, error: 'calendarUrl mangler.' });
      return;
    }
    await deleteCalDavCalendar(creds, calendarUrl);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Fejl ved sletning af kalender:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke slette kalenderen.' });
  }
});

/**
 * POST /api/caldav/rsvp
 * Opdaterer brugerens RSVP-svar (ACCEPTED, TENTATIVE, DECLINED) på en mødeinvitation.
 */
caldavRouter.post('/rsvp', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const event = req.body?.event as CalendarEventDTO | undefined;
    const partstat = req.body?.partstat as AttendeeDTO['partstat'] | undefined;

    if (!event || !partstat) {
      res.status(400).json({ ok: false, error: 'Manglende event eller RSVP-status.' });
      return;
    }

    const updated = await updateEventRsvp(creds, event, partstat);
    res.json({ ok: true, event: updated });
  } catch (err: any) {
    console.error('Fejl ved RSVP opdatering:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke opdatere mødesvar på CalDAV-serveren.'
    });
  }
});

/**
 * POST /api/caldav/import
 * Importerer en .ics fil (med én eller flere VEVENTs) ind i en valgt Mailcow/SOGo kalender.
 */
caldavRouter.post('/import', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const calendarId = String(req.body?.calendarId || '').trim();
    const rawIcs = normalizeDanishText(String(req.body?.icsContent || ''));

    if (!calendarId || !rawIcs.includes('BEGIN:VCALENDAR')) {
      res.status(400).json({
        ok: false,
        error: 'Ugyldig .ics-fil eller manglende mål-kalender.'
      });
      return;
    }

    const parsedEvents = parseIcsToEvents(rawIcs, calendarId);
    if (parsedEvents.length === 0) {
      res.status(400).json({
        ok: false,
        error: 'Ingen gyldige begivenheder (VEVENT) fundet i .ics-filen.'
      });
      return;
    }

    const savedEvents: CalendarEventDTO[] = [];
    for (const ev of parsedEvents) {
      const saved = await saveCalDavEvent(creds, {
        ...ev,
        calendarId,
        uid: crypto.randomUUID(),
        caldavUrl: undefined,
        etag: undefined,
        rawIcs: undefined
      });
      savedEvents.push(saved);
    }

    res.json({
      ok: true,
      importedCount: savedEvents.length,
      events: savedEvents
    });
  } catch (err: any) {
    console.error('Fejl ved ICS import:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke importere .ics-filen til kalenderen.'
    });
  }
});

/**
 * POST /api/caldav/export
 * Genererer en samlet .ics-fil ud fra de valgte begivenheder (kræver aktiv session).
 */
caldavRouter.post('/export', async (req: Request, res: Response) => {
  try {
    extractCredentials(req);
    const events = Array.isArray(req.body?.events) ? (req.body.events as CalendarEventDTO[]) : [];
    const calendarName = String(req.body?.calendarName || 'Kalender').trim();
    const icsContent = buildCalendarExportIcs(events, calendarName);

    res.json({
      ok: true,
      icsContent
    });
  } catch (err: any) {
    console.error('Fejl ved ICS eksport:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: err?.message || 'Kunne ikke eksportere kalenderen til .ics.'
    });
  }
});

/**
 * GET /api/caldav/shares
 * Henter alle aktive offentlige delingslinks for den verificerede bruger.
 */
caldavRouter.get('/shares', async (req: Request, res: Response) => {
  try {
    const cookieSession = getSessionFromCookie(req);
    if (!cookieSession) {
      res.status(401).json({ ok: false, error: 'Kræver aktivt login.' });
      return;
    }
    const shares = listSharesForUser(cookieSession.username);
    res.json({ ok: true, shares });
  } catch (err: any) {
    res.status(401).json({ ok: false, error: err?.message || 'Uautoriseret' });
  }
});

/**
 * POST /api/caldav/shares
 * Opretter et offentligt Read-Only delingslink til én eller flere kalendere.
 */
caldavRouter.post('/shares', async (req: Request, res: Response) => {
  try {
    const cookieSession = getSessionFromCookie(req);
    if (!cookieSession) {
      res.status(401).json({ ok: false, error: 'Kræver aktivt login.' });
      return;
    }

    const label = String(req.body?.label || 'Delt kalender').trim();
    const calendarUrls = Array.isArray(req.body?.calendarUrls) ? req.body.calendarUrls.map(String) : [];
    const calendarNames = Array.isArray(req.body?.calendarNames) ? req.body.calendarNames.map(String) : [];
    const hideDetails = Boolean(req.body?.hideDetails);

    if (calendarUrls.length === 0) {
      res.status(400).json({ ok: false, error: 'Vælg mindst én kalender at dele.' });
      return;
    }

    const share = createShareLink({
      creds: {
        serverUrl: cookieSession.serverUrl,
        username: cookieSession.username,
        password: cookieSession.password
      },
      label,
      calendarUrls,
      calendarNames,
      hideDetails
    });

    res.json({ ok: true, share });
  } catch (err: any) {
    console.error('Fejl ved oprettelse af delingslink:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke oprette delingslink.' });
  }
});

/**
 * DELETE /api/caldav/shares/:token
 * Sletter / tilbagekalder et offentligt delingslink.
 */
caldavRouter.delete('/shares/:token', async (req: Request, res: Response) => {
  try {
    const cookieSession = getSessionFromCookie(req);
    if (!cookieSession) {
      res.status(401).json({ ok: false, error: 'Kræver aktivt login.' });
      return;
    }
    const token = String(req.params.token || '').trim();
    const deleted = deleteShareLink(cookieSession.username, token);
    res.json({ ok: true, deleted });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke slette delingslink.' });
  }
});

/**
 * GET /api/caldav/public/:token
 * Offentligt Read-Only endpoint (kræver IKKE login).
 */
caldavRouter.get('/public/:token', publicShareLimiter, async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!/^[A-Za-z0-9_-]{12,64}$/.test(token)) {
      res.status(404).json({
        ok: false,
        error: 'Ugyldigt delingslink.'
      });
      return;
    }

    const resolved = resolveShareToken(token);
    if (!resolved) {
      res.status(404).json({
        ok: false,
        error: 'Dette delingslink findes ikke eller er blevet tilbagekaldt af ejeren.'
      });
      return;
    }

    const { record, creds } = resolved;
    const allCalendars = await fetchCalendars(creds);
    const allowedSet = new Set(
      record.calendarUrls.map((u) => decodeURIComponent(u).toLowerCase().replace(/\/+$/, ''))
    );

    const sharedCalendars = allCalendars
      .filter((c) => {
        const normUrl = decodeURIComponent(c.url).toLowerCase().replace(/\/+$/, '');
        const normId = decodeURIComponent(c.id).toLowerCase().replace(/\/+$/, '');
        return allowedSet.has(normUrl) || allowedSet.has(normId);
      })
      .map((c) => ({
        ...c,
        readOnly: true,
        isShared: true,
        owner: record.username
      }));

    const rawEvents = await fetchAllEvents(creds, sharedCalendars);

    const sanitizedEvents: CalendarEventDTO[] = rawEvents.map((ev) => ({
      id: ev.id,
      uid: ev.uid,
      calendarId: ev.calendarId,
      title: record.hideDetails ? 'Optaget' : ev.title,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      description: record.hideDetails ? '' : ev.description,
      location: record.hideDetails ? '' : ev.location,
      videoUrl: record.hideDetails ? undefined : ev.videoUrl,
      timezone: ev.timezone,
      attendees: [],
      organizer: undefined,
      reminderMinutes: null
    }));

    res.json({
      ok: true,
      label: record.label,
      owner: record.username,
      hideDetails: record.hideDetails,
      calendars: sharedCalendars,
      events: sanitizedEvents,
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Fejl ved hentning af offentligt delt kalender:', err?.message || err);
    res.status(500).json({
      ok: false,
      error: 'Kunne ikke hente den delte kalender fra serveren.'
    });
  }
});
