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
    throw new Error('Manglende CalDAV login-oplysninger (Server URL, E-mail eller App-adgangskode).');
  }

  return { serverUrl, username, password };
}

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
 * Opretter en ny kalender på Mailcow/SOGo (MKCALENDAR).
 */
caldavRouter.post('/calendars', async (req: Request, res: Response) => {
  try {
    const creds = extractCredentials(req);
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#2563eb');
    if (!name) {
      res.status(400).json({ ok: false, error: 'Kalendernavn mangler.' });
      return;
    }
    const calendar = await createCalDavCalendar(creds, name, color);
    res.json({ ok: true, calendar });
  } catch (err: any) {
    console.error('Fejl ved oprettelse af kalender:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'Kunne ikke oprette kalenderen.' });
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
