<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    type?: 'primary' | 'secondary' | 'tertiary';
    color?: 'primary' | 'red' | 'orange' | 'blue' | 'neutral';
    text?: string;
    icon?: string | { icon: string; position?: 'start' | 'end' };
    pending?: boolean;
    disabled?: boolean;
  }>(),
  { type: 'primary', color: 'primary' },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();
function onClick(event: MouseEvent) {
  if (!props.disabled && !props.pending) emit('click', event);
}
</script>

<template>
  <button
    type="button"
    class="os-button os-body-l"
    :class="[type, `os-button-${type}-${color}`, { disabled, pending }]"
    :disabled="disabled"
    :aria-busy="pending"
    @click="onClick"
  >
    <span v-if="pending" class="os-button-loader" aria-hidden="true" />
    <span class="os-button-text" :class="{ hidden: pending }">{{ text }}</span>
  </button>
</template>

<style scoped>
.os-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; position: relative;
  height: 36px; min-width: 36px; padding: 8px 16px; border: none; border-radius: var(--os-radius); cursor: pointer;
  flex-shrink: 0;
}
.os-button-text { white-space: nowrap; }
.os-button-text.hidden { visibility: hidden; }
.primary:not(.disabled).os-button-primary-primary { color: #fff; background: var(--os-primary-1000); }
.primary:not(.disabled).os-button-primary-primary:hover:not(.pending) { background: var(--os-primary-800); }
.primary:not(.disabled).os-button-primary-red { color: #fff; background: var(--os-red-1000); }
.primary:not(.disabled).os-button-primary-red:hover:not(.pending) { background: var(--os-red-800); }
.secondary:not(.disabled) { color: var(--os-neutral-500); background: #fff; border: 1px solid var(--os-neutral-100); }
.secondary:not(.disabled):hover:not(.pending) { background: var(--os-neutral-t-30); }
.tertiary:not(.disabled) { color: var(--os-neutral-500); background: none; }
.tertiary:not(.disabled):hover:not(.pending) { background: var(--os-neutral-t-30); }
.tertiary:not(.disabled).os-button-tertiary-red { color: var(--os-red-1000); }
.os-button.disabled { cursor: default; color: var(--os-neutral-200); background: var(--os-neutral-t-50); }
.os-button.pending { cursor: default; }
.os-button-loader {
  position: absolute; width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
