<script setup lang="ts">
import { ref } from 'vue';
import { Server, KeyRound, Mail, Globe, Sparkles, X, AlertCircle } from 'lucide-vue-next';
import { useCalendarStore } from '../stores/calendarStore';

const store = useCalendarStore();

const serverUrl = ref(
  store.session?.mode === 'CALDAV'
    ? store.session.serverUrl
    : 'https://mail.ditdomæne.dk/SOGo/dav/'
);
const username = ref(
  store.session?.mode === 'CALDAV' ? store.session.username : ''
);
const password = ref('');
const errorMsg = ref('');

async function handleLogin() {
  errorMsg.value = '';
  try {
    await store.loginToMailcow(serverUrl.value, username.value, password.value);
    password.value = '';
  } catch (err: any) {
    errorMsg.value = err?.message || 'Kunne ikke oprette forbindelse til Mailcow/SOGo.';
  }
}

async function handleDemoMode() {
  errorMsg.value = '';
  await store.activateDemoMode(true);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="store.isLoginModalOpen"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="store.isLoginModalOpen = false"
    >
      <div class="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Server class="w-4 h-4 text-blue-400" />
            <h3 class="text-base font-bold text-slate-100">
              Mailcow / SOGo CalDAV Forbindelse
            </h3>
          </div>
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            @click="store.isLoginModalOpen = false"
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
            <label class="flex items-center gap-1.5 text-slate-300 font-medium mb-1">
              <Globe class="w-3.5 h-3.5 text-blue-400" /> Mailcow / SOGo Server URL
            </label>
            <input
              v-model="serverUrl"
              type="text"
              required
              placeholder="https://mail.ditdomæne.dk/SOGo/dav/"
              class="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <p class="text-[11px] text-slate-500 mt-1">
              Du kan indtaste både domænet (<code>post2ko.bridgefarm.dk</code>), <code>/SOGo/dav/</code> eller dit direkte SOGo kalenderlink (<code>.../SOGo/dav/mail@.../Calendar/personal/</code>).
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
              placeholder="navn@ditdomæne.dk"
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
            {{ store.isSyncing ? 'Validerer mod Mailcow...' : 'Log ind & Synkronisér med Mailcow' }}
          </button>

          <div class="relative flex py-1 items-center">
            <div class="flex-grow border-t border-slate-800"></div>
            <span class="flex-shrink mx-3 text-slate-500 text-[11px]">ELLER</span>
            <div class="flex-grow border-t border-slate-800"></div>
          </div>

          <button
            type="button"
            class="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-medium flex items-center justify-center gap-1.5 transition"
            @click="handleDemoMode"
          >
            <Sparkles class="w-3.5 h-3.5" />
            Kør / Nulstil Demo-tilstand (Uden live server)
          </button>
        </form>
      </div>
    </div>
  </Teleport>
</template>
