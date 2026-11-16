import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { db, purgeExpiredTrash } from '../db/database';
import { getDemoCalendars, getDemoEvents } from '../services/mockCaldav';
import {
  apiLoginCalDav,
  apiSyncCalDav,
  apiSaveEvent,
  apiDeleteEvent,
  apiUpdateRsvp
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
  RsvpStatus
} from '../types/calendar';

const SESSION_STORAGE_KEY = 'dav_sync_cal_session_v1';
const COLOR_OVERRIDE_KEY = 'dav_sync_cal_color_overrides_v1';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

/**
 * Sikker dyb kloning der fjerner alle Vue 3 Reactive Proxies (også indlejrede arrays som attendees),
 * så hverken kloning eller IndexedDB (Dexie) nogensinde kaster DataCloneError.
 */
export function clonePlain<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj));
}

export const useCalendarStore = defineStore('calendar', () => {
  // --- State ---
  const session = ref<AuthSession | null>(null);
  const calendars = ref<CalendarSource[]>([]);
  const events = ref<CalendarEvent[]>([]);
  const trashItems = ref<TrashItem[]>([]);
  const syncQueue = ref<SyncQueueItem[]>([]);

  const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const isSyncing = ref<boolean>(false);
  const lastSyncedAt = ref<string | null>(null);

  // Visning & Selektion
  const currentView = ref<'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'>('dayGridMonth');
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
  const editingEvent = ref<CalendarEvent | null>(null);
  const isEventModalOpen = ref<boolean>(false);
  const toasts = ref<ToastMessage[]>([]);

  // --- Helpers ---
  function notify(
    title: string,
    detail?: string,
    type: ToastMessage['type'] = 'info',
    durationMs = 4500
  ) {
    const id = crypto.randomUUID();
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
    calendars.value.filter((c) => !c.readOnly)
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
   * Øjeblikkelig lokal søgning mod det lokale indeks i browseren (millisekund-respons).
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

  /**
   * Kollisions-detektion på tværs af alle synlige kalendere (ignorerer heldagsbegivenheder).
   */
  const collisionEventIds = computed(() => {
    const colliding = new Set<string>();
    const timed = visibleEvents.value
      .filter((ev) => !ev.allDay)
      .map((ev) => ({
        id: ev.id,
        startMs: new Date(ev.start).getTime(),
        endMs: new Date(ev.end).getTime()
      }))
      .filter((ev) => !Number.isNaN(ev.startMs) && !Number.isNaN(ev.endMs) && ev.endMs > ev.startMs)
      .sort((a, b) => a.startMs - b.startMs);

    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        if (timed[j].startMs < timed[i].endMs) {
          colliding.add(timed[i].id);
          colliding.add(timed[j].id);
        } else {
          break;
        }
      }
    }
    return colliding;
  });

  // --- Initialisering & Offline/Online lyttere ---
  async function initStore() {
    window.addEventListener('online', () => {
      isOnline.value = true;
      notify('Forbindelse genoprettet', 'Synkroniserer offline-kø i baggrunden...', 'success');
      void flushSyncQueue();
    });

    window.addEventListener('offline', () => {
      isOnline.value = false;
      notify('Offline-tilstand aktiv', 'Alle ændringer gemmes i IndexedDB og synkroniseres automatisk senere.', 'warning');
    });

    await purgeExpiredTrash();
    trashItems.value = await db.trash.orderBy('deletedAt').reverse().toArray();
    syncQueue.value = await db.syncQueue.toArray();

    try {
      const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
      if (savedSession) {
        session.value = JSON.parse(savedSession);
      }
    } catch {
      session.value = null;
    }

    const storedCalendars = await db.calendars.toArray();
    const storedEvents = await db.events.toArray();

    if (storedCalendars.length > 0) {
      applyColorOverridesToCalendars(storedCalendars);
      calendars.value = storedCalendars;
      events.value = storedEvents;
      if (!activeTargetCalendarId.value && writableCalendars.value[0]) {
        activeTargetCalendarId.value = writableCalendars.value[0].id;
      }
    } else {
      await activateDemoMode(false);
    }

    startReminderWatcher(() => visibleEvents.value);

    if (session.value?.mode === 'CALDAV' && isOnline.value) {
      void flushSyncQueue().then(() => syncWithServer(true));
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

  // --- Login & Demo Mode ---
  async function activateDemoMode(resetData = true) {
    const demoSession: AuthSession = {
      mode: 'DEMO',
      serverUrl: 'https://mail.demo.dk/SOGo/dav/',
      username: 'carsten@demo.dk',
      connectedAt: new Date().toISOString()
    };
    session.value = demoSession;
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(demoSession));

    if (resetData || (await db.calendars.count()) === 0) {
      const demoCals = clonePlain(getDemoCalendars());
      applyColorOverridesToCalendars(demoCals);
      const demoEvs = clonePlain(getDemoEvents());

      await db.transaction('rw', db.calendars, db.events, db.syncQueue, async () => {
        await db.calendars.clear();
        await db.events.clear();
        await db.syncQueue.clear();
        await db.calendars.bulkPut(demoCals);
        await db.events.bulkPut(demoEvs);
      });

      calendars.value = demoCals;
      events.value = demoEvs;
      syncQueue.value = [];
    }

    if (writableCalendars.value[0]) {
      activeTargetCalendarId.value = writableCalendars.value[0].id;
    }
    lastSyncedAt.value = new Date().toISOString();
    isLoginModalOpen.value = false;
    notify('Demo/Mock-tilstand aktiv', 'Indlæste 3 SOGo-kalendere (inkl. delt Read-Only og mødeinvitation).', 'success');
  }

  async function loginToMailcow(serverUrl: string, username: string, password: string) {
    isSyncing.value = true;
    try {
      const loginRes = await apiLoginCalDav(serverUrl, username, password);
      const newSession: AuthSession = {
        mode: 'CALDAV',
        serverUrl: loginRes.serverUrl,
        username: loginRes.username,
        password,
        connectedAt: new Date().toISOString()
      };
      session.value = newSession;
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));

      await syncWithServer(false);
      isLoginModalOpen.value = false;
      notify('Forbundet til Mailcow / SOGo', `Logget ind som ${loginRes.username}`, 'success');
    } finally {
      isSyncing.value = false;
    }
  }

  async function syncWithServer(silent = false) {
    if (!session.value) return;
    if (session.value.mode === 'DEMO') {
      lastSyncedAt.value = new Date().toISOString();
      if (!silent) {
        notify('Lokal Demo-synkronisering', 'Alle ændringer er gemt i IndexedDB.', 'info');
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
      const mergedCalendars: CalendarSource[] = clonePlain(
        res.calendars.map((c) => ({
          ...c,
          visible: visibilityMap.has(c.id) ? Boolean(visibilityMap.get(c.id)) : true
        }))
      );
      applyColorOverridesToCalendars(mergedCalendars);
      const plainEvents = clonePlain(res.events);

      await db.transaction('rw', db.calendars, db.events, async () => {
        await db.calendars.clear();
        await db.events.clear();
        await db.calendars.bulkPut(mergedCalendars);
        await db.events.bulkPut(plainEvents);
      });

      calendars.value = mergedCalendars;
      events.value = plainEvents;
      lastSyncedAt.value = res.syncedAt;

      if (!activeTargetCalendarId.value && writableCalendars.value[0]) {
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
    const queue = await db.syncQueue.orderBy('id').toArray();
    if (queue.length === 0) return;

    for (const item of queue) {
      try {
        if (item.action === 'UPSERT' && item.payload.event) {
          const saved = clonePlain(await apiSaveEvent(session.value, item.payload.event));
          await db.events.put({ ...saved, pendingSync: false });
          const idx = events.value.findIndex((e) => e.id === item.eventId || e.id === saved.id);
          if (idx !== -1) {
            events.value[idx] = { ...saved, pendingSync: false };
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
      } catch (err) {
        console.warn('Offline kø-element fejlede og prøves igen senere:', err);
        break;
      }
    }

    syncQueue.value = await db.syncQueue.toArray();
  }

  // --- Kalender-synlighed & Farvestyring ---
  async function toggleCalendarVisibility(calId: string) {
    const cal = getCalendarById(calId);
    if (!cal) return;
    cal.visible = !cal.visible;
    await db.calendars.put(clonePlain(cal));
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
    await db.calendars.put(clonePlain(cal));
  }

  // --- CRUD på Begivenheder + Undo (Ctrl+Z) + Papirkurv ---
  function pushUndo(label: string, undoFn: () => Promise<void>) {
    undoStack.value.push({
      id: crypto.randomUUID(),
      label,
      timestamp: new Date().toISOString(),
      undo: undoFn
    });
    if (undoStack.value.length > 50) {
      undoStack.value.shift();
    }
  }

  async function triggerUndo() {
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
    if (isCalendarReadOnly(eventInput.calendarId)) {
      notify(
        'Skrivebeskyttet kalender (Read-Only)',
        'Du kan ikke oprette eller redigere begivenheder i en delt Read-Only kalender.',
        'error'
      );
      return null;
    }

    const existing = eventInput.id ? events.value.find((e) => e.id === eventInput.id) : undefined;
    const previousSnapshot = existing ? clonePlain(existing) : null;

    const uid = eventInput.uid || existing?.uid || crypto.randomUUID();
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

    // Mødesikkerhed / Spam-beskyttelse: Fjern begivenheder med eksterne mødedeltagere
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
      if (isCalendarReadOnly(targetCalId)) {
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

      // Bemærk: Ved kopiering nulstilles uid, caldavUrl, etag og rawIcs, så SOGo opretter en helt ny VEVENT!
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
    const ev = events.value.find((e) => e.id === eventId);
    if (!ev) return;

    const userEmail = (session.value?.username || 'carsten@demo.dk').toLowerCase().trim();
    const updatedAttendees = (ev.attendees || []).map((a) =>
      a.email.toLowerCase().trim() === userEmail ? { ...a, partstat } : clonePlain(a)
    );

    if (!updatedAttendees.some((a) => a.email.toLowerCase().trim() === userEmail)) {
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

  // --- Kontekstmenu & Modal hjælpere ---
  function openContextMenu(payload: Omit<ContextMenuState, 'visible'>) {
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
    session,
    calendars,
    events,
    trashItems,
    syncQueue,
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
    editingEvent,
    isEventModalOpen,
    toasts,

    // Computed
    visibleCalendars: computed(() => calendars.value.filter((c) => c.visible)),
    writableCalendars,
    defaultWritableCalendar,
    visibleEvents,
    clipboardEventIds,
    searchResults,
    collisionEventIds,

    // Actions & Helpers
    initStore,
    notify,
    dismissToast,
    getCalendarById,
    isCalendarReadOnly,
    hasInvitedAttendees,
    activateDemoMode,
    loginToMailcow,
    syncWithServer,
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
    openEditEventModal
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
