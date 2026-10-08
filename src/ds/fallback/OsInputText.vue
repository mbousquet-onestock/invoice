<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    error?: string | boolean;
    placeholder?: string;
    type?: string;
    supportingText?: string;
    readonly?: boolean;
    disabled?: boolean;
    autocomplete?: string;
  }>(),
  { type: 'text' },
);
const model = defineModel<string | number>({ default: '' });
</script>

<template>
  <label class="os-input-group">
    <span v-if="label" class="os-input-label os-body-m">{{ label }}</span>
    <span class="os-input-field" :class="{ error: !!error, disabled, readonly }">
      <input
        v-model="model"
        class="os-input-text-field os-label-s"
        :type="type"
        :placeholder="placeholder"
        :readonly="readonly"
        :disabled="disabled"
        :autocomplete="autocomplete"
      />
    </span>
    <span v-if="typeof error === 'string' && error" class="os-input-error os-body-s">{{ error }}</span>
    <span v-else-if="supportingText" class="os-input-supporting os-body-s">{{ supportingText }}</span>
  </label>
</template>

<style scoped>
.os-input-group { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.os-input-label { color: var(--os-neutral-500); }
.os-input-field { display: flex; border: 1px solid var(--os-neutral-100); border-radius: var(--os-radius); background: #fff; }
.os-input-field:focus-within { border-color: var(--os-primary-1000); }
.os-input-field.error { border-color: var(--os-red-1000); }
.os-input-field.disabled, .os-input-field.readonly { background: var(--os-neutral-t-30); }
.os-input-text-field {
  width: 100%; box-sizing: border-box; border: none; outline: none; background: transparent;
  height: 34px; padding: 8px 8px 8px 12px; color: var(--os-neutral-700);
}
.os-input-text-field::placeholder { color: var(--os-neutral-200); }
.os-input-text-field:disabled { color: var(--os-neutral-200); }
.os-input-error { color: var(--os-red-1000); }
.os-input-supporting { color: var(--os-neutral-300); }
</style>
