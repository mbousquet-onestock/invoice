<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { OsAlert, OsBadge, OsButton, OsCardLayout, OsCheckbox, OsDivider, OsInputText, OsTextBlock } from '#ds';
import type { OnestockContext } from '../composables/useOnestockContext';
import { fetchOrder, renderTemplate, sendInvoice, type OrderSummary } from '../api';
import { settings } from '../settings';

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

const siteId = computed(() => props.context.siteId || settings.onestock.default_site_id);
const callContext = computed(() => ({ siteId: siteId.value, apiUrl: props.context.apiUrl, lang: props.context.lang }));
const selectedInvoices = computed(() => order.value?.invoices.filter((url) => selected.value[url]) ?? []);
const configured = computed(() => {
  const os = settings.onestock;
  return os.auth_mode === 'credentials' ? Boolean(os.user_id && os.password) : Boolean(os.token);
});

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

async function load() {
  error.value = '';
  sent.value = '';
  order.value = null;
  if (!props.context.orderId || !siteId.value) return;
  loading.value = true;
  try {
    const result = await fetchOrder(callContext.value, props.context.orderId);
    order.value = result;
    selected.value = Object.fromEntries(result.invoices.map((url) => [url, true]));
    to.value = result.billing.email;
    const vars = { order_id: result.id, ...result.billing };
    subject.value = renderTemplate(settings.email.subject, vars);
    body.value = renderTemplate(settings.email.body, vars);
  } catch (err) {
    error.value = (err as Error).message;
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
    const result = await sendInvoice(callContext.value, {
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

// In the back office the order id arrives with the handshake, after the first render.
watch(
  () => [props.context.ready, props.context.orderId, siteId.value] as const,
  ([ready]) => {
    if (ready && configured.value) load();
  },
  { immediate: true },
);
</script>

<template>
  <section class="invoice-view">
    <OsAlert
      v-if="!configured"
      type="warning"
      title="Connexion OneStock non configurée"
      subtitle="Renseignez le token ou les identifiants API via le bouton masqué à gauche de « Envoyer la facture »."
    />

    <OsAlert
      v-else-if="context.ready && !context.orderId"
      type="info"
      title="Aucune commande dans le contexte"
      subtitle="Ouvrez l'extension depuis le détail d'une commande OneStock."
    />
    <OsAlert v-else-if="context.ready && !siteId" type="warning" title="Site ID manquant dans le contexte" />
    <OsAlert v-if="configured && !context.ready" type="neutral" subtitle="Chargement du contexte OneStock…" />
    <OsAlert v-else-if="loading" type="neutral" :subtitle="`Chargement de la commande ${context.orderId}…`" />

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
          <OsInputText
            v-model="to"
            label="Destinataire"
            type="email"
            supporting-text="Adresse de facturation de la commande (pricing_details.address.contact.email)"
          />
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
