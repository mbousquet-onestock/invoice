<script setup lang="ts">
defineProps<{
  label?: string;
  placeholder?: string;
  supportingText?: string;
  options: { id: string; primaryText: string; secondaryText?: string }[];
  disabled?: boolean;
}>();
const model = defineModel<string>();
</script>

<template>
  <label class="os-input-group">
    <span v-if="label" class="os-input-label os-body-m">{{ label }}</span>
    <select v-model="model" class="os-select os-label-s" :disabled="disabled">
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="option in options" :key="option.id" :value="option.id">{{ option.primaryText }}</option>
    </select>
    <span v-if="supportingText" class="os-input-supporting os-body-s">{{ supportingText }}</span>
  </label>
</template>

<style scoped>
.os-input-group { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.os-input-label { color: var(--os-neutral-500); }
.os-select {
  height: 36px; padding: 0 8px 0 12px; border: 1px solid var(--os-neutral-100); border-radius: var(--os-radius);
  background: #fff; color: var(--os-neutral-700); outline: none;
}
.os-select:focus { border-color: var(--os-primary-1000); }
.os-input-supporting { color: var(--os-neutral-300); }
</style>
