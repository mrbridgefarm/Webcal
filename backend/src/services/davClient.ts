import { createDAVClient, DAVCalendar } from 'tsdav';
import {
  CalendarEventDTO,
  parseIcsToEvents,
  buildIcsFromEvent,
  AttendeeDTO
} from './icalMapper.js';

export interface CalDavCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

export interface CalendarInfoDTO {
  id: string;
  name: string;
  color: string;
  serverColor: string;
  readOnly: boolean;
  isShared: boolean;
  owner?: string;
  ctag?: string;
  url: string;
  description?: string;
}

const FALLBACK_COLORS = [
  '#2563eb', // Blå
  '#059669', // Grøn
  '#d97706', // Amber
  '#7c3aed', // Lilla
  '#db2777', // Pink
  '#0891b2'  // Cyan
];

/**
 * Normaliserer Mailcow/SOGo URL, så både domæne-rod (https://mail.eksempel.dk)
 * og fuld DAV-sti (https://mail.eksempel.dk/SOGo/dav/) virker problemfrit.
 */
export function normalizeMailcowUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Server URL mangler');
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const urlObj = new URL(withProtocol);

  if (urlObj.pathname === '' || urlObj.pathname === '/') {
    urlObj.pathname = '/SOGo/dav/';
  } else if (!urlObj.pathname.endsWith('/')) {
    urlObj.pathname = `${urlObj.pathname}/`;
  }
  return urlObj.toString();
}

/**
 * Opretter en autentificeret tsdav klient mod Mailcow / SOGo.
 */
export async function connectCalDav(creds: CalDavCredentials) {
  const serverUrl = normalizeMailcowUrl(creds.serverUrl);

  const client = await createDAVClient({
    serverUrl,
    credentials: {
      username: creds.username,
      password: creds.password
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  });

  return { client, serverUrl };
}

/**
 * Henter alle brugerens egne og delte SOGo-kalendere inkl. serverfarver og Read-Only status.
 */
export async function fetchCalendars(creds: CalDavCredentials): Promise<CalendarInfoDTO[]> {
  const { client } = await connectCalDav(creds);
  const davCalendars = await client.fetchCalendars();

  const normalizedUser = creds.username.toLowerCase().trim();

  return davCalendars
    .filter((cal) => {
      const comps = cal.components || ['VEVENT'];
      return comps.some((c) => String(c).toUpperCase() === 'VEVENT');
    })
    .map((cal, idx) => {
      const rawColor = extractHexColor((cal as any).calendarColor) || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
      const { isShared, readOnly, owner } = detectCalendarPermissions(cal, normalizedUser);

      return {
        id: cal.url,
        url: cal.url,
        name: typeof cal.displayName === 'string' && cal.displayName.trim()
          ? cal.displayName.trim()
          : `Kalender ${idx + 1}`,
        color: rawColor,
        serverColor: rawColor,
        readOnly,
        isShared,
        owner,
        ctag: cal.ctag,
        description: cal.description
      };
    });
}

/**
 * Henter alle VEVENTs fra de angivne kalendere i et datointerval.
 */
export async function fetchAllEvents(
  creds: CalDavCredentials,
  calendars: CalendarInfoDTO[],
  timeRange?: { start: string; end: string }
): Promise<CalendarEventDTO[]> {
  const { client } = await connectCalDav(creds);
  const allEvents: CalendarEventDTO[] = [];

  await Promise.all(
    calendars.map(async (cal) => {
      try {
        const objects = await client.fetchCalendarObjects({
          calendar: { url: cal.url } as DAVCalendar,
          timeRange: timeRange
            ? { start: timeRange.start, end: timeRange.end }
            : undefined
        });

        for (const obj of objects) {
          if (!obj.data) continue;
          const parsed = parseIcsToEvents(
            String(obj.data),
            cal.id,
            obj.url,
            obj.etag
          );
          allEvents.push(...parsed);
        }
      } catch (err) {
        console.warn(`Kunne ikke hente events fra kalender ${cal.name} (${cal.url}):`, err);
      }
    })
  );

  return allEvents;
}

/**
 * Direkte, status-tjekket DAV-request mod Mailcow/SOGo.
 * tsdav kaster IKKE fejl ved HTTP 4xx/5xx på skrive-operationer, så vi laver selv
 * PUT/DELETE/MKCALENDAR og kaster en tydelig fejl, hvis serveren afviser.
 */
async function davRequest(
  creds: CalDavCredentials,
  method: string,
  url: string,
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const auth = Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64');
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...extraHeaders
    },
    body
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`CalDAV ${method} fejlede (HTTP ${res.status} ${res.statusText})${text ? `: ${text}` : ''}`);
  }
  return res;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Opretter eller opdaterer et VEVENT på Mailcow/SOGo via CalDAV PUT.
 */
export async function saveCalDavEvent(
  creds: CalDavCredentials,
  eventDto: CalendarEventDTO
): Promise<CalendarEventDTO> {
  const uid = eventDto.uid || crypto.randomUUID();
  const icsString = buildIcsFromEvent({ ...eventDto, uid });
  const isUpdate = Boolean(eventDto.caldavUrl);
  const objectUrl = isUpdate
    ? (eventDto.caldavUrl as string)
    : `${ensureTrailingSlash(eventDto.calendarId)}${encodeURIComponent(uid)}.ics`;

  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8'
  };
  if (!isUpdate) {
    headers['If-None-Match'] = '*';
  }

  const res = await davRequest(creds, 'PUT', objectUrl, icsString, headers);
  const newEtag = res.headers.get('etag') || undefined;

  return {
    ...eventDto,
    uid,
    id: `${eventDto.calendarId}::${uid}`,
    caldavUrl: objectUrl,
    etag: newEtag,
    rawIcs: icsString
  };
}

