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
import { Lock, Users, Video, Check, Copy, Scissors } from 'lucide-vue-next';
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
    const calColor = cal?.color || '#06b6d4';
    const isSelected = store.selectedEventIds.includes(ev.id);
    const isInClipboard = store.clipboardEventIds.has(ev.id);
    const clipboardMode = isInClipboard ? store.clipboard.mode : null;
    const isReadOnly = store.isPublicShareMode || Boolean(cal?.readOnly);
    const hasGuests = store.hasInvitedAttendees(ev);

    return {
      id: ev.id,
      title: ev.title,
      start: ev.start,
      end: ev.end,
      allDay: ev.allDay,
      display: 'block',
      editable: !isReadOnly,
      startEditable: !isReadOnly,
      durationEditable: !isReadOnly,
      backgroundColor: calColor,
      borderColor: isSelected
        ? '#f8fafc'
        : isInClipboard
          ? '#34d399'
          : calColor,
      textColor: '#ffffff',
      classNames: [
        'dav-event-box',
        isSelected ? 'dav-event-selected' : '',
        isInClipboard && clipboardMode === 'COPY' ? 'dav-event-copied' : '',
        isInClipboard && clipboardMode === 'CUT' ? 'dav-event-cut' : '',
        isReadOnly ? 'dav-event-readonly' : ''
      ].filter(Boolean),
      extendedProps: {
        eventId: ev.id,
        rawEvent: ev,
        calColor,
        isSelected,
        isInClipboard,
        clipboardMode,
        isReadOnly,
        hasGuests,
        calendarName: cal?.name || ''
      }
    };
  })
);

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

  if (store.isPublicShareMode) return;

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

  if (store.isPublicShareMode) {
    store.openEditEventModal(ev);
    return;
  }

  if (arg.jsEvent.ctrlKey || arg.jsEvent.metaKey || arg.jsEvent.shiftKey) {
    if (store.selectedEventIds.includes(ev.id)) {
      store.selectedEventIds = store.selectedEventIds.filter((id) => id !== ev.id);
    } else {
      store.selectedEventIds = [...store.selectedEventIds, ev.id];
    }
    return;
  }

  store.selectedEventIds = [ev.id];

  const now = Date.now();
  if (now - lastClickTime < 350 && lastClickedId === `ev:${ev.id}`) {
    store.openEditEventModal(ev);
  }
  lastClickTime = now;
  lastClickedId = `ev:${ev.id}`;
}

function handleGridContextMenu(e: MouseEvent) {
  if (store.isPublicShareMode) return;
  e.preventDefault();
  const target = e.target as HTMLElement | null;
  if (!target) return;

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
      'Du kan ikke flytte begivenheder i en skrivebeskyttet kalender.',
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
      'Du kan ikke ændre varighed i en skrivebeskyttet kalender.',
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
  expandRows: true,
  fixedWeekCount: false,
  // Kravspecifikation: Plads til op til 7 synlige begivenheder pr. dag, derefter "+ X flere"
  dayMaxEvents: 7,
  // Tvinger ALLE aftaler (både tidsbestemte og heldags) til at vises med en tydelig farvet kasse rundt om
  eventDisplay: 'block',
  moreLinkText: (num: number) => `+ ${num} flere`,
  navLinks: false,
  editable: !store.isPublicShareMode,
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

function updateSize() {
  const api = calendarRef.value?.getApi();
  if (api) {
    api.updateSize();
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
  jumpToDate,
  updateSize
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
    <div v-if="!store.isPublicShareMode" class="mb-2 flex items-center justify-between text-xs px-1 text-slate-400">
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

      <!-- Hurtig farve-forklaring over synlige kalendere -->
      <div class="hidden md:flex items-center gap-3 text-[11px] overflow-x-auto">
        <span
          v-for="cal in store.visibleCalendars"
          :key="cal.id"
          class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-slate-200 font-medium shrink-0"
        >
          <span
            class="w-2.5 h-2.5 rounded-sm shrink-0"
            :style="{ backgroundColor: cal.color }"
          ></span>
          <span class="truncate max-w-[120px]">{{ cal.name }}</span>
        </span>
      </div>
    </div>

    <div
      :class="store.isPublicShareMode ? 'h-full' : 'h-[calc(100%-28px)]'"
      class="rounded-2xl overflow-hidden border border-slate-800 bg-slate-900/50 shadow-inner"
    >
      <FullCalendar ref="calendarRef" :options="calendarOptions">
        <template #eventContent="arg">
          <div
            :data-dav-event-id="arg.event.id"
            class="w-full px-1.5 py-[1px] flex items-center justify-between gap-1 overflow-hidden text-[10.5px] leading-[14px] cursor-pointer select-none rounded-[4px]"
            :style="{
              backgroundColor: arg.event.extendedProps.calColor || '#06b6d4',
              borderLeft: '3px solid rgba(255, 255, 255, 0.5)',
              boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.18)'
            }"
            :title="`${arg.event.title} — Kalender: ${arg.event.extendedProps.calendarName}${arg.event.extendedProps.isInClipboard ? ' (I UDKLIPSHOLDER)' : ''}${arg.event.extendedProps.hasGuests ? ' (Har mødedeltagere - Ctrl+C spærret)' : ''}`"
          >
            <div class="flex items-center gap-1 min-w-0 truncate text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
              <span
                v-if="arg.event.extendedProps.isInClipboard"
                class="px-1 py-0.2 rounded bg-black/50 text-emerald-300 text-[9px] font-bold uppercase shrink-0"
              >
                {{ arg.event.extendedProps.clipboardMode === 'CUT' ? 'KLIP' : 'KOPI' }}
              </span>
              <span v-if="arg.timeText" class="font-bold opacity-95 shrink-0">
                {{ arg.timeText }}
              </span>
              <span class="font-semibold truncate">{{ arg.event.title }}</span>
            </div>

            <div class="flex items-center gap-0.5 shrink-0 text-white/90">
              <Video
                v-if="arg.event.extendedProps.rawEvent?.videoUrl"
                class="w-3 h-3"
              />
              <Users
                v-if="arg.event.extendedProps.hasGuests"
                class="w-3 h-3"
              />
              <Lock
                v-if="arg.event.extendedProps.isReadOnly && !store.isPublicShareMode"
                class="w-3 h-3"
              />
            </div>
          </div>
        </template>
      </FullCalendar>
    </div>
  </div>
</template>
