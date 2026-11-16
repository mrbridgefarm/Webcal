import Dexie, { type Table } from 'dexie';
import type {
  CalendarSource,
  CalendarEvent,
  TrashItem,
  SyncQueueItem
} from '../types/calendar';

export class DavSyncDatabase extends Dexie {
  calendars!: Table<CalendarSource, string>;
  events!: Table<CalendarEvent, string>;
  trash!: Table<TrashItem, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super('DavSyncCalDB');

    this.version(1).stores({
      calendars: 'id, name, readOnly, isShared, visible',
      events: 'id, uid, calendarId, start, end, title',
      trash: 'id, deletedAt, expiresAt',
      syncQueue: '++id, action, eventId, createdAt'
    });
  }
}

export const db = new DavSyncDatabase();

/**
 * Rydder automatisk op i papirkurven for elementer, der er ældre end 30 dage.
 */
export async function purgeExpiredTrash(): Promise<number> {
  const nowIso = new Date().toISOString();
  const expired = await db.trash.where('expiresAt').below(nowIso).toArray();
  if (expired.length > 0) {
    await db.trash.bulkDelete(expired.map((item) => item.id));
  }
  return expired.length;
}
