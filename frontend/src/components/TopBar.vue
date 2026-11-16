<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Search,
  Undo2,
  RefreshCw,
  Wifi,
  WifiOff,
  Plus,
  Server,
  X,
  AlertTriangle
} from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';
import type { CalendarEvent } from '../types/calendar';

const props = defineProps<{
  titleText: string;
}>();

const emit = defineEmits<{
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'today'): void;
  (e: 'change-view', view: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'): void;
  (e: 'jump-to-date', dateIso: string): void;
}>();

const store = useCalendarStore();
const isSearchFocused = ref(false);

const showSearchDropdown = computed(
  () => isSearchFocused.value && store.searchQuery.trim().length > 0
);

function selectSearchResult(ev: CalendarEvent) {
  store.selectedEventIds = [ev.id];
  store.selectedDateStr = ev.start.slice(0, 10);
  emit('jump-to-date', ev.start);
  store.openEditEventModal(ev);
  isSearchFocused.value = false;
}

function formatShortDateTime(ev: CalendarEvent): string {
  const dt = new Date(ev.start);
  if (ev.allDay) {
    return dt.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' }) + ' (Heldag)';
  }
  return dt.toLocaleString('da-DK', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}
</script>

<template>
  <header class="h-16 bg-slate-900/95 border-b border-slate-800 px-4 flex items-center justify-between gap-4 select-none z-30">
    <!-- Venstre: Logo & Kalender-navigation -->
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
          <CalendarIcon class="w-5 h-5" />
        </div>
        <div>
          <div class="font-bold text-slate-100 leading-tight tracking-tight flex items-center gap-2">
            DAV-Sync Cal
            <span
              class="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border"
              :class="store.session?.mode === 'CALDAV'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'"
            >
              {{ store.session?.mode === 'CALDAV' ? 'Mailcow Live' : 'Demo / Mock' }}
            </span>
          </div>
          <p class="text-[11px] text-slate-400 hidden sm:block">
            Tastatur-venlig SOGo &amp; CalDAV Webkalender
          </p>
        </div>
      </div>

      <div class="h-6 w-px bg-slate-800 hidden md:block"></div>

      <!-- I dag & frem/tilbage -->
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          @click="emit('today')"
        >
          I dag
        </button>
        <div class="flex items-center bg-slate-800/80 rounded-lg border border-slate-700/80 p-0.5">
          <button
            type="button"
            class="p-1.5 rounded-md hover:bg-slate-700 text-slate-300 transition"
            title="Forrige periode"
            @click="emit('prev')"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <button
            type="button"
            class="p-1.5 rounded-md hover:bg-slate-700 text-slate-300 transition"
            title="Næste periode"
            @click="emit('next')"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>
        <h1 class="text-base sm:text-lg font-semibold text-slate-100 capitalize ml-2 min-w-[140px]">
          {{ props.titleText }}
        </h1>
      </div>
    </div>

    <!-- Midt: Øjeblikkelig Lokal Søgning -->
    <div class="relative flex-1 max-w-md">
      <div class="relative flex items-center">
        <Search class="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          v-model="store.searchQuery"
          type="text"
          placeholder="Lyn-søg i lokalt indeks (titel, lokation, deltagere)..."
          class="w-full pl-9 pr-8 py-1.5 text-sm bg-slate-950/90 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
          @focus="isSearchFocused = true"
          @blur="setTimeout(() => (isSearchFocused = false), 180)"
        />
        <button
          v-if="store.searchQuery"
          type="button"
          class="absolute right-2.5 text-slate-400 hover:text-slate-200"
          @click="store.searchQuery = ''"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Søgeresultater Dropdown -->
      <div
        v-if="showSearchDropdown"
        class="absolute left-0 right-0 mt-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-80 overflow-y-auto z-50 divide-y divide-slate-800/80"
      >
        <div
          v-if="store.searchResults.length === 0"
          class="p-4 text-xs text-slate-400 text-center"
        >
          Ingen begivenheder matcher "{{ store.searchQuery }}"
        </div>
        <button
          v-for="ev in store.searchResults"
          :key="ev.id"
          type="button"
          class="w-full text-left px-3.5 py-2.5 hover:bg-slate-800/90 flex items-center justify-between gap-3 transition"
          @mousedown.prevent="selectSearchResult(ev)"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :style="{ backgroundColor: store.getCalendarById(ev.calendarId)?.color || '#3b82f6' }"
            ></span>
            <div class="truncate">
              <div class="text-xs font-medium text-slate-100 truncate">{{ ev.title }}</div>
              <div class="text-[11px] text-slate-400 truncate">
                {{ store.getCalendarById(ev.calendarId)?.name }}
                <span v-if="ev.location"> • {{ ev.location }}</span>
              </div>
            </div>
          </div>
          <span class="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
            {{ formatShortDateTime(ev) }}
          </span>
        </button>
      </div>
    </div>

    <!-- Højre: Kollisioner, Undo (Ctrl+Z), Visningsskift, Sync & Ny begivenhed -->
    <div class="flex items-center gap-2">
      <!-- Kollisions-indikator -->
      <div
        v-if="store.collisionEventIds.size > 0"
        class="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium"
        title="Der er overlappende begivenheder på tværs af dine synlige kalendere"
      >
        <AlertTriangle class="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>{{ store.collisionEventIds.size }} kollisioner</span>
      </div>

      <!-- Fortryd (Ctrl+Z) -->
      <button
        type="button"
        :disabled="store.undoStack.length === 0"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
        title="Fortryd seneste handling (Ctrl+Z)"
        @click="store.triggerUndo()"
      >
        <Undo2 class="w-3.5 h-3.5" />
        <span class="hidden lg:inline">Fortryd</span>
        <span
          v-if="store.undoStack.length > 0"
          class="px-1.5 py-0.2 rounded-full bg-blue-500/30 text-blue-300 text-[10px]"
        >
          {{ store.undoStack.length }}
        </span>
      </button>

      <!-- Visningsskift: Måned / Uge / Dag -->
      <div class="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
        <button
          type="button"
          class="px-2.5 py-1 rounded-md font-medium transition"
          :class="store.currentView === 'dayGridMonth' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'"
          @click="emit('change-view', 'dayGridMonth')"
        >
          Måned
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded-md font-medium transition"
          :class="store.currentView === 'timeGridWeek' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'"
          @click="emit('change-view', 'timeGridWeek')"
        >
          Uge
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded-md font-medium transition"
          :class="store.currentView === 'timeGridDay' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'"
          @click="emit('change-view', 'timeGridDay')"
        >
          Dag
        </button>
      </div>

      <!-- Offline / Online & Sync -->
      <button
        type="button"
        class="p-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1.5 text-xs"
        :title="store.isOnline ? 'Online — Klik for at synkronisere nu' : 'Offline — Ændringer gemmes i kø i IndexedDB'"
        @click="store.syncWithServer(false)"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin text-blue-400': store.isSyncing }" />
        <Wifi v-if="store.isOnline" class="w-3.5 h-3.5 text-emerald-400" />
        <WifiOff v-else class="w-3.5 h-3.5 text-amber-400" />
        <span
          v-if="store.syncQueue.length > 0"
          class="px-1.5 rounded-full bg-amber-500/30 text-amber-300 text-[10px]"
        >
          {{ store.syncQueue.length }}
        </span>
      </button>

      <!-- Server / Login indstillinger -->
      <button
        type="button"
        class="p-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
        title="Mailcow / SOGo Server & Login"
        @click="store.isLoginModalOpen = true"
      >
        <Server class="w-4 h-4" />
      </button>

      <!-- Ny begivenhed -->
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition"
        @click="store.openCreateEventModal()"
      >
        <Plus class="w-4 h-4" />
        <span class="hidden sm:inline">Ny begivenhed</span>
      </button>
    </div>
  </header>
</template>
