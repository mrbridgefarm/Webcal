<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  Share2,
  Copy,
  Check,
  Trash2,
  X,
  Lock,
  ExternalLink,
  Link2
} from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';

const store = useCalendarStore();

const label = ref('');
const selectedCalendarIds = ref<string[]>([]);
const hideDetails = ref(false);
const isCreating = ref(false);
const copiedToken = ref<string | null>(null);

watch(
  () => store.isShareModalOpen,
  (isOpen) => {
    if (!isOpen) return;
    if (store.preselectedShareCalendarId) {
      selectedCalendarIds.value = [store.preselectedShareCalendarId];
      const cal = store.getCalendarById(store.preselectedShareCalendarId);
      label.value = cal ? cal.name : 'Delt kalender';
    } else {
      selectedCalendarIds.value = store.calendars.map((c) => c.id);
      label.value = 'Min Kalender';
    }
    hideDetails.value = false;
  }
);

function buildShareUrl(token: string): string {
  const origin = window.location.origin;
  const pathname = window.location.pathname;
  return `${origin}${pathname}?share=${encodeURIComponent(token)}`;
}

async function copyShareUrl(token: string) {
  const url = buildShareUrl(token);
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    copiedToken.value = token;
    store.notify('Delingslink kopieret!', 'Du kan nu sende linket til 3. part.', 'success');
    window.setTimeout(() => {
      if (copiedToken.value === token) copiedToken.value = null;
    }, 2500);
  } catch {
    store.notify('Kunne ikke kopiere automatisk', url, 'info');
  }
}

async function handleCreateShare() {
  if (selectedCalendarIds.value.length === 0) return;
  isCreating.value = true;
  try {
    const created = await store.createShare({
      label: label.value.trim() || 'Delt kalender',
      calendarIds: selectedCalendarIds.value,
      hideDetails: hideDetails.value
    });
    if (created) {
      await copyShareUrl(created.token);
    }
  } finally {
    isCreating.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.isShareModalOpen"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="store.isShareModalOpen = false"
    >
      <div class="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        <!-- Header -->
        <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Share2 class="w-4 h-4 text-blue-400" />
            <h3 class="text-base font-bold text-slate-100">
              Del kalender med 3. part (Offentligt Read-Only link)
            </h3>
          </div>
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            @click="store.isShareModalOpen = false"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="p-5 overflow-y-auto space-y-5 text-xs">
          <!-- Opret nyt delingslink -->
          <form class="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3.5" @submit.prevent="handleCreateShare">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-slate-200">Opret nyt delingslink</span>
              <span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                <Lock class="w-3 h-3" /> Kun visning (Read-Only uden login)
              </span>
            </div>

            <div>
              <label class="block text-slate-400 font-medium mb-1">Navn / Titel på deling</label>
              <input
                v-model="label"
                type="text"
                required
                placeholder="F.eks. Carstens Kalender eller Vagtplan..."
                class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label class="block text-slate-400 font-medium mb-1.5">Vælg kalendere der skal indgå i linket</label>
              <div class="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                <label
                  v-for="cal in store.calendars"
                  :key="cal.id"
                  class="flex items-center gap-2.5 p-2 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700"
                >
                  <input
                    v-model="selectedCalendarIds"
                    type="checkbox"
                    :value="cal.id"
                    class="rounded border-slate-600 bg-slate-950 text-blue-600"
                  />
                  <span
                    class="w-2.5 h-2.5 rounded-full shrink-0"
                    :style="{ backgroundColor: cal.color }"
                  ></span>
                  <span class="text-slate-200 font-medium truncate">{{ cal.name }}</span>
                </label>
              </div>
            </div>

            <label class="flex items-center gap-2.5 pt-1 cursor-pointer">
              <input
                v-model="hideDetails"
                type="checkbox"
                class="rounded border-slate-600 bg-slate-900 text-blue-600"
              />
              <span class="text-slate-300">
                Anonymisér titler (vis kun <strong>"Optaget"</strong> + tidspunkt til modtageren)
              </span>
            </label>

            <button
              type="submit"
              :disabled="isCreating || selectedCalendarIds.length === 0"
              class="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-1.5 shadow transition"
            >
              <Link2 class="w-4 h-4" />
              {{ isCreating ? 'Opretter delingslink...' : 'Opret & Kopiér offentligt link' }}
            </button>
          </form>

          <!-- Aktive delingslinks -->
          <div class="space-y-2">
            <h4 class="font-bold uppercase tracking-wider text-slate-400 text-[11px]">
              Dine aktive delingslinks ({{ store.shares.length }})
            </h4>

            <div
              v-if="store.shares.length === 0"
              class="p-6 text-center rounded-xl bg-slate-950/60 border border-slate-800 text-slate-400"
            >
              Du har ingen aktive delingslinks endnu.
            </div>

            <div
              v-for="share in store.shares"
              :key="share.token"
              class="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-semibold text-slate-100 truncate">
                    {{ share.label }}
                  </div>
                  <div class="text-[11px] text-slate-400 truncate">
                    Kalendere: {{ share.calendarNames.join(', ') }}
                    <span v-if="share.hideDetails" class="text-amber-300 ml-1">(Kun "Optaget")</span>
                  </div>
                </div>

                <div class="flex items-center gap-1.5 shrink-0">
                  <a
                    :href="buildShareUrl(share.token)"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                    title="Åbn delingslink i ny fane"
                  >
                    <ExternalLink class="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    class="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition"
                    title="Tilbagekald / slet dette delingslink"
                    @click="store.revokeShare(share.token)"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <input
                  type="text"
                  readonly
                  :value="buildShareUrl(share.token)"
                  class="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 font-mono select-all focus:outline-none"
                />
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1 transition shrink-0"
                  :class="copiedToken === share.token
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'"
                  @click="copyShareUrl(share.token)"
                >
                  <Check v-if="copiedToken === share.token" class="w-3.5 h-3.5" />
                  <Copy v-else class="w-3.5 h-3.5" />
                  {{ copiedToken === share.token ? 'Kopieret!' : 'Kopiér link' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="px-5 py-3 border-t border-slate-800 flex justify-end">
          <button
            type="button"
            class="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
            @click="store.isShareModalOpen = false"
          >
            Luk
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
