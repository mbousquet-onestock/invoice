<script setup lang="ts">
import { reactive, ref } from 'vue';
import { OsAlert, OsButton, OsCardLayout, OsCheckbox, OsDivider, OsInputText, OsSelect } from '#ds';
import type { OnestockContext } from '../composables/useOnestockContext';
import { settings, saveSettings, type Settings } from '../settings';
import { testSmtp } from '../api';

defineProps<{ context: OnestockContext }>();

const form = reactive<Settings>(JSON.parse(JSON.stringify(settings)));
const message = ref<{ type: 'success' | 'danger'; text: string } | null>(null);
const testing = ref(false);

const authOptions = [
  { id: 'token', primaryText: 'Token API' },
  { id: 'credentials', primaryText: 'Identifiant / mot de passe (POST /login)' },
];
const environmentOptions = [
  { id: 'qualif', primaryText: 'Qualification' },
  { id: 'production', primaryText: 'Production' },
];
const versionOptions = ['v1', 'v2', 'v3', 'v4'].map((id) => ({ id, primaryText: id }));

function save() {
  saveSettings(form);
  message.value = { type: 'success', text: 'Paramètres enregistrés dans ce navigateur.' };
}

async function checkSmtp() {
  saveSettings(form);
  testing.value = true;
  message.value = null;
  try {
    await testSmtp();
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
    <OsAlert
      type="info"
      subtitle="Les paramètres sont conservés dans ce navigateur et transmis au proxy Vercel à chaque appel."
    />

    <OsCardLayout>
      <div class="group">
        <div class="os-label-l">API OneStock</div>
        <div class="row">
          <OsSelect v-model="form.onestock.auth_mode" label="Authentification" :options="authOptions" />
          <OsSelect v-model="form.onestock.api_version" label="Version" :options="versionOptions" />
        </div>
        <OsInputText
          v-if="form.onestock.auth_mode === 'token'"
          v-model="form.onestock.token"
          label="Token"
          type="password"
          autocomplete="off"
        />
        <div v-else class="row">
          <OsInputText v-model="form.onestock.user_id" label="Identifiant (user_id)" autocomplete="off" />
          <OsInputText v-model="form.onestock.password" label="Mot de passe" type="password" autocomplete="off" />
        </div>
        <div class="row">
          <OsInputText
            v-model="form.onestock.default_site_id"
            label="Site ID par défaut"
            placeholder="c00"
            :supporting-text="context.siteId ? `Contexte : ${context.siteId}` : 'Utilisé hors contexte OneStock'"
          />
          <OsSelect v-model="form.onestock.environment" label="Environnement" :options="environmentOptions" />
        </div>
        <OsInputText
          v-model="form.onestock.api_url"
          label="URL de l'API (optionnelle)"
          placeholder="https://c00.api.qualif.onestock-retail.com"
          :supporting-text="
            context.apiUrl
              ? `URL reçue du contexte : ${context.apiUrl}`
              : 'Vide : URL du contexte OneStock, sinon construite depuis le site ID et l\'environnement'
          "
        />

        <OsDivider />

        <div class="os-label-l">Serveur SMTP</div>
        <div class="row">
          <OsInputText v-model="form.smtp.host" label="Hôte" placeholder="smtp.example.com" />
          <OsInputText v-model.number="form.smtp.port" label="Port" type="number" />
        </div>
        <OsCheckbox v-model="form.smtp.secure" label="Connexion TLS directe (port 465)" />
        <div class="row">
          <OsInputText v-model="form.smtp.user" label="Utilisateur" autocomplete="off" />
          <OsInputText v-model="form.smtp.password" label="Mot de passe" type="password" autocomplete="off" />
        </div>
        <div class="row">
          <OsInputText v-model="form.smtp.from" label="Expéditeur" placeholder="Service client <factures@example.com>" />
          <OsInputText v-model="form.smtp.bcc" label="Copie cachée (optionnelle)" />
        </div>

        <OsDivider />

        <div class="os-label-l">Modèle d'email</div>
        <OsInputText
          v-model="form.email.subject"
          label="Objet"
          supporting-text="Variables : {{order_id}}, {{first_name}}, {{last_name}}, {{email}}"
        />
        <label class="textarea">
          <span class="os-body-m">Message</span>
          <textarea v-model="form.email.body" class="os-label-s" rows="7" />
        </label>

        <OsAlert v-if="message" :type="message.type" :subtitle="message.text" />

        <div class="actions">
          <OsButton type="secondary" text="Tester le SMTP" :pending="testing" @click="checkSmtp" />
          <OsButton text="Enregistrer" @click="save" />
        </div>
      </div>
    </OsCardLayout>
  </section>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 16px; }
.group { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > :deep(*) { min-width: 200px; }
.textarea { display: flex; flex-direction: column; gap: 2px; color: #4c4c4c; }
.textarea textarea {
  resize: vertical; padding: 8px 12px; border: 1px solid #e5e5e5; border-radius: 5px; color: #333; outline: none;
  font-family: Roboto, sans-serif;
}
.textarea textarea:focus { border-color: #24bdb0; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
