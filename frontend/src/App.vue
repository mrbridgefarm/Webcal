<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import CalendarGrid from './components/CalendarGrid.vue';
import ContextMenu from './components/ContextMenu.vue';
import EventModal from './components/EventModal.vue';
import TrashModal from './components/TrashModal.vue';
import LoginModal from './components/LoginModal.vue';
import { useCalendarStore } from './stores/calendarStore';
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-vue-next';

const store = useCalendarStore();
const calendarGridRef = ref<InstanceType<typeof CalendarGrid> | null>(null);
const currentTitle = ref('');

function isTypingInInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

/**
 * Globale tastatur-listeners til "Drysset":
 * - Ctrl+C: Kopiér valgt(e) begivenhed(er) eller dag (spærres hvis mødet har deltagere)
 * - Ctrl+X: Klip valgt(e) begivenhed(er)
 * - Ctrl+V: Indsæt på den valgte mål-dato (låses hvis mål-kalenderen er Read-Only)
 * - Ctrl+Z: Fortryd seneste handling lokalt
 * - Delete / Backspace: Slet valgt(e) begivenhed(er) til 30-dages papirkurv
 * - Escape: Luk åbne menuer/modaler
 */
function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    store.closeContextMenu();
    if (store.isEventModalOpen) store.isEventModalOpen = false;
    if (store.isTrashModalOpen) store.isTrashModalOpen = false;
    if (store.isLoginModalOpen) store.isLoginModalOpen = false;
    return;
  }

  // Ignorér globale kalender-genveje, hvis brugeren skriver i et tekstfelt eller en modal er åben
  if (
    isTypingInInput(e.target) ||
    store.isEventModalOpen ||
    store.isLoginModalOpen ||
    store.isTrashModalOpen
  ) {
    return;
  }

  const isCtrlOrMeta = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (isCtrlOrMeta && key === 'c') {
    e.preventDefault();
    store.copyOrCutSelection('COPY');
  } else if (isCtrlOrMeta && key === 'x') {
    e.preventDefault();
    store.copyOrCutSelection('CUT');
  } else if (isCtrlOrMeta && key === 'v') {
    e.preventDefault();
    void store.pasteToDate();
  } else if (isCtrlOrMeta && key === 'z') {
    e.preventDefault();
    void store.triggerUndo();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (store.selectedEventIds.length > 0) {
      e.preventDefault();
      void store.deleteEventsByIds(store.selectedEventIds);
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeyDown);
  await store.initStore();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown);
});
</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
    <!-- TopBar -->
    <TopBar
      :title-text="currentTitle"
      @prev="calendarGridRef?.goPrev()"
      @next="calendarGridRef?.goNext()"
      @today="calendarGridRef?.goToday()"
      @change-view="(v) => calendarGridRef?.changeView(v)"
      @jump-to-date="(d) => calendarGridRef?.jumpToDate(d)"
    />

    <!-- Hovedområde: Sidebar + KalenderGrid -->
    <div class="flex-1 flex min-h-0 overflow-hidden">
      <Sidebar />
      <CalendarGrid
        ref="calendarGridRef"
        @title-change="(t) => (currentTitle = t)"
      />
    </div>

    <!-- Custom Højrekliksmenu (overskriver browserens standardmenu) -->
    <ContextMenu />

    <!-- Modaler -->
    <EventModal />
    <TrashModal />
    <LoginModal />

    <!-- Toast Notifikationer (Nederst til højre) -->
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      <div
        v-for="t in store.toasts"
        :key="t.id"
        class="pointer-events-auto p-3.5 rounded-xl border shadow-2xl backdrop-blur-md flex items-start justify-between gap-3 text-xs transition-all"
        :class="{
          'bg-slate-900/95 border-blue-500/40 text-slate-100': t.type === 'info',
          'bg-slate-900/95 border-emerald-500/40 text-slate-100': t.type === 'success',
          'bg-slate-900/95 border-amber-500/40 text-slate-100': t.type === 'warning',
          'bg-slate-900/95 border-rose-500/40 text-slate-100': t.type === 'error'
        }"
      >
        <div class="flex items-start gap-2.5 min-w-0">
          <CheckCircle2 v-if="t.type === 'success'" class="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <AlertTriangle v-else-if="t.type === 'warning'" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <XCircle v-else-if="t.type === 'error'" class="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <Info v-else class="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div class="min-w-0">
            <div class="font-semibold">{{ t.title }}</div>
            <div v-if="t.detail" class="text-slate-300 text-[11px] mt-0.5 leading-relaxed">
              {{ t.detail }}
            </div>
          </div>
        </div>
        <button
          type="button"
          class="text-slate-400 hover:text-slate-200 shrink-0"
          @click="store.dismissToast(t.id)"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
