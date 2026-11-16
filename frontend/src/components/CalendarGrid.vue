<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {
  CalendarOptions,
  EventClickArg,
  EventDropArg,
  EventMountArg,
  DayCellMountArg
} from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import { Lock, Users, AlertTriangle, Video } from 'lucide-vue-next';
import { useCalendarStore, toDateOnlyString } from '../stores/calendarStore';
import type { CalendarEvent } from '../types/calendar';

const emit = defineEmits<{
  (e: 'title-change', title: string): void;
}>();

const store = useCalendarStore();
const calendarRef = ref<InstanceType<typeof FullCalendar> | null>(null);
let lastClickTime = 0;
let lastClickedId = '';

const fcEvents = computed(() =>
  store.visibleEvents.map((ev) => {
    const cal = store.getCalendarById(ev.calendarId);
    const isSelected = store.selectedEventIds.includes(ev.id);
    const isCollision = store.collisionEventIds.has(ev.id);
    const isReadOnly = Boolean(cal?.readOnly);
    const hasGuests = store.hasInvitedAttendees(ev);

    return {
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      editable: !isReadOnly,
      startEditable: !isReadOnly,
      durationEditable: !isReadOnly,
      backgroundColor: cal?.color || '#2563eb',
      borderColor: isSelected
        ? '#f8fafc'
        : isCollision
          ? '#f59e0b'
          : cal?.color || '#2563eb',
      classNames: [
        isSelected ? 'dav-event-selected' : '',
        isCollision ? 'dav-event-collision' : '',
        isReadOnly ? 'dav-event-readonly' : ''
      ].filter(Boolean),
      extendedProps: {
        rawEvent: ev,
        isSelected,
        isCollision,
        isReadOnly,
        hasGuests,
        calendarName: cal?.name || ''
      }
    };
  })
);

function handleDateClick(arg: DateClickArg) {
  store.closeContextMenu();
  const clickedDateStr = arg.allDay ? toDateOnlyString(arg.date) : arg.dateStr;
  store.selectedDateStr = clickedDateStr;
  store.selectedEventIds = [];

  // Dobbeltklik på dato/tidsslot åbner "Ny begivenhed"-modal
  const now = Date.now();
  if (now - lastClickTime < 320 && lastClickedId === `date:${clickedDateStr}`) {
    store.openCreateEventModal(clickedDateStr, arg.allDay);
  }
  lastClickTime = now;
  lastClickedId = `date:${clickedDateStr}`;
}

function handleEventClick(arg: EventClickArg) {
  arg.jsEvent.stopPropagation();
  store.closeContextMenu();

  const ev = arg.event.extendedProps.rawEvent as CalendarEvent;
  if (!ev) return;

  store.selectedDateStr = ev.start.slice(0, 10);

  if (arg.jsEvent.ctrlKey || arg.jsEvent.metaKey || arg.jsEvent.shiftKey) {
    // Multi-select med Ctrl / Shift
    if (store.selectedEventIds.includes(ev.id)) {
      store.selectedEventIds = store.selectedEventIds.filter((id) => id !== ev.id);
    } else {
      store.selectedEventIds = [...store.selectedEventIds, ev.id];
    }
    return;
  }

  store.selectedEventIds = [ev.id];

  // Dobbeltklik på begivenhed åbner redigeringsmodal
  const now = Date.now();
  if (now - lastClickTime < 350 && lastClickedId === `ev:${ev.id}`) {
    store.openEditEventModal(ev);
  }
  lastClickTime = now;
  lastClickedId = `ev:${ev.id}`;
}

async function handleEventDrop(arg: EventDropArg) {
  const ev = arg.event.extendedProps.rawEvent as CalendarEvent;
  if (!ev || store.isCalendarReadOnly(ev.calendarId)) {
    arg.revert();
    store.notify(
      'Skrivebeskyttet kalender (Read-Only)',
      'Du kan ikke flytte begivenheder i en delt Read-Only kalender.',
      'error'
    );
    return;
  }

  const newStart = arg.event.start
    ? arg.event.allDay
      ? toDateOnlyString(arg.event.start)
      : arg.event.start.toISOString()
    : ev.start;
  const newEnd = arg.event.end
    ? arg.event.allDay
      ? toDateOnlyString(arg.event.end)
      : arg.event.end.toISOString()
    : newStart;

  await store.saveEvent({
    ...ev,
    start: newStart,
    end: newEnd,
    allDay: arg.event.allDay
  });
}

async function handleEventResize(arg: EventResizeDoneArg) {
  const ev = arg.event.extendedProps.rawEvent as CalendarEvent;
  if (!ev || store.isCalendarReadOnly(ev.calendarId)) {
    arg.revert();
    store.notify(
      'Skrivebeskyttet kalender (Read-Only)',
      'Du kan ikke ændre varighed i en delt Read-Only kalender.',
      'error'
    );
    return;
  }

  const newStart = arg.event.start
    ? arg.event.allDay
      ? toDateOnlyString(arg.event.start)
      : arg.event.start.toISOString()
    : ev.start;
  const newEnd = arg.event.end
    ? arg.event.allDay
      ? toDateOnlyString(arg.event.end)
      : arg.event.end.toISOString()
    : ev.end;

  await store.saveEvent({
    ...ev,
    start: newStart,
    end: newEnd
  });
}

function handleEventDidMount(arg: EventMountArg) {
  const ev = arg.event.extendedProps.rawEvent as CalendarEvent;
  if (!ev) return;

  arg.el.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!store.selectedEventIds.includes(ev.id)) {
      store.selectedEventIds = [ev.id];
    }
    store.selectedDateStr = ev.start.slice(0, 10);

    store.openContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetType: 'EVENT',
      event: ev,
      dateStr: ev.start
    });
  });
}

