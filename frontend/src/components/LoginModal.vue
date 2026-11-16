<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { Server, KeyRound, Mail, Globe, X, AlertCircle, Calendar as CalendarIcon } from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';

const store = useCalendarStore();

const serverUrl = ref('');
const username = ref('');
const password = ref('');
const errorMsg = ref('');
const showCustomServerField = ref(false);

const canCloseModal = computed(() => store.isAuthenticated);

watch(
  () => [store.isLoginModalOpen, store.defaultServerUrl, store.session] as const,
  () => {
    if (store.session?.mode === 'CALDAV' && store.session.serverUrl) {
      serverUrl.value = store.session.serverUrl;
      username.value = store.session.username;
    } else if (store.defaultServerUrl) {
      serverUrl.value = store.defaultServerUrl;
    }
  },
  { immediate: true }
);

async function handleLogin() {
  errorMsg.value = '';
  const effectiveUrl = serverUrl.value.trim() || store.defaultServerUrl;
  if (!effectiveUrl) {
    errorMsg.value = 'Angiv venligst Mailcow / SOGo Server URL (eller sæt DEFAULT_CALDAV_URL i .env).';
    showCustomServerField.value = true;
    return;
  }

  try {
    await store.loginToMailcow(effectiveUrl, username.value, password.value);
    password.value = '';
  } catch (err: any) {
    errorMsg.value = err?.message || 'Kunne ikke oprette forbindelse til Mailcow/SOGo.';
  }
}

function tryClose() {
  if (canCloseModal.value) {
    store.isLoginModalOpen = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.isLoginModalOpen || (!store.isAuthenticated && !store.isPublicShareMode)"
      class="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-4"
      @click.self="tryClose"
    >
      <div class="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <CalendarIcon class="w-4 h-4" />
            </div>
            <div>
              <h3 class="text-base font-bold text-slate-100 leading-tight">
                Log ind på DAV-Sync Cal
              </h3>
              <p class="text-[11px] text-slate-400">
                Kræver dit Mailcow / SOGo login
              </p>
            </div>
          </div>
          <button
            v-if="canCloseModal"
            type="button"
            class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            @click="tryClose"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <form class="p-5 space-y-4 text-xs" @submit.prevent="handleLogin">
          <div
            v-if="errorMsg"
            class="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-start gap-2"
          >
            <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
            <span>{{ errorMsg }}</span>
          </div>

          <!-- Hvis DEFAULT_CALDAV_URL er sat i .env, vises den som forudkonfigureret -->
          <div
            v-if="store.defaultServerUrl && !showCustomServerField"
            class="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
          >
            <div class="flex items-center gap-2 min-w-0">
              <Server class="w-4 h-4 text-emerald-400 shrink-0" />
              <div class="min-w-0">
                <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Mailcow Server (.env)
                </div>
                <div class="text-xs text-slate-200 font-medium truncate">
                  {{ store.defaultServerUrl }}
                </div>
              </div>
            </div>
            <button
              type="button"
              class="text-[11px] text-blue-400 hover:underline shrink-0"
              @click="showCustomServerField = true"
            >
              Skift server
            </button>
          </div>

          <!-- Server URL felt (vises hvis DEFAULT_CALDAV_URL ikke er sat i .env eller brugeren klikker "Skift server") -->
          <div v-else>
            <label class="flex items-center gap-1.5 text-slate-300 font-medium mb-1">
              <Globe class="w-3.5 h-3.5 text-blue-400" /> Mailcow / SOGo Server URL
            </label>
            <input
              v-model="serverUrl"
              type="text"
              required
              placeholder="https://post2ko.bridgefarm.dk/SOGo/dav/"
              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <p class="text-[11px] text-slate-500 mt-1">
              Tip: Sæt <code>DEFAULT_CALDAV_URL</code> i din <code>.env</code> / <code>compose.yaml</code>, så serveren vælges automatisk.
            </p>
          </div>

          <div>
            <label class="flex items-center gap-1.5 text-slate-300 font-medium mb-1">
              <Mail class="w-3.5 h-3.5 text-blue-400" /> E-mailadresse (Mailcow login)
            </label>
            <input
              v-model="username"
              type="email"
              required
              autofocus
              placeholder="mail@bridgefarm.dk"
              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label class="flex items-center gap-1.5 text-slate-300 font-medium mb-1">
              <KeyRound class="w-3.5 h-3.5 text-blue-400" /> Adgangskode / App-adgangskode
            </label>
            <input
              v-model="password"
              type="password"
              required
              placeholder="••••••••••••••••"
              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            :disabled="store.isSyncing"
            class="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold shadow transition"
          >
            {{ store.isSyncing ? 'Logger ind på Mailcow...' : 'Log ind på Mailcow' }}
          </button>
        </form>
      </div>
    </div>
  </Teleport>
</template>
