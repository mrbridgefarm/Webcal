<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type {
  CalendarOptions,
  EventClickArg,
  EventDropArg
} from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import { Lock, Users, AlertTriangle, Video, Check, Copy, Scissors } from 'lucide-vue-next';
import { useCalendarStore, toDateOnlyString } from '../stores/calendarStore';
import type { CalendarEvent } from '../types/calendar';

const emit = defineEmits<{
  (e: 'title-change', title: string): void;
}>();

const store = useCalendarStore();
const calendarRef = ref<InstanceType<typeof FullCalendar> | null>(null);
const gridContainerRef = ref<HTMLElement | null>(null);
let lastClickTime = 0;
let lastClickedId = '';

const fcEvents = computed(() =>
  store.visibleEvents.map((ev) => {
    const cal = store.getCalendarById(ev.calendarId);
    const isSelected = store.selectedEventIds.includes(ev.id);
    const isInClipboard = store.clipboardEventIds.has(ev.id);
    const clipboardMode = isInClipboard ? store.clipboard.mode : null;
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
        : isInClipboard
          ? '#34d399'
          : isCollision
            ? '#f59e0b'
            : cal?.color || '#2563eb',
      classNames: [
        isSelected ? 'dav-event-selected' : '',
        isInClipboard && clipboardMode === 'COPY' ? 'dav-event-copied' : '',
        isInClipboard && clipboardMode === 'CUT' ? 'dav-event-cut' : '',
        isCollision ? 'dav-event-collision' : '',
        isReadOnly ? 'dav-event-readonly' : ''
      ].filter(Boolean),
      extendedProps: {
        eventId: ev.id,
        rawEvent: ev,
        isSelected,
        isInClipboard,
        clipboardMode,
        isCollision,
        isReadOnly,
        hasGuests,
        calendarName: cal?.name || ''
      }
    };
  })
);

/**
 * Markerer visuelt den aktuelt valgte mål-dato (store.selectedDateStr) i FullCalendar DOM'en
 */
function updateSelectedDayHighlight() {
  if (!gridContainerRef.value) return;
  const targetYmd = (store.selectedDateStr || '').slice(0, 10);
  const dayEls = gridContainerRef.value.querySelectorAll<HTMLElement>('.fc-daygrid-day, .fc-timegrid-col');
  dayEls.forEach((el) => {
    const d = el.getAttribute('data-date');
    if (d && d === targetYmd) {
      el.classList.add('dav-day-selected');
    } else {
      el.classList.remove('dav-day-selected');
    }
  });
}

watch(
  () => store.selectedDateStr,
  () => {
    void nextTick(updateSelectedDayHighlight);
  }
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

  const evId = arg.event.id;
  const ev = store.events.find((e) => e.id === evId) || (arg.event.extendedProps.rawEvent as CalendarEvent);
  if (!ev) return;

  store.selectedDateStr = toDateOnlyString(new Date(ev.start));

  if (arg.jsEvent.ctrlKey || arg.jsEvent.metaKey || arg.jsEvent.shiftKey) {
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

/**
 * Delegated højrekliks-handler på hele kalendergitteret.
 * Virker 100% stabilt både på begivenheder, i "+ X flere"-popovers og på tomme datoer i Måned/Uge/Dag.
 */
function handleGridContextMenu(e: MouseEvent) {
  e.preventDefault();
  const target = e.target as HTMLElement | null;
  if (!target) return;

  // 1. Tjek om brugeren højreklikkede på en begivenhed
  const eventContentEl = target.closest<HTMLElement>('[data-dav-event-id]');
  if (eventContentEl) {
    const evId = eventContentEl.getAttribute('data-dav-event-id');
    const ev = evId ? store.events.find((item) => item.id === evId) : undefined;
    if (ev) {
      if (!store.selectedEventIds.includes(ev.id)) {
        store.selectedEventIds = [ev.id];
      }
      store.selectedDateStr = toDateOnlyString(new Date(ev.start));
      store.openContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetType: 'EVENT',
        event: ev,
        dateStr: toDateOnlyString(new Date(ev.start))
      });
      return;
    }
  }

  // 2. Ellers tjek hvilken dato-celle/kolonne der blev højreklikket på
  const dateEl = target.closest<HTMLElement>('[data-date]');
  const dateStr = dateEl?.getAttribute('data-date') || store.selectedDateStr;
  if (dateStr) {
    store.selectedDateStr = dateStr;
  }

  store.openContextMenu({
    x: e.clientX,
    y: e.clientY,
    targetType: 'DATE',
    event: null,
    dateStr: dateStr || store.selectedDateStr,
    allDay: true
  });
}

