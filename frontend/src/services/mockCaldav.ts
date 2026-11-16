import type { CalendarSource, CalendarEvent } from '../types/calendar';

function offsetDateIso(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function offsetDateOnlyIso(dayOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getDemoCalendars(): CalendarSource[] {
  return [
    {
      id: 'demo-work',
      url: 'https://mail.demo.dk/SOGo/dav/carsten/Calendar/personal/',
      name: 'Arbejde & Drift (SOGo)',
      color: '#2563eb',
      serverColor: '#2563eb',
      readOnly: false,
      isShared: false,
      visible: true,
      description: 'Primær arbejdskalender på Mailcow/SOGo'
    },
    {
      id: 'demo-shifts',
      url: 'https://mail.demo.dk/SOGo/dav/carsten/Calendar/shifts/',
      name: 'Vagtplan & Time-blocking',
      color: '#059669',
      serverColor: '#059669',
      readOnly: false,
      isShared: false,
      visible: true,
      description: 'Perfekt til hurtig Ctrl+C / Ctrl+V kopiering på tværs af dage'
    },
    {
      id: 'demo-shared-readonly',
      url: 'https://mail.demo.dk/SOGo/dav/kollega/Calendar/personal/',
      name: 'Team / Familie (Delt - Read-Only)',
      color: '#d97706',
      serverColor: '#d97706',
      readOnly: true,
      isShared: true,
      owner: 'mads@demo.dk',
      visible: true,
      description: 'Delt SOGo kalender med skrivebeskyttelse (Read-Only låst)'
    }
  ];
}

export function getDemoEvents(): CalendarEvent[] {
  return [
    {
      id: 'demo-shifts::shift-1',
      uid: 'shift-1',
      calendarId: 'demo-shifts',
      title: 'Dagvagt (08:00 - 16:00)',
      start: offsetDateIso(0, 8, 0),
      end: offsetDateIso(0, 16, 0),
      allDay: false,
      location: 'Hovedkontor / Drift',
      description: 'Standard dagvagt — prøv at markere denne og tryk Ctrl+C, klik derefter på en anden dag og tryk Ctrl+V!',
      attendees: [],
      reminderMinutes: 15,
      timezone: 'Europe/Copenhagen'
    },
    {
      id: 'demo-shifts::focus-1',
      uid: 'focus-1',
      calendarId: 'demo-shifts',
      title: 'Deep Work: Docker & Infrastruktur',
      start: offsetDateIso(1, 9, 0),
      end: offsetDateIso(1, 12, 0),
      allDay: false,
      location: 'Hjemmekontor',
      description: 'Time-blocking blok uden eksterne deltagere (kan frit kopieres med Ctrl+C / Ctrl+V).',
      attendees: [],
      reminderMinutes: 10,
      timezone: 'Europe/Copenhagen'
    },
    {
      id: 'demo-work::meeting-invite-1',
      uid: 'meeting-invite-1',
      calendarId: 'demo-work',
      title: 'Arkitektur-gennemgang: Mailcow & CalDAV',
      start: offsetDateIso(0, 10, 0),
      end: offsetDateIso(0, 11, 30),
      allDay: false,
      location: 'Mødelokale B / Online',
      videoUrl: 'https://meet.google.com/abc-defg-hij',
      description: 'Vigtigt møde med inviterede deltagere. Bemærk: Ctrl+C er spærret her pga. mødesikkerhed (undgår utilsigtet mødespam), og der er kollision med Dagvagten!',
      organizer: 'anne@demo.dk',
      attendees: [
        {
          email: 'anne@demo.dk',
          name: 'Anne (Arrangør)',
          partstat: 'ACCEPTED',
          isOrganizer: true
        },
        {
          email: 'carsten@demo.dk',
          name: 'Carsten',
          partstat: 'NEEDS-ACTION'
        },
        {
          email: 'mads@demo.dk',
          name: 'Mads',
          partstat: 'TENTATIVE'
        }
      ],
      reminderMinutes: 15,
      timezone: 'Europe/Copenhagen'
    },
    {
      id: 'demo-shared-readonly::shared-1',
      uid: 'shared-1',
      calendarId: 'demo-shared-readonly',
      title: 'Mads: Server-vedligeholdelse (Read-Only)',
      start: offsetDateIso(2, 13, 0),
      end: offsetDateIso(2, 15, 0),
      allDay: false,
      location: 'Datacenter VM-01',
      description: 'Fra delt Read-Only SOGo kalender. Kan ikke flyttes, slettes eller redigeres.',
      attendees: [],
      timezone: 'Europe/Copenhagen'
    },
    {
      id: 'demo-work::release-allday',
      uid: 'release-allday',
      calendarId: 'demo-work',
      title: ' Produktions-deploy på VM (x86/ARM)',
      start: offsetDateOnlyIso(3),
      end: offsetDateOnlyIso(4),
      allDay: true,
      location: 'GitHub -> Docker VM',
      description: 'Heldagsbegivenhed for udrulning af DAV-Sync Cal.',
      attendees: [],
      timezone: 'Europe/Copenhagen'
    }
  ];
}
