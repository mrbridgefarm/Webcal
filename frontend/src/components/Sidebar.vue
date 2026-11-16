<script setup lang="ts">
import {
  Lock,
  RotateCcw,
  Trash2,
  Clipboard,
  Scissors,
  Bell,
  ShieldCheck,
  Keyboard,
  ClipboardPaste,
  Copy,
  X,
  Clock,
  Plus,
  EyeOff
} from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';
import { requestNotificationPermission } from '../services/notifications';
import type { CalendarEvent } from '../types/calendar';
import { ref, computed } from 'vue';

const store = useCalendarStore();
const notifPermission = ref<string>(
  typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'denied'
);

const showNewCalendarForm = ref(false);
const newCalendarName = ref('');
const newCalendarUrl = ref('');
const newCalendarColor = ref('#7c3aed');
const isCreatingCalendar = ref(false);

async function submitNewCalendar() {
  isCreatingCalendar.value = true;
  try {
    const created = await store.createCalendar(
      newCalendarName.value,
      newCalendarColor.value,
      newCalendarUrl.value || undefined
    );
    if (created) {
      newCalendarName.value = '';
      newCalendarUrl.value = '';
      showNewCalendarForm.value = false;
    }
  } finally {
    isCreatingCalendar.value = false;
  }
}

async function confirmDeleteCalendar(calId: string, name: string) {
  const ok = window.confirm(
    `Slet kalenderen "${name}" permanent?\n\nAlle begivenheder i kalenderen slettes også på serveren. Dette kan ikke fortrydes.`
  );
  if (ok) {
    await store.deleteCalendar(calId);
  }
}

const selectedEventsList = computed<CalendarEvent[]>(() => {
  if (store.selectedEventIds.length === 0) return [];
  const idSet = new Set(store.selectedEventIds);
  return store.events.filter((e) => idSet.has(e.id));
});

async function enableNotifications() {
  const perm = await requestNotificationPermission();
  notifPermission.value = perm;
  if (perm === 'granted') {
    store.notify('Browser-notifikationer aktiveret', 'Du får nu OS-påmindelser ved VALARM.', 'success');
  } else {
    store.notify('Notifikationer afvist', 'Tillad notifikationer i din browsers adresselinje.', 'warning');
  }
}

function handleColorChange(calId: string, event: Event) {
  const input = event.target as HTMLInputElement;
  if (input?.value) {
    void store.setCalendarColorOverride(calId, input.value);
  }
}

