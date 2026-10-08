<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { OsAlert, OsBadge, OsButton, OsCardLayout, OsCheckbox, OsDivider, OsInputText, OsTextBlock } from '#ds';
import type { OnestockContext } from '../composables/useOnestockContext';
import { renderTemplate, sendInvoice, type OrderSummary } from '../api';
import { store, initApp, isConfigured, setting } from '../settings';

const props = defineProps<{ context: OnestockContext }>();
const emit = defineEmits<{ close: []; openSettings: [] }>();

const order = ref<OrderSummary | null>(null);
const loading = ref(false);
const sending = ref(false);
const error = ref('');
const sent = ref('');

const to = ref('');
const subject = ref('');
const body = ref('');
const selected = ref<Record<string, boolean>>({});

const siteId = computed(() => props.context.siteId);
const selectedInvoices = computed(() => order.value?.invoices.filter((url) => selected.value[url]) ?? []);
const configured = computed(() => store.loaded && isConfigured());

function fileName(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url;
  }
}

function formatDate(timestamp?: number) {
  return timestamp ? new Date(timestamp * 1000).toLocaleString(props.context.lang || 'fr') : '';
}

function show(result: OrderSummary) {
  order.value = result;
  selected.value = Object.fromEntries(result.invoices.map((url) => [url, true]));
  to.value = result.billing.email;
  const vars = { order_id: result.id, ...result.billing };
  subject.value = renderTemplate(setting('email_subject'), vars);
  body.value = renderTemplate(setting('email_body'), vars);
}

/** One call to /api/init: settings and order together. */
async function load() {
  error.value = '';
  sent.value = '';
  order.value = null;
  loading.value = true;
  try {
    const result = await initApp<OrderSummary>(props.context);
    if (result.order) show(result.order);
    else if (result.order_error) error.value = result.order_error;
  } finally {
    loading.value = false;
  }
}

async function send() {
  if (!order.value) return;
  error.value = '';
  sent.value = '';
  sending.value = true;
  try {
    const result = await sendInvoice(props.context, {
      order_id: order.value.id,
      to: to.value,
      subject: subject.value,
      body: body.value,
      invoices: selectedInvoices.value,
    });
    sent.value = `Email envoyé à ${to.value} (${result.files.join(', ')})`;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    sending.value = false;
  }
}

// In the back office the context arrives with the handshake, after the first render.
watch(
  () => [props.context.ready, props.context.orderId, props.context.siteId, props.context.extensionId] as const,
  ([ready]) => {
    if (ready) load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="invoice-view">
    <OsAlert v-if="store.error" type="danger" title="Paramètres illisibles" :subtitle="store.error" />
    <OsAlert
      v-else-if="store.loaded && !configured"
      type="warning"
      title="onestock_token introuvable"
      :subtitle="`Le token OneStock doit être fourni au niveau global par l'API Settings (environnement ${store.scope?.environment ?? '?'}).`"
    />

    <OsAlert
      v-else-if="context.ready && !context.orderId"
      type="info"
      title="Aucune commande dans le contexte"
      subtitle="Ouvrez l'extension depuis le détail d'une commande OneStock."
    />
    <OsAlert v-else-if="context.ready && !siteId" type="warning" title="Site ID manquant dans le contexte" />
    <OsAlert v-if="!context.ready" type="neutral" subtitle="Chargement du contexte OneStock…" />
    <OsAlert v-else-if="loading" type="neutral" :subtitle="`Chargement de la commande ${context.orderId}…`" />

    <OsAlert
      v-if="store.created.length"
      type="info"
      title="Première connexion : paramètres initialisés"
      :subtitle="`Créés avec leur valeur par défaut : ${store.created.join(', ')}`"
    />
    <OsAlert v-if="error" type="danger" title="Erreur" :subtitle="error" />
    <OsAlert v-if="sent" type="success" title="Facture envoyée" :subtitle="sent">
      <template v-if="context.embedded" #actions>
        <OsButton type="secondary" text="Fermer" @click="emit('close')" />
      </template>
    </OsAlert>

    <OsCardLayout v-if="order">
      <div class="order">
        <div class="order-head">
          <OsTextBlock
            :primary-text="`Commande ${order.id}`"
            :tertiary-text="formatDate(order.date)"
          />
          <OsBadge v-if="order.state" :text="order.state" color="grey" />
        </div>

        <OsDivider />

        <div class="block">
          <div class="os-label-l">Factures</div>
          <OsAlert
            v-if="!order.invoices.length"
            type="info"
            subtitle="Aucune URL de facture dans information.invoice pour cette commande."
          />
          <div v-for="url in order.invoices" :key="url" class="invoice-row">
            <OsCheckbox v-model="selected[url]" :label="fileName(url)" />
            <a class="os-body-l link" :href="url" target="_blank" rel="noopener">Ouvrir</a>
          </div>
        </div>

        <OsDivider />

        <div class="block">
          <div class="os-label-l">Email au client</div>
          <OsInputText v-model="to" label="Destinataire" type="email" />
          <OsInputText v-model="subject" label="Objet" />
          <label class="textarea">
            <span class="os-body-m">Message</span>
            <textarea v-model="body" class="os-label-s" rows="7" />
          </label>
        </div>

      </div>
    </OsCardLayout>

    <footer class="actions">
      <OsButton class="settings-link" type="tertiary" text="Paramètres" @click="emit('openSettings')" />
      <OsButton
        text="Envoyer la facture"
        :pending="sending"
        :disabled="!order || !to || !selectedInvoices.length"
        @click="send"
      />
    </footer>
  </section>
</template>

<style scoped>
.invoice-view { display: flex; flex-direction: column; gap: 16px; }
.order { display: flex; flex-direction: column; gap: 16px; }
.order-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.block { display: flex; flex-direction: column; gap: 8px; }
.invoice-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.link { color: #24bdb0; text-decoration: none; }
.link:hover { text-decoration: underline; }
.textarea { display: flex; flex-direction: column; gap: 2px; color: #4c4c4c; }
.textarea textarea {
  resize: vertical; padding: 8px 12px; border: 1px solid #e5e5e5; border-radius: 5px; color: #333; outline: none;
  font-family: Roboto, sans-serif;
}
.textarea textarea:focus { border-color: #24bdb0; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
/* Hidden entry to the settings, just left of "Envoyer": invisible until hovered or focused. */
.settings-link { opacity: 0; transition: opacity 0.2s; }
.settings-link:hover, .settings-link:focus-visible { opacity: 1; }
</style>
