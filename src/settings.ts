import { reactive, watch } from 'vue';
import { DEFAULT_SETTINGS, withDefaults } from '#lib/settings.js';

export type Settings = typeof DEFAULT_SETTINGS;

const STORAGE_KEY = 'onestock-invoice-settings';

function read(): Settings {
  try {
    return withDefaults(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return withDefaults({});
  }
}

/** Settings live in the browser and are sent to the Vercel functions with each call. */
export const settings = reactive<Settings>(read());

export function saveSettings(value: Settings) {
  Object.assign(settings, withDefaults(JSON.parse(JSON.stringify(value))));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked (private mode, third-party iframe): settings stay in memory for this session */
  }
}

export function onSettingsChange(callback: () => void) {
  watch(settings, callback, { deep: true });
}
