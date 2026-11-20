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
  Share2,
  LogOut,
  Lock,
  X,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Keyboard,
  ShieldCheck,
  Pencil
} from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';
import type { CalendarEvent, CalendarViewType } from '../types/calendar';

const props = defineProps<{
  titleText: string;
  sidebarCollapsed: boolean;
}>();

const emit = defineEmits<{
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'today'): void;
  (e: 'change-view', view: CalendarViewType): void;
  (e: 'jump-to-date', dateIso: string): void;
  (e: 'toggle-sidebar'): void;
}>();

const store = useCalendarStore();
const isSearchFocused = ref(false);
const isHelpOpen = ref(false);

const showSearchDropdown = computed(
  () => isSearchFocused.value && store.searchQuery.trim().length > 0
);

function goToSearchResultDay(ev: CalendarEvent) {
  store.selectedEventIds = [ev.id];
  store.selectedDateStr = ev.start.slice(0, 10);
  emit('jump-to-date', ev.start);
  isSearchFocused.value = false;
}

function editSearchResult(ev: CalendarEvent) {
  store.selectedEventIds = [ev.id];
  store.selectedDateStr = ev.start.slice(0, 10);
  emit('jump-to-date', ev.start);
  store.openEditEventModal(ev);
  isSearchFocused.value = false;
}