/**
 * Sletter et VEVENT fra Mailcow/SOGo via CalDAV DELETE.
 */
export async function deleteCalDavEvent(
  creds: CalDavCredentials,
  caldavUrl: string,
  _etag?: string
): Promise<void> {
  try {
    await davRequest(creds, 'DELETE', caldavUrl);
  } catch (err: any) {
    // 404 = allerede slettet på serveren -> betragtes som succes
    if (String(err?.message || '').includes('HTTP 404')) return;
    throw err;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Finder brugerens kalender-hjemmemappe (f.eks. https://mail.x.dk/SOGo/dav/<bruger>/Calendar/).
 */
async function resolveCalendarHome(creds: CalDavCredentials): Promise<string> {
  try {
    const { client } = await connectCalDav(creds);
    const homeUrl = (client as any)?.account?.homeUrl as string | undefined;
    if (homeUrl) {
      return ensureTrailingSlash(new URL(homeUrl, normalizeMailcowUrl(creds.serverUrl)).toString());
    }
  } catch {
    // fallback nedenfor
  }
  const base = normalizeMailcowUrl(creds.serverUrl);
  return `${base}${encodeURIComponent(creds.username)}/Calendar/`;
}

/**
 * Opretter en ny kalender på Mailcow/SOGo via CalDAV MKCALENDAR.
 */
export async function createCalDavCalendar(
  creds: CalDavCredentials,
  name: string,
  color: string
): Promise<CalendarInfoDTO> {
  const home = await resolveCalendarHome(creds);
  const slug = crypto.randomUUID().toUpperCase();
  const calendarUrl = `${home}${slug}/`;
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : FALLBACK_COLORS[0];

  const body = `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(name)}</D:displayname>
      <A:calendar-color>${safeColor}FF</A:calendar-color>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

  await davRequest(creds, 'MKCALENDAR', calendarUrl, body, {
    'Content-Type': 'application/xml; charset=utf-8'
  });

  return {
    id: calendarUrl,
    url: calendarUrl,
    name,
    color: safeColor,
    serverColor: safeColor,
    readOnly: false,
    isShared: false
  };
}

/**
 * Sletter en (egen) kalender og alle dens begivenheder på Mailcow/SOGo.
 */
export async function deleteCalDavCalendar(
  creds: CalDavCredentials,
  calendarUrl: string
): Promise<void> {
  await davRequest(creds, 'DELETE', ensureTrailingSlash(calendarUrl));
}

/**
 * Opdaterer brugerens RSVP-status (ACCEPTED, TENTATIVE, DECLINED) på en mødeinvitation.
 */
export async function updateEventRsvp(
  creds: CalDavCredentials,
  eventDto: CalendarEventDTO,
  partstat: AttendeeDTO['partstat']
): Promise<CalendarEventDTO> {
  const userEmail = creds.username.toLowerCase().trim();
  const updatedAttendees: AttendeeDTO[] = (eventDto.attendees || []).map((att) => {
    if (att.email.toLowerCase() === userEmail) {
      return { ...att, partstat };
    }
    return att;
  });

  // Hvis brugeren ikke stod eksplicit i listen, tilføjes vedkommende
  if (!updatedAttendees.some((a) => a.email.toLowerCase() === userEmail)) {
    updatedAttendees.push({
      email: creds.username,
      name: creds.username.split('@')[0],
      partstat
    });
  }

  return saveCalDavEvent(creds, {
    ...eventDto,
    attendees: updatedAttendees
  });
}

function extractHexColor(raw?: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.trim().match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  if (match) {
    return `#${match[1]}`;
  }
  return null;
}

/**
 * Analyserer SOGo kalender-URL, visningsnavn og DAV-privilegier for at registrere
 * delte kalendere og hvorvidt de er Read-Only.
 */
function detectCalendarPermissions(
  cal: DAVCalendar,
  normalizedUser: string
): { isShared: boolean; readOnly: boolean; owner?: string } {
  const urlDecoded = decodeURIComponent(cal.url || '');
  const displayName = String(cal.displayName || '');

  // I SOGo har delte kalendere typisk enten en anden bruger i DAV-stien (/SOGo/dav/<owner>/Calendar/...)
  // eller en bruger-præfiks / "(Read-Only)" markering
  let isShared = false;
  let owner: string | undefined;

  const sogoUserMatch = urlDecoded.match(/\/SOGo\/dav\/([^/]+)\//i);
  if (sogoUserMatch && sogoUserMatch[1]) {
    const pathOwner = sogoUserMatch[1].toLowerCase();
    if (pathOwner !== normalizedUser && pathOwner !== normalizedUser.split('@')[0]) {
      isShared = true;
      owner = sogoUserMatch[1];
    }
  }

  if (/_shared_|shared/i.test(urlDecoded) || /\((?:delt|shared|read-only|skrivebeskyttet)/i.test(displayName)) {
    isShared = true;
  }

  // Tjek DAV privilegier hvis tilgængelige, ellers navn/URL indikationer
  const rawProps = JSON.stringify((cal as any).props || (cal as any).res || '');
  const hasWritePrivilege =
    rawProps.includes('write-content') ||
    rawProps.includes('<D:write') ||
    rawProps.includes(':write');
  const hasPrivilegeBlock = rawProps.includes('current-user-privilege-set');

  let readOnly = false;
  if (hasPrivilegeBlock && !hasWritePrivilege) {
    readOnly = true;
  }
  if (/read[-_\s]?only|skrivebeskyttet|kun\s+læs/i.test(displayName) || /readonly/i.test(urlDecoded)) {
    readOnly = true;
  }

  return { isShared, readOnly, owner };
}
