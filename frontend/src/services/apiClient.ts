import type {
  AuthSession,
  CalendarSource,
  CalendarEvent,
  RsvpStatus
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

function buildAuthHeaders(session: AuthSession): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-caldav-server': session.serverUrl || '',
    'x-caldav-user': session.username || '',
    'x-caldav-password': session.password || ''
  };
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
