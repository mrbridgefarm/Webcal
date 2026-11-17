import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { db, purgeExpiredTrash } from '../db/database';
import {
  apiGetServerConfig,
  apiLoginCalDav,
  apiSyncCalDav,
  apiSaveEvent,
  apiDeleteEvent,
  apiUpdateRsvp,
  apiCreateCalendar,
  apiDeleteCalendar,
  apiListShares,
  apiCreateShare,
  apiDeleteShare,
  apiFetchPublicShare,
  apiImportIcs,
  apiExportIcs
} from '../services/apiClient';
import { startReminderWatcher } from '../services/notifications';
import type {
  AuthSession,
  CalendarSource,
  CalendarEvent,
  TrashItem,
  SyncQueueItem,
  UndoAction,
  ClipboardState,
  ContextMenuState,
  RsvpStatus,
  PublicShareLink,
  CalendarViewType
} from '../types/calendar';

const SESSION_STORAGE_KEY = 'dav_sync_cal_session_v2';
const COLOR_OVERRIDE_KEY = 'dav_sync_cal_color_overrides_v1';
const HIDDEN_CAL_KEY = 'dav_sync_cal_hidden_calendars_v1';

function loadHiddenCalendarIds(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_CAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

/**
 * Sikker dyb kloning der fjerner alle Vue 3 Reactive Proxies,
 * så hverken kloning eller IndexedDB (Dexie) kaster DataCloneError.
 */
export function clonePlain<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Genererer en RFC4122 v4 UUID, som også virker over almindelig HTTP (http://<vm-ip>:3000).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const useCalendarStore = defineStore('calendar', () => {
  // --- State ---
  const hasDefaultServer = ref<boolean>(true);
  const session = ref<AuthSession | null>(null);
  const calendars = ref<CalendarSource[]>([]);
  const events = ref<CalendarEvent[]>([]);
  const trashItems = ref<TrashItem[]>([]);
  const syncQueue = ref<SyncQueueItem[]>([]);
  const shares = ref<PublicShareLink[]>([]);
  const publicShareError = ref<string>('');

  const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isSyncing = ref<boolean>(false);
  const lastSyncedAt = ref<string | null>(null);

  // Visning & Selektion
  const currentView = ref<CalendarViewType>('dayGridMonth');
  const selectedEventIds = ref<string[]>([]);
  const selectedDateStr = ref<string>(toDateOnlyString(new Date()));
  const activeTargetCalendarId = ref<string>('');

  // Søgning
  const searchQuery = ref<string>('');

  // Udklipsholder (Copy/Cut/Paste) & Fortryd (Ctrl+Z)
  const clipboard = ref<ClipboardState>({
    mode: null,
    events: [],
    sourceAnchorDate: null,
    copiedAt: null
  });
  const undoStack = ref<UndoAction[]>([]);

  // UI Modals & Højrekliksmenu
  const contextMenu = ref<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetType: 'DATE',
    event: null,
    dateStr: null,
    allDay: true
  });
  const isLoginModalOpen = ref<boolean>(false);
  const isTrashModalOpen = ref<boolean>(false);
  const isShareModalOpen = ref<boolean>(false);
  const preselectedShareCalendarId = ref<string>('');
  const isImportExportModalOpen = ref<boolean>(false);
  const preselectedImportExportCalendarId = ref<string>('');
  const editingEvent = ref<CalendarEvent | null>(null);
  const isEventModalOpen = ref<boolean>(false);
  const toasts = ref<ToastMessage[]>([]);

  let isFlushing = false;
  let flushRequested = false;
  const hiddenCalendarIds = ref<string[]>(loadHiddenCalendarIds());

  // --- Computed Auth & Mode ---
  const isPublicShareMode = computed(() => session.value?.mode === 'PUBLIC_SHARE');
  const isAuthenticated = computed(
    () => Boolean(session.value && (session.value.mode === 'CALDAV' || session.value.mode === 'PUBLIC_SHARE'))
  );

  // --- Helpers ---
  function notify(
    title: string,
    detail?: string,
    type: ToastMessage['type'] = 'info',
    durationMs = 4500
  ) {
    const id = generateId();
    toasts.value.push({ id, title, detail, type });
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, durationMs);
  }

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  function getColorOverrides(): Record<string, string> {
    try {
      const raw = localStorage.getItem(COLOR_OVERRIDE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveColorOverrides(overrides: Record<string, string>) {
    localStorage.setItem(COLOR_OVERRIDE_KEY, JSON.stringify(overrides));
  }

  function getCalendarById(calId: string): CalendarSource | undefined {
    return calendars.value.find((c) => c.id === calId);
  }

  function isCalendarReadOnly(calId: string): boolean {
    if (isPublicShareMode.value) return true;
    const cal = getCalendarById(calId);
    return Boolean(cal?.readOnly);
  }

  /**
   * Mødesikkerhed / Spam-beskyttelse:
   * Returnerer true, hvis begivenheden indeholder andre inviterede deltagere end brugeren selv.
   */
  function hasInvitedAttendees(ev: CalendarEvent): boolean {
    if (!ev.attendees || ev.attendees.length === 0) return false;
    const currentUser = (session.value?.username || '').toLowerCase().trim();
    const currentLocalPart = currentUser.split('@')[0];

    const externalGuests = ev.attendees.filter((a) => {
      const email = (a.email || '').toLowerCase().trim();
      if (!email) return false;
      if (currentUser && (email === currentUser || email.split('@')[0] === currentLocalPart)) {
        return false;
      }
      return true;
    });

    return externalGuests.length > 0;
  }

  // --- Computed ---
  const visibleCalendarIds = computed(() =>
    new Set(calendars.value.filter((c) => c.visible).map((c) => c.id))
  );

  const writableCalendars = computed(() =>
    isPublicShareMode.value ? [] : calendars.value.filter((c) => !c.readOnly)
  );

  const defaultWritableCalendar = computed<CalendarSource | undefined>(() => {
    if (activeTargetCalendarId.value) {
      const found = writableCalendars.value.find((c) => c.id === activeTargetCalendarId.value);
      if (found) return found;
    }
    return writableCalendars.value[0];
  });

  const visibleEvents = computed(() =>
    events.value.filter((ev) => visibleCalendarIds.value.has(ev.calendarId))
  );

  const clipboardEventIds = computed(() =>
    new Set(clipboard.value.events.map((e) => e.id))
  );

  /**
   * Øjeblikkelig lokal søgning mod det lokale indeks i browseren.
   */
  const searchResults = computed(() => {
    const q = searchQuery.value.trim().toLowerCase();
    if (!q) return [];
    return events.value
      .filter((ev) => {
        const calName = getCalendarById(ev.calendarId)?.name || '';
        const attendeeStr = (ev.attendees || [])
          .map((a) => `${a.name || ''} ${a.email}`)
          .join(' ');
        const haystack = `${ev.title} ${ev.location || ''} ${ev.description || ''} ${calName} ${attendeeStr}`.toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 25);
  });

  // --- Initialisering ---
  async function initStore() {
    window.addEventListener('online', () => {
      isOnline.value = true;
      if (session.value?.mode === 'CALDAV') {
        notify('Forbindelse genoprettet', 'Synkroniserer offline-kø i baggrunden...', 'success');
        void flushSyncQueue();
      }
    });

    window.addEventListener('offline', () => {
      isOnline.value = false;
      if (session.value?.mode === 'CALDAV') {
        notify('Offline-tilstand aktiv', 'Alle ændringer gemmes i IndexedDB og synkroniseres automatisk senere.', 'warning');
      }
    });

    // 1. Tjek om brugeren åbner et offentligt delingslink (?share=<token>)
    const urlParams = new URLSearchParams(window.location.search);
    const shareToken = urlParams.get('share')?.trim();
    if (shareToken) {
      await loadPublicSharedCalendar(shareToken);
      return;
    }

    // 2. Tjek om serveren har DEFAULT_CALDAV_URL konfigureret i .env (uden at udstille selve URL'en)
    const cfg = await apiGetServerConfig();
    hasDefaultServer.value = cfg.hasDefaultServer;

    // 3. Tjek gemt Mailcow-session
    try {
      localStorage.removeItem('dav_sync_cal_session_v1'); // Fjern evt. gammel demo-session
      const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
      if (savedSession) {
        const parsed = JSON.parse(savedSession) as AuthSession;
        if (parsed && parsed.mode === 'CALDAV' && parsed.username && parsed.password) {
          session.value = parsed;
        }
      }
    } catch {
      session.value = null;
    }

    if (!session.value) {
      // Ingen aktiv Mailcow-session -> ryd eventuelle gamle demo-data og vis login-skærm!
      await db.transaction('rw', db.calendars, db.events, db.syncQueue, async () => {
        await db.calendars.clear();
        await db.events.clear();
        await db.syncQueue.clear();
      });
      calendars.value = [];
      events.value = [];
      isLoginModalOpen.value = true;
      return;
    }

    await purgeExpiredTrash();
    trashItems.value = await db.trash.orderBy('deletedAt').reverse().toArray();
    syncQueue.value = await db.syncQueue.toArray();

    const storedCalendars = await db.calendars.toArray();
    const storedEvents = await db.events.toArray();

    if (storedCalendars.length > 0) {
      applyColorOverridesToCalendars(storedCalendars);
      calendars.value = storedCalendars;
      events.value = storedEvents;
      if (
        !writableCalendars.value.some((c) => c.id === activeTargetCalendarId.value) &&
        writableCalendars.value[0]
      ) {
        activeTargetCalendarId.value = writableCalendars.value[0].id;
      }
    }

    startReminderWatcher(() => visibleEvents.value);

    if (isOnline.value) {
      void flushSyncQueue().then(() => syncWithServer(true));
    }
  }

  /**
   * Indlæser en offentligt delt kalender via ?share=<token> uden krav om login (100% Read-Only).
   */
  async function loadPublicSharedCalendar(token: string) {
    isSyncing.value = true;
    publicShareError.value = '';
    try {
      const res = await apiFetchPublicShare(token);
      session.value = {
        mode: 'PUBLIC_SHARE',
        serverUrl: '',
        username: res.owner,
        shareToken: token,
        shareLabel: res.label,
        connectedAt: new Date().toISOString()
      };
      calendars.value = res.calendars.map((c) => ({
        ...c,
        readOnly: true,
        isShared: true,
        visible: true
      }));
      events.value = res.events;
      lastSyncedAt.value = res.syncedAt;
      isLoginModalOpen.value = false;
    } catch (err: any) {
      publicShareError.value = err?.message || 'Kunne ikke indlæse den delte kalender.';
    } finally {
      isSyncing.value = false;
    }
  }

  function applyColorOverridesToCalendars(cals: CalendarSource[]) {
    const overrides = getColorOverrides();
    for (const cal of cals) {
      if (overrides[cal.id]) {
        cal.localColorOverride = overrides[cal.id];
        cal.color = overrides[cal.id];
      } else {
        cal.localColorOverride = null;
        cal.color = cal.serverColor || cal.color;
      }
    }
  }

  // --- Login & Logout mod Mailcow ---
  async function loginToMailcow(customServerUrl: string, username: string, password: string) {
    isSyncing.value = true;
    try {
      const targetUrl = customServerUrl.trim();
      const loginRes = await apiLoginCalDav(targetUrl, username, password);
      const newSession: AuthSession = {
        mode: 'CALDAV',
        serverUrl: targetUrl ? loginRes.serverUrl : '',
        username: loginRes.username,
        password,
        connectedAt: new Date().toISOString()
      };
      session.value = newSession;
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));

      await syncWithServer(false);
      isLoginModalOpen.value = false;
      startReminderWatcher(() => visibleEvents.value);
      notify('Forbundet til Mailcow / SOGo', `Logget ind som ${loginRes.username}`, 'success');
    } finally {
      isSyncing.value = false;
    }
  }

  async function logout() {
    session.value = null;
    localStorage.removeItem(SESSION_STORAGE_KEY);
    clearClipboard();
    selectedEventIds.value = [];
    undoStack.value = [];
    calendars.value = [];
    events.value = [];
    shares.value = [];

    await db.transaction('rw', db.calendars, db.events, db.syncQueue, async () => {
      await db.calendars.clear();
      await db.events.clear();
      await db.syncQueue.clear();
    });

    isLoginModalOpen.value = true;
  }

  async function syncWithServer(silent = false) {
    if (!session.value) return;

    if (session.value.mode === 'PUBLIC_SHARE' && session.value.shareToken) {
      await loadPublicSharedCalendar(session.value.shareToken);
      if (!silent && !publicShareError.value) {
        notify('Delt kalender opdateret', 'Hentede nyeste begivenheder.', 'success');
      }
      return;
    }

    if (!isOnline.value) {
      if (!silent) {
        notify('Ingen internetforbindelse', 'Synkronisering venter til du er online igen.', 'warning');
      }
      return;
    }

    isSyncing.value = true;
    try {
      await flushSyncQueue();
      const res = await apiSyncCalDav(session.value);

      const visibilityMap = new Map(calendars.value.map((c) => [c.id, c.visible]));
      const hiddenSet = new Set(hiddenCalendarIds.value);
      const mergedCalendars: CalendarSource[] = clonePlain(
        res.calendars
          .filter((c) => !hiddenSet.has(c.id))
          .map((c) => ({
            ...c,
            visible: visibilityMap.has(c.id) ? Boolean(visibilityMap.get(c.id)) : true
          }))
      );
      applyColorOverridesToCalendars(mergedCalendars);
      const serverEvents = clonePlain(res.events).filter((e) => !hiddenSet.has(e.calendarId));

      const pendingQueue = await db.syncQueue.toArray();
      const pendingIds = new Set(
        pendingQueue.filter((q) => q.action !== 'DELETE').map((q) => q.eventId)
      );
      const deletedIds = new Set(
        pendingQueue.filter((q) => q.action === 'DELETE').map((q) => q.eventId)
      );
      const serverIds = new Set(serverEvents.map((e) => e.id));
      const localPending = events.value
        .filter((e) => pendingIds.has(e.id) && !serverIds.has(e.id))
        .map((e) => clonePlain(e));
      const plainEvents = [
        ...serverEvents
          .filter((e) => !deletedIds.has(e.id))
          .map((e) => (pendingIds.has(e.id) ? clonePlain(events.value.find((l) => l.id === e.id) || e) : e)),
        ...localPending
      ];

      await db.transaction('rw', db.calendars, db.events, async () => {
        await db.calendars.clear();
        await db.events.clear();
        await db.calendars.bulkPut(mergedCalendars);
        await db.events.bulkPut(plainEvents);
      });

      calendars.value = mergedCalendars;
      events.value = plainEvents;
      lastSyncedAt.value = res.syncedAt;

      if (
        !writableCalendars.value.some((c) => c.id === activeTargetCalendarId.value) &&
        writableCalendars.value[0]
      ) {
        activeTargetCalendarId.value = writableCalendars.value[0].id;
      }

      if (!silent) {
        notify('Kalendere synkroniseret', `Hentede ${plainEvents.length} begivenheder fra Mailcow/SOGo.`, 'success');
      }
    } catch (err: any) {
      if (!silent) {
        notify('Synkroniseringsfejl', err?.message || 'Kunne ikke kontakte CalDAV-proxy.', 'error');
      }
    } finally {
      isSyncing.value = false;
    }
  }

  // --- Import / Eksport (.ics) ---
  function openImportExportModal(calendarId?: string) {
    if (isPublicShareMode.value) return;
    preselectedImportExportCalendarId.value = calendarId || activeTargetCalendarId.value || writableCalendars.value[0]?.id || '';
    isImportExportModalOpen.value = true;
  }

  async function importIcsFile(calendarId: string, icsContent: string): Promise<number> {
    if (!session.value || session.value.mode !== 'CALDAV') return 0;
    if (isCalendarReadOnly(calendarId)) {
      notify('Skrivebeskyttet kalender', 'Vælg en skrivbar kalender til import.', 'error');
      return 0;
    }

    const res = await apiImportIcs(session.value, calendarId, icsContent);
    const plainImported = clonePlain(res.events);
    for (const ev of plainImported) {
      const idx = events.value.findIndex((e) => e.id === ev.id);
      if (idx !== -1) {
        events.value[idx] = ev;
      } else {
        events.value.push(ev);
      }
    }
    await db.events.bulkPut(plainImported);
    notify(
      'Import gennemført!',
      `Importerede ${res.importedCount} begivenhed(er) til kalenderen.`,
      'success'
    );
    return res.importedCount;
  }

  async function exportCalendarIcs(calendarIdOrAll: string): Promise<void> {
    const isAll = calendarIdOrAll === 'ALL';
    const targetEvents = isAll
      ? clonePlain(visibleEvents.value)
      : clonePlain(events.value.filter((e) => e.calendarId === calendarIdOrAll));
    const calName = isAll
      ? 'Alle-Kalendere'
      : (getCalendarById(calendarIdOrAll)?.name || 'Kalender');

    if (targetEvents.length === 0) {
      notify('Ingen begivenheder', 'Den valgte kalender indeholder ingen begivenheder at eksportere.', 'warning');
      return;
    }

    const icsContent = await apiExportIcs(targetEvents, calName);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeFile = calName.replace(/[^a-zA-Z0-9æøåÆØÅ_-]+/g, '_');
    const datePart = toDateOnlyString(new Date());
    a.href = url;
    a.download = `${safeFile}-${datePart}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    notify(
      'Kalender eksporteret (.ics)',
      `Downloadede ${targetEvents.length} begivenhed(er) fra "${calName}".`,
      'success'
    );
  }

  // --- Offentlig Deling (Share Links til 3. part) ---
  function openShareModal(calendarId?: string) {
    if (isPublicShareMode.value) return;
    preselectedShareCalendarId.value = calendarId || '';
    isShareModalOpen.value = true;
    void loadShares();
  }

  async function loadShares() {
    if (session.value?.mode !== 'CALDAV') return;
    try {
      shares.value = await apiListShares(session.value);
    } catch (err) {
      console.warn('Kunne ikke hente delingslinks:', err);
    }
  }

  async function createShare(params: {
    label: string;
    calendarIds: string[];
    hideDetails: boolean;
  }): Promise<PublicShareLink | null> {
    if (session.value?.mode !== 'CALDAV') return null;
    const selectedCals = calendars.value.filter((c) => params.calendarIds.includes(c.id));
    if (selectedCals.length === 0) {
      notify('Vælg kalender', 'Vælg mindst én kalender, som skal deles.', 'warning');
      return null;
    }

    try {
      const created = await apiCreateShare(session.value, {
        label: params.label,
        calendarUrls: selectedCals.map((c) => c.url),
        calendarNames: selectedCals.map((c) => c.name),
        hideDetails: params.hideDetails
      });
      shares.value.unshift(created);
      notify('Delingslink oprettet', 'Du kan nu kopiere linket og sende det til 3. part.', 'success');
      return created;
    } catch (err: any) {
      notify('Kunne ikke oprette delingslink', err?.message || String(err), 'error');
      return null;
    }
  }

  async function revokeShare(token: string) {
    if (session.value?.mode !== 'CALDAV') return;
    try {
      await apiDeleteShare(session.value, token);
      shares.value = shares.value.filter((s) => s.token !== token);
      notify('Delingslink slettet', 'Linket er nu deaktiveret og kan ikke længere tilgås.', 'info');
    } catch (err: any) {
      notify('Fejl ved sletning af link', err?.message || String(err), 'error');
    }
  }

  // --- Offline Sync Queue ---
  async function enqueueSync(item: Omit<SyncQueueItem, 'id' | 'createdAt'>) {
    if (session.value?.mode !== 'CALDAV') return;

    const entry: SyncQueueItem = clonePlain({
      ...item,
      createdAt: new Date().toISOString()
    });
    const id = await db.syncQueue.add(entry);
    syncQueue.value.push({ ...entry, id });

    if (isOnline.value) {
      void flushSyncQueue();
    }
  }

  async function flushSyncQueue() {
    if (!isOnline.value || session.value?.mode !== 'CALDAV') return;
    if (isFlushing) {
      flushRequested = true;
      return;
    }
    isFlushing = true;

    try {
      const queue = await db.syncQueue.orderBy('id').toArray();

      for (const item of queue) {
        try {
          if (item.action === 'UPSERT' && item.payload.event) {
            const latestLocal = events.value.find((e) => e.id === item.eventId);
            const payloadEvent = clonePlain({
              ...item.payload.event,
              caldavUrl: latestLocal?.caldavUrl || item.payload.event.caldavUrl,
              etag: latestLocal?.etag || item.payload.event.etag
            });
            const saved = clonePlain(await apiSaveEvent(session.value, payloadEvent));
            const savedPlain = { ...saved, pendingSync: false };
            await db.events.put(savedPlain);
            const idx = events.value.findIndex((e) => e.id === item.eventId || e.id === saved.id);
            if (idx !== -1) {
              events.value[idx] = savedPlain;
            }
          } else if (item.action === 'DELETE' && item.payload.caldavUrl) {
            await apiDeleteEvent(session.value, item.payload.caldavUrl, item.payload.etag);
          } else if (item.action === 'RSVP' && item.payload.event && item.payload.partstat) {
            const updated = clonePlain(
              await apiUpdateRsvp(session.value, item.payload.event, item.payload.partstat)
            );
            await db.events.put({ ...updated, pendingSync: false });
            const idx = events.value.findIndex((e) => e.id === updated.id);
            if (idx !== -1) {
              events.value[idx] = { ...updated, pendingSync: false };
            }
          }

          if (item.id !== undefined) {
            await db.syncQueue.delete(item.id);
          }
        } catch (err: any) {
          console.warn('Synkronisering af ændring fejlede:', err);
          const msg = String(err?.message || err);
          const isNetworkError = err instanceof TypeError || /Failed to fetch|NetworkError/i.test(msg);
          if (isNetworkError) {
            notify('Ændring venter på forbindelse', 'Gemmes lokalt og sendes til Mailcow, når serveren kan nås.', 'warning');
            break;
          }
          notify('Mailcow afviste ændringen', msg, 'error', 9000);
          if (item.id !== undefined) {
            await db.syncQueue.delete(item.id);
          }
        }
      }

      syncQueue.value = await db.syncQueue.toArray();
    } finally {
      isFlushing = false;
      if (flushRequested) {
        flushRequested = false;
        void flushSyncQueue();
      }
    }
  }

  // --- Kalender-synlighed & Farvestyring ---
  async function toggleCalendarVisibility(calId: string) {
    const cal = getCalendarById(calId);
    if (!cal) return;
    cal.visible = !cal.visible;
    if (!isPublicShareMode.value) {
      await db.calendars.put(clonePlain(cal));
    }
  }

  async function setCalendarColorOverride(calId: string, newColor: string | null) {
    const cal = getCalendarById(calId);
    if (!cal) return;
    const overrides = getColorOverrides();
    if (newColor) {
      overrides[calId] = newColor;
      cal.localColorOverride = newColor;
      cal.color = newColor;
    } else {
      delete overrides[calId];
      cal.localColorOverride = null;
      cal.color = cal.serverColor;
    }
    saveColorOverrides(overrides);
    if (!isPublicShareMode.value) {
      await db.calendars.put(clonePlain(cal));
    }
  }

  // --- CRUD på Begivenheder + Undo (Ctrl+Z) + Papirkurv ---
  function pushUndo(label: string, undoFn: () => Promise<void>) {
    undoStack.value.push({
      id: generateId(),
      label,
      timestamp: new Date().toISOString(),
      undo: undoFn
    });
    if (undoStack.value.length > 50) {
      undoStack.value.shift();
    }
  }

  async function triggerUndo() {
    if (isPublicShareMode.value) return;
    const last = undoStack.value.pop();
    if (!last) {
      notify('Intet at fortryde', 'Fortryd-historikken er tom.', 'info');
      return;
    }
    await last.undo();
    notify('Handling fortrudt (Ctrl+Z)', last.label, 'success');
  }

  async function saveEvent(
    eventInput: Partial<CalendarEvent> & { title: string; start: string; end: string; calendarId: string },
    recordUndo = true
  ): Promise<CalendarEvent | null> {
    if (isPublicShareMode.value || isCalendarReadOnly(eventInput.calendarId)) {
      notify(
        'Skrivebeskyttet kalender (Read-Only)',
        'Du kan ikke oprette eller redigere begivenheder i en skrivebeskyttet kalender.',
        'error'
      );
      return null;
    }

    const existing = eventInput.id ? events.value.find((e) => e.id === eventInput.id) : undefined;
    const previousSnapshot = existing ? clonePlain(existing) : null;

    const uid = eventInput.uid || existing?.uid || generateId();
    const id = `${eventInput.calendarId}::${uid}`;

    const fullEvent: CalendarEvent = clonePlain({
      id,
      uid,
      calendarId: eventInput.calendarId,
      title: eventInput.title.trim() || '(Ingen titel)',
      start: eventInput.start,
      end: eventInput.end,
      allDay: Boolean(eventInput.allDay),
      description: eventInput.description ?? existing?.description ?? '',
      location: eventInput.location ?? existing?.location ?? '',
      videoUrl: eventInput.videoUrl ?? existing?.videoUrl ?? '',
      timezone: eventInput.timezone || existing?.timezone || 'Europe/Copenhagen',
      attendees: eventInput.attendees ?? existing?.attendees ?? [],
      organizer: eventInput.organizer ?? existing?.organizer,
      reminderMinutes:
        eventInput.reminderMinutes !== undefined
          ? eventInput.reminderMinutes
          : (existing?.reminderMinutes ?? 15),
      etag: eventInput.etag !== undefined ? eventInput.etag : existing?.etag,
      caldavUrl: eventInput.caldavUrl !== undefined ? eventInput.caldavUrl : existing?.caldavUrl,
      rawIcs: eventInput.rawIcs !== undefined ? eventInput.rawIcs : existing?.rawIcs,
      updatedAt: new Date().toISOString(),
      pendingSync: session.value?.mode === 'CALDAV'
    });

    if (existing && existing.id !== fullEvent.id) {
      events.value = events.value.filter((e) => e.id !== existing.id);
      await db.events.delete(existing.id);
    }

    const idx = events.value.findIndex((e) => e.id === fullEvent.id);
    if (idx !== -1) {
      events.value[idx] = fullEvent;
    } else {
      events.value.push(fullEvent);
    }
    await db.events.put(clonePlain(fullEvent));

    await enqueueSync({
      action: 'UPSERT',
      eventId: fullEvent.id,
      payload: { event: clonePlain(fullEvent) }
    });

    if (recordUndo) {
      if (previousSnapshot) {
        pushUndo(`Redigerede "${fullEvent.title}"`, async () => {
          await saveEvent(previousSnapshot, false);
        });
      } else {
        pushUndo(`Oprettede "${fullEvent.title}"`, async () => {
          await deleteEventsByIds([fullEvent.id], false);
        });
      }
    }

    return fullEvent;
  }

  async function deleteEventsByIds(ids: string[], recordUndo = true) {
    if (isPublicShareMode.value) return;
    const toDelete = events.value.filter((e) => ids.includes(e.id));
    if (toDelete.length === 0) return;

    const blockedReadOnly = toDelete.filter((e) => isCalendarReadOnly(e.calendarId));
    if (blockedReadOnly.length > 0) {
      notify(
        'Skrivebeskyttet kalender (Read-Only)',
        `Kan ikke slette "${blockedReadOnly[0].title}", da kalenderen er skrivebeskyttet.`,
        'error'
      );
      return;
    }

    const snapshots = toDelete.map((e) => clonePlain(e));
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const newTrashEntries: TrashItem[] = snapshots.map((ev) => ({
      id: ev.id,
      event: clonePlain(ev),
      deletedAt: now.toISOString(),
      expiresAt: expires.toISOString()
    }));

    const idSet = new Set(snapshots.map((e) => e.id));
    events.value = events.value.filter((e) => !idSet.has(e.id));
    selectedEventIds.value = selectedEventIds.value.filter((id) => !idSet.has(id));

    await db.transaction('rw', db.events, db.trash, async () => {
      await db.events.bulkDelete([...idSet]);
      await db.trash.bulkPut(newTrashEntries);
    });

    trashItems.value = await db.trash.orderBy('deletedAt').reverse().toArray();

    for (const ev of snapshots) {
      if (ev.caldavUrl) {
        await enqueueSync({
          action: 'DELETE',
          eventId: ev.id,
          payload: { caldavUrl: ev.caldavUrl, etag: ev.etag }
        });
      }
    }

    if (recordUndo) {
      const label = snapshots.length === 1
        ? `Slettede "${snapshots[0].title}"`
        : `Slettede ${snapshots.length} begivenheder`;

      pushUndo(label, async () => {
        for (const snap of snapshots) {
          await db.trash.delete(snap.id);
          await saveEvent(snap, false);
        }
        trashItems.value = await db.trash.orderBy('deletedAt').reverse().toArray();
      });

      notify(
        label,
        'Flyttet til den lokale 30-dages papirkurv (Tryk Ctrl+Z for at fortryde).',
        'info'
      );
    }
  }

  async function restoreFromTrash(trashId: string) {
    if (isPublicShareMode.value) return;
    const item = trashItems.value.find((t) => t.id === trashId);
    if (!item) return;

    await db.trash.delete(trashId);
    trashItems.value = trashItems.value.filter((t) => t.id !== trashId);

    const targetCalId =
      getCalendarById(item.event.calendarId) && !isCalendarReadOnly(item.event.calendarId)
        ? item.event.calendarId
        : defaultWritableCalendar.value?.id || item.event.calendarId;

    await saveEvent({ ...clonePlain(item.event), calendarId: targetCalId }, false);
    notify('Begivenhed gendannet', `"${item.event.title}" er tilbage i kalenderen.`, 'success');
  }

  async function permanentlyDeleteFromTrash(trashId: string) {
    await db.trash.delete(trashId);
    trashItems.value = trashItems.value.filter((t) => t.id !== trashId);
  }

  async function emptyTrash() {
    await db.trash.clear();
    trashItems.value = [];
    notify('Papirkurv tømt', 'Alle slettede begivenheder blev fjernet permanent.', 'info');
  }

  // --- Ægte Copy / Cut / Paste på tværs af dage ---
  function clearClipboard() {
    clipboard.value = {
      mode: null,
      events: [],
      sourceAnchorDate: null,
      copiedAt: null
    };
  }

  function copyOrCutSelection(mode: 'COPY' | 'CUT', explicitEvents?: CalendarEvent[]) {
    if (isPublicShareMode.value) return;

    let candidates: CalendarEvent[] = [];

    if (explicitEvents && explicitEvents.length > 0) {
      candidates = explicitEvents;
    } else if (selectedEventIds.value.length > 0) {
      const idSet = new Set(selectedEventIds.value);
      candidates = events.value.filter((e) => idSet.has(e.id));
    } else if (selectedDateStr.value) {
      const dayPrefix = selectedDateStr.value.slice(0, 10);
      candidates = visibleEvents.value.filter((e) => toDateOnlyString(new Date(e.start)) === dayPrefix);
    }

    if (candidates.length === 0) {
      notify(
        'Ingen begivenhed valgt',
        'Klik først på en begivenhed (eller en dag med begivenheder), og tryk derefter Ctrl+C.',
        'warning'
      );
      return;
    }

    const blockedMeetings = candidates.filter((e) => hasInvitedAttendees(e));
    const allowed = candidates.filter((e) => !hasInvitedAttendees(e));

    if (blockedMeetings.length > 0 && allowed.length === 0) {
      notify(
        'Kopiering spærret (Mødesikkerhed)',
        `"${blockedMeetings[0].title}" indeholder inviterede mødedeltagere. Ctrl+C er deaktiveret på møder med gæster.`,
        'error'
      );
      return;
    }

    const finalEvents =
      mode === 'CUT'
        ? allowed.filter((e) => !isCalendarReadOnly(e.calendarId))
        : allowed;

    if (mode === 'CUT' && finalEvents.length === 0) {
      notify(
        'Klip spærret (Read-Only)',
        'Du kan ikke klippe begivenheder ud fra en skrivebeskyttet kalender.',
        'error'
      );
      return;
    }

    const sorted = [...finalEvents].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );
    const anchorDate = toDateOnlyString(new Date(sorted[0].start));
    const plainCopied = sorted.map((e) => clonePlain(e));

    clipboard.value = {
      mode,
      events: plainCopied,
      sourceAnchorDate: anchorDate,
      copiedAt: new Date().toISOString()
    };

    const skippedNotice =
      blockedMeetings.length > 0
        ? ` (${blockedMeetings.length} møde med deltagere blev sprunget over)`
        : '';

    const titleSummary =
      plainCopied.length === 1
        ? `"${plainCopied[0].title}"`
        : `${plainCopied.length} begivenheder`;

    notify(
      mode === 'COPY'
        ? `Kopieret: ${titleSummary}`
        : `Klippet: ${titleSummary}`,
      `Klik på en ny dag i kalenderen og tryk Ctrl+V (eller højreklik -> Indsæt)${skippedNotice}.`,
      'success'
    );
  }

  async function pasteToDate(targetDateInput?: string) {
    if (isPublicShareMode.value) return;
    if (!clipboard.value.events.length || !clipboard.value.sourceAnchorDate) {
      notify('Udklipsholderen er tom', 'Kopiér først en begivenhed med Ctrl+C eller højreklik.', 'warning');
      return;
    }

    const targetRaw = targetDateInput || selectedDateStr.value;
    if (!targetRaw) {
      notify('Vælg en dato først', 'Klik på den dag i kalenderen, hvor du vil indsætte (Ctrl+V).', 'warning');
      return;
    }

    const targetDateOnly = targetRaw.slice(0, 10);
    const dayDiff = diffDaysBetween(clipboard.value.sourceAnchorDate, targetDateOnly);
    const hasSpecificTargetTime = targetRaw.includes('T') && clipboard.value.events.length === 1;

    const createdIds: string[] = [];
    const cutOriginalSnapshots =
      clipboard.value.mode === 'CUT'
        ? clipboard.value.events.map((e) => clonePlain(e))
        : [];

    for (const srcEvent of clipboard.value.events) {
      let targetCalId = srcEvent.calendarId;
      if (!getCalendarById(targetCalId) || isCalendarReadOnly(targetCalId)) {
        if (!defaultWritableCalendar.value) {
          notify(
            'Ingen skrivbar kalender',
            'Kan ikke indsætte (Ctrl+V), da alle kalendere er Read-Only.',
            'error'
          );
          return;
        }
        targetCalId = defaultWritableCalendar.value.id;
      }

      let newStartIso: string;
      let newEndIso: string;

      if (srcEvent.allDay) {
        const srcStartYmd = toDateOnlyString(new Date(srcEvent.start));
        const srcEndYmd = srcEvent.end
          ? toDateOnlyString(new Date(srcEvent.end))
          : srcStartYmd;
        const shiftedStart = addDaysToDateOnly(srcStartYmd, dayDiff);
        const durationDays = Math.max(1, diffDaysBetween(srcStartYmd, srcEndYmd));
        const shiftedEnd = addDaysToDateOnly(shiftedStart, durationDays);
        newStartIso = shiftedStart;
        newEndIso = shiftedEnd;
      } else if (hasSpecificTargetTime) {
        const durationMs = Math.max(
          15 * 60 * 1000,
          new Date(srcEvent.end).getTime() - new Date(srcEvent.start).getTime()
        );
        const startDt = new Date(targetRaw);
        const endDt = new Date(startDt.getTime() + durationMs);
        newStartIso = startDt.toISOString();
        newEndIso = endDt.toISOString();
      } else {
        const startDt = new Date(srcEvent.start);
        const endDt = new Date(srcEvent.end || srcEvent.start);
        const durationMs = Math.max(15 * 60 * 1000, endDt.getTime() - startDt.getTime());
        startDt.setDate(startDt.getDate() + dayDiff);
        const newEndDt = new Date(startDt.getTime() + durationMs);
        newStartIso = startDt.toISOString();
        newEndIso = newEndDt.toISOString();
      }

      const created = await saveEvent(
        {
          calendarId: targetCalId,
          title: srcEvent.title,
          start: newStartIso,
          end: newEndIso,
          allDay: srcEvent.allDay,
          description: srcEvent.description,
          location: srcEvent.location,
          videoUrl: srcEvent.videoUrl,
          timezone: srcEvent.timezone,
          attendees: [],
          reminderMinutes: srcEvent.reminderMinutes,
          uid: undefined,
          caldavUrl: undefined,
          etag: undefined,
          rawIcs: undefined
        },
        false
      );

      if (created) {
        createdIds.push(created.id);
      }
    }

    if (clipboard.value.mode === 'CUT' && cutOriginalSnapshots.length > 0) {
      await deleteEventsByIds(
        cutOriginalSnapshots.map((e) => e.id),
        false
      );
      clipboard.value.mode = 'COPY';
    }

    if (createdIds.length > 0) {
      selectedEventIds.value = createdIds;

      pushUndo(`Indsatte ${createdIds.length} begivenhed(er) på ${targetDateOnly}`, async () => {
        await deleteEventsByIds(createdIds, false);
        for (const orig of cutOriginalSnapshots) {
          await db.trash.delete(orig.id);
          await saveEvent(orig, false);
        }
        trashItems.value = await db.trash.orderBy('deletedAt').reverse().toArray();
      });

      notify(
        `Indsatte ${createdIds.length} begivenhed(er) (Ctrl+V)`,
        `Placeret på ${targetDateOnly} (Tryk Ctrl+Z for at fortryde).`,
        'success'
      );
    }
  }

  // --- RSVP på Mødeinvitationer ---
  async function respondToInvite(eventId: string, partstat: RsvpStatus) {
    if (isPublicShareMode.value) return;
    const ev = events.value.find((e) => e.id === eventId);
    if (!ev) return;

    const userEmail = (session.value?.username || '').toLowerCase().trim();
    const updatedAttendees = (ev.attendees || []).map((a) =>
      a.email.toLowerCase().trim() === userEmail ? { ...a, partstat } : clonePlain(a)
    );

    if (userEmail && !updatedAttendees.some((a) => a.email.toLowerCase().trim() === userEmail)) {
      updatedAttendees.push({
        email: userEmail,
        name: userEmail.split('@')[0],
        partstat
      });
    }

    const updatedEvent: CalendarEvent = clonePlain({
      ...ev,
      attendees: updatedAttendees,
      updatedAt: new Date().toISOString(),
      pendingSync: session.value?.mode === 'CALDAV'
    });

    const idx = events.value.findIndex((e) => e.id === eventId);
    if (idx !== -1) {
      events.value[idx] = updatedEvent;
    }
    await db.events.put(clonePlain(updatedEvent));

    if (editingEvent.value?.id === eventId) {
      editingEvent.value = clonePlain(updatedEvent);
    }

    await enqueueSync({
      action: 'RSVP',
      eventId: updatedEvent.id,
      payload: { event: clonePlain(updatedEvent), partstat }
    });

    const labelMap: Record<RsvpStatus, string> = {
      ACCEPTED: 'Deltager',
      TENTATIVE: 'Måske',
      DECLINED: 'Afvist',
      'NEEDS-ACTION': 'Afventer svar'
    };

    notify('RSVP opdateret', `Dit svar på "${ev.title}" er sat til: ${labelMap[partstat]}.`, 'success');
  }

  // --- Kalender-administration (Tilføj / Slet / Fjern fra listen) ---
  function persistHiddenCalendars() {
    localStorage.setItem(HIDDEN_CAL_KEY, JSON.stringify(hiddenCalendarIds.value));
  }

  async function createCalendar(name: string, color: string, calendarUrl?: string) {
    if (isPublicShareMode.value || session.value?.mode !== 'CALDAV') return null;
    const trimmed = name.trim();
    const trimmedUrl = calendarUrl?.trim() || '';
    if (!trimmed && !trimmedUrl) {
      notify('Navn eller URL mangler', 'Giv kalenderen et navn eller indsæt et CalDAV-link.', 'warning');
      return null;
    }

    if (!isOnline.value) {
      notify('Offline', 'Du skal være online for at oprette eller tilføje en kalender på Mailcow.', 'warning');
      return null;
    }

    let newCal: CalendarSource;
    try {
      const created = await apiCreateCalendar(
        session.value,
        trimmed || 'SOGo Kalender',
        color,
        trimmedUrl || undefined
      );
      newCal = clonePlain({ ...created, visible: true });
    } catch (err: any) {
      notify('Kunne ikke oprette/tilføje kalender', err?.message || String(err), 'error', 9000);
      return null;
    }

    hiddenCalendarIds.value = hiddenCalendarIds.value.filter((id) => id !== newCal.id);
    persistHiddenCalendars();

    const existingIdx = calendars.value.findIndex((c) => c.id === newCal.id);
    if (existingIdx !== -1) {
      calendars.value[existingIdx] = newCal;
    } else {
      calendars.value.push(newCal);
    }
    await db.calendars.put(clonePlain(newCal));
    if (!newCal.readOnly) {
      activeTargetCalendarId.value = newCal.id;
    }
    notify('Kalender tilføjet', `"${newCal.name}" er klar.`, 'success');

    if (trimmedUrl) {
      void syncWithServer(true);
    }
    return newCal;
  }

  async function deleteCalendar(calId: string) {
    if (isPublicShareMode.value || session.value?.mode !== 'CALDAV') return;
    const cal = getCalendarById(calId);
    if (!cal) return;
    if (cal.readOnly || cal.isShared) {
      notify('Kan ikke slettes', 'Delte kalendere kan kun fjernes fra listen, ikke slettes.', 'warning');
      return;
    }

    try {
      await apiDeleteCalendar(session.value, cal.url);
    } catch (err: any) {
      notify('Kunne ikke slette kalender', err?.message || String(err), 'error', 9000);
      return;
    }

    await removeCalendarLocally(calId);
    notify('Kalender slettet', `"${cal.name}" og dens begivenheder er slettet.`, 'info');
  }

  async function hideCalendar(calId: string) {
    const cal = getCalendarById(calId);
    if (!cal) return;
    if (!hiddenCalendarIds.value.includes(calId)) {
      hiddenCalendarIds.value.push(calId);
      persistHiddenCalendars();
    }
    await removeCalendarLocally(calId);
    notify('Kalender fjernet fra listen', `"${cal.name}" vises ikke længere. Kan gendannes under "Skjulte kalendere".`, 'info');
  }

  async function restoreHiddenCalendars() {
    hiddenCalendarIds.value = [];
    persistHiddenCalendars();
    await syncWithServer(false);
  }

  async function removeCalendarLocally(calId: string) {
    calendars.value = calendars.value.filter((c) => c.id !== calId);
    const evIds = events.value.filter((e) => e.calendarId === calId).map((e) => e.id);
    events.value = events.value.filter((e) => e.calendarId !== calId);
    selectedEventIds.value = selectedEventIds.value.filter((id) => !evIds.includes(id));
    clipboard.value.events = clipboard.value.events.filter((e) => e.calendarId !== calId);
    if (clipboard.value.events.length === 0) clearClipboard();
    await db.calendars.delete(calId);
    await db.events.bulkDelete(evIds);
    if (activeTargetCalendarId.value === calId) {
      activeTargetCalendarId.value = writableCalendars.value[0]?.id || '';
    }
  }

  // --- Kontekstmenu & Modal hjælpere ---
  function openContextMenu(payload: Omit<ContextMenuState, 'visible'>) {
    if (isPublicShareMode.value) return;
    const menuWidth = 260;
    const menuHeight = 320;
    const x = Math.min(payload.x, window.innerWidth - menuWidth - 12);
    const y = Math.min(payload.y, window.innerHeight - menuHeight - 12);

    contextMenu.value = {
      ...payload,
      event: payload.event ? clonePlain(payload.event) : null,
      x: Math.max(8, x),
      y: Math.max(8, y),
      visible: true
    };
  }

  function closeContextMenu() {
    contextMenu.value.visible = false;
  }

  function openCreateEventModal(dateStr?: string, allDay = false) {
    if (isPublicShareMode.value) return;
    const cal = defaultWritableCalendar.value;
    if (!cal) {
      notify('Ingen skrivbar kalender', 'Alle aktive kalendere er Read-Only.', 'error');
      return;
    }

    const baseDate = dateStr || selectedDateStr.value || toDateOnlyString(new Date());
    let startIso: string;
    let endIso: string;

    if (allDay || (!baseDate.includes('T') && currentView.value === 'dayGridMonth')) {
      const startDay = baseDate.slice(0, 10);
      const startDt = new Date(`${startDay}T09:00:00`);
      const endDt = new Date(`${startDay}T10:00:00`);
      startIso = startDt.toISOString();
      endIso = endDt.toISOString();
    } else {
      const startDt = new Date(baseDate);
      const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
      startIso = startDt.toISOString();
      endIso = endDt.toISOString();
    }

    editingEvent.value = {
      id: '',
      uid: '',
      calendarId: cal.id,
      title: '',
      start: startIso,
      end: endIso,
      allDay: false,
      description: '',
      location: '',
      videoUrl: '',
      timezone: 'Europe/Copenhagen',
      attendees: [],
      reminderMinutes: 15
    };
    isEventModalOpen.value = true;
  }

  function openEditEventModal(ev: CalendarEvent) {
    editingEvent.value = clonePlain(ev);
    isEventModalOpen.value = true;
  }

  return {
    // State
    hasDefaultServer,
    session,
    calendars,
    events,
    trashItems,
    syncQueue,
    shares,
    publicShareError,
    isOnline,
    isSyncing,
    lastSyncedAt,
    currentView,
    selectedEventIds,
    selectedDateStr,
    activeTargetCalendarId,
    searchQuery,
    clipboard,
    undoStack,
    contextMenu,
    isLoginModalOpen,
    isTrashModalOpen,
    isShareModalOpen,
    preselectedShareCalendarId,
    isImportExportModalOpen,
    preselectedImportExportCalendarId,
    editingEvent,
    isEventModalOpen,
    toasts,
    hiddenCalendarIds,

    // Computed
    isPublicShareMode,
    isAuthenticated,
    visibleCalendars: computed(() => calendars.value.filter((c) => c.visible)),
    writableCalendars,
    defaultWritableCalendar,
    visibleEvents,
    clipboardEventIds,
    searchResults,

    // Actions & Helpers
    initStore,
    notify,
    dismissToast,
    getCalendarById,
    isCalendarReadOnly,
    hasInvitedAttendees,
    loginToMailcow,
    logout,
    syncWithServer,
    openShareModal,
    loadShares,
    createShare,
    revokeShare,
    openImportExportModal,
    importIcsFile,
    exportCalendarIcs,
    toggleCalendarVisibility,
    setCalendarColorOverride,
    saveEvent,
    deleteEventsByIds,
    restoreFromTrash,
    permanentlyDeleteFromTrash,
    emptyTrash,
    clearClipboard,
    copyOrCutSelection,
    pasteToDate,
    triggerUndo,
    respondToInvite,
    openContextMenu,
    closeContextMenu,
    openCreateEventModal,
    openEditEventModal,
    createCalendar,
    deleteCalendar,
    hideCalendar,
    restoreHiddenCalendars
  };
});

// --- Dato-hjælpefunktioner ---
export function toDateOnlyString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function diffDaysBetween(sourceYmd: string, targetYmd: string): number {
  const [sy, sm, sd] = sourceYmd.split('-').map(Number);
  const [ty, tm, td] = targetYmd.split('-').map(Number);
  const utcSource = Date.UTC(sy, sm - 1, sd);
  const utcTarget = Date.UTC(ty, tm - 1, td);
  return Math.round((utcTarget - utcSource) / (1000 * 60 * 60 * 24));
}

function addDaysToDateOnly(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
