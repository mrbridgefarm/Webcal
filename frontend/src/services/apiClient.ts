import type {
  AuthSession,
  CalendarSource,
  CalendarEvent,
  RsvpStatus,
  PublicShareLink
} from '../types/calendar';

export interface LoginResponse {
  ok: boolean;
  serverUrl: string;
  username: string;
  calendars: Omit<CalendarSource, 'visible'>[];
  error?: string;
}

export interface SyncResponse {
  ok: boolean;
  calendars: Omit<CalendarSource, 'visible'>[];
  events: CalendarEvent[];
  syncedAt: string;
  error?: string;
}

export interface PublicShareResponse {
  ok: boolean;
  label: string;
  owner: string;
  hideDetails: boolean;
  calendars: Omit<CalendarSource, 'visible'>[];
  events: CalendarEvent[];
  syncedAt: string;
  error?: string;
}

function buildAuthHeaders(session: AuthSession): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'x-caldav-server': encodeURIComponent(session.serverUrl || ''),
    'x-caldav-user': encodeURIComponent(session.username || ''),
    'x-caldav-password': encodeURIComponent(session.password || '')
  };
}

export async function apiGetServerConfig(): Promise<{ hasDefaultServer: boolean }> {
  try {
    const res = await fetch('/api/caldav/config');
    const data = await res.json();
    return {
      hasDefaultServer: Boolean(data?.hasDefaultServer)
    };
  } catch {
    return { hasDefaultServer: true };
  }
}

export async function apiLoginCalDav(
  serverUrl: string,
  username: string,
  password: string
): Promise<LoginResponse> {
  const res = await fetch('/api/caldav/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverUrl, username, password })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Login mod Mailcow/SOGo mislykkedes.');
  }
  return data;
}

export async function apiSyncCalDav(
  session: AuthSession,
  timeRange?: { start: string; end: string }
): Promise<SyncResponse> {
  const res = await fetch('/api/caldav/sync', {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      timeRange
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Synkronisering med Mailcow/SOGo mislykkedes.');
  }
  return data;
}

export async function apiSaveEvent(
  session: AuthSession,
  event: CalendarEvent
): Promise<CalendarEvent> {
  const res = await fetch('/api/caldav/events', {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      event
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke gemme begivenheden på serveren.');
  }
  return data.event;
}

export async function apiDeleteEvent(
  session: AuthSession,
  caldavUrl: string,
  etag?: string
): Promise<void> {
  const res = await fetch('/api/caldav/events', {
    method: 'DELETE',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      caldavUrl,
      etag
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke slette begivenheden på serveren.');
  }
}

export async function apiUpdateRsvp(
  session: AuthSession,
  event: CalendarEvent,
  partstat: RsvpStatus
): Promise<CalendarEvent> {
  const res = await fetch('/api/caldav/rsvp', {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      event,
      partstat
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke opdatere RSVP-status på serveren.');
  }
  return data.event;
}

export async function apiCreateCalendar(
  session: AuthSession,
  name: string,
  color: string,
  calendarUrl?: string
): Promise<Omit<CalendarSource, 'visible'>> {
  const res = await fetch('/api/caldav/calendars', {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      name,
      color,
      calendarUrl
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke oprette kalenderen på serveren.');
  }
  return data.calendar;
}

export async function apiDeleteCalendar(
  session: AuthSession,
  calendarUrl: string
): Promise<void> {
  const res = await fetch('/api/caldav/calendars', {
    method: 'DELETE',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      calendarUrl
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke slette kalenderen på serveren.');
  }
}

export async function apiListShares(session: AuthSession): Promise<PublicShareLink[]> {
  const res = await fetch('/api/caldav/shares', {
    method: 'GET',
    headers: buildAuthHeaders(session)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke hente delingslinks.');
  }
  return data.shares || [];
}

export async function apiCreateShare(
  session: AuthSession,
  params: {
    label: string;
    calendarUrls: string[];
    calendarNames: string[];
    hideDetails: boolean;
  }
): Promise<PublicShareLink> {
  const res = await fetch('/api/caldav/shares', {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      ...params
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke oprette delingslink.');
  }
  return data.share;
}

export async function apiDeleteShare(session: AuthSession, token: string): Promise<void> {
  const res = await fetch(`/api/caldav/shares/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(session)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke slette delingslink.');
  }
}

export async function apiFetchPublicShare(token: string): Promise<PublicShareResponse> {
  const res = await fetch(`/api/caldav/public/${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Delingslinket er ugyldigt eller udløbet.');
  }
  return data;
}

export async function apiImportIcs(
  session: AuthSession,
  calendarId: string,
  icsContent: string
): Promise<{ importedCount: number; events: CalendarEvent[] }> {
  const res = await fetch('/api/caldav/import', {
    method: 'POST',
    headers: buildAuthHeaders(session),
    body: JSON.stringify({
      serverUrl: session.serverUrl,
      username: session.username,
      password: session.password,
      calendarId,
      icsContent
    })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke importere .ics-filen.');
  }
  return {
    importedCount: data.importedCount || 0,
    events: data.events || []
  };
}

export async function apiExportIcs(
  events: CalendarEvent[],
  calendarName: string
): Promise<string> {
  const res = await fetch('/api/caldav/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ events, calendarName })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke eksportere kalenderen.');
  }
  return data.icsContent;
}
