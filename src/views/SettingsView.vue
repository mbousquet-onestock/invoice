<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { OsAlert, OsBadge, OsButton, OsCardLayout, OsCheckbox, OsDivider, OsInputText } from '#ds';
import type { OnestockContext } from '../composables/useOnestockContext';
import { store, loadSettings, saveSettings } from '../settings';
import { testSmtp } from '../api';

const props = defineProps<{ context: OnestockContext }>();
const emit = defineEmits<{ back: [] }>();

const form = reactive<Record<string, string>>({});
const initial = ref<Record<string, string>>({});
const message = ref<{ type: 'success' | 'danger'; text: string } | null>(null);
const saving = ref(false);
const testing = ref(false);

const siteLabel = computed(() => (store.scope?.siteId ? `site ${store.scope.siteId}` : 'tous les sites'));
const extensionId = computed(() => store.scope?.extensionId || props.context.extensionId);

function fill() {
  const values = Object.fromEntries(Object.entries(store.settings).map(([key, s]) => [key, s.value]));
  Object.assign(form, values);
  initial.value = values;
}
watch(() => store.settings, fill, { immediate: true });
if (!store.loaded && props.context.ready) loadSettings(props.context);

const smtpSecure = computed({
  get: () => form.smtp_secure === 'true',
  set: (value: boolean) => (form.smtp_secure = String(value)),
});

function origin(key: string) {
  const s = store.settings[key];
  if (!s?.source) return 'Valeur par défaut';
  const site = s.source.site_id ? `site ${s.source.site_id}` : 'tous les sites';
  const extension = s.source.extension_id === '*' ? 'toutes les extensions' : `extension ${s.source.extension_id}`;
  return `Enregistré pour ${site}, ${extension}`;
}

function secretPlaceholder(key: string) {
  return store.settings[key]?.set ? '•••••••• (enregistré, laisser vide pour conserver)' : '';
}

const changes = computed(() =>
  Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== initial.value[key])),
);

async function save() {
  saving.value = true;
  message.value = null;
  try {
    const saved = await saveSettings(props.context, changes.value);
    message.value = {
      type: 'success',
      text: saved.length ? `${saved.length} paramètre(s) enregistré(s).` : 'Aucune modification à enregistrer.',
    };
  } catch (err) {
    message.value = { type: 'danger', text: (err as Error).message };
  } finally {
    saving.value = false;
  }
}

async function checkSmtp() {
  testing.value = true;
  message.value = null;
  try {
    if (Object.keys(changes.value).length) await saveSettings(props.context, changes.value);
    await testSmtp(props.context);
    message.value = { type: 'success', text: 'Connexion SMTP réussie.' };
  } catch (err) {
    message.value = { type: 'danger', text: `SMTP : ${(err as Error).message}` };
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <section class="settings">
    <div class="head">
      <h1 class="os-title-m title">Paramètres</h1>
      <OsBadge v-if="store.scope" :text="`Environnement : ${store.scope.environment}`" color="grey" />
    </div>

    <OsAlert v-if="store.error" type="danger" title="API Settings" :subtitle="store.error" />
    <OsAlert v-else-if="store.loading && !store.loaded" type="neutral" subtitle="Chargement des paramètres…" />

    <OsCardLayout v-if="store.loaded">
      <div class="group">
        <div class="os-label-l">API OneStock</div>
        <span class="os-body-s hint">Communs à toutes les extensions du {{ siteLabel }} (extension_id « * »).</span>
        <OsInputText
          v-model="form.onestock_token"
          label="Token (onestock_token)"
          type="password"
          autocomplete="off"
          :placeholder="secretPlaceholder('onestock_token')"
          :supporting-text="origin('onestock_token')"
        />
        <OsInputText
          v-model="form.onestock_api_root"
          label="Racine de l'API (onestock_api_root)"
          :placeholder="context.apiUrl || 'https://c00.api.qualif.onestock-retail.com'"
          :supporting-text="`${origin('onestock_api_root')} — /v3 ajouté si la version n'est pas précisée`"
        />

        <OsDivider />

        <span class="os-body-s hint">
          Paramètres suivants propres à l'extension {{ extensionId }}, enregistrés pour le {{ siteLabel }}.
        </span>
        <div class="os-label-l">Serveur SMTP</div>
        <div class="row">
          <OsInputText v-model="form.smtp_host" label="Hôte" placeholder="smtp.example.com" :supporting-text="origin('smtp_host')" />
          <OsInputText v-model="form.smtp_port" label="Port" type="number" :supporting-text="origin('smtp_port')" />
        </div>
        <OsCheckbox v-model="smtpSecure" label="Connexion TLS directe (port 465)" />
        <div class="row">
          <OsInputText v-model="form.smtp_user" label="Utilisateur" autocomplete="off" :supporting-text="origin('smtp_user')" />
          <OsInputText
            v-model="form.smtp_password"
            label="Mot de passe"
            type="password"
            autocomplete="off"
            :placeholder="secretPlaceholder('smtp_password')"
            :supporting-text="origin('smtp_password')"
          />
        </div>
        <div class="row">
          <OsInputText
            v-model="form.smtp_from"
            label="Expéditeur"
            placeholder="Service client <factures@example.com>"
            :supporting-text="origin('smtp_from')"
          />
          <OsInputText v-model="form.smtp_bcc" label="Copie cachée (optionnelle)" :supporting-text="origin('smtp_bcc')" />
        </div>

        <OsDivider />

        <div class="os-label-l">Modèle d'email</div>
        <OsInputText
          v-model="form.email_subject"
          label="Objet"
          :supporting-text="`Variables : {{order_id}}, {{first_name}}, {{last_name}}, {{email}} — ${origin('email_subject')}`"
        />
        <label class="textarea">
          <span class="os-body-m">Message</span>
          <textarea v-model="form.email_body" class="os-label-s" rows="7" />
          <span class="os-body-s hint">{{ origin('email_body') }}</span>
        </label>

        <OsAlert v-if="message" :type="message.type" :subtitle="message.text" />

        <div class="actions">
          <OsButton class="back" type="tertiary" text="Retour" @click="emit('back')" />
          <OsButton type="secondary" text="Tester le SMTP" :pending="testing" @click="checkSmtp" />
          <OsButton text="Enregistrer" :pending="saving" @click="save" />
        </div>
      </div>
    </OsCardLayout>
    <div v-else class="actions">
      <OsButton class="back" type="tertiary" text="Retour" @click="emit('back')" />
    </div>
  </section>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.title { margin: 0; }
.group { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > :deep(*) { min-width: 200px; }
.hint { color: #7f7f7f; }
.textarea { display: flex; flex-direction: column; gap: 2px; color: #4c4c4c; }
.textarea textarea {
  resize: vertical; padding: 8px 12px; border: 1px solid #e5e5e5; border-radius: 5px; color: #333; outline: none;
  font-family: Roboto, sans-serif;
}
.textarea textarea:focus { border-color: #24bdb0; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.actions .back { margin-right: auto; }
</style>
