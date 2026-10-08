<script setup lang="ts">
defineProps<{ label?: string; disabled?: boolean; readonly?: boolean }>();
const model = defineModel<boolean | 'mixed'>();
</script>

<template>
  <label class="os-checkbox os-label-s" :class="{ disabled, readonly }">
    <input
      type="checkbox"
      :checked="model === true"
      :disabled="disabled || readonly"
      @change="model = !model"
    />
    <span v-if="label">{{ label }}</span>
  </label>
</template>

<style scoped>
.os-checkbox {
  display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 8px; border-radius: 36px;
  cursor: pointer; user-select: none; color: var(--os-neutral-700);
}
.os-checkbox:hover { background: var(--os-neutral-t-30); }
.os-checkbox input { width: 18px; height: 18px; margin: 0; accent-color: var(--os-primary-1000); cursor: inherit; }
.os-checkbox.disabled { cursor: default; color: var(--os-neutral-200); }
</style>
