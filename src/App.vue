<script setup lang="ts">
import { ref } from 'vue';
import { OsTabs } from '#ds';
import InvoiceView from './views/InvoiceView.vue';
import SettingsView from './views/SettingsView.vue';
import { useOnestockContext } from './composables/useOnestockContext';

const { context, close } = useOnestockContext();
const tab = ref('invoice');
const tabs = [
  { id: 'invoice', label: 'Facture' },
  { id: 'settings', label: 'Paramètres' },
];
</script>

<template>
  <main class="app">
    <header class="app-header">
      <h1 class="os-title-m">Envoi de facture au client</h1>
      <OsTabs v-model="tab" :tabs="tabs" />
    </header>
    <InvoiceView v-if="tab === 'invoice'" :context="context" @close="close" @open-settings="tab = 'settings'" />
    <SettingsView v-else :context="context" />
  </main>
</template>

<style scoped>
.app { display: flex; flex-direction: column; gap: 16px; padding: 16px; max-width: 880px; margin: 0 auto; }
.app-header { display: flex; flex-direction: column; gap: 12px; }
.app-header h1 { margin: 0; }
</style>
