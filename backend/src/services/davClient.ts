import { createDAVClient } from 'tsdav';
import {
  CalendarEventDTO,
  parseIcsToEvents,
  buildIcsFromEvent,
  AttendeeDTO,
  normalizeDanishText
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

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Udtrækker en specifik kalender-URL, hvis brugeren har indsat et direkte link
 * som f.eks. https://post2ko.bridgefarm.dk/SOGo/dav/mail@bridgefarm.dk/Calendar/personal/
 */
export function extractDirectCalendarUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const urlObj = new URL(withProtocol);
    // Matcher /SOGo/dav/<user>/Calendar/<calName>
    if (/\/SOGo\/dav\/[^/]+\/Calendar\/[^/]+/i.test(urlObj.pathname)) {
      urlObj.pathname = ensureTrailingSlash(urlObj.pathname);
      return urlObj.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normaliserer Mailcow/SOGo URL:
 * Understøtter både domæne-rod (https://post2ko.bridgefarm.dk),
 * DAV-rod (https://post2ko.bridgefarm.dk/SOGo/dav/)
 * OG direkte kalender-links (https://post2ko.bridgefarm.dk/SOGo/dav/mail@bridgefarm.dk/Calendar/personal/)!
 */
export function normalizeMailcowUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Server URL mangler');
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const urlObj = new URL(withProtocol);

  // Hvis URL'en peger dybt ind i /SOGo/dav/..., normaliseres rod-URL'en til /SOGo/dav/
  const sogoMatch = urlObj.pathname.match(/^(.*\/SOGo\/dav)(?:\/.*)?$/i);
  if (sogoMatch) {
    urlObj.pathname = `${sogoMatch[1]}/`;
    return urlObj.toString();
  }

  if (urlObj.pathname === '' || urlObj.pathname === '/') {
    urlObj.pathname = '/SOGo/dav/';
  } else if (!urlObj.pathname.endsWith('/')) {
    urlObj.pathname = `${urlObj.pathname}/`;
  }
  return urlObj.toString();
}

/**
 * Bygger brugerens direkte SOGo Calendar Home URL:
 * f.eks. https://post2ko.bridgefarm.dk/SOGo/dav/mail@bridgefarm.dk/Calendar/
 */
export function buildSogoUserCalendarHomeUrl(serverUrl: string, username: string): string {
  const base = normalizeMailcowUrl(serverUrl);
  return `${base}${ username.trim() }/Calendar/`;
}

/**
 * Læser en HTTP-response med intelligent detektion mellem UTF-8 og ISO-8859-1 / Windows-1252,
 * så danske tegn (æ, ø, å, Æ, Ø, Å) aldrig bliver til spørgsmålstegn () eller mojibake.
 */
async function readResponseTextSmart(res: Response): Promise<string> {
  const arrayBuffer = await res.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(uint8);
  } catch {
    return new TextDecoder('windows-1252').decode(uint8);
  }
}

/**
 * Direkte, status-tjekket HTTP/DAV-request mod Mailcow/SOGo.
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
      'Accept-Charset': 'utf-8, iso-8859-1;q=0.5',
      ...extraHeaders
    },
    body: body !== undefined ? Buffer.from(body, 'utf8') : undefined
  });

  if (!res.ok) {
    const text = (await readResponseTextSmart(res).catch(() => '')).slice(0, 300);
    throw new Error(`CalDAV ${method} mod ${url} fejlede (HTTP ${res.status} ${res.statusText})${text ? `: ${text}` : ''}`);
  }
  return res;
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
 * Direkte PROPFIND fallback mod SOGo's Calendar-mappe, hvis tsdav misser kalendere
 * eller hvis brugeren har indtastet et direkte kalenderlink.
 */
async function fetchCalendarsDirectPropfind(
  creds: CalDavCredentials,
  targetUrl: string,
  depth: '0' | '1' = '1'
): Promise<CalendarInfoDTO[]> {
  const propfindXml = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <CS:getctag/>
    <A:calendar-color/>
    <C:calendar-description/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`;

  const res = await davRequest(creds, 'PROPFIND', targetUrl, propfindXml, {
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: depth
  });

  const xml = await readResponseTextSmart(res);
  const baseOrigin = new URL(targetUrl).origin;
  const normalizedUser = creds.username.toLowerCase().trim();

  // Udtræk alle <D:response> eller <response> blokke
  const responseBlocks = xml.match(/<(?:[a-zA-Z0-9]+:)?response\b[\s\S]*?<\/(?:[a-zA-Z0-9]+:)?response>/gi) || [];
  const results: CalendarInfoDTO[] = [];

  for (const block of responseBlocks) {
    const hrefMatch = block.match(/<(?:[a-zA-Z0-9]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/i);
    if (!hrefMatch) continue;
    const rawHref = hrefMatch[1].trim();
    const fullUrl = ensureTrailingSlash(new URL(rawHref, baseOrigin).toString());

    // Tjek at det er en kalender-kollektion (og ikke inbox/outbox eller selve rod-mappen /Calendar/)
    const isCalendarResource = /<(?:[a-zA-Z0-9]+:)?calendar\b/i.test(block);
    const isScheduleBox = /schedule-inbox|schedule-outbox/i.test(block);
    const isRootCalendarFolder = /\/Calendar\/$/i.test(decodeURIComponent(fullUrl));

    if (!isCalendarResource || isScheduleBox || isRootCalendarFolder) {
      continue;
    }

    // Hvis den kun understøtter VTODO (opgaver) og ikke VEVENT, spring over
    const compMatches = [...block.matchAll(/name=["']([A-Z]+)["']/gi)].map((m) => m[1].toUpperCase());
    if (compMatches.length > 0 && !compMatches.includes('VEVENT')) {
      continue;
    }

    const displayNameMatch = block.match(/<(?:[a-zA-Z0-9]+:)?displayname[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?displayname>/i);
    const rawName = displayNameMatch
      ? normalizeDanishText(displayNameMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim())
      : '';

    const colorMatch = block.match(/<(?:[a-zA-Z0-9]+:)?calendar-color[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?calendar-color>/i);
    const rawColor = extractHexColor(colorMatch ? colorMatch[1].trim() : undefined) || FALLBACK_COLORS[results.length % FALLBACK_COLORS.length];

    const ctagMatch = block.match(/<(?:[a-zA-Z0-9]+:)?getctag[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?getctag>/i);

    const { isShared, readOnly, owner } = detectCalendarPermissionsFromUrlAndName(
      fullUrl,
      rawName,
      normalizedUser
    );

    results.push({
      id: fullUrl,
      url: fullUrl,
      name: rawName || 'Personlig kalender',
      color: rawColor,
      serverColor: rawColor,
      readOnly,
      isShared,
      owner,
      ctag: ctagMatch ? ctagMatch[1].trim() : undefined
    });
  }

  return results;
}

/**
 * Henter alle brugerens egne og delte SOGo-kalendere inkl. serverfarver og Read-Only status.
 */
export async function fetchCalendars(creds: CalDavCredentials): Promise<CalendarInfoDTO[]> {
  const normalizedUser = creds.username.toLowerCase().trim();
  const directCalUrl = extractDirectCalendarUrl(creds.serverUrl);
  const discoveredByUrl = new Map<string, CalendarInfoDTO>();

  // 1. Prøv tsdav standard discovery mod /SOGo/dav/
  try {
    const { client } = await connectCalDav(creds);
    const davCalendars = await client.fetchCalendars();

    for (let idx = 0; idx < davCalendars.length; idx++) {
      const cal = davCalendars[idx];
      const comps = Array.isArray(cal.components) ? cal.components : [];
      // VIGTIGT: Kun filtrér fra hvis components IKKE er tom og ikke indeholder VEVENT!
      if (comps.length > 0 && !comps.some((c) => String(c).toUpperCase() === 'VEVENT')) {
        continue;
      }

      const fullUrl = ensureTrailingSlash(cal.url);
      if (/\/Calendar\/$/i.test(decodeURIComponent(fullUrl))) {
        continue;
      }

      const rawColor =
        extractHexColor((cal as any).calendarColor) ||
        FALLBACK_COLORS[discoveredByUrl.size % FALLBACK_COLORS.length];
      const displayName =
        typeof cal.displayName === 'string' && cal.displayName.trim()
          ? normalizeDanishText(cal.displayName.trim())
          : `Kalender ${discoveredByUrl.size + 1}`;

      const { isShared, readOnly, owner } = detectCalendarPermissionsFromUrlAndName(
        fullUrl,
        displayName,
        normalizedUser
      );

      discoveredByUrl.set(fullUrl, {
        id: fullUrl,
        url: fullUrl,
        name: displayName,
        color: rawColor,
        serverColor: rawColor,
        readOnly,
        isShared,
        owner,
        ctag: cal.ctag,
        description: cal.description
      });
    }
  } catch (err) {
    console.warn('tsdav discovery fejlede, bruger direkte SOGo PROPFIND fallback:', err);
  }

  // 2. Direkte PROPFIND mod brugerens SOGo /Calendar/ mappe (sikrer at alle SOGo kalendere findes)
  try {
    const homeUrl = buildSogoUserCalendarHomeUrl(creds.serverUrl, creds.username);
    const directHomeCals = await fetchCalendarsDirectPropfind(creds, homeUrl, '1');
    for (const cal of directHomeCals) {
      if (!discoveredByUrl.has(cal.url)) {
        discoveredByUrl.set(cal.url, cal);
      }
    }
  } catch (err) {
    console.warn('Direkte PROPFIND mod SOGo homeUrl fejlede:', err);
  }

  // 3. Hvis brugeren indtastede et direkte link (f.eks. .../Calendar/personal/), hent også den direkte
  if (directCalUrl && !discoveredByUrl.has(directCalUrl)) {
    try {
      const directCals = await fetchCalendarsDirectPropfind(creds, directCalUrl, '0');
      for (const cal of directCals) {
        discoveredByUrl.set(cal.url, cal);
      }
    } catch (err) {
      console.warn('Direkte PROPFIND mod specifik kalender-URL fejlede:', err);
    }
  }

  // 4. Sidste fallback: Hvis listen stadig er tom, men auth virkede, tilføj standard SOGo personal-kalender
  if (discoveredByUrl.size === 0) {
    const fallbackUrl =
      directCalUrl || `${buildSogoUserCalendarHomeUrl(creds.serverUrl, creds.username)}personal/`;
    // Verificér at brugeren har adgang med en hurtig PROPFIND
    await davRequest(creds, 'PROPFIND', fallbackUrl, undefined, { Depth: '0' });
    discoveredByUrl.set(fallbackUrl, {
      id: fallbackUrl,
      url: fallbackUrl,
      name: 'Personlig Kalender (SOGo)',
      color: FALLBACK_COLORS[0],
      serverColor: FALLBACK_COLORS[0],
      readOnly: false,
      isShared: false
    });
  }

  return Array.from(discoveredByUrl.values());
}

/**
 * Henter et enkelt kalender-info objekt ud fra en specifik CalDAV-URL (bruges ved "Tilføj kalender via link").
 */
export async function fetchSingleCalendarByUrl(
  creds: CalDavCredentials,
  calendarUrl: string,
  customName?: string,
  customColor?: string
): Promise<CalendarInfoDTO> {
  const normalizedCalUrl = ensureTrailingSlash(calendarUrl.trim());
  const found = await fetchCalendarsDirectPropfind(creds, normalizedCalUrl, '0');
  if (found.length > 0) {
    const cal = found[0];
    return {
      ...cal,
      name: customName?.trim() || cal.name,
      color: customColor || cal.color,
      serverColor: cal.serverColor || customColor || FALLBACK_COLORS[0]
    };
  }

  const normalizedUser = creds.username.toLowerCase().trim();
  const { isShared, readOnly, owner } = detectCalendarPermissionsFromUrlAndName(
    normalizedCalUrl,
    customName || 'SOGo Kalender',
    normalizedUser
  );

  return {
    id: normalizedCalUrl,
    url: normalizedCalUrl,
    name: customName?.trim() || 'SOGo Kalender',
    color: customColor || FALLBACK_COLORS[0],
    serverColor: customColor || FALLBACK_COLORS[0],
    readOnly,
    isShared,
    owner
  };
}

/**
 * Henter alle VEVENTs fra en enkelt kalender via direkte CalDAV REPORT (calendar-query).
 */
async function fetchEventsFromCalendarDirectReport(
  creds: CalDavCredentials,
  cal: CalendarInfoDTO
): Promise<CalendarEventDTO[]> {
  const reportXml = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

  const calUrl = ensureTrailingSlash(cal.url);
  const res = await davRequest(creds, 'REPORT', calUrl, reportXml, {
    'Content-Type': 'application/xml; charset=utf-8',
    Depth: '1'
  });

  const xml = await readResponseTextSmart(res);
  const baseOrigin = new URL(calUrl).origin;
  const responseBlocks = xml.match(/<(?:[a-zA-Z0-9]+:)?response\b[\s\S]*?<\/(?:[a-zA-Z0-9]+:)?response>/gi) || [];
  const events: CalendarEventDTO[] = [];

  for (const block of responseBlocks) {
    const hrefMatch = block.match(/<(?:[a-zA-Z0-9]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/i);
    const dataMatch = block.match(/<(?:[a-zA-Z0-9]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?calendar-data>/i);
    if (!dataMatch) continue;

    const rawIcs = normalizeDanishText(
      dataMatch[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .trim()
    );

    if (!rawIcs.includes('BEGIN:VCALENDAR')) continue;

    const objectUrl = hrefMatch
      ? new URL(hrefMatch[1].trim(), baseOrigin).toString()
      : undefined;

    const etagMatch = block.match(/<(?:[a-zA-Z0-9]+:)?getetag[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?getetag>/i);
    const etag = etagMatch ? etagMatch[1].trim().replace(/^["']|["']$/g, '') : undefined;

    const parsed = parseIcsToEvents(rawIcs, cal.id, objectUrl, etag);
    events.push(...parsed);
  }

  return events;
}

/**
 * Henter alle VEVENTs fra de angivne kalendere.
 */
export async function fetchAllEvents(
  creds: CalDavCredentials,
  calendars: CalendarInfoDTO[],
  _timeRange?: { start: string; end: string }
): Promise<CalendarEventDTO[]> {
  const allEvents: CalendarEventDTO[] = [];

  await Promise.all(
    calendars.map(async (cal) => {
      try {
        const calEvents = await fetchEventsFromCalendarDirectReport(creds, cal);
        allEvents.push(...calEvents);
      } catch (err) {
        console.warn(`Kunne ikke hente events fra kalender ${cal.name} (${cal.url}):`, err);
      }
    })
  );

  return allEvents;
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
 * Opretter en ny kalender på Mailcow/SOGo via CalDAV MKCALENDAR,
 * ELLER tilføjer et eksisterende kalenderlink hvis calendarUrl er angivet.
 */
export async function createCalDavCalendar(
  creds: CalDavCredentials,
  name: string,
  color: string,
  existingCalendarUrl?: string
): Promise<CalendarInfoDTO> {
  if (existingCalendarUrl && existingCalendarUrl.trim()) {
    return fetchSingleCalendarByUrl(creds, existingCalendarUrl.trim(), name, color);
  }

  const home = buildSogoUserCalendarHomeUrl(creds.serverUrl, creds.username);
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
 * Analyserer SOGo kalender-URL og visningsnavn for at registrere
 * delte kalendere og hvorvidt de er Read-Only.
 * Brugerens egne kalendere er ALDRIG Read-Only.
 */
function detectCalendarPermissionsFromUrlAndName(
  calUrl: string,
  displayName: string,
  normalizedUser: string
): { isShared: boolean; readOnly: boolean; owner?: string } {
  const urlDecoded = decodeURIComponent(calUrl || '');
  let isShared = false;
  let owner: string | undefined;

  const sogoUserMatch = urlDecoded.match(/\/SOGo\/dav\/([^/]+)\//i);
  if (sogoUserMatch && sogoUserMatch[1]) {
    const pathOwner = sogoUserMatch[1].toLowerCase().trim();
    if (pathOwner !== normalizedUser && pathOwner !== normalizedUser.split('@')[0]) {
      isShared = true;
      owner = sogoUserMatch[1];
    }
  }

  if (/_shared_/i.test(urlDecoded) || /\((?:delt|shared|read-only|skrivebeskyttet)/i.test(displayName)) {
    isShared = true;
  }

  const readOnly =
    isShared &&
    (/read[-_\s]?only|skrivebeskyttet|kun\s+læs/i.test(displayName) || /readonly/i.test(urlDecoded));

  return { isShared, readOnly, owner };
}
