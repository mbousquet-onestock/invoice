<script setup lang="ts">
import { ref } from 'vue';
import InvoiceView from './views/InvoiceView.vue';
import SettingsView from './views/SettingsView.vue';
import { useOnestockContext } from './composables/useOnestockContext';

const { context, close } = useOnestockContext();
const view = ref<'invoice' | 'settings'>('invoice');
</script>

<template>
  <main class="app">
    <InvoiceView v-if="view === 'invoice'" :context="context" @close="close" @open-settings="view = 'settings'" />
    <SettingsView v-else :context="context" @back="view = 'invoice'" />
  </main>
</template>

<style scoped>
.app { padding: 16px; max-width: 880px; margin: 0 auto; }
</style>
