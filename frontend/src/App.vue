<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import CalendarGrid from './components/CalendarGrid.vue';
import ContextMenu from './components/ContextMenu.vue';
import EventModal from './components/EventModal.vue';
import TrashModal from './components/TrashModal.vue';
import LoginModal from './components/LoginModal.vue';
import ShareModal from './components/ShareModal.vue';
import ImportExportModal from './components/ImportExportModal.vue';
import { useCalendarStore } from './stores/calendarStore';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  Lock
} from 'lucide-vue-next';

const SIDEBAR_WIDTH_KEY = 'dav_sync_cal_sidebar_width_v1';
const SIDEBAR_COLLAPSED_KEY = 'dav_sync_cal_sidebar_collapsed_v1';

const store = useCalendarStore();
const calendarGridRef = ref<InstanceType<typeof CalendarGrid> | null>(null);
const currentTitle = ref('');

// Sidebar bredde & kollaps-tilstand (gemmes i localStorage)
const sidebarCollapsed = ref<boolean>(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
const sidebarWidth = ref<number>(
  Math.min(420, Math.max(180, Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 260))
);
const isResizingSidebar = ref<boolean>(false);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed.value));
  void nextTick(() => {
    window.setTimeout(() => calendarGridRef.value?.updateSize(), 50);
  });
}

function startResizeSidebar(e: MouseEvent) {
  e.preventDefault();
  isResizingSidebar.value = true;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const newWidth = Math.min(420, Math.max(180, moveEvent.clientX));
    sidebarWidth.value = newWidth;
    calendarGridRef.value?.updateSize();
  };

  const onMouseUp = () => {
    isResizingSidebar.value = false;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    calendarGridRef.value?.updateSize();
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function resetSidebarWidth() {
  sidebarWidth.value = 260;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, '260');
  void nextTick(() => calendarGridRef.value?.updateSize());
}

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

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    store.closeContextMenu();
    if (store.isEventModalOpen) store.isEventModalOpen = false;
    if (store.isTrashModalOpen) store.isTrashModalOpen = false;
    if (store.isShareModalOpen) store.isShareModalOpen = false;
    if (store.isImportExportModalOpen) store.isImportExportModalOpen = false;
    if (store.isLoginModalOpen && store.isAuthenticated) store.isLoginModalOpen = false;
    return;
  }

  if (
    store.isPublicShareMode ||
    !store.isAuthenticated ||
    isTypingInInput(e.target) ||
    store.isEventModalOpen ||
    store.isLoginModalOpen ||
    store.isTrashModalOpen ||
    store.isShareModalOpen ||
    store.isImportExportModalOpen
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
  <div
    class="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden"
    :class="{ 'cursor-col-resize select-none': isResizingSidebar }"
  >
    <!-- Hvis et offentligt delingslink er ugyldigt eller tilbagekaldt -->
    <div
      v-if="store.publicShareError"
      class="flex-1 flex items-center justify-center p-6"
    >
      <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-3 shadow-2xl">
        <div class="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto">
          <Lock class="w-6 h-6" />
        </div>
        <h2 class="text-base font-bold text-slate-100">Delingslink ikke tilgængeligt</h2>
        <p class="text-xs text-slate-400 leading-relaxed">
          {{ store.publicShareError }}
        </p>
      </div>
    </div>

    <!-- Kalender-visningen vises kun når brugeren er logget ind på Mailcow ELLER åbner et gyldigt offentligt delingslink -->
    <template v-else-if="store.isAuthenticated">
      <TopBar
        :title-text="currentTitle"
        :sidebar-collapsed="sidebarCollapsed"
        @prev="calendarGridRef?.goPrev()"
        @next="calendarGridRef?.goNext()"
        @today="calendarGridRef?.goToday()"
        @change-view="(v) => calendarGridRef?.changeView(v)"
        @jump-to-date="(d) => calendarGridRef?.jumpToDate(d)"
        @toggle-sidebar="toggleSidebar"
      />

      <div class="flex-1 flex min-h-0 overflow-hidden relative">
        <!-- Sidepanel + Træk-kant til breddejustering -->
        <template v-if="!sidebarCollapsed">
          <Sidebar :width="sidebarWidth" />
          <div
            class="w-1.5 bg-slate-800/80 hover:bg-blue-500 active:bg-blue-400 cursor-col-resize transition-colors shrink-0 relative group"
            title="Træk for at tilpasse sidepanelets bredde (dobbeltklik for standardbredde)"
            @mousedown="startResizeSidebar"
            @dblclick="resetSidebarWidth"
          >
            <div class="absolute inset-y-0 -left-1 -right-1"></div>
          </div>
        </template>

        <CalendarGrid
          ref="calendarGridRef"
          @title-change="(t) => (currentTitle = t)"
        />
      </div>

      <!-- Custom Højrekliksmenu -->
      <ContextMenu />

      <!-- Modaler -->
      <EventModal />
      <TrashModal />
      <ShareModal />
      <ImportExportModal />
    </template>

    <!-- LoginModal (krævet før man kan se noget, medmindre man åbner et offentligt delingslink) -->
    <LoginModal />

    <!-- Toast Notifikationer -->
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