function handleSearchBlur() {
  window.setTimeout(() => {
    isSearchFocused.value = false;
  }, 180);
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
  <header class="h-16 bg-slate-900/95 border-b border-slate-800 px-3 sm:px-4 flex items-center justify-between gap-3 select-none z-30">
    <!-- Venstre: Sidebar Toggle, Logo & Kalender-navigation -->
    <div class="flex items-center gap-3">
      <!-- Knap til at klappe sidepanelet ind/ud -->
      <button
        type="button"
        class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
        :title="props.sidebarCollapsed ? 'Vis sidepanel' : 'Skjul sidepanel (mere plads til kalenderen)'"
        @click="emit('toggle-sidebar')"
      >
        <PanelLeftOpen v-if="props.sidebarCollapsed" class="w-4 h-4 text-blue-400" />
        <PanelLeftClose v-else class="w-4 h-4" />
      </button>

      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
          <CalendarIcon class="w-5 h-5" />
        </div>
        <div>
          <div class="font-bold text-slate-100 leading-tight tracking-tight flex items-center gap-2">
            {{ store.isPublicShareMode ? (store.session?.shareLabel || 'Delt Kalender') : 'DAV-Sync Cal' }}
            <span
              v-if="store.isPublicShareMode"
              class="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/30"
            >
              <Lock class="w-2.5 h-2.5" /> Kun visning (Delt link)
            </span>
            <span
              v-else
              class="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border transition-colors"
              :class="store.isOnline
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border-amber-500/30'"
            >
              {{ store.isOnline ? 'Online' : 'Offline' }}
            </span>
          </div>
          <p class="text-[11px] text-slate-400 hidden sm:block">
            {{ store.isPublicShareMode ? `Delt af ${store.session?.username}` : store.session?.username }}
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
          placeholder="Lyn-søg i kalenderen (titel, lokation)..."
          class="w-full pl-9 pr-8 py-1.5 text-sm bg-slate-950/90 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
          @focus="isSearchFocused = true"
          @blur="handleSearchBlur"
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
        <div
          v-for="ev in store.searchResults"
          :key="ev.id"
          class="w-full px-3.5 py-2.5 hover:bg-slate-800/90 flex items-center justify-between gap-2.5 transition cursor-pointer"
          @mousedown.prevent="goToSearchResultDay(ev)"
        >
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :style="{ backgroundColor: store.getCalendarById(ev.calendarId)?.color || '#3b82f6' }"
            ></span>
            <div class="truncate">
              <div class="text-xs font-medium text-slate-100 truncate">{{ ev.title }}</div>
              <div class="text-[11px] text-slate-400 truncate">
                {{ formatShortDateTime(ev) }} • {{ store.getCalendarById(ev.calendarId)?.name }}
                <span v-if="ev.location"> • {{ ev.location }}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              class="px-2 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 border border-blue-500/40 text-blue-300 hover:text-white text-[10.5px] font-semibold transition"
              title="Hop til dagen i kalenderen"
              @mousedown.stop.prevent="goToSearchResultDay(ev)"
            >
              Gå til dag
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[10.5px] font-medium transition"
              title="Åbn og redigér begivenheden"
              @mousedown.stop.prevent="editSearchResult(ev)"
            >
              <Pencil class="w-3 h-3" />
              <span>Redigér</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Højre: Undo (Ctrl+Z), Visningsskift, Del kalender, Hjælp/Genveje, Sync, Log ud & Ny begivenhed -->
    <div class="flex items-center gap-2">
      <!-- Fortryd (Ctrl+Z) - kun når logget ind -->
      <button
        v-if="!store.isPublicShareMode"
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

      <!-- Visningsskift: År / Måned / Uge / Dag / Liste -->
      <div class="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
        <button
          type="button"
          class="px-2.5 py-1 rounded-md font-medium transition"
          :class="store.currentView === 'multiMonthYear' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'"
          @click="emit('change-view', 'multiMonthYear')"
        >
          År
        </button>
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
        <button
          type="button"
          class="px-2.5 py-1 rounded-md font-medium transition"
          :class="store.currentView === 'listMonth' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'"
          @click="emit('change-view', 'listMonth')"
        >
          Liste
        </button>
      </div>

      <!-- Del kalender via offentligt link (kun når logget ind) -->
      <button
        v-if="!store.isPublicShareMode"
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
        title="Del kalender med 3. part via offentligt Read-Only link"
        @click="store.openShareModal()"
      >
        <Share2 class="w-3.5 h-3.5 text-blue-400" />
        <span class="hidden xl:inline">Del kalender</span>
      </button>

      <!-- Hjælp / Hurtige Genveje Popover -->
      <div v-if="!store.isPublicShareMode" class="relative">
        <button
          type="button"
          class="p-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          title="Hurtige genveje & hjælp"
          @click="isHelpOpen = !isHelpOpen"
        >
          <HelpCircle class="w-4 h-4 text-blue-400" />
        </button>

        <!-- Popover med genveje -->
        <div
          v-if="isHelpOpen"
          class="fixed inset-0 z-40"
          @click="isHelpOpen = false"
        ></div>
        <div
          v-if="isHelpOpen"
          class="absolute right-0 mt-2 w-80 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-4 z-50 text-xs space-y-3"
        >
          <div class="flex items-center justify-between border-b border-slate-800 pb-2">
            <span class="flex items-center gap-1.5 font-bold text-slate-100">
              <Keyboard class="w-4 h-4 text-blue-400" />
              Hurtige Genveje &amp; Hjælp
            </span>
            <button
              type="button"
              class="text-slate-400 hover:text-slate-200"
              @click="isHelpOpen = false"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="grid grid-cols-2 gap-y-2 text-[11px] text-slate-300">
            <span>Kopiér begivenhed:</span>
            <kbd class="justify-self-end px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-100 rounded text-[10px] font-semibold">Ctrl + C</kbd>
            <span>Klip begivenhed:</span>
            <kbd class="justify-self-end px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-100 rounded text-[10px] font-semibold">Ctrl + X</kbd>
            <span>Indsæt på valgt dag:</span>
            <kbd class="justify-self-end px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-100 rounded text-[10px] font-semibold">Ctrl + V</kbd>
            <span>Fortryd handling:</span>
            <kbd class="justify-self-end px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-100 rounded text-[10px] font-semibold">Ctrl + Z</kbd>
            <span>Slet til papirkurv:</span>
            <kbd class="justify-self-end px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-100 rounded text-[10px] font-semibold">Delete</kbd>
            <span>Markér flere aftaler:</span>
            <kbd class="justify-self-end px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-100 rounded text-[10px] font-semibold">Ctrl + Klik</kbd>
            <span>Opret / Redigér:</span>
            <span class="justify-self-end text-[10px] text-slate-400">Dobbeltklik</span>
            <span>Kontekstmenu:</span>
            <span class="justify-self-end text-[10px] text-slate-400">Højreklik</span>
          </div>

          <div class="pt-2 border-t border-slate-800 flex items-start gap-2 text-[11px] text-slate-400">
            <ShieldCheck class="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              <strong class="text-slate-200">Mødesikkerhed aktiv:</strong> Møder med andre inviterede deltagere spærres automatisk for <code class="text-slate-300">Ctrl+C</code>.
            </span>
          </div>
        </div>
      </div>

      <!-- Offline / Online & Sync -->
      <button
        type="button"
        class="p-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition flex items-center gap-1.5 text-xs"
        :title="store.isOnline ? 'Online — Klik for at opdatere nu' : 'Offline — Ændringer gemmes i kø i IndexedDB'"
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

      <!-- Log ud (kun når logget ind) -->
      <button
        v-if="!store.isPublicShareMode"
        type="button"
        class="p-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-500/20 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 transition"
        title="Log ud"
        @click="store.logout()"
      >
        <LogOut class="w-4 h-4" />
      </button>

      <!-- Ny begivenhed (kun når logget ind) -->
      <button
        v-if="!store.isPublicShareMode"
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
