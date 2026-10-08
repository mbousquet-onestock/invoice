import { reactive } from 'vue';
import type { OnestockContext } from './composables/useOnestockContext';

export interface SettingValue {
  value: string;
  set: boolean;
  secret: boolean;
  /** Shared by every extension of the site (extension_id "*"). */
  general: boolean;
  /** Supplied by the Settings API (global level): read only. */
  provided: boolean;
  source: { site_id: string; extension_id: string; environment: string } | null;
}
export type SettingsMap = Record<string, SettingValue>;
export interface SettingsScope {
  siteId: string;
  extensionId: string;
  environment: string;
}

/** Settings of the current context, read from the Settings API through /api/settings (secrets masked). */
export const store = reactive({
  loaded: false,
  loading: false,
  error: '',
  /** Keys created with their default value on the first connection. */
  created: [] as string[],
  scope: null as SettingsScope | null,
  settings: {} as SettingsMap,
});

/** Context sent to every Vercel function: they read the settings for this site / extension / environment. */
export function requestContext(context: OnestockContext) {
  return {
    site_id: context.siteId,
    extension_id: context.extensionId,
    api_url: context.apiUrl,
    environment: context.environment,
    lang: context.lang,
  };
}

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`);
  return data;
}

export async function loadSettings(context: OnestockContext) {
  store.loading = true;
  store.error = '';
  try {
    const params = new URLSearchParams(
      Object.entries(requestContext(context)).filter(([, v]) => v) as [string, string][],
    );
    applySettings(await parse(await fetch(`/api/settings?${params}`)));
  } catch (err) {
    store.error = (err as Error).message;
  } finally {
    store.loading = false;
  }
}

function applySettings(data: { scope: SettingsScope; settings: SettingsMap; created?: string[] }) {
  store.scope = data.scope;
  store.settings = data.settings;
  store.created = data.created || [];
  store.loaded = true;
}

/**
 * Opening of the screen, in one call: settings (initialised on the first connection) and the order of the context.
 */
export async function initApp<T>(context: OnestockContext): Promise<{ order: T | null; order_error: string | null }> {
  store.loading = true;
  store.error = '';
  try {
    const data = await parse(
      await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { ...requestContext(context), order_id: context.orderId } }),
      }),
    );
    applySettings(data);
    return { order: data.order, order_error: data.order_error };
  } catch (err) {
    store.error = (err as Error).message;
    return { order: null, order_error: null };
  } finally {
    store.loading = false;
  }
}

export async function saveSettings(context: OnestockContext, values: Record<string, string>) {
  const data = await parse(
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: requestContext(context), values }),
    }),
  );
  store.scope = data.scope;
  store.settings = data.settings;
  return data.saved as string[];
}

export function setting(key: string) {
  return store.settings[key]?.value ?? '';
}

/** OneStock calls need onestock_token, provided globally by the Settings API. */
export function isConfigured() {
  return Boolean(store.settings.onestock_token?.set);
}