async function handleEventDrop(arg: EventDropArg) {
  const ev = store.events.find((e) => e.id === arg.event.id) || (arg.event.extendedProps.rawEvent as CalendarEvent);
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
  const ev = store.events.find((e) => e.id === arg.event.id) || (arg.event.extendedProps.rawEvent as CalendarEvent);
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

const calendarOptions = computed<CalendarOptions>(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  initialView: store.currentView,
  locale: 'da',
  firstDay: 1,
  headerToolbar: false,
  height: '100%',
  dayMaxEvents: 7,
  moreLinkText: (num: number) => `+ ${num} flere`,
  navLinks: false,
  editable: true,
  selectable: false,
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
  datesSet: (info) => {
    emit('title-change', info.view.title);
    void nextTick(updateSelectedDayHighlight);
  }
}));

function goPrev() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.prev();
    emit('title-change', api.view.title);
    void nextTick(updateSelectedDayHighlight);
  }
}

function goNext() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.next();
    emit('title-change', api.view.title);
    void nextTick(updateSelectedDayHighlight);
  }
}

function goToday() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.today();
    store.selectedDateStr = toDateOnlyString(new Date());
    emit('title-change', api.view.title);
    void nextTick(updateSelectedDayHighlight);
  }
}

function changeView(viewName: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay') {
  store.currentView = viewName;
  const api = calendarRef.value?.getApi();
  if (api) {
    api.changeView(viewName);
    emit('title-change', api.view.title);
    void nextTick(updateSelectedDayHighlight);
  }
}

function jumpToDate(dateIso: string) {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.gotoDate(dateIso);
    emit('title-change', api.view.title);
    void nextTick(updateSelectedDayHighlight);
  }
}

onMounted(() => {
  const api = calendarRef.value?.getApi();
  if (api) {
    emit('title-change', api.view.title);
  }
  void nextTick(updateSelectedDayHighlight);
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
    ref="gridContainerRef"
    class="flex-1 h-full bg-slate-950 p-3 overflow-hidden relative"
    @click="store.closeContextMenu()"
    @contextmenu="handleGridContextMenu"
  >
    <!-- Valgt mål-dato & markering i toppen af gitteret -->
    <div class="mb-2 flex items-center justify-between text-xs px-1 text-slate-400">
      <div class="flex items-center gap-3 flex-wrap">
        <span>
          Aktiv mål-dato (<kbd class="px-1 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Ctrl+V</kbd>):
          <strong class="text-blue-400 font-semibold ml-1">{{ store.selectedDateStr.slice(0, 10) }}</strong>
        </span>
        <span
          v-if="store.selectedEventIds.length > 0"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 font-medium text-[11px]"
        >
          <Check class="w-3 h-3" />
          {{ store.selectedEventIds.length }} begivenhed(er) valgt — tryk Ctrl+C for at kopiere
        </span>
        <span
          v-if="store.clipboard.events.length > 0"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-[11px]"
        >
          <Copy v-if="store.clipboard.mode === 'COPY'" class="w-3 h-3" />
          <Scissors v-else class="w-3 h-3" />
          {{ store.clipboard.events.length }} i udklipsholder ({{ store.clipboard.events[0]?.title }})
        </span>
      </div>
      <div class="hidden xl:flex items-center gap-4 text-[11px]">
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
            :data-dav-event-id="arg.event.id"
            class="w-full px-1.5 py-0.5 flex items-center justify-between gap-1 overflow-hidden text-[11px] leading-tight cursor-pointer select-none"
            :title="`${arg.event.title}${arg.event.extendedProps.isInClipboard ? ' (I UDKLIPSHOLDER)' : ''}${arg.event.extendedProps.isCollision ? ' (KOLLISION!)' : ''}${arg.event.extendedProps.hasGuests ? ' (Har mødedeltagere - Ctrl+C spærret)' : ''}`"
          >
            <div class="flex items-center gap-1 min-w-0 truncate">
              <span
                v-if="arg.event.extendedProps.isInClipboard"
                class="px-1 py-0.2 rounded bg-black/40 text-emerald-300 text-[9px] font-bold uppercase shrink-0"
              >
                {{ arg.event.extendedProps.clipboardMode === 'CUT' ? 'KLIP' : 'KOPI' }}
              </span>
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
