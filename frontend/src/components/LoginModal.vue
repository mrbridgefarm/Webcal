<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { Server, KeyRound, Mail, Globe, X, AlertCircle, Calendar as CalendarIcon } from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';

const store = useCalendarStore();

const customServerUrl = ref('');
const username = ref('');
const password = ref('');
const errorMsg = ref('');
const showCustomServerField = ref(false);

const canCloseModal = computed(() => store.isAuthenticated);

watch(
  () => [store.isLoginModalOpen, store.hasDefaultServer, store.session] as const,
  () => {
    if (store.session?.mode === 'CALDAV') {
      username.value = store.session.username;
      customServerUrl.value = store.session.serverUrl || '';
      showCustomServerField.value = Boolean(store.session.serverUrl);
    } else {
      customServerUrl.value = '';
      // Vis kun server-feltet automatisk hvis DEFAULT_CALDAV_URL slet ikke er sat i .env
      showCustomServerField.value = !store.hasDefaultServer;
    }
  },
  { immediate: true }
);

function toggleCustomServer() {
  showCustomServerField.value = !showCustomServerField.value;
  if (!showCustomServerField.value) {
    customServerUrl.value = '';
  }
}

async function handleLogin() {
  errorMsg.value = '';
  const effectiveCustomUrl = showCustomServerField.value ? customServerUrl.value.trim() : '';

  if (!effectiveCustomUrl && !store.hasDefaultServer) {
    errorMsg.value = 'Angiv venligst en serveradresse (eller sæt DEFAULT_CALDAV_URL i .env).';
    showCustomServerField.value = true;
    return;
  }

  try {
    await store.loginToMailcow(effectiveCustomUrl, username.value, password.value);
    password.value = '';
  } catch (err: any) {
    errorMsg.value = err?.message || 'Kunne ikke logge ind. Kontrollér e-mail og adgangskode.';
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
                Indtast dine kontooplysninger for at fortsætte
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

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="flex items-center gap-1.5 text-slate-300 font-medium">
                <Mail class="w-3.5 h-3.5 text-blue-400" /> E-mailadresse
              </label>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-400 transition"
                @click="toggleCustomServer"
              >
                <Server class="w-3 h-3" />
                {{ showCustomServerField ? 'Brug standardserver' : 'Skift server' }}
              </button>
            </div>
            <input
              v-model="username"
              type="email"
              required
              autofocus
              placeholder="Indtast mailadresse"
              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <!-- Vises kun hvis man aktivt klikker "Skift server" (standardserveren fra .env vises aldrig) -->
          <div v-if="showCustomServerField" class="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1.5">
            <label class="flex items-center gap-1.5 text-slate-300 font-medium">
              <Globe class="w-3.5 h-3.5 text-blue-400" /> Alternativ CalDAV Server URL
            </label>
            <input
              v-model="customServerUrl"
              type="text"
              required
              placeholder="Indtast serveradresse"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
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
            {{ store.isSyncing ? 'Logger ind...' : 'Log ind' }}
          </button>
        </form>
      </div>
    </div>
  </Teleport>
</template>