function formatEventTimeSpan(ev: CalendarEvent): string {
  const startDt = new Date(ev.start);
  const datePart = startDt.toLocaleDateString('da-DK', {
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  });
  if (ev.allDay) {
    return `${datePart} • Heldag`;
  }
  const startTime = startDt.toLocaleTimeString('da-DK', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const endDt = new Date(ev.end || ev.start);
  const endTime = endDt.toLocaleTimeString('da-DK', {
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${datePart} • ${startTime} - ${endTime}`;
}

function removeSingleClipboardEvent(evId: string) {
  const remaining = store.clipboard.events.filter((e) => e.id !== evId);
  if (remaining.length === 0) {
    store.clearClipboard();
  } else {
    store.clipboard.events = remaining;
  }
}
</script>

<template>
  <aside class="w-72 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between p-4 select-none overflow-y-auto shrink-0">
    <div class="space-y-5">
      <!-- Kalendere (Egne & Delte SOGo) -->
      <div>
        <div class="flex items-center justify-between mb-2.5">
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400">
            SOGo Kalendere
          </h2>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-500">
              {{ store.calendars.length }} aktive
            </span>
            <button
              type="button"
              class="p-1 rounded-md bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white border border-slate-700 transition"
              title="Tilføj ny kalender"
              @click="showNewCalendarForm = !showNewCalendarForm"
            >
              <Plus class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Formular: Ny kalender eller tilføj eksisterende CalDAV-link -->
        <form
          v-if="showNewCalendarForm"
          class="mb-2.5 p-2.5 rounded-xl bg-slate-950 border border-blue-500/40 space-y-2"
          @submit.prevent="submitNewCalendar"
        >
          <div class="text-[11px] font-semibold text-slate-200">Tilføj / Opret kalender</div>
          <div class="flex items-center gap-2">
            <input
              v-model="newCalendarName"
              type="text"
              placeholder="Kalendernavn (f.eks. Vagtplan)..."
              class="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <input
              v-model="newCalendarColor"
              type="color"
              class="w-8 h-8 rounded-lg bg-transparent border border-slate-700 cursor-pointer shrink-0"
              title="Vælg farve"
            />
          </div>
          <div>
            <input
              v-model="newCalendarUrl"
              type="text"
              placeholder="Valgfri SOGo CalDAV URL (ellers oprettes ny)..."
              class="w-full px-2.5 py-1.5 text-[11px] bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div class="flex items-center justify-end gap-1.5">
            <button
              type="button"
              class="px-2.5 py-1 rounded-lg text-[11px] text-slate-300 hover:bg-slate-800"
              @click="showNewCalendarForm = false"
            >
              Annullér
            </button>
            <button
              type="submit"
              :disabled="isCreatingCalendar"
              class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {{ isCreatingCalendar ? 'Gemmer...' : (newCalendarUrl ? 'Tilføj link' : 'Opret ny') }}
            </button>
          </div>
        </form>

        <div class="space-y-1.5">
          <div
            v-for="cal in store.calendars"
            :key="cal.id"
            class="group p-2 rounded-xl border transition flex items-center justify-between gap-2"
            :class="cal.visible
              ? 'bg-slate-800/60 border-slate-700/70'
              : 'bg-slate-900/40 border-slate-800/50 opacity-60'"
          >
            <label class="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1">
              <input
                type="checkbox"
                :checked="cal.visible"
                class="rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-0 cursor-pointer"
                @change="store.toggleCalendarVisibility(cal.id)"
              />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-medium text-slate-100 truncate">
                    {{ cal.name }}
                  </span>
                  <span
                    v-if="cal.readOnly"
                    class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold shrink-0"
                    title="Skrivebeskyttet delt kalender — Redigering, Træk-og-Slip og Ctrl+V er låst"
                  >
                    <Lock class="w-2.5 h-2.5" />
                    Read-Only
                  </span>
                </div>
                <div v-if="cal.isShared || cal.owner" class="text-[10px] text-slate-400 truncate">
                  Delt af {{ cal.owner || 'kollega' }}
                </div>
              </div>
            </label>

            <!-- Farvevælger + Gendan SOGo serverfarve + Slet/Fjern -->
            <div class="flex items-center gap-1 shrink-0">
              <button
                v-if="!cal.readOnly && !cal.isShared"
                type="button"
                class="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition"
                title="Slet kalender (inkl. alle begivenheder)"
                @click="confirmDeleteCalendar(cal.id, cal.name)"
              >
                <Trash2 class="w-3 h-3" />
              </button>
              <button
                type="button"
                class="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                title="Fjern/skjul kalender fra listen"
                @click="store.hideCalendar(cal.id)"
              >
                <EyeOff class="w-3 h-3" />
              </button>
              <button
                v-if="cal.localColorOverride && cal.localColorOverride !== cal.serverColor"
                type="button"
                class="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
                title="Gendan SOGo serverfarve"
                @click="store.setCalendarColorOverride(cal.id, null)"
              >
                <RotateCcw class="w-3 h-3" />
              </button>
              <label
                class="w-5 h-5 rounded-full border border-white/20 cursor-pointer flex items-center justify-center overflow-hidden shadow-inner"
                :style="{ backgroundColor: cal.color }"
                title="Klik for at overskrive kalenderfarven lokalt"
              >
                <input
                  type="color"
                  :value="cal.color"
                  class="opacity-0 w-0 h-0"
                  @input="handleColorChange(cal.id, $event)"
                />
              </label>
            </div>
          </div>
        </div>

        <button
          v-if="store.hiddenCalendarIds.length > 0"
          type="button"
          class="mt-2 w-full py-1 px-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/70 text-[11px] text-slate-300 flex items-center justify-center gap-1.5 transition"
          @click="store.restoreHiddenCalendars()"
        >
          <RotateCcw class="w-3 h-3" />
          Vis {{ store.hiddenCalendarIds.length }} skjult(e) kalender(e) igen
        </button>
      </div>

      <!-- Standard kalender til Ctrl+V / Nye begivenheder -->
      <div v-if="store.writableCalendars.length > 1">
        <label class="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
          Mål-kalender (Ny / Indsæt)
        </label>
        <select
          v-model="store.activeTargetCalendarId"
          class="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-blue-500"
        >
          <option
            v-for="wCal in store.writableCalendars"
            :key="wCal.id"
            :value="wCal.id"
          >
            {{ wCal.name }}
          </option>
        </select>
      </div>

      <!-- Aktiv Udklipsholder ("Drysset" Copy/Paste boks) -->
      <div
        class="p-3 rounded-xl border transition-all space-y-2.5"
        :class="store.clipboard.events.length > 0
          ? 'bg-emerald-950/20 border-emerald-500/50 shadow-lg shadow-emerald-950/20'
          : 'bg-slate-950/90 border-slate-800'"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-bold text-slate-100">
            <Clipboard v-if="store.clipboard.mode !== 'CUT'" class="w-4 h-4 text-emerald-400" />
            <Scissors v-else class="w-4 h-4 text-amber-400" />
            <span>Udklipsholder</span>
          </div>

          <div v-if="store.clipboard.events.length > 0" class="flex items-center gap-1.5">
            <span
              class="text-[10px] font-bold px-2 py-0.5 rounded-full"
              :class="store.clipboard.mode === 'CUT'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'"
            >
              {{ store.clipboard.mode === 'CUT' ? 'KLIPPET' : 'KOPIERET' }} ({{ store.clipboard.events.length }})
            </span>
            <button
              type="button"
              class="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition"
              title="Tøm udklipsholder"
              @click="store.clearClipboard()"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Liste over kopierede/klippede aftaler i udklipsholderen -->
        <div v-if="store.clipboard.events.length > 0" class="space-y-2">
          <div class="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
            <div
              v-for="ev in store.clipboard.events"
              :key="ev.id"
              class="p-2 rounded-lg bg-slate-900/95 border border-slate-700/80 flex items-start justify-between gap-2"
            >
              <div class="flex items-start gap-2 min-w-0">
                <span
                  class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                  :style="{ backgroundColor: store.getCalendarById(ev.calendarId)?.color || '#10b981' }"
                ></span>
                <div class="min-w-0">
                  <div class="text-xs font-semibold text-slate-100 truncate" :title="ev.title">
                    {{ ev.title }}
                  </div>
                  <div class="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                    <Clock class="w-2.5 h-2.5 shrink-0" />
                    <span class="truncate">{{ formatEventTimeSpan(ev) }}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                class="text-slate-500 hover:text-rose-400 p-0.5 shrink-0"
                title="Fjern fra udklipsholder"
                @click="removeSingleClipboardEvent(ev.id)"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>

          <!-- Direkte Indsæt-knap i Udklipsholder-boksen -->
          <div class="pt-1.5 border-t border-slate-800/90 space-y-1.5">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-slate-400">Valgt mål-dato:</span>
              <strong class="text-blue-400 font-semibold">{{ store.selectedDateStr.slice(0, 10) }}</strong>
            </div>
            <button
              type="button"
              class="w-full py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow transition"
              @click="store.pasteToDate()"
            >
              <ClipboardPaste class="w-3.5 h-3.5" />
              Indsæt her (Ctrl+V)
            </button>
          </div>
        </div>

        <!-- Hvis udklipsholderen er tom, men brugeren har klikket på en aftale -->
        <div v-else-if="selectedEventsList.length > 0" class="space-y-2">
          <div class="text-[11px] text-blue-300 font-medium">
            Markeret nu ({{ selectedEventsList.length }}):
          </div>
          <div
            v-for="selEv in selectedEventsList.slice(0, 3)"
            :key="selEv.id"
            class="p-2 rounded-lg bg-slate-900 border border-blue-500/40 text-xs"
          >
            <div class="font-semibold text-slate-100 truncate">{{ selEv.title }}</div>
            <div class="text-[10px] text-slate-400 mt-0.5">{{ formatEventTimeSpan(selEv) }}</div>
          </div>
          <button
            type="button"
            class="w-full py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            @click="store.copyOrCutSelection('COPY')"
          >
            <Copy class="w-3.5 h-3.5" />
            Kopiér til udklipsholder (Ctrl+C)
          </button>
        </div>

        <!-- Helt tom tilstand -->
        <p v-else class="text-[11px] text-slate-400 leading-relaxed">
          Markér en begivenhed eller dag og tryk <kbd class="px-1 py-0.5 bg-slate-800 rounded text-[10px] text-slate-200">Ctrl+C</kbd>, klik på en ny dag og tryk <kbd class="px-1 py-0.5 bg-slate-800 rounded text-[10px] text-slate-200">Ctrl+V</kbd>.
        </p>
      </div>

      <!-- Mødesikkerhed & Tastaturgenveje Info -->
      <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2 text-[11px] text-slate-400">
        <div class="flex items-center gap-1.5 text-slate-200 font-semibold text-xs">
          <Keyboard class="w-3.5 h-3.5 text-blue-400" />
          <span>Hurtige Genveje</span>
        </div>
        <div class="grid grid-cols-2 gap-y-1 text-[11px]">
          <span>Kopiér vagt/dag:</span>
          <kbd class="justify-self-end px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Ctrl + C</kbd>
          <span>Klip begivenhed:</span>
          <kbd class="justify-self-end px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Ctrl + X</kbd>
          <span>Indsæt på valgt dag:</span>
          <kbd class="justify-self-end px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Ctrl + V</kbd>
          <span>Fortryd handling:</span>
          <kbd class="justify-self-end px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Ctrl + Z</kbd>
          <span>Slet til papirkurv:</span>
          <kbd class="justify-self-end px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">Delete</kbd>
        </div>
        <div class="pt-1.5 border-t border-slate-800/80 flex items-start gap-1.5 text-[10px] text-slate-400">
          <ShieldCheck class="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>Mødesikkerhed aktiv:</strong> Møder med inviterede deltagere spærres automatisk for <code class="text-slate-300">Ctrl+C</code>.
          </span>
        </div>
      </div>
    </div>

    <!-- Bund: Papirkurv (30 dage) & Browser Notifikationer -->
    <div class="space-y-2 pt-4 border-t border-slate-800">
      <button
        type="button"
        class="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/70 hover:bg-slate-800 border border-slate-700/70 text-xs text-slate-200 transition"
        @click="store.isTrashModalOpen = true"
      >
        <span class="flex items-center gap-2 font-medium">
          <Trash2 class="w-4 h-4 text-rose-400" />
          Papirkurv (30 dage)
        </span>
        <span class="px-2 py-0.5 rounded-full bg-slate-900 text-slate-300 text-[11px] font-semibold">
          {{ store.trashItems.length }}
        </span>
      </button>

      <button
        v-if="notifPermission !== 'granted'"
        type="button"
        class="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-[11px] text-blue-300 transition"
        @click="enableNotifications"
      >
        <Bell class="w-3.5 h-3.5" />
        Aktivér OS-påmindelser (VALARM)
      </button>
    </div>
  </aside>
</template>
