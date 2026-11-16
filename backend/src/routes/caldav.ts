import { Router, Request, Response } from 'express';
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
import { CalendarEventDTO, AttendeeDTO } from '../services/icalMapper.js';
import {
  listSharesForUser,
  createShareLink,
  deleteShareLink,
  resolveShareToken
} from '../services/shareStore.js';

export const caldavRouter = Router();

function extractCredentials(req: Request): CalDavCredentials {
  const headerServer = req.headers['x-caldav-server'] as string | undefined;
  const headerUser = req.headers['x-caldav-user'] as string | undefined;
  const headerPass = req.headers['x-caldav-password'] as string | undefined;

  const serverUrl =
    req.body?.serverUrl ||
    headerServer ||
    process.env.DEFAULT_CALDAV_URL ||
    '';
  const username = req.body?.username || headerUser || '';
  const password = req.body?.password || headerPass || '';

  if (!serverUrl || !username || !password) {
    throw new Error('Manglende CalDAV login-oplysninger (Server URL, E-mail eller Adgangskode).');
  }

  return { serverUrl, username, password };
}

/**
 * GET /api/caldav/config
 * Returnerer serverens konfigurerede DEFAULT_CALDAV_URL fra .env / compose.yaml.
 */
caldavRouter.get('/config', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    defaultServerUrl: process.env.DEFAULT_CALDAV_URL || ''
  });
});

/**
 * POST /api/caldav/login
 * Validerer brugerens login direkte mod Mailcow/SOGo og returnerer kalenderlisten.
 */
caldavRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const normalizedUrl = normalizeMailcowUrl(creds.serverUrl);
    const calendars = await fetchCalendars(creds);

    res.json({
      ok: true,
      serverUrl: normalizedUrl,
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
 * GET /api/caldav/shares
 * Henter alle aktive offentlige delingslinks for den indloggede bruger.
 */
caldavRouter.get('/shares', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const shares = listSharesForUser(creds.username);
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
    const creds = extractCredentials(req);
    const label = String(req.body?.label || 'Delt kalender').trim();
    const calendarUrls = Array.isArray(req.body?.calendarUrls) ? req.body.calendarUrls.map(String) : [];
    const calendarNames = Array.isArray(req.body?.calendarNames) ? req.body.calendarNames.map(String) : [];
    const hideDetails = Boolean(req.body?.hideDetails);

    if (calendarUrls.length === 0) {
      res.status(400).json({ ok: false, error: 'Vælg mindst én kalender at dele.' });
      return;
    }

    const share = createShareLink({
      creds,
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
    const creds = extractCredentials(req);
    const token = String(req.params.token || '');
    const deleted = deleteShareLink(creds.username, token);
    res.json({ ok: true, deleted });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke slette delingslink.' });
  }
});

/**
 * GET /api/caldav/public/:token
 * Offentligt Read-Only endpoint (kræver IKKE login).
 * Henter de delte kalendere og begivenheder til visning for 3. part med linket.
 */
caldavRouter.get('/public/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || '').trim();
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
    const allowedSet = new Set(record.calendarUrls);

    const sharedCalendars = allCalendars
      .filter((c) => allowedSet.has(c.url) || allowedSet.has(c.id))
      .map((c) => ({
        ...c,
        readOnly: true,
        isShared: true,
        owner: record.username
      }));

    const rawEvents = await fetchAllEvents(creds, sharedCalendars);

    // Rens følsomme CalDAV-felter og anonymisér hvis hideDetails er valgt
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
