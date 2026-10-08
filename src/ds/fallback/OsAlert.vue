<script setup lang="ts">
withDefaults(
  defineProps<{ type?: 'neutral' | 'danger' | 'warning' | 'info' | 'success'; title?: string; subtitle?: string }>(),
  { type: 'neutral' },
);
</script>

<template>
  <div class="os-alert" :class="type" role="status">
    <div class="os-alert-content">
      <div v-if="title" class="os-body-l">{{ title }}</div>
      <div v-if="subtitle" class="os-body-s">{{ subtitle }}</div>
      <slot name="content" />
    </div>
    <slot name="actions" />
  </div>
</template>

<style scoped>
.os-alert { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; border-radius: var(--os-radius); }
.os-alert-content { display: flex; flex-direction: column; gap: 4px; flex: 1; overflow-wrap: anywhere; }
.neutral { color: var(--os-neutral-700); background: var(--os-neutral-t-30); }
.danger { color: var(--os-red-1000); background: var(--os-red-t-100); }
.warning { color: var(--os-orange-1000); background: var(--os-orange-t-100); }
.info { color: var(--os-blue-1000); background: var(--os-blue-t-100); }
.success { color: var(--os-primary-1000); background: var(--os-primary-t-100); }
</style>
