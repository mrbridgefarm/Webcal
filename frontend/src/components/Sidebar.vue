<script setup lang="ts">
import {
  Lock,
  RotateCcw,
  Trash2,
  Clipboard,
  Scissors,
  Bell,
  ShieldCheck,
  Keyboard
} from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';
import { requestNotificationPermission } from '../services/notifications';
import { ref } from 'vue';

const store = useCalendarStore();
const notifPermission = ref<string>(
  typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'denied'
);

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
</script>

<template>
  <aside class="w-72 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between p-4 select-none overflow-y-auto shrink-0">
    <div class="space-y-6">
      <!-- Kalendere (Egne & Delte SOGo) -->
      <div>
        <div class="flex items-center justify-between mb-2.5">
          <h2 class="text-xs font-bold uppercase tracking-wider text-slate-400">
            SOGo Kalendere
          </h2>
          <span class="text-[11px] text-slate-500">
            {{ store.calendars.length }} aktive
          </span>
        </div>

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

            <!-- Farvevælger + Gendan SOGo serverfarve -->
            <div class="flex items-center gap-1 shrink-0">
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

      <!-- Aktiv Udklipsholder ("Drysset" Copy/Paste status) -->
      <div class="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Clipboard v-if="store.clipboard.mode !== 'CUT'" class="w-3.5 h-3.5 text-blue-400" />
            <Scissors v-else class="w-3.5 h-3.5 text-amber-400" />
            <span>Udklipsholder</span>
          </div>
          <span
            v-if="store.clipboard.events.length > 0"
            class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300"
          >
            {{ store.clipboard.mode === 'CUT' ? 'KLIP' : 'KOPI' }} ({{ store.clipboard.events.length }})
          </span>
        </div>

        <div v-if="store.clipboard.events.length > 0" class="space-y-1.5">
          <div
            v-for="ev in store.clipboard.events.slice(0, 3)"
            :key="ev.id"
            class="text-xs text-slate-300 bg-slate-900 px-2 py-1 rounded border border-slate-800 truncate"
          >
            {{ ev.title }}
          </div>
          <div v-if="store.clipboard.events.length > 3" class="text-[11px] text-slate-400">
            + {{ store.clipboard.events.length - 3 }} flere valgt
          </div>
          <p class="text-[11px] text-emerald-400/90 pt-1">
            Valgt mål-dato: <strong class="font-semibold">{{ store.selectedDateStr }}</strong>
            — Tryk <kbd class="px-1 py-0.5 bg-slate-800 rounded text-[10px]">Ctrl+V</kbd> for at indsætte.
          </p>
        </div>
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