function handleDayCellDidMount(arg: DayCellMountArg) {
  const dateStr = toDateOnlyString(arg.date);
  arg.el.dataset.dateStr = dateStr;

  arg.el.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    store.selectedDateStr = dateStr;
    store.openContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetType: 'DATE',
      event: null,
      dateStr,
      allDay: true
    });
  });
}

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  initialView: store.currentView,
  locale: 'da',
  firstDay: 1, // Mandag som ugens første dag
  headerToolbar: false,
  height: '100%',
  dayMaxEvents: 7, // Kravspecifikation: Plads til op til 7 synlige begivenheder pr. dag (+ X flere popover)
  moreLinkText: (num: number) => `+ ${num} flere`,
  navLinks: false,
  editable: true,
  selectable: true,
  selectMirror: true,
  nowIndicator: true,
  slotMinTime: '06:00:00',
  slotMaxTime: '23:00:00',
  allDayText: 'Heldag',
  eventTimeFormat: {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  },
  slotLabelFormat: {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  },
  events: fcEvents.value,
  dateClick: handleDateClick,
  eventClick: handleEventClick,
  eventDrop: handleEventDrop,
  eventResize: handleEventResize,
  eventDidMount: handleEventDidMount,
  dayCellDidMount: handleDayCellDidMount,
  datesSet: (info) => {
    emit('title-change', info.view.title);
  }
}));

// Eksponér navigationsmetoder til App.vue / TopBar.vue
function goPrev() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.prev();
    emit('title-change', api.view.title);
  }
}

function goNext() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.next();
    emit('title-change', api.view.title);
  }
}

function goToday() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.today();
    store.selectedDateStr = toDateOnlyString(new Date());
    emit('title-change', api.view.title);
  }
}

function changeView(viewName: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay') {
  store.currentView = viewName;
  const api = calendarRef.value?.getApi();
  if (api) {
    api.changeView(viewName);
    emit('title-change', api.view.title);
  }
}

function jumpToDate(dateIso: string) {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.gotoDate(dateIso);
    emit('title-change', api.view.title);
  }
}

onMounted(() => {
  const api = calendarRef.value?.getApi();
  if (api) {
    emit('title-change', api.view.title);
  }
});

defineExpose({
  goPrev,
  goNext,
  goToday,
  changeView,
  jumpToDate
});
</script>

<template>
  <div
    class="flex-1 h-full bg-slate-950 p-3 overflow-hidden relative"
    @click="store.closeContextMenu()"
  >
    <!-- Valgt mål-dato indikator i toppen af gitteret -->
    <div class="mb-2 flex items-center justify-between text-xs px-1 text-slate-400">
      <div class="flex items-center gap-3">
        <span>
          Aktiv mål-dato (<kbd class="px-1 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Ctrl+V</kbd>):
          <strong class="text-blue-400 font-semibold ml-1">{{ store.selectedDateStr }}</strong>
        </span>
        <span v-if="store.selectedEventIds.length > 0" class="text-emerald-400 font-medium">
          • {{ store.selectedEventIds.length }} begivenhed(er) markeret (Dobbeltklik for at åbne / Højreklik for menu)
        </span>
      </div>
      <div class="hidden md:flex items-center gap-4 text-[11px]">
        <span class="flex items-center gap-1 text-amber-300">
          <AlertTriangle class="w-3.5 h-3.5" /> Kollision
        </span>
        <span class="flex items-center gap-1 text-slate-300">
          <Users class="w-3.5 h-3.5 text-purple-300" /> Møde m/ deltagere (Ctrl+C låst)
        </span>
        <span class="flex items-center gap-1 text-slate-300">
          <Lock class="w-3.5 h-3.5 text-amber-400" /> Read-Only
        </span>
      </div>
    </div>

    <div class="h-[calc(100%-28px)] rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/50 shadow-inner">
      <FullCalendar ref="calendarRef" :options="calendarOptions">
        <template #eventContent="arg">
          <div
            class="w-full px-1.5 py-0.5 flex items-center justify-between gap-1 overflow-hidden text-[11px] leading-tight cursor-pointer"
            :title="`${arg.event.title}${arg.event.extendedProps.isCollision ? ' (KOLLISION!)' : ''}${arg.event.extendedProps.hasGuests ? ' (Har mødedeltagere - Ctrl+C spærret)' : ''}`"
          >
            <div class="flex items-center gap-1 min-w-0 truncate">
              <span v-if="arg.timeText" class="font-semibold opacity-90 shrink-0">
                {{ arg.timeText }}
              </span>
              <span class="font-medium truncate">{{ arg.event.title }}</span>
            </div>

            <div class="flex items-center gap-0.5 shrink-0">
              <AlertTriangle
                v-if="arg.event.extendedProps.isCollision"
                class="w-3 h-3 text-amber-300 drop-shadow"
              />
              <Video
                v-if="arg.event.extendedProps.rawEvent?.videoUrl"
                class="w-3 h-3 text-sky-200"
              />
              <Users
                v-if="arg.event.extendedProps.hasGuests"
                class="w-3 h-3 text-purple-200"
              />
              <Lock
                v-if="arg.event.extendedProps.isReadOnly"
                class="w-3 h-3 text-amber-200"
              />
            </div>
          </div>
        </template>
      </FullCalendar>
    </div>
  </div>
</template>
