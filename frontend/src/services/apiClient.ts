import type {
  CalendarSource,
  CalendarEvent,
  RsvpStatus,
  PublicShareLink
} from '../types/calendar';

export interface LoginResponse {
  ok: boolean;
  username: string;
  calendars: Omit<CalendarSource, 'visible'>[];
  error?: string;
}

export interface SessionCheckResponse {
  ok: boolean;
  authenticated: boolean;
  username?: string;
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

export async function apiGetServerConfig(): Promise<{ hasDefaultServer: boolean }> {
  try {
    const res = await fetch('/api/caldav/config', { credentials: 'include' });
    const data = await res.json();
    return {
      hasDefaultServer: Boolean(data?.hasDefaultServer)
    };
  } catch {
    return { hasDefaultServer: true };
  }
}

export async function apiGetSession(): Promise<SessionCheckResponse> {
  try {
    const res = await fetch('/api/caldav/session', { credentials: 'include' });
    const data = await res.json();
    return {
      ok: Boolean(data?.ok),
      authenticated: Boolean(data?.authenticated),
      username: data?.username || ''
    };
  } catch {
    return { ok: false, authenticated: false };
  }
}

export async function apiLoginCalDav(
  serverUrl: string,
  username: string,
  password: string
): Promise<LoginResponse> {
  const res = await fetch('/api/caldav/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ serverUrl, username, password })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Login mod Mailcow/SOGo mislykkedes.');
  }
  return data;
}

export async function apiLogoutCalDav(): Promise<void> {
  await fetch('/api/caldav/logout', {
    method: 'POST',
    credentials: 'include'
  }).catch(() => {});
}

export async function apiSyncCalDav(
  timeRange?: { start: string; end: string }
): Promise<SyncResponse> {
  const res = await fetch('/api/caldav/sync', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ timeRange })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Synkronisering med Mailcow/SOGo mislykkedes.');
  }
  return data;
}

export async function apiSaveEvent(event: CalendarEvent): Promise<CalendarEvent> {
  const res = await fetch('/api/caldav/events', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ event })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke gemme begivenheden på serveren.');
  }
  return data.event;
}

export async function apiDeleteEvent(caldavUrl: string, etag?: string): Promise<void> {
  const res = await fetch('/api/caldav/events', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ caldavUrl, etag })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke slette begivenheden på serveren.');
  }
}

export async function apiUpdateRsvp(
  event: CalendarEvent,
  partstat: RsvpStatus
): Promise<CalendarEvent> {
  const res = await fetch('/api/caldav/rsvp', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ event, partstat })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke opdatere RSVP-status på serveren.');
  }
  return data.event;
}

export async function apiCreateCalendar(
  name: string,
  color: string,
  calendarUrl?: string
): Promise<Omit<CalendarSource, 'visible'>> {
  const res = await fetch('/api/caldav/calendars', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name, color, calendarUrl })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke oprette kalenderen på serveren.');
  }
  return data.calendar;
}

export async function apiDeleteCalendar(calendarUrl: string): Promise<void> {
  const res = await fetch('/api/caldav/calendars', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ calendarUrl })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke slette kalenderen på serveren.');
  }
}

export async function apiListShares(): Promise<PublicShareLink[]> {
  const res = await fetch('/api/caldav/shares', {
    method: 'GET',
    credentials: 'include'
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke hente delingslinks.');
  }
  return data.shares || [];
}

export async function apiCreateShare(params: {
  label: string;
  calendarUrls: string[];
  calendarNames: string[];
  hideDetails: boolean;
}): Promise<PublicShareLink> {
  const res = await fetch('/api/caldav/shares', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke oprette delingslink.');
  }
  return data.share;
}

export async function apiDeleteShare(token: string): Promise<void> {
  const res = await fetch(`/api/caldav/shares/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'include'
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
  calendarId: string,
  icsContent: string
): Promise<{ importedCount: number; events: CalendarEvent[] }> {
  const res = await fetch('/api/caldav/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ calendarId, icsContent })
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
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ events, calendarName })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke eksportere kalenderen.');
  }
  return data.icsContent;
}

export async function apiSubscribeCalendar(params: {
  name?: string;
  subscriptionUrl: string;
  color?: string;
}): Promise<{ calendar: Omit<CalendarSource, 'visible'>; events: CalendarEvent[] }> {
  const res = await fetch('/api/caldav/subscriptions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke abonnere på kalenderen.');
  }
  return {
    calendar: data.calendar,
    events: data.events || []
  };
}

export async function apiUnsubscribeCalendar(id: string): Promise<void> {
  const res = await fetch('/api/caldav/subscriptions', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ id })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Kunne ikke afmelde kalender-abonnementet.');
  }
}
