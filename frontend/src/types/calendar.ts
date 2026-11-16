export type RsvpStatus = 'NEEDS-ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';

export interface Attendee {
  email: string;
  name?: string;
  partstat: RsvpStatus;
  role?: string;
  isOrganizer?: boolean;
}

export interface CalendarSource {
  id: string;
  url: string;
  name: string;
  color: string;          // Aktiv farve (kan være lokalt overskrevet)
  serverColor: string;    // SOGo's oprindelige serverfarve
  localColorOverride?: string | null;
  readOnly: boolean;      // Låser redigering, Drag & Drop og Ctrl+V hvis true
  isShared: boolean;      // Delt SOGo kalender
  owner?: string;
  visible: boolean;
  ctag?: string;
  description?: string;
}

export interface CalendarEvent {
  id: string;
  uid: string;
  calendarId: string;
  title: string;
  start: string;          // ISO 8601
  end: string;            // ISO 8601
  allDay: boolean;
  description?: string;
  location?: string;
  videoUrl?: string;
  timezone?: string;
  attendees: Attendee[];
  organizer?: string;
  reminderMinutes?: number | null;
  etag?: string;
  caldavUrl?: string;
  rawIcs?: string;
  updatedAt?: string;
  pendingSync?: boolean;
}

export interface TrashItem {
  id: string;
  event: CalendarEvent;
  deletedAt: string;      // ISO 8601
  expiresAt: string;      // ISO 8601 (deletedAt + 30 dage)
}

export interface SyncQueueItem {
  id?: number;
  action: 'UPSERT' | 'DELETE' | 'RSVP';
  eventId: string;
  payload: {
    event?: CalendarEvent;
    caldavUrl?: string;
    etag?: string;
    partstat?: RsvpStatus;
  };
  createdAt: string;
}

export interface UndoAction {
  id: string;
  label: string;
  timestamp: string;
  undo: () => Promise<void>;
}

export interface ClipboardState {
  mode: 'COPY' | 'CUT' | null;
  events: CalendarEvent[];
  sourceAnchorDate: string | null; // YYYY-MM-DD for første kopierede event (bruges til multi-dag paste)
  copiedAt: string | null;
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetType: 'EVENT' | 'DATE';
  event?: CalendarEvent | null;
  dateStr?: string | null; // ISO eller YYYY-MM-DD
  allDay?: boolean;
}

export interface AuthSession {
  mode: 'DEMO' | 'CALDAV';
  serverUrl: string;
  username: string;
  password?: string;
  connectedAt: string;
}
